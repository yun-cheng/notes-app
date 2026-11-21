import NotesKit
import SwiftUI

/// Photos and files fetched from the server, kept on the device so each is fetched once.
@MainActor
final class AttachmentCache {
    static let shared = AttachmentCache()
    private var loading: [String: Task<Data?, Never>] = [:]
    private let folder: URL = {
        let f = URL.cachesDirectory.appending(path: "attachments", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: f, withIntermediateDirectories: true)
        return f
    }()

    func data(_ id: String, api: ServerAPI) async -> Data? {
        let file = folder.appending(path: id.replacingOccurrences(of: "/", with: "_"))
        if let data = try? Data(contentsOf: file) { return data }
        if let task = loading[id] { return await task.value }
        let task = Task<Data?, Never> {
            guard let data = try? await api.attachment(id) else { return nil }
            try? data.write(to: file)
            return data
        }
        loading[id] = task
        let data = await task.value
        loading[id] = nil
        return data
    }
}

#if os(macOS)
typealias PlatformImage = NSImage
extension Image {
    init(platform: PlatformImage) { self.init(nsImage: platform) }
}
#else
typealias PlatformImage = UIImage
extension Image {
    init(platform: PlatformImage) { self.init(uiImage: platform) }
}
#endif

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
            .overlay(alignment: .bottomTrailing) {
                if case .video(let file) = media {
                    Text(file.duration.map(Doc.clipLength) ?? "Video").font(.caption2.weight(.semibold)).padding(3).background(.black.opacity(0.5)).foregroundStyle(.white).padding(4)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .task(id: media.id) {
                let id: String = switch media {
                case .photo(let id): id
                case .video(let file): file.poster ?? Doc.posterId(file.id)
                }
                if let data = await AttachmentCache.shared.data(id, api: model.api) { image = PlatformImage(data: data) }
            }
    }
}

/// An entry's photos and videos under its text.
struct BubblePhotos: View {
    let card: Card

    var body: some View {
        let media = Doc.media(card.content)
        if !media.isEmpty {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)], spacing: 4) {
                ForEach(media) { PhotoThumb(media: $0, vaultId: card.vaultId) }
            }
            .frame(maxWidth: 360)
            .padding(.top, 4)
        }
    }
}
