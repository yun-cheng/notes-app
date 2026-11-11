import Foundation
import NotesKit
import Observation

/// Everything the app's screens read: the account, its vaults and cards, and sync.
@MainActor
@Observable
final class AppModel {
    enum Phase { case loading, signedOut, signedIn }

    private(set) var phase: Phase = .loading
    private(set) var account: Account?
    private(set) var vaults: [Vault] = []
    private(set) var shared: [SharedCard] = []
    /// Every card on the device that isn't in a locked vault.
    private(set) var cards: [Card] = []
    /// Private vaults opened with their PIN on this device, until the app locks them again.
    private(set) var openVaults: Set<String> = []
    private(set) var sync: SyncEngine?
    /// Bumped by the Mac's New Note command.
    var newNoteRequests = 0

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
        let engine = SyncEngine(repo: repo, api: ServerAPI(site: site, token: token))
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
        vaults = []
        openVaults = []
        phase = .signedOut
        Task {
            if let token { await ServerAPI(site: site, token: token).signOut() }
            try? await repo.clear()
        }
    }

    var api: ServerAPI { ServerAPI(site: site, token: Keychain.token()) }

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
        self.vaults = vaults.sorted { ($0.created_at, $0.id) < ($1.created_at, $1.id) }
        shared = (try? await repo.sharedCards()) ?? []
        let locked = lockedVaults
        cards = all.filter { !locked.contains($0.vaultId) && !$0.sealed }
    }

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

    var live: [Card] {
        cards.filter { !$0.deleted && !$0.isBlank }.sorted { $0.updatedAt > $1.updatedAt }
    }

    var notes: [Card] { live.filter { $0.type == .note } }
    var todos: [Card] { live.filter { $0.type == .todo } }
    var tags: [Card] { live.filter { $0.type == .tag }.sorted { $0.title.localizedCompare($1.title) == .orderedAscending } }
    var trash: [Card] { cards.filter(\.deleted).sorted { $0.updatedAt > $1.updatedAt } }

    func card(_ id: String) -> Card? { cards.first { $0.id == id } }

    /// The newest diary entry for each day.
    var diary: [String: Card] {
        var out: [String: Card] = [:]
        for card in live where card.type == .diary {
            if let seen = out[card.date], seen.updatedAt >= card.updatedAt { continue }
            out[card.date] = card
        }
        return out
    }

    /// The vault new diary entries go into: this account's first private one, if there is one.
    var diaryVault: Vault? {
        vaults.filter { $0.isPrivate && $0.isOwner }.min { $0.created_at < $1.created_at }
    }

    /// The diary is locked when its vault is.
    var diaryLocked: Bool { diaryVault.map { lockedVaults.contains($0.id) } ?? false }

    func vault(_ id: String) -> Vault? { vaults.first { $0.id == id } }

    /// Whether this account may change the card: its role in the card's vault, or the share that reached it.
    func canEdit(_ card: Card) -> Bool {
        if let vault = vault(card.vaultId) { return vault.role != .viewer }
        return shared.first { $0.card_id == card.id }?.role == .edit
    }

    func title(of id: String, fallback: String) -> String {
        guard let card = card(id) else { return "Not shared" }
        return card.deleted ? fallback : card.displayTitle
    }

    // MARK: Changes

    func perform(_ work: @escaping @Sendable (Repository) async throws -> Void) {
        Task {
            do { try await work(repo) } catch { print("Change failed: \(error)") }
        }
    }
}
