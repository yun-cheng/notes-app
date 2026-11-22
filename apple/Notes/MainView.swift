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
        .sheet(id: $model.openEntry) { id in EntrySheet(id: id) }
        .sheet(isPresented: $model.showPalette) { CommandPalette() }
        .sheet(isPresented: $model.addingAccount) { SignInView() }
        .sheet(item: $model.panel) { panel in EntryPanelView(panel: panel) }
        #if os(iOS)
        .quickLookPreview($model.preview)
        #endif
        .overlay(alignment: .bottom) { ToastView() }
        .tint(Theme.accent)
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

#if os(iOS)
/// The phone's tabs, as the web app's tab bar.
struct PhoneFrame: View {
    @Environment(AppModel.self) private var model
    enum Tab: Hashable { case journal, today, calendar, search }
    @State private var tab: Tab = .journal

    var body: some View {
        TabView(selection: $tab) {
            SwiftUI.Tab("Journal", systemImage: "doc.text", value: .journal) {
                NavigationStack { PageView(page: model.page).phoneSidebarButton() }
            }
            SwiftUI.Tab("Today", systemImage: "sun.max", value: .today) {
                NavigationStack { JournalView(filter: StreamFilter(status: .today), isPage: false) }
            }
            SwiftUI.Tab("Calendar", systemImage: "calendar", value: .calendar) {
                NavigationStack { CalendarPage() }
            }
            SwiftUI.Tab("Search", systemImage: "magnifyingglass", value: .search) {
                NavigationStack { SearchPage() }
            }
        }
    }
}

extension View {
    /// On a phone the sidebar's pages, tags and vaults open from a button in the title bar.
    func phoneSidebarButton() -> some View { modifier(PhoneSidebarButton()) }
}

struct PhoneSidebarButton: ViewModifier {
    @State private var open = false
    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { open = true } label: { Label("Pages, tags and vaults", systemImage: "sidebar.left") }
                }
            }
            .sheet(isPresented: $open) {
                NavigationStack { Sidebar(onPick: { open = false }) }
                    .presentationDetents([.large])
            }
    }
}
#endif

/// The page the main column shows.
struct PageView: View {
    let page: Page

    var body: some View {
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

    private func go(_ page: Page) {
        model.page = page
        onPick()
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
                ForEach(Page.destinations.filter(\.listed), id: \.key) { d in
                    row(d, count: d.page == .trash ? index.trash.count : d.key == "archive" ? archived : 0)
                }
            }
            ForEach(index.tagGroups.groups) { group in
                Section(group.title) {
                    ForEach(group.members) { tag in tagRow(tag) }
                }
            }
            // As the web's: pinned tags outside a group, and the one the journal is narrowed to.
            Section("Tags") {
                let filtered = model.page.filter?.tagId
                let pinned = index.pinnedTags.filter { index.tagGroups.groupOf[$0.id] == nil }
                let shown = pinned.contains { $0.id == filtered } || filtered.map { index.tagGroups.groupOf[$0] != nil } == true ? pinned : pinned + index.tags.filter { $0.id == filtered }
                ForEach(shown) { tag in tagRow(tag) }
                row(Page.destination("tags"), quiet: true)
            }
            Section("Vaults") {
                if model.shownVaults.count > 1 {
                    ForEach(model.shownVaults) { vault in
                        row(vault.name, model.lockedVaults.contains(vault.id) ? "lock" : "", selected: model.page.filter?.vaultId == vault.id) { go(.journal(StreamFilter(vaultId: vault.id))) }
                    }
                }
                row(Page.destination("vaults"), quiet: true)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Notes")
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 0) {
                row(Page.destination("settings")).padding(.horizontal, 10).padding(.vertical, 6)
                AccountBadge(onPick: onPick)
            }
            .background(.bar)
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
                        Text(account.name).font(.subheadline.weight(.semibold)).lineLimit(1)
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
            }
            .buttonStyle(.plain)
            .help(sync.summary)
        }
    }
}
