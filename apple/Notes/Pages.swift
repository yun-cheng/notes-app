import NotesKit
import SwiftUI

/// A page's list of entries under day headings, as the Trash and the search show them.
struct EntryList: View {
    let cards: [Card]
    var empty: String = "Nothing here"

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(cards) { BubbleView(card: $0) }
                if cards.isEmpty { ContentUnavailableView(empty, systemImage: "tray").padding(.top, 60) }
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .pageBackground()
    }
}

/// The Trash: entries put there, to read, copy and restore, one by one or all at once.
struct TrashPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let trash = model.index.trash
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(trash) { card in
                    VStack(alignment: .leading, spacing: 4) {
                        BubbleView(card: card)
                        if model.canWrite(card) {
                            Button("Restore") {
                                let id = card.id
                                model.perform { try await $0.setDeleted(id, false) }
                                model.say("Restored", undoable: true)
                            }
                            .buttonStyle(.borderless)
                            .font(.caption)
                        }
                    }
                }
                if trash.isEmpty { ContentUnavailableView("The Trash is empty", systemImage: "trash").padding(.top, 60) }
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .pageBackground()
        .navigationTitle("Trash")
        .toolbar {
            if !trash.isEmpty {
                Button("Restore all") {
                    let group = model.repo.action()
                    let ids = trash.filter { model.canWrite($0) }.map(\.id)
                    model.perform { repo in for id in ids { try await repo.setDeleted(id, false, group: group) } }
                    model.say("Restored \(ids.count)", undoable: true)
                }
            }
        }
    }
}

/// What was changed on this device, newest first, each with Undo or Redo, as the web app's History page.
struct HistoryPage: View {
    @Environment(AppModel.self) private var model
    @State private var groups: [Changes.Group] = []
    @State private var current: [String: Card] = [:]

    var body: some View {
        List {
            ForEach(groups) { group in
                Section(Date(timeIntervalSince1970: Double(group.at) / 1000).formatted(date: .abbreviated, time: .shortened)) {
                    ForEach(group.changes) { change in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(change.sealed ? "Locked entry" : (current[change.cardId] ?? change.after).displayTitle).lineLimit(1)
                                Text(Changes.describe(change) + (change.undoneAt != nil ? " · undone" : "")).font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            let card = current[change.cardId]
                            if change.undoneAt == nil, Changes.canUndo(change, card) {
                                Button("Undo") { revert(change, undo: true) }.buttonStyle(.borderless)
                            } else if change.undoneAt != nil, Changes.canRedo(change, card) {
                                Button("Redo") { revert(change, undo: false) }.buttonStyle(.borderless)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { if !change.sealed { model.openEntry = change.cardId } }
                    }
                }
            }
            if groups.isEmpty { ContentUnavailableView("No changes yet", systemImage: "clock.arrow.circlepath") }
        }
        .navigationTitle("History")
        .task(id: model.cards) { await load() }
    }

    private func load() async {
        guard let rows = try? await model.repo.changes() else { return }
        let filtered = rows.filter { row in !model.lockedVaults.contains(row.change.after.vaultId) }
        current = Dictionary(filtered.compactMap { r in r.current.map { (r.change.cardId, $0) } }) { a, _ in a }
        groups = Changes.grouped(filtered.map(\.change))
    }

    private func revert(_ change: Change, undo: Bool) {
        let n = change.n
        model.perform { _ = try await $0.revert([n], undo: undo) }
    }
}

/// A month of todos on their days, as the web app's Calendar; a day opens the journal for that day.
struct CalendarPage: View {
    @Environment(AppModel.self) private var model
    @State private var month = DateKey.monthKey(DateKey.today())

    var body: some View {
        let todos = model.index.todos
        let byDay = Dictionary(grouping: todos.filter { $0.due != nil }, by: { $0.due! })
        let weekStart = Calendar.current.firstWeekday
        let days = DateKey.monthGrid(month, weekStart: weekStart)
        let symbols = Calendar.current.shortWeekdaySymbols
        ScrollView {
            VStack(spacing: 8) {
                HStack {
                    Button { month = DateKey.addMonths(month, -1) } label: { Image(systemName: "chevron.left") }
                    Text(DateKey.formatMonth(month)).font(.title3.weight(.semibold)).frame(maxWidth: .infinity)
                    Button { month = DateKey.addMonths(month, 1) } label: { Image(systemName: "chevron.right") }
                    Button("Today") { month = DateKey.monthKey(model.today) }
                }
                .buttonStyle(.borderless)
                Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                    GridRow { ForEach(0..<7, id: \.self) { Text(symbols[(weekStart - 1 + $0) % 7]).font(.caption).foregroundStyle(Theme.muted) } }
                    ForEach(0..<6, id: \.self) { row in
                        GridRow {
                            ForEach(days[(row * 7)..<(row * 7 + 7)], id: \.self) { day in
                                DayCell(day: day, inMonth: DateKey.monthKey(day) == month, todos: byDay[day] ?? [])
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Calendar")
    }
}

struct DayCell: View {
    @Environment(AppModel.self) private var model
    let day: String
    let inMonth: Bool
    let todos: [Card]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(String(Int(day.suffix(2)) ?? 0))
                .font(.caption.weight(day == model.today ? .bold : .regular))
                .foregroundStyle(day == model.today ? Theme.accent : inMonth ? Theme.text : Theme.muted)
            ForEach(todos.prefix(3)) { todo in
                Text(todo.title).font(.caption2).lineLimit(1).strikethrough(todo.isDone)
                    .padding(.horizontal, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 3).fill(todo.isOverdue(today: model.today) ? Theme.alert.opacity(0.2) : Theme.accentSoft))
                    .onTapGesture { model.openEntry = todo.id }
            }
            if todos.count > 3 { Text("+\(todos.count - 3)").font(.caption2).foregroundStyle(Theme.muted) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 6).fill(inMonth ? Theme.surface : Theme.bg))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { model.page = .journal(StreamFilter(when: day)) }
    }
}

/// Todos with dates as bars from their start to their due date, as the web app's Timeline.
struct TimelinePage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let todos = model.index.todos.filter { $0.due != nil && !$0.isDone }.sorted { ($0.start ?? $0.due!) < ($1.start ?? $1.due!) }
        let first = DateKey.adding(-3, to: model.today)
        let width: CGFloat = 28
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 0) {
                    ForEach(0..<60, id: \.self) { i in
                        let day = DateKey.adding(i, to: first)
                        Text(String(Int(day.suffix(2)) ?? 0)).font(.caption2)
                            .foregroundStyle(day == model.today ? Theme.accent : Theme.muted)
                            .frame(width: width)
                    }
                }
                ForEach(todos) { todo in
                    let start = DateKey.daysBetween(first, todo.start ?? todo.due!)
                    let length = max(1, DateKey.daysBetween(todo.start ?? todo.due!, todo.due!) + 1)
                    Text(todo.title).font(.caption).lineLimit(1).padding(.horizontal, 6)
                        .frame(width: CGFloat(length) * width - 2, height: 22, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 6).fill(todo.isOverdue(today: model.today) ? Theme.alert.opacity(0.3) : Theme.accentSoft))
                        .padding(.leading, CGFloat(max(0, start)) * width)
                        .onTapGesture { model.openEntry = todo.id }
                }
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Timeline")
    }
}

/// Every web link in the journal, under the day its entry was written.
struct LinksPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .link), today: model.today)
        List {
            ForEach(items) { item in
                ForEach(Doc.linkUrls(item.card.content).filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }, id: \.self) { url in
                    VStack(alignment: .leading, spacing: 2) {
                        Link(destination: URL(string: url)!) { Text(url).lineLimit(2) }
                        Button(item.card.displayTitle) { model.openEntry = item.card.id }.buttonStyle(.plain).font(.caption).foregroundStyle(Theme.muted)
                    }
                    .contextMenu {
                        Button("Copy link address") { Clipboard.copy(url) }
                        Button("Open entry") { model.openEntry = item.card.id }
                    }
                }
            }
        }
        .searchable(text: $query)
        .navigationTitle("Links")
    }
}

/// Every file attached in the journal.
struct FilesPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .file), today: model.today)
        List {
            ForEach(items) { item in
                ForEach(Doc.files(item.card.content).filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { file in
                    HStack {
                        Image(systemName: file.isAudio ? "waveform" : file.isVideo ? "film" : "doc")
                        VStack(alignment: .leading) {
                            Text(file.name)
                            Button(item.card.displayTitle) { model.openEntry = item.card.id }.buttonStyle(.plain).font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        if let size = file.size { Text(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)).font(.caption).foregroundStyle(Theme.muted) }
                    }
                }
            }
        }
        .searchable(text: $query)
        .navigationTitle("Files")
    }
}

/// Every photo and video in the journal, under the day each entry was written.
struct PhotosPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .photo), today: model.today)
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 4)], spacing: 4) {
                ForEach(items) { item in
                    ForEach(Doc.media(item.card.content)) { media in
                        PhotoThumb(media: media, vaultId: item.card.vaultId)
                            .onTapGesture { model.openEntry = item.card.id }
                    }
                }
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Photos")
    }
}

/// Search over everything, as on the phone's Search tab.
struct SearchPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let hits = CardSearch(model.index).search(query).filter { $0.card.isEntry }
        List(hits, id: \.card.id) { hit in
            Button { model.openEntry = hit.card.id } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.card.displayTitle).fontWeight(.semibold).lineLimit(1)
                    Text(hit.snippet).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                }
            }
            .buttonStyle(.plain)
        }
        .searchable(text: $query, prompt: "Search everything")
        .navigationTitle("Search")
    }
}

/// Cmd+K: any page or action, and any entry, from the keyboard.
struct CommandPalette: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var focused: Bool

    struct Command: Identifiable {
        let id: String
        let icon: String
        let run: () -> Void
    }

    private var commands: [Command] {
        [
            Command(id: "Journal", icon: "doc.text") { model.page = .journal(StreamFilter()) },
            Command(id: "Today", icon: "sun.max") { model.page = .journal(StreamFilter(status: .today)) },
            Command(id: "Upcoming", icon: "calendar.badge.clock") { model.page = .journal(StreamFilter(status: .upcoming)) },
            Command(id: "History", icon: "clock.arrow.circlepath") { model.page = .history },
            Command(id: "Calendar", icon: "calendar") { model.page = .calendar },
            Command(id: "Timeline", icon: "chart.bar.xaxis") { model.page = .timeline },
            Command(id: "Photos", icon: "photo") { model.page = .photos },
            Command(id: "Links", icon: "link") { model.page = .links },
            Command(id: "Files", icon: "doc") { model.page = .files },
            Command(id: "Archive", icon: "archivebox") { model.page = .journal(StreamFilter(archived: true)) },
            Command(id: "Templates", icon: "doc.on.doc") { model.page = .journal(StreamFilter(template: true)) },
            Command(id: "Trash", icon: "trash") { model.page = .trash },
            Command(id: "All tags", icon: "tag") { model.page = .tags },
            Command(id: "Vaults", icon: "tray.2") { model.page = .vaults },
            Command(id: "Settings", icon: "gear") { model.page = .settings },
            Command(id: "Undo", icon: "arrow.uturn.backward") { model.undo() },
            Command(id: "Redo", icon: "arrow.uturn.forward") { model.redo() },
            Command(id: "Lock private vaults", icon: "lock") { model.lockAll() },
        ]
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let matching = commands.filter { q.isEmpty || $0.id.localizedCaseInsensitiveContains(q) }
        let hits = q.isEmpty ? [] : CardSearch(model.index).search(q).prefix(20)
        VStack(spacing: 0) {
            TextField("Search or run a command", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .padding(14)
                .focused($focused)
                .onSubmit {
                    if let first = matching.first { first.run(); dismiss() } else if let hit = hits.first { model.openEntry = hit.card.id; dismiss() }
                }
            Divider()
            List {
                if !matching.isEmpty {
                    Section("Commands") {
                        ForEach(matching) { c in
                            Button { c.run(); dismiss() } label: { Label(c.id, systemImage: c.icon) }.buttonStyle(.plain)
                        }
                    }
                }
                if !hits.isEmpty {
                    Section("Entries") {
                        ForEach(Array(hits), id: \.card.id) { hit in
                            Button {
                                if hit.card.type == .tag { model.page = .journal(StreamFilter(tagId: hit.card.id)) } else { model.openEntry = hit.card.id }
                                dismiss()
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(hit.card.displayTitle).lineLimit(1)
                                    Text(hit.snippet).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .frame(minWidth: 480, minHeight: 360)
        .onAppear { focused = true }
    }
}

/// Every tag, grouped, with how many entries have each, as the web app's Tags page.
struct TagsPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let groups = model.index.tagGroups
        List {
            ForEach(groups.groups) { group in
                Section(group.title) { ForEach(group.members) { TagRow(tag: $0) } }
            }
            Section("Tags") { ForEach(groups.loose) { TagRow(tag: $0) } }
        }
        .navigationTitle("Tags")
    }
}

struct TagRow: View {
    @Environment(AppModel.self) private var model
    let tag: Card

    var body: some View {
        let count = model.index.backlinks[tag.id]?.filter { $0.kind == .tag }.count ?? 0
        Button { model.page = .journal(StreamFilter(tagId: tag.id)) } label: {
            HStack {
                Label(tag.displayTitle, systemImage: "tag")
                Spacer()
                Text(tag.tagVaults(model.sharedInto)?.compactMap { model.vault($0)?.name }.joined(separator: ", ") ?? "All vaults")
                    .font(.caption).foregroundStyle(Theme.muted)
                Text("\(count)").monospacedDigit().foregroundStyle(Theme.muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// This account's vaults: whose they are, who's in them, how they're locked.
struct VaultsPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List(model.vaults) { vault in
            Button { model.page = .journal(StreamFilter(vaultId: vault.id)) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(vault.name).fontWeight(.semibold)
                    Text(describe(vault)).font(.caption).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .navigationTitle("Vaults")
    }

    private func describe(_ vault: Vault) -> String {
        var parts: [String] = []
        parts.append(vault.isOwner ? "Yours" : "Shared with you as \(vault.role == .viewer ? "a viewer" : "an editor")")
        if let n = vault.members, n > 1 { parts.append("\(n) people") }
        if vault.isEncrypted { parts.append("encrypted") } else if vault.isPrivate { parts.append("locked by a PIN") }
        if vault.isWithheld { parts.append("waiting for you to set a PIN or be let in") }
        return parts.joined(separator: " · ")
    }
}
