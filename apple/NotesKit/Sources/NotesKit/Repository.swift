import Foundation

/// All card reads and writes go through here, one at a time. Mirrors the web app's `CardRepository`.
public actor Repository {
    private let store: CardStore
    public nonisolated let keyring: Keyring
    private let now: @Sendable () -> Int64
    private let newId: @Sendable () -> String
    /// The account's own main vault, which new cards go into.
    private var mainVaultId: String?
    private var changeHandler: (@Sendable () -> Void)?

    public static let milliseconds: @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }

    /// `path` is the SQLite file, or ":memory:".
    public init(
        path: String, keyring: Keyring = Keyring(), now: @escaping @Sendable () -> Int64 = Repository.milliseconds,
        newId: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }
    ) throws {
        store = try CardStore(path: path)
        self.keyring = keyring
        self.now = now
        self.newId = newId
        keyring.setVaults(try store.listVaults())
    }

    /// Called after any local change, so sync can be scheduled and the UI refreshed.
    public func onChange(_ handler: @escaping @Sendable () -> Void) { changeHandler = handler }

    public func setMainVault(_ id: String?) { mainVaultId = id }

    // MARK: Reading

    func decode(_ r: CardRecord) -> Card {
        if let payload = keyring.decode(r.payload, id: r.id, vaultId: r.vault_id) {
            return Card(id: r.id, vaultId: r.vault_id, updatedAt: r.updated_at, deleted: r.deleted, seq: r.seq, payload: modernPayload(payload))
        }
        let payload: [String: JSONValue] = ["type": "note", "title": "", "tags": [], "content": Doc.empty]
        return Card(id: r.id, vaultId: r.vault_id, updatedAt: r.updated_at, deleted: r.deleted, seq: r.seq, payload: payload, sealed: true)
    }

    /// A payload from the server's history, opened with the vault's key when it's encrypted. Nil when it can't be.
    public nonisolated func openPayload(_ payload: String, id: String, vaultId: String) -> [String: JSONValue]? {
        keyring.decode(payload, id: id, vaultId: vaultId).map { modernPayload($0) }
    }

    public func allCards() throws -> [Card] { try store.listCards().map(decode) }

    public func card(_ id: String) throws -> Card? { try store.getCard(id).map(decode) }

    public func vaults() throws -> [Vault] { try store.listVaults() }

    /// Saves vaults as changed here. One no longer withheld has its cards pulled again, as they're older than the cursor.
    public func putVaults(_ vaults: [Vault]) throws {
        let known = Dictionary(try store.listVaults().map { ($0.id, $0) }) { a, _ in a }
        try store.putVaults(vaults)
        keyring.setVaults(try store.listVaults())
        if vaults.contains(where: { !$0.isWithheld && (known[$0.id]?.isWithheld ?? false) }) { try store.setMeta("cursor", Int64(0)) }
        changeHandler?()
    }

    /// Stores a card from a backup as it is, to be pushed.
    func putImported(_ card: Card) throws {
        try store.putCards([encode(card)])
        changeHandler?()
    }

    /// Rewrites a card from what it holds now, if `change` changes it; not logged, as a reseal isn't the user's edit.
    public func rewrite(_ id: String, _ change: @Sendable (inout Card) -> Void) throws {
        guard var card = try card(id), !card.sealed else { return }
        let before = card
        change(&card)
        guard card != before else { return }
        card.updatedAt = now()
        try write(card)
    }

    // MARK: Writing

    private func encode(_ card: Card) throws -> CardRecord {
        precondition(!card.sealed, "A locked card can't be saved")
        return CardRecord(
            id: card.id, vault_id: card.vaultId, updated_at: card.updatedAt, deleted: card.deleted, seq: card.seq,
            payload: try keyring.encode(card.payload, id: card.id, vaultId: card.vaultId))
    }

    /// The change log keeps 500 changes, trimmed every 50. Typing saves join one change while they come within five
    /// minutes of each other and half an hour of its start.
    static let logLimit = 500
    static let trimEvery = 50
    static let joinGap: Int64 = 5 * 60_000
    static let joinSpan: Int64 = 30 * 60_000
    private var logged = 0
    private var lastCreated: Int64 = 0

    /// A new action: changes written under it are undone together.
    public nonisolated func action() -> String { UUID().uuidString.lowercased() }

    /// Saves a card. With a `group`, the change from `before` goes in the change log; `typed` lets typing join it.
    @discardableResult
    private func write(_ card: Card, group: String? = nil, typed: Bool = false, before: Card? = nil) throws -> Card {
        let record = try encode(card)
        let prior = group == nil ? nil : try store.getCard(card.id)
        try store.putCards([record])
        if let group { try? log(group: group, typed: typed, prior: prior, before: before ?? prior.map(decode), card: card, record: record) }
        changeHandler?()
        return card
    }

    private func log(group: String, typed explicitTyped: Bool, prior: CardRecord?, before: Card?, card: Card, record: CardRecord) throws {
        // A card opened and left empty isn't there yet as far as the user can tell, so its first words make it.
        let made = prior == nil || before == nil || before!.isBlank
        if made && card.isBlank { return }
        let fields = made ? [] : Changes.changed(before!, card)
        if !made && fields.isEmpty { return }
        let typed = explicitTyped && (made || Changes.isTextChange(fields))
        let at = card.updatedAt

        if typed && !made, var last = try store.lastChange(), last.joins == true, last.undoneAt == nil, last.cardId == card.id,
            last.after.updated_at == prior!.updated_at, last.after.vault_id == record.vault_id, at - last.until <= Self.joinGap,
            at - last.at <= Self.joinSpan
        {
            if last.before != nil { last.fields = Array(Set(last.fields + fields)).sorted() }
            last.after = record
            last.until = at
            try store.putChange(last)
            return
        }
        var entry = ChangeEntry(at: at, until: at, group: group, cardId: card.id, before: made ? nil : prior, after: record, fields: fields)
        if typed { entry.joins = true }
        if let prior, !made, prior.vault_id != record.vault_id, var moved = before {
            // Stored the way its new vault stores cards, so a move into an encrypted vault leaves nothing readable here.
            entry.beforeVault = prior.vault_id
            moved.vaultId = record.vault_id
            entry.before = try? encode(moved)
        }
        try store.putChange(entry)
        if entry.beforeVault != nil, keyring.isEncrypted(record.vault_id) {
            try store.deleteChanges(try store.listChanges().filter { $0.cardId == card.id && !VaultCrypto.isEncrypted($0.after.payload) }.compactMap(\.n))
        }
        logged += 1
        if logged % Self.trimEvery == 0 { try store.trimChanges(Self.logLimit) }
    }

    func defaultVaultId() throws -> String {
        let vaults = try store.listVaults()
        if let id = mainVaultId, vaults.contains(where: { $0.id == id }) { return id }
        if let first = vaults.sorted(by: { $0.created_at < $1.created_at }).first { return first.id }
        throw DatabaseError(description: "No vault yet. Sync first.")
    }

    /// Creation times never repeat, so entries saved together keep the order they were typed in. An entry written
    /// for another day says so in `createdAt`; it was still saved now.
    private func newCard(id: String? = nil, vaultId: String? = nil, createdAt: Int64? = nil, _ fields: [String: JSONValue]) throws -> Card {
        let at = max(now(), lastCreated + 1)
        lastCreated = at
        var payload: [String: JSONValue] = ["createdAt": .int(createdAt ?? at), "title": "", "content": Doc.empty, "tags": []]
        payload.merge(fields) { _, new in new }
        return Card(id: id ?? newId(), vaultId: try vaultId ?? defaultVaultId(), updatedAt: at, deleted: false, seq: 0, payload: payload)
    }

    public nonisolated func newCardId() -> String { UUID().uuidString.lowercased() }

    /// A note, or with `stack`, a stack of those entries. `extra` holds fields like `template` and `color`.
    @discardableResult
    public func createNote(
        id: String? = nil, title: String = "", content: JSONValue = Doc.empty, pages: [JSONValue] = [], stack: [String]? = nil, tags: [String] = [],
        vaultId: String? = nil, createdAt: Int64? = nil, extra: [String: JSONValue] = [:], group: String? = nil
    ) throws -> Card {
        var fields: [String: JSONValue] = ["type": "note", "title": .string(title), "content": content, "tags": .array(tags.map(JSONValue.string))]
        if !pages.isEmpty { fields["pages"] = .array(pages) }
        if let stack { fields["stack"] = .array(stack.map(JSONValue.string)) }
        fields.merge(extra) { _, new in new }
        return try write(newCard(id: id, vaultId: vaultId, createdAt: createdAt, fields), group: group ?? action())
    }

    @discardableResult
    public func createTodo(
        id: String? = nil, title: String, due: String? = nil, dueTime: String? = nil, start: String? = nil, repeat rule: Repeat? = nil,
        content: JSONValue = Doc.empty, pages: [JSONValue] = [], tags: [String] = [], vaultId: String? = nil, done: Bool = false, waiting: Bool = false,
        createdAt: Int64? = nil, extra: [String: JSONValue] = [:], group: String? = nil
    ) throws -> Card {
        var fields: [String: JSONValue] = [
            "type": "todo", "title": .string(title), "content": content, "tags": .array(tags.map(JSONValue.string)),
            "status": done ? "done" : "open", "due": due.map(JSONValue.string) ?? .null, "completedAt": .null,
        ]
        if !pages.isEmpty { fields["pages"] = .array(pages) }
        // Left off when unset, so todos without them look as they always have to the other apps.
        if due != nil, let dueTime { fields["dueTime"] = .string(dueTime) }
        if let start { fields["start"] = .string(start) }
        if due != nil, let rule { fields["repeat"] = rule.json }
        if waiting && !done { fields["waiting"] = true }
        fields.merge(extra) { _, new in new }
        var card = try newCard(id: id, vaultId: vaultId, createdAt: createdAt, fields)
        if done { card.payload["completedAt"] = .int(card.updatedAt) }
        return try write(card, group: group ?? action())
    }

    /// A tag, or with `members`, a tag group. With `vaultId`, a tag kept to that vault; without, one for every vault,
    /// in the account's own vault.
    @discardableResult
    public func createTag(
        id: String? = nil, title: String, vaultId: String? = nil, members: [String]? = nil, choosesOne: Bool = false, ordered: Bool = false, group: String? = nil
    ) throws -> Card {
        var fields: [String: JSONValue] = ["type": "tag", "title": .string(title), "pinned": false]
        if let members {
            fields["members"] = .array(members.map(JSONValue.string))
            fields["choice"] = choosesOne ? "one" : "many"
            fields["ordered"] = .bool(ordered)
        } else if vaultId != nil {
            fields["scope"] = "vault"
        }
        return try write(newCard(id: id, vaultId: vaultId, fields), group: group ?? action())
    }

    /// Applies `change` to the card and saves it, unless nothing changed. `typed` marks an edit of its words, which
    /// joins the one before it in the change log while typing goes on.
    @discardableResult
    public func update(_ id: String, group: String? = nil, typed: Bool = false, _ change: @Sendable (inout Card) -> Void) throws -> Card? {
        guard var card = try card(id), !card.sealed else { return nil }
        let before = card
        change(&card)
        guard card != before else { return card }
        card.updatedAt = now()
        return try write(card, group: group ?? action(), typed: typed && group == nil, before: before)
    }

    /// Ticks a todo, or opens it again. A repeating one moves on to its next due date instead. Returns that date.
    @discardableResult
    public func setDone(_ id: String, _ done: Bool, today: String = DateKey.today(), group: String? = nil) throws -> String? {
        let at = now()
        let updated = try update(id, group: group) { card in
            if done { card.complete(today: today, at: at) } else { card.reopen() }
        }
        return done && updated?.repeat != nil ? updated?.due : nil
    }

    public func retype(_ id: String, to type: CardType, group: String? = nil) throws {
        try update(id, group: group) { $0.retype(type) }
    }

    public func setDeleted(_ id: String, _ deleted: Bool, group: String? = nil) throws {
        try update(id, group: group) { $0.deleted = deleted }
    }

    public func move(_ id: String, toVault vaultId: String, group: String? = nil) throws {
        try update(id, group: group) { $0.vaultId = vaultId }
    }

    /// Keeps a tag to `vaultId`, moving it there so everyone in that vault has it, or with nil makes it one for every
    /// vault, back in the account's own vault. One change, so undo puts back both.
    public func setTagScope(_ id: String, vaultId: String?, group: String? = nil) throws {
        let home = try defaultVaultId()
        try update(id, group: group) { card in
            guard card.type == .tag else { return }
            if let vaultId {
                card.vaultId = vaultId
                card.payload["scope"] = "vault"
            } else {
                card.vaultId = home
                card.payload.removeValue(forKey: "scope")
            }
        }
    }

    /// Stores every readable card in a vault again, after its key was unlocked or its encryption changed.
    public func recodeVault(_ vaultId: String) throws {
        let records = try store.listCards().filter { $0.vault_id == vaultId }.map(decode).filter { !$0.sealed }.map(encode)
        if !records.isEmpty {
            try store.putCards(records)
            changeHandler?()
        }
        // Logged changes are stored the way the vault stored its cards then, which is no longer how it does.
        try store.deleteChanges(try store.listChanges().filter { $0.after.vault_id == vaultId || $0.beforeVault == vaultId }.compactMap(\.n))
    }

    // MARK: The change log

    /// A logged change with its cards readable, if their vault's key is open.
    func decodeChange(_ entry: ChangeEntry) -> Change {
        let after = decode(entry.after)
        var before = entry.before.map(decode)
        if let v = entry.beforeVault { before?.vaultId = v }
        return Change(
            n: entry.n ?? 0, at: entry.at, until: entry.until, group: entry.group, cardId: entry.cardId, before: before, after: after, fields: entry.fields,
            undoneAt: entry.undoneAt, redoneAt: entry.redoneAt, sealed: after.sealed || (before?.sealed ?? false))
    }

    /// The whole log, oldest first, each change with its card as it is now.
    public func changes() throws -> [(change: Change, current: Card?)] {
        var current: [String: Card?] = [:]
        return try store.listChanges().map { entry in
            if current[entry.cardId] == nil { current[entry.cardId] = .some(try card(entry.cardId)) }
            return (decodeChange(entry), current[entry.cardId]!)
        }
    }

    /// Takes logged changes back, or puts undone ones back, and gives the ones it did. A change is left alone when its
    /// card no longer holds what the change (or its undo) left.
    @discardableResult
    public func revert(_ ns: [Int64], undo: Bool) throws -> [Int64] {
        var done: [Int64] = []
        var stamp: Int64?
        for n in Set(ns).sorted(by: undo ? (>) : (<)) {
            guard var entry = try store.getChange(n), let current = try card(entry.cardId), !current.sealed else { continue }
            let change = decodeChange(entry)
            guard undo ? Changes.canUndo(change, current) : Changes.canRedo(change, current) else { continue }
            let at = now()
            var next = Changes.revert(current, change, undo: undo)
            next.updatedAt = at
            guard (try? write(next)) != nil else { continue }
            stamp = stamp ?? at
            if undo {
                entry.undoneAt = stamp
            } else {
                entry.undoneAt = nil
                entry.redoneAt = stamp
            }
            try store.putChange(entry)
            done.append(n)
        }
        return done
    }

    /// Undoes the newest action with anything that can be undone. Returns how many changes it took back.
    @discardableResult
    public func undo() throws -> Int {
        let rows = try changes()
        let current = Dictionary(rows.map { ($0.change.cardId, $0.current) }) { a, _ in a }
        let next = Changes.nextUndo(rows.map(\.change)) { Changes.canUndo($0, current[$0.cardId] ?? nil) }
        return try revert(next.map(\.n), undo: true).count
    }

    @discardableResult
    public func redo() throws -> Int {
        let rows = try changes()
        let current = Dictionary(rows.map { ($0.change.cardId, $0.current) }) { a, _ in a }
        let next = Changes.nextRedo(rows.map(\.change)) { Changes.canRedo($0, current[$0.cardId] ?? nil) }
        return try revert(next.map(\.n), undo: false).count
    }

    /// Takes back a change that came by sync, as undo would; a change of its own in the log, so it can be undone.
    public func takeBack(_ change: Change) throws -> Bool {
        guard let current = try card(change.cardId), !current.sealed, Changes.canUndo(change, current) else { return false }
        var next = Changes.revert(current, change, undo: true)
        next.updatedAt = now()
        try write(next, group: action(), before: current)
        return true
    }

    // MARK: Sync

    /// Records waiting to be pushed. A blank card that never reached the server stays local.
    public func pushable(limit: Int = .max, excluding: Set<String> = []) throws -> [CardRecord] {
        var out: [CardRecord] = []
        for var record in try store.listDirty() where !excluding.contains(record.id) {
            if out.count >= limit { break }
            // Written as plaintext before this device learned the vault is encrypted: encrypt it now, or wait for the key.
            if keyring.isEncrypted(record.vault_id) && !VaultCrypto.isEncrypted(record.payload) {
                guard keyring.hasKey(record.vault_id) else { continue }
                record = try encode(decode(record))
                try store.putCards([record])
            }
            if record.seq == 0 && decode(record).isBlank { continue }
            out.append(record)
        }
        return out
    }

    public func pendingCount() throws -> Int { try pushable().count }

    /// Takes the server's word on what this account can see: its vaults, cards shared with it, and cards shared into
    /// its vaults, which show there too. Cards it can no longer see leave the device. Returns true if access grew, so
    /// everything should be pulled again.
    public func applyAccess(vaults: [Vault], shared: [SharedCard], vaultShares: [VaultShare] = []) throws -> Bool {
        if (try store.getMeta("vaultShares", as: [VaultShare].self) ?? []) != vaultShares { try store.setMeta("vaultShares", vaultShares) }
        let known = try store.listVaults()
        let knownShared = try store.getMeta("shared", as: [SharedCard].self) ?? []
        // A vault withheld until this account sets the PIN its owner asks for is listed, but its cards aren't here.
        let vaultIds = Set(vaults.filter { !$0.isWithheld }.map(\.id))
        let sharedIds = Set(shared.map(\.card_id))
        let outOfReach = { (r: CardRecord) in !vaultIds.contains(r.vault_id) && !sharedIds.contains(r.id) }

        // Most syncs change nothing here; then only cards made here and not yet accepted can be out of reach.
        if Set(known) == Set(vaults) && Set(knownShared) == Set(shared) {
            let stray = try store.listDirty().filter(outOfReach).map(\.id)
            if !stray.isEmpty {
                try store.deleteCards(stray)
                changeHandler?()
            }
            keyring.setVaults(vaults)
            return false
        }
        // A withheld vault counts as reached once it no longer is, so its cards, older than the cursor, are pulled again.
        let reached = { (list: [Vault]) in list.filter { !$0.isWithheld }.map { "v:\($0.id)" } }
        let before = Set(reached(known) + knownShared.map { "c:\($0.card_id)" })
        let after = reached(vaults) + shared.map { "c:\($0.card_id)" }
        let gone = try store.listCards().filter(outOfReach).map(\.id)
        try store.replaceVaults(vaults)
        try store.setMeta("shared", shared)
        keyring.setVaults(vaults)
        if !gone.isEmpty { try store.deleteCards(gone) }
        // The log goes with the cards it's about, and keeps nothing readable from a vault since encrypted.
        let lost = Set(gone)
        let encrypted = Set(vaults.filter(\.isEncrypted).map(\.id))
        try store.deleteChanges(
            try store.listChanges().filter { lost.contains($0.cardId) || (encrypted.contains($0.after.vault_id) && !VaultCrypto.isEncrypted($0.after.payload)) }
                .compactMap(\.n))
        changeHandler?()
        return after.contains { !before.contains($0) }
    }

    public func sharedCards() throws -> [SharedCard] { try store.getMeta("shared", as: [SharedCard].self) ?? [] }

    /// Cards shared into this account's vaults: each shows in that vault as well as its own.
    public func vaultShares() throws -> [VaultShare] { try store.getMeta("vaultShares", as: [VaultShare].self) ?? [] }

    /// Open comments on each card, from the last sync.
    public func putCommentCounts(_ counts: [CommentCount]) throws {
        if (try store.getMeta("commentCounts", as: [CommentCount].self) ?? []) != counts {
            try store.setMeta("commentCounts", counts)
            changeHandler?()
        }
    }

    public func commentCounts() throws -> [String: Int] {
        Dictionary((try store.getMeta("commentCounts", as: [CommentCount].self) ?? []).map { ($0.card_id, $0.open) }) { a, _ in a }
    }

    /// Removes cards that someone moved out of this account's reach, along with their place in the log.
    public func dropCards(_ ids: [String]) throws {
        try store.deleteCards(ids)
        let lost = Set(ids)
        try store.deleteChanges(try store.listChanges().filter { lost.contains($0.cardId) }.compactMap(\.n))
        changeHandler?()
    }

    public func applyRemote(_ records: [CardRecord]) throws {
        try store.applyRemote(records)
        if !records.isEmpty { changeHandler?() }
    }

    /// Takes the server's version of a card. Given `ifUpdatedAt`, an edit made since then stays instead, and this says false.
    @discardableResult
    public func forceRemote(_ record: CardRecord, ifUpdatedAt: Int64? = nil) throws -> Bool {
        let taken = try store.forceRemote(record, ifUpdatedAt: ifUpdatedAt)
        if taken { changeHandler?() }
        return taken
    }

    public func markSynced(id: String, updatedAt: Int64, seq: Int64) throws {
        try store.markSynced(id: id, updatedAt: updatedAt, seq: seq)
    }

    public func cursor() throws -> Int64 { try store.getMeta("cursor", as: Int64.self) ?? 0 }
    public func setCursor(_ seq: Int64) throws { try store.setMeta("cursor", seq) }

    /// Keeps the losing side of a conflict as its own card, when it holds text the winner doesn't.
    public func saveConflictCopy(loser loserRecord: CardRecord, winner winnerRecord: CardRecord) throws {
        let loser = decode(loserRecord)
        let winner = decode(winnerRecord)
        if loser.sealed || loser.deleted || loser.type == .tag || loser.isBlank { return }
        if loser.title == winner.title && loser.content == winner.content { return }
        let title = "\(loser.displayTitle) (conflict copy)"
        var fields: [String: JSONValue] = ["type": "note", "title": .string(title), "content": loser.content, "tags": .array(loser.tags.map(JSONValue.string))]
        fields["createdAt"] = .int(loser.createdAt)
        if loser.type == .todo {
            fields["type"] = "todo"
            fields["status"] = loser.payload["status"] ?? "open"
            fields["due"] = loser.payload["due"] ?? .null
            fields["completedAt"] = loser.payload["completedAt"] ?? .null
        }
        try write(newCard(vaultId: loser.vaultId, fields))
    }

    // MARK: Meta

    public func meta<T: Decodable>(_ key: String, as type: T.Type) throws -> T? { try store.getMeta(key, as: type) }
    public func setMeta<T: Encodable>(_ key: String, _ value: T) throws { try store.setMeta(key, value) }

    /// This device's ID, made once, sent with each push so the History page can tell this device's changes apart.
    public func deviceId() throws -> String {
        if let id = try store.getMeta("deviceId", as: String.self) { return id }
        let id = newCardId()
        try store.setMeta("deviceId", id)
        return id
    }

    /// Removes everything from the device, for signing out.
    public func clear() throws {
        try store.clear()
        keyring.forgetAll()
        keyring.setVaults([])
        changeHandler?()
    }
}
