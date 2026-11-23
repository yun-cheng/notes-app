import Foundation
import SwiftUI

/// Converts card bodies (TipTap JSON) to editable rich text and back.
///
/// Inline formatting is real rich text: bold, italic, strikethrough, underline, inline code (a monospaced
/// font) and links. Blocks are written as visible markers at the start of each line, so they survive any
/// editing: `# ` headings, `• ` and `1. ` lists (two spaces of indent per level), `> ` quotes, ``` fences
/// for code, and `---` rules. Card links are links to `notes-card://ID`. Anything else, such as a photo,
/// shows as a placeholder linked to `notes-node://KEY`, and the original node is kept in `stash`.
public struct DocText: Sendable {
    /// How a file shows in the text while it's edited: a voice message, a video or a file, by name, as the web's chip names it.
    static func fileLabel(_ node: JSONValue) -> String {
        let mime = node["attrs"]?["mime"]?.stringValue ?? ""
        let name = node["attrs"]?["name"]?.stringValue ?? ""
        if mime.hasPrefix("audio/") { return "[Voice message]" }
        if mime.hasPrefix("video/") { return "[Video\(name.isEmpty ? "" : ": \(name)")]" }
        return "[File\(name.isEmpty ? "" : ": \(name)")]"
    }

    public var text: AttributedString
    /// Nodes shown as placeholders, by key.
    public var stash: [String: JSONValue]

    public static let cardScheme = "notes-card"
    public static let nodeScheme = "notes-node"

    public static func cardURL(_ id: String) -> URL {
        var c = URLComponents()
        c.scheme = cardScheme
        c.host = "card"
        c.queryItems = [URLQueryItem(name: "id", value: id)]
        return c.url!
    }

    public static func cardId(from url: URL) -> String? {
        guard url.scheme == cardScheme else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "id" }?.value
    }

    static func nodeURL(_ key: String) -> URL { URL(string: "\(nodeScheme)://node/\(key)")! }

    // MARK: Fonts

    public static let bodyFont = Font.body
    /// The tint hidden words have while editing.
    public static let hiddenTint = Color.gray.opacity(0.35)
    static func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.bold()
        case 2: .title2.bold()
        default: .title3.bold()
        }
    }

    public init(text: AttributedString, stash: [String: JSONValue]) {
        self.text = text
        self.stash = stash
    }

    // MARK: Doc to text

    public init(doc: JSONValue, titleOf: @escaping (String, String) -> String = { _, label in label }) {
        var builder = Builder(titleOf: titleOf)
        builder.blocks(doc["content"]?.arrayValue ?? [], prefix: "")
        text = builder.out
        stash = builder.stash
    }

    private struct Builder {
        let titleOf: (String, String) -> String
        var out = AttributedString()
        var stash: [String: JSONValue] = [:]
        var lines = 0

        mutating func newLine() {
            if lines > 0 { out += plain("\n") }
            lines += 1
        }

        func plain(_ s: String, font: Font = DocText.bodyFont) -> AttributedString {
            var a = AttributedString(s)
            a.font = font
            return a
        }

        func marker(_ s: String, font: Font = DocText.bodyFont) -> AttributedString {
            var a = plain(s, font: font)
            return a
        }

        /// Block placeholders get keys starting with "b", inline ones with "i".
        mutating func placeholder(_ node: JSONValue, block: Bool, font: Font = DocText.bodyFont) -> AttributedString {
            let key = "\(block ? "b" : "i")\(stash.count + 1)"
            stash[key] = node
            let type = node["type"]?.stringValue ?? "item"
            let label = type == "photo" ? "[Photo\(node["attrs"]?["alt"]?.stringValue.map { ": \($0)" } ?? "")]" : type == "file" ? DocText.fileLabel(node) : "[\(type)]"
            var a = plain(label, font: font)
            a.link = DocText.nodeURL(key)
            return a
        }

        mutating func blocks(_ nodes: [JSONValue], prefix: String) {
            if nodes.isEmpty {
                newLine()
                out += marker(prefix)
            }
            for node in nodes { block(node, prefix: prefix) }
        }

        mutating func block(_ node: JSONValue, prefix: String) {
            switch node["type"]?.stringValue {
            case "paragraph":
                newLine()
                out += marker(prefix)
                paragraph(node["content"]?.arrayValue ?? [])
            case "heading":
                let level = min(max(Int(node["attrs"]?["level"]?.intValue ?? 1), 1), 3)
                let font = DocText.headingFont(level)
                newLine()
                out += marker(prefix + String(repeating: "#", count: level) + " ", font: font)
                inline(node["content"]?.arrayValue ?? [], font: font)
            case "bulletList", "orderedList":
                list(node, prefix: prefix, depth: 0)
            case "taskList":
                tasks(node, prefix: prefix, depth: 0)
            case "blockquote":
                blocks(node["content"]?.arrayValue ?? [], prefix: prefix + "> ")
            case "codeBlock":
                let mono = Font.body.monospaced()
                newLine()
                out += marker(prefix + "```" + (node["attrs"]?["language"]?.stringValue ?? ""), font: mono)
                let code = (node["content"]?.arrayValue ?? []).compactMap { $0["text"]?.stringValue }.joined()
                for line in code.split(separator: "\n", omittingEmptySubsequences: false) {
                    newLine()
                    out += marker(prefix)
                    out += plain(String(line), font: mono)
                }
                newLine()
                out += marker(prefix + "```", font: mono)
            case "horizontalRule":
                newLine()
                out += marker(prefix + "---")
            default:
                newLine()
                out += marker(prefix)
                out += placeholder(node, block: true)
            }
        }

        /// A checklist: each item a line starting with ☐ or ☑, nested ones indented two spaces a level.
        mutating func tasks(_ node: JSONValue, prefix: String, depth: Int) {
            let indent = String(repeating: "  ", count: depth)
            for item in node["content"]?.arrayValue ?? [] {
                let box = item["attrs"]?["checked"]?.boolValue == true ? "☑ " : "☐ "
                var first = true
                for child in item["content"]?.arrayValue ?? [] {
                    switch child["type"]?.stringValue {
                    case "taskList":
                        if first {
                            newLine()
                            out += marker(prefix + indent + box)
                            first = false
                        }
                        tasks(child, prefix: prefix, depth: depth + 1)
                    case "paragraph":
                        newLine()
                        out += marker(prefix + indent + (first ? box : "  "))
                        paragraph(child["content"]?.arrayValue ?? [])
                        first = false
                    default:
                        newLine()
                        out += marker(prefix + indent + (first ? box : "  "))
                        out += placeholder(child, block: true)
                        first = false
                    }
                }
                if first {
                    newLine()
                    out += marker(prefix + indent + box)
                }
            }
        }

        mutating func list(_ node: JSONValue, prefix: String, depth: Int) {
            let ordered = node["type"]?.stringValue == "orderedList"
            let start = Int(node["attrs"]?["start"]?.intValue ?? 1)
            let indent = String(repeating: "  ", count: depth)
            for (i, item) in (node["content"]?.arrayValue ?? []).enumerated() {
                let bullet = ordered ? "\(start + i). " : "• "
                var first = true
                let children = item["content"]?.arrayValue ?? []
                if children.isEmpty {
                    newLine()
                    out += marker(prefix + indent + bullet)
                }
                for child in children {
                    let type = child["type"]?.stringValue
                    if type == "bulletList" || type == "orderedList" {
                        if first {
                            newLine()
                            out += marker(prefix + indent + bullet)
                            first = false
                        }
                        list(child, prefix: prefix, depth: depth + 1)
                    } else if type == "paragraph" {
                        newLine()
                        out += marker(prefix + indent + (first ? bullet : "  "))
                        paragraph(child["content"]?.arrayValue ?? [])
                        first = false
                    } else {
                        newLine()
                        out += marker(prefix + indent + (first ? bullet : "  "))
                        out += placeholder(child, block: true)
                        first = false
                    }
                }
            }
        }

        /// A paragraph's words. Words that would be read back as a list, heading, quote or rule start with
        /// `DocText.literal`, so they stay words.
        mutating func paragraph(_ nodes: [JSONValue]) {
            if nodes.first?["type"]?.stringValue == "text", DocText.readsAsBlock(nodes.first?["text"]?.stringValue ?? "") {
                out += plain(DocText.literal)
            }
            inline(nodes, font: DocText.bodyFont)
        }

        mutating func inline(_ nodes: [JSONValue], font: Font) {
            for node in nodes {
                switch node["type"]?.stringValue {
                case "text":
                    out += styled(DocText.keepingBars(node["text"]?.stringValue ?? ""), marks: node["marks"]?.arrayValue ?? [], font: font)
                case "hardBreak":
                    out += plain("\u{2028}", font: font)
                case "cardLink":
                    let id = node["attrs"]?["id"]?.stringValue ?? ""
                    let label = node["attrs"]?["label"]?.stringValue ?? ""
                    let shown = titleOf(id, label)
                    // Shown as "Locked" or "Not shared" here, but saved back with its own label.
                    if shown != label, shown == CardIndex.lockedTitle || shown == CardIndex.unsharedTitle {
                        stash[DocText.labelKey(id, shown)] = .string(label)
                    }
                    var a = plain(shown, font: font)
                    a.link = DocText.cardURL(id)
                    out += a
                default:
                    out += placeholder(node, block: false, font: font)
                }
            }
        }

        func styled(_ s: String, marks: [JSONValue], font base: Font) -> AttributedString {
            var font = base
            var a = AttributedString(s)
            for mark in marks {
                switch mark["type"]?.stringValue {
                case "bold": font = font.bold()
                case "italic": font = font.italic()
                case "code": font = font.monospaced()
                case "strike": a.strikethroughStyle = .single
                case "underline": a.underlineStyle = .single
                case "link": a.link = mark["attrs"]?["href"]?.stringValue.flatMap(URL.init(string:))
                // Hidden words keep a tint of their own in the editor, and are read back by it.
                case "hidden": a.backgroundColor = DocText.hiddenTint
                default: break
                }
            }
            a.font = font
            return a
        }
    }

    // MARK: Text to doc

    /// The document for edited text. `context` resolves fonts, so bold and italic can be read back.
    public func doc(in context: Font.Context) -> JSONValue {
        var lines: [AttributedSubstring] = []
        var start = text.startIndex
        for (char, index) in zip(text.characters, text.characters.indices) where char == "\n" {
            lines.append(text[start..<index])
            start = text.index(afterCharacter: index)
        }
        lines.append(text[start..<text.endIndex])
        let parser = Parser(stash: stash, context: context)
        let content = parser.blocks(lines.map { Line(text: $0) })
        return ["type": "doc", "content": .array(content.isEmpty ? [["type": "paragraph"]] : content)]
    }

    struct Line {
        var text: AttributedSubstring
        var string: String { String(text.characters) }

        /// The line without its first `n` characters.
        func dropping(_ n: Int) -> Line {
            let index = text.characters.index(text.startIndex, offsetBy: min(n, text.characters.count))
            return Line(text: text[index..<text.endIndex])
        }
    }

    public struct ListMarker: Sendable {
        public var indent: Int
        public var ordered: Bool
        public var number: Int
        /// Characters up to the item's text.
        public var length: Int
    }

    /// The list marker at the start of a line, such as "  • " or "3. ".
    public static func listMarker(_ s: String) -> ListMarker? {
        let spaces = s.prefix { $0 == " " }.count
        let rest = s.dropFirst(spaces)
        for bullet in ["• ", "- ", "* "] where rest.hasPrefix(bullet) {
            return ListMarker(indent: spaces / 2, ordered: false, number: 1, length: spaces + 2)
        }
        let digits = rest.prefix { $0.isASCII && $0.isNumber }
        if !digits.isEmpty, digits.count <= 6, rest.dropFirst(digits.count).hasPrefix(". ") {
            return ListMarker(indent: spaces / 2, ordered: true, number: Int(digits) ?? 1, length: spaces + digits.count + 2)
        }
        return nil
    }

    public struct TaskMarker: Sendable {
        public var indent: Int
        public var checked: Bool
        public var length: Int
    }

    /// A checklist item's box at the start of a line: "☐ ", "☑ ", or as typed, "[ ] " and "[x] ".
    public static func taskMarker(_ s: String) -> TaskMarker? {
        let spaces = s.prefix { $0 == " " }.count
        let rest = s.dropFirst(spaces)
        if rest.hasPrefix("☐ ") || rest.hasPrefix("☑ ") { return TaskMarker(indent: spaces / 2, checked: rest.hasPrefix("☑"), length: spaces + 2) }
        for (box, checked) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] where rest.hasPrefix(box) {
            return TaskMarker(indent: spaces / 2, checked: checked, length: spaces + box.count)
        }
        return nil
    }

    struct Parser {
        let stash: [String: JSONValue]
        let context: Font.Context

        func stashed(_ url: URL?) -> JSONValue? {
            guard let url, url.scheme == DocText.nodeScheme else { return nil }
            return stash[url.lastPathComponent]
        }

        /// A line that is nothing but one placeholder.
        func placeholderBlock(_ line: Line) -> JSONValue? {
            let runs = line.text.runs.filter { !String(line.text[$0.range].characters).trimmingCharacters(in: .whitespaces).isEmpty }
            guard runs.count == 1, let url = runs[0].link, url.lastPathComponent.hasPrefix("b") else { return nil }
            return stashed(url)
        }

        func blocks(_ lines: [Line]) -> [JSONValue] {
            var out: [JSONValue] = []
            var i = 0
            while i < lines.count {
                let line = lines[i]
                let s = line.string
                if s.hasPrefix(">") {
                    var quoted: [Line] = []
                    while i < lines.count, lines[i].string.hasPrefix(">") {
                        let q = lines[i].string
                        quoted.append(lines[i].dropping(q.hasPrefix("> ") ? 2 : 1))
                        i += 1
                    }
                    out.append(["type": "blockquote", "content": .array(blocks(quoted).nonEmpty)])
                    continue
                }
                if s.hasPrefix("```") {
                    let language = s.dropFirst(3).trimmingCharacters(in: .whitespaces)
                    var code: [String] = []
                    i += 1
                    while i < lines.count, lines[i].string != "```" {
                        code.append(lines[i].string)
                        i += 1
                    }
                    i += 1
                    var node: JSONValue = ["type": "codeBlock", "attrs": ["language": language.isEmpty ? nil : .string(language)]]
                    let joined = code.joined(separator: "\n")
                    if !joined.isEmpty { node["content"] = [["type": "text", "text": .string(joined)]] }
                    out.append(node)
                    continue
                }
                if DocText.taskMarker(s) != nil {
                    var items: [Line] = []
                    while i < lines.count {
                        let l = lines[i].string
                        if DocText.taskMarker(l) != nil || (l.hasPrefix("  ") && !l.trimmingCharacters(in: .whitespaces).isEmpty && DocText.listMarker(l) == nil) {
                            items.append(lines[i])
                            i += 1
                        } else {
                            break
                        }
                    }
                    out.append(taskList(items, indent: DocText.taskMarker(s)!.indent))
                    continue
                }
                if let marker = DocText.listMarker(s) {
                    var items: [Line] = []
                    while i < lines.count {
                        let l = lines[i].string
                        if DocText.listMarker(l) != nil || (l.hasPrefix("  ") && !l.trimmingCharacters(in: .whitespaces).isEmpty) {
                            items.append(lines[i])
                            i += 1
                        } else {
                            break
                        }
                    }
                    out += lists(items, indent: marker.indent)
                    continue
                }
                i += 1
                if let level = headingLevel(s) {
                    let heading: JSONValue = ["type": "heading", "attrs": ["level": .int(Int64(level))], "content": .array(inline(line.dropping(level + 1), heading: true))]
                    out.append(heading.pruned)
                } else if s.trimmingCharacters(in: .whitespaces) == "---" {
                    out.append(["type": "horizontalRule"])
                } else if let node = placeholderBlock(line) {
                    out.append(node)
                } else {
                    let paragraph: JSONValue = ["type": "paragraph", "content": .array(inline(line, heading: false))]
                    out.append(paragraph.pruned)
                }
            }
            return out
        }

        /// Checklist lines, starting at `indent`, as a task list; deeper ones nest in the item before them.
        func taskList(_ lines: [Line], indent: Int) -> JSONValue {
            var items: [JSONValue] = []
            var i = 0
            while i < lines.count {
                let line = lines[i]
                guard let marker = DocText.taskMarker(line.string), marker.indent <= indent else {
                    i += 1
                    continue
                }
                var content: [JSONValue] = [(["type": "paragraph", "content": .array(inline(line.dropping(marker.length), heading: false))] as JSONValue).pruned]
                i += 1
                var nested: [Line] = []
                while i < lines.count {
                    if let m = DocText.taskMarker(lines[i].string), m.indent <= indent { break }
                    nested.append(lines[i])
                    i += 1
                }
                if let first = nested.first, let m = DocText.taskMarker(first.string) {
                    content.append(taskList(nested, indent: m.indent))
                } else {
                    for l in nested { content += blocks([l.dropping(l.string.prefix { $0 == " " }.count)]) }
                }
                items.append(["type": "taskItem", "attrs": ["checked": .bool(marker.checked)], "content": .array(content)])
            }
            return ["type": "taskList", "content": .array(items)]
        }

        func headingLevel(_ s: String) -> Int? {
            let hashes = s.prefix { $0 == "#" }.count
            return (1...3).contains(hashes) && s.dropFirst(hashes).hasPrefix(" ") ? hashes : nil
        }

        /// Consecutive list lines, starting at `indent`, as one or more lists.
        func lists(_ lines: [Line], indent: Int) -> [JSONValue] {
            var result: [JSONValue] = []
            var items: [JSONValue] = []
            var ordered: Bool?
            var start = 1
            var i = 0
            func flush() {
                guard let o = ordered, !items.isEmpty else { return }
                var list: JSONValue = ["type": o ? "orderedList" : "bulletList", "content": .array(items)]
                if o { list["attrs"] = ["start": .int(Int64(start))] }
                result.append(list)
                items = []
            }
            while i < lines.count {
                let line = lines[i]
                guard let marker = DocText.listMarker(line.string), marker.indent <= indent else {
                    // A deeper or unmarked line before any item at this level: treat it as its own paragraph.
                    let trimmed = line.dropping(line.string.prefix { $0 == " " }.count)
                    items.append(["type": "listItem", "content": .array(blocks([trimmed]).nonEmpty)])
                    if ordered == nil { ordered = false }
                    i += 1
                    continue
                }
                if ordered != nil && ordered != marker.ordered { flush() }
                if items.isEmpty {
                    ordered = marker.ordered
                    start = marker.number
                }
                let first: JSONValue = ["type": "paragraph", "content": .array(inline(line.dropping(marker.length), heading: false))]
                var content: [JSONValue] = [first.pruned]
                i += 1
                // Lines belonging to this item: deeper list items and indented continuation paragraphs.
                var nested: [Line] = []
                while i < lines.count {
                    let next = lines[i].string
                    if let m = DocText.listMarker(next), m.indent <= indent { break }
                    nested.append(lines[i])
                    i += 1
                }
                var j = 0
                while j < nested.count {
                    if DocText.listMarker(nested[j].string) != nil {
                        var group: [Line] = []
                        while j < nested.count, DocText.listMarker(nested[j].string) != nil || nested[j].string.hasPrefix(String(repeating: "  ", count: indent + 2)) {
                            group.append(nested[j])
                            j += 1
                        }
                        content += lists(group, indent: indent + 1)
                    } else {
                        let l = nested[j]
                        let block = blocks([l.dropping(l.string.prefix { $0 == " " }.count)])
                        content += block
                        j += 1
                    }
                }
                items.append(["type": "listItem", "content": .array(content)])
            }
            flush()
            return result
        }

        /// Inline nodes for one line. Heading text is bold by its font, so bold isn't read from it.
        func inline(_ line: Line, heading: Bool) -> [JSONValue] {
            var out: [JSONValue] = []
            for run in line.text.runs {
                let s = String(line.text[run.range].characters)
                if s.isEmpty { continue }
                if let url = run.link, let id = DocText.cardId(from: url) {
                    let label = stash[DocText.labelKey(id, s)]?.stringValue ?? s
                    out.append(["type": "cardLink", "attrs": ["id": .string(id), "label": .string(label)]])
                    continue
                }
                if let node = stashed(run.link) {
                    out.append(node)
                    continue
                }
                var marks: [JSONValue] = []
                if let font = run.font {
                    let resolved = font.resolve(in: context)
                    if resolved.isBold && !heading { marks.append(["type": "bold"]) }
                    if resolved.isItalic { marks.append(["type": "italic"]) }
                    if resolved.isMonospaced { marks.append(["type": "code"]) }
                }
                if run.strikethroughStyle != nil { marks.append(["type": "strike"]) }
                let hidden = run.backgroundColor != nil
                if run.underlineStyle != nil { marks.append(["type": "underline"]) }
                if let url = run.link { marks.append(["type": "link", "attrs": ["href": .string(url.absoluteString)]]) }
                // A line break inside a paragraph.
                for (k, part) in s.split(separator: "\u{2028}", omittingEmptySubsequences: false).enumerated() {
                    if k > 0 { out.append(["type": "hardBreak"]) }
                    if part.isEmpty { continue }
                    // `||words||` typed in hides them, as in the web app's editor; not in code. Bars kept apart by
                    // `literal` were in the words already, and stay.
                    let code = marks.contains { $0["type"]?.stringValue == "code" }
                    for (typed, typedHidden) in code ? [(String(part), false)] : DocText.hiddenRuns(String(part)) {
                    let piece = typed.replacingOccurrences(of: DocText.literal, with: "")
                    if piece.isEmpty { continue }
                    var pieceMarks = marks
                    if hidden || typedHidden { pieceMarks.append(["type": "hidden"]) }
                    var node: JSONValue = ["type": "text", "text": .string(piece)]
                    if !pieceMarks.isEmpty { node["marks"] = .array(pieceMarks) }
                    if let last = out.last, last["type"]?.stringValue == "text", last["marks"] == node["marks"] {
                        out[out.count - 1]["text"] = .string((last["text"]?.stringValue ?? "") + piece)
                    } else {
                        out.append(node)
                    }
                    }
                }
            }
            return out
        }
    }
}

extension DocText {
    /// An invisible character that keeps words that look like editor syntax as words: put before a paragraph that
    /// starts like a list, and between bars that would hide words. Never saved.
    public static let literal = "\u{2060}"

    /// Whether a line starting with these words would be read as something other than a paragraph.
    static func readsAsBlock(_ s: String) -> Bool {
        if s.hasPrefix(" ") || s.hasPrefix(">") || s.hasPrefix("```") || s.trimmingCharacters(in: .whitespaces) == "---" { return true }
        if listMarker(s) != nil || taskMarker(s) != nil { return true }
        let hashes = s.prefix { $0 == "#" }.count
        return (1...3).contains(hashes) && s.dropFirst(hashes).hasPrefix(" ")
    }

    /// Words with `literal` between any two bars, so they aren't read as `||hidden||` again.
    static func keepingBars(_ s: String) -> String {
        guard s.contains("||") else { return s }
        var out = ""
        var last: Character?
        for c in s {
            if c == "|", last == "|" { out += literal }
            out.append(c)
            last = c
        }
        return out
    }

    /// Where a card link's own label is kept while it's shown under another title.
    static func labelKey(_ id: String, _ shown: String) -> String { "label:\(id):\(shown)" }

    /// Text cut where `||words||` marks words to hide; the bars go.
    static func hiddenRuns(_ s: String) -> [(String, Bool)] {
        var out: [(String, Bool)] = []
        var rest = Substring(s)
        while let open = rest.range(of: "||"), let close = rest[open.upperBound...].range(of: "||"), close.lowerBound > open.upperBound {
            if open.lowerBound > rest.startIndex { out.append((String(rest[..<open.lowerBound]), false)) }
            out.append((String(rest[open.upperBound..<close.lowerBound]), true))
            rest = rest[close.upperBound...]
        }
        if !rest.isEmpty || out.isEmpty { out.append((String(rest), false)) }
        return out.filter { !$0.0.isEmpty }
    }
}

extension Array where Element == JSONValue {
    /// Blocks inside a quote or list item can't be empty.
    var nonEmpty: [JSONValue] { isEmpty ? [["type": "paragraph"]] : self }
}

extension JSONValue {
    /// Drops an empty `content` array, which ProseMirror leaves out for empty blocks.
    var pruned: JSONValue {
        guard var fields = objectValue else { return self }
        if fields["content"]?.arrayValue?.isEmpty == true { fields["content"] = nil }
        return .object(fields)
    }
}
