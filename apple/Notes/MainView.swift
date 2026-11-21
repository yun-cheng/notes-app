import NotesKit
import SwiftUI

/// The app's frame, as the web app's: a sidebar of pages, tag groups, tags and vaults beside the page on a wide
/// screen, and on a phone a tab bar (Journal, Today, Calendar, Search) with the tags and vaults in a sheet.
struct MainView: View {
    @Environment(AppModel.self) private var model
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        @Bindable var model = model
        Group {
            #if os(iOS)
            if sizeClass == .compact { PhoneFrame() } else { WideFrame() }
            #else
            WideFrame()
            #endif
        }
        .sheet(item: Binding(get: { model.openEntry.map(OpenEntry.init) }, set: { model.openEntry = $0?.id })) { entry in
            EntrySheet(id: entry.id)
        }
        .sheet(isPresented: $model.showPalette) { CommandPalette() }
        .sheet(item: $model.panel) { panel in EntryPanelView(panel: panel) }
        .overlay(alignment: .bottom) { ToastView() }
        .tint(Theme.accent)
    }
}

struct OpenEntry: Identifiable {
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
                NavigationStack { JournalView(filter: StreamFilter(status: .today)) }
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

    private func row(_ title: String, _ icon: String, _ page: Page, count: Int? = nil) -> some View {
        Button { go(page) } label: {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                if let count, count > 0 { Text("\(count)").foregroundStyle(Theme.muted).monospacedDigit() }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(model.page == page ? Theme.accentSoft.clipShape(RoundedRectangle(cornerRadius: 8)) : nil)
    }

    private var journalFilter: StreamFilter { model.page.filter ?? StreamFilter() }

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
                        Text("⌘K").font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                .buttonStyle(.plain)
                row("Journal", "doc.text", .journal(StreamFilter()))
                row("History", "clock.arrow.circlepath", .history)
                row("Calendar", "calendar", .calendar)
                row("Timeline", "chart.bar.xaxis", .timeline)
                row("Photos", "photo", .photos)
                row("Links", "link", .links)
                row("Files", "doc", .files)
                row("Archive", "archivebox", .journal(StreamFilter(archived: true)), count: archived)
                row("Trash", "trash", .trash, count: index.trash.count)
            }
            ForEach(index.tagGroups.groups) { group in
                Section(group.title) {
                    ForEach(group.members) { tag in tagRow(tag) }
                }
            }
            let loose = index.tagGroups.loose
            if !loose.isEmpty {
                Section("Tags") {
                    ForEach(loose) { tag in tagRow(tag) }
                    row("All tags", "tag", .tags)
                }
            } else {
                Section("Tags") { row("All tags", "tag", .tags) }
            }
            Section("Vaults") {
                ForEach(model.vaults) { vault in
                    let page = Page.journal(StreamFilter(vaultId: vault.id))
                    Button { go(page) } label: {
                        HStack {
                            Label(vault.name, systemImage: vault.isPrivate ? (model.lockedVaults.contains(vault.id) ? "lock" : "lock.open") : (vault.members ?? 1) > 1 ? "person.2" : "tray")
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(journalFilter.vaultId == vault.id && model.page.filter != nil ? Theme.accentSoft.clipShape(RoundedRectangle(cornerRadius: 8)) : nil)
                }
                row("All vaults", "square.stack.3d.up", .vaults)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Notes")
        .safeAreaInset(edge: .bottom) { AccountBadge(onPick: onPick) }
    }

    private func tagRow(_ tag: Card) -> some View {
        let count = model.index.backlinks[tag.id]?.filter { $0.kind == .tag && $0.from.isEntry && !$0.from.archived && !$0.from.template }.count ?? 0
        let selected = model.page.filter?.tagId == tag.id
        return Button { go(.journal(StreamFilter(tagId: tag.id))) } label: {
            HStack {
                Label(tag.displayTitle, systemImage: "tag")
                Spacer()
                if count > 0 { Text("\(count)").foregroundStyle(Theme.muted).monospacedDigit() }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(selected ? Theme.accentSoft.clipShape(RoundedRectangle(cornerRadius: 8)) : nil)
    }
}

/// The account at the foot of the sidebar: who's signed in, with Settings and signing out behind it.
struct AccountBadge: View {
    @Environment(AppModel.self) private var model
    var onPick: () -> Void = {}

    var body: some View {
        if let account = model.account {
            Menu {
                Button("Settings") {
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
