import NotesKit
import SwiftUI

/// The journal: every note and todo as compact bubbles like a chat, under day badges, with a box to write the next one,
/// as the web app's `journal.tsx`. A filter row narrows it; the sidebar narrows it to a tag or a vault.
struct JournalView: View {
    @Environment(AppModel.self) private var model
    @State var filter: StreamFilter
    @State private var searching = false
    @State private var query = ""
    @State private var shown = JournalView.pageSize
    @State private var picked: Set<String> = []
    @State private var pickDates = false
    /// The date picker opened from a day's badge, at that day.
    @State private var datesFrom: String?
    /// The entry the keyboard is on: ↑ ↓ move, Space picks, Enter opens.
    @State private var focusedEntry: String?
    @State private var showShortcuts = false
    @FocusState private var streamFocused: Bool

    /// Whether its filter is the page the app shows, kept as the page changes; the phone's Today tab keeps its own.
    let isPage: Bool

    static let pageSize = 150

    init(filter: StreamFilter, isPage: Bool = true) {
        _filter = State(initialValue: filter)
        self.isPage = isPage
    }

    private var title: String {
        if filter.archived { return "Archive" }
        if filter.template { return "Templates" }
        if let tag = filter.tagId { return model.card(tag)?.displayTitle ?? "Tag" }
        if let vault = filter.vaultId { return model.vault(vault)?.name ?? "Vault" }
        if filter.status == .today { return "Today" }
        return "Journal"
    }

    private var items: [StreamItem] {
        var items = Stream.items(model.index, filter, today: model.today, sharedInto: model.sharedInto)
        if searching && !query.trimmingCharacters(in: .whitespaces).isEmpty {
            let hits = Set(model.search.search(query).map(\.card.id))
            items = items.filter { hits.contains($0.card.id) }
        } else {
            items = Stream.foldStacks(items, stackOf: model.index.stackOf)
        }
        return items
    }

    /// Whether the stream reads like a chat, newest at the bottom.
    private var chat: Bool { filter.sort == .written || filter.sort == .edited }

    var body: some View {
        let all = items
        let visible = chat ? Array(all.suffix(shown)) : Array(all.prefix(shown))
        let locked = lockedVault
        VStack(spacing: 0) {
            FilterRow(filter: $filter, pickDates: $pickDates)
            if searching { PageSearchField(query: $query, close: { searching = false; query = "" }) }
            if let locked {
                UnlockView(vault: locked)
            } else if let board = filter.board {
                BoardView(filter: filter, board: board)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8, pinnedViews: .sectionHeaders) {
                            if chat && all.count > visible.count {
                                Button("Show earlier entries") { shown += Self.pageSize }.buttonStyle(.borderless).frame(maxWidth: .infinity)
                            }
                            ForEach(groups(visible), id: \.day) { group in
                                Section {
                                    ForEach(group.items) { item in
                                        VStack(alignment: .leading, spacing: 4) {
                                            BubbleView(card: item.card, picked: picked.contains(item.card.id), onPick: { togglePick(item.card.id) }, picking: !picked.isEmpty)
                                            EntryAttachments(card: item.card)
                                        }
                                            .overlay(alignment: .leading) {
                                                if focusedEntry == item.card.id {
                                                    RoundedRectangle(cornerRadius: 2).fill(Theme.accent).frame(width: 3).offset(x: -8)
                                                }
                                            }
                                            .id(item.card.id)
                                    }
                                } header: {
                                    DayBadge(day: group.day, sort: filter.sort) { day in
                                        // Opens the date picker at that day, as on the web: Show picks it, another press makes a range.
                                        datesFrom = day
                                    }
                                }
                            }
                            if !chat && all.count > visible.count {
                                Button("Show more entries") { shown += Self.pageSize }.buttonStyle(.borderless).frame(maxWidth: .infinity)
                            }
                            if all.isEmpty { EmptyJournal(filter: filter, searching: searching) }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 10)
                        .frame(maxWidth: 720)
                        .frame(maxWidth: .infinity)
                    }
                    .defaultScrollAnchor(chat ? .bottom : .top)
                    // Made again once there's something in it: a list laid out empty, before the cards are read, keeps
                    // an offset that the anchor doesn't move, past the end of what then arrives.
                    .id(all.isEmpty)
                    .focusable()
                    .focused($streamFocused)
                    .focusEffectDisabled()
                    .onKeyPress { press in keys(press, visible.map(\.card.id), all: all.map(\.card.id), proxy: proxy) }
                    .overlay(alignment: .trailing) {
                        JournalRail(items: visible) { id in withAnimation(nil) { proxy.scrollTo(id, anchor: .top) } }
                    }
                    // The anchor places the end by estimated heights; once the entries are drawn, go to the newest for
                    // real, or a list opened at the bottom can sit past its end, blank.
                    .task(id: "\(all.isEmpty)|\(filter.sort)") {
                        guard chat, let last = visible.last?.card.id else { return }
                        try? await Task.sleep(for: .milliseconds(60))
                        withAnimation(nil) { proxy.scrollTo(last, anchor: .bottom) }
                    }
                    .onChange(of: model.lastSaved) { _, id in
                        if let id { withAnimation(nil) { proxy.scrollTo(id, anchor: .bottom) } }
                    }
                }
                if !picked.isEmpty {
                    BatchBar(picked: $picked, all: all.map(\.card.id))
                } else if !model.viewOnly {
                    JournalBox(filter: filter)
                }
            }
        }
        .pageBackground()
        .navigationTitle(title)
        .toolbar { toolbar(count: all.count) }
        .sheet(isPresented: $pickDates) { DatesDialog(filter: $filter) }
        .sheet(id: $datesFrom) { day in DatesDialog(filter: $filter, startDay: day) }
        .sheet(isPresented: $showShortcuts) { ShortcutsSheet() }
        .onChange(of: filter) { _, f in
            shown = Self.pageSize
            if isPage { model.page = .journal(f) }
        }
        #if os(macOS)
        .navigationSubtitle("\(all.count)")
        #endif
    }

    /// The vault the journal is narrowed to, while it's locked on this device.
    private var lockedVault: Vault? {
        guard let id = filter.vaultId, model.lockedVaults.contains(id) else { return nil }
        return model.vault(id)
    }

    /// The journal's keys, as the web app's `useEntryShortcuts`.
    private func keys(_ press: KeyPress, _ ids: [String], all: [String], proxy: ScrollViewProxy) -> KeyPress.Result {
        let command = press.modifiers.contains(.command)
        func move(_ by: Int) {
            guard !ids.isEmpty else { return }
            let at = focusedEntry.flatMap { ids.firstIndex(of: $0) } ?? (by > 0 ? -1 : ids.count)
            let next = ids[max(0, min(ids.count - 1, at + by))]
            if press.modifiers.contains(.shift) { picked.insert(next) }
            focusedEntry = next
            withAnimation(nil) { proxy.scrollTo(next, anchor: .center) }
        }
        switch press.key {
        case .downArrow: move(1)
        case .upArrow: move(-1)
        case .home: move(-ids.count)
        case .end: move(ids.count)
        case .space:
            if let f = focusedEntry { togglePick(f) } else { move(0) }
        case .return:
            if let f = focusedEntry { model.openEntry = f } else { return .ignored }
        case .delete, .deleteForward:
            let ids = picked.isEmpty ? focusedEntry.map { [$0] } ?? [] : Array(picked)
            guard !ids.isEmpty else { return .ignored }
            model.trash(ids.filter { model.card($0).map(model.canManage) ?? false })
            picked = []
        case .escape:
            if !picked.isEmpty { picked = [] } else if focusedEntry != nil { focusedEntry = nil } else { return .ignored }
        default:
            if command && press.characters == "a" {
                picked = Set(all)
            } else if command && (press.characters == "c" || press.characters == "x"), !picked.isEmpty {
                let cards = picked.compactMap { model.card($0) }.sorted { $0.createdAt < $1.createdAt }
                Clipboard.copy(Markdown.entries(cards, index: model.index))
                if press.characters == "x" { model.trash(cards.filter(model.canManage).map(\.id)) } else { model.say("Copied \(cards.count)") }
                picked = []
            } else if press.characters == "?" {
                showShortcuts = true
            } else {
                return .ignored
            }
        }
        return .handled
    }

    private func togglePick(_ id: String) {
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
    }

    @ToolbarContentBuilder
    private func toolbar(count: Int) -> some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            SyncBadge()
            Button { model.viewOnly.toggle() } label: {
                Label(model.viewOnly ? "Turn off view only" : "View only", systemImage: model.viewOnly ? "eye.fill" : "eye")
            }
            .help("View only: read without changing anything by mistake")
            Button { searching.toggle() } label: { Label("Search", systemImage: "magnifyingglass") }
                .keyboardShortcut("/", modifiers: [])
            Menu {
                Picker("Order", selection: $filter.sort) {
                    ForEach(StreamFilter.Sort.labels, id: \.1) { sort, label in Text(label).tag(sort) }
                    ForEach(model.index.tagGroups.groups.filter(\.ordered)) { g in Text("By \(g.title.lowercased())").tag(StreamFilter.Sort.group(g.id)) }
                }
                .pickerStyle(.inline)
            } label: {
                Label(filter.sort.label(groups: model.index.tagGroups.groups), systemImage: "arrow.up.arrow.down")
                    #if os(macOS)
                    .labelStyle(.titleAndIcon)
                    #endif
            }
            Menu {
                Button("List") { filter.board = nil }
                Button("Board by state") { filter.board = "state" }
                ForEach(model.index.tagGroups.groups) { g in Button("Board by \(g.title.lowercased())") { filter.board = g.id } }
            } label: {
                Label("Board", systemImage: filter.board == nil ? "rectangle.split.3x1" : "rectangle.split.3x1.fill")
            }
        }
    }

    struct DayGroup {
        var day: String
        var items: [StreamItem]
    }

    private func groups(_ items: [StreamItem]) -> [DayGroup] {
        var out: [DayGroup] = []
        for item in items {
            if out.last?.day == item.day { out[out.count - 1].items.append(item) } else { out.append(DayGroup(day: item.day, items: [item])) }
        }
        return out
    }
}

/// A day's badge over its entries, pinned under the title bar while they scroll past. Pressing it narrows the journal
/// to that day, or back.
struct DayBadge: View {
    @Environment(AppModel.self) private var model
    let day: String
    let sort: StreamFilter.Sort
    let pick: (String) -> Void

    var body: some View {
        let label: String = {
            if case .group = sort { return model.card(day)?.displayTitle ?? "No tag" }
            if day.isEmpty { return "No due date" }
            return DateKey.relativeDay(day, today: model.today)
        }()
        HStack {
            Spacer()
            Button { if DateKey.isKey(day) { pick(day) } } label: {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Theme.sunken).shadow(color: .black.opacity(0.08), radius: 2, y: 1))
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(.top, 14)
    }
}

struct EmptyJournal: View {
    let filter: StreamFilter
    let searching: Bool

    var body: some View {
        ContentUnavailableView(
            searching ? "Nothing found" : filter.isFiltered ? "Nothing here" : "Nothing yet",
            systemImage: searching ? "magnifyingglass" : "text.bubble",
            description: Text(searching ? "Try other words." : filter.isFiltered ? "No entries match this filter." : "Write a note below, or [] for a todo."))
        .padding(.top, 60)
    }
}

/// A page's search field, a row under the title bar.
struct PageSearchField: View {
    @Binding var query: String
    let close: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
            TextField("Search", text: $query).textFieldStyle(.plain).focused($focused)
                .onSubmit {}
                .onKeyPress(.escape) {
                    close()
                    return .handled
                }
            Button(action: close) { Image(systemName: "xmark") }.buttonStyle(.plain).foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 38)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface).stroke(focused ? Theme.accent : Theme.line))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .onAppear { focused = true }
    }
}

/// A rail down the right, as a photo library has, with the years or months marked down it: pressed or dragged to go
/// anywhere in the journal at once, as the web app's `ScrollRail`.
struct JournalRail: View {
    let items: [StreamItem]
    let go: (String) -> Void
    @State private var pointing: String?

    var body: some View {
        // The first entry of each month, in the order shown.
        var months: [(key: String, id: String)] = []
        for item in items where DateKey.isKey(item.day) {
            let m = DateKey.monthKey(item.day)
            if months.last?.key != m { months.append((m, item.id)) }
        }
        let years = Set(months.map { $0.key.prefix(4) }).count > 1
        return GeometryReader { geo in
            if months.count > 1 {
                let step = geo.size.height / CGFloat(months.count)
                ZStack(alignment: .topTrailing) {
                    ForEach(Array(months.enumerated()), id: \.offset) { i, m in
                        let mark = years ? (m.key.hasSuffix("-01") || i == 0 ? String(m.key.prefix(4)) : nil) : String(DateKey.formatMonth(m.key).prefix(3))
                        if let mark, step > 14 || years {
                            Text(mark).font(.caption2.weight(.semibold)).foregroundStyle(Theme.muted)
                                .offset(y: CGFloat(i) * step)
                        }
                    }
                    if let pointing {
                        Text(DateKey.formatMonth(pointing)).font(.caption.weight(.semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Capsule().fill(Theme.raised).shadow(radius: 3))
                            .offset(x: -40, y: CGFloat(months.firstIndex { $0.key == pointing } ?? 0) * step)
                    }
                }
                .frame(width: 36, height: geo.size.height, alignment: .topTrailing)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                    let i = max(0, min(months.count - 1, Int(v.location.y / step)))
                    pointing = months[i].key
                    go(months[i].id)
                }.onEnded { _ in pointing = nil })
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(width: 44)
        .padding(.vertical, 8)
        .accessibilityHidden(true)
    }
}

