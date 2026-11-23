import NotesKit
import SwiftUI

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// An entry's menu, as the web app's, in its order: what opens it (Edit, Use this template); what it is (Tags…, Due
/// date…, Make it a todo or a note); its color, as a row of swatches; what's done with it (Translate, Save as template,
/// Share…, View only); where it goes (Vaults…, Take out of the stack); then Archive and Move to Trash. Each only where
/// this account may.
struct EntryMenu: View {
    @Environment(AppModel.self) private var model
    let card: Card
    var revealHidden: () -> Void = {}

    var body: some View {
        if card.deleted { trashed } else { menu }
    }

    /// In the Trash, an entry is only restored or copied.
    @ViewBuilder
    private var trashed: some View {
        if model.canWrite(card) {
            Button {
                let id = card.id
                model.perform { try await $0.setDeleted(id, false) }
                model.say("Restored", undoable: true)
            } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
        }
        Button { Clipboard.copyEntry(card, model: model) } label: { Label("Copy", systemImage: "square.on.square") }
    }

    @ViewBuilder
    private var menu: some View {
        let edit = model.canEdit(card)
        Section {
            Button { model.openEntry = card.id } label: { Label(edit ? "Edit" : "Open", systemImage: edit ? "pencil" : "arrow.up.forward.square") }
            if card.template && !model.viewOnly {
                Button { model.startFrom(card) } label: { Label("Use this template", systemImage: "doc.on.doc") }
            }
            if edit {
                Button { model.panel = .tags(card.id) } label: { Label("Tags…", systemImage: "tag") }
                if card.type == .todo { Button { model.panel = .due(card.id) } label: { Label("Due date…", systemImage: "calendar") } }
                Button {
                    let id = card.id
                    let to: CardType = card.type == .todo ? .note : .todo
                    model.perform { try await $0.retype(id, to: to) }
                } label: { Label(card.type == .todo ? "Make it a note" : "Make it a todo", systemImage: card.type == .todo ? "doc.text" : "checkmark.square") }
            }
        }
        if edit {
            Section("Color") {
                Picker("Color", selection: Binding(get: { card.color.map { $0.rawValue } ?? "" }, set: { setColor(CardColor(rawValue: $0)) })) {
                    Image(platform: Swatch.image(nil)).tag("")
                    ForEach(CardColor.allCases, id: \.self) { c in Image(platform: Swatch.image(c)).tag(c.rawValue).accessibilityLabel(Theme.colorName(c)) }
                }
                .pickerStyle(.palette)
            }
        }
        Section {
            if case .done(let kept)? = Translations.shared.states[card.id] {
                Button { Translations.shared.show(card.id, !kept.shown) } label: {
                    Label(kept.shown ? "Show original" : "Show in \(Locale.current.localizedString(forLanguageCode: kept.to) ?? kept.to)", systemImage: "translate")
                }
            } else {
                Button { Translations.shared.translate(card, model: model) } label: { Label("Translate", systemImage: "translate") }
            }
            if Doc.previewLines(card.content, hidden: .mark).joined().contains(Doc.hideOpen) {
                Button(action: revealHidden) { Label("Show hidden words", systemImage: "eye") }
            }
            if !card.template && card.isEntry && edit {
                Button { model.saveAsTemplate(card) } label: { Label("Save as template", systemImage: "doc.on.doc") }
            }
            if model.canManage(card) { Button { model.panel = .share(card.id) } label: { Label("Share…", systemImage: "square.and.arrow.up") } }
            if model.canWrite(card) && !model.viewOnly {
                Toggle(isOn: Binding(get: { card.viewOnly }, set: { on in model.update(card.id) { $0.viewOnly = on } })) { Label("View only", systemImage: "eye") }
            }
        }
        Section {
            if model.canManage(card) { Button { model.panel = .vaults(card.id) } label: { Label("Vaults…", systemImage: "tray.2") } }
            if let stack = model.index.stackOf[card.id], model.canEdit(card) {
                Button {
                    let id = card.id
                    model.update(stack) { $0.stack = ($0.stack ?? []).filter { $0 != id } }
                } label: { Label("Take out of the stack", systemImage: "square.stack") }
            }
        }
        if model.canManage(card) {
            Section {
                Button { model.archive([card.id], !card.archived) } label: { Label(card.archived ? "Unarchive" : "Archive", systemImage: "archivebox") }
                Button(role: .destructive) { model.trash([card.id]) } label: { Label("Move to Trash", systemImage: "trash") }
            }
        }
    }

    /// One entry's own preview style; what it leaves out follows the device's setting.
    private func setPreview(_ key: String, _ value: String) {
        let id = card.id
        model.perform {
            try await $0.update(id) { c in
                var preview = c.payload["preview"]?.objectValue ?? [:]
                if value.isEmpty { preview.removeValue(forKey: key) } else { preview[key] = .string(value) }
                if preview.isEmpty { c.payload.removeValue(forKey: "preview") } else { c.payload["preview"] = .object(preview) }
            }
        }
    }

    private func setColor(_ color: CardColor?) {
        model.update(card.id) { $0.color = color }
    }
}

/// The color swatches the menus show: a filled circle in each tint, or one struck through for none, drawn as images so
/// a menu keeps their colors.
@MainActor
enum Swatch {
    private static var made: [String: PlatformImage] = [:]

    static func image(_ color: CardColor?) -> PlatformImage {
        let key = color?.rawValue ?? "none"
        if let hit = made[key] { return hit }
        let size = CGSize(width: 18, height: 18)
        func draw(_ ctx: CGContext) {
            let r = CGRect(origin: .zero, size: size).insetBy(dx: 1, dy: 1)
            if let color {
                ctx.setFillColor(PlatformColor(Theme.tint(color)).cgColor)
                ctx.fillEllipse(in: r)
            } else {
                ctx.setStrokeColor(PlatformColor.gray.cgColor)
                ctx.setLineWidth(1.5)
                ctx.strokeEllipse(in: r.insetBy(dx: 0.5, dy: 0.5))
                ctx.setStrokeColor(PlatformColor(Theme.alert).cgColor)
                ctx.move(to: CGPoint(x: r.minX + 3, y: r.maxY - 3))
                ctx.addLine(to: CGPoint(x: r.maxX - 3, y: r.minY + 3))
                ctx.strokePath()
            }
        }
        #if os(macOS)
        let image = NSImage(size: size, flipped: false) { _ in
            if let ctx = NSGraphicsContext.current?.cgContext { draw(ctx) }
            return true
        }
        image.isTemplate = false
        #else
        let image = UIGraphicsImageRenderer(size: size).image { draw($0.cgContext) }.withRenderingMode(.alwaysOriginal)
        #endif
        made[key] = image
        return image
    }
}

/// The panels an entry's menu opens into.
enum EntryPanel: Identifiable, Hashable {
    case tags(String)
    case due(String)
    case vaults(String)
    case share(String)
    case history(String)

    var id: String {
        switch self {
        case .tags(let i): "tags:\(i)"
        case .due(let i): "due:\(i)"
        case .vaults(let i): "vaults:\(i)"
        case .share(let i): "share:\(i)"
        case .history(let i): "history:\(i)"
        }
    }
}

extension AppModel {
    /// Archives or unarchives entries together, as one action to undo.
    func archive(_ ids: [String], _ on: Bool) {
        performEach(ids, say: on ? (ids.count == 1 ? "Archived" : "Archived \(ids.count) entries") : "Unarchived") { repo, id, group in
            try await repo.update(id, group: group) { $0.archived = on }
        }
    }

    func trash(_ ids: [String]) {
        performEach(ids, say: ids.count == 1 ? "Moved to Trash" : "Moved \(ids.count) entries to Trash") { repo, id, group in
            try await repo.setDeleted(id, true, group: group)
        }
    }

    /// A copy under Templates, to start new entries from; the entry stays where it is.
    func saveAsTemplate(_ card: Card) {
        let source = card
        perform { repo in
            var extra: [String: JSONValue] = ["template": true]
            if let c = source.color { extra["color"] = .string(c.rawValue) }
            try await repo.createEntry(
                todo: source.type == .todo, title: source.title, content: source.content, pages: source.turnPages, tags: source.tags, vaultId: source.vaultId,
                extra: extra)
        }
        say("Saved as a template", undoable: true)
    }

    /// A new entry from a template: its words with the date filled in and its checklists unticked.
    func startFrom(_ template: Card) {
        let fields = template.fromTemplate(today: today)
        let vault = template.vaultId
        perform { repo in
            let tags = fields["tags"]?.arrayValue?.compactMap(\.stringValue) ?? []
            let pages = fields["pages"]?.arrayValue ?? []
            var extra: [String: JSONValue] = [:]
            if let c = fields["color"] { extra["color"] = c }
            if let p = fields["preview"] { extra["preview"] = p }
            let card = try await repo.createEntry(
                todo: fields["type"] == "todo", title: fields["title"]?.stringValue ?? "", content: fields["content"] ?? Doc.empty, pages: pages, tags: tags,
                vaultId: vault, extra: extra)
            await MainActor.run { self.openEntry = card.id }
        }
    }
}

/// The system clipboard.
enum Clipboard {
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }

    /// An entry as the device's copy style says, as on the web: rich text (formatted for apps like Mail, with the
    /// Markdown beside it as its plain text, so it pastes back whole), Markdown, or just its words.
    @MainActor
    static func copyEntry(_ card: Card, model: AppModel) {
        let style = UserDefaults.standard.string(forKey: "copyStyle") ?? "rich"
        let markdown = Markdown.entry(card, index: model.index)
        switch style {
        case "plain": copy(Markdown.words(card, index: model.index))
        case "markdown": copy(markdown)
        default: copyRich(markdown)
        }
        model.say("Copied")
    }

    /// Markdown as formatted text, with the Markdown itself as the plain text beside it.
    static func copyRich(_ markdown: String) {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard let parsed = try? AttributedString(markdown: markdown, options: options) else { return copy(markdown) }
        let attributed = NSAttributedString(parsed)
        guard let rtf = try? attributed.data(from: NSRange(location: 0, length: attributed.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]) else { return copy(markdown) }
        #if os(macOS)
        let board = NSPasteboard.general
        board.clearContents()
        board.declareTypes([.rtf, .string], owner: nil)
        board.setData(rtf, forType: .rtf)
        board.setString(markdown, forType: .string)
        #else
        UIPasteboard.general.items = [["public.rtf": rtf, "public.utf8-plain-text": markdown]]
        #endif
    }
}
