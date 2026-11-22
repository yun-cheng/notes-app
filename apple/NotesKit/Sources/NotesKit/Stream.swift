import Foundation

/// The journal stream, as the web app's `stream.ts`: what it's narrowed to, how it's ordered, and the day each bubble
/// is grouped under.
public struct StreamItem: Sendable, Hashable, Identifiable {
    public var card: Card
    /// The day it's grouped under: written, or edited or due with those sorts ('' for no due date), or a tag's ID with
    /// a group sort.
    public var day: String
    public var at: Int64
    public var id: String { card.id }
}

public struct StreamFilter: Sendable, Hashable {
    /// Notes (stacks left out), todos, or stacks.
    public enum EntryType: String, Sendable, CaseIterable { case note, todo, stack }
    /// Open or done, or open and due by today, after today, or with no date, or waiting.
    public enum TodoStatus: String, Sendable, CaseIterable { case open, done, today, upcoming, undated, waiting }
    public enum Contains: String, Sendable, CaseIterable { case link, photo, file }
    /// Oldest first like a chat (the default), newest first, recently edited, by due date, or by an ordered tag group.
    public enum Sort: Sendable, Hashable {
        case written, newest, edited, due
        case group(String)
    }

    public var sort: Sort = .written
    public var type: EntryType?
    public var status: TodoStatus?
    /// `today`, `week`, `month`, a day (a date key), or a range written `from..to`.
    public var when: String?
    public var tagId: String?
    public var vaultId: String?
    public var has: Contains?
    /// Archived entries instead of the rest.
    public var archived = false
    /// Templates instead of the rest.
    public var template = false
    /// Shown as a board: a tag group's ID, `state` for Open, Waiting and Done, or `pick` to choose.
    public var board: String?

    public init(
        sort: Sort = .written, type: EntryType? = nil, status: TodoStatus? = nil, when: String? = nil, tagId: String? = nil, vaultId: String? = nil,
        has: Contains? = nil, archived: Bool = false, template: Bool = false, board: String? = nil
    ) {
        self.sort = sort
        self.type = type
        self.status = status
        self.when = when
        self.tagId = tagId
        self.vaultId = vaultId
        self.has = has
        self.archived = archived
        self.template = template
        self.board = board
    }

    public var isFiltered: Bool { type != nil || status != nil || when != nil || tagId != nil || vaultId != nil || has != nil || archived || template }

    /// A todo status only makes sense for todos, so it narrows to them.
    public var effectiveType: EntryType? { status != nil ? .todo : type }

    public enum Part: Sendable, Hashable { case type, status, when, tag, vault, has, archived, template }

    /// The parts a filter is made of, in the order they're named, each with what's left without it.
    public var parts: [(part: Part, without: StreamFilter)] {
        var out: [(Part, StreamFilter)] = []
        if effectiveType != nil {
            var f = self
            f.type = nil
            f.status = nil
            out.append((.type, f))
        }
        if status != nil {
            var f = self
            f.type = effectiveType
            f.status = nil
            out.append((.status, f))
        }
        if when != nil { out.append((.when, with { $0.when = nil })) }
        if tagId != nil { out.append((.tag, with { $0.tagId = nil })) }
        if vaultId != nil { out.append((.vault, with { $0.vaultId = nil })) }
        if has != nil { out.append((.has, with { $0.has = nil })) }
        if archived { out.append((.archived, with { $0.archived = false })) }
        if template { out.append((.template, with { $0.template = false })) }
        return out
    }

    public func with(_ change: (inout StreamFilter) -> Void) -> StreamFilter {
        var f = self
        change(&f)
        return f
    }

}

extension StreamFilter.Sort {
    public static let labels: [(StreamFilter.Sort, String)] = [(.written, "Oldest first"), (.newest, "Newest first"), (.edited, "Recently edited"), (.due, "Due date")]

    public func label(groups: [TagGroup]) -> String {
        if case .group(let id) = self, let g = groups.first(where: { $0.id == id }) { return "By \(g.title.lowercased())" }
        return Self.labels.first { $0.0 == self }?.1 ?? "Oldest first"
    }
}

public enum StreamLabels {
    public static let contains: [StreamFilter.Contains: String] = [.link: "With links", .photo: "With photos", .file: "With files"]
    public static let status: [StreamFilter.TodoStatus: String] = [
        .open: "Open", .done: "Done", .today: "Due today", .upcoming: "Upcoming", .undated: "No date", .waiting: "Waiting",
    ]
    public static let type: [StreamFilter.EntryType: String] = [.note: "Notes", .todo: "Todos", .stack: "Stacks"]
    public static let when: [String: String] = ["today": "Written today", "week": "Past 7 days", "month": "Past 30 days"]

    public static func when(_ when: String, today: String) -> String {
        if let preset = Self.when[when] { return preset }
        if let (from, to) = Stream.dayRange(when) {
            let year = today.prefix(4)
            guard let a = DateKey.date(from), let b = DateKey.date(to) else { return when }
            var style = Date.FormatStyle().month(.abbreviated).day()
            if from.prefix(4) != year || to.prefix(4) != year { style = style.year() }
            return "\(a.formatted(style)) – \(b.formatted(style))"
        }
        return DateKey.relativeDay(when, today: today)
    }
}

public enum Stream {
    /// The first and last day of a `from..to` range, or nil when it isn't one.
    public static func dayRange(_ when: String) -> (String, String)? {
        guard let m = when.wholeMatch(of: /(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/) else { return nil }
        let (a, b) = (String(m.1), String(m.2))
        return DateKey.isKey(a) && DateKey.isKey(b) && a <= b ? (a, b) : nil
    }

    /// The `when` for the days from one to another, in either order: a single day when they're the same.
    public static func daysWhen(_ a: String, _ b: String) -> String {
        if a == b { return a }
        return a < b ? "\(a)..\(b)" : "\(b)..\(a)"
    }

    /// The first and last day of a `when`.
    public static func whenRange(_ when: String, today: String) -> (String, String) {
        switch when {
        case "today": return (today, today)
        case "week": return (DateKey.adding(-6, to: today), today)
        case "month": return (DateKey.adding(-29, to: today), today)
        default: return dayRange(when) ?? (when, when)
        }
    }

    public static func entryDay(_ card: Card) -> String { DateKey.of(Date(ms: card.createdAt)) }

    static func matchesStatus(_ card: Card, _ status: StreamFilter.TodoStatus, today: String) -> Bool {
        if status == .done { return card.isDone }
        if card.isDone { return false }
        switch status {
        case .open: return true
        case .waiting: return card.waiting
        case _ where card.waiting: return false
        case .today: return card.due.map { $0 <= today } ?? false
        case .upcoming: return card.due.map { $0 > today } ?? false
        case .undated: return card.due == nil
        default: return true
        }
    }

    /// Whether an entry passes a filter. Tags aren't entries, so none does.
    public static func matcher(_ filter: StreamFilter, today: String, sharedInto: SharedInto = [:]) -> (Card, String?) -> Bool {
        let type = filter.effectiveType
        let (from, to) = filter.when.map { whenRange($0, today: today) } ?? ("", "9999")
        return { card, day in
            guard card.isEntry else { return false }
            if let type, type == .stack ? !card.isStack : (card.type.rawValue != type.rawValue || card.isStack) { return false }
            if let tag = filter.tagId, !card.tags.contains(tag) { return false }
            if let vault = filter.vaultId, card.vaultId != vault, !(sharedInto[card.id] ?? []).contains(vault) { return false }
            if let status = filter.status, card.type != .todo || !matchesStatus(card, status, today: today) { return false }
            if let has = filter.has {
                switch has {
                case .link: if Doc.linkUrls(card.content).isEmpty { return false }
                case .file: if Doc.fileIds(card.content).isEmpty { return false }
                case .photo: if !Doc.hasPhoto(card.content) { return false }
                }
            }
            if filter.archived && !card.archived { return false }
            if filter.template && !card.template { return false }
            let d = day ?? entryDay(card)
            return d >= from && d <= to
        }
    }

    /// Notes and todos in the order they were written, oldest first, like messages in a chat.
    public static func items(_ index: CardIndex, _ filter: StreamFilter = StreamFilter(), today: String = DateKey.today(), sharedInto: SharedInto = [:]) -> [StreamItem] {
        let keep = matcher(filter, today: today, sharedInto: sharedInto)
        var items: [StreamItem] = []
        for card in index.live where card.isEntry && card.archived == filter.archived && card.template == filter.template {
            let day = entryDay(card)
            if keep(card, day) { items.append(StreamItem(card: card, day: day, at: card.createdAt)) }
        }
        if case .group(let id) = filter.sort, let group = index.tagGroups.groups.first(where: { $0.id == id }) {
            return items.map { item -> (StreamItem, Int) in
                let rank = group.rank(item.card.tags)
                var i = item
                i.day = rank < group.members.count ? group.members[rank].id : ""
                return (i, rank)
            }.sorted { ($0.1, $0.0.at) < ($1.1, $1.0.at) }.map(\.0)
        }
        switch filter.sort {
        case .newest: return items.sorted { $0.at > $1.at }
        case .edited:
            return items.map { i in
                var e = i
                e.at = i.card.updatedAt
                e.day = DateKey.of(Date(ms: i.card.updatedAt))
                return e
            }.sorted { $0.at < $1.at }
        case .due:
            // Soonest first, and on a day by time, with todos due any time that day after the timed ones; anything
            // without a due date after, oldest written first.
            let time = { (i: StreamItem) in i.card.type == .todo ? (i.card.dueTime ?? "24:00") : "24:00" }
            return items.map { i in
                var d = i
                d.day = i.card.type == .todo ? (i.card.due ?? "") : ""
                return d
            }.sorted { a, b in
                if a.day == b.day { return (time(a), a.at) < (time(b), b.at) }
                if a.day.isEmpty { return false }
                if b.day.isEmpty { return true }
                return a.day < b.day
            }
        default: return items.sorted { $0.at < $1.at }
        }
    }

    /// The stream with each stack's entries folded into it, where the stack is in the stream too.
    public static func foldStacks(_ items: [StreamItem], stackOf: [String: String]) -> [StreamItem] {
        guard !stackOf.isEmpty else { return items }
        let shown = Set(items.map(\.card.id))
        return items.filter { i in stackOf[i.card.id].map { !shown.contains($0) } ?? true }
    }
}
