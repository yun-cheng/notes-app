import Foundation

/// The vaults each card is in besides its own, by card ID, from `/shared`.
public typealias SharedInto = [String: [String]]

/// A tag group, like Priority (High, Medium, Low) or Topics: a tag card with `members`, never put on entries itself.
public struct TagGroup: Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    /// An entry takes at most one of its tags.
    public var choosesOne: Bool
    /// Its order ranks its tags, so the journal can sort by it.
    public var ordered: Bool
    /// Live tags in the group, in its order.
    public var members: [Card]
}

public struct TagGroups: Sendable {
    public var groups: [TagGroup] = []
    /// The group each grouped tag is in, by tag ID.
    public var groupOf: [String: TagGroup] = [:]
    /// Tags in no group.
    public var loose: [Card] = []

    /// Groups and their tags from live tag cards (groups among them), sorted by title. A tag claimed by two groups stays
    /// in the first by title.
    public init(_ cards: [Card]) {
        let tags = Dictionary(cards.filter { !$0.isGroup }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for card in cards where card.isGroup {
            var group = TagGroup(id: card.id, title: card.title, choosesOne: card.choosesOne, ordered: card.ordered, members: [])
            var claimed: [String] = []
            for id in card.members ?? [] {
                guard let tag = tags[id], groupOf[id] == nil, !claimed.contains(id) else { continue }
                group.members.append(tag)
                claimed.append(id)
            }
            for id in claimed { groupOf[id] = group }
            groups.append(group)
        }
        loose = cards.filter { !$0.isGroup && groupOf[$0.id] == nil }
    }

    public init() {}

    /// An entry's tags with one more. A tag from a one-choice group replaces the group's other tag.
    public func with(_ tags: [String], _ tagId: String) -> [String] {
        if tags.contains(tagId) { return tags }
        guard let group = groupOf[tagId], group.choosesOne else { return tags + [tagId] }
        return tags.filter { groupOf[$0]?.id != group.id } + [tagId]
    }

    /// Tags in the order typed, each one-choice group keeping the last of its tags.
    public func settle(_ tags: [String]) -> [String] { tags.reduce(into: []) { $0 = with($0, $1) } }

    /// Grouped tags first, by group and then the group's own order, then the rest as they are.
    public func order(_ tags: [String]) -> [String] {
        func rank(_ id: String) -> Int {
            guard let group = groupOf[id], let g = groups.firstIndex(where: { $0.id == group.id }) else { return .max }
            return g * 10_000 + (group.members.firstIndex { $0.id == id } ?? 0)
        }
        return tags.enumerated().sorted { a, b in
            let (ra, rb) = (rank(a.element), rank(b.element))
            return ra == rb ? a.offset < b.offset : ra < rb
        }.map(\.element)
    }

    /// Tags that break their group's one-choice rule on this entry, as edits from two devices can.
    public func clashing(_ tags: [String]) -> Set<String> {
        var seen: [String: [String]] = [:]
        for id in tags { if let g = groupOf[id], g.choosesOne { seen[g.id, default: []].append(id) } }
        return Set(seen.values.filter { $0.count > 1 }.flatMap { $0 })
    }

    /// A group's name typed as a tag (`#priority`): it isn't a tag, so it's left off rather than made into one.
    public func isGroupName(_ name: String) -> Bool {
        let key = name.trimmingCharacters(in: .whitespaces).lowercased()
        return groups.contains { $0.title.trimmingCharacters(in: .whitespaces).lowercased() == key }
    }
}

extension TagGroup {
    /// Where an entry ranks: the position of its first tag in the group, or after them all for none.
    public func rank(_ tags: [String]) -> Int { members.firstIndex { tags.contains($0.id) } ?? members.count }

    /// An entry's tags after picking `tagId` from the group's menu; nil takes every tag of the group off.
    public func pick(_ tags: [String], _ tagId: String?) -> [String] {
        let inGroup = { (t: String) in members.contains { $0.id == t } }
        guard let tagId else { return tags.filter { !inGroup($0) } }
        if choosesOne { return tags.filter { !inGroup($0) } + [tagId] }
        return tags.contains(tagId) ? tags.filter { $0 != tagId } : tags + [tagId]
    }
}

/// A group's tags with one moved up (`by` -1) or down (1): the `members` to save.
public func moveMember(_ members: [String], _ id: String, by: Int) -> [String] {
    guard let i = members.firstIndex(of: id), members.indices.contains(i + by) else { return members }
    var next = members
    next.swapAt(i, i + by)
    return next
}

// MARK: Tag scope

extension Card {
    /// The vaults a tag is kept to: where it lives first, then those it's shared into. Nil for every vault.
    public func tagVaults(_ sharedInto: SharedInto) -> [String]? {
        keptToVault ? [vaultId] + (sharedInto[id] ?? []).filter { $0 != vaultId } : nil
    }

    /// Whether a tag is offered on entries living in `vaultId`.
    public func offered(in vault: String?, _ sharedInto: SharedInto) -> Bool {
        guard keptToVault else { return true }
        guard let vault else { return false }
        return vaultId == vault || (sharedInto[id] ?? []).contains(vault)
    }
}

/// The tags offered on entries in `vaultId`: the vault's own first, so its "Home" wins over one for every vault.
public func tagsFor(_ tags: [Card], vaultId: String?, _ sharedInto: SharedInto) -> [Card] {
    let offered = tags.filter { $0.offered(in: vaultId, sharedInto) }
    return offered.filter(\.keptToVault) + offered.filter { !$0.keptToVault }
}

/// The tag offered in `vaultId` named `name`, whatever its case.
public func tagNamed(_ name: String, in tags: [Card], vaultId: String?, _ sharedInto: SharedInto) -> Card? {
    let key = name.lowercased()
    return tagsFor(tags, vaultId: vaultId, sharedInto).first { $0.title.lowercased() == key }
}

/// The tags offered on every one of entries in `vaultIds`, as for several picked at once.
public func tagsForAll(_ tags: [Card], vaultIds: [String], _ sharedInto: SharedInto) -> [Card] {
    tags.filter { tag in vaultIds.allSatisfy { tag.offered(in: $0, sharedInto) } }
}

// MARK: The index

public struct Backlink: Sendable, Hashable {
    public enum Kind: Sendable { case link, tag }
    public var from: Card
    public var kind: Kind
}

/// Everything derived on the device and never synced, as the web app's `buildIndex`. Cards in locked vaults go no
/// further than this, so no list, search or backlink can show them.
public struct CardIndex: Sendable {
    public var byId: [String: Card] = [:]
    /// Card ID to vault ID, for cards in locked vaults. Nothing else about them is here.
    public var lockedCards: [String: String] = [:]
    /// Cards shown in lists, search and export: not trashed, not blank. Most recently edited first.
    public var live: [Card] = []
    /// Tags that can be put on entries, by title. Groups aren't among them.
    public var tags: [Card] = []
    public var tagGroups = TagGroups()
    public var pinnedTags: [Card] = []
    /// Live todos, archived ones and templates left out.
    public var todos: [Card] = []
    public var trash: [Card] = []
    public var backlinks: [String: [Backlink]] = [:]
    /// Which stack each entry is in.
    public var stackOf: [String: String] = [:]

    public init() {}

    public init(_ all: [Card], locked: Set<String> = []) {
        var cards: [Card] = []
        for card in all {
            if locked.contains(card.vaultId) || card.sealed { lockedCards[card.id] = card.vaultId } else { cards.append(card) }
        }
        byId = Dictionary(cards.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        live = cards.filter { !$0.deleted && !$0.isBlank }.sorted { $0.updatedAt > $1.updatedAt }
        for card in live {
            for to in card.tags { add(to, Backlink(from: card, kind: .tag)) }
            // A link on a page behind a card's front counts as much as one on its front.
            var linked: [String] = []
            for doc in [card.content] + card.turnPages { for id in Doc.linkedCardIds(doc) where !linked.contains(id) { linked.append(id) } }
            for to in linked { add(to, Backlink(from: card, kind: .link)) }
        }
        let tagCards = live.filter { $0.type == .tag }.sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
        tagGroups = TagGroups(tagCards)
        tags = tagCards.filter { !$0.isGroup }
        pinnedTags = tags.filter(\.pinned)
        todos = live.filter { $0.type == .todo && !$0.archived && !$0.template }
        trash = cards.filter { $0.deleted && !$0.isBlank }.sorted { $0.updatedAt > $1.updatedAt }
        stackOf = Self.stackIndex(live)
    }

    private mutating func add(_ to: String, _ link: Backlink) {
        if to == link.from.id || lockedCards[to] != nil { return }
        backlinks[to, default: []].append(link)
    }

    /// The tags on an entry, resolved to live tag cards only.
    public func resolveTags(_ ids: [String]) -> [Card] {
        ids.compactMap { byId[$0] }.filter { $0.type == .tag && !$0.deleted }
    }

    /// The title to show for a linked card: never its stored title when the target is locked or not shared.
    public func linkTitle(_ id: String, fallback: String) -> String {
        if lockedCards[id] != nil { return "Locked" }
        guard let target = byId[id] else { return "Not shared" }
        return target.deleted ? fallback : target.displayTitle
    }

    public var titleOf: Doc.TitleOf { { id, label in linkTitle(id, fallback: label) } }

    /// A card's text with links shown under their target's current title.
    public func text(_ card: Card) -> String { Doc.plainText(card.content, titleOf: titleOf) }

    /// The text on the pages behind a card's front, the same way.
    public func pagesText(_ card: Card) -> String { card.turnPages.map { Doc.plainText($0, titleOf: titleOf) }.joined(separator: " ") }

    // MARK: Stacks

    /// Which stack each entry is in, from the live cards: the stack made first, when two list it.
    public static func stackIndex(_ cards: [Card]) -> [String: String] {
        let stacks = cards.filter { $0.isStack && !$0.deleted }.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        var of: [String: String] = [:]
        for stack in stacks { for id in stack.stack ?? [] where id != stack.id && of[id] == nil { of[id] = stack.id } }
        return of
    }

    /// The entries in a stack, in its order: the ones this device has and can show.
    public func stackEntries(_ stack: Card) -> [Card] {
        (stack.stack ?? []).compactMap { id in
            guard let card = byId[id], !card.deleted, !card.archived, !card.template, card.isEntry, !card.isStack, stackOf[id] == stack.id else { return nil }
            return card
        }
    }
}

/// A stack's list with `id` moved to `index` among the entries it shows, the rest kept in place.
public func moveInStack(_ list: [String], shown: [String], _ id: String, to index: Int) -> [String] {
    var others = shown.filter { $0 != id }
    others.insert(id, at: max(0, min(index, others.count)))
    var next = 0
    let visible = Set(shown)
    return list.map { s in
        guard visible.contains(s) else { return s }
        defer { next += 1 }
        return others[next]
    }
}

/// What stacking entries changes, as each stack's new list: the stack they go into gets them at its end, in the
/// order given, and any other stack they were in lets them go.
public func stackPlan(_ ids: [String], into: Card, stacks: [Card]) -> [String: [String]] {
    let moving = ids.filter { $0 != into.id }
    var lists: [String: [String]] = [:]
    for stack in stacks where stack.id != into.id {
        let list = stack.stack ?? []
        let kept = list.filter { !moving.contains($0) }
        if kept.count != list.count { lists[stack.id] = kept }
    }
    let current = into.stack ?? []
    lists[into.id] = current + moving.filter { !current.contains($0) }
    return lists
}

// MARK: Templates, reactions and retyping

extension Card {
    /// What a new entry started from this template gets: its words with `{date}` filled in and every checklist item
    /// unticked, its pages, tags, color and previews.
    public func fromTemplate(today: String) -> [String: JSONValue] {
        func fillText(_ text: String) -> String {
            text.replacing(/(?i)\{(date|today)\}/) { _ in DateKey.formatDay(today) }
        }
        func fill(_ node: JSONValue) -> JSONValue {
            guard case .object(var o) = node else { return node }
            if o["type"]?.stringValue == "text", let t = o["text"]?.stringValue { o["text"] = .string(fillText(t)) }
            if o["type"]?.stringValue == "taskItem" {
                var attrs = o["attrs"]?.objectValue ?? [:]
                attrs["checked"] = false
                o["attrs"] = .object(attrs)
            }
            if let children = o["content"]?.arrayValue { o["content"] = .array(children.map(fill)) }
            return .object(o)
        }
        var out: [String: JSONValue] = [
            "type": .string(type.rawValue), "title": .string(fillText(title)), "content": fill(content), "tags": .array(tags.map(JSONValue.string)),
        ]
        if !turnPages.isEmpty { out["pages"] = .array(turnPages.map(fill)) }
        if let color { out["color"] = .string(color.rawValue) }
        if let preview = payload["preview"], let o = preview.objectValue, !o.isEmpty { out["preview"] = preview }
        return out
    }

    /// Puts this account's `emoji` on, or takes it off if it was there.
    public mutating func toggleReaction(_ emoji: String, me: String) {
        var r = reactions
        var by = r[emoji] ?? []
        if let i = by.firstIndex(of: me) { by.remove(at: i) } else { by.append(me) }
        r[emoji] = by
        setReactions(r)
    }

    /// Switches a note to a todo or back. A note with no title gives its first plain line to the todo's title, and a
    /// todo with no details gives its title back as the note's first line. A todo's checkbox, dates and repeat go.
    public mutating func retype(_ to: CardType) {
        guard to != type, to != .tag, isEntry else { return }
        if to == .todo && title.trimmingCharacters(in: .whitespaces).isEmpty, let lifted = Self.liftFirstLine(content) {
            title = lifted.title
            content = lifted.rest
        } else if to == .note, !title.trimmingCharacters(in: .whitespaces).isEmpty, Doc.isBlank(content) {
            content = ["type": "doc", "content": [["type": "paragraph", "content": [["type": "text", "text": .string(title.trimmingCharacters(in: .whitespaces))]]]]]
            title = ""
        }
        if to == .note {
            for key in ["status", "due", "dueTime", "repeat", "waiting", "completedAt"] { payload.removeValue(forKey: key) }
        } else {
            payload["status"] = "open"
            payload["due"] = .null
            payload["completedAt"] = .null
        }
        payload["type"] = .string(to.rawValue)
    }

    static func liftFirstLine(_ doc: JSONValue) -> (title: String, rest: JSONValue)? {
        guard let blocks = doc["content"]?.arrayValue, let first = blocks.first,
            ["paragraph", "heading"].contains(first["type"]?.stringValue ?? ""), let inline = first["content"]?.arrayValue, !inline.isEmpty
        else { return nil }
        var text = ""
        for node in inline {
            guard node["type"]?.stringValue == "text", let t = node["text"]?.stringValue, !t.isEmpty else { return nil }
            // A link whose words differ from its address would lose the address in a title.
            if let link = node["marks"]?.arrayValue?.first(where: { $0["type"]?.stringValue == "link" }), link["attrs"]?["href"]?.stringValue != t { return nil }
            text += t
        }
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let rest = Array(blocks.dropFirst())
        return (trimmed, rest.isEmpty ? Doc.empty : ["type": "doc", "content": .array(rest)])
    }
}

/// The reactions offered first, before the whole picker.
public let commonReactions = ["👍", "❤️", "😂", "🎉", "🔥", "👀"]

/// Who reacted, in a few words: "You", "You and 2 others", "3 people".
public func reactedBy(count: Int, mine: Bool) -> String {
    if !mine { return count == 1 ? "1 person" : "\(count) people" }
    let others = count - 1
    return others == 0 ? "You" : "You and \(others) \(others == 1 ? "other" : "others")"
}
