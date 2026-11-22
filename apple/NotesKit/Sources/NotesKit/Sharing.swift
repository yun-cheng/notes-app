import Foundation

/// Sharing, comments and history on the server, as the web app's `http.ts`.
public struct VaultPeople: Codable, Sendable, Hashable {
    public struct Member: Codable, Sendable, Hashable, Identifiable {
        public var user_id: String
        public var name: String
        public var email: String
        public var role: Vault.Role
        /// Whether they've locked the vault with a PIN of their own.
        public var locked: Bool
        /// In an encrypted vault: the public key they asked for its key with, and whether the owner let them in.
        public var key: Key?
        public var id: String { user_id }
    }
    public struct Key: Codable, Sendable, Hashable {
        public var `public`: String
        public var given: Bool
    }
    public struct Invite: Codable, Sendable, Hashable {
        public var email: String
        public var role: Vault.Role
    }
    public var members: [Member]
    public var invites: [Invite]
}

public struct CardShares: Codable, Sendable, Hashable {
    public struct Person: Codable, Sendable, Hashable, Identifiable {
        public var user_id: String
        public var name: String
        public var email: String
        public var role: SharedCard.Role
        public var id: String { user_id }
    }
    public struct Invite: Codable, Sendable, Hashable {
        public var email: String
        public var role: SharedCard.Role
    }
    public struct VaultShare: Codable, Sendable, Hashable {
        public var vault_id: String
        public var name: String
        public var role: SharedCard.Role
        public var members: Int
    }
    public struct Link: Codable, Sendable, Hashable {
        public var token: String
        public var created_at: Int64
        public var expires_at: Int64?
    }
    public var people: [Person]
    public var invites: [Invite]
    public var vaults: [VaultShare]
    public var links: [Link]
}

public struct CardComment: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var author_id: String
    public var author: String
    public var body: String
    public var created_at: Int64
    public var resolved_at: Int64?
}

public struct VersionInfo: Codable, Sendable, Hashable, Identifiable {
    public var id: Int64
    public var started_at: Int64
    public var saved_at: Int64
    public var author: String?
    public var via: String?
}

public struct VersionResponse: Codable, Sendable, Hashable {
    public var id: Int64
    public var started_at: Int64
    public var saved_at: Int64
    public var author: String?
    public var via: String?
    public var payload: String
}

/// What a vault's settings change: its name, this account's PIN, whether it's hidden, AI access, encryption.
public struct VaultChanges: Encodable, Sendable {
    public var name: String?
    public var pin: JSONValue??
    public var hidden: Bool?
    public var ai_access: Vault.AIAccess?
    public var encryption: JSONValue??
    public var members_need_pin: Bool?

    public init(name: String? = nil, pin: JSONValue?? = nil, hidden: Bool? = nil, ai_access: Vault.AIAccess? = nil, encryption: JSONValue?? = nil, members_need_pin: Bool? = nil) {
        self.name = name
        self.pin = pin
        self.hidden = hidden
        self.ai_access = ai_access
        self.encryption = encryption
        self.members_need_pin = members_need_pin
    }

    enum Keys: String, CodingKey { case name, pin, hidden, ai_access, encryption, members_need_pin }

    /// A field left nil is left out; one set to `.some(nil)` is sent as null, to clear it.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encodeIfPresent(name, forKey: .name)
        if let pin { try c.encode(pin ?? .null, forKey: .pin) }
        try c.encodeIfPresent(hidden, forKey: .hidden)
        try c.encodeIfPresent(ai_access, forKey: .ai_access)
        if let encryption { try c.encode(encryption ?? .null, forKey: .encryption) }
        try c.encodeIfPresent(members_need_pin, forKey: .members_need_pin)
    }
}

extension ServerAPI {
    static func part(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s }
    static func card(_ id: String) -> String { "/cards/\(part(id))" }
    static func vault(_ id: String) -> String { "/vaults/\(part(id))" }

    // Vaults

    public func createVault(_ changes: VaultChanges) async throws -> Vault { try await json(Vault.self, "/vaults", method: "POST", body: changes) }
    public func updateVault(_ id: String, _ changes: VaultChanges) async throws -> Vault { try await json(Vault.self, Self.vault(id), method: "PATCH", body: changes) }
    public func vaultPeople(_ id: String) async throws -> VaultPeople { try await json(VaultPeople.self, Self.vault(id) + "/members") }

    public func addMember(_ vaultId: String, email: String, role: Vault.Role) async throws -> VaultPeople {
        struct Body: Encodable { let email: String; let role: Vault.Role }
        return try await json(VaultPeople.self, Self.vault(vaultId) + "/members", method: "POST", body: Body(email: email, role: role))
    }

    public func removeMember(_ vaultId: String, userId: String) async throws {
        let (_, status) = try await send(Self.vault(vaultId) + "/members/" + Self.part(userId), method: "DELETE")
        guard (200..<300).contains(status) else { throw APIError.status(status) }
    }

    public func cancelInvite(_ vaultId: String, email: String) async throws -> VaultPeople {
        try await json(VaultPeople.self, Self.vault(vaultId) + "/invites/" + Self.part(email), method: "DELETE")
    }

    /// The owner lets someone into an encrypted vault, with its key sealed to the public key they asked with.
    public func giveVaultKey(_ vaultId: String, userId: String, publicKey: String, grant: String) async throws -> VaultPeople {
        struct Body: Encodable { let `public`: String; let grant: String }
        return try await json(VaultPeople.self, Self.vault(vaultId) + "/members/" + Self.part(userId) + "/key", method: "PUT", body: Body(public: publicKey, grant: grant))
    }

    // Sharing a card

    public func shares(_ cardId: String) async throws -> CardShares { try await json(CardShares.self, Self.card(cardId) + "/shares") }

    public func share(_ cardId: String, email: String? = nil, vaultId: String? = nil, role: SharedCard.Role) async throws -> CardShares {
        struct Body: Encodable { let email: String?; let vault_id: String?; let role: SharedCard.Role }
        return try await json(CardShares.self, Self.card(cardId) + "/shares", method: "POST", body: Body(email: email, vault_id: vaultId, role: role))
    }

    /// `type` is `user`, `vault` or `invite`.
    public func unshare(_ cardId: String, type: String, target: String) async throws -> CardShares {
        try await json(CardShares.self, Self.card(cardId) + "/shares/\(type)/" + Self.part(target), method: "DELETE")
    }

    public func createLink(_ cardId: String, expiresInDays: Int?) async throws -> CardShares {
        struct Body: Encodable { let expires_in_days: Int? }
        return try await json(CardShares.self, Self.card(cardId) + "/links", method: "POST", body: Body(expires_in_days: expiresInDays))
    }

    public func deleteLink(_ cardId: String, token: String) async throws -> CardShares {
        try await json(CardShares.self, Self.card(cardId) + "/links/" + Self.part(token), method: "DELETE")
    }

    public func publicLink(_ token: String) -> URL { site.appending(path: "s/\(token)") }

    // Comments

    struct Comments: Decodable { let comments: [CardComment] }

    public func comments(_ cardId: String) async throws -> [CardComment] { try await json(Comments.self, Self.card(cardId) + "/comments").comments }

    public func addComment(_ cardId: String, body: String) async throws -> [CardComment] {
        struct Body: Encodable { let body: String }
        return try await json(Comments.self, Self.card(cardId) + "/comments", method: "POST", body: Body(body: body)).comments
    }

    public func resolveComment(_ cardId: String, id: String, resolved: Bool) async throws -> [CardComment] {
        struct Body: Encodable { let resolved: Bool }
        return try await json(Comments.self, Self.card(cardId) + "/comments/" + Self.part(id), method: "PATCH", body: Body(resolved: resolved)).comments
    }

    public func deleteComment(_ cardId: String, id: String) async throws -> [CardComment] {
        try await json(Comments.self, Self.card(cardId) + "/comments/" + Self.part(id), method: "DELETE").comments
    }

    // History

    public func versions(_ cardId: String) async throws -> [VersionInfo] {
        struct R: Decodable { let versions: [VersionInfo] }
        return try await json(R.self, Self.card(cardId) + "/versions").versions
    }

    public func version(_ cardId: String, _ versionId: Int64) async throws -> VersionResponse {
        try await json(VersionResponse.self, Self.card(cardId) + "/versions/\(versionId)")
    }

    /// Closes the card's newest version, so a restore shows up as its own entry.
    public func sealVersions(_ cardId: String) async throws {
        _ = try await send(Self.card(cardId) + "/versions/seal", method: "POST", body: [String: String]())
    }
}
