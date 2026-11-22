import Foundation

/// One change this device made to a card, as the change log stores it: the card's record before and after, as the web
/// app's `changes.ts`. Records keep their payload as stored, so a change in an encrypted vault is encrypted here too.
public struct ChangeEntry: Codable, Sendable, Hashable {
    public var n: Int64?
    /// When the change was made, and when it last grew: typing saves a few minutes apart are one change.
    public var at: Int64
    public var until: Int64
    /// Changes made by one action, like trashing five entries, share this and are undone together.
    public var group: String
    public var cardId: String
    /// Nil when the change made the card.
    public var before: CardRecord?
    /// Set when the change moved the card to another vault: the vault it came from. `before` is then stored the way
    /// its new vault stores cards.
    public var beforeVault: String?
    public var after: CardRecord
    /// The fields that differ between `before` and `after`. Empty for a new card.
    public var fields: [String]
    /// Whether saves that follow may join this change. Only typing does that.
    public var joins: Bool?
    public var undoneAt: Int64?
    public var redoneAt: Int64?
}

/// A change with its cards readable. `sealed` when they aren't, because their vault's key isn't open.
public struct Change: Sendable, Hashable, Identifiable {
    /// Its place in this device's log. Below zero for a change that came by sync.
    public var n: Int64
    public var at: Int64
    public var until: Int64
    public var group: String
    public var cardId: String
    public var before: Card?
    public var after: Card
    public var fields: [String]
    public var undoneAt: Int64?
    public var redoneAt: Int64?
    public var sealed: Bool
    /// Set on a change that came by sync: who made it.
    public var by: String?
    public var id: Int64 { n }
}

public enum Changes {
    static let text: Set<String> = ["title", "content", "pages", "back"]

    /// A card's fields as the web app names them: the payload's, its vault and whether it's in the Trash.
    static func fields(_ card: Card) -> [String: JSONValue] {
        var out = card.payload
        out["vaultId"] = .string(card.vaultId)
        out["deleted"] = .bool(card.deleted)
        return out
    }

    /// The fields two versions of a card differ in, sorted.
    public static func changed(_ before: Card, _ after: Card) -> [String] {
        let a = fields(before)
        let b = fields(after)
        return Set(a.keys).union(b.keys).filter { a[$0] != b[$0] }.sorted()
    }

    public static func isTextChange(_ fields: [String]) -> Bool { !fields.isEmpty && fields.allSatisfy(text.contains) }

    /// A few words for what a change did.
    public static func describe(_ change: Change) -> String {
        guard change.before != nil else { return "Created" }
        let after = change.after
        let has = { (k: String) in change.fields.contains(k) }
        if has("deleted") { return after.deleted ? "Moved to Trash" : "Restored from Trash" }
        if has("archived") { return after.archived ? "Archived" : "Unarchived" }
        if has("template") { return after.template ? "Made a template" : "No longer a template" }
        if has("type") { return after.type == .todo ? "Turned into a todo" : "Turned into a note" }
        if has("vaultId") { return "Moved to another vault" }
        if has("status") && after.type == .todo { return after.isDone ? "Marked done" : "Reopened" }
        if has("waiting") && after.type == .todo { return after.waiting ? "Marked waiting" : "No longer waiting" }
        if has("content") { return "Edited" }
        if has("pages") || has("back") { return "Edited a page" }
        if has("title") { return after.type == .todo ? "Edited" : "Renamed" }
        if has("tags") { return has("position") ? "Moved on the board" : "Changed tags" }
        if has("due") || has("dueTime") { return "Changed due date" }
        if has("start") { return "Changed start date" }
        if has("repeat") { return "Changed repeat" }
        if has("pinned") && after.type == .tag { return after.pinned ? "Pinned" : "Unpinned" }
        if has("color") { return "Changed color" }
        if has("preview") { return "Changed style" }
        if has("reactions") { return "Changed reactions" }
        if has("viewOnly") { return after.viewOnly ? "Made view only" : "Made editable" }
        if has("members") || has("choice") || has("ordered") { return "Changed tag group" }
        if has("stack") { return "Changed the stack" }
        if has("position") { return "Moved on the board" }
        return "Changed"
    }

    /// A change can be undone while the card still holds what the change left, so a later edit is never overwritten.
    /// A new card can be undone until it's in the Trash, which is where undoing it puts it.
    public static func canUndo(_ change: Change, _ current: Card?) -> Bool {
        guard change.undoneAt == nil, !change.sealed, let current else { return false }
        guard change.before != nil else { return !current.deleted }
        let now = fields(current)
        let left = fields(change.after)
        return change.fields.allSatisfy { now[$0] == left[$0] }
    }

    /// An undone change can be redone while the card still holds what undoing left.
    public static func canRedo(_ change: Change, _ current: Card?) -> Bool {
        guard change.undoneAt != nil, !change.sealed, let current else { return false }
        guard let before = change.before else { return current.deleted }
        let now = fields(current)
        let was = fields(before)
        return change.fields.allSatisfy { now[$0] == was[$0] }
    }

    /// The card with a change taken back, or put back. Only the fields the change touched move.
    public static func revert(_ current: Card, _ change: Change, undo: Bool) -> Card {
        guard let before = change.before else {
            var c = current
            c.deleted = undo
            return c
        }
        let source = fields(undo ? before : change.after)
        var next = current
        for key in change.fields {
            switch key {
            case "vaultId": next.vaultId = source[key]?.stringValue ?? next.vaultId
            case "deleted": next.deleted = source[key]?.boolValue ?? false
            default:
                if let v = source[key] { next.payload[key] = v } else { next.payload.removeValue(forKey: key) }
            }
        }
        return next
    }

    /// Whether a change belongs in a filtered history: the card passed the filter before the change or after it.
    public static func matches(_ change: Change, _ filter: StreamFilter, today: String) -> Bool {
        let inVault = { (card: Card) in filter.vaultId == nil || card.vaultId == filter.vaultId }
        let narrowed = filter.effectiveType != nil || filter.has != nil || filter.when != nil || filter.archived
        if change.sealed { return !narrowed && filter.tagId == nil && inVault(change.after) }
        let match = Stream.matcher(filter, today: today)
        let fits = { (card: Card?) -> Bool in
            guard let card else { return false }
            if card.type == .tag { return !narrowed && inVault(card) && (filter.tagId == nil || filter.tagId == card.id) }
            return match(card, nil)
        }
        return fits(change.before) || fits(change.after)
    }

    public struct Group: Sendable, Hashable, Identifiable {
        public var group: String
        /// Newest first.
        public var changes: [Change]
        public var at: Int64
        public var id: String { group }
    }

    /// Changes gathered by action, newest action first.
    public static func grouped(_ changes: [Change]) -> [Group] {
        var order: [String] = []
        var groups: [String: Group] = [:]
        for change in changes.sorted(by: { $0.n > $1.n }) {
            if groups[change.group] != nil {
                groups[change.group]!.changes.append(change)
            } else {
                order.append(change.group)
                groups[change.group] = Group(group: change.group, changes: [change], at: change.until)
            }
        }
        return order.compactMap { groups[$0] }
    }

    /// What Undo takes back: the newest action with anything that can be undone.
    public static func nextUndo(_ changes: [Change], usable: (Change) -> Bool) -> [Change] {
        for group in grouped(changes) {
            let ready = group.changes.filter { $0.undoneAt == nil && usable($0) }
            if !ready.isEmpty { return ready }
        }
        return []
    }

    /// What Redo puts back: the changes undone last, together. Nothing once a change was made after that undo.
    public static func nextRedo(_ changes: [Change], usable: (Change) -> Bool) -> [Change] {
        guard let last = changes.compactMap(\.undoneAt).max() else { return [] }
        if changes.contains(where: { $0.undoneAt == nil && $0.until > last }) { return [] }
        return changes.filter { $0.undoneAt == last && usable($0) }
    }
}

extension Card {
    /// The fields restoring a version puts back, a note or todo's type among them; the ID and vault stay as they are.
    /// As the web app's `restorePatch`.
    public func restoreFields() -> [String: JSONValue] {
        var out: [String: JSONValue] = ["title": .string(title), "content": content]
        switch type {
        case .tag:
            out["pinned"] = .bool(pinned)
        case .note, .todo:
            out["type"] = .string(type.rawValue)
            out["back"] = payload["back"] ?? .null
            out["pages"] = payload["pages"] ?? .null
            out["tags"] = .array(tags.map(JSONValue.string))
            if type == .note, let stack = payload["stack"] { out["stack"] = stack }
            if type == .todo {
                for key in ["status", "due", "dueTime", "start", "repeat"] { out[key] = payload[key] ?? .null }
            }
        }
        return out
    }
}

/// One version from the server's history of every card, with the version it replaced, as `GET /api/versions` gives.
public struct RecentVersion: Codable, Sendable, Hashable {
    public struct Before: Codable, Sendable, Hashable {
        public var payload: String
        public var deleted: Bool
    }
    public struct Device: Codable, Sendable, Hashable {
        public var here: Bool
        public var name: String?
    }
    public var id: Int64
    public var card_id: String
    public var vault_id: String
    public var started_at: Int64
    public var saved_at: Int64
    public var author: String?
    public var via: String?
    public var payload: String
    public var deleted: Bool
    public var before: Before?
    public var mine: Bool
    public var device: Device?
}

public struct RecentVersions: Codable, Sendable {
    public var versions: [RecentVersion]
    public var next: String?
}

extension ServerAPI {
    /// A page of the newest versions of every card, with what each replaced; `before` is the last page's `next`.
    public func recentVersions(before: String? = nil) async throws -> RecentVersions {
        try await json(RecentVersions.self, "/versions" + (before.map { "?before=" + Self.part($0) } ?? ""))
    }
}

extension Changes {
    /// A version read as an entry of the change log, to be read the same way.
    public static func entry(_ v: RecentVersion) -> ChangeEntry {
        func record(_ payload: String, _ deleted: Bool, _ at: Int64) -> CardRecord {
            CardRecord(id: v.card_id, vault_id: v.vault_id, updated_at: at, deleted: deleted, seq: 0, payload: payload)
        }
        return ChangeEntry(
            n: -v.id, at: v.started_at, until: v.saved_at, group: "v:\(v.id)", cardId: v.card_id,
            before: v.before.map { record($0.payload, $0.deleted, v.started_at) }, after: record(v.payload, v.deleted, v.saved_at), fields: [])
    }

    /// Who or what made a change that came by sync, in a few words.
    public static func madeBy(_ v: RecentVersion) -> String {
        let who = v.author ?? "Someone"
        if let via = v.via { return v.mine ? "\(via) (AI)" : "\(who) via \(via) (AI)" }
        if !v.mine { return who }
        if v.device?.here == true { return "This device" }
        return v.device.map { $0.name ?? "Another device" } ?? "One of your devices"
    }

    /// Whether this device's log already shows a change that came by sync, because this device made it.
    public static func inLog(_ change: Change, _ v: RecentVersion, _ log: [Change]) -> Bool {
        guard v.mine, v.via == nil, v.device.map(\.here) ?? true else { return false }
        return log.contains { $0.cardId == change.cardId && $0.at <= change.until && max($0.until, $0.undoneAt ?? 0, $0.redoneAt ?? 0) >= change.at }
    }
}

extension Repository {
    /// A version from the server read as a change: what it changed and who made it. Nil when it changed nothing a
    /// card says. As in the log, a card's first words make it.
    public nonisolated func syncedChange(_ v: RecentVersion) -> Change? {
        var entry = Changes.entry(v)
        entry.n = -v.id
        let after = decodeOpen(entry.after)
        let before = entry.before.map(decodeOpen)
        var change = Change(
            n: -v.id, at: entry.at, until: entry.until, group: entry.group, cardId: entry.cardId, before: before, after: after, fields: [],
            sealed: after.sealed || (before?.sealed ?? false), by: Changes.madeBy(v))
        if change.sealed { return change }
        guard let b = before, !b.isBlank else {
            if after.isBlank { return nil }
            change.before = nil
            return change
        }
        change.fields = Changes.changed(b, after)
        return change.fields.isEmpty ? nil : change
    }

    /// A record opened with the keyring as it is, without waiting on the store.
    nonisolated func decodeOpen(_ r: CardRecord) -> Card {
        if let payload = keyring.decode(r.payload, id: r.id, vaultId: r.vault_id) {
            return Card(id: r.id, vaultId: r.vault_id, updatedAt: r.updated_at, deleted: r.deleted, seq: r.seq, payload: modernPayload(payload))
        }
        return Card(id: r.id, vaultId: r.vault_id, updatedAt: r.updated_at, deleted: r.deleted, seq: r.seq, payload: ["type": "note", "title": "", "tags": [], "content": Doc.empty], sealed: true)
    }
}
