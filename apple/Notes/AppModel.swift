import Foundation
import NotesKit
import Observation
#if os(iOS)
import UIKit
#endif

/// Everything the app's screens read: the account, its vaults and cards, and sync. As the web app's `CardsContext`.
@MainActor
@Observable
final class AppModel {
    enum Phase { case loading, signedOut, signedIn }

    private(set) var phase: Phase = .loading
    private(set) var account: Account? {
        didSet { cachedAPI = nil }
    }
    private(set) var vaults: [Vault] = []
    private(set) var shared: [SharedCard] = []
    /// Every card on the device, sealed ones too: `index` keeps locked ones out of every list.
    private(set) var cards: [Card] = [] {
        didSet { cardsVersion += 1 }
    }
    /// Goes up each time `cards` changes: a cheap thing for a view to watch instead of every card.
    private(set) var cardsVersion = 0
    /// Derived from the cards, with locked vaults' cards left out.
    private(set) var index = CardIndex() {
        didSet { cachedSearch = nil }
    }
    /// The cards have been read once: until then the journal is empty because it hasn't been read, not because it is.
    private(set) var loaded = false
    /// Search over `index`, built when first asked for after it changes rather than on every keystroke.
    var search: CardSearch {
        if let cachedSearch { return cachedSearch }
        let made = CardSearch(index)
        cachedSearch = made
        return made
    }
    @ObservationIgnored private var cachedSearch: CardSearch?
    /// The vaults each card is shared into besides its own.
    private(set) var sharedInto: SharedInto = [:]
    /// Open comments on each card.
    private(set) var commentCounts: [String: Int] = [:]
    /// Entries changed here that the server doesn't have yet, as the web marks them.
    private(set) var unsynced: Set<String> = []
    /// Private vaults opened with their PIN on this device, until the app locks them again.
    private(set) var openVaults: Set<String> = []
    /// Locking open vaults by themselves and slowing PIN guesses, as the web's `VaultLocks` (`VaultGuard.swift`).
    @ObservationIgnored var idleLock: Task<Void, Never>?
    @ObservationIgnored var pinFailures = 0
    @ObservationIgnored var pinBlockedUntil = Date.distantPast
    private(set) var sync: SyncEngine?
    /// What a toast says, with an action to undo, for a moment.
    var toast: Toast?
    /// The page shown, and the entry open over it.
    var page: Page = .journal(StreamFilter())
    var openEntry: String?
    /// A panel an entry's menu opened: its tags, due date, vaults or sharing.
    var panel: EntryPanel?
    /// A file opened to look at, on a phone.
    var preview: URL?
    /// The photo viewer, over the whole window.
    var viewer: ViewerRequest?
    /// The entry the journal box saved last, to scroll to.
    var lastSaved: String?
    /// Set by the Mac's New Note command and the sidebar's button: the journal box takes focus.
    var focusBox = 0
    /// Text pasted in the journal outside a text field, for the writing box to take as if pasted there, as the web's.
    var pastedToBox: String?
    /// Turns the focused entry's pages: the entry, and which way, counted so each press is seen.
    var turnPage: (id: String, by: Int, n: Int)?
    /// The search over everything (Cmd+K).
    var showPalette = false
    /// View only, for reading without changing anything by mistake.
    var viewOnly = false
    private(set) var today = DateKey.today() {
        didSet { if today != oldValue { scheduleNewDay() } }
    }
    @ObservationIgnored private var dayTimer: Timer?

    /// Moves `today` on at midnight, as the web's `useToday`, so "Yesterday" and what's due stay right in an app left
    /// open overnight.
    func scheduleNewDay() {
        dayTimer?.invalidate()
        let next = Calendar.current.startOfDay(for: Date().addingTimeInterval(86_400)).addingTimeInterval(1)
        dayTimer = Timer(fire: next, interval: 0, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.newDay() }
        }
        RunLoop.main.add(dayTimer!, forMode: .common)
    }

    /// The day as it is now; also called as the app comes back to the front.
    func newDay() {
        let now = DateKey.today()
        if now != today { today = now } else { scheduleNewDay() }
    }

    /// The signed-in account's own database on this device; each account has one.
    private(set) var repo: Repository
    /// Every account signed in on this device, the newest sign-in first.
    private(set) var accounts: [Account] = []
    /// Shows the sign-in to add another account.
    var addingAccount = false
    private let site: URL
    /// A refresh is running for local changes, and whether another change came after it started.
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var refreshAgain = false
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    /// The page `-page` asks for at launch, shown once the account opens.
    @ObservationIgnored private var launchPage: Page?

    init(site: URL = ServerAPI.production) {
        self.site = site
        // `-page vaults` at launch opens on that page, for testing.
        if let key = UserDefaults.standard.string(forKey: "page"), let named = Page.destinations.first(where: { $0.key == key }) { launchPage = named.page }
        repo = try! Repository(path: ":memory:")
        Task { await start() }
    }

    private static let accountKey = "account"
    private static let accountsKey = "accounts"
    static let folder: URL = {
        let f = URL.applicationSupportDirectory.appending(path: "Notes", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: f, withIntermediateDirectories: true)
        return f
    }()

    /// An account's own database on this device.
    static func database(for id: String) -> String { folder.appending(path: "notes-\(id).sqlite").path }

    private func saveAccounts() { UserDefaults.standard.set(try? JSONEncoder().encode(accounts), forKey: Self.accountsKey) }

    private func start() async {
        accounts = (UserDefaults.standard.data(forKey: Self.accountsKey)).flatMap { try? JSONDecoder().decode([Account].self, from: $0) } ?? []
        // From before several accounts could be signed in: the one account, its token and its database move over.
        if accounts.isEmpty, let data = UserDefaults.standard.data(forKey: Self.accountKey), let saved = try? JSONDecoder().decode(Account.self, from: data) {
            if let token = Keychain.token() {
                Keychain.save(token, for: saved.id)
                cachedAPI = nil
                Keychain.clear(for: "session")
            }
            // SQLite keeps recent writes in a -wal file beside the database: all three move together.
            let old = Self.folder.appending(path: "notes.sqlite").path
            let new = Self.database(for: saved.id)
            if FileManager.default.fileExists(atPath: old), !FileManager.default.fileExists(atPath: new) {
                for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: old + suffix) {
                    try? FileManager.default.moveItem(atPath: old + suffix, toPath: new + suffix)
                }
            }
            accounts = [saved]
            saveAccounts()
            UserDefaults.standard.removeObject(forKey: Self.accountKey)
        }
        let current = UserDefaults.standard.string(forKey: "currentAccount")
        if let account = accounts.first(where: { $0.id == current }) ?? accounts.first, let token = Keychain.token(for: account.id) {
            await open(account: account, token: token)
        } else {
            phase = .signedOut
        }
    }

    /// Opens an account's database and starts syncing it.
    private func open(account: Account, token: String) async {
        sync = nil
        openVaults = []
        repo.keyring.forgetAll()
        repo = try! Repository(path: Self.database(for: account.id))
        await repo.onChange { [weak self] in
            Task { @MainActor in self?.changed() }
        }
        UserDefaults.standard.set(account.id, forKey: "currentAccount")
        page = launchPage ?? .journal(StreamFilter())
        launchPage = nil
        await begin(account: account, token: token)
    }

    /// Switches to another account signed in on this device.
    func switchTo(_ account: Account) {
        guard account.id != self.account?.id, let token = Keychain.token(for: account.id) else { return }
        Task { await open(account: account, token: token) }
    }

    private func begin(account: Account, token: String) async {
        self.account = account
        await repo.setMainVault("vault-\(account.id)")
        if let id = try? await repo.deviceId() { device = (id, Self.deviceName) }
        let engine = SyncEngine(repo: repo, api: ServerAPI(site: site, token: token, device: device))
        sync = engine
        Drafts.shared.accountId = account.id
        Drafts.shared.api = ServerAPI(site: site, token: token, device: device)
        phase = .signedIn
        await refresh()
        await engine.sync()
        if engine.state == .signedOut { signOut() }
    }

    /// Signed in, on its own or as another account: it goes first in the list, and is opened.
    func signedIn(_ info: SessionInfo, token: String) async {
        Keychain.save(token, for: info.user.id)
        cachedAPI = nil
        accounts = [info.user] + accounts.filter { $0.id != info.user.id }
        saveAccounts()
        addingAccount = false
        repo = try! Repository(path: Self.database(for: info.user.id))
        _ = try? await repo.applyAccess(vaults: info.vaults, shared: [])
        await open(account: info.user, token: token)
    }

    /// Signs this account out of this device: its database, token and drafts go. Another account signed in here is
    /// opened instead, if there is one.
    func signOut() {
        guard let leaving = account else { return }
        Drafts.shared.forget()
        let token = Keychain.token(for: leaving.id)
        Keychain.clear(for: leaving.id)
        accounts.removeAll { $0.id == leaving.id }
        saveAccounts()
        let old = repo
        // Its photos and files on this device: what its cards hold, read before they go.
        let held = Set(cards.flatMap { c in ([c.content] + c.morePages).flatMap { p in Doc.photoIds(p) + Doc.files(p).flatMap { [$0.id] + ($0.poster.map { [$0] } ?? []) } } })
        account = nil
        sync = nil
        cards = []
        index = CardIndex()
        indexed = ([], [])
        vaults = []
        openVaults = []
        page = .journal(StreamFilter())
        // Its todos remind no more; the next account's are scheduled once it opens.
        Reminders.reschedule(index)
        Attachments.shared.forgetThumbnails()
        Task {
            if let token { await ServerAPI(site: site, token: token).signOut() }
            try? await old.clear()
            Attachments.shared.forget(account: leaving.id, ids: held)
            // SQLite's write-ahead log and its index go with it.
            for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: Self.database(for: leaving.id) + suffix) }
            if let next = accounts.first, let t = Keychain.token(for: next.id) { await open(account: next, token: t) } else { phase = .signedOut }
        }
    }

    /// The server, as the open account. Kept once made, so the token is read from the Keychain only when the
    /// account or this device's ID changes, not on every use.
    var api: ServerAPI {
        if let cachedAPI { return cachedAPI }
        let made = ServerAPI(site: site, token: account.flatMap { Keychain.token(for: $0.id) }, device: device)
        cachedAPI = made
        return made
    }
    @ObservationIgnored private var cachedAPI: ServerAPI?
    @ObservationIgnored private var device: (id: String, name: String)? {
        didSet { cachedAPI = nil }
    }

    /// What this device calls itself in the history its account sees, as the web's "Safari on Mac".
    static var deviceName: String {
        #if os(macOS)
        return "Notes app on Mac"
        #else
        return UIDevice.current.userInterfaceIdiom == .pad ? "Notes app on iPad" : "Notes app on iPhone"
        #endif
    }
    var accountId: String { account?.id ?? "" }

    // MARK: Cards

    /// Local changes refresh the screens at once and sync shortly after.
    private func changed() {
        sync?.schedule()
        // A change made while a refresh is running may come after it read the cards, so one more runs after it.
        guard !refreshing else {
            refreshAgain = true
            return
        }
        refreshing = true
        refreshTask = Task {
            repeat {
                refreshAgain = false
                await refresh()
            } while refreshAgain
            refreshing = false
        }
    }

    /// Waits until the screens show the changes made so far, without reading everything again itself.
    func caughtUp() async {
        // The repository's change note reaches the main actor as a task of its own: let it start first.
        await Task.yield()
        await refreshTask?.value
    }

    /// Reads the cards and vaults again. Only what changed is set, so screens redraw only for it, and the index is
    /// built off the main thread, only when a card or what's locked changed.
    func refresh() async {
        refreshes += 1
        let run = refreshes
        guard let all = try? await repo.allCards(), let vaults = try? await repo.vaults() else { return }
        let shared = (try? await repo.sharedCards()) ?? []
        var into: SharedInto = [:]
        for share in (try? await repo.vaultShares()) ?? [] { into[share.card_id, default: []].append(share.vault_id) }
        let counts = (try? await repo.commentCounts()) ?? [:]
        let waiting = (try? await repo.unsyncedIds()) ?? []
        let sorted = vaults.sorted { ($0.created_at, $0.id) < ($1.created_at, $1.id) }
        // A newer refresh has begun: it sets everything.
        guard run == refreshes else { return }
        setIfChanged(\.today, DateKey.today())
        setIfChanged(\.vaults, sorted)
        setIfChanged(\.shared, shared)
        setIfChanged(\.sharedInto, into)
        setIfChanged(\.commentCounts, counts)
        setIfChanged(\.unsynced, waiting)
        let marks = all.map(CardMark.init)
        let locked = lockedVaults
        guard marks != indexed.marks || locked != indexed.locked else {
            loaded = true
            return
        }
        let index = await Task.detached(priority: .userInitiated) { CardIndex(all, locked: locked) }.value
        guard run == refreshes else { return }
        indexed = (marks, locked)
        cards = all
        self.index = index
        loaded = true
        Transcriber.shared.apply(model: self)
        Reminders.reschedule(index)
    }

    /// What tells one version of a card from another without comparing its whole body.
    private struct CardMark: Equatable {
        let id: String, vaultId: String, updatedAt: Int64, seq: Int64, deleted: Bool, sealed: Bool
        init(_ c: Card) { (id, vaultId, updatedAt, seq, deleted, sealed) = (c.id, c.vaultId, c.updatedAt, c.seq, c.deleted, c.sealed) }
    }
    @ObservationIgnored private var indexed: (marks: [CardMark], locked: Set<String>) = ([], [])
    @ObservationIgnored private var refreshes = 0

    private func setIfChanged<T: Equatable>(_ key: ReferenceWritableKeyPath<AppModel, T>, _ value: T) {
        if self[keyPath: key] != value { self[keyPath: key] = value }
    }

    /// Opens a private vault on this device: its cards show until the app locks again.
    func open(_ vaultId: String) async {
        openVaults.insert(vaultId)
        touchVaults()
        // Edits made before this device knew the vault's key are encrypted and pushed now.
        sync?.schedule(after: 0.2)
        await refresh()
        // Encrypting it may have stopped partway on this device: what's left is done now.
        Task { _ = await VaultEncryption(model: self).finishEncrypting(vaultId) }
    }

    /// Locks one private vault again and forgets its key.
    func lock(_ vaultId: String) {
        openVaults.remove(vaultId)
        repo.keyring.forget(vaultId)
        Attachments.shared.forgetThumbnails()
        Task { await refresh() }
    }

    /// Locks every private vault again and forgets their keys.
    func lockAll() {
        idleLock?.cancel()
        idleLock = nil
        openVaults = []
        repo.keyring.forgetAll()
        Attachments.shared.forgetThumbnails()
        Task { await refresh() }
    }

    /// Vaults with a PIN that this device hasn't opened. Their cards never reach a screen.
    /// The vaults the app shows: a hidden one stays out until its PIN is entered.
    var shownVaults: [Vault] { vaults.filter { !$0.hidden || openVaults.contains($0.id) } }

    var lockedVaults: Set<String> {
        Set(vaults.filter { $0.isPrivate && !openVaults.contains($0.id) }.map(\.id))
    }

    func card(_ id: String) -> Card? { index.byId[id] }
    func vault(_ id: String) -> Vault? { vaults.first { $0.id == id } }
    var mainVault: Vault? { vaults.first { $0.isDefault(of: accountId) } ?? vaults.first }
    var diaryVault: Vault? { vaults.first { $0.isDiary(of: accountId) } }

    /// Whether this account may change the card: its role in the card's vault, or the share that reached it, and not
    /// set to view only.
    func canEdit(_ card: Card) -> Bool {
        if viewOnly || card.viewOnly { return false }
        return canWrite(card)
    }

    /// Whether this account could change it, view only aside: who may turn the card's view only on and off.
    func canWrite(_ card: Card) -> Bool {
        if let vault = vault(card.vaultId) { return vault.role != .viewer }
        return shared.first { $0.card_id == card.id }?.role == .edit
    }

    /// Whether this account may comment on the card, as the web's `useCanComment`: once it's on the server, in a vault
    /// with other people in it, or shared with this account to comment or edit.
    func canComment(_ card: Card) -> Bool {
        guard card.seq > 0 else { return false }
        if let vault = vault(card.vaultId) { return (vault.members ?? 1) > 1 }
        guard let share = shared.first(where: { $0.card_id == card.id }) else { return false }
        return share.role != .view
    }

    /// Trash it or move it to another vault: members of its vault only.
    func canManage(_ card: Card) -> Bool {
        guard !viewOnly, !card.viewOnly, let vault = vault(card.vaultId) else { return false }
        return vault.role != .viewer
    }

    func title(of id: String, fallback: String) -> String { index.linkTitle(id, fallback: fallback) }

    /// The names of the vaults an entry is in: its own, then those it's shared into.
    func vaultNames(_ card: Card) -> [String] {
        ([card.vaultId] + (sharedInto[card.id] ?? [])).compactMap { vault($0)?.name }
    }

    var saveContext: SaveContext {
        SaveContext(accountId: accountId, vaults: vaults, locked: lockedVaults, index: index, sharedInto: sharedInto)
    }

    // MARK: Changes

    func perform(_ work: @escaping @Sendable (Repository) async throws -> Void) {
        Task {
            do { try await work(repo) } catch { print("Change failed: \(error)") }
        }
    }

    /// Changes one card, as an action of its own; `typed` folds it into the typing just before, as typing is logged.
    func update(_ id: String, typed: Bool = false, _ change: @escaping @Sendable (inout Card) -> Void) {
        perform { _ = try await $0.update(id, typed: typed, change) }
    }

    /// Does `work` to each entry as one action to undo (it's given the repository, the entry and the action), then
    /// says `done` with an Undo.
    func performEach(_ ids: [String], say done: String, _ work: @escaping @Sendable (Repository, String, String) async throws -> Void) {
        let group = repo.action()
        perform { repo in for id in ids { try await work(repo, id, group) } }
        say(done, undoable: true)
    }

    /// Shows a toast, with Undo when `undoable`, which takes back the last action.
    func say(_ message: String, undoable: Bool = false) {
        toast = Toast(message: message, undo: undoable)
    }

    func undo() {
        perform { repo in
            let n = try await repo.undo()
            await MainActor.run { if n == 0 { self.say("Nothing to undo") } }
        }
    }

    func redo() {
        perform { repo in
            let n = try await repo.redo()
            await MainActor.run { if n == 0 { self.say("Nothing to redo") } }
        }
    }

    /// Ticks a todo or opens it again, saying when a repeating one is due next. On a board by a group with a Done
    /// tag, it moves into Done, or out of it, as dragging it there does.
    func setDone(_ card: Card, _ done: Bool) {
        let id = card.id
        let today = today
        let groups = index.tagGroups.groups
        perform { repo in
            let at = Repository.milliseconds()
            let updated = try await repo.update(id) { c in
                if done {
                    if c.complete(today: today, at: at) == nil { c.tags = Board.tagsForStatus(c.tags, groups: groups, done: true) }
                } else {
                    c.reopen()
                    c.tags = Board.tagsForStatus(c.tags, groups: groups, done: false)
                }
            }
            if done, let updated, updated.repeat != nil, let next = updated.due {
                await MainActor.run { self.say("Next due \(DateKey.relativeDayInSentence(next, today: today))", undoable: true) }
            }
        }
    }

    /// Saves typed text as entries. Returns false when a vault they need is locked, leaving the text to keep.
    func save(_ entries: [Entry], _ opts: SaveOptions) async -> SaveResult {
        guard !viewOnly else {
            say("View only is on. Turn it off to change anything.")
            return .nothing
        }
        let context = saveContext
        do {
            return try await repo.save(entries, opts, in: context)
        } catch {
            say("Couldn't save: \(error.localizedDescription)")
            return .nothing
        }
    }
}

struct Toast: Equatable, Identifiable {
    let id = UUID()
    var message: String
    var undo: Bool
    /// An entry the toast offers to open, as the web's Open on a new note.
    var open: String? = nil
}

/// What the main column shows.
enum Page: Hashable {
    case journal(StreamFilter)
    case trash
    case history
    case calendar
    case timeline
    case photos
    case links
    case files
    case tags
    case vaults
    case settings

    var filter: StreamFilter? {
        if case .journal(let f) = self { return f }
        return nil
    }

    /// A page to go to by name: from the sidebar, the command palette, or `-page` at launch.
    struct Destination {
        let key: String
        let title: String
        let icon: String
        let page: Page
        /// In the sidebar's list of pages; the others are reached from the palette, or (tags, vaults) their own sections.
        var listed = true
    }

    /// Every page with a name, in the sidebar's order.
    static let destinations: [Destination] = [
        .init(key: "journal", title: "Journal", icon: "doc.text", page: .journal(StreamFilter())),
        .init(key: "today", title: "Today", icon: "sun.max", page: .journal(StreamFilter(status: .today)), listed: false),
        .init(key: "upcoming", title: "Upcoming", icon: "calendar.badge.clock", page: .journal(StreamFilter(status: .upcoming)), listed: false),
        .init(key: "history", title: "History", icon: "clock.arrow.circlepath", page: .history),
        .init(key: "calendar", title: "Calendar", icon: "calendar", page: .calendar),
        .init(key: "timeline", title: "Timeline", icon: "align.horizontal.left", page: .timeline),
        .init(key: "photos", title: "Photos", icon: "photo", page: .photos),
        .init(key: "links", title: "Links", icon: "link", page: .links),
        .init(key: "files", title: "Files", icon: "doc", page: .files),
        .init(key: "archive", title: "Archive", icon: "archivebox", page: .journal(StreamFilter(archived: true))),
        .init(key: "templates", title: "Templates", icon: "doc.on.doc", page: .journal(StreamFilter(template: true)), listed: false),
        .init(key: "trash", title: "Trash", icon: "trash", page: .trash),
        .init(key: "tags", title: "All tags", icon: "tag", page: .tags, listed: false),
        .init(key: "vaults", title: "Manage vaults", icon: "square.stack.3d.up", page: .vaults, listed: false),
        .init(key: "settings", title: "Backup & settings", icon: "slider.horizontal.3", page: .settings, listed: false),
    ]

    static func destination(_ key: String) -> Destination { destinations.first { $0.key == key }! }
}

extension AppModel {
    /// Once a minute while the app is open, with photos and files still waiting to go up.
    func syncPeriodically() async {
        while !Task.isCancelled {
            await Attachments.shared.upload(model: self)
            await Drafts.shared.sync()
            await AttachmentKeeper.shared.sweep(model: self)
            try? await Task.sleep(for: .seconds(60))
            await sync?.sync()
        }
    }
}
