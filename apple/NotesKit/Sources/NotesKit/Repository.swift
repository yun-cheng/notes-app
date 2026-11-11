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
            return Card(id: r.id, vaultId: r.vault_id, updatedAt: r.updated_at, deleted: r.deleted, seq: r.seq, payload: payload)
        }
        // Diary IDs carry their date, so a locked day still knows it has an entry.
        var payload: [String: JSONValue] = ["type": "note", "title": "", "tags": [], "content": Doc.empty]
        if r.id.hasPrefix("diary:"), let date = r.id.split(separator: ":").last {
            payload["type"] = "diary"
            payload["date"] = .string(String(date))
        }
        return Card(id: r.id, vaultId: r.vault_id, updatedAt: r.updated_at, deleted: r.deleted, seq: r.seq, payload: payload, sealed: true)
    }

    public func allCards() throws -> [Card] { try store.listCards().map(decode) }

    public func card(_ id: String) throws -> Card? { try store.getCard(id).map(decode) }

    public func vaults() throws -> [Vault] { try store.listVaults() }

    // MARK: Writing

    private func encode(_ card: Card) throws -> CardRecord {
        precondition(!card.sealed, "A locked card can't be saved")
        return CardRecord(
            id: card.id, vault_id: card.vaultId, updated_at: card.updatedAt, deleted: card.deleted, seq: card.seq,
            payload: try keyring.encode(card.payload, id: card.id, vaultId: card.vaultId))
    }

    @discardableResult
    private func write(_ card: Card) throws -> Card {
        try store.putCards([encode(card)])
        changeHandler?()
        return card
    }

    private func defaultVaultId() throws -> String {
        let vaults = try store.listVaults()
        if let id = mainVaultId, vaults.contains(where: { $0.id == id }) { return id }
        if let first = vaults.sorted(by: { $0.created_at < $1.created_at }).first { return first.id }
        throw DatabaseError(description: "No vault yet. Sync first.")
    }

    private func newCard(id: String? = nil, vaultId: String? = nil, _ fields: [String: JSONValue]) throws -> Card {
        let at = now()
        var payload: [String: JSONValue] = ["createdAt": .int(at), "title": "", "content": Doc.empty, "tags": []]
        payload.merge(fields) { _, new in new }
        return Card(id: id ?? newId(), vaultId: try vaultId ?? defaultVaultId(), updatedAt: at, deleted: false, seq: 0, payload: payload)
    }

    public func createNote(title: String = "", vaultId: String? = nil) throws -> Card {
        try write(newCard(vaultId: vaultId, ["type": "note", "title": .string(title)]))
    }

    public func createTodo(title: String, due: String? = nil) throws -> Card {
        try write(newCard(["type": "todo", "title": .string(title), "status": "open", "due": due.map(JSONValue.string) ?? .null, "completedAt": .null]))
    }

    public func createTag(title: String) throws -> Card {
        try write(newCard(["type": "tag", "title": .string(title), "pinned": false]))
    }

    /// Applies `change` to the card's payload and saves it, unless nothing changed.
    @discardableResult
    public func update(_ id: String, _ change: @Sendable (inout Card) -> Void) throws -> Card? {
        guard var card = try card(id), !card.sealed else { return nil }
        let before = card
        change(&card)
        guard card != before else { return card }
        card.updatedAt = now()
        return try write(card)
    }

    public func setDone(_ id: String, _ done: Bool) throws {
        let at = now()
        try update(id) { card in
            card.payload["status"] = done ? "done" : "open"
            card.payload["completedAt"] = done ? .int(at) : .null
        }
    }

    /// Diary entries are created on first write. Their ID comes from the date, so two devices can't make two for one day.
    @discardableResult
    public func saveDiary(date: String, content: JSONValue, existingId: String? = nil, vaultId: String? = nil) throws -> Card {
        let target = try vaultId ?? defaultVaultId()
        let id = existingId ?? diaryId(vaultId: target, date: date)
        if var card = try card(id), !card.deleted, !card.sealed {
            guard card.content != content else { return card }
            card.content = content
            card.updatedAt = now()
            return try write(card)
        }
        return try write(newCard(id: id, vaultId: target, ["type": "diary", "date": .string(date), "content": content]))
    }

    public func setDeleted(_ id: String, _ deleted: Bool) throws {
        try update(id) { $0.deleted = deleted }
    }

    public func move(_ id: String, toVault vaultId: String) throws {
        try update(id) { $0.vaultId = vaultId }
    }

    /// Stores every readable card in a vault again, after its key was unlocked or its encryption changed.
    public func recodeVault(_ vaultId: String) throws {
        let records = try store.listCards().filter { $0.vault_id == vaultId }.map(decode).filter { !$0.sealed }.map(encode)
        if !records.isEmpty {
            try store.putCards(records)
            changeHandler?()
        }
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

    /// Takes the server's word on what this account can see. Cards it can no longer see leave the device.
    /// Returns true if access grew, so everything should be pulled again.
    public func applyAccess(vaults: [Vault], shared: [SharedCard]) throws -> Bool {
        let oldShared = try store.getMeta("shared", as: [SharedCard].self) ?? []
        let before = Set(try store.listVaults().map { "v:\($0.id)" } + oldShared.map { "c:\($0.card_id)" })
        let after = vaults.map { "v:\($0.id)" } + shared.map { "c:\($0.card_id)" }
        let vaultIds = Set(vaults.map(\.id))
        let sharedIds = Set(shared.map(\.card_id))
        let gone = try store.listCards().filter { !vaultIds.contains($0.vault_id) && !sharedIds.contains($0.id) }.map(\.id)
        try store.replaceVaults(vaults)
        try store.setMeta("shared", shared)
        keyring.setVaults(vaults)
        if !gone.isEmpty { try store.deleteCards(gone) }
        changeHandler?()
        return after.contains { !before.contains($0) }
    }

    public func sharedCards() throws -> [SharedCard] { try store.getMeta("shared", as: [SharedCard].self) ?? [] }

    public func applyRemote(_ records: [CardRecord]) throws {
        try store.applyRemote(records)
        if !records.isEmpty { changeHandler?() }
    }

    public func forceRemote(_ record: CardRecord) throws {
        try store.forceRemote(record)
        changeHandler?()
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
        let title = loser.type == .diary ? "Diary \(loser.date) (conflict copy)" : "\(loser.displayTitle) (conflict copy)"
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

    /// Removes everything from the device, for signing out.
    public func clear() throws {
        try store.clear()
        keyring.forgetAll()
        keyring.setVaults([])
        changeHandler?()
    }
}
