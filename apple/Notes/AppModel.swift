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
    private(set) var account: Account?
    private(set) var vaults: [Vault] = []
    private(set) var shared: [SharedCard] = []
    /// Every card on the device, sealed ones too: `index` keeps locked ones out of every list.
    private(set) var cards: [Card] = []
    /// Derived from the cards, with locked vaults' cards left out.
    private(set) var index = CardIndex()
    /// The vaults each card is shared into besides its own.
    private(set) var sharedInto: SharedInto = [:]
    /// Open comments on each card.
    private(set) var commentCounts: [String: Int] = [:]
    /// Private vaults opened with their PIN on this device, until the app locks them again.
    private(set) var openVaults: Set<String> = []
    private(set) var sync: SyncEngine?
    /// What a toast says, with an action to undo, for a moment.
    var toast: Toast?
    /// The page shown, and the entry open over it.
    var page: Page = .journal(StreamFilter())
    var openEntry: String?
    /// A panel an entry's menu opened: its tags, due date, vaults or sharing.
    var panel: EntryPanel?
    /// The entry the journal box saved last, to scroll to.
    var lastSaved: String?
    /// Set by the Mac's New Note command and the sidebar's button: the journal box takes focus.
    var focusBox = 0
    /// The search over everything (Cmd+K).
    var showPalette = false
    /// View only, for reading without changing anything by mistake.
    var viewOnly = false
    private(set) var today = DateKey.today()

    let repo: Repository
    private let site: URL
    private var refreshQueued = false

    init(site: URL = ServerAPI.production) {
        self.site = site
        let folder = URL.applicationSupportDirectory.appending(path: "Notes", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        repo = try! Repository(path: folder.appending(path: "notes.sqlite").path)
        Task { await start() }
    }

    private static let accountKey = "account"

    private func start() async {
        await repo.onChange { [weak self] in
            Task { @MainActor in self?.changed() }
        }
        if let token = Keychain.token(), let data = UserDefaults.standard.data(forKey: Self.accountKey),
            let saved = try? JSONDecoder().decode(Account.self, from: data)
        {
            await begin(account: saved, token: token)
        } else {
            phase = .signedOut
        }
    }

    private func begin(account: Account, token: String) async {
        self.account = account
        await repo.setMainVault("vault-\(account.id)")
        if let id = try? await repo.deviceId() { device = (id, Self.deviceName) }
        let engine = SyncEngine(repo: repo, api: ServerAPI(site: site, token: token, device: device))
        sync = engine
        phase = .signedIn
        await refresh()
        await engine.sync()
        if engine.state == .signedOut { signOut() }
    }

    func signedIn(_ info: SessionInfo, token: String) async {
        Keychain.save(token)
        UserDefaults.standard.set(try? JSONEncoder().encode(info.user), forKey: Self.accountKey)
        // Another account's cards must not stay on this device.
        if let previous = account, previous.id != info.user.id { try? await repo.clear() }
        _ = try? await repo.applyAccess(vaults: info.vaults, shared: [])
        await begin(account: info.user, token: token)
    }

    func signOut() {
        let token = Keychain.token()
        Keychain.clear()
        UserDefaults.standard.removeObject(forKey: Self.accountKey)
        account = nil
        sync = nil
        cards = []
        index = CardIndex()
        vaults = []
        openVaults = []
        page = .journal(StreamFilter())
        phase = .signedOut
        Task {
            if let token { await ServerAPI(site: site, token: token).signOut() }
            try? await repo.clear()
        }
    }

    var api: ServerAPI { ServerAPI(site: site, token: Keychain.token(), device: device) }
    @ObservationIgnored private var device: (id: String, name: String)?

    /// What this device calls itself in the history its account sees, as the web's "Safari on Mac".
    static var deviceName: String {
        #if os(macOS)
        return "Notes app on Mac"
        #else
        return UIDevice.current.userInterfaceIdiom == .pad ? "Notes app on iPad" : "Notes app on iPhone"
        #endif
    }
    var siteURL: URL { site }
    var accountId: String { account?.id ?? "" }

    // MARK: Cards

    /// Local changes refresh the screens at once and sync shortly after.
    private func changed() {
        sync?.schedule()
        guard !refreshQueued else { return }
        refreshQueued = true
        Task {
            await refresh()
            refreshQueued = false
        }
    }

    func refresh() async {
        guard let all = try? await repo.allCards(), let vaults = try? await repo.vaults() else { return }
        today = DateKey.today()
        self.vaults = vaults.sorted { ($0.created_at, $0.id) < ($1.created_at, $1.id) }
        shared = (try? await repo.sharedCards()) ?? []
        var into: SharedInto = [:]
        for share in (try? await repo.vaultShares()) ?? [] { into[share.card_id, default: []].append(share.vault_id) }
        sharedInto = into
        commentCounts = (try? await repo.commentCounts()) ?? [:]
        cards = all
        index = CardIndex(all, locked: lockedVaults)
    }

    /// Opens a private vault on this device: its cards show until the app locks again.
    func open(_ vaultId: String) async {
        openVaults.insert(vaultId)
        // Edits made before this device knew the vault's key are encrypted and pushed now.
        sync?.schedule(after: 0.2)
        await refresh()
    }

    /// Locks every private vault again and forgets their keys.
    func lockAll() {
        openVaults = []
        repo.keyring.forgetAll()
        Task { await refresh() }
    }

    /// Vaults with a PIN that this device hasn't opened. Their cards never reach a screen.
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
}

extension AppModel {
    /// Once a minute while the app is open.
    func syncPeriodically() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            await sync?.sync()
        }
    }
}
