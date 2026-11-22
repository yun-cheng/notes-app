import Foundation

/// The journal as a board, as the web app's `board.ts`: a tag group's tags as columns, or a todo's state (Open,
/// Waiting, Done), each holding its entries in an order set by dragging them.
public struct BoardColumn: Sendable, Identifiable {
    /// The tag's ID, a state's name, or '' for entries with none of the group's tags.
    public var key: String
    public var title: String
    public var items: [StreamItem]
    public var id: String { key }
}

public enum Board {
    public static let state = "state"
    /// Space left between positions, so a card can go between two many times before they need spacing out again.
    static let step = 1024.0

    /// Where an entry sits in its column: its own place once dragged, otherwise when it was written.
    public static func position(_ card: Card) -> Double { card.position.flatMap { $0.isFinite ? $0 : nil } ?? Double(card.createdAt) }

    static func byPosition(_ a: StreamItem, _ b: StreamItem) -> Bool {
        let (pa, pb) = (position(a.card), position(b.card))
        if pa != pb { return pa < pb }
        if a.card.createdAt != b.card.createdAt { return a.card.createdAt < b.card.createdAt }
        return a.card.id < b.card.id
    }

    /// The columns for a group: "No {group}" first, then its tags in the group's order.
    public static func columns(_ items: [StreamItem], group: TagGroup) -> [BoardColumn] {
        var columns = [BoardColumn(key: "", title: "No \(group.title.lowercased())", items: [])]
            + group.members.map { BoardColumn(key: $0.id, title: $0.displayTitle, items: []) }
        for item in items { columns[(group.rank(item.card.tags) + 1) % columns.count].items.append(item) }
        for i in columns.indices { columns[i].items.sort(by: byPosition) }
        return columns
    }

    public enum TodoState: String, Sendable, CaseIterable { case open, waiting, done }

    public static func stateOf(_ todo: Card) -> TodoState { todo.isDone ? .done : todo.waiting ? .waiting : .open }

    /// The todos among the items, in a column for each state.
    public static func stateColumns(_ items: [StreamItem]) -> [BoardColumn] {
        var columns = TodoState.allCases.map { BoardColumn(key: $0.rawValue, title: $0.rawValue.capitalized, items: []) }
        for item in items where item.card.type == .todo {
            columns[TodoState.allCases.firstIndex(of: stateOf(item.card))!].items.append(item)
        }
        for i in columns.indices { columns[i].items.sort(by: byPosition) }
        return columns
    }

    public static func columnOf(_ card: Card, group: TagGroup) -> String {
        let rank = group.rank(card.tags)
        return rank < group.members.count ? group.members[rank].id : ""
    }

    /// An entry's tags after moving it between columns: in a one-choice group the new column's tag takes the place of
    /// the group's; in a many-choice group only the column it left is swapped for the one it went to.
    public static func tags(_ tags: [String], group: TagGroup, from: String, to: String) -> [String] {
        if from == to { return tags }
        if to.isEmpty { return group.pick(tags, nil) }
        if group.choosesOne { return group.pick(tags, to) }
        let kept = tags.filter { $0 != from }
        return kept.contains(to) ? kept : kept + [to]
    }

    /// The positions to save for dropping `moved` at `index` among `others`, a column's entries without it: just its
    /// own, halfway between its new neighbours, or the whole column spaced out again when there's no room.
    public static func place(_ moved: Card, at index: Int, among others: [Card]) -> [String: Double] {
        let at = max(0, min(index, others.count))
        let low = at > 0 ? position(others[at - 1]) : nil
        let high = at < others.count ? position(others[at]) : nil
        let now = position(moved)
        if (low.map { $0 < now } ?? true) && (high.map { now < $0 } ?? true) { return [:] }
        let place: Double
        switch (low, high) {
        case (nil, nil): place = now
        case (nil, let h?): place = h - step
        case (let l?, nil): place = l + step
        case (let l?, let h?): place = l + (h - l) / 2
        }
        if (low.map { $0 < place } ?? true) && (high.map { place < $0 } ?? true) { return [moved.id: place] }
        var order = others
        order.insert(moved, at: at)
        let start = position(order.first?.id == moved.id ? (others.first ?? moved) : order[0])
        var spaced: [String: Double] = [:]
        for (i, card) in order.enumerated() {
            let p = start + Double(i) * step
            if card.id == moved.id || position(card) != p { spaced[card.id] = p }
        }
        return spaced
    }

    /// The tag in a one-choice group that stands for a ticked todo: the one named Done.
    public static func doneTag(_ group: TagGroup) -> Card? {
        group.choosesOne ? group.members.first { $0.title.trimmingCharacters(in: .whitespaces).lowercased() == "done" } : nil
    }

    /// A todo's tags after it's ticked or reopened, on each board it's on: ticked, it moves to its group's Done;
    /// reopened from Done, to the group's first other tag.
    public static func tagsForStatus(_ tags: [String], groups: [TagGroup], done: Bool) -> [String] {
        var next = tags
        for group in groups {
            guard let doneTag = doneTag(group), group.members.contains(where: { next.contains($0.id) }) else { continue }
            if done && !next.contains(doneTag.id) { next = group.pick(next, doneTag.id) }
            if !done && next.contains(doneTag.id), let back = group.members.first(where: { $0.id != doneTag.id }) { next = group.pick(next, back.id) }
        }
        return next
    }

    public enum Became: Sendable { case done, open, waiting, resumed, moved }

    /// Moves a card between a tag group's columns: its tag swapped, and into or out of a Done column ticked or
    /// reopened. A repeating todo dropped in Done moves on to its next date instead, and stays. Returns what it became
    /// and, for a repeating todo, when it's due next.
    public static func groupMove(_ card: inout Card, group: TagGroup, from: String, to: String, today: String, at: Int64) -> (Became, String?) {
        let doneId = doneTag(group)?.id
        let status: Became? =
            card.type != .todo || doneId == nil || from == to ? nil
            : to == doneId && !card.isDone ? .done
            : from == doneId && card.isDone ? .open : nil
        if status == .done, card.repeat != nil {
            let next = card.complete(today: today, at: at)
            return (.done, next)
        }
        card.tags = tags(card.tags, group: group, from: from, to: to)
        if status == .done { card.complete(today: today, at: at) }
        if status == .open { card.reopen() }
        return (status ?? .moved, nil)
    }

    /// Moves a todo between the state columns: into Done it's ticked; into Open or Waiting it's reopened, waiting or not.
    public static func stateMove(_ todo: inout Card, to: TodoState, today: String, at: Int64, groups: [TagGroup]) -> (Became, String?) {
        let from = stateOf(todo)
        if from == to { return (.moved, nil) }
        if to == .done {
            if let next = todo.complete(today: today, at: at) { return (.done, next) }
            todo.tags = tagsForStatus(todo.tags, groups: groups, done: true)
            return (.done, nil)
        }
        if from == .done {
            todo.reopen()
            todo.tags = tagsForStatus(todo.tags, groups: groups, done: false)
        }
        todo.waiting = to == .waiting
        return (to == .waiting ? .waiting : from == .done ? .open : .resumed, nil)
    }
}
