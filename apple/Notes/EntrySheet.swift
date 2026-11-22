import NotesKit
import SwiftUI

/// An entry opened to read or change, over the page it was opened from, as the web app's sheet at `/journal/:id`:
/// a todo's title and checkbox, the text, its pages, tags, due date and vaults, and its links.
struct EntrySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var page = 0
    @State private var title = ""
    /// The title as last taken from the card: the field differs from it only once something is typed there.
    @State private var opened = ""

    var body: some View {
        NavigationStack {
            if let card = model.card(id) {
                content(card)
            } else {
                ContentUnavailableView("Not here", systemImage: "questionmark.square.dashed", description: Text("This entry isn't on this device, or its vault is locked."))
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 560, idealWidth: 640, minHeight: 480, idealHeight: 620)
        #endif
    }

    @ViewBuilder
    private func content(_ card: Card) -> some View {
        let edit = model.canEdit(card)
        // Its pages, and a blank one being added: kept only once something is written on it.
        let stored = [card.content] + card.morePages
        let pages = stored + Array(repeating: Doc.empty, count: max(0, page + 1 - stored.count))
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if card.viewOnly || !model.canWrite(card) {
                    Label(card.viewOnly ? "View only. Turn it off in the entry's menu to change it." : "You can view this entry.", systemImage: "lock.doc")
                        .font(.callout).foregroundStyle(Theme.muted)
                }
                if card.type == .todo {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        TodoCheck(card: card)
                        TextField("Todo", text: $title, axis: .vertical)
                            .font(.title3.weight(.semibold))
                            .textFieldStyle(.plain)
                            .disabled(!edit)
                            .onSubmit { saveTitle(card) }
                    }
                    TodoDates(card: card)
                } else if card.isStack || !card.title.isEmpty {
                    TextField(card.isStack ? "Stack" : "Title", text: $title)
                        .font(.title3.weight(.semibold))
                        .textFieldStyle(.plain)
                        .disabled(!edit)
                        .onSubmit { saveTitle(card) }
                }
                if pages.count > 1 || page > 0 {
                    Picker("Page", selection: $page) {
                        ForEach(pages.indices, id: \.self) { Text("Page \($0 + 1)").tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                DocEditor(content: pages[page], editable: edit, titleOf: model.index.titleOf) { doc in
                    savePage(card.id, page, doc)
                }
                .frame(minHeight: 240)
                .id("\(card.id):\(page)")
                if card.isStack { StackPreview(stack: card) }
                BubbleTags(card: card)
                Backlinks(card: card)
                CommentsSection(card: card)
            }
            .padding(20)
        }
        .pageBackground()
        .navigationTitle(card.type == .todo ? "Todo" : card.isStack ? "Stack" : "Note")
        .onAppear {
            title = card.title
            opened = card.title
        }
        // Renamed elsewhere while open: the field follows, unless something was typed in it.
        .onChange(of: card.title) { _, renamed in
            if title == opened { title = renamed }
            opened = renamed
        }
        .onDisappear { saveTitle(card) }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    saveTitle(card)
                    dismiss()
                }
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if edit {
                    Button { model.panel = .tags(card.id) } label: { Label("Tags", systemImage: "tag") }
                    Button { page = pages.count } label: { Label("Add a page", systemImage: "doc.badge.plus") }
                }
                Button { model.panel = .history(card.id) } label: { Label("History", systemImage: "clock.arrow.circlepath") }
                Menu { EntryMenu(card: card) } label: { Label("More", systemImage: "ellipsis.circle") }
            }
        }
    }

    private func saveTitle(_ card: Card) {
        // Only what was typed here: a title it opened with mustn't undo a rename made elsewhere since.
        guard model.canEdit(card), title != opened, title != card.title else { return }
        let t = title
        model.update(card.id, typed: true) { $0.title = t }
    }

    private func savePage(_ id: String, _ page: Int, _ doc: JSONValue) {
        model.perform { repo in
            try await repo.update(id, typed: true) { card in
                if page == 0 {
                    card.content = doc
                } else {
                    var more = card.morePages
                    while more.count < page { more.append(Doc.empty) }
                    more[page - 1] = doc
                    card.morePages = more
                }
            }
        }
    }
}

/// A todo's due date, time, start and repeat, and Waiting.
struct TodoDates: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        let edit = model.canEdit(card)
        HStack(spacing: 10) {
            DueLabel(card: card).font(.callout)
            if card.due == nil && !(card.waiting && !card.isDone) { Text("No due date").font(.callout).foregroundStyle(Theme.muted) }
            Spacer()
            if edit { Button("Change…") { model.panel = .due(card.id) }.buttonStyle(.borderless) }
        }
    }
}

/// What links here and what's tagged with it.
struct Backlinks: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        let links = model.index.backlinks[card.id] ?? []
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(card.type == .tag ? "Tagged" : "Linked from").font(.headline)
                ForEach(links.prefix(30), id: \.from.id) { link in
                    Button(link.from.displayTitle) { model.openEntry = link.from.id }.buttonStyle(.borderless)
                }
            }
            .padding(.top, 8)
        }
    }
}

/// The panels an entry's menu opens: its tags, due date, vaults and sharing.
struct EntryPanelView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let panel: EntryPanel

    var body: some View {
        NavigationStack {
            Group {
                switch panel {
                case .tags(let id): TagPicker(id: id)
                case .due(let id): DuePicker(id: id)
                case .vaults(let id): VaultPicker(id: id)
                case .share(let id): SharePanel(id: id)
                case .history(let id): EntryHistory(id: id)
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 380, minHeight: 420)
        #endif
    }
}

/// Picks an entry's tags: those offered in its vault, a group's tags by its rule, and a new one typed in.
struct TagPicker: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var query = ""

    var body: some View {
        if let card = model.card(id) {
            let offered = tagsFor(model.index.tags, vaultId: card.vaultId, model.sharedInto)
            let groups = model.index.tagGroups
            let shown = offered.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
            List {
                Section {
                    TextField("Find or make a tag", text: $query)
                        .onSubmit { make(card) }
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty, tagNamed(query, in: offered, vaultId: card.vaultId, model.sharedInto) == nil, !groups.isGroupName(query) {
                        Button("Make “\(query.trimmingCharacters(in: .whitespaces))”") { make(card) }
                    }
                }
                ForEach(groups.groups) { group in
                    let members = group.members.filter { m in shown.contains { $0.id == m.id } }
                    if !members.isEmpty {
                        Section(group.title + (group.choosesOne ? " (one)" : "")) {
                            ForEach(members) { tag in row(tag, card) { tags in group.pick(tags, card.tags.contains(tag.id) && group.choosesOne ? nil : tag.id) } }
                        }
                    }
                }
                Section("Tags") {
                    ForEach(shown.filter { groups.groupOf[$0.id] == nil }) { tag in
                        row(tag, card) { tags in tags.contains(tag.id) ? tags.filter { $0 != tag.id } : tags + [tag.id] }
                    }
                }
            }
            .navigationTitle("Tags")
        }
    }

    private func row(_ tag: Card, _ card: Card, change: @escaping ([String]) -> [String]) -> some View {
        Button {
            let next = change(card.tags)
            model.update(card.id) { $0.tags = next }
        } label: {
            HStack {
                Text(tag.displayTitle)
                Spacer()
                if card.tags.contains(tag.id) { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func make(_ card: Card) {
        let name = query.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard !name.isEmpty else { return }
        if let existing = tagNamed(name, in: model.index.tags, vaultId: card.vaultId, model.sharedInto) {
            let id = card.id
            let groups = model.index.tagGroups
            model.update(id) { $0.tags = groups.with($0.tags, existing.id) }
        } else {
            let id = card.id
            let vault = card.vaultId
            model.perform { repo in
                let group = repo.action()
                let tag = try await repo.createTag(title: name, vaultId: vault, group: group)
                try await repo.update(id, group: group) { $0.tags = $0.tags + [tag.id] }
            }
        }
        query = ""
    }
}

/// A todo's due date, time, start, repeat and Waiting.
struct DuePicker: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        if let card = model.card(id) {
            Form {
                Section {
                    Toggle("Due date", isOn: Binding(get: { card.due != nil }, set: { on in
                        set { c in
                            if on {
                                c.due = model.today
                            } else {
                                // Taking the date off takes the time and repeat with it.
                                c.due = nil
                                c.payload.removeValue(forKey: "dueTime")
                                c.payload.removeValue(forKey: "repeat")
                            }
                        }
                    }))
                    if let due = card.due {
                        DatePicker("Due", selection: Binding(get: { DateKey.date(due) ?? Date() }, set: { d in set { $0.due = DateKey.of(d) } }), displayedComponents: .date)
                        HStack {
                            ForEach([("Today", 0), ("Tomorrow", 1), ("Next week", 7)], id: \.0) { label, days in
                                Button(label) { set { $0.due = DateKey.adding(days, to: model.today) } }.buttonStyle(.bordered)
                            }
                        }
                        Toggle("At a time", isOn: Binding(get: { card.dueTime != nil }, set: { on in set { $0.dueTime = on ? "09:00" : nil } }))
                        if let time = card.dueTime {
                            DatePicker("Time", selection: Binding(get: { Self.date(time) }, set: { d in set { $0.dueTime = TimeKey.of(d) } }), displayedComponents: .hourAndMinute)
                        }
                        Picker("Repeat", selection: Binding(get: { card.repeat }, set: { r in set { $0.repeat = r } })) {
                            Text("Never").tag(Repeat?.none)
                            ForEach(Repeat.choices, id: \.self) { Text($0.label).tag(Optional($0)) }
                            if let r = card.repeat, !Repeat.choices.contains(r) { Text(r.label).tag(Optional(r)) }
                        }
                        Toggle("Starts on a day", isOn: Binding(get: { card.start != nil }, set: { on in set { $0.start = on ? (card.due.map { min($0, model.today) } ?? model.today) : nil } }))
                        if let start = card.start {
                            DatePicker("Start", selection: Binding(get: { DateKey.date(start) ?? Date() }, set: { d in set { $0.start = DateKey.of(d) } }), in: ...(DateKey.date(due) ?? .distantFuture), displayedComponents: .date)
                        }
                    }
                }
                Section {
                    Toggle("Waiting on someone or something", isOn: Binding(get: { card.waiting }, set: { on in set { $0.waiting = on } }))
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Due date")
        }
    }

    static func date(_ time: String) -> Date {
        let p = time.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 9, minute: p.last ?? 0, second: 0, of: Date()) ?? Date()
    }

    private func set(_ change: @escaping @Sendable (inout Card) -> Void) {
        model.update(id, change)
    }
}

/// Which vaults an entry is in: it lives in one, and can be shared into others.
struct VaultPicker: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        if let card = model.card(id) {
            List {
                Section("Lives in") {
                    ForEach(model.vaults.filter { $0.role != .viewer && !$0.isWithheld }) { vault in
                        Button {
                            let id = card.id
                            let target = vault.id
                            model.perform { try await $0.move(id, toVault: target) }
                        } label: {
                            HStack {
                                Text(vault.name)
                                Spacer()
                                if card.vaultId == vault.id { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(model.lockedVaults.contains(vault.id))
                    }
                }
                if let shared = model.sharedInto[card.id], !shared.isEmpty {
                    Section("Also in") {
                        ForEach(shared, id: \.self) { v in Text(model.vault(v)?.name ?? v) }
                    }
                }
            }
            .navigationTitle("Vaults")
        }
    }
}
