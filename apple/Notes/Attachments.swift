import AVKit
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

    /// The bytes as stored: from this device, or fetched once from the server.
    func stored(_ id: String, api: ServerAPI) async -> Data? {
        let url = file(id)
        if let data = try? Data(contentsOf: url) { return data }
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
        return AttachmentSeal.open(stored, id: id, key: key)?.data
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
    static func prepare(_ data: Data) -> (data: Data, mime: String, width: Double, height: Double)? {
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
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return (out as Data, "image/jpeg", Double(image.width), Double(image.height))
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
    func addPhoto(_ raw: Data, vaultId: String, model: AppModel, id given: String? = nil) throws -> JSONValue {
        guard let photo = Self.prepare(raw) else { throw AddError.notAPicture }
        let id = given ?? UUID().uuidString.lowercased()
        try keep(id, photo.data, vaultId: vaultId, model: model, pending: Pending(id: id, vaultId: vaultId, mime: photo.mime, sealed: false, width: photo.width, height: photo.height))
        return ["type": "photo", "attrs": ["id": .string(id)]]
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
        var poster: Data?
        if let image = try? await generator.image(at: CMTime(seconds: min(0.5, (duration ?? 0) / 2), preferredTimescale: 600)).image {
            let out = NSMutableData()
            if let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) {
                CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary)
                if CGImageDestinationFinalize(dest) { poster = out as Data }
            }
        }
        return (poster, size.map { Double(abs($0.width)) }, size.map { Double(abs($0.height)) }, duration.flatMap { $0.isFinite && $0 > 0 ? $0 : nil })
    }

    /// Keeps a video with its still beside it, as a photo under the video's ID plus `-poster`.
    func addVideo(_ data: Data, name: String, mime: String, vaultId: String, model: AppModel) async throws -> JSONValue {
        let facts = await Self.videoFacts(data, name: name)
        let id = UUID().uuidString.lowercased()
        var extra: [String: JSONValue] = [:]
        if let poster = facts.poster, let still = try? addPhoto(poster, vaultId: vaultId, model: model, id: Doc.posterId(id)) {
            extra["poster"] = still["attrs"]?["id"] ?? .null
        }
        if let w = facts.width { extra["width"] = .double(w) }
        if let h = facts.height { extra["height"] = .double(h) }
        return try addFile(data, name: name, mime: mime, vaultId: vaultId, model: model, duration: facts.duration, extra: extra, id: id)
    }

    func addFile(_ data: Data, name: String, mime: String, vaultId: String, model: AppModel, duration: Double? = nil, extra: [String: JSONValue] = [:], id given: String? = nil) throws -> JSONValue {
        let video = mime.hasPrefix("video/")
        let limit = video ? Self.maxVideoBytes : Self.maxFileBytes
        if data.count > limit {
            throw AddError.tooBig("\(name) is \(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file)). \(video ? "Videos" : "Files") can be up to \(ByteCountFormatter.string(fromByteCount: Int64(limit), countStyle: .file)).")
        }
        let id = given ?? UUID().uuidString.lowercased()
        try keep(id, data, vaultId: vaultId, model: model, pending: Pending(id: id, vaultId: vaultId, mime: mime, sealed: false, fileName: name, duration: duration))
        var attrs: [String: JSONValue] = ["id": .string(id), "name": .string(name), "mime": .string(mime), "size": .int(Int64(data.count))]
        if let duration { attrs["duration"] = .double(duration) }
        attrs.merge(extra) { _, new in new }
        return ["type": "file", "attrs": .object(attrs)]
    }

    private func keep(_ id: String, _ data: Data, vaultId: String, model: AppModel, pending item: Pending) throws {
        var item = item
        var stored = data
        if model.vault(vaultId)?.isEncrypted == true {
            guard let key = model.repo.keyring.key(vaultId) else { throw AddError.locked }
            stored = try AttachmentSeal.seal(
                data, id: id, vaultId: vaultId, key: key,
                facts: .init(mime: item.mime, size: data.count, name: item.fileName, width: item.width, height: item.height, duration: item.duration))
            item.sealed = true
        }
        try stored.write(to: file(id))
        pending.append(item)
        Task { await upload(model: model) }
    }

    /// Sends what's waiting, one at a time, until the server has them all or can't take more now.
    func upload(model: AppModel) async {
        guard !uploading else { return }
        uploading = true
        defer { uploading = false }
        for item in pending {
            guard let data = try? Data(contentsOf: file(item.id)) else {
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
            .overlay {
                if case .video = media { Image(systemName: "play.circle.fill").font(.title).foregroundStyle(.white).shadow(radius: 3) }
            }
            .overlay(alignment: .bottomTrailing) {
                if case .video(let file) = media, let d = file.duration {
                    Text(Doc.clipLength(d)).font(.caption2.weight(.semibold)).padding(3).background(.black.opacity(0.5)).foregroundStyle(.white).padding(4)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .task(id: media.id) {
                let id: String =
                    switch media {
                    case .photo(let id): id
                    case .video(let file): file.poster ?? Doc.posterId(file.id)
                    }
                if let data = await Attachments.shared.data(id, model: model) { image = PlatformImage(data: data) }
            }
    }
}

/// An entry's photos and videos under its text, opening full screen; its other files as chips.
struct BubbleAttachments: View {
    @Environment(AppModel.self) private var model
    @AppStorage("photoStyle") private var deviceStyle = "large"
    let card: Card
    @State private var viewing: String?

    var body: some View {
        let media = Doc.media(card.content)
        let files = Doc.files(card.content).filter { !$0.isVideo }
        // How photos show: large, small thumbnails, or a count that opens them; each entry can say for itself.
        let style = card.payload["preview"]?["photos"]?.stringValue ?? deviceStyle
        if !media.isEmpty, style == "off" {
            Button { viewing = media[0].id } label: { Label("\(media.count) \(media.count == 1 ? "photo" : "photos")", systemImage: "photo.on.rectangle") }
                .buttonStyle(.plain).font(.callout).foregroundStyle(Theme.accent).padding(.top, 4)
                .sheet(item: Binding(get: { viewing.map(OpenEntry.init) }, set: { viewing = $0?.id })) { start in
                    MediaViewer(media: media, start: start.id, vaultId: card.vaultId)
                }
        } else if !media.isEmpty {
            FlowLayout(spacing: 4) {
                ForEach(media) { m in
                    PhotoThumb(media: m, vaultId: card.vaultId, size: style == "thumbs" ? 64 : media.count == 1 ? 200 : 110)
                        .onTapGesture { viewing = m.id }
                        .contextMenu { PhotoMenu(id: m.id, card: card) }
                }
            }
            .padding(.top, 4)
            .sheet(item: Binding(get: { viewing.map(OpenEntry.init) }, set: { viewing = $0?.id })) { start in
                MediaViewer(media: media, start: start.id, vaultId: card.vaultId)
            }
        }
        ForEach(files) { file in FileChip(file: file, vaultId: card.vaultId) }
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

/// An attached file as a chip: a sound plays where it is; anything else opens in the app that reads it.
struct FileChip: View {
    @Environment(AppModel.self) private var model
    let file: Doc.FileInfo
    let vaultId: String
    @State private var opening = false

    var body: some View {
        if file.isAudio {
            VoicePlayer(file: file, vaultId: vaultId)
        } else {
            Button(action: open) {
                HStack(spacing: 6) {
                    Image(systemName: icon)
                    Text(file.name).lineLimit(1)
                    if let size = file.size { Text(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)).foregroundStyle(Theme.muted) }
                    if opening { ProgressView().controlSize(.small) }
                }
                .font(.callout)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunken))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
    }

    private var icon: String {
        let m = file.mime ?? ""
        if m == "application/pdf" { return "doc.richtext" }
        if m.hasPrefix("image/") { return "photo" }
        if m.contains("zip") { return "doc.zipper" }
        if m.contains("sheet") || m.contains("excel") || m.contains("csv") { return "tablecells" }
        return "doc"
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

/// Photos and videos full screen, paged through, a photo zoomed with a pinch or the wheel.
struct MediaViewer: View {
    @Environment(\.dismiss) private var dismiss
    let media: [Doc.Media]
    let start: String
    let vaultId: String
    @State private var current: String = ""

    var body: some View {
        NavigationStack {
            TabView(selection: $current) {
                ForEach(media) { m in
                    MediaPage(media: m, vaultId: vaultId).tag(m.id)
                }
            }
            #if os(iOS)
            .tabViewStyle(.page)
            #endif
            .background(.black)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .onAppear { current = start }
        #if os(macOS)
        .frame(minWidth: 700, minHeight: 520)
        #endif
    }
}

struct MediaPage: View {
    @Environment(AppModel.self) private var model
    let media: Doc.Media
    let vaultId: String
    @State private var image: PlatformImage?
    @State private var player: AVPlayer?
    @State private var scale: CGFloat = 1

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
                if let url = await Attachments.shared.fileURL(file.id, name: file.name, model: model) { player = AVPlayer(url: url) }
            }
        }
        .onDisappear { player?.pause() }
    }
}
