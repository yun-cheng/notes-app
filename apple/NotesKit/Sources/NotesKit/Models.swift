import Foundation

/// The stored and synced shape of a card. `payload` is opaque to the server: JSON, or `e1:` ciphertext.
public struct CardRecord: Codable, Sendable, Hashable {
    public var id: String
    public var vault_id: String
    public var updated_at: Int64
    public var deleted: Bool
    public var seq: Int64
    public var payload: String

    public init(id: String, vault_id: String, updated_at: Int64, deleted: Bool, seq: Int64, payload: String) {
        self.id = id
        self.vault_id = vault_id
        self.updated_at = updated_at
        self.deleted = deleted
        self.seq = seq
        self.payload = payload
    }
}

public struct Vault: Codable, Sendable, Hashable, Identifiable {
    public enum Lock: String, Codable, Sendable { case none, pin }
    public enum AIAccess: String, Codable, Sendable { case off, read, write }
    public enum Role: String, Codable, Sendable { case owner, editor, viewer }

    public var id: String
    public var name: String
    public var owner_id: String
    public var lock: Lock
    public var ai_access: AIAccess
    public var created_at: Int64
    /// PIN verifier: salt, hash and iterations, as the web app made them.
    public var pin: JSONValue?
    public var hidden: Bool
    public var role: Role?
    public var members: Int?
    /// Set when the vault is end-to-end encrypted. Its owner gets the key wrapped under their PIN and the recovery
    /// key; anyone else gets their own copy (`member`), or `member: null` before they ask for one.
    public var encryption: JSONValue?
    /// For the owner of an encrypted vault: how many members asked for its key and wait to be let in.
    public var waiting: Int?
    /// Set by the owner of a vault locked by their PIN: everyone in it must lock it with a PIN of their own first.
    /// `lock`, `pin` and `hidden` are this account's own, as each member's lock is theirs.
    public var members_need_pin: Bool?
    /// True while this account is a member who hasn't yet set the PIN the owner asks for, or hasn't been let in to an
    /// encrypted vault: the server sends none of its cards.
    public var withheld: Bool?

    public var isPrivate: Bool { lock == .pin }
    public var isEncrypted: Bool { encryption.map { !$0.isNull } ?? false }
    public var isOwner: Bool { (role ?? .owner) == .owner }
    public var isWithheld: Bool { withheld ?? false }
    public var needsMemberPins: Bool { members_need_pin ?? false }
    /// This account's copy of the key is a member's, not the owner's.
    public var isMemberCopy: Bool { encryption?.objectValue?.keys.contains("member") ?? false }
    /// Every account's diary is a vault like any other, made at its first sign-in.
    public func isDiary(of userId: String) -> Bool { id == "diary-\(userId)" }
    public func isDefault(of userId: String) -> Bool { id == "vault-\(userId)" }
}

public struct Account: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var email: String
    public var name: String
    /// The Google profile photo's address, when there is one.
    public var picture: String?
}

public struct SessionInfo: Codable, Sendable {
    public var user: Account
    public var vaults: [Vault]
    /// Only on a native sign-in: the session, sent back as a bearer token.
    public var token: String?
}

/// A card shared with this account from outside its vaults.
public struct SharedCard: Codable, Sendable, Hashable {
    public enum Role: String, Codable, Sendable { case view, comment, edit }
    public var card_id: String
    public var role: Role
    public var shared_by: String
}

/// A card shared with everyone in one of this account's vaults. It shows in that vault as well as its own.
public struct VaultShare: Codable, Sendable, Hashable {
    public var card_id: String
    public var vault_id: String
}

/// How many comments on a card are still open.
public struct CommentCount: Codable, Sendable, Hashable {
    public var card_id: String
    public var open: Int
}

/// What `/shared` answers. Servers from before vault shares and comment counts leave them out.
public struct SharedResponse: Codable, Sendable {
    public var cards: [SharedCard]
    public var vaults: [VaultShare]?
    public var comments: [CommentCount]?

    public init(cards: [SharedCard], vaults: [VaultShare]? = nil, comments: [CommentCount]? = nil) {
        self.cards = cards
        self.vaults = vaults
        self.comments = comments
    }
}

public struct PullResponse: Codable, Sendable {
    public var records: [CardRecord]
    /// Cards that moved out of this account's reach, to remove from the device.
    public var gone: [String]?
    public var next: Int64
    public var more: Bool

    public init(records: [CardRecord], gone: [String]? = nil, next: Int64, more: Bool) {
        self.records = records
        self.gone = gone
        self.next = next
        self.more = more
    }
}

public enum PushResult: Sendable {
    case ok(id: String, seq: Int64)
    /// Both sides changed; this device's newer version was saved, replacing `loser`.
    case clientWon(id: String, seq: Int64, loser: CardRecord)
    /// Both sides changed; the server's newer version was kept.
    case serverWon(id: String, server: CardRecord)
    case retry(id: String)
    /// Forbidden or too large: the server won't take it as it is.
    case refused(id: String)

    public var id: String {
        switch self {
        case .ok(let id, _), .clientWon(let id, _, _), .serverWon(let id, _), .retry(let id), .refused(let id): id
        }
    }
}

extension PushResult: Decodable {
    private enum Keys: String, CodingKey { case id, status, seq, loser, server }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let id = try c.decode(String.self, forKey: .id)
        switch try c.decode(String.self, forKey: .status) {
        case "ok": self = .ok(id: id, seq: try c.decode(Int64.self, forKey: .seq))
        case "conflict_client_won":
            self = .clientWon(id: id, seq: try c.decode(Int64.self, forKey: .seq), loser: try c.decode(CardRecord.self, forKey: .loser))
        case "conflict_server_won": self = .serverWon(id: id, server: try c.decode(CardRecord.self, forKey: .server))
        case "retry": self = .retry(id: id)
        default: self = .refused(id: id)
        }
    }
}

public enum Limits {
    public static let pushBatch = 40
}
