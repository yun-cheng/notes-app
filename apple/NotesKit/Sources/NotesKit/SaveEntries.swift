import Foundation

/// Where entries from the journal box go: the journal filter's tag and vault, its todo default, the day it shows, and
/// whether they're templates. As the web app's `useSaveEntry.ts`.
public struct SaveOptions: Sendable {
    public var due: String?
    /// Todos start out waiting.
    public var waiting = false
    public var tagId: String?
    /// More tags every entry gets, after `tagId`: a board column's.
    public var tags: [String] = []
    public var vaultId: String?
    /// A day other than today: entries are written on it, at this time of day.
    public var date: String?
    public var template = false

    public init(due: String? = nil, waiting: Bool = false, tagId: String? = nil, tags: [String] = [], vaultId: String? = nil, date: String? = nil, template: Bool = false) {
        self.due = due
        self.waiting = waiting
        self.tagId = tagId
        self.tags = tags
        self.vaultId = vaultId
        self.date = date
        self.template = template
    }

    /// What the journal is narrowed to, as defaults for what is written into it.
    public init(journal filter: StreamFilter, today: String) {
        self.init(
            due: filter.status == .today ? today : nil, waiting: filter.status == .waiting, tagId: filter.tagId, vaultId: filter.vaultId,
            date: filter.when.flatMap { DateKey.isKey($0) && $0 != today ? $0 : nil }, template: filter.template)
    }
}

public enum SaveResult: Sendable, Equatable {
    /// The entries made, in the order typed, and the action to undo them by.
    case saved(ids: [String], group: String)
    /// A vault they'd go into is locked: nothing is saved, so the text stays in the box.
    case unlock(vaultId: String)
    case nothing
}

/// What saving needs to know about the account.
public struct SaveContext: Sendable {
    public var accountId: String
    public var vaults: [Vault]
    public var locked: Set<String>
    public var index: CardIndex
    public var sharedInto: SharedInto

    public init(accountId: String, vaults: [Vault], locked: Set<String>, index: CardIndex, sharedInto: SharedInto) {
        self.accountId = accountId
        self.vaults = vaults
        self.locked = locked
        self.index = index
        self.sharedInto = sharedInto
    }

    public var mainVault: Vault? { vaults.first { $0.isDefault(of: accountId) } ?? vaults.first }
    public var diaryVault: Vault? { vaults.first { $0.isDiary(of: accountId) } }
}

extension Repository {
    /// Saves entries read from the journal box. Tags typed in several entries are made once; a typed tag is the one
    /// offered in the entry's vault by that name, or a new one kept to that vault.
    public func save(_ entries: [Entry], _ opts: SaveOptions = SaveOptions(), in context: SaveContext, now: Date = Date()) throws -> SaveResult {
        guard !entries.isEmpty else { return .nothing }
        let diary = context.diaryVault?.id
        let main = context.mainVault?.id
        let vaultOf = { (e: Entry) in e.diary && diary != nil ? diary : opts.vaultId }
        if let locked = entries.compactMap(vaultOf).first(where: context.locked.contains) { return .unlock(vaultId: locked) }

        let group = action()
        var made: [String: String] = [:]
        let groups = context.index.tagGroups
        func tagIds(_ names: [String], _ vaultId: String?) throws -> [String] {
            var ids: [String] = []
            for id in ([opts.tagId].compactMap { $0 } + opts.tags) where !ids.contains(id) { ids.append(id) }
            for name in names where !groups.isGroupName(name) {
                let key = "\(vaultId ?? ""):\(name.lowercased())"
                var id = tagNamed(name, in: context.index.tags, vaultId: vaultId, context.sharedInto)?.id ?? made[key]
                if id == nil {
                    let tag = try createTag(title: name, vaultId: vaultId, group: group)
                    made[key] = tag.id
                    id = tag.id
                }
                if !ids.contains(id!) { ids.append(id!) }
            }
            // A one-choice group keeps the last of its tags: what was typed wins over the journal's filter.
            return groups.settle(ids)
        }
        // Written for another day: on that day, at this time of day, so they keep the order they're written in.
        var at: Int64?
        if let date = opts.date, let day = DateKey.date(date) {
            let cal = Calendar.current
            let time = cal.dateComponents([.hour, .minute, .second, .nanosecond], from: now)
            at = cal.date(bySettingHour: time.hour!, minute: time.minute!, second: time.second!, of: day).map { Int64($0.timeIntervalSince1970 * 1000) }
        }
        var ids: [String] = []
        for (i, entry) in entries.enumerated() {
            let vault = vaultOf(entry)
            let tags = try tagIds(entry.tags, vault ?? main)
            let createdAt = at.map { $0 + Int64(i) }
            let extra: [String: JSONValue] = opts.template ? ["template": true] : [:]
            let card: Card
            if entry.kind == .note {
                card = try createNote(content: entry.content, tags: tags, vaultId: vault, createdAt: createdAt, extra: extra, group: group)
            } else {
                card = try createTodo(
                    title: entry.title, due: entry.due ?? opts.due, dueTime: entry.dueTime, repeat: entry.repeat, content: entry.content, tags: tags,
                    vaultId: vault, done: entry.done, waiting: opts.waiting, createdAt: createdAt, extra: extra, group: group)
            }
            ids.append(card.id)
        }
        return .saved(ids: ids, group: group)
    }
}
