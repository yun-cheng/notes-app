import Foundation

/// Helpers for card bodies, which are TipTap (ProseMirror) JSON documents.
public enum Doc {
    public static let empty: JSONValue = ["type": "doc", "content": [["type": "paragraph"]]]

    public static func walk(_ node: JSONValue, _ visit: (JSONValue) -> Void) {
        visit(node)
        node["content"]?.arrayValue?.forEach { walk($0, visit) }
    }

    /// The body as plain text. `titleOf` gives a linked card's current title instead of the one stored with the link.
    public static func plainText(_ node: JSONValue, titleOf: ((String, String) -> String)? = nil) -> String {
        var parts: [String] = []
        func visit(_ n: JSONValue) {
            switch n["type"]?.stringValue {
            case "text": parts.append(n["text"]?.stringValue ?? "")
            case "cardLink":
                let label = n["attrs"]?["label"]?.stringValue ?? ""
                let id = n["attrs"]?["id"]?.stringValue ?? ""
                parts.append(titleOf?(id, label) ?? label)
            case "hardBreak": parts.append(" ")
            default: break
            }
            if let children = n["content"]?.arrayValue {
                children.forEach(visit)
                if n["type"]?.stringValue != "doc" { parts.append(" ") }
            }
        }
        visit(node)
        return parts.joined().split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// IDs of cards linked from the body, in order, without duplicates.
    public static func linkedCardIds(_ node: JSONValue) -> [String] {
        var seen = Set<String>()
        var ids: [String] = []
        walk(node) { n in
            if n["type"]?.stringValue == "cardLink", let id = n["attrs"]?["id"]?.stringValue, seen.insert(id).inserted { ids.append(id) }
        }
        return ids
    }

    public static func photoIds(_ node: JSONValue) -> [String] {
        var ids: [String] = []
        walk(node) { n in
            if n["type"]?.stringValue == "photo", let id = n["attrs"]?["id"]?.stringValue { ids.append(id) }
        }
        return ids
    }
}

/// Local calendar days as YYYY-MM-DD keys, never UTC instants.
public enum DateKey {
    public static func of(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    public static func today(calendar: Calendar = .current) -> String { of(Date(), calendar: calendar) }

    /// Anchored at noon so a daylight-saving change can't move it to another day.
    public static func date(_ key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    public static func adding(_ days: Int, to key: String, calendar: Calendar = .current) -> String {
        guard let d = date(key, calendar: calendar), let next = calendar.date(byAdding: .day, value: days, to: d) else { return key }
        return of(next, calendar: calendar)
    }
}
