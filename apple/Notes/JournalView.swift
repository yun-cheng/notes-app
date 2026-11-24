import NotesKit
import SwiftUI

/// The journal: every note and todo as compact bubbles like a chat, under day badges, with a box to write the next one,
/// as the web app's `journal.tsx`. A filter row narrows it; the sidebar narrows it to a tag or a vault.
struct JournalView: View {
    @Environment(AppModel.self) private var model
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.phoneHeader) private var phoneHeader
    #endif
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
    /// Where each entry is, for picking with a box and for the keys' "the entry in the middle" (`BoxPick`).
    @State private var places = StreamPlaces()
    /// The box being dragged from empty space, and whether this drag started somewhere a box can't.
    @State private var box: PickBox?
    @State private var boxRefused = false
    /// The pointer as the box was last dragged, in the scroll view's own space, to follow scrolling under it.
    @State private var boxPointer: CGPoint?
    /// Where the stream's top left is in the scroll view, and how tall the scroll view is.
    @State private var streamOrigin: CGPoint = .zero
    @State private var viewportHeight: CGFloat = 0
    /// Clicks that end a box drag don't also pick or stop picking.
    @State private var quietUntil = Date.distantPast

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
            VoiceBar()
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
                                        PickRow(picked: picked.contains(item.card.id), picking: !picked.isEmpty, pick: { shift in clickPick(item.card.id, range: shift ? visible.map(\.card.id) : nil) }) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                BubbleView(card: item.card, picked: picked.contains(item.card.id), onPick: { clickPick(item.card.id, range: nil) }, onPickRange: { clickPick(item.card.id, range: visible.map(\.card.id)) }, picking: !picked.isEmpty, selection: Array(picked), stopPicking: { picked = [] })
                                                EntryAttachments(card: item.card).streamPlace(item.card.id, part: "files")
                                            }
                                        }
                                            .streamPlace(item.card.id)
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
                        #if os(macOS)
                        // Room for each entry's pick circle, as on the web.
                        .padding(.leading, 22)
                        #endif
                        .padding(.bottom, 10)
                        .frame(maxWidth: 720)
                        .frame(maxWidth: .infinity)
                        #if os(macOS)
                        .coordinateSpace(.named(StreamPlaces.space))
                        .environment(\.streamPlaces, places)
                        .overlay(alignment: .topLeading) {
                            if let box, box.rect.width + box.rect.height > 6 { PickBoxShape(rect: box.rect) }
                        }
                        .onGeometryChange(for: CGPoint.self) { $0.frame(in: .named("journalViewport")).origin } action: { origin in
                            streamOrigin = origin
                            // Scrolling under a box moves its far corner with the stream, as the web's.
                            if let at = boxPointer { dragBox(to: at, ids: visible.map(\.card.id)) }
                        }
                        #endif
                    }
                    .defaultScrollAnchor(chat ? .bottom : .top)
                    // Made again once there's something in it: a list laid out empty, before the cards are read, keeps
                    // an offset that the anchor doesn't move, past the end of what then arrives.
                    .id(all.isEmpty)
                    .focusable()
                    .focused($streamFocused)
                    .focusEffectDisabled()
                    .onKeyPress { press in keys(press, visible.map(\.card.id), all: all.map(\.card.id), proxy: proxy) }
                    #if os(macOS)
                    .coordinateSpace(.named("journalViewport"))
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewportHeight = $0 }
                    // A drag from empty space picks with a box, and a click there stops picking, as the web's.
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 6, coordinateSpace: .named("journalViewport"))
                            .onChanged { drag in startOrDragBox(drag, ids: visible.map(\.card.id)) }
                            // The last stretch of a quick drag comes only with the release.
                            .onEnded { drag in dragBox(to: drag.location, ids: visible.map(\.card.id)); endBox() }
                    )
                    .onTapGesture { clickEmpty() }
                    #endif
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
                } else if model.viewOnly {
                    ViewOnlyBar()
                } else {
                    JournalBox(filter: filter)
                }
            }
        }
        .pageBackground()
        .navigationTitle(title)
        .toolbar { toolbar(all: all.map(\.card.id)) }
        // Pasting stops picking, so the box shows to take what's pasted, as the web's.
        .onChange(of: model.pastedToBox) { _, pasted in if pasted != nil { picked = [] } }
        #if os(iOS)
        .preference(key: PlacesPhoneHeader.self, value: phoneHeader != nil)
        .preference(key: PlacesPageStatus.self, value: phoneHeader != nil)
        #endif
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
            let next: String
            if let f = focusedEntry, let at = ids.firstIndex(of: f) {
                next = ids[max(0, min(ids.count - 1, at + by))]
                // With Shift, picking from here to there, the entry it starts from too, as the web's.
                if press.modifiers.contains(.shift) {
                    if !picked.contains(f) { togglePick(f) }
                    togglePick(next, range: ids)
                }
            } else {
                // With none focused, from the entry in the middle of the screen: Space focuses it, and an arrow the one
                // after or before it, as the web's. Home and End go to the first and the last.
                let middle = abs(by) > 1 ? nil : middleEntry(ids)
                let at = middle.flatMap { ids.firstIndex(of: $0) } ?? (by > 0 ? -1 : ids.count)
                next = ids[max(0, min(ids.count - 1, at + by))]
                if press.modifiers.contains(.shift) { togglePick(next) }
            }
            focusedEntry = next
            withAnimation(nil) { proxy.scrollTo(next, anchor: .center) }
        }
        switch press.key {
        case .leftArrow, .rightArrow:
            // The focused entry's previous or next page, round from the last to the first, as the web's.
            guard let f = focusedEntry else { return .ignored }
            model.turnPage = (f, press.key == .leftArrow ? -1 : 1, (model.turnPage?.n ?? 0) + 1)
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
                Clipboard.copyEntries(cards, model: model)
                if press.characters == "x" { model.trash(cards.filter(model.canManage).map(\.id)) } else { model.say("Copied \(cards.count)") }
                picked = []
            } else if command && press.characters == "v" {
                // Anything pasted here goes to the writing box to look over before saving, as the web's; entries
                // copied from the journal come back whole there.
                #if os(macOS)
                guard let text = NSPasteboard.general.string(forType: .string), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .ignored }
                #else
                guard let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .ignored }
                #endif
                picked = []
                model.pastedToBox = text
            } else if press.characters == "?" {
                showShortcuts = true
            } else {
                return .ignored
            }
        }
        return .handled
    }

    /// On a phone's narrow layout, where the web has no room for the board switch.
    private var phone: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    @State private var pickedLast: String?

    /// The entry in the middle of what's shown, on a Mac.
    private func middleEntry(_ ids: [String]) -> String? {
        #if os(macOS)
        let top = -streamOrigin.y
        return places.middle(of: ids, shown: top...(top + viewportHeight))
        #else
        return nil
        #endif
    }

    /// A click that picks, unless it's the end of a box drag.
    private func clickPick(_ id: String, range: [String]?) {
        guard Date() >= quietUntil else { return }
        togglePick(id, range: range)
    }

    #if os(macOS)
    /// A drag over the stream: one that starts on empty space picks every entry its box touches as it moves, with what
    /// was picked before when Shift or Cmd was held as it started, as the web's `useBoxSelect`.
    private func startOrDragBox(_ drag: DragGesture.Value, ids: [String]) {
        guard !boxRefused else { return }
        if box == nil {
            let start = CGPoint(x: drag.startLocation.x - streamOrigin.x, y: drag.startLocation.y - streamOrigin.y)
            guard !places.isSolid(start, among: ids) else { boxRefused = true; return }
            box = PickBox(start: start, end: start, before: PickKeys.adding ? picked : [])
        }
        dragBox(to: drag.location, ids: ids)
    }

    /// Moves the box's far corner to the pointer (in the scroll view's space) and picks what it touches.
    private func dragBox(to pointer: CGPoint, ids: [String]) {
        guard var b = box else { return }
        boxPointer = pointer
        b.end = CGPoint(x: pointer.x - streamOrigin.x, y: pointer.y - streamOrigin.y)
        box = b
        let rect = b.rect
        picked = b.before.union(ids.filter { places.rows[$0]?.intersects(rect) == true })
    }

    private func endBox() {
        if box != nil {
            quietUntil = Date().addingTimeInterval(0.3)
            streamFocused = true
        }
        box = nil
        boxPointer = nil
        boxRefused = false
    }

    /// A click on empty space stops picking, as the web's, and gives the stream the keys.
    private func clickEmpty() {
        guard Date() >= quietUntil else { return }
        picked = []
        streamFocused = true
    }
    #endif

    /// Picks or unpicks an entry; with `range` (the entries in order, for a Shift-click), every one from the last picked
    /// to it, as the web's.
    private func togglePick(_ id: String, range: [String]? = nil) {
        if let range, let last = pickedLast, let a = range.firstIndex(of: last), let b = range.firstIndex(of: id) {
            for i in min(a, b)...max(a, b) { picked.insert(range[i]) }
        } else if picked.contains(id) {
            picked.remove(id)
        } else {
            picked.insert(id)
        }
        pickedLast = id
    }

    @ToolbarContentBuilder
    private func toolbar(all: [String]) -> some ToolbarContent {
        if !picked.isEmpty {
            // Picking, as the web's: Select all and Done in place of the page's buttons.
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Select all") { picked = Set(all) }.help("Select all (⌘A)")
                Button("Done") { picked = [] }.buttonStyle(.bordered)
            }
        } else {
        ToolbarItemGroup(placement: .primaryAction) {
            SyncBadge()
            Button { model.viewOnly.toggle() } label: {
                Label(model.viewOnly ? "Turn off view only" : "View only", systemImage: model.viewOnly ? "eye.fill" : "eye")
            }
            .help("View only: read without changing anything by mistake")
            Button { searching.toggle() } label: { Label("Search", systemImage: "magnifyingglass") }
                .keyboardShortcut("/", modifiers: [])
            if filter.board == nil {
                Menu {
                    Picker("Order", selection: $filter.sort) {
                        ForEach(StreamFilter.Sort.labels, id: \.1) { sort, label in Text(label).tag(sort) }
                        ForEach(model.index.tagGroups.groups.filter(\.ordered)) { g in Text("By \(g.title.lowercased())").tag(StreamFilter.Sort.group(g.id)) }
                    }
                    .pickerStyle(.inline)
                    // The board is picked here too, as on the web, where a phone has no room for its own button.
                    Section("Board") {
                        Button("Board by todo state") { filter.board = "state" }
                        ForEach(model.index.tagGroups.groups.filter { !$0.members.isEmpty }) { g in Button("Board by \(g.title.lowercased())") { filter.board = g.id } }
                    }
                } label: {
                    Label(filter.sort.label(groups: model.index.tagGroups.groups), systemImage: "arrow.up.arrow.down")
                        #if os(macOS)
                        .labelStyle(.titleAndIcon)
                        #endif
                }
            } else {
                // On the board, in the sort's place: what the columns are, as the web's.
                Menu {
                    Picker("Columns", selection: Binding(get: { filter.board ?? "state" }, set: { filter.board = $0 == "list" ? nil : $0 })) {
                        Text("List").tag("list")
                        Text("Todo state").tag("state")
                        ForEach(model.index.tagGroups.groups.filter { !$0.members.isEmpty }) { g in Text(g.title).tag(g.id) }
                    }
                    .pickerStyle(.inline)
                } label: {
                    let name = filter.board == "state" ? "Todo state" : model.index.tagGroups.groups.first { $0.id == filter.board }?.title ?? "Columns"
                    Label("Columns: \(name)", systemImage: "rectangle.split.3x1")
                        #if os(macOS)
                        .labelStyle(.titleAndIcon)
                        #endif
                }
            }
            #if os(iOS)
            if let phoneHeader { PhoneHeaderButtons(header: phoneHeader) }
            #endif
            if !phone {
                // List or board, opening the last board, as the web's switch on a computer.
                Button { filter.board = filter.board == nil ? "state" : nil } label: {
                    Label(filter.board == nil ? "Show as a board" : "Show as a list", systemImage: filter.board == nil ? "rectangle.split.3x1" : "list.bullet")
                }
                .help(filter.board == nil ? "Show as a board" : "Show as a list")
            }
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

/// In the writing box's place while view only is on, as the web's: says so, with a way back to writing.
struct ViewOnlyBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "eye").font(.system(size: 17)).foregroundStyle(Theme.muted)
            Text("View only. Entries can be read and copied, not changed.").foregroundStyle(Theme.muted)
            Spacer(minLength: 8)
            Button("Turn off") { model.viewOnly = false }.buttonStyle(.borderless)
        }
        .font(Theme.bodyFont)
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 20).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.line))
        .frame(maxWidth: 720)
        .padding(.horizontal, 12).padding(.bottom, 8)
    }
}

/// An entry's row in the journal: on a computer, as the web's, a circle on its left to pick it, shown while it's pointed
/// at or while picking (Shift-click for a range), and a click beside the bubble picks it too.
struct PickRow<Content: View>: View {
    let picked: Bool
    let picking: Bool
    let pick: (_ shift: Bool) -> Void
    @ViewBuilder let content: () -> Content
    @State private var hovering = false

    var body: some View {
        #if os(macOS)
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture { pick(NSEvent.modifierFlags.contains(.shift)) }
            .overlay(alignment: .topLeading) {
                Button { pick(NSEvent.modifierFlags.contains(.shift)) } label: {
                    ZStack {
                        Circle().fill(picked ? Theme.accent : Theme.bg)
                        Circle().strokeBorder(picked ? Theme.accent : Theme.muted, lineWidth: 2)
                        if picked { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.onAccent) }
                    }
                    .frame(width: 20, height: 20)
                }
                .buttonStyle(.plain)
                .offset(x: -28, y: 8)
                .opacity(hovering || picking ? 1 : 0)
                .help("Select (Shift-click for a range)")
                .accessibilityLabel(picked ? "Unselect" : "Select")
            }
            .onHover { hovering = $0 }
        #else
        content()
        #endif
    }
}
