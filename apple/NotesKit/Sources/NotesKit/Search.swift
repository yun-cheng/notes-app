import Foundation

/// Search across cards, as the web app's `search.ts` (MiniSearch): title, text and tags, with the title counting most,
/// words found by their start and with a small typo, and every word typed has to be found.
public struct CardSearch: Sendable {
    public struct Hit: Sendable, Hashable {
        public var card: Card
        public var snippet: String
    }

    struct Doc: Sendable {
        var card: Card
        var text: String
        var fields: [(terms: Set<String>, boost: Double)]
    }

    private var docs: [Doc] = []

    /// Splits on punctuation, and treats each CJK character as its own term because those scripts have no spaces.
    public static func tokenize(_ text: String) -> [String] {
        var tokens: [String] = []
        for m in text.matches(of: /[\p{L}\p{M}\p{N}_]+/) {
            var run = ""
            for ch in m.output {
                if ch.unicodeScalars.contains(where: isCJK) {
                    if !run.isEmpty { tokens.append(run) }
                    run = ""
                    tokens.append(String(ch))
                } else {
                    run.append(ch)
                }
            }
            if !run.isEmpty { tokens.append(run) }
        }
        return tokens
    }

    static func isCJK(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory {
        case .otherLetter:
            let v = s.value
            return (0x3040...0x30FF).contains(v) || (0x3400...0x4DBF).contains(v) || (0x4E00...0x9FFF).contains(v) || (0xF900...0xFAFF).contains(v)
                || (0xAC00...0xD7AF).contains(v) || (0x1100...0x11FF).contains(v) || (0x3130...0x318F).contains(v) || (0x20000...0x2FA1F).contains(v)
        default: return false
        }
    }

    static func terms(_ text: String) -> Set<String> { Set(tokenize(text).map { $0.lowercased() }) }

    public init(_ index: CardIndex) {
        docs = index.live.map { card in
            // Words on the pages behind a card's front are found too.
            let text = [index.text(card), index.pagesText(card)].filter { !$0.isEmpty }.joined(separator: " ")
            let tags = index.resolveTags(card.tags).map(\.title).joined(separator: " ")
            return Doc(card: card, text: text, fields: [(Self.terms(card.title), 3), (Self.terms(text), 1), (Self.terms(tags), 2)])
        }
    }

    static func distance(_ a: [Character], _ b: [Character], limit: Int) -> Int {
        if abs(a.count - b.count) > limit { return limit + 1 }
        var prev = Array(0...b.count)
        for i in 1...max(1, a.count) where !a.isEmpty {
            var row = [i] + Array(repeating: 0, count: b.count)
            var best = row[0]
            for j in stride(from: 1, through: b.count, by: 1) {
                row[j] = min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
                best = min(best, row[j])
            }
            if best > limit { return limit + 1 }
            prev = row
        }
        return prev[b.count]
    }

    /// How well one typed word matches a field's words: whole, by their start, or within a small typo.
    static func match(_ query: String, in terms: Set<String>) -> Double {
        if terms.contains(query) { return 1 }
        var best = 0.0
        let fuzz = Int((Double(query.count) * 0.15).rounded())
        let q = Array(query)
        for term in terms {
            if term.hasPrefix(query) {
                best = max(best, 0.375 * Double(query.count) / Double(term.count) + 0.25)
            } else if fuzz > 0, distance(q, Array(term), limit: fuzz) <= fuzz {
                best = max(best, 0.2)
            }
        }
        return best
    }

    public func search(_ query: String) -> [Hit] {
        let words = Self.tokenize(query).map { $0.lowercased() }
        guard !words.isEmpty else { return [] }
        var scored: [(Hit, Double)] = []
        for doc in docs {
            var score = 0.0
            var all = true
            var found: [String] = []
            for word in words {
                let s = doc.fields.map { Self.match(word, in: $0.terms) * $0.boost }.reduce(0, +)
                if s == 0 {
                    all = false
                    break
                }
                score += s
                found.append(word)
            }
            if all { scored.append((Hit(card: doc.card, snippet: Self.snippet(doc.text, found)), score)) }
        }
        return scored.sorted { $0.1 > $1.1 }.map(\.0)
    }

    static func snippet(_ text: String, _ terms: [String], width: Int = 140) -> String {
        let lower = text.lowercased()
        let at = terms.compactMap { lower.range(of: $0).map { lower.distance(from: lower.startIndex, to: $0.lowerBound) } }.min() ?? 0
        let start = max(0, at - 40)
        let chars = Array(text)
        let end = min(chars.count, start + width)
        let body = start < chars.count ? String(chars[start..<end]) : ""
        return (start > 0 ? "…" : "") + body + (end < chars.count ? "…" : "")
    }
}
