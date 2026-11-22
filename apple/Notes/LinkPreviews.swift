import NotesKit
import SwiftUI

/// Link previews kept on the device for a week, as the web app's `useLinkPreview` (a page that gave nothing is asked
/// again after an hour). Links in encrypted vaults are never previewed, so those addresses don't leave the device.
@MainActor
final class LinkPreviews {
    static let shared = LinkPreviews()
    private struct Kept: Codable {
        var preview: LinkPreview?
        var at: Date
    }
    private var kept: [String: Kept] = (try? JSONDecoder().decode([String: Kept].self, from: UserDefaults.standard.data(forKey: "linkPreviews") ?? Data())) ?? [:]
    private var asking: Set<String> = []

    func preview(_ url: String, api: ServerAPI) async -> LinkPreview? {
        if let k = kept[url], Date().timeIntervalSince(k.at) < (k.preview == nil ? 3600 : 7 * 86400) { return k.preview }
        guard !asking.contains(url) else { return nil }
        asking.insert(url)
        defer { asking.remove(url) }
        let preview = try? await api.unfurl(url)
        let useful = preview.flatMap { $0.title == nil && $0.description == nil && $0.image == nil ? nil : $0 }
        kept[url] = Kept(preview: useful, at: Date())
        if kept.count > 500 { kept = kept.filter { Date().timeIntervalSince($0.value.at) < 7 * 86400 } }
        UserDefaults.standard.set(try? JSONEncoder().encode(kept), forKey: "linkPreviews")
        return useful
    }
}

/// How link previews show: a card, one line, or not at all; each entry can override the device's setting.
enum LinkStyle: String, CaseIterable { case card, compact, off }

/// An entry's link previews under its text.
struct BubbleLinks: View {
    @Environment(AppModel.self) private var model
    @AppStorage("linkStyle") private var deviceStyle = LinkStyle.card.rawValue
    let card: Card

    var body: some View {
        let style = card.payload["preview"]?["links"]?.stringValue.flatMap(LinkStyle.init(rawValue:)) ?? LinkStyle(rawValue: deviceStyle) ?? .card
        let encrypted = model.vault(card.vaultId)?.isEncrypted == true
        if style != .off, !encrypted {
            ForEach(BubbleMemo.value(model, card, "links") { Array(Doc.linkUrls(card.content).filter { !Doc.isImageUrl($0) }.prefix(3)) }, id: \.self) { url in
                LinkCard(url: url, compact: style == .compact)
            }
        }
    }
}

struct LinkCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let url: String
    let compact: Bool
    @State private var preview: LinkPreview?

    var body: some View {
        Group {
            if let preview {
                Button { if let u = URL(string: url) { openURL(u) } } label: {
                    if compact {
                        Label(preview.title ?? Doc.siteName(url), systemImage: "link").lineLimit(1).font(.callout)
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            if let image = preview.image.flatMap(URL.init(string:)) {
                                AsyncImage(url: image) { $0.resizable().scaledToFill() } placeholder: { Theme.sunken }
                                    .frame(height: 140).frame(maxWidth: .infinity).clipped()
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(preview.site ?? Doc.siteName(url)).font(.caption).foregroundStyle(Theme.muted)
                                if let t = preview.title { Text(t).font(.callout.weight(.semibold)).lineLimit(2) }
                                if let d = preview.description { Text(d).font(.caption).foregroundStyle(Theme.muted).lineLimit(2) }
                            }
                            .padding(.horizontal, 10)
                            .padding(.bottom, 8)
                            .padding(.top, preview.image == nil ? 8 : 0)
                        }
                        .frame(width: 300, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                    }
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button("Open link") { if let u = URL(string: url) { openURL(u) } }
                    Button("Copy link address") { Clipboard.copy(url) }
                }
            }
        }
        .task(id: url) { preview = await LinkPreviews.shared.preview(url, api: model.api) }
    }
}
