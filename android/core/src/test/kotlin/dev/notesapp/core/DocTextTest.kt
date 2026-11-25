package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The Swift app's DocText tests, run against the Kotlin port. */
class DocTextTest {
    private fun text(s: String, vararg marks: String): JsonElement {
        var n = jobj("type" to j("text"), "text" to j(s))
        if (marks.isNotEmpty()) n = n.with("marks", jarr(marks.map { jobj("type" to j(it)) }))
        return n
    }
    private fun para(vararg inline: JsonElement) = if (inline.isEmpty()) jobj("type" to j("paragraph")) else jobj("type" to j("paragraph"), "content" to jarr(inline.toList()))
    private fun doc(vararg blocks: JsonElement) = jobj("type" to j("doc"), "content" to jarr(blocks.toList()))
    private fun roundTrip(d: JsonElement) = DocText.from(d).doc()
    private fun typed(s: String) = DocText(RichText.plain(s)).doc()

    @Test fun paragraphsAndInlineMarks() {
        val d = doc(
            para(text("Plain, "), text("bold", "bold"), text(" and "), text("both", "bold", "italic")),
            para(),
            para(text("code", "code"), text(" "), text("gone", "strike"), text(" "), text("under", "underline")),
        )
        assertEquals(d, roundTrip(d))
        assertEquals("Plain, bold and both\n\ncode gone under", DocText.from(d).text.text)
    }

    @Test fun wordsThatLookLikeSyntaxStayWords() {
        val d = doc(
            para(text("- milk")), para(text("1. first")), para(text("# not a heading")), para(text("> not a quote")),
            para(text("---")), para(text("[ ] not a box")), para(text("  indented")),
            para(text("if a || b || c")), para(text("x || y", "code")),
        )
        assertEquals(d, roundTrip(d))
        // Typed in, they still make lists and hide words.
        val t = typed("- milk\nsay ||this||")
        assertEquals(j("bulletList"), t["content"][0]["type"])
        assertEquals(j("hidden"), t["content"][1]["content"][1]["marks"][0]["type"])
    }

    @Test fun linksShownAsLockedKeepTheirLabel() {
        val card = jobj("type" to j("cardLink"), "attrs" to jobj("id" to j("c-9"), "label" to j("Plans")))
        val d = doc(para(text("See "), card))
        val shown = DocText.from(d, Doc.TitleOf { _, _ -> CardIndex.LOCKED_TITLE })
        assertEquals("See Locked", shown.text.text)
        assertEquals(d, shown.doc())
    }

    @Test fun linksCardLinksAndBreaks() {
        val link = jobj("type" to j("text"), "text" to j("site"), "marks" to jarr(listOf(jobj("type" to j("link"), "attrs" to jobj("href" to j("https://example.com/a"))))))
        val card = jobj("type" to j("cardLink"), "attrs" to jobj("id" to j("c-1"), "label" to j("Groceries")))
        val d = doc(para(text("See "), card, text(" and "), link, jobj("type" to j("hardBreak")), text("next line")))
        assertEquals(d, roundTrip(d))
        val renamed = DocText.from(d, Doc.TitleOf { _, _ -> "Shopping" })
        assertTrue(renamed.text.text.startsWith("See Shopping and"))
        assertEquals(jobj("type" to j("cardLink"), "attrs" to jobj("id" to j("c-1"), "label" to j("Shopping"))), renamed.doc()["content"][0]["content"][1])
    }

    @Test fun headingsQuotesRulesAndCode() {
        val d = doc(
            jobj("type" to j("heading"), "attrs" to jobj("level" to j(2)), "content" to jarr(listOf(text("Plan")))),
            jobj("type" to j("blockquote"), "content" to jarr(listOf(para(text("Quoted")), para(text("twice"))))),
            jobj("type" to j("horizontalRule")),
            jobj("type" to j("codeBlock"), "attrs" to jobj("language" to j("swift")), "content" to jarr(listOf(text("let a = 1\nprint(a)")))),
            para(text("after")),
        )
        assertEquals(d, roundTrip(d))
        assertEquals("## Plan\n> Quoted\n> twice\n---\n```swift\nlet a = 1\nprint(a)\n```\nafter", DocText.from(d).text.text)
    }

    @Test fun nestedLists() {
        fun item(s: String, vararg more: JsonElement) = jobj("type" to j("listItem"), "content" to jarr(listOf(para(text(s))) + more))
        val inner = jobj("type" to j("orderedList"), "attrs" to jobj("start" to j(1)), "content" to jarr(listOf(item("one"), item("two"))))
        val d = doc(jobj("type" to j("bulletList"), "content" to jarr(listOf(item("milk", inner), item("eggs", para(text("free range")))))))
        assertEquals("• milk\n  1. one\n  2. two\n• eggs\n  free range", DocText.from(d).text.text)
        assertEquals(d, roundTrip(d))
    }

    @Test fun photosAndUnknownNodesSurvive() {
        val photo = jobj("type" to j("photo"), "attrs" to jobj("id" to j("p1"), "alt" to j("Beach"), "width" to j(800)))
        val table = jobj("type" to j("table"), "content" to jarr(listOf(jobj("type" to j("tableRow")))))
        val d = doc(para(text("Trip")), photo, table)
        val t = DocText.from(d)
        assertEquals("Trip\n[Photo: Beach]\n[table]", t.text.text)
        assertEquals(d, t.doc())
    }

    @Test fun typedMarkersBecomeBlocks() {
        val d = typed("# Title\n- a\n- b\n1. first\nplain")
        assertEquals(listOf("heading", "bulletList", "orderedList", "paragraph"), d["content"].arr!!.map { it["type"].str })
        assertEquals(2, d["content"][1]["content"].arr!!.size)
        assertEquals(doc(para()), typed(""))
        assertEquals("", DocText.from(Doc.empty).text.text)
    }

    @Test fun checklistsAndHiddenWords() {
        fun item(checked: Boolean, vararg content: JsonElement) = jobj("type" to j("taskItem"), "attrs" to jobj("checked" to j(checked)), "content" to jarr(content.toList()))
        val d = doc(
            para(text("Pack")),
            jobj("type" to j("taskList"), "content" to jarr(listOf(item(false, para(text("passport"))), item(true, para(text("charger")), jobj("type" to j("taskList"), "content" to jarr(listOf(item(false, para(text("cable")))))))))),
            para(text("The code is "), text("1234", "hidden")),
        )
        assertEquals(d, roundTrip(d))
        assertTrue(DocText.from(d).text.text.contains("☑ charger\n  ☐ cable"))
        assertEquals(
            doc(jobj("type" to j("taskList"), "content" to jarr(listOf(item(false, para(text("milk"))), item(true, para(text("eggs")))))), para(text("PIN "), text("4321", "hidden"), text(" ok"))),
            typed("[ ] milk\n[x] eggs\nPIN ||4321|| ok"),
        )
    }

    @Test fun typingKeepsAndCarriesStyles() {
        val t = DocText.from(doc(para(text("a"), text("bold", "bold"), text("z")))).text
        val next = t.edited("abold!z")
        assertEquals(true, next.styles[5]?.bold)
        assertEquals(null, next.styles[6])
        val toggled = next.toggle(0, 1, { it.italic }) { s, on -> s.copy(italic = on) }
        assertEquals(true, toggled.styles[0]?.italic)
    }

    @Test fun photoBlocksKeepTheirSize() {
        // As on the web (`content.test.ts`): a photo's block keeps its size, so its shape is known before it loads.
        val page = jobj("type" to j("doc"), "content" to jarr(listOf(Doc.photoNode("p", 1800.0, 600.0), Doc.photoNode("q"), Doc.photoNode("r", 0.0, 5.0))))
        assertEquals(listOf(Doc.Media.Photo("p", 3.0), Doc.Media.Photo("q"), Doc.Media.Photo("r")), Doc.media(page))
    }
}
