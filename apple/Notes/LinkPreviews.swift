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

/// An entry's web links under its bubble, as cards or one line each (three at most, the rest counted), by the device's
/// setting or the entry's own. Links in an encrypted vault aren't sent anywhere to preview, so they show their site.
struct BubbleLinks: View {
    @Environment(AppModel.self) private var model
    @AppStorage("linkStyle") private var deviceStyle = LinkStyle.card.rawValue
    let card: Card

    static func style(_ card: Card) -> LinkStyle {
        card.payload["preview"]?["links"]?.stringValue.flatMap(LinkStyle.init(rawValue:)) ?? LinkStyle(rawValue: UserDefaults.standard.string(forKey: "linkStyle") ?? "") ?? .card
    }

    static func urls(_ card: Card, model: AppModel) -> [String] {
        BubbleMemo.value(model, card, "links") { Doc.linkUrls(card.content).filter { !Doc.isImageUrl($0) } }
    }

    /// Whether an entry has links to show under it.
    static func has(_ card: Card, model: AppModel) -> Bool { style(card) != .off && !urls(card, model: model).isEmpty }

    var body: some View {
        let style = card.payload["preview"]?["links"]?.stringValue.flatMap(LinkStyle.init(rawValue:)) ?? LinkStyle(rawValue: deviceStyle) ?? .card
        let encrypted = model.vault(card.vaultId)?.isEncrypted != false
        let urls = Self.urls(card, model: model)
        if style != .off {
            ForEach(urls.prefix(3), id: \.self) { url in
                LinkCard(url: url, compact: style == .compact, previewing: !encrypted)
            }
            if urls.count > 3 {
                Text("and \(urls.count - 3) more links").font(.caption).foregroundStyle(Theme.muted).padding(.leading, 4)
            }
        }
    }
}

/// A link as a card opening in the browser, as the web app's `LinkCard`: the page's own title, description and image
/// when it can be previewed, or else its site and path. With `address`, its whole address shows under it, as the Links
/// page has it.
struct LinkCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let url: String
    var compact = false
    var previewing = true
    var address = false
    @State private var preview: LinkPreview?

    private var path: String {
        guard let u = URL(string: url) else { return "" }
        var p = (u.path(percentEncoded: false) + (u.query.map { "?" + $0 } ?? ""))
        if p.hasSuffix("/") { p.removeLast() }
        return p
    }

    var body: some View {
        Button { if let u = URL(string: url) { openURL(u) } } label: {
            if compact {
                HStack(spacing: 6) {
                    Image(systemName: "link").imageScale(.small)
                    Text(preview?.title ?? (path.isEmpty ? Doc.siteName(url) : Doc.siteName(url) + path)).foregroundStyle(Theme.text).fontWeight(.medium).lineLimit(1)
                    if preview?.title != nil { Text(preview?.site ?? Doc.siteName(url)).font(.caption).lineLimit(1) }
                }
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 10).padding(.vertical, 3)
                .background(Capsule().fill(Theme.surface)).overlay(Capsule().stroke(Theme.line))
            } else {
                let rich = preview?.title != nil
                HStack(alignment: rich ? .top : .center, spacing: 10) {
                    if let image = preview?.image.flatMap(URL.init(string:)) {
                        AsyncImage(url: image) { $0.resizable().scaledToFill() } placeholder: { Theme.sunken }
                            .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 8))
                    } else {
                        Image(systemName: "link").frame(width: 28, height: 28)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.sunken)).foregroundStyle(Theme.muted)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        if let t = preview?.title { Text(t).font(.subheadline.weight(.semibold)).lineLimit(2).foregroundStyle(Theme.text) }
                        if let d = preview?.description { Text(d).font(.caption).foregroundStyle(Theme.muted).lineLimit(2) }
                        if !address || !rich {
                            Text(preview?.site ?? Doc.siteName(url))
                                .font(rich ? .caption2.weight(.medium) : .footnote.weight(.semibold))
                                .foregroundStyle(rich ? Theme.muted : Theme.text)
                        }
                        if address {
                            Text(url.removingPercentEncoding ?? url).font(.caption).foregroundStyle(Theme.accent).lineLimit(2)
                        } else if !path.isEmpty && !rich {
                            Text(path).font(.caption).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.tail)
                        }
                    }
                    .multilineTextAlignment(.leading)
                }
                .padding(rich ? 8 : 0)
                .padding(.leading, rich ? 0 : 9).padding(.trailing, rich ? 0 : 12).padding(.vertical, rich ? 0 : 7)
                .frame(maxWidth: 440, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Open link") { if let u = URL(string: url) { openURL(u) } }
            Button("Copy link address") { Clipboard.copy(url) }
        }
        .task(id: url) { if previewing { preview = await LinkPreviews.shared.preview(url, api: model.api) } }
    }
}
