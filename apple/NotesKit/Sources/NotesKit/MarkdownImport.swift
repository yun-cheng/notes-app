import Compression
import Foundation

/// Markdown as AI apps and other notes apps write it, turned into card bodies, and Markdown files turned into
/// entries, as the web app's `markdownIn.ts` and `importNotes.ts`.
public enum MarkdownImport {
    /// Finds the card a `[[Title]]` refers to, or nil to leave the text as it is.
    public typealias LinkResolver = (String) -> (id: String, label: String)?

    nonisolated(unsafe) static let inlinePattern =
        /\\([\\`*_~\[\]()#>!|-])|`([^`]+)`|\[\[([^\]\n]+?)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\|\|(?!\s)(.+?)\|\||\*(?!\s)(.+?)\*|_(?!\s)(.+?)_(?![\p{L}\p{N}])/

    static func withMark(_ nodes: [JSONValue], _ mark: JSONValue) -> [JSONValue] {
        nodes.map { n in
            guard n["type"] == "text" else { return n }
            var m = n
            m["marks"] = .array((n["marks"]?.arrayValue ?? []) + [mark])
            return m
        }
    }

    static func inline(_ text: String, _ resolve: LinkResolver) -> [JSONValue] {
        var out: [JSONValue] = []
        func push(_ t: Substring) {
            guard !t.isEmpty else { return }
            let t = String(t)
            if let last = out.last, last["type"] == "text", last["marks"] == nil {
                out[out.count - 1]["text"] = .string((last["text"]?.stringValue ?? "") + t)
            } else {
                out.append(["type": "text", "text": .string(t)])
            }
        }
        var at = text.startIndex
        for m in text.matches(of: inlinePattern) {
            // `_words_` inside a word (snake_case) isn't italic: Swift's regexes can't look behind, so it's checked here.
            if m.output.11 != nil, m.range.lowerBound > text.startIndex {
                let before = text[text.index(before: m.range.lowerBound)]
                if before.isLetter || before.isNumber { continue }
            }
            if m.range.lowerBound < at { continue }
            push(text[at..<m.range.lowerBound])
            at = m.range.upperBound
            let o = m.output
            if let escaped = o.1 {
                push(escaped)
            } else if let code = o.2 {
                out.append(["type": "text", "text": .string(String(code)), "marks": [["type": "code"]]])
            } else if let link = o.3 {
                if let target = resolve(link.trimmingCharacters(in: .whitespaces)) {
                    out.append(["type": "cardLink", "attrs": ["id": .string(target.id), "label": .string(target.label)]])
                } else {
                    push(o.0)
                }
            } else if let label = o.4, let href = o.5 {
                out += withMark(inline(String(label), resolve), ["type": "link", "attrs": ["href": .string(String(href))]])
            } else if let bold = o.6 ?? o.7 {
                out += withMark(inline(String(bold), resolve), ["type": "bold"])
            } else if let strike = o.8 {
                out += withMark(inline(String(strike), resolve), ["type": "strike"])
            } else if let hidden = o.9 {
                out += withMark(inline(String(hidden), resolve), ["type": "hidden"])
            } else if let em = o.10 ?? o.11 {
                out += withMark(inline(String(em), resolve), ["type": "italic"])
            }
        }
        push(text[at...])
        return out
    }

    /// Lines of one paragraph become hard breaks, which is how they read in a chat message.
    static func paragraph(_ lines: [String], _ resolve: LinkResolver) -> JSONValue {
        var content: [JSONValue] = []
        for (i, line) in lines.enumerated() {
            if i > 0 { content.append(["type": "hardBreak"]) }
            content += inline(line.trimmingCharacters(in: .whitespaces), resolve)
        }
        return content.isEmpty ? ["type": "paragraph"] : ["type": "paragraph", "content": .array(content)]
    }

    nonisolated(unsafe) static let listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
    nonisolated(unsafe) static let taskBox = /^\[([ xX])\](?:\s+|$)/
    nonisolated(unsafe) static let photo = /^!\[([^\]]*)\]\(attachment:([\w-]{8,64})\)$/
    nonisolated(unsafe) static let file = /^\[([^\]]*)\]\(attachment:([\w-]{8,64})\)$/
    nonisolated(unsafe) static let rule = /^([-*_])(\s*\1){2,}$/

    static func indentOf(_ line: String) -> Int { line.prefix { $0 == " " || $0 == "\t" }.reduce(0) { $0 + ($1 == "\t" ? 2 : 1) } }

    static func startsBlock(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.firstMatch(of: /^(```|~~~|#{1,6}\s|>)/) != nil || t.wholeMatch(of: photo) != nil || t.wholeMatch(of: file) != nil
            || line.wholeMatch(of: listItem) != nil || t.wholeMatch(of: rule) != nil
    }

    static func blocks(_ lines: [String], _ resolve: LinkResolver) -> [JSONValue] {
        var out: [JSONValue] = []
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                i += 1
                continue
            }
            if let fence = trimmed.firstMatch(of: /^(```|~~~)\s*([\w+-]*)/) {
                var body: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(String(fence.1)) {
                    body.append(lines[i])
                    i += 1
                }
                i += 1
                let text = body.joined(separator: "\n")
                var node: JSONValue = ["type": "codeBlock", "attrs": ["language": fence.2.isEmpty ? nil : .string(String(fence.2))]]
                if !text.isEmpty { node["content"] = [["type": "text", "text": .string(text)]] }
                out.append(node)
                continue
            }
            if let heading = trimmed.wholeMatch(of: /(#{1,6})\s+(.*?)\s*#*/) {
                let content = inline(String(heading.2), resolve)
                var node: JSONValue = ["type": "heading", "attrs": ["level": .int(Int64(min(heading.1.count, 3)))]]
                if !content.isEmpty { node["content"] = .array(content) }
                out.append(node)
                i += 1
                continue
            }
            if let p = trimmed.wholeMatch(of: photo) {
                out.append(["type": "photo", "attrs": ["id": .string(String(p.2)), "alt": p.1.isEmpty ? nil : .string(String(p.1))]])
                i += 1
                continue
            }
            if let f = trimmed.wholeMatch(of: file) {
                out.append(["type": "file", "attrs": ["id": .string(String(f.2)), "name": .string(f.1.isEmpty ? "File" : String(f.1)), "mime": nil, "size": nil]])
                i += 1
                continue
            }
            if trimmed.wholeMatch(of: rule) != nil {
                out.append(["type": "horizontalRule"])
                i += 1
                continue
            }
            if trimmed.hasPrefix(">") {
                var quoted: [String] = []
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    quoted.append(lines[i].trimmingCharacters(in: .whitespaces).replacing(/^>\s?/, with: ""))
                    i += 1
                }
                out.append(["type": "blockquote", "content": .array(blocksOrEmpty(quoted, resolve))])
                continue
            }
            if line.wholeMatch(of: listItem) != nil {
                let (list, next) = parseList(lines, i, resolve)
                out.append(list)
                i = next
                continue
            }
            var para: [String] = []
            while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty, !startsBlock(lines[i]) {
                para.append(lines[i])
                i += 1
            }
            if para.isEmpty {
                para.append(line)
                i += 1
            }
            out.append(paragraph(para, resolve))
        }
        return out
    }

    static func blocksOrEmpty(_ lines: [String], _ resolve: LinkResolver) -> [JSONValue] {
        let parsed = blocks(lines, resolve)
        return parsed.isEmpty ? [["type": "paragraph"]] : parsed
    }

    /// A list and everything indented under its items, which may include nested lists.
    static func parseList(_ lines: [String], _ start: Int, _ resolve: LinkResolver) -> (JSONValue, Int) {
        let first = lines[start].wholeMatch(of: listItem)!
        let base = indentOf(lines[start])
        let ordered = first.2.contains(where: \.isNumber)
        var items: [JSONValue] = []
        var boxes: [Bool?] = []
        var i = start
        while i < lines.count {
            guard let m = lines[i].wholeMatch(of: listItem), indentOf(lines[i]) == base, m.2.contains(where: \.isNumber) == ordered else { break }
            let rest = String(m.3)
            let box = ordered ? nil : rest.firstMatch(of: taskBox)
            boxes.append(box.map { $0.1 != " " })
            var body = [box.map { String(rest[$0.range.upperBound...]) } ?? rest]
            i += 1
            while i < lines.count {
                let line = lines[i]
                if line.trimmingCharacters(in: .whitespaces).isEmpty {
                    if i + 1 < lines.count, !lines[i + 1].trimmingCharacters(in: .whitespaces).isEmpty, indentOf(lines[i + 1]) > base {
                        body.append("")
                        i += 1
                        continue
                    }
                    break
                }
                if indentOf(line) > base {
                    body.append(String(line.dropFirst(min(line.prefix { $0 == " " || $0 == "\t" }.count, base + 2))))
                } else if !startsBlock(line) && line.wholeMatch(of: listItem) == nil {
                    body.append(line)
                } else {
                    break
                }
                i += 1
            }
            items.append(["type": "listItem", "content": .array(blocksOrEmpty(body, resolve))])
        }
        if !ordered && boxes.allSatisfy({ $0 != nil }) {
            let tasks = items.enumerated().map { n, item -> JSONValue in
                ["type": "taskItem", "attrs": ["checked": .bool(boxes[n]!)], "content": item["content"] ?? []]
            }
            return (["type": "taskList", "content": .array(tasks)], i)
        }
        for (n, b) in boxes.enumerated() {
            guard let b, var para = items[n]["content"]?.arrayValue?.first, para["type"] == "paragraph" else { continue }
            let box = "[\(b ? "x" : " ")] "
            var content = para["content"]?.arrayValue ?? []
            if let head = content.first, head["type"] == "text", head["marks"] == nil {
                content[0]["text"] = .string(box + (head["text"]?.stringValue ?? ""))
            } else {
                content.insert(["type": "text", "text": .string(box)], at: 0)
            }
            para["content"] = .array(content)
            var itemContent = items[n]["content"]!.arrayValue!
            itemContent[0] = para
            items[n]["content"] = .array(itemContent)
        }
        let startAt = ordered ? Int(first.2.filter(\.isNumber)) ?? 1 : 1
        var list: JSONValue = ["type": ordered ? "orderedList" : "bulletList", "content": .array(items)]
        if ordered && startAt != 1 { list["attrs"] = ["start": .int(Int64(startAt))] }
        return (list, i)
    }

    /// Markdown, as an AI app writes it, as a card body.
    public static func doc(_ markdown: String, resolve: LinkResolver = { _ in nil }) -> JSONValue {
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        let content = blocks(lines, resolve)
        return ["type": "doc", "content": .array(content.isEmpty ? [["type": "paragraph"]] : content)]
    }

    // MARK: Files

    enum Field {
        case one(String)
        case many([String])
        var first: String? {
            switch self {
            case .one(let s): s.trimmingCharacters(in: .whitespaces).isEmpty ? nil : s.trimmingCharacters(in: .whitespaces)
            case .many(let l): l.first
            }
        }
        var all: [String] {
            switch self {
            case .one(let s): s.split(whereSeparator: { $0 == "," || $0.isWhitespace }).map(String.init)
            case .many(let l): l
            }
        }
    }

    static func scalar(_ raw: String) -> String {
        let v = raw.trimmingCharacters(in: .whitespaces)
        if v.count > 1, v.hasPrefix("\""), v.hasSuffix("\"") { return (try? JSON.decode(String.self, from: v)) ?? String(v.dropFirst().dropLast()) }
        if v.count > 1, v.hasPrefix("'"), v.hasSuffix("'") { return String(v.dropFirst().dropLast()).replacingOccurrences(of: "''", with: "'") }
        return v
    }

    static func inlineList(_ raw: String) -> [String] {
        let inner = String(raw.trimmingCharacters(in: .whitespaces).dropFirst().dropLast())
        return inner.matches(of: /\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)/).map { scalar(String($0.output.1)) }.filter { !$0.isEmpty }
    }

    /// The fields at the top of a Markdown file, between `---` lines, and the rest of it.
    static func splitFrontMatter(_ text: String) -> (fields: [String: Field], body: String) {
        var src = text.replacingOccurrences(of: "\r\n", with: "\n")
        if src.hasPrefix("\u{FEFF}") { src.removeFirst() }
        let lines = src.components(separatedBy: "\n")
        guard lines.first?.trimmingCharacters(in: .whitespaces) == "---",
            let end = lines.indices.dropFirst().first(where: { ["---", "..."].contains(lines[$0].trimmingCharacters(in: .whitespaces)) })
        else { return ([:], src) }
        var fields: [String: Field] = [:]
        var listKey: String?
        for line in lines[1..<end] {
            if let item = line.wholeMatch(of: /\s*-\s+(.*)/), let key = listKey, case .many(var l) = fields[key] {
                l.append(scalar(String(item.1)))
                fields[key] = .many(l)
                continue
            }
            guard let pair = line.wholeMatch(of: /([\w-]+)\s*:\s*(.*)/) else { continue }
            let key = pair.1.lowercased()
            let value = pair.2.trimmingCharacters(in: .whitespaces)
            listKey = nil
            if value.isEmpty {
                fields[key] = .many([])
                listKey = key
            } else {
                fields[key] = value.hasPrefix("[") && value.hasSuffix("]") ? .many(inlineList(value)) : .one(scalar(value))
            }
        }
        return (fields, lines[(end + 1)...].joined(separator: "\n"))
    }

    static func baseName(_ path: String) -> String {
        let name = path.split(separator: "/").last.map(String.init) ?? path
        return name.replacing(/(?i)\.(md|markdown|mdown|txt)$/, with: "")
    }

    /// Files as entries, one per file, titled by the front matter's `title`, a first `# Heading`, or the file's name,
    /// with the front matter's tags, date, todo fields and `[[links]]` between the files kept.
    public static func entries(_ files: [(name: String, text: String)], today: String, now: Date = Date()) -> [Entry] {
        struct Parsed {
            var path: String
            var fields: [String: Field]
            var named: String?
            var title: String
            var text: String
            var id: String
        }
        let parsed = files.map { file -> Parsed in
            let (fields, body) = splitFrontMatter(file.text)
            let lines = body.components(separatedBy: "\n")
            var heading: String?
            var rest = body
            if let first = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }),
                let m = lines[first].trimmingCharacters(in: .whitespaces).wholeMatch(of: /#\s+(.*?)\s*#*/)
            {
                heading = String(m.1).trimmingCharacters(in: .whitespaces)
                rest = lines[(first + 1)...].joined(separator: "\n")
            }
            let named = fields["title"]?.first ?? heading
            let title = named ?? baseName(file.name)
            let text = heading != nil && heading != title ? body : rest
            return Parsed(path: file.name, fields: fields, named: named, title: title, text: text, id: UUID().uuidString.lowercased())
        }
        var byName: [String: (id: String, label: String)] = [:]
        for p in parsed { for key in [baseName(p.path), p.title] { byName[key.lowercased()] = (p.id, p.title) } }
        let resolve: LinkResolver = { raw in
            let key = raw.split(separator: "|").first.map(String.init)?.split(separator: "#").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
            return byName[key]
        }
        var out: [Entry] = []
        for p in parsed {
            let type = p.fields["type"]?.first?.lowercased()
            if type == "tag" { continue }
            var own = p.text
            if p.fields["id"] != nil, let r = own.range(of: "\n## In this stack\n") { own = String(own[..<r.lowerBound]) }
            // The front and the pages behind it, each under `## Page 2` and on.
            var parts: [[String]] = [[]]
            for line in own.components(separatedBy: "\n") {
                if let m = line.trimmingCharacters(in: .whitespaces).wholeMatch(of: /(?i)##\s+Page\s+(\d+)/), Int(m.1) == parts.count + 1 {
                    parts.append([])
                } else {
                    parts[parts.count - 1].append(line)
                }
            }
            let content = doc(parts[0].joined(separator: "\n"), resolve: resolve)
            let pages = parts.dropFirst().map { doc($0.joined(separator: "\n"), resolve: resolve) }.filter { !Doc.isBlank($0) }
            if (p.named ?? "").trimmingCharacters(in: .whitespaces).isEmpty && Doc.isBlank(content) && pages.isEmpty { continue }
            var tags: [String] = []
            for t in p.fields["tags"]?.all ?? [] {
                let name = t.trimmingCharacters(in: .whitespaces).replacing(/^#/, with: "").trimmingCharacters(in: .whitespaces)
                if !name.isEmpty && !tags.contains(name) { tags.append(name) }
            }
            var entry = Entry(kind: type == "todo" ? .todo : .note, title: p.title.trimmingCharacters(in: .whitespaces), content: content, tags: tags)
            entry.id = p.id
            entry.pages = pages
            if let created = p.fields["created"]?.first ?? p.fields["date"]?.first {
                let at: Date? = DateKey.isKey(created) ? DateKey.date(created) : ISO8601DateFormatter().date(from: created)
                if let at { entry.createdAt = Int64(min(at, now).timeIntervalSince1970 * 1000) }
            }
            if p.fields["template"]?.first == "true" { entry.template = true }
            if entry.kind == .todo {
                if let due = p.fields["due"]?.first, DateKey.isKey(due) {
                    entry.due = due
                    if let t = p.fields["time"]?.first, TimeKey.isKey(t) { entry.dueTime = t }
                    entry.repeat = Repeat.parse(p.fields["repeat"]?.first ?? "")
                }
                if let s = p.fields["start"]?.first, DateKey.isKey(s), entry.due.map({ s <= $0 }) ?? true { entry.start = s }
                if (p.fields["status"]?.first ?? "").wholeMatch(of: /(?i)done|completed|closed/) != nil || p.fields["done"]?.first == "true" { entry.done = true }
            }
            out.append(entry)
        }
        return out
    }

    // MARK: Zip

    /// The Markdown and text files in a zip, like an export from this app, Obsidian or Bear. Hidden files and macOS's
    /// extras are left out.
    public static func filesFromZip(_ data: Data) -> [(name: String, text: String)] {
        let b = [UInt8](data)
        func u16(_ at: Int) -> Int { Int(b[at]) | Int(b[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        // The end of central directory record, searched from the end.
        guard b.count >= 22, let eocd = stride(from: b.count - 22, through: max(0, b.count - 65_557), by: -1).first(where: { u32($0) == 0x0605_4B50 }) else { return [] }
        var at = u32(eocd + 16)
        var out: [(String, String)] = []
        for _ in 0..<u16(eocd + 10) {
            guard at + 46 <= b.count, u32(at) == 0x0201_4B50 else { break }
            let method = u16(at + 10)
            let size = u32(at + 20)
            let original = u32(at + 24)
            let nameLength = u16(at + 28)
            let skip = u16(at + 30) + u16(at + 32)
            let local = u32(at + 42)
            let name = String(decoding: b[(at + 46)..<(at + 46 + nameLength)], as: UTF8.self)
            at += 46 + nameLength + skip
            let hidden = name.split(separator: "/").contains { $0.hasPrefix(".") || $0 == "__MACOSX" }
            guard !hidden, name.lowercased().wholeMatch(of: /.*\.(md|markdown|mdown|txt)/) != nil, local + 30 <= b.count else { continue }
            let start = local + 30 + u16(local + 26) + u16(local + 28)
            guard start + size <= b.count else { continue }
            let body = Data(b[start..<(start + size)])
            let bytes: Data?
            switch method {
            case 0: bytes = body
            case 8: bytes = inflate(body, size: original)
            default: bytes = nil
            }
            if let bytes { out.append((name, String(decoding: bytes, as: UTF8.self))) }
        }
        return out
    }

    /// Raw DEFLATE, as zips hold it.
    static func inflate(_ data: Data, size: Int) -> Data? {
        guard size > 0 else { return Data() }
        var out = Data(count: size)
        let written = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_decode_buffer(
                    dst.bindMemory(to: UInt8.self).baseAddress!, size, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        return written == size ? out : nil
    }
}
