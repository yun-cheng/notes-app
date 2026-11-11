import Foundation

public enum CardType: String, Sendable, CaseIterable {
    case note, todo, diary, tag
}

/// A decoded card. Its payload stays raw JSON, so fields written by a newer app aren't lost when this one saves.
public struct Card: Identifiable, Sendable, Hashable {
    public var id: String
    public var vaultId: String
    public var updatedAt: Int64
    public var deleted: Bool
    public var seq: Int64
    public var payload: [String: JSONValue]
    /// A stand-in for a card in an encrypted vault this device can't read yet. It must never be saved.
    public var sealed: Bool

    public init(id: String, vaultId: String, updatedAt: Int64, deleted: Bool, seq: Int64, payload: [String: JSONValue], sealed: Bool = false) {
        self.id = id
        self.vaultId = vaultId
        self.updatedAt = updatedAt
        self.deleted = deleted
        self.seq = seq
        self.payload = payload
        self.sealed = sealed
    }

    public var type: CardType {
        payload["type"]?.stringValue.flatMap(CardType.init(rawValue:)) ?? .note
    }

    public var title: String {
        get { payload["title"]?.stringValue ?? "" }
        set { payload["title"] = .string(newValue) }
    }

    public var content: JSONValue {
        get { payload["content"] ?? Doc.empty }
        set { payload["content"] = newValue }
    }

    /// IDs of tag cards.
    public var tags: [String] {
        get { payload["tags"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
        set { payload["tags"] = .array(newValue.map(JSONValue.string)) }
    }

    public var createdAt: Int64 { payload["createdAt"]?.intValue ?? updatedAt }

    // Todos

    public var isDone: Bool { payload["status"]?.stringValue == "done" }

    /// A local date key (YYYY-MM-DD), or nil for no due date.
    public var due: String? {
        get { payload["due"]?.stringValue }
        set { payload["due"] = newValue.map(JSONValue.string) ?? .null }
    }

    public var completedAt: Int64? { payload["completedAt"]?.intValue }

    // Diary

    public var date: String { payload["date"]?.stringValue ?? "" }

    // Tags

    public var pinned: Bool { payload["pinned"]?.boolValue ?? false }

    public var displayTitle: String {
        if type == .diary { return date }
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "Untitled" : t
    }

    /// A note or todo the user opened but never wrote anything in. A photo counts as something.
    public var isBlank: Bool {
        if type == .tag { return false }
        return title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && tags.isEmpty
            && Doc.plainText(content).isEmpty && Doc.photoIds(content).isEmpty
    }
}

/// Derived from the date, so two devices can't create two diary entries for one day.
public func diaryId(vaultId: String, date: String) -> String { "diary:\(vaultId):\(date)" }
