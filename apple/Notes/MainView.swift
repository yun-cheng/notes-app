import NotesKit
import QuickLook
import SwiftUI

/// The app's frame, as the web app's: a sidebar of pages, tag groups, tags and vaults beside the page on a wide
/// screen, and on a phone a tab bar (Journal, Today, Calendar, Search) with the tags and vaults in a sheet.
struct MainView: View {
    @Environment(AppModel.self) private var model
    #if DEBUG
    /// `-wide` at launch shows a phone the wide layout, to check the computer's pages in the simulator.
    static let forcedWide = ProcessInfo.processInfo.arguments.contains("-wide")
    #else
    static let forcedWide = false
    #endif
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        @Bindable var model = model
        // Read here, in the body, so a change shows: a binding's own closures aren't watched.
        let panelHere = Self.panelHere(model) ? model.panel : nil
        Group {
            #if os(iOS)
            if sizeClass == .compact && !Self.forcedWide { PhoneFrame() } else { WideFrame().environment(\.horizontalSizeClass, .regular) }
            #else
            WideFrame()
            #endif
        }
        // Each account starts its pages afresh: a journal kept from another account would keep its scroll offset, past
        // the end of a shorter list or short of the newest entries in a longer one.
        .id(model.accountId)
        #if os(macOS)
        .overlay { if let id = model.openEntry { EntryOverlay(id: id) } }
        .overlay { if let request = model.viewer { MediaViewer(request: request) { model.viewer = nil } } }
        #else
        .fullScreenCover(item: $model.viewer) { request in MediaViewer(request: request) { model.viewer = nil }.presentationBackground(.clear) }
        .sheet(id: $model.openEntry) { id in EntrySheet(id: id) }
        #endif
        .sheet(isPresented: $model.showPalette) { CommandPalette() }
        .sheet(isPresented: $model.addingAccount) { SignInView() }
        // While an entry is open on a phone its panels (tags, dates, sharing) open from it: iOS shows one sheet at a time
        // from a view, so from here they never showed.
        .sheet(item: Binding(get: { panelHere }, set: { model.panel = $0 })) { panel in EntryPanelView(panel: panel) }
        #if os(iOS)
        .quickLookPreview($model.preview)
        #endif
        .overlay(alignment: .bottom) { ToastView() }
        .tint(Theme.accent)
    }
}

extension MainView {
    static func panelHere(_ model: AppModel) -> Bool {
        #if os(iOS)
        model.openEntry == nil
        #else
        true
        #endif
    }
}

extension View {
    /// A sheet shown while `id` holds something, for what it names; closing the sheet clears it.
    func sheet<Content: View>(id: Binding<String?>, @ViewBuilder content: @escaping (String) -> Content) -> some View {
        sheet(item: Binding(get: { id.wrappedValue.map(SheetID.init) }, set: { id.wrappedValue = $0?.id })) { content($0.id) }
    }
}

private struct SheetID: Identifiable {
    let id: String
}

struct WideFrame: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 300)
        } detail: {
            NavigationStack { PageView(page: model.page) }
        }
    }
}

/// A page that puts the phone's Tags and vaults and account buttons at the end of its own, as the journal does, sets
/// this, and finds them in `PhoneHeader`.
struct PlacesPhoneHeader: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

/// A page that shows the sync state and the eye itself, as the journal does, sets this.
struct PlacesPageStatus: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

/// A phone's Tags and vaults and account buttons at the end of a page's own buttons, as the web orders them: a page
/// with buttons of its own puts this last among them, and marks itself with `.placesPhoneTail()`.
struct PhoneTail: View {
    @Environment(\.phoneHeader) private var header

    var body: some View {
        #if os(iOS)
        if let header { PhoneHeaderButtons(header: header) }
        #endif
    }
}

extension View {
    func placesPhoneTail() -> some View { modifier(PlacesPhoneTail()) }
}

struct PlacesPhoneTail: ViewModifier {
    @Environment(\.phoneHeader) private var header
    func body(content: Content) -> some View { content.preference(key: PlacesPhoneHeader.self, value: header != nil) }
}

/// What a page needs to show the phone's header buttons itself.
struct PhoneHeader {
    var filters: Bool
    var openFilters: () -> Void
    /// Whether the page shows the eye, as the web's: not on Settings, Vaults, Photos, Links or Files.
    var eye = true
}

extension EnvironmentValues {
    @Entry var phoneHeader: PhoneHeader?
}

/// The sync state and the eye, as the web shows them by every page's title (the eye where something can be changed).
struct PageStatus: View {
    @Environment(AppModel.self) private var model
    var eye = true

    var body: some View {
        SyncBadge()
        if eye {
            Button { model.viewOnly.toggle() } label: {
                Label(model.viewOnly ? "Turn off view only" : "View only", systemImage: model.viewOnly ? "eye.fill" : "eye")
            }
            .help("View only: read without changing anything by mistake")
        }
    }
}

#if os(iOS)
/// The phone's tabs, as the web app's tab bar.
struct PhoneFrame: View {
    @Environment(AppModel.self) private var model
    enum Tab: Hashable { case journal, today, calendar, search }
    @State private var tab: Tab = .journal
    @State private var shown: Date?

    var body: some View {
        // As the web's tabs, which are links: Journal goes to the whole journal, pressed again too; a page picked from
        // the sidebar shows in the Journal tab, and the calendar in its own.
        let selection = Binding<Tab>(get: { tab }, set: { next in
            // Not as the tabs first appear, which keeps a page the app was opened on (`-page`).
            if next == .journal, let shown, Date().timeIntervalSince(shown) > 0.5 { model.page = .journal(StreamFilter()) }
            tab = next
        })
        TabView(selection: selection) {
            SwiftUI.Tab("Journal", systemImage: "doc.text", value: .journal) {
                NavigationStack { PageView(page: model.page).phoneSidebarButton(filters: ![Page.tags, .vaults, .settings].contains(model.page), eye: PageView.hasEye(model.page)) }
            }
            SwiftUI.Tab("Today", systemImage: "sun.max", value: .today) {
                NavigationStack { JournalView(filter: StreamFilter(status: .today), isPage: false).phoneSidebarButton() }
            }
            SwiftUI.Tab("Calendar", systemImage: "calendar", value: .calendar) {
                NavigationStack { CalendarPage().phoneSidebarButton() }
            }
            SwiftUI.Tab("Search", systemImage: "magnifyingglass", value: .search) {
                NavigationStack { SearchPage().phoneSidebarButton(filters: false) }
            }
        }
        .onChange(of: model.page) { _, page in tab = page == .calendar ? .calendar : .journal }
        .onAppear { shown = Date() }
    }
}

extension View {
    /// A phone's title bar, as the web's there: Tags and vaults (the sidebar's pages, groups, tags and vaults in a
    /// sheet) on the pages that have it, and the account button on every page.
    func phoneSidebarButton(filters: Bool = true, eye: Bool = true) -> some View { modifier(PhoneSidebarButton(filters: filters, eye: eye)) }
}

/// The phone's Tags and vaults and account buttons, for a page that places them itself.
struct PhoneHeaderButtons: View {
    @Environment(AppModel.self) private var model
    let header: PhoneHeader
    /// With the sync state and the eye first, for a page that has none of its own.
    var status = false

    var body: some View {
        if status { PageStatus(eye: header.eye) }
        let narrowed = model.page.filter.map { $0.tagId != nil || $0.vaultId != nil } ?? false
        if header.filters {
            Button(action: header.openFilters) { Label("Tags and vaults", systemImage: "line.3.horizontal.decrease") }
                .tint(narrowed ? Theme.accent : nil)
        }
        AccountButton()
    }
}

struct PhoneSidebarButton: ViewModifier {
    @Environment(AppModel.self) private var model
    var filters = true
    var eye = true
    @State private var open = false
    @State private var placed = false
    @State private var statusPlaced = false
    func body(content: Content) -> some View {
        let header = PhoneHeader(filters: filters, openFilters: { open = true }, eye: eye)
        content
            .environment(\.phoneHeader, header)
            .onPreferenceChange(PlacesPhoneHeader.self) { placed = $0 }
            .onPreferenceChange(PlacesPageStatus.self) { statusPlaced = $0 }
            .toolbar {
                // The sync state and eye first, a page's own buttons next, then Tags and vaults and the account, as the
                // web's title bar on a phone.
                if !statusPlaced { ToolbarItemGroup(placement: .topBarTrailing) { PageStatus(eye: eye) } }
                if !placed { ToolbarItemGroup(placement: .topBarTrailing) { PhoneHeaderButtons(header: header) } }
            }
            .sheet(isPresented: $open) {
                NavigationStack { Sidebar(onPick: { open = false }, phone: true) }
                    .presentationDetents([.large])
            }
    }
}

/// The account's picture in a phone's title bar, as the web's: its menu has the account, the others to switch to,
/// Add another account, Backup & settings and Sign out.
struct AccountButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let account = model.account {
            Menu {
                Section {
                    Label("\(account.name) (\(account.email))", systemImage: "person.crop.circle")
                }
                let others = model.accounts.filter { $0.id != account.id }
                if !others.isEmpty {
                    Section("Switch to") {
                        ForEach(others) { other in Button("\(other.name) (\(other.email))") { model.switchTo(other) } }
                    }
                }
                Button { model.addingAccount = true } label: { Label("Add another account", systemImage: "plus") }
                Button { model.page = .settings } label: { Label("Backup & settings", systemImage: "slider.horizontal.3") }
                Button(role: .destructive, action: model.signOut) { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
            } label: {
                Avatar(account: account, size: 30).clipShape(Circle())
            }
            .accessibilityLabel("\(account.name) (\(account.email)): switch account or sign out")
        }
    }
}
#endif

/// The page the main column shows.
struct PageView: View {
    @Environment(\.phoneHeader) private var phoneHeader
    let page: Page

    /// Whether a page shows the eye, as the web's: where something can be changed, so not Settings, Vaults, Photos,
    /// Links or Files.
    static func hasEye(_ page: Page) -> Bool { ![Page.settings, .vaults, .photos, .links, .files].contains(page) }

    var body: some View {
        content
            .toolbar {
                // As the web's by every page's title; the journal places its own, and a phone's header does there.
                if phoneHeader == nil, page.filter == nil {
                    ToolbarItemGroup(placement: .primaryAction) { PageStatus(eye: Self.hasEye(page)) }
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch page {
        case .journal(let filter): JournalView(filter: filter).id(filter)
        case .trash: TrashPage()
        case .history: HistoryPage()
        case .calendar: CalendarPage()
        case .timeline: TimelinePage()
        case .photos: PhotosPage()
        case .links: LinksPage()
        case .files: FilesPage()
        case .tags: TagsPage()
        case .vaults: VaultsPage()
        case .settings: SettingsPage()
        }
    }
}

/// The sidebar, as the web app's: New note, Search, the pages, tag groups with their tags, other tags, vaults, and
/// the account at the foot.
struct Sidebar: View {
    @Environment(AppModel.self) private var model
    var onPick: () -> Void = {}
    /// On a phone, as the web's Tags and vaults sheet: only the pages, groups, tags and vaults (New note, Search, the
    /// settings and the account are in the tabs and the account button there).
    var phone = false

    private func go(_ page: Page) {
        model.page = page
        onPick()
    }

    /// Sections folded on this device, by ID, as the web keeps them.
    @AppStorage("sidebarFolded") private var foldedIds = ""

    private func folded(_ id: String) -> Bool { foldedIds.split(separator: ",").contains(Substring(id)) }

    /// A section's name, pressed to fold it, as the web's: folded, it keeps only the choice in use in sight.
    private func foldHeader(_ id: String, _ title: String) -> some View {
        Button {
            var ids = Set(foldedIds.split(separator: ",").map(String.init))
            if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
            foldedIds = ids.sorted().joined(separator: ",")
        } label: {
            HStack(spacing: 4) {
                Text(title)
                Image(systemName: folded(id) ? "chevron.right" : "chevron.down").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(folded(id) ? "folded" : "open")")
    }

    /// One row: a name with its icon and a count, tinted while it's the page shown.
    private func row(_ title: String, _ icon: String, tint: Color? = nil, quiet: Bool = false, selected: Bool, count: Int = 0, go action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                if icon.isEmpty {
                    // No icon, lined up with the names above it; a quiet link, All tags or Manage vaults, fainter.
                    Label { Text(title).foregroundStyle(quiet ? Theme.muted : Theme.text) } icon: { Color.clear.frame(width: 16) }
                } else {
                    Label { Text(title) } icon: { Image(systemName: icon).foregroundStyle(tint ?? Theme.muted) }
                }
                Spacer()
                if count > 0 { Text("\(count)").foregroundStyle(Theme.muted).monospacedDigit() }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(selected ? Theme.accentSoft.clipShape(RoundedRectangle(cornerRadius: 8)) : nil)
    }

    private func row(_ d: Page.Destination, count: Int = 0, quiet: Bool = false) -> some View {
        row(d.title, quiet ? "" : d.icon, quiet: quiet, selected: model.page == d.page, count: count) { go(d.page) }
    }

    var body: some View {
        let index = model.index
        let archived = index.live.filter { $0.isEntry && $0.archived }.count
        List {
            Section {
                if !phone {
                Button {
                    go(.journal(StreamFilter()))
                    model.focusBox += 1
                } label: {
                    Text("New note").frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .listRowSeparator(.hidden)
                Button {
                    model.showPalette = true
                    onPick()
                } label: {
                    HStack {
                        Label("Search", systemImage: "magnifyingglass")
                        Spacer()
                        #if os(macOS)
                        Text("⌘K").font(.caption).foregroundStyle(Theme.muted)
                        #endif
                    }
                }
                .buttonStyle(.plain)
                }
                ForEach(Page.destinations.filter(\.listed), id: \.key) { d in
                    row(d, count: d.page == .trash ? index.trash.count : d.key == "archive" ? archived : 0)
                }
            }
            ForEach(index.tagGroups.groups) { group in
                let id = "group:\(group.id)"
                Section {
                    ForEach(group.members.filter { !folded(id) || model.page.filter?.tagId == $0.id }) { tag in tagRow(tag) }
                } header: { foldHeader(id, group.title) }
            }
            // As the web's: pinned tags outside a group, and the one the journal is narrowed to.
            Section {
                let filtered = model.page.filter?.tagId
                let pinned = index.pinnedTags.filter { index.tagGroups.groupOf[$0.id] == nil }
                let shown = pinned.contains { $0.id == filtered } || filtered.map { index.tagGroups.groupOf[$0] != nil } == true ? pinned : pinned + index.tags.filter { $0.id == filtered }
                ForEach(shown.filter { !folded("tags") || $0.id == filtered }) { tag in tagRow(tag) }
                if !folded("tags") || model.page == .tags { row(Page.destination("tags"), quiet: true) }
            } header: { foldHeader("tags", "Tags") }
            Section {
                if model.shownVaults.count > 1 {
                    ForEach(model.shownVaults.filter { !folded("vaults") || model.page.filter?.vaultId == $0.id }) { vault in
                        row(vault.name, model.lockedVaults.contains(vault.id) ? "lock" : "", selected: model.page.filter?.vaultId == vault.id) { go(.journal(StreamFilter(vaultId: vault.id))) }
                    }
                }
                if !folded("vaults") || model.page == .vaults { row(Page.destination("vaults"), quiet: true) }
            } header: { foldHeader("vaults", "Vaults") }
        }
        .listStyle(.sidebar)
        .navigationTitle(phone ? "Tags and vaults" : "Notes")
        #if os(iOS)
        .navigationBarTitleDisplayMode(phone ? .inline : .automatic)
        #endif
        .toolbar {
            if phone { ToolbarItem(placement: .confirmationAction) { Button("Done", action: onPick) } }
        }
        .safeAreaInset(edge: .bottom) {
            if !phone {
                VStack(spacing: 0) {
                    row(Page.destination("settings")).padding(.horizontal, 10).padding(.vertical, 6)
                    AccountBadge(onPick: onPick)
                }
                .background(.bar)
            }
        }
    }

    private func tagRow(_ tag: Card) -> some View {
        // Every entry it's on, archived and templates too, as the web counts.
        let count = model.index.backlinks[tag.id]?.filter { $0.kind == .tag }.count ?? 0
        return row(tag.displayTitle, "tag", tint: tag.color.map(Theme.tint), selected: model.page.filter?.tagId == tag.id, count: count) { go(.journal(StreamFilter(tagId: tag.id))) }
    }
}

/// The account at the foot of the sidebar: who's signed in, with Settings and signing out behind it.
struct AccountBadge: View {
    @Environment(AppModel.self) private var model
    var onPick: () -> Void = {}

    var body: some View {
        if let account = model.account {
            Menu {
                // Every account signed in on this device, to switch to, and another to add.
                ForEach(model.accounts) { other in
                    Button { model.switchTo(other) } label: {
                        Label("\(other.name) (\(other.email))", systemImage: other.id == account.id ? "checkmark.circle.fill" : "person.circle")
                    }
                }
                Button("Add another account") { model.addingAccount = true }
                Divider()
                Button("Backup & settings") {
                    model.page = .settings
                    onPick()
                }
                if !model.openVaults.isEmpty { Button("Lock private vaults", action: model.lockAll) }
                Divider()
                Button("Sign out", role: .destructive, action: model.signOut)
            } label: {
                HStack(spacing: 10) {
                    Avatar(account: account, size: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 6) {
                            Text(account.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                            if account.email.lowercased().hasSuffix(".test") { DemoTag() }
                        }
                        Text(account.email).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(10)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .background(.bar)
        }
    }
}

/// Marks the demo account, as the web's DEMO tag.
struct DemoTag: View {
    var body: some View {
        Text("DEMO").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.alert)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(Capsule().fill(Theme.alert.opacity(0.18)))
            .help("The demo account on your local server")
    }
}

/// An account's Google photo, or its first letter.
struct Avatar: View {
    let account: Account
    var size: CGFloat = 28

    var body: some View {
        AsyncImage(url: account.picture.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String(account.name.prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .semibold))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 0.93, green: 0.55, blue: 0.45))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

/// A short message at the foot of the window, with Undo when it can be taken back.
struct ToastView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let toast = model.toast {
            HStack(spacing: 14) {
                Text(toast.message)
                if let id = toast.open {
                    Button("Open") {
                        model.toast = nil
                        model.openEntry = id
                    }
                    .fontWeight(.semibold)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.accent)
                }
                if toast.undo {
                    Button("Undo") {
                        model.toast = nil
                        model.undo()
                    }
                    .fontWeight(.semibold)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Capsule().fill(Theme.raised).shadow(color: .black.opacity(0.18), radius: 14, y: 6))
            .padding(.bottom, 90)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: toast.id) {
                try? await Task.sleep(for: .seconds(5))
                if model.toast?.id == toast.id { model.toast = nil }
            }
        }
    }
}

struct SyncBadge: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let sync = model.sync {
            Button {
                Task { await sync.sync() }
            } label: {
                let (label, icon): (String, String) =
                    switch sync.state {
                    case .offline: ("Offline", "icloud.slash")
                    case .signedOut: ("Sign in to sync", "exclamationmark.icloud")
                    case .error: ("Not synced", "exclamationmark.icloud")
                    case .syncing, .idle: sync.pending > 0 ? ("Syncing…", "arrow.triangle.2.circlepath.icloud") : ("Synced", "checkmark.icloud")
                    }
                Label(label, systemImage: icon).font(.caption).foregroundStyle(Theme.muted)
                    #if os(macOS)
                    // Named on a computer, as the web's title bar; an icon alone on a phone.
                    .labelStyle(.titleAndIcon)
                    #endif
            }
            .buttonStyle(.plain)
            .help(sync.summary)
        }
    }
}
