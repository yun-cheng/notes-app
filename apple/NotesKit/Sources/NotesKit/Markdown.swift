import Foundation

/// Card bodies as Markdown and as plain text, and entries as the clipboard carries them, as the web app's
/// `markdown.ts` and `clipboard.ts`.
public enum Markdown {
    static func escape(_ text: String) -> String {
        var out = text.replacing(/[\\*`\[]/) { "\\" + $0.output }
        // Two bars in a row would read as hidden text.
        out = out.replacing(/\|(?=\|)/) { _ in "\\|" }
        out = out.replacing(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/) { m in String(m.output.0).replacingOccurrences(of: "_", with: "\\_") }
        return out
    }

    static func renderText(_ node: JSONValue) -> String {
        let marks = node["marks"]?.arrayValue ?? []
        let types = marks.compactMap { $0["type"]?.stringValue }
        let text = node["text"]?.stringValue ?? ""
        var out = types.contains("code") ? "`\(text)`" : escape(text)
        for mark in marks {
            switch mark["type"]?.stringValue {
            case "bold": out = "**\(out)**"
            case "italic": out = "*\(out)*"
            case "strike": out = "~~\(out)~~"
            case "hidden": out = "||\(out)||"
            case "link": out = "[\(out)](\(mark["attrs"]?["href"]?.stringValue ?? ""))"
            default: break
            }
        }
        return out
    }

    /// Text as read: no marks, and a link as its address, after its words when they differ.
    static func plainInline(_ node: JSONValue) -> String {
        let text = node["text"]?.stringValue ?? ""
        guard let href = node["marks"]?.arrayValue?.first(where: { $0["type"]?.stringValue == "link" })?["attrs"]?["href"]?.stringValue, !href.isEmpty else { return text }
        let bare = href.replacing(/^(?i)[a-z]+:\/\//, with: "")
        return href == text || bare == text ? href : "\(text) (\(href))"
    }

    static func renderInline(_ nodes: [JSONValue]?, _ title: Doc.TitleOf, plain: Bool = false) -> String {
        (nodes ?? []).map { n -> String in
            switch n["type"]?.stringValue {
            case "text": return plain ? plainInline(n) : renderText(n)
            case "hardBreak": return plain ? "\n" : "  \n"
            case "cardLink":
                let t = title(n["attrs"]?["id"]?.stringValue ?? "", n["attrs"]?["label"]?.stringValue ?? "")
                return plain ? t : "[[\(t)]]"
            default: return ""
            }
        }.joined().replacingOccurrences(of: "||||", with: "")
    }

    static func indent(_ text: String, _ by: String) -> String {
        text.components(separatedBy: "\n").enumerated().map { i, l in i > 0 && !l.isEmpty ? by + l : l }.joined(separator: "\n")
    }

    static func items(_ node: JSONValue) -> [JSONValue] { node["content"]?.arrayValue ?? [] }

    static func plainBlock(_ node: JSONValue, _ title: Doc.TitleOf) -> String {
        switch node["type"]?.stringValue {
        case "bulletList": return items(node).map { "- " + indent(plainBlocks($0["content"]?.arrayValue, title), "  ") }.joined(separator: "\n")
        case "taskList":
            return items(node).map { ($0["attrs"]?["checked"]?.boolValue == true ? "☑ " : "☐ ") + indent(plainBlocks($0["content"]?.arrayValue, title), "  ") }
                .joined(separator: "\n")
        case "orderedList":
            let start = Int(node["attrs"]?["start"]?.intValue ?? 1)
            return items(node).enumerated().map { "\(start + $0.offset). " + indent(plainBlocks($0.element["content"]?.arrayValue, title), "   ") }.joined(separator: "\n")
        case "blockquote": return plainBlocks(node["content"]?.arrayValue, title)
        case "codeBlock": return items(node).map { $0["text"]?.stringValue ?? "" }.joined()
        case "file": return node["attrs"]?["transcript"]?.stringValue ?? ""
        case "photo", "horizontalRule": return ""
        default: return renderInline(node["content"]?.arrayValue, title, plain: true)
        }
    }

    static func plainBlocks(_ nodes: [JSONValue]?, _ title: Doc.TitleOf) -> String {
        (nodes ?? []).map { plainBlock($0, title) }.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    /// A document as plain text, for pasting into apps that don't read Markdown.
    public static func plain(_ doc: JSONValue, title: @escaping Doc.TitleOf = { _, l in l }) -> String {
        plainBlocks(doc["content"]?.arrayValue, title).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func renderBlock(_ node: JSONValue, _ title: Doc.TitleOf) -> String {
        switch node["type"]?.stringValue {
        case "paragraph":
            return renderInline(node["content"]?.arrayValue, title).replacing(/^(#{1,6}\s|>|[-+]\s|\d+\.\s)/) { "\\" + $0.output.0 }
        case "heading":
            return String(repeating: "#", count: Int(node["attrs"]?["level"]?.intValue ?? 1)) + " " + renderInline(node["content"]?.arrayValue, title)
        case "bulletList": return items(node).map { "- " + indent(renderBlocks($0["content"]?.arrayValue, title), "  ") }.joined(separator: "\n")
        case "taskList":
            return items(node).map { "- [\($0["attrs"]?["checked"]?.boolValue == true ? "x" : " ")] " + indent(renderBlocks($0["content"]?.arrayValue, title), "  ") }
                .joined(separator: "\n")
        case "orderedList":
            let start = Int(node["attrs"]?["start"]?.intValue ?? 1)
            return items(node).enumerated().map { i, item in
                let marker = "\(start + i). "
                return marker + indent(renderBlocks(item["content"]?.arrayValue, title), String(repeating: " ", count: marker.count))
            }.joined(separator: "\n")
        case "blockquote":
            return renderBlocks(node["content"]?.arrayValue, title).components(separatedBy: "\n").map { $0.isEmpty ? ">" : "> \($0)" }.joined(separator: "\n")
        case "codeBlock":
            let lang = node["attrs"]?["language"]?.stringValue ?? ""
            return "```\(lang)\n" + items(node).map { $0["text"]?.stringValue ?? "" }.joined() + "\n```"
        case "photo":
            let alt = (node["attrs"]?["alt"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? "Photo"
            return "![\(alt.replacing(/[\[\]]/, with: ""))](attachment:\(node["attrs"]?["id"]?.stringValue ?? ""))"
        case "file":
            let name = (node["attrs"]?["name"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? "File"
            let link = "[\(name.replacing(/[\[\]]/, with: ""))](attachment:\(node["attrs"]?["id"]?.stringValue ?? ""))"
            let words = node["attrs"]?["transcript"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return words.isEmpty ? link : "\(link)\n\n> \(words.replacing(/\n+/, with: " "))"
        case "horizontalRule": return "---"
        default: return renderInline(node["content"]?.arrayValue, title)
        }
    }

    static func renderBlocks(_ nodes: [JSONValue]?, _ title: Doc.TitleOf) -> String {
        (nodes ?? []).map { renderBlock($0, title) }.joined(separator: "\n\n")
    }

    public static func from(_ doc: JSONValue, title: @escaping Doc.TitleOf = { _, l in l }) -> String {
        renderBlocks(doc["content"]?.arrayValue, title).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func tagWords(_ tags: [String]) -> String { tags.map { "#" + $0.replacing(/\s+/, with: "-") }.joined(separator: " ") }

    /// Entries as text the journal box reads back: a todo as `[ ] Title @2026-12-01 @15:00 @weekly #tag` with its
    /// details below; a note as Markdown with its tags on a last line. Todos of a line each make one list.
    public static func entries(_ cards: [Card], index: CardIndex) -> String {
        let parts = cards.map { card -> (text: String, line: Bool) in
            let tags = tagWords(index.resolveTags(card.tags).map(\.title))
            let body = from(card.content, title: index.titleOf)
                + card.turnPages.enumerated().map { "\n\n## Page \($0.offset + 2)\n\n" + from($0.element, title: index.titleOf) }.joined()
            if card.type == .todo {
                let when = [card.due, card.due != nil ? card.dueTime : nil, card.due != nil ? card.repeat?.word : nil].compactMap { $0 }.map { "@\($0)" }
                let head = (["[\(card.isDone ? "x" : " ")] \(card.title)"] + when + [tags]).filter { !$0.isEmpty }.joined(separator: " ")
                return (body.isEmpty ? head : "\(head)\n\(body)", body.isEmpty)
            }
            return ([card.title.trimmingCharacters(in: .whitespaces), body, tags].filter { !$0.isEmpty }.joined(separator: "\n"), false)
        }
        return parts.enumerated().map { i, p in (i == 0 ? "" : p.line && parts[i - 1].line ? "\n" : "\n\n") + p.text }.joined()
    }

    public static func entry(_ card: Card, index: CardIndex) -> String { entries([card], index: index) }

    /// Just an entry's words: its title, then its body as plain text, then its pages.
    public static func words(_ card: Card, index: CardIndex) -> String {
        let pages = card.turnPages.enumerated().map { "Page \($0.offset + 2):\n" + plain($0.element, title: index.titleOf) }
        return ([card.title.trimmingCharacters(in: .whitespaces), plain(card.content, title: index.titleOf)] + pages).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
}
