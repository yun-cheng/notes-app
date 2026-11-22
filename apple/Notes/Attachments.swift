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
        return Doc.photoNode(id)
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
                // Three pixels a point, for the size it's shown at; a grid cell when it fills its space.
                image = await Attachments.shared.thumbnail(id, pixels: Int((size ?? 200) * 3), model: model)
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
        let media = BubbleMemo.value(model, card, "media") { Doc.media(card.content) }
        let files = BubbleMemo.value(model, card, "files") { Doc.files(card.content).filter { !$0.isVideo } }
        // How photos show: large, small thumbnails, or a count that opens them; each entry can say for itself.
        let style = card.payload["preview"]?["photos"]?.stringValue ?? deviceStyle
        Group {
        if !media.isEmpty, style == "off" {
            Button { viewing = media[0].id } label: { Label("\(media.count) \(media.count == 1 ? "photo" : "photos")", systemImage: "photo.on.rectangle") }
                .buttonStyle(.plain).font(.callout).foregroundStyle(Theme.accent).padding(.top, 4)
        } else if !media.isEmpty {
            FlowLayout(spacing: 4) {
                ForEach(media) { m in
                    PhotoThumb(media: m, vaultId: card.vaultId, size: style == "thumbs" ? 64 : media.count == 1 ? 200 : 110)
                        .onTapGesture { viewing = m.id }
                        .contextMenu {
                            PhotoMenu(id: m.id, card: card)
                            PublicLinkMenu(id: m.id, vaultId: card.vaultId)
                        }
                }
            }
            .padding(.top, 4)
        }
        }
        .sheet(id: $viewing) { start in MediaViewer(media: media, start: start, vaultId: card.vaultId) }
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
                    Image(systemName: file.symbol)
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
            .focusable()
            .focusEffectDisabled()
            .onKeyPress(.leftArrow) { step(-1) }
            .onKeyPress(.rightArrow) { step(1) }
            .onKeyPress(.escape) {
                dismiss()
                return .handled
            }
        }
        .onAppear { current = start }
        #if os(macOS)
        .frame(minWidth: 700, minHeight: 520)
        #endif
    }
}

extension MediaViewer {
    /// The previous or next photo, round from the last to the first.
    func step(_ by: Int) -> KeyPress.Result {
        guard let at = media.firstIndex(where: { $0.id == current }), !media.isEmpty else { return .ignored }
        current = media[(at + by + media.count) % media.count].id
        return .handled
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
            : Doc.photoNode(a.id)
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
                trash.removeAll { $0.id == a.id }
                model.say("Deleted for good")
            case .needsDrive?: model.say("Connect Google Drive to delete it from there too.")
            case .inUse?: model.say("An entry holds it again, so it stays.")
            default: model.say("It couldn't be deleted now. Try again.")
            }
        }
    }
}

/// Photos and files taken out of every entry, at the top of the Trash: each with the entry it was in and the days
/// left, to put back or delete for good.
struct TrashedAttachments: View {
    @Environment(AppModel.self) private var model
    @State private var confirming: StoredAttachment?

    var body: some View {
        let items = AttachmentKeeper.shared.trash
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Photos and files").font(.headline)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(items) { a in
                            VStack(alignment: .leading, spacing: 4) {
                                if a.isFile {
                                    Label(a.name ?? "File", systemImage: Doc.fileSymbol(mime: a.mime))
                                        .lineLimit(1).frame(width: 120, height: 80).background(RoundedRectangle(cornerRadius: 8).fill(Theme.sunken))
                                } else {
                                    PhotoThumb(media: .photo(a.id), vaultId: a.vault_id, size: 120)
                                }
                                Text(a.trashed_from.flatMap { model.card($0) }.map { "From “\($0.displayTitle)”" } ?? "From an entry").font(.caption).lineLimit(1).frame(width: 120, alignment: .leading)
                                let left = a.daysLeft(now: Repository.milliseconds())
                                Text(left == 0 ? "Deleted at the next check" : left == 1 ? "1 day left" : "\(left) days left").font(.caption2).foregroundStyle(Theme.muted)
                                if model.vault(a.vault_id).map({ $0.role != .viewer }) ?? false {
                                    HStack {
                                        Button("Restore") { AttachmentKeeper.shared.putBack(a, model: model) }
                                        Button(role: .destructive) { confirming = a } label: { Image(systemName: "trash") }.accessibilityLabel("Delete for good")
                                    }
                                    .buttonStyle(.borderless).font(.caption)
                                }
                            }
                        }
                    }
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
}
