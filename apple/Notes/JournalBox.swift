import NotesKit
import SwiftUI

/// The box at the foot of the journal, as the web app's `JournalBox`: `[]` makes a todo, `#tag` files it, `#diary`
/// sends it to the Diary vault, and `@fri @3pm @weekly` give a todo its date, time and repeat. Return saves on a
/// computer, Shift-Return starts a new line; on a phone Return is a new line and the arrow saves. What's typed but not
/// saved is kept as a draft, one for each view of the journal.
struct JournalBox: View {
    @Environment(AppModel.self) private var model
    let filter: StreamFilter
    @State private var text = ""
    @State private var todos = false
    @State private var unlock: Vault?
    @FocusState private var focused: Bool

    private var draftKey: String { "draft:" + String(describing: filter.with { $0.sort = .written }) }

    var body: some View {
        VStack(spacing: 6) {
            if let unlock {
                UnlockView(vault: unlock).frame(maxHeight: 260)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button { todos.toggle() } label: {
                    Image(systemName: todos ? "checkmark.circle.fill" : "checkmark.circle")
                        .font(.title3)
                        .foregroundStyle(todos ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)
                .help(todos ? "Every line is a todo" : "Write todos")
                .accessibilityLabel("Todos")
                TextField(placeholder, text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($focused)
                    #if os(macOS)
                    .onKeyPress(.return, phases: .down) { press in
                        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) {
                            text += "\n"
                            return .handled
                        }
                        send()
                        return .handled
                    }
                    #endif
                    .padding(.vertical, 6)
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.semibold))
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Theme.sunken : Theme.accent))
                        .foregroundStyle(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Theme.muted : Theme.onAccent)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel("Save")
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 22).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(focused ? Theme.accent : Theme.line))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .background(Theme.bg)
        .onAppear {
            text = UserDefaults.standard.string(forKey: draftKey) ?? ""
            todos = filter.effectiveType == .todo
        }
        .onChange(of: text) { _, t in
            if t.isEmpty { UserDefaults.standard.removeObject(forKey: draftKey) } else { UserDefaults.standard.set(t, forKey: draftKey) }
        }
        .onChange(of: model.focusBox) { focused = true }
        .onChange(of: model.lockedVaults) { _, locked in
            if let v = unlock, !locked.contains(v.id) {
                unlock = nil
                send()
            }
        }
    }

    private var placeholder: String {
        todos ? "Write a todo · @fri · #tag" : "Write a note · [] todo · #tag"
    }

    private func send() {
        let typed = text
        guard !typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let entries = EntryParser.parseEntries(typed, today: model.today, allTodos: todos)
        let opts = SaveOptions(journal: filter, today: model.today)
        Task {
            switch await model.save(entries, opts) {
            case .saved(let ids, _):
                if text == typed { text = "" }
                // Once the stream has it, so there's somewhere to scroll to.
                await model.refresh()
                model.lastSaved = ids.last
            case .unlock(let vaultId):
                unlock = model.vault(vaultId)
            case .nothing:
                break
            }
        }
    }
}

/// What can be done to entries picked together, as the web app's `BatchBar`: tag them, finish them, date them,
/// archive or trash them.
struct BatchBar: View {
    @Environment(AppModel.self) private var model
    @Binding var picked: Set<String>
    let all: [String]

    var body: some View {
        let cards = picked.compactMap { model.card($0) }
        HStack(spacing: 12) {
            Text("\(picked.count) picked").fontWeight(.semibold)
            Button("All") { picked = Set(all) }
            Spacer()
            Menu("Tag") {
                ForEach(tagsForAll(model.index.tags, vaultIds: Array(Set(cards.map(\.vaultId))), model.sharedInto)) { tag in
                    Button(tag.displayTitle) { tagAll(tag.id) }
                }
            }
            if cards.contains(where: { $0.type == .todo && !$0.isDone }) {
                Button("Done") {
                    let group = model.repo.action()
                    let today = model.today
                    let ids = cards.filter { $0.type == .todo && !$0.isDone }.map(\.id)
                    model.perform { repo in for id in ids { try await repo.setDone(id, true, today: today, group: group) } }
                    model.say("Done", undoable: true)
                }
            }
            Button("Stack") { stack(cards) }.disabled(cards.count < 2)
            Button("Copy") {
                Clipboard.copy(Markdown.entries(cards.sorted { $0.createdAt < $1.createdAt }, index: model.index))
                model.say("Copied \(cards.count)")
            }
            Button("Archive") {
                model.archive(Array(picked), true)
                picked = []
            }
            Button("Trash", role: .destructive) {
                model.trash(Array(picked))
                picked = []
            }
            Button { picked = [] } label: { Image(systemName: "xmark") }.accessibilityLabel("Stop picking")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.surface)
        .overlay(alignment: .top) { Theme.line.frame(height: 1) }
    }

    private func tagAll(_ tagId: String) {
        let group = model.repo.action()
        let groups = model.index.tagGroups
        let ids = Array(picked)
        model.perform { repo in for id in ids { try await repo.update(id, group: group) { $0.tags = groups.with($0.tags, tagId) } } }
        model.say("Tagged \(ids.count)", undoable: true)
    }

    /// A new stack of the picked entries, or, with a stack among them, into that one.
    private func stack(_ cards: [Card]) {
        let ordered = cards.sorted { $0.createdAt < $1.createdAt }
        let stacks = model.index.live.filter(\.isStack)
        let into = ordered.first(where: \.isStack)
        let ids = ordered.map(\.id)
        let vault = ordered.first?.vaultId
        let group = model.repo.action()
        model.perform { repo in
            let target: Card
            if let into { target = into } else { target = try await repo.createNote(stack: [], vaultId: vault, group: group) }
            for (stackId, list) in stackPlan(ids, into: target, stacks: stacks + [target]) {
                try await repo.update(stackId, group: group) { $0.stack = list }
            }
        }
        picked = []
        model.say("Stacked \(ids.count)", undoable: true)
    }
}
