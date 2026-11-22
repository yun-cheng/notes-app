import Foundation

/// The rest of the web app's `content.ts`: text from a body for bubbles and titles, links, files and checklists.
extension Doc {
    /// Wraps inline code in a bubble's lines, so it can be shown as code.
    public static let codeOpen = "\u{E000}"
    public static let codeClose = "\u{E001}"
    /// Wraps hidden text in a bubble's lines, so it can be shown under dots.
    public static let hideOpen = "\u{E002}"
    public static let hideClose = "\u{E003}"
    /// What hidden text stands as where it can't be hidden, like a title made from a note's first line.
    public static let hiddenMask = "•••"

    public enum Hidden: Sendable { case show, mark, mask }

    public typealias TitleOf = (_ id: String, _ label: String) -> String

    static func marks(_ node: JSONValue) -> [String] { node["marks"]?.arrayValue?.compactMap { $0["type"]?.stringValue } ?? [] }

    /// A block's text on one line, with card links as their titles.
    public static func inlineText(_ node: JSONValue, titleOf: TitleOf? = nil, markCode: Bool = false, hidden: Hidden = .show) -> String {
        switch node["type"]?.stringValue {
        case "text":
            let text = node["text"]?.stringValue ?? ""
            let isHidden = hidden != .show && !text.isEmpty && marks(node).contains("hidden")
            if isHidden && hidden == .mask { return hiddenMask }
            let shown = markCode && !text.isEmpty && marks(node).contains("code") ? codeOpen + text + codeClose : text
            return isHidden ? hideOpen + shown + hideClose : shown
        case "hardBreak": return "\n"
        case "cardLink":
            let label = node["attrs"]?["label"]?.stringValue ?? ""
            return titleOf?(node["attrs"]?["id"]?.stringValue ?? "", label) ?? label
        default:
            let text = (node["content"]?.arrayValue ?? []).map { inlineText($0, titleOf: titleOf, markCode: markCode, hidden: hidden) }.joined()
            switch hidden {
            case .mark: return text.replacingOccurrences(of: hideClose + hideOpen, with: "")
            case .mask: return text.replacingOccurrences(of: hiddenMask + hiddenMask, with: hiddenMask)
            case .show: return text
            }
        }
    }

    /// A run of a document's text: lines of plain text, or a code block, kept as typed.
    public enum PreviewPart: Sendable, Hashable {
        case text([String])
        case code(text: String, language: String?, prefix: String)
    }

    /// A document as runs of text lines, with list markers, and code blocks between them. Trailing empty lines go.
    /// `full` keeps photos, files and rules as lines of their own and marks quotes with "> ", for comparing versions.
    public static func previewParts(_ content: JSONValue, titleOf: TitleOf? = nil, full: Bool = false, markCode: Bool = false, hidden: Hidden = .show) -> [PreviewPart] {
        var parts: [PreviewPart] = []
        func line(_ text: String) {
            if case .text(var lines) = parts.last {
                lines.append(text)
                parts[parts.count - 1] = .text(lines)
            } else {
                parts.append(.text([text]))
            }
        }
        func block(_ node: JSONValue, _ prefix: String) {
            let children = node["content"]?.arrayValue ?? []
            switch node["type"]?.stringValue {
            case "bulletList", "orderedList":
                let start = Int(node["attrs"]?["start"]?.intValue ?? 1)
                for (i, item) in children.enumerated() {
                    let marker = node["type"]?.stringValue == "bulletList" ? "• " : "\(start + i). "
                    for (j, child) in (item["content"]?.arrayValue ?? []).enumerated() { block(child, j == 0 ? prefix + marker : prefix + "  ") }
                }
            case "taskList":
                for item in children {
                    let marker = item["attrs"]?["checked"]?.boolValue == true ? "☑ " : "☐ "
                    for (j, child) in (item["content"]?.arrayValue ?? []).enumerated() { block(child, j == 0 ? prefix + marker : prefix + "  ") }
                }
            case "blockquote":
                children.forEach { block($0, full ? prefix + "> " : prefix) }
            case "doc":
                children.forEach { block($0, prefix) }
            case "photo":
                if full {
                    let alt = node["attrs"]?["alt"]?.stringValue ?? ""
                    line("\(prefix)[Photo\(alt.isEmpty ? "" : ": \(alt)")]")
                }
            case "file":
                if full {
                    let mime = node["attrs"]?["mime"]?.stringValue ?? ""
                    let name = node["attrs"]?["name"]?.stringValue ?? ""
                    let kind = mime.hasPrefix("video/") ? "Video" : mime.hasPrefix("audio/") ? "Voice" : "File"
                    line("\(prefix)[\(kind): \(name.isEmpty ? "Untitled" : name)]")
                    if let t = node["attrs"]?["transcript"]?.stringValue, !t.isEmpty { line("\(prefix)“\(t)”") }
                }
            case "horizontalRule":
                if full { line("\(prefix)———") }
            case "codeBlock":
                let language = node["attrs"]?["language"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
                var text = inlineText(node)
                while text.hasSuffix("\n") { text.removeLast() }
                parts.append(.code(text: text, language: language, prefix: prefix))
            default:
                (prefix + inlineText(node, titleOf: titleOf, markCode: markCode, hidden: hidden)).components(separatedBy: "\n").forEach(line)
            }
        }
        block(content, "")
        while let last = parts.last {
            switch last {
            case .code(let text, _, _):
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return parts }
                parts.removeLast()
            case .text(var lines):
                while let l = lines.last, l.trimmingCharacters(in: .whitespaces).isEmpty { lines.removeLast() }
                if !lines.isEmpty {
                    parts[parts.count - 1] = .text(lines)
                    return parts
                }
                parts.removeLast()
            }
        }
        return parts
    }

    /// A document as lines of text, with list markers; a code block's lines are lines too.
    public static func previewLines(_ content: JSONValue, titleOf: TitleOf? = nil, full: Bool = false, hidden: Hidden = .show) -> [String] {
        previewParts(content, titleOf: titleOf, full: full, hidden: hidden).flatMap { part -> [String] in
            switch part {
            case .text(let lines): return lines
            case .code(let text, _, let prefix):
                let blank = String(prefix.map { $0.isWhitespace ? $0 : " " })
                return text.components(separatedBy: "\n").enumerated().map { ($0.offset == 0 ? prefix : blank) + $0.element }
            }
        }
    }

    static let firstLineMax = 80

    static func shortened(_ line: String) -> String {
        line.count > firstLineMax ? String(line.prefix(firstLineMax - 1)).trimmingCharacters(in: .whitespaces) + "…" : line
    }

    static func stripMarker(_ line: String) -> String {
        line.replacing(/^(• |\d+\. )/, with: "").trimmingCharacters(in: .whitespaces)
    }

    /// The first line of text in the body, shortened to fit a title. Hidden words stay hidden.
    public static func firstLine(_ content: JSONValue) -> String {
        guard let line = previewLines(content, hidden: .mask).first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return "" }
        return shortened(stripMarker(line))
    }

    // MARK: Links

    /// A web address in text. It stops before trailing punctuation.
    nonisolated(unsafe) static let urlInText = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]/

    /// Text cut into plain runs and web addresses.
    public static func splitLinks(_ text: String) -> [(text: String, href: String?)] {
        var parts: [(String, String?)] = []
        var at = text.startIndex
        for m in text.matches(of: urlInText) {
            if m.range.lowerBound > at { parts.append((String(text[at..<m.range.lowerBound]), nil)) }
            parts.append((String(m.output), String(m.output)))
            at = m.range.upperBound
        }
        if at < text.endIndex || parts.isEmpty { parts.append((String(text[at...]), nil)) }
        return parts
    }

    static func inlineWithLinks(_ line: String) -> [JSONValue] {
        splitLinks(line).filter { !$0.text.isEmpty }.map { part in
            if let href = part.href { return ["type": "text", "text": .string(part.text), "marks": [["type": "link", "attrs": ["href": .string(href)]]]] }
            return ["type": "text", "text": .string(part.text)]
        }
    }

    /// A body made from typed text: one paragraph per line, with web addresses as links.
    public static func fromText(_ text: String) -> JSONValue {
        var t = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        while t.hasPrefix("\n") { t.removeFirst() }
        while t.hasSuffix("\n") { t.removeLast() }
        let paragraphs: [JSONValue] = t.components(separatedBy: "\n").map { line in
            line.isEmpty ? ["type": "paragraph"] : ["type": "paragraph", "content": .array(inlineWithLinks(line))]
        }
        return ["type": "doc", "content": .array(paragraphs)]
    }

    /// Web addresses in the body, from links and from addresses typed as plain text, each once and in order.
    public static func linkUrls(_ content: JSONValue) -> [String] {
        var urls: [String] = []
        walk(content) { n in
            guard n["type"]?.stringValue == "text" else { return }
            let href = n["marks"]?.arrayValue?.first { $0["type"]?.stringValue == "link" }?["attrs"]?["href"]?.stringValue
            if let href, href.lowercased().hasPrefix("http://") || href.lowercased().hasPrefix("https://") {
                if !urls.contains(href) { urls.append(href) }
            } else {
                for m in (n["text"]?.stringValue ?? "").matches(of: urlInText) where !urls.contains(String(m.output)) { urls.append(String(m.output)) }
            }
        }
        return urls
    }

    /// The site's name for display: "github.com" for "https://www.github.com/a/b".
    public static func siteName(_ url: String) -> String {
        guard let host = URL(string: url)?.host() else { return url }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Whether a web address points straight at a picture, not at a page that has one.
    public static func isImageUrl(_ url: String) -> Bool {
        guard let path = URL(string: url)?.path() else { return false }
        return path.lowercased().wholeMatch(of: /.*\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)/) != nil
    }

    /// Whether the body holds a photo: one of its own, or a link straight to a picture.
    public static func hasPhoto(_ content: JSONValue) -> Bool { !photoIds(content).isEmpty || linkUrls(content).contains(where: isImageUrl) }

    /// How many items of the body's checklists are ticked, of how many; nil when it has none.
    public static func checklistProgress(_ content: JSONValue) -> (done: Int, total: Int)? {
        var done = 0
        var total = 0
        walk(content) { n in
            guard n["type"]?.stringValue == "taskItem" else { return }
            total += 1
            if n["attrs"]?["checked"]?.boolValue == true { done += 1 }
        }
        return total > 0 ? (done, total) : nil
    }

    // MARK: Files

    /// A file attached in the body, with what it was added with. A video keeps its still and shape; a sound its
    /// transcript, the language heard, when each stretch starts, and its loudness to draw it by.
    public struct FileInfo: Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var mime: String?
        public var size: Int64?
        public var poster: String?
        public var width: Double?
        public var height: Double?
        public var duration: Double?
        public var transcript: String?
        public var language: String?
        public var cues: [Cue] = []
        public var peaks: [Double] = []

        public var isVideo: Bool { mime?.hasPrefix("video/") ?? false }
        public var isAudio: Bool { mime?.hasPrefix("audio/") ?? false }
    }

    public struct Cue: Sendable, Hashable {
        public var start: Double
        public var text: String
    }

    static func positive(_ v: JSONValue?) -> Double? {
        switch v {
        case .int(let i) where i > 0: Double(i)
        case .double(let d) where d.isFinite && d > 0: d
        default: nil
        }
    }

    public static func files(_ content: JSONValue) -> [FileInfo] {
        var out: [FileInfo] = []
        walk(content) { n in
            guard n["type"]?.stringValue == "file", let a = n["attrs"], let id = a["id"]?.stringValue else { return }
            let name = a["name"]?.stringValue ?? ""
            let mime = a["mime"]?.stringValue
            var file = FileInfo(id: id, name: name.isEmpty ? "Untitled" : name, mime: mime?.isEmpty == false ? mime : nil, size: a["size"]?.intValue.flatMap { $0 >= 0 ? $0 : nil })
            if file.isVideo {
                file.poster = a["poster"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
                file.width = positive(a["width"])
                file.height = positive(a["height"])
                file.duration = positive(a["duration"])
            }
            if file.isAudio {
                file.duration = positive(a["duration"])
                file.transcript = a["transcript"]?.stringValue
                file.language = a["language"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
                file.cues = (a["cues"]?.arrayValue ?? []).compactMap { c in
                    let start: Double? =
                        switch c["start"] {
                        case .int(let i): Double(i)
                        case .double(let d): d
                        default: nil
                        }
                    guard let start, start >= 0, let text = c["text"]?.stringValue else { return nil }
                    return Cue(start: start, text: text)
                }
                file.peaks = (a["peaks"]?.arrayValue ?? []).compactMap { p in
                    switch p {
                    case .int(let i): Double(max(0, min(100, i)))
                    case .double(let d) where d.isFinite: max(0, min(100, d))
                    default: nil
                    }
                }
            }
            out.append(file)
        }
        return out
    }

    /// A photo or a video, as they show together.
    public enum Media: Sendable, Hashable, Identifiable {
        case photo(String)
        case video(FileInfo)
        public var id: String {
            switch self {
            case .photo(let id): id
            case .video(let file): file.id
            }
        }
    }

    public static func media(_ content: JSONValue) -> [Media] {
        var items: [Media] = []
        walk(content) { n in
            if n["type"]?.stringValue == "photo", let id = n["attrs"]?["id"]?.stringValue { items.append(.photo(id)) }
            if n["type"]?.stringValue == "file", let file = files(n).first, file.isVideo { items.append(.video(file)) }
        }
        return items
    }

    /// A video's still is kept beside it, as a photo.
    public static func posterId(_ videoId: String) -> String { "\(videoId)-poster" }

    /// A clip's length as a player shows it: "0:07", "4:05", "1:02:09".
    public static func clipLength(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        let h = s / 3600
        let m = (s % 3600) / 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s % 60) : String(format: "%d:%02d", m, s % 60)
    }
}
