import Foundation

/// Cards, vaults and sync state on the device, in SQLite. Mirrors the web app's IndexedDB store:
/// a local write marks the card dirty until the server has it, and a remote change never overwrites a dirty card.
final class CardStore {
    private let db: Database

    init(path: String) throws {
        db = try Database(path: path)
        try db.execute("""
            CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
              deleted INTEGER NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL)
            """)
        try db.execute("CREATE TABLE IF NOT EXISTS dirty (id TEXT PRIMARY KEY)")
        try db.execute("CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, json TEXT NOT NULL)")
        try db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    }

    private static func record(_ row: [Any?]) -> CardRecord {
        CardRecord(
            id: row[0] as! String, vault_id: row[1] as! String, updated_at: row[2] as! Int64,
            deleted: (row[3] as! Int64) != 0, seq: row[4] as! Int64, payload: row[5] as! String)
    }

    private static let columns = "id, vault_id, updated_at, deleted, seq, payload"

    private func put(_ r: CardRecord) throws {
        try db.execute(
            "INSERT OR REPLACE INTO cards (\(Self.columns)) VALUES (?, ?, ?, ?, ?, ?)",
            [.text(r.id), .text(r.vault_id), .int(r.updated_at), .int(r.deleted ? 1 : 0), .int(r.seq), .text(r.payload)])
    }

    func listCards() throws -> [CardRecord] {
        try db.query("SELECT \(Self.columns) FROM cards").map(Self.record)
    }

    func getCard(_ id: String) throws -> CardRecord? {
        try db.query("SELECT \(Self.columns) FROM cards WHERE id = ?", [.text(id)]).first.map(Self.record)
    }

    /// A local write: stored, and marked to be pushed.
    func putCards(_ records: [CardRecord]) throws {
        try db.transaction {
            for r in records {
                try put(r)
                try db.execute("INSERT OR IGNORE INTO dirty (id) VALUES (?)", [.text(r.id)])
            }
        }
    }

    func listDirty() throws -> [CardRecord] {
        try db.query("SELECT c.id, c.vault_id, c.updated_at, c.deleted, c.seq, c.payload FROM cards c JOIN dirty d ON d.id = c.id")
            .map(Self.record)
    }

    /// Changes from the server. A card with unpushed local changes keeps them; push settles it.
    func applyRemote(_ records: [CardRecord]) throws {
        try db.transaction {
            for r in records {
                if try !db.query("SELECT 1 FROM dirty WHERE id = ?", [.text(r.id)]).isEmpty { continue }
                if let current = try getCard(r.id), current.seq == r.seq { continue }
                try put(r)
            }
        }
    }

    /// The server's version wins outright.
    func forceRemote(_ record: CardRecord) throws {
        try db.transaction {
            try put(record)
            try db.execute("DELETE FROM dirty WHERE id = ?", [.text(record.id)])
        }
    }

    /// The server has the version written at `updatedAt`. If the card changed again since, it stays dirty.
    func markSynced(id: String, updatedAt: Int64, seq: Int64) throws {
        try db.transaction {
            guard let card = try getCard(id) else { return }
            try db.execute("UPDATE cards SET seq = ? WHERE id = ?", [.int(seq), .text(id)])
            if card.updated_at == updatedAt { try db.execute("DELETE FROM dirty WHERE id = ?", [.text(id)]) }
        }
    }

    func deleteCards(_ ids: [String]) throws {
        try db.transaction {
            for id in ids {
                try db.execute("DELETE FROM cards WHERE id = ?", [.text(id)])
                try db.execute("DELETE FROM dirty WHERE id = ?", [.text(id)])
            }
        }
    }

    func listVaults() throws -> [Vault] {
        try db.query("SELECT json FROM vaults").compactMap { try? JSON.decode(Vault.self, from: $0[0] as! String) }
    }

    func putVaults(_ vaults: [Vault]) throws {
        try db.transaction {
            for v in vaults { try db.execute("INSERT OR REPLACE INTO vaults (id, json) VALUES (?, ?)", [.text(v.id), .text(try JSON.string(v))]) }
        }
    }

    func replaceVaults(_ vaults: [Vault]) throws {
        try db.transaction {
            try db.execute("DELETE FROM vaults")
            for v in vaults { try db.execute("INSERT INTO vaults (id, json) VALUES (?, ?)", [.text(v.id), .text(try JSON.string(v))]) }
        }
    }

    func getMeta<T: Decodable>(_ key: String, as type: T.Type) throws -> T? {
        guard let text = try db.query("SELECT value FROM meta WHERE key = ?", [.text(key)]).first?[0] as? String else { return nil }
        return try? JSON.decode(type, from: text)
    }

    func setMeta<T: Encodable>(_ key: String, _ value: T) throws {
        try db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [.text(key), .text(try JSON.string(value))])
    }

    /// Everything, for signing out.
    func clear() throws {
        try db.transaction {
            for table in ["cards", "dirty", "vaults", "meta"] { try db.execute("DELETE FROM \(table)") }
        }
    }
}
