import NotesKit
import SwiftUI

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// An entry's menu, as the web app's: Edit, Tags…, Due date…, Make it a todo or a note, Color, Save as template,
/// Share…, View only, Vaults…, Take out of the stack, Archive and Move to Trash, each only where this account may.
struct EntryMenu: View {
    @Environment(AppModel.self) private var model
    let card: Card
    var revealHidden: () -> Void = {}

    var body: some View {
        let edit = model.canEdit(card)
        Button(edit ? "Edit" : "Open") { model.openEntry = card.id }
        if card.template {
            Button("Use this template") { model.startFrom(card) }
        }
        Button("Copy") { Clipboard.copyEntry(card, model: model) }
        if edit {
            Button("Tags…") { model.panel = .tags(card.id) }
            if card.type == .todo { Button("Due date…") { model.panel = .due(card.id) } }
            Button(card.type == .todo ? "Make it a note" : "Make it a todo") {
                let id = card.id
                let to: CardType = card.type == .todo ? .note : .todo
                model.perform { try await $0.retype(id, to: to) }
            }
            if card.type == .todo && !card.isDone {
                Button(card.waiting ? "No longer waiting" : "Waiting") {
                    let id = card.id
                    let on = !card.waiting
                    model.perform { try await $0.update(id) { $0.waiting = on } }
                }
            }
            Menu("Color") {
                Button("None") { setColor(nil) }
                ForEach(CardColor.allCases, id: \.self) { c in
                    Button { setColor(c) } label: { Label(Theme.colorName(c), systemImage: card.color == c ? "checkmark.circle.fill" : "circle.fill") }
                }
            }
        }
        #if os(iOS)
        // A phone's menu is short: the rarer items go one level down, so Archive and Move to Trash stay in reach.
        Menu("More") { more }
        #else
        more
        #endif
        if model.canManage(card) {
            Divider()
            Button(card.archived ? "Unarchive" : "Archive") { model.archive([card.id], !card.archived) }
            Button("Move to Trash", role: .destructive) { model.trash([card.id]) }
        }
    }

    @ViewBuilder
    private var more: some View {
        Divider()
        if Doc.previewLines(card.content, hidden: .mark).joined().contains(Doc.hideOpen) {
            Button("Show hidden words", action: revealHidden)
        }
        if !card.template && card.isEntry {
            Button("Save as template") { model.saveAsTemplate(card) }
        }
        if model.canManage(card) { Button("Share…") { model.panel = .share(card.id) } }
        if model.canWrite(card) && !model.viewOnly {
            Toggle("View only", isOn: Binding(get: { card.viewOnly }, set: { on in
                let id = card.id
                model.perform { try await $0.update(id) { $0.viewOnly = on } }
            }))
        }
        Divider()
        if model.canManage(card) { Button("Vaults…") { model.panel = .vaults(card.id) } }
        if let stack = model.index.stackOf[card.id], model.canEdit(card) {
            Button("Take out of the stack") {
                let id = card.id
                model.perform { try await $0.update(stack) { $0.stack = ($0.stack ?? []).filter { $0 != id } } }
            }
        }
    }

    private func setColor(_ color: CardColor?) {
        let id = card.id
        model.perform { try await $0.update(id) { $0.color = color } }
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
        let group = repo.action()
        perform { repo in for id in ids { try await repo.update(id, group: group) { $0.archived = on } } }
        say(on ? (ids.count == 1 ? "Archived" : "Archived \(ids.count) entries") : "Unarchived", undoable: true)
    }

    func trash(_ ids: [String]) {
        let group = repo.action()
        perform { repo in for id in ids { try await repo.setDeleted(id, true, group: group) } }
        say(ids.count == 1 ? "Moved to Trash" : "Moved \(ids.count) entries to Trash", undoable: true)
    }

    /// A copy under Templates, to start new entries from; the entry stays where it is.
    func saveAsTemplate(_ card: Card) {
        let source = card
        perform { repo in
            var extra: [String: JSONValue] = ["template": true]
            if let c = source.color { extra["color"] = .string(c.rawValue) }
            if source.type == .todo {
                try await repo.createTodo(title: source.title, content: source.content, pages: source.turnPages, tags: source.tags, vaultId: source.vaultId, extra: extra)
            } else {
                try await repo.createNote(title: source.title, content: source.content, pages: source.turnPages, tags: source.tags, vaultId: source.vaultId, extra: extra)
            }
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
            let card: Card
            if fields["type"] == "todo" {
                card = try await repo.createTodo(title: fields["title"]?.stringValue ?? "", content: fields["content"] ?? Doc.empty, pages: pages, tags: tags, vaultId: vault, extra: extra)
            } else {
                card = try await repo.createNote(title: fields["title"]?.stringValue ?? "", content: fields["content"] ?? Doc.empty, pages: pages, tags: tags, vaultId: vault, extra: extra)
            }
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

    /// An entry as Markdown, a todo as a checkbox line, so it pastes back whole.
    @MainActor
    static func copyEntry(_ card: Card, model: AppModel) {
        copy(Markdown.entry(card, index: model.index))
        model.say("Copied")
    }
}
