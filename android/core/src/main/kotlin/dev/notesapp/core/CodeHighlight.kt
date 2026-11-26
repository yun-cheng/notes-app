package dev.notesapp.core

/**
 * Lightweight syntax tokenizer for code blocks, matching the web app's `codeLanguages.ts` and `styles.css`
 * `--code-*` token roles (`keyword`, `string`, `number`, `comment`, `title`, `type`, `meta`).
 */
object CodeHighlight {
    enum class Role { KEYWORD, STRING, NUMBER, COMMENT, TITLE, TYPE, META, PLAIN }
    data class Token(val text: String, val role: Role)

    private data class LangMeta(val id: String, val label: String, val aliases: List<String> = emptyList())

    private val languages = listOf(
        LangMeta("c", "C", listOf("h")),
        LangMeta("csharp", "C#", listOf("cs", "c#")),
        LangMeta("cpp", "C++", listOf("c++", "cc", "hpp", "cxx")),
        LangMeta("css", "CSS"),
        LangMeta("diff", "Diff", listOf("patch")),
        LangMeta("go", "Go", listOf("golang")),
        LangMeta("graphql", "GraphQL", listOf("gql")),
        LangMeta("html", "HTML", listOf("xhtml")),
        LangMeta("java", "Java"),
        LangMeta("javascript", "JavaScript", listOf("js", "jsx", "mjs", "cjs")),
        LangMeta("json", "JSON", listOf("jsonc")),
        LangMeta("kotlin", "Kotlin", listOf("kt", "kts")),
        LangMeta("lua", "Lua"),
        LangMeta("markdown", "Markdown", listOf("md")),
        LangMeta("php", "PHP"),
        LangMeta("plaintext", "Plain text", listOf("text", "txt", "plain")),
        LangMeta("python", "Python", listOf("py")),
        LangMeta("r", "R"),
        LangMeta("ruby", "Ruby", listOf("rb")),
        LangMeta("rust", "Rust", listOf("rs")),
        LangMeta("bash", "Shell", listOf("sh", "shell", "zsh", "console")),
        LangMeta("sql", "SQL"),
        LangMeta("swift", "Swift"),
        LangMeta("typescript", "TypeScript", listOf("ts", "tsx", "mts")),
        LangMeta("xml", "XML", listOf("svg")),
        LangMeta("yaml", "YAML", listOf("yml")),
    )

    /** Canonical highlight language id (e.g. `"js"` -> `"javascript"`), or null when unknown or absent. */
    fun canonicalLanguage(language: String?): String? {
        val raw = language?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        return languages.firstOrNull { it.id == raw || raw in it.aliases }?.id
    }

    /** Display label for a code block's language, as the web app's `languageLabel`. */
    fun languageLabel(language: String?): String? {
        val trimmed = language?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val lower = trimmed.lowercase()
        return languages.firstOrNull { it.id == lower || lower in it.aliases }?.label ?: trimmed
    }

    /** Splits `code` into adjacent colored tokens for `language` (or a generic code pass when `language` is null). */
    fun tokenize(code: String, language: String?): List<Token> {
        if (code.isEmpty()) return emptyList()
        val lang = canonicalLanguage(language)
        if (lang == "plaintext") return listOf(Token(code, Role.PLAIN))
        if (language == null && code.length > 4000) return listOf(Token(code, Role.PLAIN))
        val raw = when (lang) {
            "diff" -> tokenizeDiff(code)
            "json" -> tokenizeJson(code)
            "yaml" -> tokenizeYaml(code)
            "html", "xml" -> tokenizeMarkup(code)
            "css" -> tokenizeCss(code)
            "markdown" -> tokenizeMarkdown(code)
            "sql" -> tokenizeSql(code)
            else -> tokenizeGeneral(code, lang)
        }
        return coalesce(raw)
    }

    private fun coalesce(tokens: List<Token>): List<Token> {
        val out = ArrayList<Token>(tokens.size)
        for (t in tokens) {
            if (t.text.isEmpty()) continue
            val last = out.lastOrNull()
            if (last != null && last.role == t.role) out[out.lastIndex] = Token(last.text + t.text, last.role)
            else out.add(t)
        }
        return out
    }

    private fun tokenizeDiff(code: String): List<Token> {
        val lines = code.split("\n")
        val out = ArrayList<Token>(lines.size)
        for ((i, line) in lines.withIndex()) {
            val role = when {
                line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") -> Role.META
                line.startsWith("@@") -> Role.TITLE
                line.startsWith("+") -> Role.STRING
                line.startsWith("-") -> Role.META
                else -> Role.PLAIN
            }
            out.add(Token(if (i + 1 < lines.size) "$line\n" else line, role))
        }
        return out
    }

    private fun tokenizeJson(code: String): List<Token> {
        val out = mutableListOf<Token>()
        var i = 0
        while (i < code.length) {
            val c = code[i]
            when {
                c == '/' && i + 1 < code.length && code[i + 1] == '/' -> {
                    val start = i
                    while (i < code.length && code[i] != '\n') i++
                    out.add(Token(code.substring(start, i), Role.COMMENT))
                }
                c == '/' && i + 1 < code.length && code[i + 1] == '*' -> {
                    val start = i; i += 2
                    while (i + 1 < code.length && !(code[i] == '*' && code[i + 1] == '/')) i++
                    i = minOf(code.length, i + 2)
                    out.add(Token(code.substring(start, i), Role.COMMENT))
                }
                c == '"' -> {
                    val start = i
                    i = scanQuoted(code, i, '"')
                    var j = i
                    while (j < code.length && (code[j] == ' ' || code[j] == '\t')) j++
                    val isKey = j < code.length && code[j] == ':'
                    out.add(Token(code.substring(start, i), if (isKey) Role.TYPE else Role.STRING))
                }
                (c == '-' && i + 1 < code.length && code[i + 1].isDigit()) || c.isDigit() -> {
                    val start = i
                    if (code[i] == '-') i++
                    i = scanNumber(code, i)
                    out.add(Token(code.substring(start, i), Role.NUMBER))
                }
                c.isLetter() -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    val word = code.substring(start, i)
                    out.add(Token(word, if (word == "true" || word == "false" || word == "null") Role.NUMBER else Role.PLAIN))
                }
                else -> { out.add(Token(c.toString(), Role.PLAIN)); i++ }
            }
        }
        return out
    }

    private fun tokenizeYaml(code: String): List<Token> {
        val out = mutableListOf<Token>()
        val lines = code.split("\n")
        for ((idx, line) in lines.withIndex()) {
            val trimmed = line.trim()
            val colon = line.indexOf(':')
            when {
                trimmed.startsWith("#") -> out.add(Token(line, Role.COMMENT))
                trimmed == "---" || trimmed == "..." -> out.add(Token(line, Role.META))
                colon >= 0 && !trimmed.startsWith("\"") && !trimmed.startsWith("'") -> {
                    out.add(Token(line.substring(0, colon), Role.TYPE))
                    out.addAll(tokenizeYamlValue(line.substring(colon)))
                }
                else -> out.addAll(tokenizeYamlValue(line))
            }
            if (idx + 1 < lines.size) out.add(Token("\n", Role.PLAIN))
        }
        return out
    }

    private fun tokenizeYamlValue(s: String): List<Token> {
        val out = mutableListOf<Token>()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '#' && (i == 0 || s[i - 1] == ' ' || s[i - 1] == '\t') -> {
                    out.add(Token(s.substring(i), Role.COMMENT)); break
                }
                c == '"' || c == '\'' -> {
                    val start = i; i = scanQuoted(s, i, c)
                    out.add(Token(s.substring(start, i), Role.STRING))
                }
                c.isDigit() && (i == 0 || !s[i - 1].isLetter()) -> {
                    val start = i; i = scanNumber(s, i)
                    out.add(Token(s.substring(start, i), Role.NUMBER))
                }
                c.isLetter() -> {
                    val start = i
                    while (i < s.length && (s[i].isLetterOrDigit() || s[i] == '_' || s[i] == '-')) i++
                    val word = s.substring(start, i)
                    val lower = word.lowercase()
                    val role = if (lower in setOf("true", "false", "null", "yes", "no")) Role.NUMBER else Role.PLAIN
                    out.add(Token(word, role))
                }
                else -> { out.add(Token(c.toString(), Role.PLAIN)); i++ }
            }
        }
        return out
    }

    private fun tokenizeMarkup(code: String): List<Token> {
        val out = mutableListOf<Token>()
        var i = 0
        while (i < code.length) {
            if (code[i] == '<') {
                if (code.startsWith("<!--", i)) {
                    val start = i; i += 4
                    while (i < code.length && !code.startsWith("-->", i)) i++
                    i = minOf(code.length, i + 3)
                    out.add(Token(code.substring(start, i), Role.COMMENT))
                    continue
                }
                if (code.startsWith("<!", i) || code.startsWith("<?", i)) {
                    val start = i
                    while (i < code.length && code[i] != '>') i++
                    if (i < code.length) i++
                    out.add(Token(code.substring(start, i), Role.META))
                    continue
                }
                out.add(Token("<", Role.META)); i++
                if (i < code.length && code[i] == '/') { out.add(Token("/", Role.META)); i++ }
                val nameStart = i
                while (i < code.length && (code[i].isLetterOrDigit() || code[i] in "-:_")) i++
                if (i > nameStart) out.add(Token(code.substring(nameStart, i), Role.TITLE))
                while (i < code.length && code[i] != '>') {
                    val c = code[i]
                    when {
                        c == '"' || c == '\'' -> {
                            val start = i; i = scanQuoted(code, i, c)
                            out.add(Token(code.substring(start, i), Role.STRING))
                        }
                        c == '/' && i + 1 < code.length && code[i + 1] == '>' -> {
                            out.add(Token("/>", Role.META)); i += 2; break
                        }
                        c.isLetter() || c == '_' || c == ':' -> {
                            val start = i
                            while (i < code.length && (code[i].isLetterOrDigit() || code[i] in "-:_")) i++
                            out.add(Token(code.substring(start, i), Role.TYPE))
                        }
                        else -> { out.add(Token(c.toString(), Role.PLAIN)); i++ }
                    }
                }
                if (i < code.length && code[i] == '>') { out.add(Token(">", Role.META)); i++ }
            } else {
                val start = i
                while (i < code.length && code[i] != '<') i++
                out.add(Token(code.substring(start, i), Role.PLAIN))
            }
        }
        return out
    }

    private fun tokenizeCss(code: String): List<Token> {
        val out = mutableListOf<Token>()
        var i = 0
        var inBlock = false
        while (i < code.length) {
            val c = code[i]
            when {
                c == '/' && i + 1 < code.length && code[i + 1] == '*' -> {
                    val start = i; i += 2
                    while (i + 1 < code.length && !(code[i] == '*' && code[i + 1] == '/')) i++
                    i = minOf(code.length, i + 2)
                    out.add(Token(code.substring(start, i), Role.COMMENT))
                }
                c == '"' || c == '\'' -> {
                    val start = i; i = scanQuoted(code, i, c)
                    out.add(Token(code.substring(start, i), Role.STRING))
                }
                c == '{' -> { inBlock = true; out.add(Token("{", Role.PLAIN)); i++ }
                c == '}' -> { inBlock = false; out.add(Token("}", Role.PLAIN)); i++ }
                c == '@' -> {
                    val start = i; i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '-')) i++
                    out.add(Token(code.substring(start, i), Role.KEYWORD))
                }
                c == '#' -> {
                    val start = i; i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '-' || code[i] == '_')) i++
                    out.add(Token(code.substring(start, i), if (inBlock) Role.NUMBER else Role.TITLE))
                }
                c == '.' && !inBlock && i + 1 < code.length && code[i + 1].isLetter() -> {
                    val start = i; i++
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '-' || code[i] == '_')) i++
                    out.add(Token(code.substring(start, i), Role.TITLE))
                }
                c == '!' -> {
                    val start = i; i++
                    while (i < code.length && code[i].isLetter()) i++
                    out.add(Token(code.substring(start, i), Role.META))
                }
                c.isDigit() -> {
                    val start = i; i = scanNumber(code, i)
                    while (i < code.length && (code[i].isLetter() || code[i] == '%')) i++
                    out.add(Token(code.substring(start, i), Role.NUMBER))
                }
                c.isLetter() || c == '-' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '-' || code[i] == '_')) i++
                    val word = code.substring(start, i)
                    var j = i
                    while (j < code.length && (code[j] == ' ' || code[j] == '\t')) j++
                    val role = when {
                        inBlock && j < code.length && code[j] == ':' -> Role.TYPE
                        !inBlock -> Role.KEYWORD
                        else -> Role.PLAIN
                    }
                    out.add(Token(word, role))
                }
                else -> { out.add(Token(c.toString(), Role.PLAIN)); i++ }
            }
        }
        return out
    }

    private fun tokenizeMarkdown(code: String): List<Token> {
        val out = mutableListOf<Token>()
        val lines = code.split("\n")
        for ((idx, line) in lines.withIndex()) {
            val trimmed = line.trim()
            when {
                trimmed.startsWith("#") -> out.add(Token(line, Role.TITLE))
                trimmed.startsWith(">") -> out.add(Token(line, Role.COMMENT))
                trimmed.startsWith("```") -> out.add(Token(line, Role.META))
                else -> {
                    var i = 0
                    while (i < line.length) {
                        when (line[i]) {
                            '`' -> {
                                val start = i; i++
                                while (i < line.length && line[i] != '`') i++
                                if (i < line.length) i++
                                out.add(Token(line.substring(start, i), Role.STRING))
                            }
                            '[' -> {
                                val start = i
                                while (i < line.length && line[i] != ']') i++
                                if (i < line.length) i++
                                if (i < line.length && line[i] == '(') {
                                    while (i < line.length && line[i] != ')') i++
                                    if (i < line.length) i++
                                    out.add(Token(line.substring(start, i), Role.META))
                                } else {
                                    out.add(Token(line.substring(start, i), Role.PLAIN))
                                }
                            }
                            else -> { out.add(Token(line[i].toString(), Role.PLAIN)); i++ }
                        }
                    }
                }
            }
            if (idx + 1 < lines.size) out.add(Token("\n", Role.PLAIN))
        }
        return out
    }

    private val sqlKeywords = setOf(
        "select", "from", "where", "join", "inner", "left", "right", "outer", "full", "cross", "on",
        "insert", "into", "values", "update", "set", "delete", "create", "alter", "drop", "table",
        "index", "view", "trigger", "if", "not", "exists", "primary", "key", "foreign", "references",
        "unique", "default", "null", "is", "in", "like", "between", "and", "or", "as", "distinct",
        "order", "by", "asc", "desc", "group", "having", "limit", "offset", "union", "all", "case",
        "when", "then", "else", "end", "with", "returning", "begin", "commit", "rollback", "replace",
        "conflict", "do", "nothing", "true", "false", "count", "sum", "avg", "min", "max", "coalesce",
    )

    private fun tokenizeSql(code: String): List<Token> {
        val out = mutableListOf<Token>()
        var i = 0
        while (i < code.length) {
            val c = code[i]
            when {
                c == '-' && i + 1 < code.length && code[i + 1] == '-' -> {
                    val start = i
                    while (i < code.length && code[i] != '\n') i++
                    out.add(Token(code.substring(start, i), Role.COMMENT))
                }
                c == '/' && i + 1 < code.length && code[i + 1] == '*' -> {
                    val start = i; i += 2
                    while (i + 1 < code.length && !(code[i] == '*' && code[i + 1] == '/')) i++
                    i = minOf(code.length, i + 2)
                    out.add(Token(code.substring(start, i), Role.COMMENT))
                }
                c == '\'' || c == '"' -> {
                    val start = i; i = scanQuoted(code, i, c)
                    out.add(Token(code.substring(start, i), Role.STRING))
                }
                c.isDigit() -> {
                    val start = i; i = scanNumber(code, i)
                    out.add(Token(code.substring(start, i), Role.NUMBER))
                }
                c.isLetter() || c == '_' -> {
                    val start = i
                    while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                    val word = code.substring(start, i)
                    val lower = word.lowercase()
                    val role = when {
                        lower == "true" || lower == "false" || lower == "null" -> Role.NUMBER
                        lower in sqlKeywords -> Role.KEYWORD
                        else -> Role.PLAIN
                    }
                    out.add(Token(word, role))
                }
                else -> { out.add(Token(c.toString(), Role.PLAIN)); i++ }
            }
        }
        return out
    }

    private val hashCommentLangs = setOf("python", "ruby", "bash", "r", "graphql", "php")
    private val slashCommentLangs = setOf("c", "cpp", "csharp", "go", "java", "javascript", "kotlin", "php", "rust", "swift", "typescript")
    private val funcIntroducers = setOf("func", "fn", "fun", "def", "function", "sub")
    private val typeIntroducers = setOf("class", "struct", "enum", "interface", "protocol", "trait", "type", "record", "object")

    private val commonKeywords = setOf(
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
        "then", "fi", "esac", "done", "local", "echo", "end", "begin", "rescue", "ensure", "until",
        "query", "mutation", "subscription", "fragment", "scalar", "input", "union", "schema",
    )

    private val literals = setOf("true", "false", "nil", "null", "None", "True", "False", "undefined", "NaN", "Infinity")

    private val primitiveTypes = setOf(
        "void", "bool", "boolean", "byte", "char", "short", "int", "long", "float", "double", "string", "str",
        "number", "any", "never", "unknown", "object", "usize", "isize", "u8", "u16", "u32", "u64", "u128",
        "i8", "i16", "i32", "i64", "i128", "f32", "f64", "int8", "int16", "int32", "int64", "uint", "uint8",
        "uint16", "uint32", "uint64", "rune", "error", "size_t", "auto",
    )

    private fun tokenizeGeneral(code: String, lang: String?): List<Token> {
        val allowSlash = lang == null || lang in slashCommentLangs
        val allowHash = lang == null || lang in hashCommentLangs
        val isCPreproc = lang == "c" || lang == "cpp" || lang == "csharp"
        val isLua = lang == "lua"
        val out = mutableListOf<Token>()
        var i = 0
        var expectTitle = false
        var expectType = false

        while (i < code.length) {
            val c = code[i]
            if (allowSlash && c == '/' && i + 1 < code.length && code[i + 1] == '/') {
                val start = i
                while (i < code.length && code[i] != '\n') i++
                out.add(Token(code.substring(start, i), Role.COMMENT))
                continue
            }
            if (isLua && c == '-' && i + 1 < code.length && code[i + 1] == '-') {
                val start = i
                if (code.startsWith("--[[", i)) {
                    i += 4
                    while (i < code.length && !code.startsWith("]]", i)) i++
                    i = minOf(code.length, i + 2)
                } else {
                    while (i < code.length && code[i] != '\n') i++
                }
                out.add(Token(code.substring(start, i), Role.COMMENT))
                continue
            }
            if (allowHash && c == '#') {
                val start = i
                while (i < code.length && code[i] != '\n') i++
                out.add(Token(code.substring(start, i), Role.COMMENT))
                continue
            }
            if (allowSlash && c == '/' && i + 1 < code.length && code[i + 1] == '*') {
                val start = i; i += 2
                while (i + 1 < code.length && !(code[i] == '*' && code[i + 1] == '/')) i++
                i = minOf(code.length, i + 2)
                out.add(Token(code.substring(start, i), Role.COMMENT))
                continue
            }
            if (isCPreproc && c == '#') {
                val start = i; i++
                while (i < code.length && (code[i].isLetter() || code[i] == '_')) i++
                out.add(Token(code.substring(start, i), Role.META))
                continue
            }
            if (lang == "rust" && c == '#' && i + 1 < code.length && (code[i + 1] == '[' || code[i + 1] == '!')) {
                val start = i
                while (i < code.length && code[i] != ']' && code[i] != '\n') i++
                if (i < code.length && code[i] == ']') i++
                out.add(Token(code.substring(start, i), Role.META))
                continue
            }
            if (c == '@' && i + 1 < code.length && (code[i + 1].isLetter() || code[i + 1] == '_')) {
                val start = i; i++
                while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                out.add(Token(code.substring(start, i), Role.META))
                continue
            }
            if ((c == '"' || c == '\'') && i + 2 < code.length && code[i + 1] == c && code[i + 2] == c) {
                val start = i; i += 3
                while (i + 2 < code.length && !(code[i] == c && code[i + 1] == c && code[i + 2] == c)) {
                    i += if (code[i] == '\\') 2 else 1
                }
                i = minOf(code.length, i + 3)
                out.add(Token(code.substring(start, i), Role.STRING))
                expectTitle = false; expectType = false
                continue
            }
            if (c == '"' || c == '`' || (c == '\'' && !(lang == "rust" && isRustLifetime(code, i)))) {
                val start = i; i = scanQuoted(code, i, c)
                out.add(Token(code.substring(start, i), Role.STRING))
                expectTitle = false; expectType = false
                continue
            }
            if (c.isDigit() && (i == 0 || !(code[i - 1].isLetter() || code[i - 1] == '_'))) {
                val start = i; i = scanNumber(code, i)
                out.add(Token(code.substring(start, i), Role.NUMBER))
                expectTitle = false; expectType = false
                continue
            }
            if (c.isLetter() || c == '_' || (lang == "php" && c == '$')) {
                val start = i
                if (c == '$') i++
                while (i < code.length && (code[i].isLetterOrDigit() || code[i] == '_')) i++
                val word = code.substring(start, i)
                val role = when {
                    expectTitle -> { expectTitle = false; Role.TITLE }
                    expectType -> { expectType = false; Role.TYPE }
                    word in literals -> Role.NUMBER
                    word in commonKeywords -> {
                        expectTitle = word in funcIntroducers
                        expectType = word in typeIntroducers
                        Role.KEYWORD
                    }
                    word in primitiveTypes -> Role.TYPE
                    isPascalType(word) -> Role.TYPE
                    else -> Role.PLAIN
                }
                out.add(Token(word, role))
                continue
            }
            if (c != ' ' && c != '\t') { expectTitle = false; expectType = false }
            out.add(Token(c.toString(), Role.PLAIN))
            i++
        }
        return out
    }

    private fun isPascalType(word: String) = word.length >= 2 && word[0].isUpperCase() && word.drop(1).any { it.isLowerCase() }

    private fun isRustLifetime(code: String, i: Int): Boolean {
        if (i + 1 >= code.length || !(code[i + 1].isLetter() || code[i + 1] == '_')) return false
        var j = i + 2
        while (j < code.length && (code[j].isLetterOrDigit() || code[j] == '_')) j++
        return j >= code.length || code[j] != '\''
    }

    private fun scanQuoted(code: String, start: Int, quote: Char): Int {
        var i = start + 1
        while (i < code.length) {
            val c = code[i]
            when {
                c == '\\' && i + 1 < code.length -> i += 2
                c == quote -> return i + 1
                c == '\n' && quote != '`' -> return i
                else -> i++
            }
        }
        return i
    }

    private fun scanNumber(code: String, start: Int): Int {
        var i = start
        if (i + 1 < code.length && code[i] == '0' && code[i + 1] in "xXbBoO") {
            i += 2
            while (i < code.length && (code[i].isDigit() || code[i] in 'a'..'f' || code[i] in 'A'..'F' || code[i] == '_')) i++
            return i
        }
        while (i < code.length && (code[i].isDigit() || code[i] == '_')) i++
        if (i + 1 < code.length && code[i] == '.' && code[i + 1].isDigit()) {
            i++
            while (i < code.length && (code[i].isDigit() || code[i] == '_')) i++
        }
        if (i < code.length && (code[i] == 'e' || code[i] == 'E')) {
            var j = i + 1
            if (j < code.length && (code[j] == '+' || code[j] == '-')) j++
            if (j < code.length && code[j].isDigit()) {
                i = j
                while (i < code.length && (code[i].isDigit() || code[i] == '_')) i++
            }
        }
        return i
    }
}
