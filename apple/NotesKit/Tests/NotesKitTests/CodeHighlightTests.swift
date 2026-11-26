import NotesKit
import Testing

@Suite struct CodeHighlightTests {
    @Test func labelsAndAliasesMatchWeb() {
        #expect(CodeHighlight.languageLabel("js") == "JavaScript")
        #expect(CodeHighlight.languageLabel("tsx") == "TypeScript")
        #expect(CodeHighlight.languageLabel("sh") == "Shell")
        #expect(CodeHighlight.languageLabel("c++") == "C++")
        #expect(CodeHighlight.languageLabel("txt") == "Plain text")
        #expect(CodeHighlight.languageLabel("zig") == "zig")
        #expect(CodeHighlight.languageLabel("  ") == nil)
        #expect(CodeHighlight.languageLabel(nil) == nil)
    }

    @Test func highlightsSwiftAndTypeScript() {
        let swift = CodeHighlight.tokenize("@MainActor\nfunc greet(name: String) -> Int {\n    // hi\n    return 42\n}", language: "swift")
        #expect(swift.map(\.text).joined() == "@MainActor\nfunc greet(name: String) -> Int {\n    // hi\n    return 42\n}")
        #expect(swift.contains(CodeHighlight.Token("@MainActor", .meta)))
        #expect(swift.contains(CodeHighlight.Token("func", .keyword)))
        #expect(swift.contains(CodeHighlight.Token("greet", .title)))
        #expect(swift.contains(CodeHighlight.Token("String", .type)))
        #expect(swift.contains(CodeHighlight.Token("// hi", .comment)))
        #expect(swift.contains(CodeHighlight.Token("42", .number)))

        let ts = CodeHighlight.tokenize("const msg = \"hello\";", language: "ts")
        #expect(ts.contains(CodeHighlight.Token("const", .keyword)))
        #expect(ts.contains(CodeHighlight.Token("\"hello\"", .string)))
    }

    @Test func highlightsSpecializedLanguagesAndPlainText() {
        let json = CodeHighlight.tokenize("{\"ok\": true, \"n\": 3}", language: "json")
        #expect(json.contains(CodeHighlight.Token("\"ok\"", .type)))
        #expect(json.contains(CodeHighlight.Token("true", .number)))
        #expect(json.contains(CodeHighlight.Token("3", .number)))

        let sql = CodeHighlight.tokenize("SELECT id FROM cards WHERE id = 'a' -- pick", language: "sql")
        #expect(sql.contains(CodeHighlight.Token("SELECT", .keyword)))
        #expect(sql.contains(CodeHighlight.Token("'a'", .string)))
        #expect(sql.contains(CodeHighlight.Token("-- pick", .comment)))

        let diff = CodeHighlight.tokenize("@@ -1 +1 @@\n-old\n+new", language: "diff")
        #expect(diff.contains(CodeHighlight.Token("@@ -1 +1 @@\n", .title)))
        #expect(diff.contains(CodeHighlight.Token("-old\n", .meta)))
        #expect(diff.contains(CodeHighlight.Token("+new", .string)))

        let html = CodeHighlight.tokenize("<div class=\"box\">hi</div>", language: "html")
        #expect(html.contains(CodeHighlight.Token("div", .title)))
        #expect(html.contains(CodeHighlight.Token("class", .type)))
        #expect(html.contains(CodeHighlight.Token("\"box\"", .string)))

        let plain = CodeHighlight.tokenize("func x() { return 1 }", language: "plaintext")
        #expect(plain == [CodeHighlight.Token("func x() { return 1 }", .plain)])
    }
}
