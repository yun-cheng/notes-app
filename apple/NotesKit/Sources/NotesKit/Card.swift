import Foundation

/// Notes and todos are entries in the journal; a tag is a card too. The diary used to be a type of its own and is now
/// a vault of ordinary entries (see `modernPayload`).
public enum CardType: String, Sendable, CaseIterable {
    case note, todo, tag
}

/// A color an entry's bubble can be tinted with, as the web app's `CARD_COLORS`.
public enum CardColor: String, Sendable, CaseIterable {
    case red, orange, yellow, green, blue, purple, pink, gray
}

/// How a todo comes back: every N days, weeks, months or years, or every weekday (Monday to Friday, `every` 1).
public struct Repeat: Sendable, Hashable {
    public enum Unit: String, Sendable, CaseIterable { case day, week, month, year, weekday }
    public var unit: Unit
    public var every: Int

    public init(unit: Unit, every: Int) {
        self.unit = unit
        self.every = max(1, every)
    }

    var json: JSONValue { ["unit": .string(unit.rawValue), "every": .int(Int64(every))] }

    init?(_ json: JSONValue?) {
        guard let unit = json?["unit"]?.stringValue.flatMap(Unit.init(rawValue:)) else { return nil }
        self.init(unit: unit, every: Int(json?["every"]?.intValue ?? 1))
    }
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

    public var isEntry: Bool { type != .tag }

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

    public var createdAt: Int64 {
        get { payload["createdAt"]?.intValue ?? updatedAt }
        set { payload["createdAt"] = .int(newValue) }
    }

    private func flag(_ key: String) -> Bool { payload[key]?.boolValue ?? false }

    /// Sets a flag that most cards leave out: false removes it, as the web app does.
    private mutating func setFlag(_ key: String, _ on: Bool) {
        if on { payload[key] = true } else { payload.removeValue(forKey: key) }
    }

    /// Put away: out of the journal and the todo counts, still searchable, until unarchived.
    public var archived: Bool {
        get { flag("archived") }
        set { setFlag("archived", newValue) }
    }

    /// Kept to start new entries from: only under the journal's Templates filter.
    public var template: Bool {
        get { flag("template") }
        set { setFlag("template", newValue) }
    }

    /// Opens to read until this is turned off, for everyone.
    public var viewOnly: Bool {
        get { flag("viewOnly") }
        set { setFlag("viewOnly", newValue) }
    }

    public var color: CardColor? {
        get { payload["color"]?.stringValue.flatMap(CardColor.init(rawValue:)) }
        set { payload["color"] = newValue.map { .string($0.rawValue) } ?? .null }
    }

    /// Its place in a board column, once dragged there: lower first.
    public var position: Double? {
        get {
            switch payload["position"] {
            case .int(let i): Double(i)
            case .double(let d): d
            default: nil
            }
        }
        set { payload["position"] = newValue.map(JSONValue.double) ?? .null }
    }

    /// Its pages after the first (`content`), as kept, blank ones included. A card from before it could have more
    /// than one had at most one more, its `back`. As the web app's `storedPages`.
    public var morePages: [JSONValue] {
        get {
            if type == .tag { return [] }
            if let pages = payload["pages"]?.arrayValue { return pages.filter(Doc.isDoc) }
            if let back = payload["back"], Doc.isDoc(back) { return [back] }
            return []
        }
        set {
            // Blank pages at the end are nothing to turn to.
            var pages = newValue
            while let last = pages.last, Doc.isBlank(last) { pages.removeLast() }
            payload["pages"] = pages.isEmpty ? .null : .array(pages)
            if let back = payload["back"], !back.isNull { payload["back"] = .null }
        }
    }

    /// Every page with something on it after the first: what turning it over shows.
    public var turnPages: [JSONValue] { morePages.filter { !Doc.isBlank($0) } }

    /// Emoji reactions, each with the accounts that put it on.
    public var reactions: [String: [String]] {
        guard let object = payload["reactions"]?.objectValue else { return [:] }
        return object.compactMapValues { $0.arrayValue?.compactMap(\.stringValue) }.filter { !$0.value.isEmpty }
    }

    public mutating func setReactions(_ reactions: [String: [String]]) {
        let kept = reactions.filter { !$0.value.isEmpty }
        payload["reactions"] = kept.isEmpty ? .null : .object(kept.mapValues { .array($0.map(JSONValue.string)) })
    }

    // Stacks

    /// Set on a stack only: the entries grouped in it, in order.
    public var stack: [String]? {
        get { payload["stack"]?.arrayValue?.compactMap(\.stringValue) }
        set {
            if let newValue { payload["stack"] = .array(newValue.map(JSONValue.string)) } else { payload.removeValue(forKey: "stack") }
        }
    }

    public var isStack: Bool { type == .note && stack != nil }

    // Todos

    public var isDone: Bool { payload["status"]?.stringValue == "done" }

    /// A local date key (YYYY-MM-DD), or nil for no due date.
    public var due: String? {
        get { payload["due"]?.stringValue }
        set { payload["due"] = newValue.map(JSONValue.string) ?? .null }
    }

    /// Local time on the due date (HH:MM), or nil for any time that day.
    public var dueTime: String? {
        get { payload["dueTime"]?.stringValue }
        set { payload["dueTime"] = newValue.map(JSONValue.string) ?? .null }
    }

    /// The day work on it starts, on or before its due date.
    public var start: String? {
        get { payload["start"]?.stringValue }
        set { payload["start"] = newValue.map(JSONValue.string) ?? .null }
    }

    public var `repeat`: Repeat? {
        get { Repeat(payload["repeat"]) }
        set { payload["repeat"] = newValue?.json ?? .null }
    }

    /// Open but on hold: left out of what's due, and never overdue.
    public var waiting: Bool {
        get { flag("waiting") }
        set { setFlag("waiting", newValue) }
    }

    public var completedAt: Int64? { payload["completedAt"]?.intValue }

    // Tags

    /// A pinned tag appears in the sidebar.
    public var pinned: Bool { flag("pinned") }

    /// Set on a tag group only: the tags in it, in order.
    public var members: [String]? { payload["members"]?.arrayValue?.compactMap(\.stringValue) }

    public var isGroup: Bool { type == .tag && members != nil }

    /// A group's rule: an entry takes one of its tags (Priority) or any number (Topics).
    public var choosesOne: Bool { payload["choice"]?.stringValue == "one" }

    /// A group whose order ranks its tags.
    public var ordered: Bool { flag("ordered") }

    /// Kept to its vault, rather than for every vault.
    public var keptToVault: Bool { payload["scope"]?.stringValue == "vault" }

    /// The title, or for a card without one, its first line of text; a stack with neither is a Stack.
    public var displayTitle: String {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { return t }
        let line = Doc.firstLine(content)
        if !line.isEmpty { return line }
        return isStack ? "Stack" : "Untitled"
    }

    /// A note or todo the user opened but never wrote anything in. A photo counts as something.
    public var isBlank: Bool {
        if type == .tag || isStack { return false }
        return title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && tags.isEmpty && Doc.isBlank(content)
    }
}

/// A card as it is now. The diary used to be its own type of card, one per day; now it's a vault of ordinary
/// entries, so a diary card saved back then reads as a note written on its day (at the end of it, if it was started
/// on another day). As the web app's `modernCard`.
public func modernPayload(_ payload: [String: JSONValue], calendar: Calendar = .current) -> [String: JSONValue] {
    guard payload["type"]?.stringValue == "diary" else { return payload }
    var out = payload
    out["type"] = "note"
    let date = out.removeValue(forKey: "date")?.stringValue
    guard let date else { return out }
    if let created = out["createdAt"]?.intValue,
        DateKey.of(Date(ms: created), calendar: calendar) == date
    {
        return out
    }
    if let day = DateKey.date(date, calendar: calendar),
        let end = calendar.date(byAdding: DateComponents(day: 1, nanosecond: -1_000_000), to: calendar.startOfDay(for: day))
    {
        out["createdAt"] = .int(Int64((end.timeIntervalSince1970 * 1000).rounded()))
    }
    return out
}
