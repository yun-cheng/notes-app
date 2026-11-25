import AVKit
import CryptoKit
import ImageIO
import NotesKit
import SwiftUI
import UniformTypeIdentifiers

#if os(macOS)
import AppKit
typealias PlatformImage = NSImage
extension Image {
    init(platform: PlatformImage) { self.init(nsImage: platform) }
}
#else
import UIKit
typealias PlatformImage = UIImage
extension Image {
    init(platform: PlatformImage) { self.init(uiImage: platform) }
}
#endif

/// Photos and files on this device, as the web app's photo queue: each is kept here as the server keeps it (sealed, in
/// an encrypted vault), shown from here at once, and uploaded in the background until the server has it.
@MainActor
final class Attachments {
    static let shared = Attachments()

    /// One waiting to go up.
    struct Pending: Codable, Hashable {
        var id: String
        var vaultId: String
        var mime: String
        var sealed: Bool
        var fileName: String?
        var width: Double?
        var height: Double?
        var duration: Double?
        /// The account it's for; others wait until that account is open again.
        var account: String?
    }

    private var loading: [String: Task<Data?, Never>] = [:]
    private var uploading = false
    private let folder: URL = {
        let f = URL.applicationSupportDirectory.appending(path: "Notes/attachments", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: f, withIntermediateDirectories: true)
        return f
    }()
    private var queueFile: URL { folder.appending(path: "pending.json") }

    private func file(_ id: String) -> URL { folder.appending(path: id.replacingOccurrences(of: "/", with: "_")) }

    var pending: [Pending] {
        get { (try? JSONDecoder().decode([Pending].self, from: Data(contentsOf: queueFile))) ?? [] }
        set { try? JSONEncoder().encode(newValue).write(to: queueFile) }
    }

    /// Deletes an account's photos and files from this device as it signs out, with any still waiting to go up.
    func forget(account: String, ids: Set<String>) {
        let leaving = pending.filter { $0.account == account }
        for id in ids.union(leaving.map(\.id)) { try? FileManager.default.removeItem(at: file(id)) }
        pending = pending.filter { $0.account != account }
        forgetThumbnails()
    }

    /// The bytes as stored: from this device, or fetched once from the server.
    func stored(_ id: String, api: ServerAPI) async -> Data? {
        let url = file(id)
        if let data = await Task.detached(operation: { try? Data(contentsOf: url) }).value { return data }
        if let task = loading[id] { return await task.value }
        let task = Task<Data?, Never> {
            guard let data = try? await api.attachment(id) else { return nil }
            try? data.write(to: url)
            return data
        }
        loading[id] = task
        let data = await task.value
        loading[id] = nil
        return data
    }

    /// The photo's or file's own bytes: opened with its vault's key when sealed. Nil while that key isn't open.
    func data(_ id: String, model: AppModel) async -> Data? {
        guard let stored = await stored(id, api: model.api) else { return nil }
        guard let vault = AttachmentSeal.sealedVault(stored) else { return stored }
        guard let key = model.repo.keyring.key(vault) else { return nil }
        return await Task.detached { AttachmentSeal.open(stored, id: id, key: key)?.data }.value
    }

    private let thumbs = NSCache<NSString, PlatformImage>()

    /// A photo no bigger than `pixels` on its longest side, for a thumbnail: read, opened and shrunk off the main
    /// thread rather than decoded whole, and kept in memory for when it scrolls by again.
    func thumbnail(_ id: String, pixels: Int, model: AppModel) async -> PlatformImage? {
        let key = "\(id)@\(pixels)" as NSString
        if let hit = thumbs.object(forKey: key) { return hit }
        guard let data = await data(id, model: model) else { return nil }
        guard let cg = await Task.detached(operation: { Self.shrink(data, pixels: pixels) }).value else { return nil }
        #if os(macOS)
        let image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        #else
        let image = UIImage(cgImage: cg)
        #endif
        thumbs.setObject(image, forKey: key)
        return image
    }

    /// Drops the thumbnails kept in memory, when a vault locks or the account signs out.
    func forgetThumbnails() { thumbs.removeAllObjects() }

    nonisolated static func shrink(_ data: Data, pixels: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: pixels,
            kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// The bytes in a file of their own, with the name given, for a player or for opening in another app.
    func fileURL(_ id: String, name: String, model: AppModel) async -> URL? {
        guard let data = await data(id, model: model) else { return nil }
        let dir = URL.temporaryDirectory.appending(path: id, directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: name.isEmpty ? "file" : name)
        try? data.write(to: url)
        return url
    }

    // MARK: Adding

    /// A photo shrunk as the web app's `prepare.ts` does: no edge over 2048 points, a JPEG at 0.85, except a small
    /// PNG, GIF or WebP, which stays as it is.
    nonisolated static func prepare(_ data: Data) -> (data: Data, mime: String, width: Double, height: Double)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return nil }
        let w = (props[kCGImagePropertyPixelWidth] as? Double) ?? 0
        let h = (props[kCGImagePropertyPixelHeight] as? Double) ?? 0
        let type = CGImageSourceGetType(source) as String?
        let keep: [String: String] = [UTType.png.identifier: "image/png", UTType.gif.identifier: "image/gif", UTType.webP.identifier: "image/webp"]
        if let type, let mime = keep[type], data.count < 2_000_000, max(w, h) <= 2048 { return (data, mime, w, h) }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary), let jpeg = jpeg(image, quality: 0.85) else { return nil }
        return (jpeg, "image/jpeg", Double(image.width), Double(image.height))
    }

    nonisolated static func jpeg(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    /// The largest file the server takes, and the largest video.
    static let maxFileBytes = 25 * 1024 * 1024
    static let maxVideoBytes = 1024 * 1024 * 1024

    enum AddError: LocalizedError {
        case notAPicture, tooBig(String), locked
        var errorDescription: String? {
            switch self {
            case .notAPicture: "That isn't a picture this app can read."
            case .tooBig(let s): s
            case .locked: "Open the vault first."
            }
        }
    }

    /// Keeps a photo for an entry in `vaultId` and queues its upload. Returns the photo node to put in the entry.
    /// `seal` overrides whether it's sealed, which otherwise follows the vault.
    func addPhoto(_ raw: Data, vaultId: String, model: AppModel, id given: String? = nil, seal: Bool? = nil) async throws -> JSONValue {
        guard let photo = await Task.detached(operation: { Self.prepare(raw) }).value else { throw AddError.notAPicture }
        let id = given ?? UUID().uuidString.lowercased()
        try await keep(id, photo.data, vaultId: vaultId, model: model, seal: seal, pending: Pending(id: id, vaultId: vaultId, mime: photo.mime, sealed: false, width: photo.width, height: photo.height))
        return Doc.photoNode(id, width: photo.width, height: photo.height)
    }

    /// Keeps a file (a video, a sound, a PDF, anything) and queues its upload. Returns the file node.
    /// A video's still, its size and its length, as the web app's `video.ts` finds them when one is added.
    static func videoFacts(_ data: Data, name: String) async -> (poster: Data?, width: Double?, height: Double?, duration: Double?) {
        let url = URL.temporaryDirectory.appending(path: UUID().uuidString + "-" + name)
        guard (try? data.write(to: url)) != nil else { return (nil, nil, nil, nil) }
        defer { try? FileManager.default.removeItem(at: url) }
        let asset = AVURLAsset(url: url)
        let duration = try? await asset.load(.duration).seconds
        let track = try? await asset.loadTracks(withMediaType: .video).first
        let size = try? await track?.load(.naturalSize)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 1280, height: 1280)
        let still = try? await generator.image(at: CMTime(seconds: min(0.5, (duration ?? 0) / 2), preferredTimescale: 600)).image
        let poster = still.flatMap { jpeg($0, quality: 0.82) }
        return (poster, size.map { Double(abs($0.width)) }, size.map { Double(abs($0.height)) }, duration.flatMap { $0.isFinite && $0 > 0 ? $0 : nil })
    }

    /// Keeps a video with its still beside it, as a photo under the video's ID plus `-poster`.
    func addVideo(_ data: Data, name: String, mime: String, vaultId: String, model: AppModel) async throws -> JSONValue {
        let facts = await Self.videoFacts(data, name: name)
        let id = UUID().uuidString.lowercased()
        var extra: [String: JSONValue] = [:]
        if let poster = facts.poster, let still = try? await addPhoto(poster, vaultId: vaultId, model: model, id: Doc.posterId(id)) {
            extra["poster"] = still["attrs"]?["id"] ?? .null
        }
        if let w = facts.width { extra["width"] = .double(w) }
        if let h = facts.height { extra["height"] = .double(h) }
        return try await addFile(data, name: name, mime: mime, vaultId: vaultId, model: model, duration: facts.duration, extra: extra, id: id)
    }

    func addFile(_ data: Data, name: String, mime: String, vaultId: String, model: AppModel, duration: Double? = nil, extra: [String: JSONValue] = [:], id given: String? = nil, seal: Bool? = nil) async throws -> JSONValue {
        let video = mime.hasPrefix("video/")
        let limit = video ? Self.maxVideoBytes : Self.maxFileBytes
        if data.count > limit {
            throw AddError.tooBig("\(name) is \(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file)). \(video ? "Videos" : "Files") can be up to \(ByteCountFormatter.string(fromByteCount: Int64(limit), countStyle: .file)).")
        }
        let id = given ?? UUID().uuidString.lowercased()
        try await keep(id, data, vaultId: vaultId, model: model, seal: seal, pending: Pending(id: id, vaultId: vaultId, mime: mime, sealed: false, fileName: name, duration: duration))
        return Doc.fileNode(id: id, name: name, mime: mime, size: Int64(data.count), duration: duration, extra: extra)
    }

    /// Seals it if it's to be sealed and writes it here, both off the main thread (a video can be a gigabyte).
    private func keep(_ id: String, _ data: Data, vaultId: String, model: AppModel, seal: Bool?, pending item: Pending) async throws {
        var item = item
        item.account = model.accountId
        var key: SymmetricKey?
        if seal ?? (model.vault(vaultId)?.isEncrypted == true) {
            guard let k = model.repo.keyring.key(vaultId) else { throw AddError.locked }
            key = k
            item.sealed = true
        }
        let url = file(id)
        let facts = AttachmentSeal.Facts(mime: item.mime, size: data.count, name: item.fileName, width: item.width, height: item.height, duration: item.duration)
        try await Task.detached {
            let stored = try key.map { try AttachmentSeal.seal(data, id: id, vaultId: vaultId, key: $0, facts: facts) } ?? data
            try stored.write(to: url)
        }.value
        pending.append(item)
        Task { await upload(model: model) }
    }

    /// Sends what's waiting, one at a time, until the server has them all or can't take more now.
    func upload(model: AppModel) async {
        guard !uploading else { return }
        uploading = true
        defer { uploading = false }
        for item in pending where item.account == nil || item.account == model.accountId {
            let url = file(item.id)
            guard let data = await Task.detached(operation: { try? Data(contentsOf: url) }).value else {
                pending.removeAll { $0.id == item.id }
                continue
            }
            let result = try? await model.api.upload(
                item.id, data: data, mime: item.sealed ? "application/octet-stream" : item.mime, vaultId: item.vaultId, sealed: item.sealed,
                fileName: item.fileName, width: item.width, height: item.height, duration: item.duration)
            switch result {
            case .ok, .rejected: pending.removeAll { $0.id == item.id }
            case .needsDrive, .notConfigured:
                // Kept here until Google Drive is connected; shown from this device meanwhile.
                return
            case nil: return
            }
        }
    }
}

/// A photo, or a video's still, as a square thumbnail.
struct PhotoThumb: View {
    @Environment(AppModel.self) private var model
    let media: Doc.Media
    let vaultId: String
    var size: CGFloat? = nil
    @State private var image: PlatformImage?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .frame(width: size, height: size)
            .overlay {
                if let image {
                    Image(platform: image).resizable().scaledToFill()
                } else {
                    Theme.sunken.overlay { Image(systemName: model.vault(vaultId)?.isEncrypted == true ? "lock" : "photo").foregroundStyle(Theme.muted) }
                }
            }
            .overlay(alignment: .topTrailing) {
                if case .video(let file) = media { VideoMark(duration: file.duration) }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .task(id: media.id) {
                let id: String =
                    switch media {
                    case .photo(let id): id
                    case .video(let file): file.poster ?? Doc.posterId(file.id)
                    }
                // Three pixels a point, for the size it's shown at; a grid cell when it fills its space.
                image = await Attachments.shared.thumbnail(id, pixels: Int((size ?? 200) * 3), model: model)
            }
    }
}

/// An entry's photos, videos, voice messages, files and web links, under its bubble, as the web app's `Attachments`:
/// photos and videos whole at their own shapes (large, as thumbnails, or as a count, by the device's setting or the
/// entry's own), four at most with the rest counted on the last; voice messages playing where they are; files as chips;
/// links as cards.
struct EntryAttachments: View {
    @Environment(AppModel.self) private var model
    @AppStorage("photoStyle") private var deviceStyle = "large"
    let card: Card
    @State private var viewing: String?

    static let maxPhotos = 4

    var body: some View {
        let media = BubbleMemo.value(model, card, "media") { Doc.media(card.content) }
        let all = BubbleMemo.value(model, card, "files") { Doc.files(card.content).filter { !$0.isVideo } }
        let voices = all.filter(\.isAudio)
        let files = all.filter { !$0.isAudio }
        let style = card.payload["preview"]?["photos"]?.stringValue ?? deviceStyle
        if !media.isEmpty || !all.isEmpty || BubbleLinks.has(card, model: model) {
            VStack(alignment: .leading, spacing: 4) {
                if !media.isEmpty, style == "off" {
                    Button { viewing = media[0].id } label: {
                        Label(Self.mediaCount(media), systemImage: media.allSatisfy { if case .video = $0 { true } else { false } } ? "video" : "photo")
                            .font(.footnote).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Capsule().fill(Theme.surface)).overlay(Capsule().stroke(Theme.line))
                    }
                    .buttonStyle(.plain)
                } else if !media.isEmpty {
                    let height: CGFloat = style == "thumbs" ? 180 : 280
                    FlowLayout(spacing: 4) {
                        ForEach(Array(media.prefix(Self.maxPhotos).enumerated()), id: \.element.id) { i, m in
                            let more = i == Self.maxPhotos - 1 ? media.count - Self.maxPhotos : 0
                            ShapedThumb(media: m, vaultId: card.vaultId, height: height, alone: media.count == 1 && style != "thumbs", more: more)
                                .onTapGesture { viewing = m.id }
                                .contextMenu {
                                    PhotoMenu(id: m.id, card: card)
                                    PublicLinkMenu(id: m.id, vaultId: card.vaultId)
                                }
                        }
                    }
                }
                ForEach(voices) { file in VoicePlayer(file: file, vaultId: card.vaultId, card: card) }
                ForEach(files) { file in FileChip(file: file, vaultId: card.vaultId) }
                BubbleLinks(card: card)
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(.top, 2)
            .onChange(of: viewing) { _, start in
                guard let start else { return }
                model.viewer = ViewerRequest(media: media, start: start, vaultId: card.vaultId)
                viewing = nil
            }
        }
    }

    /// "3 photos", "1 video", "2 photos and 1 video".
    static func mediaCount(_ items: [Doc.Media]) -> String {
        let videos = items.filter { if case .video = $0 { true } else { false } }.count
        let photos = items.count - videos
        func say(_ n: Int, _ one: String) -> String { n == 1 ? "1 \(one)" : "\(n) \(one)s" }
        if photos > 0 && videos > 0 { return "\(say(photos, "photo")) and \(say(videos, "video"))" }
        return videos > 0 ? say(videos, "video") : say(photos, "photo")
    }
}

/// A photo, or a video's still, whole at its own shape, a row's height tall (a lone one larger, up to 480 points),
/// as the web's `.thumb`; a video marked with its length, and the last of a row with how many more there are.
struct ShapedThumb: View {
    @Environment(AppModel.self) private var model
    let media: Doc.Media
    let vaultId: String
    var height: CGFloat = 280
    var alone = false
    var more = 0
    @State private var image: PlatformImage?

    private var aspect: CGFloat {
        if let image, image.size.height > 0 { return image.size.width / image.size.height }
        if case .video(let f) = media, let w = f.width, let h = f.height, h > 0 { return w / h }
        return 1
    }

    var body: some View {
        let tall = alone ? min(480, 440 / max(aspect, 0.3)) : height
        let width = min(alone ? 560 : 440, max(96, tall * aspect))
        ZStack {
            Theme.sunken
            if let image {
                Image(platform: image).resizable().scaledToFit()
            } else {
                Image(systemName: model.vault(vaultId)?.isEncrypted == true ? "lock" : "photo").foregroundStyle(Theme.muted)
            }
            if more > 0 {
                Color.black.opacity(0.45)
                Text("+\(more)").font(.title3.weight(.bold)).foregroundStyle(.white)
            }
        }
        .frame(width: width, height: tall)
        .overlay(alignment: .topTrailing) {
            if case .video(let file) = media, more == 0 { VideoMark(duration: file.duration) }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .task(id: media.id) {
            let id: String =
                switch media {
                case .photo(let id): id
                case .video(let file): file.poster ?? Doc.posterId(file.id)
                }
            image = await Attachments.shared.thumbnail(id, pixels: 1200, model: model)
        }
    }
}

/// A video's length with a play mark, in a dark pill in a corner of its still, as the web's `VideoMark`.
struct VideoMark: View {
    let duration: Double?

    var body: some View {
        HStack(spacing: 3) {
            if let duration { Text(Doc.clipLength(duration)).monospacedDigit() }
            Image(systemName: "play.fill").imageScale(.small)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Capsule().fill(.black.opacity(0.55)))
        .padding(6)
    }
}

/// A photo's right-click menu: copy it, save it, open its entry.
struct PhotoMenu: View {
    @Environment(AppModel.self) private var model
    let id: String
    let card: Card

    var body: some View {
        Button("Copy photo") {
            Task {
                guard let data = await Attachments.shared.data(id, model: model), let image = PlatformImage(data: data) else { return }
                #if os(macOS)
                NSPasteboard.general.clearContents()
                NSPasteboard.general.writeObjects([image])
                #else
                UIPasteboard.general.image = image
                #endif
                model.say("Copied")
            }
        }
        Button("Open entry") { model.openEntry = card.id }
        Button("Show in journal") { model.page = .journal(StreamFilter()); model.lastSaved = card.id }
    }
}

/// An attached file as a chip, as the web app's: its kind, name, and size with its extension; pressing it opens it in
/// the app that reads it, the share button shares it by a public link (in a vault that can), and the arrow saves a
/// copy (to Downloads on a Mac; a phone offers where). A sound plays where it is instead.
struct FileChip: View {
    @Environment(AppModel.self) private var model
    let file: Doc.FileInfo
    let vaultId: String
    @State private var opening = false

    var body: some View {
        if file.isAudio {
            VoicePlayer(file: file, vaultId: vaultId)
        } else {
            HStack(spacing: 0) {
                Button(action: open) {
                    HStack(spacing: 10) {
                        Image(systemName: file.symbol)
                            .frame(width: 28, height: 28)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.sunken))
                            .foregroundStyle(Theme.muted)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(file.name).font(.subheadline.weight(.semibold)).lineLimit(1).truncationMode(.middle)
                            Text(Self.detail(file)).font(.caption).foregroundStyle(Theme.muted)
                        }
                        if opening { ProgressView().controlSize(.small) }
                    }
                    .padding(.leading, 8).padding(.trailing, 4).padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Open \(file.name)")
                if model.vault(vaultId).map({ $0.role != .viewer && !$0.isEncrypted }) ?? false {
                    Button(action: share) { Image(systemName: "square.and.arrow.up").frame(width: 34, height: 40).contentShape(Rectangle()) }
                        .buttonStyle(.plain).foregroundStyle(Theme.muted)
                        .help("Share via public link (anyone with it can open it)")
                        .accessibilityLabel("Share \(file.name) via a public link")
                }
                Button(action: save) { Image(systemName: "arrow.down.to.line").frame(width: 34, height: 40).contentShape(Rectangle()) }
                    .buttonStyle(.plain).foregroundStyle(Theme.muted)
                    .help("Download")
                    .accessibilityLabel("Download \(file.name)")
            }
            .frame(maxWidth: 360, alignment: .leading)
            .fixedSize(horizontal: true, vertical: false)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
        }
    }

    /// "150 B · TXT", as the web's chip.
    static func detail(_ file: Doc.FileInfo) -> String {
        [file.size.map(fileSize), extensionLabel(file.name)].compactMap { $0 }.joined(separator: " · ")
    }

    /// A file's size as the web app writes it: "150 B", "12 KB", "3.4 MB", "1.2 GB".
    static func fileSize(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(Int((Double(bytes) / 1024).rounded())) KB" }
        if bytes >= 1024 * 1024 * 1024 { return String(format: "%g GB", (Double(bytes) / 1_073_741_824 * 10).rounded() / 10) }
        let mb = Double(bytes) / 1_048_576
        return mb < 10 ? String(format: "%.1f MB", mb) : "\(Int(mb.rounded())) MB"
    }

    /// A file's extension in capitals, "PDF", or "File".
    static func extensionLabel(_ name: String) -> String {
        guard let dot = name.lastIndex(of: "."), case let ext = name[name.index(after: dot)...], (1...5).contains(ext.count), ext.allSatisfy({ $0.isLetter || $0.isNumber }) else { return "File" }
        return ext.uppercased()
    }

    private func share() {
        Task {
            switch await model.api.shareDriveLink(file.id) {
            case .success(let url):
                Clipboard.copy(url)
                model.say("Public link copied")
            case .failure(let error):
                model.say(error.localizedDescription)
            }
        }
    }

    private func save() {
        Task {
            guard let url = await Attachments.shared.fileURL(file.id, name: file.name, model: model) else {
                model.say("That file can't be fetched now.")
                return
            }
            #if os(macOS)
            let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            var target = downloads.appending(path: file.name)
            var n = 1
            while FileManager.default.fileExists(atPath: target.path) {
                n += 1
                let base = (file.name as NSString).deletingPathExtension
                let ext = (file.name as NSString).pathExtension
                target = downloads.appending(path: ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            }
            do {
                try FileManager.default.copyItem(at: url, to: target)
                NSWorkspace.shared.activateFileViewerSelecting([target])
            } catch {
                model.say("It couldn't be saved to Downloads.")
            }
            #else
            model.preview = url
            #endif
        }
    }

    private func open() {
        opening = true
        Task {
            defer { opening = false }
            guard let url = await Attachments.shared.fileURL(file.id, name: file.name, model: model) else {
                model.say("That file can't be fetched now.")
                return
            }
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            model.preview = url
            #endif
        }
    }
}

/// What the photo viewer shows, as the web's `PhotoViewer` is opened: the photos and videos to page through, which to
/// start at, and, from the Photos page, each one's entry for its caption.
struct ViewerRequest: Identifiable {
    let id = UUID()
    var media: [Doc.Media]
    var start: String
    var vaultId: String
    /// By photo, the entry it's in and its day, named over the photo to open it.
    var entries: [String: (card: String, day: String)] = [:]
}

/// Photos and videos over the whole window, as the web's viewer: the one shown in the middle, zoomed with a pinch, the
/// wheel or + and −; the previous and next at its sides; how far along it is; a row of all of them along the foot;
/// from the Photos page, its entry and day at the top, pressed to open it; and a close. Arrows page, Esc closes.
struct MediaViewer: View {
    @Environment(AppModel.self) private var model
    let request: ViewerRequest
    let close: () -> Void
    @State private var current: String = ""
    @State private var scale: CGFloat = 1
    @FocusState private var focused: Bool

    var body: some View {
        let media = request.media
        let at = media.firstIndex { $0.id == current } ?? 0
        ZStack {
            Color.black.opacity(0.9).ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: close)
            if media.indices.contains(at) {
                MediaPage(media: media[at], vaultId: request.vaultId, scale: $scale)
                    .id(media[at].id)
                    .padding(.horizontal, media.count > 1 ? 56 : 16)
                    .padding(.top, 48)
                    .padding(.bottom, media.count > 1 ? 104 : 24)
                    // A swipe pages, as on a phone's photo viewer, while the photo isn't zoomed.
                    .simultaneousGesture(DragGesture(minimumDistance: 30).onEnded { v in
                        guard scale <= 1, abs(v.translation.width) > abs(v.translation.height), abs(v.translation.width) > 60 else { return }
                        step(v.translation.width < 0 ? 1 : -1)
                    })
                    .contextMenu {
                        if case .photo(let id) = media[at], let entry = request.entries[id].flatMap({ model.card($0.card) }) ?? model.index.live.first(where: { Doc.media($0.content).contains { $0.id == id } }) {
                            PhotoMenu(id: id, card: entry)
                        }
                    }
            }
            VStack {
                HStack(alignment: .top) {
                    if let entry = request.entries[current], let card = model.card(entry.card) {
                        Button {
                            close()
                            model.openEntry = card.id
                        } label: {
                            HStack(spacing: 6) {
                                Text(card.displayTitle.isEmpty ? "Untitled" : card.displayTitle).fontWeight(.semibold).lineLimit(1)
                                Text(DateKey.relativeDay(entry.day, today: model.today)).foregroundStyle(.white.opacity(0.7))
                                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                            }
                            .font(.system(size: 13))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Capsule().fill(.black.opacity(0.55)))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.white)
                        .accessibilityLabel("Open the entry: \(card.displayTitle)")
                    }
                    Spacer()
                    if scale > 1 {
                        Button("\(Int(scale * 100))% · Fit") { withAnimation { scale = 1 } }
                            .buttonStyle(.plain).foregroundStyle(.white).font(.system(size: 13))
                            .padding(.horizontal, 10).padding(.vertical, 6).background(Capsule().fill(.black.opacity(0.55)))
                            .help("Fit the photo to the screen (0)")
                    }
                    Button(action: close) {
                        Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)).frame(width: 36, height: 36)
                            .background(Circle().fill(.black.opacity(0.55)))
                    }
                    .buttonStyle(.plain).foregroundStyle(.white)
                    .accessibilityLabel("Close")
                }
                .padding(12)
                Spacer()
                if media.count > 1 {
                    Text("\(at + 1) / \(media.count)").font(.system(size: 12).monospacedDigit()).foregroundStyle(.white.opacity(0.8))
                    ScrollViewReader { proxy in
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(spacing: 6) {
                                ForEach(media) { m in
                                    Button { current = m.id; scale = 1 } label: {
                                        PhotoThumb(media: m, vaultId: request.vaultId, size: 48)
                                            .frame(width: 48, height: 48)
                                            .clipShape(RoundedRectangle(cornerRadius: 6))
                                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.white, lineWidth: m.id == current ? 2 : 0))
                                            .opacity(m.id == current ? 1 : 0.6)
                                    }
                                    .buttonStyle(.plain)
                                    .id(m.id)
                                }
                            }
                            .padding(.horizontal, 12)
                        }
                        .frame(height: 56)
                        .onChange(of: current) { _, id in withAnimation { proxy.scrollTo(id, anchor: .center) } }
                        .onAppear { proxy.scrollTo(request.start, anchor: .center) }
                    }
                    .padding(.bottom, 12)
                    .accessibilityLabel("All of them")
                }
            }
            if media.count > 1 {
                HStack {
                    side("chevron.left", "Previous") { step(-1) }
                    Spacer()
                    side("chevron.right", "Next") { step(1) }
                }
                .padding(.horizontal, 10)
            }
        }
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(.leftArrow) { step(-1); return .handled }
        .onKeyPress(.rightArrow) { step(1); return .handled }
        .onKeyPress(.escape) { close(); return .handled }
        .onKeyPress(characters: CharacterSet(charactersIn: "+=-0")) { press in
            switch press.characters {
            case "+", "=": withAnimation { scale = min(6, scale * 1.5) }
            case "-": withAnimation { scale = max(1, scale / 1.5) }
            default: withAnimation { scale = 1 }
            }
            return .handled
        }
        .onAppear { current = request.start; focused = true }
    }

    private func side(_ icon: String, _ label: String, _ go: @escaping () -> Void) -> some View {
        Button(action: go) {
            Image(systemName: icon).font(.system(size: 17, weight: .semibold)).frame(width: 40, height: 40)
                .background(Circle().fill(.black.opacity(0.55)))
        }
        .buttonStyle(.plain).foregroundStyle(.white)
        .accessibilityLabel(label)
    }

    /// The previous or next photo, round from the last to the first.
    private func step(_ by: Int) {
        let media = request.media
        guard let at = media.firstIndex(where: { $0.id == current }), !media.isEmpty else { return }
        current = media[(at + by + media.count) % media.count].id
        scale = 1
    }
}

struct MediaPage: View {
    @Environment(AppModel.self) private var model
    let media: Doc.Media
    let vaultId: String
    @Binding var scale: CGFloat
    @State private var image: PlatformImage?
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            switch media {
            case .photo:
                if let image {
                    Image(platform: image).resizable().scaledToFit()
                        .scaleEffect(scale)
                        .gesture(MagnifyGesture().onChanged { scale = max(1, $0.magnification) }.onEnded { _ in withAnimation { if scale < 1.1 { scale = 1 } } })
                        .onTapGesture(count: 2) { withAnimation { scale = scale > 1 ? 1 : 2.5 } }
                } else {
                    ProgressView().tint(.white)
                }
            case .video:
                if let player { VideoPlayer(player: player) } else { ProgressView().tint(.white) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: media.id) {
            switch media {
            case .photo(let id):
                if let data = await Attachments.shared.data(id, model: model) { image = PlatformImage(data: data) }
            case .video(let file):
                if let url = await Attachments.shared.fileURL(file.id, name: file.name, model: model) {
                    player = AVPlayer(url: url)
                    // As the web's viewer, a video plays as it's opened.
                    player?.play()
                }
            }
        }
        .onDisappear { player?.pause() }
    }
}

/// Sends photos and files no entry holds to the Trash, brings back those held again, and deletes for good those
/// 30 days in it, as the web app's `AttachmentKeeper`: after a sync that left nothing waiting, every ten minutes.
@MainActor
@Observable
final class AttachmentKeeper {
    static let shared = AttachmentKeeper()
    private(set) var trash: [StoredAttachment] = []
    @ObservationIgnored private var last = Date.distantPast
    @ObservationIgnored private var running = false

    func sweep(model: AppModel, now: Bool = false) async {
        guard !running, now || Date().timeIntervalSince(last) > 600, let sync = model.sync, sync.state == .idle, sync.pending == 0, sync.lastSyncedAt != nil else { return }
        running = true
        defer { running = false }
        last = Date()
        guard let stored = try? await model.api.attachments() else { return }
        let holders = (try? await model.repo.meta("attachmentHolders", as: [String: AttachmentSweep.Holder].self)) ?? [:]
        // A vault this device can't read all of says nothing about which of its photos are held: locked here, or
        // with cards it can't open, as when another device has just encrypted it and the key isn't here yet.
        let unread = model.lockedVaults
            .union(model.cards.filter(\.sealed).map(\.vaultId))
            .union(model.vaults.filter { $0.isEncrypted && model.repo.keyring.key($0.id) == nil }.map(\.id))
        let plan = AttachmentSweep.plan(
            stored: stored, cards: model.cards.filter { !unread.contains($0.vaultId) },
            judges: { id in model.vault(id).map { $0.role != .viewer && !unread.contains(id) } ?? false }, mayDelete: unread.isEmpty,
            holders: holders, now: Repository.milliseconds())
        try? await model.repo.setMeta("attachmentHolders", plan.holders)
        if !plan.trash.isEmpty || !plan.keep.isEmpty { try? await model.api.markAttachments(trash: plan.trash, keep: plan.keep) }
        for id in plan.remove { _ = try? await model.api.deleteAttachment(id) }
        let changed = !plan.trash.isEmpty || !plan.keep.isEmpty || !plan.remove.isEmpty
        let latest = changed ? ((try? await model.api.attachments()) ?? stored) : stored
        trash = latest.filter { $0.trashed_at != nil }.sorted { ($0.trashed_at ?? 0) > ($1.trashed_at ?? 0) }
    }

    /// Puts a photo or file back: at the end of the entry it was in, or in a new note in its vault.
    func putBack(_ a: StoredAttachment, model: AppModel) {
        let stillId = Doc.posterId(a.id)
        let still = a.mime.hasPrefix("video/") && trash.contains { $0.id == stillId } ? stillId : nil
        let node = a.isFile
            ? Doc.fileNode(id: a.id, name: a.name ?? "Untitled", mime: a.mime, size: a.size, poster: still, width: a.width, height: a.height, duration: a.duration)
            : Doc.photoNode(a.id, width: a.width, height: a.height)
        let from = a.trashed_from.flatMap { model.card($0) }
        model.perform { repo in
            if let from, from.isEntry, !from.deleted, await model.canEdit(from) {
                try await repo.update(from.id) { c in c.content["content"] = .array((c.content["content"]?.arrayValue ?? []) + [node]) }
                await MainActor.run { model.say("Put back in “\(from.displayTitle)”", undoable: true) }
            } else {
                try await repo.createNote(content: ["type": "doc", "content": [node]], vaultId: a.vault_id)
                await MainActor.run { model.say("Put back, in a new note", undoable: true) }
            }
            try? await model.api.markAttachments(trash: [], keep: [a.id] + (still.map { [$0] } ?? []))
        }
        trash.removeAll { $0.id == a.id || $0.id == still }
    }

    func deleteForGood(_ a: StoredAttachment, model: AppModel) {
        Task {
            switch try? await model.api.deleteAttachment(a.id) {
            case .ok?, .gone?:
                let still = Doc.posterId(a.id)
                if trash.contains(where: { $0.id == still }) { _ = try? await model.api.deleteAttachment(still) }
                trash.removeAll { $0.id == a.id || $0.id == still }
                model.say("Deleted for good")
            case .needsDrive?: model.say("Connect Google Drive to delete it from there too.")
            case .inUse?: model.say("An entry holds it again, so it stays.")
            default: model.say("It couldn't be deleted now. Try again.")
            }
        }
    }
}

/// Photos, videos and files taken out of every entry, at the top of the Trash, as the web's: each with the entry it
/// was in and the days left before it's deleted, from Google Drive too, to put back or delete for good. A video's
/// still goes where the video goes, so it isn't listed on its own. `vaultId` narrows it to one vault.
struct TrashedAttachments: View {
    @Environment(AppModel.self) private var model
    var vaultId: String? = nil
    @State private var confirming: StoredAttachment?

    var body: some View {
        let all = AttachmentKeeper.shared.trash
        let items = all.filter { (vaultId == nil || $0.vault_id == vaultId) && !$0.id.hasSuffix("-poster") }
        let shown = items.filter { !$0.isFile || $0.mime.hasPrefix("video/") } + items.filter { $0.isFile && !$0.mime.hasPrefix("video/") }
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Photos and files").font(.headline)
                Text("Taken out of their entries. Each is deleted for good \(StoredAttachment.trashDays) days after, from Google Drive too.")
                    .font(.footnote).foregroundStyle(Theme.muted).padding(.bottom, 4)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12, alignment: .top)], alignment: .leading, spacing: 14) {
                    ForEach(shown) { a in item(a, still: all.contains { $0.id == Doc.posterId(a.id) } ? Doc.posterId(a.id) : nil) }
                }
            }
            .padding(.bottom, 12)
            .confirmationDialog("Delete it for good?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), presenting: confirming) { a in
                Button("Delete for good", role: .destructive) { AttachmentKeeper.shared.deleteForGood(a, model: model) }
            } message: { _ in
                Text("It's deleted from Google Drive too, and can't be undone.")
            }
        }
    }

    private func item(_ a: StoredAttachment, still: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            // The column's width, the picture cropped into it: a photo's own width mustn't push the column wider.
            Color.clear.frame(height: 130).frame(maxWidth: .infinity).overlay {
            Group {
                if a.mime.hasPrefix("video/") {
                    ShapedFill(media: .photo(still ?? a.id), vaultId: a.vault_id)
                        .overlay(alignment: .topTrailing) { VideoMark(duration: a.duration) }
                } else if a.isFile {
                    VStack(alignment: .leading, spacing: 2) {
                        Image(systemName: Doc.fileSymbol(mime: a.mime)).frame(width: 28, height: 28)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface)).foregroundStyle(Theme.muted)
                        Spacer(minLength: 0)
                        Text(a.name ?? "File").font(.subheadline.weight(.semibold)).lineLimit(2)
                        Text([FileChip.fileSize(a.size), FileChip.extensionLabel(a.name ?? "")].joined(separator: " · ")).font(.caption).foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .background(Theme.sunken)
                } else {
                    ShapedFill(media: .photo(a.id), vaultId: a.vault_id)
                }
            }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.bottom, 3)
            Text(a.trashed_from.flatMap { model.card($0) }.map { "From “\($0.displayTitle)”" } ?? "From an entry").font(.footnote.weight(.semibold)).lineLimit(1)
            let left = a.daysLeft(now: Repository.milliseconds())
            Text(left == 0 ? "Deleted at the next check" : left == 1 ? "1 day left" : "\(left) days left").font(.caption).foregroundStyle(Theme.muted)
            if model.vault(a.vault_id).map({ $0.role != .viewer }) ?? false {
                HStack(spacing: 4) {
                    Button { AttachmentKeeper.shared.putBack(a, model: model) } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
                        .buttonStyle(.bordered)
                    Button(role: .destructive) { confirming = a } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless).foregroundStyle(Theme.muted).accessibilityLabel("Delete for good")
                }
                .font(.footnote)
                .padding(.top, 4)
            }
        }
    }
}
