package dev.notesapp.core

import dev.notesapp.core.CodeHighlight.Role
import dev.notesapp.core.CodeHighlight.Token
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CodeHighlightTest {
    @Test fun labelsAndAliasesMatchWeb() {
        assertEquals("JavaScript", CodeHighlight.languageLabel("js"))
        assertEquals("TypeScript", CodeHighlight.languageLabel("tsx"))
        assertEquals("Shell", CodeHighlight.languageLabel("sh"))
        assertEquals("C++", CodeHighlight.languageLabel("c++"))
        assertEquals("Plain text", CodeHighlight.languageLabel("txt"))
        assertEquals("zig", CodeHighlight.languageLabel("zig"))
        assertNull(CodeHighlight.languageLabel("  "))
        assertNull(CodeHighlight.languageLabel(null))
    }

    @Test fun highlightsKotlinAndTypeScript() {
        val code = "@Composable\nfun greet(name: String): Int {\n    // hi\n    return 42\n}"
        val kt = CodeHighlight.tokenize(code, "kt")
        assertEquals(code, kt.joinToString("") { it.text })
        assertTrue(Token("@Composable", Role.META) in kt)
        assertTrue(Token("fun", Role.KEYWORD) in kt)
        assertTrue(Token("greet", Role.TITLE) in kt)
        assertTrue(Token("String", Role.TYPE) in kt)
        assertTrue(Token("// hi", Role.COMMENT) in kt)
        assertTrue(Token("42", Role.NUMBER) in kt)

        val ts = CodeHighlight.tokenize("const msg = \"hello\";", "ts")
        assertTrue(Token("const", Role.KEYWORD) in ts)
        assertTrue(Token("\"hello\"", Role.STRING) in ts)
    }

    @Test fun highlightsSpecializedLanguagesAndPlainText() {
        val json = CodeHighlight.tokenize("{\"ok\": true, \"n\": 3}", "json")
        assertTrue(Token("\"ok\"", Role.TYPE) in json)
        assertTrue(Token("true", Role.NUMBER) in json)
        assertTrue(Token("3", Role.NUMBER) in json)

        val sql = CodeHighlight.tokenize("SELECT id FROM cards WHERE id = 'a' -- pick", "sql")
        assertTrue(Token("SELECT", Role.KEYWORD) in sql)
        assertTrue(Token("'a'", Role.STRING) in sql)
        assertTrue(Token("-- pick", Role.COMMENT) in sql)

        val diff = CodeHighlight.tokenize("@@ -1 +1 @@\n-old\n+new", "diff")
        assertTrue(Token("@@ -1 +1 @@\n", Role.TITLE) in diff)
        assertTrue(Token("-old\n", Role.META) in diff)
        assertTrue(Token("+new", Role.STRING) in diff)

        val html = CodeHighlight.tokenize("<div class=\"box\">hi</div>", "html")
        assertTrue(Token("div", Role.TITLE) in html)
        assertTrue(Token("class", Role.TYPE) in html)
        assertTrue(Token("\"box\"", Role.STRING) in html)

        assertEquals(listOf(Token("fun x() = 1", Role.PLAIN)), CodeHighlight.tokenize("fun x() = 1", "plaintext"))
    }
}
