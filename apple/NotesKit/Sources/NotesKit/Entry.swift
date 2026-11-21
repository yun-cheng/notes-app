import Foundation

/// What the journal box turns typed text into, as the web app's `entry.ts`. `[] ` or `TODO ` (or `#todo`) makes a
/// todo, `#diary` files it in the Diary vault, any other `#tag` files it under that tag, and on a todo `@tomorrow`,
/// `@fri` or `@2026-12-01` sets the due date, `@3pm` its time, and `@weekly` or `@every-2-weeks` makes it repeat.
public struct Entry: Sendable, Hashable {
    public enum Kind: String, Sendable { case note, todo }
    public var kind: Kind
    /// Typed with `#diary`: it goes in the account's Diary vault.
    public var diary = false
    /// A todo's first line. Notes have none and are named by their first line.
    public var title: String
    public var content: JSONValue
    /// Tag names as typed, without `#`, each once. Never `todo` or `diary`.
    public var tags: [String]
    public var due: String?
    public var dueTime: String?
    public var `repeat`: Repeat?
    /// A todo already ticked, typed as `[x] ` or a ticked checkbox.
    public var done = false
}

public enum EntryParser {
    nonisolated(unsafe) static let todoMarker = /^(?:\[[ xX]?\]\s*|TODO\s+)/
    nonisolated(unsafe) static let doneMarker = /^\[[xX]\]/
    nonisolated(unsafe) static let tag = /(^|\s)#([\p{L}\p{N}_-]+)/
    nonisolated(unsafe) static let dueWord = /(^|\s)@([\p{L}\p{N}:-]+)/
    nonisolated(unsafe) static let tagsOnly = /^\s*(#[\p{L}\p{N}_-]+\s*)+$/
    static let weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

    /// `@today`, `@tomorrow`, `@2026-12-01`, or a weekday (`@fri`) meaning the next one after today.
    public static func parseDue(_ word: String, today: String) -> String? {
        let w = word.lowercased()
        if w == "today" { return today }
        if w == "tomorrow" { return DateKey.adding(1, to: today) }
        if DateKey.isKey(word) { return word }
        guard w.count >= 3, let day = weekdays.firstIndex(where: { $0.hasPrefix(w) }) else { return nil }
        let now = DateKey.weekday(today) - 1
        let ahead = (day - now + 7) % 7
        return DateKey.adding(ahead == 0 ? 7 : ahead, to: today)
    }

    public enum DueKind { case date, time, `repeat` }

    /// What an `@` word on a todo sets, or nil for a word that stays in the text (`@bob`).
    public static func dueKind(_ word: String, today: String) -> DueKind? {
        if parseDue(word, today: today) != nil { return .date }
        if TimeKey.parse(word) != nil { return .time }
        if Repeat.parse(word) != nil { return .repeat }
        return nil
    }

    // MARK: Plain text

    /// One entry from typed text. Nil if it holds nothing but markers.
    public static func parseEntry(_ text: String, today: String) -> Entry? {
        var lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        let first = lines.firstIndex { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        var marked = false
        var done = false
        if let first {
            let head = String(lines[first].drop(while: \.isWhitespace))
            marked = head.firstMatch(of: todoMarker) != nil
            done = marked && head.firstMatch(of: doneMarker) != nil
            if marked { lines[first] = head.replacing(todoMarker, with: "", maxReplacements: 1) }
        }
        let body = Doc.fromText(lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
        return entryFrom(body["content"]?.arrayValue ?? [], todo: marked, done: done, shared: [], today: today)
    }

    /// Several entries from one text: each line starting with `[] ` or `TODO ` begins a new one. With `allTodos`,
    /// every line is a todo. Lines of only tags at the very end apply to every entry.
    public static func parseEntries(_ text: String, today: String, allTodos: Bool = false) -> [Entry] {
        var lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var shared: [String] = []
        while let last = lines.last, last.trimmingCharacters(in: .whitespaces).isEmpty || last.wholeMatch(of: tagsOnly) != nil {
            lines.removeLast()
            let t = last.trimmingCharacters(in: .whitespaces)
            if !t.isEmpty { shared.insert(t, at: 0) }
        }
        var chunks: [[String]] = []
        for line in lines {
            let marked = String(line.drop(while: \.isWhitespace)).firstMatch(of: todoMarker) != nil
            if allTodos {
                if !line.trimmingCharacters(in: .whitespaces).isEmpty { chunks.append([marked ? line : "[] " + line.drop(while: \.isWhitespace)]) }
            } else if marked || chunks.isEmpty {
                chunks.append([line])
            } else {
                chunks[chunks.count - 1].append(line)
            }
        }
        let tags = shared.joined(separator: " ")
        let suffix = tags.isEmpty ? "" : "\n" + tags
        let texts = chunks.count > 1 ? chunks.map { $0.joined(separator: "\n") + suffix } : [(chunks.first?.joined(separator: "\n") ?? "") + suffix]
        return texts.compactMap { parseEntry($0, today: today) }
    }

    // MARK: Rich text

    static func isEmptyBlock(_ b: JSONValue) -> Bool {
        b["type"]?.stringValue == "paragraph" && Doc.inlineText(b).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !(b["content"]?.arrayValue ?? []).contains { $0["type"]?.stringValue != "text" }
    }

    static func hasSubstance(_ blocks: [JSONValue]) -> Bool {
        blocks.contains { b in
            !Doc.inlineText(b).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !Doc.photoIds(b).isEmpty || !Doc.fileIds(b).isEmpty
                || b["type"]?.stringValue == "horizontalRule"
        }
    }

    static func taskItems(_ list: JSONValue) -> [JSONValue] {
        (list["content"]?.arrayValue ?? []).flatMap { item -> [JSONValue] in
            let children = item["content"]?.arrayValue ?? []
            var own = item
            own["content"] = .array(children.filter { $0["type"]?.stringValue != "taskList" })
            return [own] + children.filter { $0["type"]?.stringValue == "taskList" }.flatMap(taskItems)
        }
    }

    /// Entries from the journal box's rich text. Each checkbox item is a todo, and other blocks between them make one
    /// note; a paragraph starting with `[] ` is a todo too. A last paragraph of only tags applies to every entry.
    public static func entries(from doc: JSONValue, today: String) -> [Entry] {
        var blocks = doc["content"]?.arrayValue ?? []
        var shared: [String] = []
        while let last = blocks.last {
            if isEmptyBlock(last) {
                blocks.removeLast()
            } else if last["type"]?.stringValue == "paragraph", Doc.inlineText(last).wholeMatch(of: tagsOnly) != nil {
                blocks.removeLast()
                shared.insert(Doc.inlineText(last).trimmingCharacters(in: .whitespaces), at: 0)
            } else {
                break
            }
        }
        struct Chunk {
            var todo: Bool
            var done: Bool
            var blocks: [JSONValue]
        }
        var chunks: [Chunk] = []
        for block in blocks {
            if block["type"]?.stringValue == "taskList" {
                for item in taskItems(block) {
                    chunks.append(Chunk(todo: true, done: item["attrs"]?["checked"]?.boolValue == true, blocks: item["content"]?.arrayValue ?? []))
                }
                continue
            }
            let text = block["type"]?.stringValue == "paragraph" ? String(Doc.inlineText(block).drop(while: \.isWhitespace)) : ""
            if text.firstMatch(of: todoMarker) != nil {
                let done = text.firstMatch(of: doneMarker) != nil
                chunks.append(Chunk(todo: true, done: done, blocks: strip([block], /^(\s*)(\[[ xX]?\]\s*|TODO\s+)/, take: { _ in true })))
                continue
            }
            if let last = chunks.last, !last.todo {
                chunks[chunks.count - 1].blocks.append(block)
            } else {
                chunks.append(Chunk(todo: false, done: false, blocks: [block]))
            }
        }
        let sharedTags = shared.joined(separator: " ").matches(of: /#([\p{L}\p{N}_-]+)/).map { String($0.output.1) }
        return chunks.compactMap { entryFrom($0.blocks, todo: $0.todo, done: $0.done, shared: sharedTags, today: today) }
    }

    /// Removes matching words from the text in some blocks, leaving code alone. A paragraph left empty goes away.
    static func strip(_ blocks: [JSONValue], _ pattern: Regex<(Substring, Substring, Substring)>, take: (String) -> Bool) -> [JSONValue] {
        func inText(_ node: JSONValue) -> (JSONValue, Bool) {
            let type = node["type"]?.stringValue
            // Code is kept as typed: `#include` and `@media` there are not markers.
            if type == "codeBlock" || (type == "text" && Doc.marks(node).contains("code")) { return (node, false) }
            if type == "text" {
                var touched = false
                let text = (node["text"]?.stringValue ?? "").replacing(pattern) { m in
                    guard take(String(m.output.2)) else { return String(m.output.0) }
                    touched = true
                    return String(m.output.1)
                }
                guard touched else { return (node, false) }
                var out = node
                out["text"] = .string(text.replacing(/[ \t]{2,}/, with: " "))
                return (out, true)
            }
            guard let children = node["content"]?.arrayValue else { return (node, false) }
            var touched = false
            var kept: [JSONValue] = []
            for child in children {
                let (n, t) = inText(child)
                touched = touched || t
                if n["type"]?.stringValue == "text" && (n["text"]?.stringValue ?? "").isEmpty { continue }
                kept.append(n)
            }
            var out = node
            out["content"] = .array(kept)
            return (out, touched)
        }
        return blocks.flatMap { block -> [JSONValue] in
            let (node, touched) = inText(block)
            guard touched, node["type"]?.stringValue == "paragraph" else { return [node] }
            var content = node["content"]?.arrayValue ?? []
            if let head = content.first, head["type"]?.stringValue == "text" {
                content[0]["text"] = .string(String((head["text"]?.stringValue ?? "").drop(while: \.isWhitespace)))
            }
            if let last = content.last, last["type"]?.stringValue == "text" {
                let t = last["text"]?.stringValue ?? ""
                content[content.count - 1]["text"] = .string(String(t.reversed().drop(while: \.isWhitespace).reversed()))
            }
            let kept = content.filter { $0["type"]?.stringValue != "text" || !($0["text"]?.stringValue ?? "").isEmpty }
            if kept.isEmpty { return [] }
            var out = node
            out["content"] = .array(kept)
            return [out]
        }
    }

    /// One entry from its blocks. `#todo` makes it a todo and `#diary` files it in the diary; other `#tags` file it;
    /// on a todo, `@` words set its due date, time and repeat. All of them leave the text.
    static func entryFrom(_ blocks: [JSONValue], todo: Bool, done: Bool, shared: [String], today: String) -> Entry? {
        var todo = todo
        var diary = false
        var tags: [String] = []
        func addTag(_ name: String) {
            let lower = name.lowercased()
            if lower == "todo" {
                todo = true
            } else if lower == "diary" {
                diary = true
            } else if !tags.contains(where: { $0.lowercased() == lower }) {
                tags.append(name)
            }
        }
        var body = strip(blocks, tag) { addTag($0); return true }
        shared.forEach(addTag)
        var date: String?
        var time: String?
        var rule: Repeat?
        if todo {
            body = strip(body, dueWord) { word in
                switch dueKind(word, today: today) {
                case .date: date = parseDue(word, today: today)
                case .time: time = TimeKey.parse(word)
                case .repeat: rule = Repeat.parse(word)
                case nil: return false
                }
                return true
            }
        }
        func trim(_ list: inout [JSONValue]) {
            while let f = list.first, isEmptyBlock(f) { list.removeFirst() }
            while let l = list.last, isEmptyBlock(l) { list.removeLast() }
        }
        trim(&body)
        guard hasSubstance(body) else { return nil }
        if !todo {
            return Entry(kind: .note, diary: diary, title: "", content: ["type": "doc", "content": .array(body)], tags: tags)
        }
        let title = Doc.inlineText(body[0]).trimmingCharacters(in: .whitespacesAndNewlines)
        var details = title.isEmpty ? body : Array(body.dropFirst())
        trim(&details)
        let due = date ?? (rule.map { $0.firstDue(today: today) } ?? (time != nil ? today : nil))
        return Entry(
            kind: .todo, diary: diary, title: title.isEmpty ? "Photo" : title,
            content: details.isEmpty ? Doc.fromText("") : ["type": "doc", "content": .array(details)], tags: tags,
            due: due, dueTime: due == nil ? nil : time, repeat: due == nil ? nil : rule, done: done)
    }
}
