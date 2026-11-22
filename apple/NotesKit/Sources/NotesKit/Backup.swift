import Foundation

/// Backups and Markdown export, as the web app's `backup.ts`: the same JSON a backup from the web holds, so either
/// restores the other's, and the same Markdown files with front matter, zipped.
public enum Backup {
    public static let format = "notes-app-backup"

    struct BackupError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// A card as the web app's backup writes it: its envelope and payload as one object.
    static func json(_ card: Card) -> JSONValue {
        var o = card.payload
        o["id"] = .string(card.id)
        o["vaultId"] = .string(card.vaultId)
        o["updatedAt"] = .int(card.updatedAt)
        o["deleted"] = .bool(card.deleted)
        o["seq"] = .int(card.seq)
        if o["createdAt"] == nil { o["createdAt"] = .int(card.createdAt) }
        return .object(o)
    }

    static func iso(_ ms: Int64) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date(ms: ms))
    }

    /// A backup of these vaults and cards, as JSON text.
    public static func make(vaults: [Vault], cards: [Card], now: Int64 = Repository.milliseconds()) throws -> Data {
        let vaultJSON = try vaults.map { try JSON.decode(JSONValue.self, from: JSON.string($0)) }
        let backup: JSONValue = [
            "format": .string(format), "version": 1, "exportedAt": .string(iso(now)), "vaults": .array(vaultJSON),
            "cards": .array(cards.map(json)),
        ]
        return try JSON.encoder.encode(backup)
    }

    static func isTime(_ v: JSONValue?) -> Bool { v?.intValue != nil || { if case .double(let d) = v { return d.isFinite } else { return false } }() }
    static func strings(_ v: JSONValue?) -> Bool { v?.arrayValue?.allSatisfy { $0.stringValue != nil } ?? false }

    /// Everything the app reads from a card is there and of the right kind, so a hand-edited backup can't bring in a
    /// card that breaks it.
    static func isCard(_ c: [String: JSONValue]) -> Bool {
        guard let id = c["id"]?.stringValue, !id.isEmpty, c["vaultId"]?.stringValue != nil, isTime(c["updatedAt"]), isTime(c["createdAt"]),
            c["title"]?.stringValue != nil, c["content"]?["type"] == "doc", strings(c["tags"]),
            let type = c["type"]?.stringValue.flatMap(CardType.init(rawValue:))
        else { return false }
        if let d = c["deleted"], d.boolValue == nil { return false }
        if let color = c["color"], !color.isNull, color.stringValue.flatMap(CardColor.init(rawValue:)) == nil { return false }
        switch type {
        case .todo:
            let status = c["status"]?.stringValue
            return (status == "open" || status == "done") && (c["due"]?.isNull ?? false || DateKey.isKey(c["due"]?.stringValue))
        case .tag:
            return c["pinned"]?.boolValue != nil
        case .note:
            return true
        }
    }

    /// The cards of a backup, checked; throws a sentence saying what's wrong.
    public static func parse(_ data: Data) throws -> [Card] {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: data), root.objectValue != nil else { throw BackupError(message: "That file is not valid JSON.") }
        guard root["format"]?.stringValue == format else { throw BackupError(message: "That file is not a backup from this app.") }
        guard root["version"]?.intValue == 1 else { throw BackupError(message: "This backup uses a version this app can't read.") }
        guard let list = root["cards"]?.arrayValue, root["vaults"]?.arrayValue != nil else { throw BackupError(message: "That backup is damaged: some cards are missing required fields.") }
        return try list.map { value in
            guard let raw = value.objectValue else { throw BackupError(message: "That backup is damaged: some cards are missing required fields.") }
            let o = modernPayload(raw)
            guard isCard(o) else { throw BackupError(message: "That backup is damaged: some cards are missing required fields.") }
            var payload = o
            for key in ["id", "vaultId", "updatedAt", "deleted", "seq"] { payload.removeValue(forKey: key) }
            return Card(
                id: o["id"]!.stringValue!, vaultId: o["vaultId"]!.stringValue!, updatedAt: o["updatedAt"]!.intValue ?? 0, deleted: o["deleted"]?.boolValue ?? false,
                seq: 0, payload: payload)
        }
    }

    // MARK: Markdown

    public struct File: Sendable, Hashable {
        public var path: String
        public var text: String
    }

    static func safeName(_ title: String) -> String {
        var name = title.replacing(/[\/\\:*?"<>|\x00-\x1f]/, with: " ").replacing(/\s+/, with: " ").trimmingCharacters(in: .whitespaces)
        while name.hasPrefix(".") { name.removeFirst() }
        let short = String(name.prefix(80)).trimmingCharacters(in: .whitespaces)
        return short.isEmpty ? "Untitled" : short
    }

    static func yaml(_ s: String) -> String { (try? JSON.string(s)) ?? "\"\"" }

    /// Every live card as a Markdown file with front matter: id, type, title, a todo's status and dates, tags, and
    /// when it was made and changed; its pages follow under headings of their own, and a stack lists its entries.
    public static func markdownFiles(_ index: CardIndex) -> [File] {
        var used = Set<String>()
        let folder: [CardType: String] = [.note: "notes", .todo: "todos", .tag: "tags"]
        return index.live.map { card in
            let base = safeName(card.title)
            var path = "\(folder[card.type]!)/\(base).md"
            var n = 2
            while used.contains(path.lowercased()) {
                path = "\(folder[card.type]!)/\(base) (\(n)).md"
                n += 1
            }
            used.insert(path.lowercased())
            var front = ["id: \(card.id)", "type: \(card.type.rawValue)", "title: \(yaml(card.title))"]
            if card.template { front.append("template: true") }
            if card.type == .todo {
                front.append("status: \(card.isDone ? "done" : "open")")
                if let s = card.start { front.append("start: \(s)") }
                if let d = card.due {
                    front.append("due: \(d)")
                    if let t = card.dueTime { front.append("time: \"\(t)\"") }
                    if let r = card.repeat { front.append("repeat: \(r.word)") }
                }
            }
            let tags = index.resolveTags(card.tags)
            if !tags.isEmpty { front.append("tags: [\(tags.map { yaml($0.title) }.joined(separator: ", "))]") }
            front.append("created: \(iso(card.createdAt))")
            front.append("updated: \(iso(card.updatedAt))")
            let pages = card.turnPages.enumerated().map { "\n\n## Page \($0.offset + 2)\n\n" + Markdown.from($0.element, title: index.titleOf) }.joined()
            let entries = card.isStack ? index.stackEntries(card) : []
            let stacked = entries.isEmpty ? "" : "\n\n## In this stack\n\n" + entries.enumerated().map { "\($0.offset + 1). [[\(index.linkTitle($0.element.id, fallback: $0.element.displayTitle))]]" }.joined(separator: "\n")
            let body = Markdown.from(card.content, title: index.titleOf) + pages + stacked
            return File(path: path, text: "---\n\(front.joined(separator: "\n"))\n---\n\n# \(card.title)\n\n\(body)\n")
        }
    }

    // MARK: Zip

    static let crcTable: [UInt32] = (0..<256).map { i in
        var c = UInt32(i)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in data { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }

    /// Files in a zip, stored as they are (no compression), names in UTF-8.
    public static func zip(_ files: [File]) -> Data {
        var out = Data()
        var central = Data()
        func le16(_ v: Int, _ d: inout Data) { withUnsafeBytes(of: UInt16(truncatingIfNeeded: v).littleEndian) { d.append(contentsOf: $0) } }
        func le32(_ v: UInt32, _ d: inout Data) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        for f in files {
            let name = Data(f.path.utf8)
            let body = Data(f.text.utf8)
            let crc = crc32(body)
            let offset = UInt32(out.count)
            le32(0x0403_4B50, &out); le16(20, &out); le16(0x0800, &out); le16(0, &out); le16(0, &out); le16(0x21, &out)
            le32(crc, &out); le32(UInt32(body.count), &out); le32(UInt32(body.count), &out); le16(name.count, &out); le16(0, &out)
            out.append(name)
            out.append(body)
            le32(0x0201_4B50, &central); le16(20, &central); le16(20, &central); le16(0x0800, &central); le16(0, &central); le16(0, &central); le16(0x21, &central)
            le32(crc, &central); le32(UInt32(body.count), &central); le32(UInt32(body.count), &central); le16(name.count, &central)
            le16(0, &central); le16(0, &central); le16(0, &central); le16(0, &central); le32(0, &central); le32(offset, &central)
            central.append(name)
        }
        let start = UInt32(out.count)
        out.append(central)
        le32(0x0605_4B50, &out); le16(0, &out); le16(0, &out); le16(files.count, &out); le16(files.count, &out)
        le32(UInt32(central.count), &out); le32(start, &out); le16(0, &out)
        return out
    }
}

extension Repository {
    public struct ImportResult: Sendable { public var added = 0, updated = 0, skipped = 0 }

    /// Merges a backup, keeping whichever version of each card is newest. Cards from other vaults move into this
    /// account's own vault.
    public func importBackup(_ cards: [Card]) throws -> ImportResult {
        let known = Set(try vaults().map(\.id))
        let target = try? defaultVaultId()
        var result = ImportResult()
        for var card in cards {
            if !known.contains(card.vaultId), let target { card.vaultId = target }
            if let current = try self.card(card.id) {
                if current.updatedAt >= card.updatedAt {
                    result.skipped += 1
                    continue
                }
                card.seq = current.seq
                result.updated += 1
            } else {
                result.added += 1
            }
            try putImported(card)
        }
        return result
    }
}
