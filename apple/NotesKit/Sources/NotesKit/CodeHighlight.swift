import Foundation

/// Lightweight syntax tokenizer for code blocks, matching the web app's `codeLanguages.ts` and `styles.css`
/// `--code-*` token roles (`keyword`, `string`, `number`, `comment`, `title`, `type`, `meta`).
public enum CodeHighlight {
    public enum Role: String, Sendable, Hashable {
        case keyword, string, number, comment, title, type, meta, plain
    }

    public struct Token: Sendable, Hashable {
        public var text: String
        public var role: Role
        public init(_ text: String, _ role: Role) {
            self.text = text
            self.role = role
        }
    }

    private struct LangMeta {
        let id: String
        let label: String
        let aliases: [String]
    }

    private static let languages: [LangMeta] = [
        .init(id: "c", label: "C", aliases: ["h"]),
        .init(id: "csharp", label: "C#", aliases: ["cs", "c#"]),
        .init(id: "cpp", label: "C++", aliases: ["c++", "cc", "hpp", "cxx"]),
        .init(id: "css", label: "CSS", aliases: []),
        .init(id: "diff", label: "Diff", aliases: ["patch"]),
        .init(id: "go", label: "Go", aliases: ["golang"]),
        .init(id: "graphql", label: "GraphQL", aliases: ["gql"]),
        .init(id: "html", label: "HTML", aliases: ["xhtml"]),
        .init(id: "java", label: "Java", aliases: []),
        .init(id: "javascript", label: "JavaScript", aliases: ["js", "jsx", "mjs", "cjs"]),
        .init(id: "json", label: "JSON", aliases: ["jsonc"]),
        .init(id: "kotlin", label: "Kotlin", aliases: ["kt", "kts"]),
        .init(id: "lua", label: "Lua", aliases: []),
        .init(id: "markdown", label: "Markdown", aliases: ["md"]),
        .init(id: "php", label: "PHP", aliases: []),
        .init(id: "plaintext", label: "Plain text", aliases: ["text", "txt", "plain"]),
        .init(id: "python", label: "Python", aliases: ["py"]),
        .init(id: "r", label: "R", aliases: []),
        .init(id: "ruby", label: "Ruby", aliases: ["rb"]),
        .init(id: "rust", label: "Rust", aliases: ["rs"]),
        .init(id: "bash", label: "Shell", aliases: ["sh", "shell", "zsh", "console"]),
        .init(id: "sql", label: "SQL", aliases: []),
        .init(id: "swift", label: "Swift", aliases: []),
        .init(id: "typescript", label: "TypeScript", aliases: ["ts", "tsx", "mts"]),
        .init(id: "xml", label: "XML", aliases: ["svg"]),
        .init(id: "yaml", label: "YAML", aliases: ["yml"]),
    ]

    /// Canonical highlight language id (e.g. `"js"` -> `"javascript"`), or nil when unknown or absent.
    public static func canonicalLanguage(_ language: String?) -> String? {
        guard let raw = language?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !raw.isEmpty else { return nil }
        return languages.first { $0.id == raw || $0.aliases.contains(raw) }?.id
    }

    /// Display label for a code block's language, as the web app's `languageLabel`.
    public static func languageLabel(_ language: String?) -> String? {
        guard let trimmed = language?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        let lower = trimmed.lowercased()
        return languages.first { $0.id == lower || $0.aliases.contains(lower) }?.label ?? trimmed
    }

    /// Splits `code` into adjacent colored tokens for `language` (or a generic code pass when `language` is nil).
    public static func tokenize(_ code: String, language: String?) -> [Token] {
        guard !code.isEmpty else { return [] }
        let lang = canonicalLanguage(language)
        if lang == "plaintext" { return [Token(code, .plain)] }
        if language == nil && code.count > 4000 { return [Token(code, .plain)] }
        let raw: [Token]
        switch lang {
        case "diff": raw = tokenizeDiff(code)
        case "json": raw = tokenizeJson(code)
        case "yaml": raw = tokenizeYaml(code)
        case "html", "xml": raw = tokenizeMarkup(code)
        case "css": raw = tokenizeCss(code)
        case "markdown": raw = tokenizeMarkdown(code)
        case "sql": raw = tokenizeSql(code)
        default: raw = tokenizeGeneral(code, lang: lang)
        }
        return coalesce(raw)
    }

    private static func coalesce(_ tokens: [Token]) -> [Token] {
        var out: [Token] = []
        out.reserveCapacity(tokens.count)
        for t in tokens where !t.text.isEmpty {
            if let last = out.last, last.role == t.role {
                out[out.count - 1].text += t.text
            } else {
                out.append(t)
            }
        }
        return out
    }

    private static func tokenizeDiff(_ code: String) -> [Token] {
        var out: [Token] = []
        let lines = code.split(separator: "\n", omittingEmptySubsequences: false)
        for (i, sub) in lines.enumerated() {
            let line = String(sub)
            let role: Role
            if line.hasPrefix("+++") || line.hasPrefix("---") || line.hasPrefix("diff ") || line.hasPrefix("index ") {
                role = .meta
            } else if line.hasPrefix("@@") {
                role = .title
            } else if line.hasPrefix("+") {
                role = .string
            } else if line.hasPrefix("-") {
                role = .meta
            } else {
                role = .plain
            }
            out.append(Token(i + 1 < lines.count ? line + "\n" : line, role))
        }
        return out
    }

    private static func tokenizeJson(_ code: String) -> [Token] {
        let chars = Array(code)
        var i = 0
        var out: [Token] = []
        while i < chars.count {
            let c = chars[i]
            if c == "/" && i + 1 < chars.count && chars[i + 1] == "/" {
                let start = i
                while i < chars.count && chars[i] != "\n" { i += 1 }
                out.append(Token(String(chars[start..<i]), .comment))
            } else if c == "/" && i + 1 < chars.count && chars[i + 1] == "*" {
                let start = i; i += 2
                while i + 1 < chars.count && !(chars[i] == "*" && chars[i + 1] == "/") { i += 1 }
                i = min(chars.count, i + 2)
                out.append(Token(String(chars[start..<i]), .comment))
            } else if c == "\"" {
                let start = i
                i = scanQuoted(chars, from: i, quote: "\"")
                var j = i
                while j < chars.count && (chars[j] == " " || chars[j] == "\t") { j += 1 }
                let isKey = j < chars.count && chars[j] == ":"
                out.append(Token(String(chars[start..<i]), isKey ? .type : .string))
            } else if c == "-" && i + 1 < chars.count && chars[i + 1].isNumber || c.isNumber {
                let start = i
                if chars[i] == "-" { i += 1 }
                i = scanNumber(chars, from: i)
                out.append(Token(String(chars[start..<i]), .number))
            } else if c.isLetter {
                let start = i
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "_") { i += 1 }
                let word = String(chars[start..<i])
                let role: Role = (word == "true" || word == "false" || word == "null") ? .number : .plain
                out.append(Token(word, role))
            } else {
                out.append(Token(String(c), .plain))
                i += 1
            }
        }
        return out
    }

    private static func tokenizeYaml(_ code: String) -> [Token] {
        var out: [Token] = []
        let lines = code.split(separator: "\n", omittingEmptySubsequences: false)
        for (idx, sub) in lines.enumerated() {
            let line = String(sub)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#") {
                out.append(Token(line, .comment))
            } else if trimmed == "---" || trimmed == "..." {
                out.append(Token(line, .meta))
            } else if let colon = line.firstIndex(of: ":"), !trimmed.hasPrefix("\"") && !trimmed.hasPrefix("'") {
                let keyPart = String(line[..<colon])
                let rest = String(line[colon...])
                out.append(Token(keyPart, .type))
                out.append(contentsOf: tokenizeYamlValue(rest))
            } else {
                out.append(contentsOf: tokenizeYamlValue(line))
            }
            if idx + 1 < lines.count { out.append(Token("\n", .plain)) }
        }
        return out
    }

    private static func tokenizeYamlValue(_ s: String) -> [Token] {
        let chars = Array(s)
        var i = 0
        var out: [Token] = []
        while i < chars.count {
            let c = chars[i]
            if c == "#" && (i == 0 || chars[i - 1] == " " || chars[i - 1] == "\t") {
                out.append(Token(String(chars[i...]), .comment))
                break
            } else if c == "\"" || c == "'" {
                let start = i
                i = scanQuoted(chars, from: i, quote: c)
                out.append(Token(String(chars[start..<i]), .string))
            } else if c.isNumber && (i == 0 || !chars[i - 1].isLetter) {
                let start = i
                i = scanNumber(chars, from: i)
                out.append(Token(String(chars[start..<i]), .number))
            } else if c.isLetter {
                let start = i
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "_" || chars[i] == "-") { i += 1 }
                let word = String(chars[start..<i])
                let lower = word.lowercased()
                let role: Role = (lower == "true" || lower == "false" || lower == "null" || lower == "yes" || lower == "no") ? .number : .plain
                out.append(Token(word, role))
            } else {
                out.append(Token(String(c), .plain))
                i += 1
            }
        }
        return out
    }

    private static func tokenizeMarkup(_ code: String) -> [Token] {
        let chars = Array(code)
        var i = 0
        var out: [Token] = []
        while i < chars.count {
            if chars[i] == "<" {
                if startsWith(chars, at: i, "<!--") {
                    let start = i; i += 4
                    while i < chars.count && !startsWith(chars, at: i, "-->") { i += 1 }
                    i = min(chars.count, i + 3)
                    out.append(Token(String(chars[start..<i]), .comment))
                    continue
                }
                if startsWith(chars, at: i, "<!") || startsWith(chars, at: i, "<?") {
                    let start = i
                    while i < chars.count && chars[i] != ">" { i += 1 }
                    if i < chars.count { i += 1 }
                    out.append(Token(String(chars[start..<i]), .meta))
                    continue
                }
                // Opening or closing tag
                out.append(Token("<", .meta))
                i += 1
                if i < chars.count && chars[i] == "/" {
                    out.append(Token("/", .meta))
                    i += 1
                }
                let nameStart = i
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "-" || chars[i] == ":" || chars[i] == "_") { i += 1 }
                if i > nameStart { out.append(Token(String(chars[nameStart..<i]), .title)) }
                while i < chars.count && chars[i] != ">" {
                    let c = chars[i]
                    if c == "\"" || c == "'" {
                        let start = i
                        i = scanQuoted(chars, from: i, quote: c)
                        out.append(Token(String(chars[start..<i]), .string))
                    } else if c == "/" && i + 1 < chars.count && chars[i + 1] == ">" {
                        out.append(Token("/>", .meta))
                        i += 2
                        break
                    } else if c.isLetter || c == "_" || c == ":" {
                        let start = i
                        while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "-" || chars[i] == ":" || chars[i] == "_") { i += 1 }
                        out.append(Token(String(chars[start..<i]), .type))
                    } else {
                        out.append(Token(String(c), .plain))
                        i += 1
                    }
                }
                if i < chars.count && chars[i] == ">" {
                    out.append(Token(">", .meta))
                    i += 1
                }
            } else {
                let start = i
                while i < chars.count && chars[i] != "<" { i += 1 }
                out.append(Token(String(chars[start..<i]), .plain))
            }
        }
        return out
    }

    private static func tokenizeCss(_ code: String) -> [Token] {
        let chars = Array(code)
        var i = 0
        var inBlock = false
        var out: [Token] = []
        while i < chars.count {
            let c = chars[i]
            if c == "/" && i + 1 < chars.count && chars[i + 1] == "*" {
                let start = i; i += 2
                while i + 1 < chars.count && !(chars[i] == "*" && chars[i + 1] == "/") { i += 1 }
                i = min(chars.count, i + 2)
                out.append(Token(String(chars[start..<i]), .comment))
            } else if c == "\"" || c == "'" {
                let start = i
                i = scanQuoted(chars, from: i, quote: c)
                out.append(Token(String(chars[start..<i]), .string))
            } else if c == "{" {
                inBlock = true; out.append(Token("{", .plain)); i += 1
            } else if c == "}" {
                inBlock = false; out.append(Token("}", .plain)); i += 1
            } else if c == "@" {
                let start = i; i += 1
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "-") { i += 1 }
                out.append(Token(String(chars[start..<i]), .keyword))
            } else if c == "#" {
                let start = i; i += 1
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "-" || chars[i] == "_") { i += 1 }
                out.append(Token(String(chars[start..<i]), inBlock ? .number : .title))
            } else if c == "." && !inBlock && i + 1 < chars.count && chars[i + 1].isLetter {
                let start = i; i += 1
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "-" || chars[i] == "_") { i += 1 }
                out.append(Token(String(chars[start..<i]), .title))
            } else if c == "!" {
                let start = i; i += 1
                while i < chars.count && chars[i].isLetter { i += 1 }
                out.append(Token(String(chars[start..<i]), .meta))
            } else if c.isNumber {
                let start = i
                i = scanNumber(chars, from: i)
                while i < chars.count && (chars[i].isLetter || chars[i] == "%") { i += 1 }
                out.append(Token(String(chars[start..<i]), .number))
            } else if c.isLetter || c == "-" {
                let start = i
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "-" || chars[i] == "_") { i += 1 }
                let word = String(chars[start..<i])
                var j = i
                while j < chars.count && (chars[j] == " " || chars[j] == "\t") { j += 1 }
                let role: Role = (inBlock && j < chars.count && chars[j] == ":") ? .type : (!inBlock ? .keyword : .plain)
                out.append(Token(word, role))
            } else {
                out.append(Token(String(c), .plain))
                i += 1
            }
        }
        return out
    }

    private static func tokenizeMarkdown(_ code: String) -> [Token] {
        var out: [Token] = []
        let lines = code.split(separator: "\n", omittingEmptySubsequences: false)
        for (idx, sub) in lines.enumerated() {
            let line = String(sub)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#") {
                out.append(Token(line, .title))
            } else if trimmed.hasPrefix(">") {
                out.append(Token(line, .comment))
            } else if trimmed.hasPrefix("```") {
                out.append(Token(line, .meta))
            } else {
                let chars = Array(line)
                var i = 0
                while i < chars.count {
                    if chars[i] == "`" {
                        let start = i; i += 1
                        while i < chars.count && chars[i] != "`" { i += 1 }
                        if i < chars.count { i += 1 }
                        out.append(Token(String(chars[start..<i]), .string))
                    } else if chars[i] == "[" {
                        let start = i
                        while i < chars.count && chars[i] != "]" { i += 1 }
                        if i < chars.count { i += 1 }
                        if i < chars.count && chars[i] == "(" {
                            while i < chars.count && chars[i] != ")" { i += 1 }
                            if i < chars.count { i += 1 }
                            out.append(Token(String(chars[start..<i]), .meta))
                        } else {
                            out.append(Token(String(chars[start..<i]), .plain))
                        }
                    } else {
                        out.append(Token(String(chars[i]), .plain))
                        i += 1
                    }
                }
            }
            if idx + 1 < lines.count { out.append(Token("\n", .plain)) }
        }
        return out
    }

    private static let sqlKeywords: Set<String> = [
        "select", "from", "where", "join", "inner", "left", "right", "outer", "full", "cross", "on",
        "insert", "into", "values", "update", "set", "delete", "create", "alter", "drop", "table",
        "index", "view", "trigger", "if", "not", "exists", "primary", "key", "foreign", "references",
        "unique", "default", "null", "is", "in", "like", "between", "and", "or", "as", "distinct",
        "order", "by", "asc", "desc", "group", "having", "limit", "offset", "union", "all", "case",
        "when", "then", "else", "end", "with", "returning", "begin", "commit", "rollback", "replace",
        "conflict", "do", "nothing", "true", "false", "count", "sum", "avg", "min", "max", "coalesce",
    ]

    private static func tokenizeSql(_ code: String) -> [Token] {
        let chars = Array(code)
        var i = 0
        var out: [Token] = []
        while i < chars.count {
            let c = chars[i]
            if c == "-" && i + 1 < chars.count && chars[i + 1] == "-" {
                let start = i
                while i < chars.count && chars[i] != "\n" { i += 1 }
                out.append(Token(String(chars[start..<i]), .comment))
            } else if c == "/" && i + 1 < chars.count && chars[i + 1] == "*" {
                let start = i; i += 2
                while i + 1 < chars.count && !(chars[i] == "*" && chars[i + 1] == "/") { i += 1 }
                i = min(chars.count, i + 2)
                out.append(Token(String(chars[start..<i]), .comment))
            } else if c == "'" || c == "\"" {
                let start = i
                i = scanQuoted(chars, from: i, quote: c)
                out.append(Token(String(chars[start..<i]), .string))
            } else if c.isNumber {
                let start = i
                i = scanNumber(chars, from: i)
                out.append(Token(String(chars[start..<i]), .number))
            } else if c.isLetter || c == "_" {
                let start = i
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "_") { i += 1 }
                let word = String(chars[start..<i])
                let lower = word.lowercased()
                let role: Role = (lower == "true" || lower == "false" || lower == "null") ? .number : (sqlKeywords.contains(lower) ? .keyword : .plain)
                out.append(Token(word, role))
            } else {
                out.append(Token(String(c), .plain))
                i += 1
            }
        }
        return out
    }

    private static let hashCommentLangs: Set<String> = ["python", "ruby", "bash", "r", "graphql", "php"]
    private static let slashCommentLangs: Set<String> = [
        "c", "cpp", "csharp", "go", "java", "javascript", "kotlin", "php", "rust", "swift", "typescript",
    ]
    private static let funcIntroducers: Set<String> = ["func", "fn", "fun", "def", "function", "sub"]
    private static let typeIntroducers: Set<String> = ["class", "struct", "enum", "interface", "protocol", "trait", "type", "record", "object"]

    private static let commonKeywords: Set<String> = [
        "if", "else", "elif", "elsif", "for", "while", "do", "loop", "break", "continue", "return", "yield",
        "switch", "case", "default", "match", "when", "try", "catch", "except", "finally", "throw", "throws",
        "raise", "defer", "guard", "where", "in", "of", "as", "is", "not", "and", "or", "new", "delete",
        "import", "export", "from", "package", "module", "use", "using", "include", "require", "namespace",
        "class", "struct", "enum", "interface", "protocol", "trait", "impl", "extension", "extends", "implements",
        "type", "typedef", "typealias", "record", "object", "data", "sealed", "open", "abstract", "override",
        "func", "fn", "fun", "def", "function", "lambda", "async", "await", "suspend", "coroutine",
        "let", "var", "val", "const", "mut", "static", "final", "readonly", "public", "private", "protected",
        "internal", "fileprivate", "pub", "extern", "unsafe", "inline", "virtual", "explicit", "volatile",
        "this", "self", "Self", "super", "init", "deinit", "get", "set", "with", "pass", "global", "nonlocal",
        "go", "chan", "select", "range", "fallthrough", "ref", "out", "params", "sizeof", "typeof", "instanceof",
        "then", "fi", "esac", "done", "local", "echo", "export", "end", "begin", "rescue", "ensure", "until",
        "query", "mutation", "subscription", "fragment", "scalar", "input", "union", "schema",
    ]

    private static let literals: Set<String> = [
        "true", "false", "nil", "null", "None", "True", "False", "undefined", "NaN", "Infinity",
    ]

    private static let primitiveTypes: Set<String> = [
        "void", "bool", "boolean", "byte", "char", "short", "int", "long", "float", "double", "string", "str",
        "number", "any", "never", "unknown", "object", "usize", "isize", "u8", "u16", "u32", "u64", "u128",
        "i8", "i16", "i32", "i64", "i128", "f32", "f64", "int8", "int16", "int32", "int64", "uint", "uint8",
        "uint16", "uint32", "uint64", "rune", "error", "size_t", "auto",
    ]

    private static func tokenizeGeneral(_ code: String, lang: String?) -> [Token] {
        let chars = Array(code)
        let allowSlash = lang == nil || slashCommentLangs.contains(lang!)
        let allowHash = lang == nil || hashCommentLangs.contains(lang!)
        let isCPreproc = lang == "c" || lang == "cpp" || lang == "csharp"
        let isLua = lang == "lua"
        var i = 0
        var expectTitle = false
        var expectType = false
        var out: [Token] = []

        while i < chars.count {
            let c = chars[i]

            // Line comments
            if allowSlash && c == "/" && i + 1 < chars.count && chars[i + 1] == "/" {
                let start = i
                while i < chars.count && chars[i] != "\n" { i += 1 }
                out.append(Token(String(chars[start..<i]), .comment))
                continue
            }
            if isLua && c == "-" && i + 1 < chars.count && chars[i + 1] == "-" {
                let start = i
                if startsWith(chars, at: i, "--[[") {
                    i += 4
                    while i < chars.count && !startsWith(chars, at: i, "]]") { i += 1 }
                    i = min(chars.count, i + 2)
                } else {
                    while i < chars.count && chars[i] != "\n" { i += 1 }
                }
                out.append(Token(String(chars[start..<i]), .comment))
                continue
            }
            if allowHash && c == "#" {
                let start = i
                while i < chars.count && chars[i] != "\n" { i += 1 }
                out.append(Token(String(chars[start..<i]), .comment))
                continue
            }
            // Block comments
            if allowSlash && c == "/" && i + 1 < chars.count && chars[i + 1] == "*" {
                let start = i; i += 2
                while i + 1 < chars.count && !(chars[i] == "*" && chars[i + 1] == "/") { i += 1 }
                i = min(chars.count, i + 2)
                out.append(Token(String(chars[start..<i]), .comment))
                continue
            }
            // Preprocessor / attributes (`#include`, `#[derive(...)]`, `@MainActor`)
            if isCPreproc && c == "#" {
                let start = i; i += 1
                while i < chars.count && (chars[i].isLetter || chars[i] == "_") { i += 1 }
                out.append(Token(String(chars[start..<i]), .meta))
                continue
            }
            if lang == "rust" && c == "#" && i + 1 < chars.count && (chars[i + 1] == "[" || chars[i + 1] == "!") {
                let start = i
                while i < chars.count && chars[i] != "]" && chars[i] != "\n" { i += 1 }
                if i < chars.count && chars[i] == "]" { i += 1 }
                out.append(Token(String(chars[start..<i]), .meta))
                continue
            }
            if c == "@" && i + 1 < chars.count && (chars[i + 1].isLetter || chars[i + 1] == "_") {
                let start = i; i += 1
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "_") { i += 1 }
                out.append(Token(String(chars[start..<i]), .meta))
                continue
            }
            // Triple-quoted strings (`"""` or `'''`)
            if (c == "\"" || c == "'") && i + 2 < chars.count && chars[i + 1] == c && chars[i + 2] == c {
                let start = i; i += 3
                while i + 2 < chars.count && !(chars[i] == c && chars[i + 1] == c && chars[i + 2] == c) {
                    if chars[i] == "\\" { i += 2 } else { i += 1 }
                }
                i = min(chars.count, i + 3)
                out.append(Token(String(chars[start..<i]), .string))
                expectTitle = false; expectType = false
                continue
            }
            // Strings (skip Rust lifetimes like `'a` when single quote isn't closed on same char)
            if c == "\"" || c == "`" || (c == "'" && !(lang == "rust" && isRustLifetime(chars, at: i))) {
                let start = i
                i = scanQuoted(chars, from: i, quote: c)
                out.append(Token(String(chars[start..<i]), .string))
                expectTitle = false; expectType = false
                continue
            }
            // Numbers
            if c.isNumber && (i == 0 || !(chars[i - 1].isLetter || chars[i - 1] == "_")) {
                let start = i
                i = scanNumber(chars, from: i)
                out.append(Token(String(chars[start..<i]), .number))
                expectTitle = false; expectType = false
                continue
            }
            // Identifiers / keywords / types / titles
            if c.isLetter || c == "_" || (lang == "php" && c == "$") {
                let start = i
                if c == "$" { i += 1 }
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "_") { i += 1 }
                let word = String(chars[start..<i])
                let role: Role
                if expectTitle {
                    role = .title
                    expectTitle = false
                } else if expectType {
                    role = .type
                    expectType = false
                } else if literals.contains(word) {
                    role = .number
                } else if commonKeywords.contains(word) {
                    role = .keyword
                    expectTitle = funcIntroducers.contains(word)
                    expectType = typeIntroducers.contains(word)
                } else if primitiveTypes.contains(word) {
                    role = .type
                } else if isPascalType(word) {
                    role = .type
                } else {
                    role = .plain
                }
                out.append(Token(word, role))
                continue
            }

            if c != " " && c != "\t" {
                expectTitle = false
                expectType = false
            }
            out.append(Token(String(c), .plain))
            i += 1
        }
        return out
    }

    private static func isPascalType(_ word: String) -> Bool {
        guard let first = word.first, first.isUppercase, word.count >= 2 else { return false }
        return word.dropFirst().contains { $0.isLowercase }
    }

    private static func isRustLifetime(_ chars: [Character], at i: Int) -> Bool {
        guard i + 1 < chars.count, chars[i + 1].isLetter || chars[i + 1] == "_" else { return false }
        var j = i + 2
        while j < chars.count && (chars[j].isLetter || chars[j].isNumber || chars[j] == "_") { j += 1 }
        return j >= chars.count || chars[j] != "'"
    }

    private static func scanQuoted(_ chars: [Character], from start: Int, quote: Character) -> Int {
        var i = start + 1
        while i < chars.count {
            let c = chars[i]
            if c == "\\" && i + 1 < chars.count {
                i += 2
            } else if c == quote {
                return i + 1
            } else if c == "\n" && quote != "`" {
                return i
            } else {
                i += 1
            }
        }
        return i
    }

    private static func scanNumber(_ chars: [Character], from start: Int) -> Int {
        var i = start
        if i + 1 < chars.count && chars[i] == "0" && (chars[i + 1] == "x" || chars[i + 1] == "X" || chars[i + 1] == "b" || chars[i + 1] == "B" || chars[i + 1] == "o" || chars[i + 1] == "O") {
            i += 2
            while i < chars.count && (chars[i].isHexDigit || chars[i] == "_") { i += 1 }
            return i
        }
        while i < chars.count && (chars[i].isNumber || chars[i] == "_") { i += 1 }
        if i + 1 < chars.count && chars[i] == "." && chars[i + 1].isNumber {
            i += 1
            while i < chars.count && (chars[i].isNumber || chars[i] == "_") { i += 1 }
        }
        if i < chars.count && (chars[i] == "e" || chars[i] == "E") {
            var j = i + 1
            if j < chars.count && (chars[j] == "+" || chars[j] == "-") { j += 1 }
            if j < chars.count && chars[j].isNumber {
                i = j
                while i < chars.count && (chars[i].isNumber || chars[i] == "_") { i += 1 }
            }
        }
        return i
    }

    private static func startsWith(_ chars: [Character], at i: Int, _ target: String) -> Bool {
        let t = Array(target)
        guard i + t.count <= chars.count else { return false }
        for k in 0..<t.count where chars[i + k] != t[k] { return false }
        return true
    }
}
