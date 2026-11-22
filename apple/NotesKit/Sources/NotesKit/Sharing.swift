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
    public init(members: [Member], invites: [Invite]) {
        self.members = members
        self.invites = invites
    }
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

/// What a link's page says about itself, for a preview card. Only `url` is certain.
public struct LinkPreview: Codable, Sendable, Hashable {
    public var url: String
    public var title: String?
    public var description: String?
    /// An https image address from the page.
    public var image: String?
    public var site: String?
}

extension ServerAPI {
    /// The server reads the page's Open Graph tags, as the web app's `fetchLinkPreview`.
    public func unfurl(_ url: String) async throws -> LinkPreview {
        struct Body: Encodable { let url: String }
        return try await json(LinkPreview.self, "/unfurl", method: "POST", body: Body(url: url))
    }
}

/// A photo or file as the server keeps it.
public struct StoredAttachment: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var vault_id: String
    public var mime: String
    public var size: Int64
    public var name: String?
    public var width: Double?
    public var height: Double?
    public var duration: Double?
    public var created_at: Int64
    /// When it was found in no entry, and so went to the Trash.
    public var trashed_at: Int64?
    /// The entry it was last in, to put it back there.
    public var trashed_from: String?
    /// 1 when it's sealed with its vault's key.
    public var sealed: Int?

    public var isSealed: Bool { (sealed ?? 0) != 0 }
    /// A file, as against a photo: it has a name, or isn't a picture.
    public var isFile: Bool { name != nil || !mime.hasPrefix("image/") }
    public static let trashDays = 30

    /// Days left before it's deleted for good.
    public func daysLeft(now: Int64) -> Int {
        guard let at = trashed_at else { return Self.trashDays }
        return max(0, Int((Double(at + Int64(Self.trashDays) * 86_400_000 - now) / 86_400_000).rounded(.up)))
    }
}

/// Which photos and files go to the Trash, come back from it, or go for good, as the web app's `planSweep`.
public enum AttachmentSweep {
    public struct Holder: Codable, Sendable, Hashable {
        public var card: String
        public var name: String?
    }

    public struct Plan: Sendable {
        public var trash: [ServerAPI.TrashMark] = []
        public var keep: [String] = []
        public var remove: [String] = []
        public var holders: [String: Holder] = [:]
    }

    /// The photos and files a card holds, on every page, a video's still too.
    public static func held(_ card: Card) -> [(id: String, name: String?)] {
        guard card.isEntry else { return [] }
        return ([card.content] + card.morePages).flatMap { page in
            Doc.photoIds(page).map { ($0, nil) } + Doc.files(page).flatMap { f in [(f.id, Optional(f.name))] + (f.poster.map { [($0, nil)] } ?? []) }
        }
    }

    /// Held ones stay or come back; ones no entry holds go to the Trash (in vaults this device can judge, and not
    /// just made); ones in the Trash 30 days go for good, when this device may.
    public static func plan(stored: [StoredAttachment], cards: [Card], judges: (String) -> Bool, mayDelete: Bool, holders: [String: Holder], now: Int64) -> Plan {
        var heldBy: [String: Holder] = [:]
        for card in cards.filter({ !$0.deleted }) + cards.filter(\.deleted) {
            for (id, name) in held(card) where heldBy[id] == nil { heldBy[id] = Holder(card: card.id, name: name) }
        }
        var plan = Plan()
        for a in stored {
            if let holder = heldBy[a.id] {
                plan.holders[a.id] = holder
                if a.trashed_at != nil { plan.keep.append(a.id) }
                continue
            }
            let last = holders[a.id]
            if let last { plan.holders[a.id] = last }
            if !judges(a.vault_id) || now - a.created_at < 10 * 60_000 { continue }
            if a.trashed_at == nil {
                plan.trash.append(.init(id: a.id, from: last?.card, name: last?.name))
            } else if mayDelete, let at = a.trashed_at, now - at >= Int64(StoredAttachment.trashDays) * 86_400_000 {
                plan.remove.append(a.id)
            }
        }
        return plan
    }
}

extension ServerAPI {
    public func attachments() async throws -> [StoredAttachment] {
        struct R: Decodable { let attachments: [StoredAttachment] }
        return try await json(R.self, "/attachments").attachments
    }

    public struct TrashMark: Encodable, Sendable {
        public var id: String
        public var from: String?
        public var name: String?
        public init(id: String, from: String?, name: String?) {
            self.id = id
            self.from = from
            self.name = name
        }
    }

    /// Sends photos and files no entry holds to the Trash, and brings back those held again.
    public func markAttachments(trash: [TrashMark], keep: [String]) async throws {
        struct Body: Encodable { let trash: [TrashMark]; let keep: [String] }
        let (_, status) = try await send("/attachments/state", method: "POST", body: Body(trash: trash, keep: keep))
        guard (200..<300).contains(status) else { throw APIError.status(status) }
    }

    public enum DeleteResult: Sendable { case ok, gone, inUse, needsDrive, error }

    /// Deletes a photo or file in the Trash for good, from Google Drive too.
    public func deleteAttachment(_ id: String) async throws -> DeleteResult {
        let (data, status) = try await send("/attachments/" + Self.part(id), method: "DELETE")
        if (200..<300).contains(status) { return .ok }
        if status == 404 { return .gone }
        let error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
        return error == "in_use" ? .inUse : error == "drive_not_connected" ? .needsDrive : .error
    }

    public struct VaultComment: Codable, Sendable {
        public var id: String
        public var card_id: String
        public var body: String
    }

    public func vaultComments(_ vaultId: String) async throws -> [VaultComment] {
        struct R: Decodable { let comments: [VaultComment] }
        return try await json(R.self, Self.vault(vaultId) + "/comments").comments
    }

    public func putVaultComments(_ vaultId: String, _ comments: [(id: String, body: String)]) async throws {
        struct C: Encodable { let id: String; let body: String }
        struct Body: Encodable { let comments: [C] }
        for start in stride(from: 0, to: comments.count, by: 500) {
            let batch = comments[start..<min(comments.count, start + 500)].map { C(id: $0.id, body: $0.body) }
            let (_, status) = try await send(Self.vault(vaultId) + "/comments", method: "PUT", body: Body(comments: batch))
            guard (200..<300).contains(status) else { throw APIError.status(status) }
        }
    }

    /// Removes plaintext versions from an encrypted vault's history on the server.
    public func purgePlaintextHistory(_ vaultId: String) async throws {
        let (_, status) = try await send(Self.vault(vaultId) + "/purge-plaintext", method: "POST", body: [String: String]())
        guard (200..<300).contains(status) else { throw APIError.status(status) }
    }
}

public struct DriveStatus: Codable, Sendable {
    public var configured: Bool
    public var connected: Bool
    public var email: String?
}

public struct ConnectedApp: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var name: String
    public var created_at: Int64
    public var last_used_at: Int64?
}

/// What deleting an account would take: the vaults it owns, with their entries and other members.
public struct AccountSummary: Codable, Sendable {
    public struct OwnedVault: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var cards: Int
        public var others: Int
    }
    public var vaults: [OwnedVault]
    public var joined: Int
}

extension ServerAPI {
    public func driveStatus() async throws -> DriveStatus { try await json(DriveStatus.self, "/drive") }

    /// The Google page that connects Drive; opened in the browser.
    public func driveConnectURL() async throws -> URL {
        struct R: Decodable { let url: String }
        guard let url = URL(string: try await json(R.self, "/drive/connect", method: "POST", body: [String: String]()).url) else { throw APIError.status(0) }
        return url
    }

    public func disconnectDrive() async throws {
        let (_, status) = try await send("/drive", method: "DELETE")
        guard (200..<300).contains(status) else { throw APIError.status(status) }
    }

    public func aiApps() async throws -> [ConnectedApp] {
        struct R: Decodable { let apps: [ConnectedApp] }
        return try await json(R.self, "/ai/apps").apps
    }

    public func disconnectAiApp(_ id: String) async throws {
        let (_, status) = try await send("/ai/apps/" + Self.part(id), method: "DELETE")
        guard (200..<300).contains(status) else { throw APIError.status(status) }
    }

    /// The address AI apps connect to.
    public var mcpURL: URL { site.appending(path: "api/mcp") }

    public func accountSummary() async throws -> AccountSummary { try await json(AccountSummary.self, "/account/summary") }

    /// Deletes this account and everything it owns. Throws a sentence saying what went wrong.
    public func deleteAccount(email: String) async throws {
        struct Body: Encodable { let email: String }
        let (data, status) = try await send("/account/delete", method: "POST", body: Body(email: email))
        guard (200..<300).contains(status) else {
            let error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw NSError(domain: "notes", code: status, userInfo: [NSLocalizedDescriptionKey: error ?? "The account couldn't be deleted. Try again."])
        }
    }
}

extension ServerAPI {
    public enum Translated: Sendable { case done(from: String, to: String, pieces: [String]), same(from: String), limit, failed }

    /// An entry's pieces translated by the server into `to`, or into `otherwise` when they're in `to` already.
    public func translate(cardId: String, pieces: [String], to: String, otherwise: String?) async -> Translated {
        struct Body: Encodable { let cardId: String; let pieces: [String]; let to: String; let otherwise: String? }
        struct R: Decodable { let kind: String; let from: String?; let to: String?; let pieces: [String]? }
        guard let (data, status) = try? await send("/translate", method: "POST", body: Body(cardId: cardId, pieces: pieces, to: to, otherwise: otherwise)) else { return .failed }
        if status == 429 { return .limit }
        guard (200..<300).contains(status), let r = try? JSONDecoder().decode(R.self, from: data) else { return .failed }
        if r.kind == "same" { return .same(from: r.from ?? "") }
        guard let pieces = r.pieces, let from = r.from else { return .failed }
        return .done(from: from, to: r.to ?? to, pieces: pieces)
    }
}

extension ServerAPI {
    public struct DraftChange: Codable, Sendable {
        public var kind: String
        public var key: String
        public var value: JSONValue
        public init(kind: String, key: String, value: JSONValue) {
            self.kind = kind
            self.key = key
            self.value = value
        }
    }

    public struct ServerDraft: Codable, Sendable {
        public var kind: String
        public var key: String
        public var value: JSONValue?
        public var at: Int64
    }

    public func drafts(since: Int64) async throws -> (drafts: [ServerDraft], at: Int64) {
        struct R: Decodable { let drafts: [ServerDraft]; let at: Int64 }
        let r = try await json(R.self, "/drafts?since=\(since)")
        return (r.drafts, r.at)
    }

    public func sendDrafts(_ drafts: [DraftChange]) async throws {
        struct Body: Encodable { let drafts: [DraftChange] }
        let (_, status) = try await send("/drafts", method: "PUT", body: Body(drafts: drafts))
        guard (200..<300).contains(status) else { throw APIError.status(status) }
    }
}

extension StreamFilter {
    /// The web app's address for this view of the journal, which names its draft: `/journal?tag=…&vault=…`.
    public var journalPath: String {
        var items: [(String, String)] = []
        switch sort {
        case .newest: items.append(("sort", "newest"))
        case .edited: items.append(("sort", "edited"))
        case .due: items.append(("sort", "due"))
        case .group(let id): items.append(("sort", "group:\(id)"))
        case .written: break
        }
        if let type { items.append(("type", type.rawValue)) }
        if let status { items.append(("status", status.rawValue)) }
        if let when { items.append(("when", when)) }
        if let tagId { items.append(("tag", tagId)) }
        if let vaultId { items.append(("vault", vaultId)) }
        if let has { items.append(("has", has.rawValue)) }
        if template { items.append(("template", "1")) }
        if let board { items.append(("board", board)) }
        var c = URLComponents()
        c.queryItems = items.map { URLQueryItem(name: $0.0, value: $0.1) }
        // As URLSearchParams writes it: spaces as +, the rest percent-encoded.
        let query = (c.percentEncodedQuery ?? "").replacingOccurrences(of: "%20", with: "+").replacingOccurrences(of: ":", with: "%3A")
        return (archived ? "/archive" : "/journal") + (query.isEmpty ? "" : "?" + query)
    }
}

extension ServerAPI {
    /// A picture on the web, fetched by the server, since most sites don't let others fetch their pictures.
    public func fetchPicture(_ url: String) async throws -> Data {
        struct Body: Encodable { let url: String }
        let (data, status) = try await send("/fetch-image", method: "POST", body: Body(url: url))
        guard (200..<300).contains(status) else {
            let error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw NSError(domain: "notes", code: status, userInfo: [NSLocalizedDescriptionKey: error ?? "That picture couldn't be brought in."])
        }
        return data
    }
}

extension ServerAPI {
    /// Whether a photo, video or file is shared by its Google Drive link, and the link.
    public func driveLink(_ id: String) async throws -> (url: String?, can: Bool) {
        struct R: Decodable { let url: String?; let can: Bool }
        let r = try await json(R.self, "/attachments/" + Self.part(id) + "/link")
        return (r.url, r.can)
    }

    /// Lets anyone with its Drive link open it, and answers with the link, or a sentence saying why not.
    public func shareDriveLink(_ id: String) async -> Result<String, NSError> {
        guard let (data, status) = try? await send("/attachments/" + Self.part(id) + "/link", method: "POST", body: [String: String]()) else {
            return .failure(NSError(domain: "notes", code: 0, userInfo: [NSLocalizedDescriptionKey: "Sharing needs a connection."]))
        }
        let body = (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
        if (200..<300).contains(status), let url = body["url"] { return .success(url) }
        let why: String =
            status == 404 ? "It isn't uploaded yet. Try again in a moment."
            : body["error"] == "drive_not_connected" ? "Connect Google Drive in Settings first."
            : body["error"] == "drive_refused" ? "Google Drive won't share it by a link (a Workspace that forbids it)."
            : body["error"] == "not_in_drive" ? "It isn't in a Google Drive." : "It couldn't be shared. Try again."
        return .failure(NSError(domain: "notes", code: status, userInfo: [NSLocalizedDescriptionKey: why]))
    }

    public func stopDriveLink(_ id: String) async -> Bool {
        guard let (_, status) = try? await send("/attachments/" + Self.part(id) + "/link", method: "DELETE") else { return false }
        return (200..<300).contains(status)
    }
}
