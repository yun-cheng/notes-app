package dev.notesapp.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** How a stretch of an entry's text looks while it's edited: its inline marks, or what it stands for. */
data class TextStyle(
    val bold: Boolean = false,
    val italic: Boolean = false,
    val code: Boolean = false,
    val strike: Boolean = false,
    val underline: Boolean = false,
    /** Hidden words keep a tint of their own in the editor, and show as dots in a bubble. */
    val hidden: Boolean = false,
    val link: String? = null,
    /** A link to another entry, by its ID; the text is its title. */
    val card: String? = null,
    /** A placeholder for a node kept aside, such as a photo: its key in the stash. */
    val node: String? = null,
) {
    /** What typing next to it carries on: the marks, not what a link or placeholder stands for. */
    val carried: TextStyle? get() = copy(link = null, card = null, node = null).takeIf { it != PLAIN }

    companion object { val PLAIN = TextStyle() }
}

/** Text with a style for each character, as an editor shows and changes it. */
data class RichText(val text: String, val styles: List<TextStyle?>) {
    init { require(styles.size == text.length) }

    /** Runs of characters that look the same. */
    fun runs(): List<Triple<Int, Int, TextStyle?>> {
        val out = mutableListOf<Triple<Int, Int, TextStyle?>>()
        var start = 0
        for (i in 1..text.length) {
            if (i == text.length || styles[i] != styles[start]) {
                if (i > start) out.add(Triple(start, i, styles[start]))
                start = i
            }
        }
        return out
    }

    /**
     * The same styles over text changed by typing: what's kept keeps its style, and what's typed takes the marks of
     * the character before it.
     */
    fun edited(next: String): RichText {
        if (next == text) return this
        var p = 0
        while (p < text.length && p < next.length && text[p] == next[p]) p++
        var s = 0
        while (s < text.length - p && s < next.length - p && text[text.length - 1 - s] == next[next.length - 1 - s]) s++
        val inserted = next.length - p - s
        val carry = (if (p > 0) styles[p - 1] else styles.getOrNull(p + (text.length - p - s)))?.carried
        val out = ArrayList<TextStyle?>(next.length)
        out.addAll(styles.subList(0, p))
        repeat(inserted) { out.add(if (next[p + it] == '\n') null else carry) }
        out.addAll(styles.subList(text.length - s, text.length))
        return RichText(next, out)
    }

    /** Puts a mark on the range, or takes it off when the whole range has it already. */
    fun toggle(start: Int, end: Int, has: (TextStyle) -> Boolean, set: (TextStyle, Boolean) -> TextStyle): RichText {
        if (start >= end) return this
        val on = !(start until end).all { styles[it]?.let(has) == true }
        val out = styles.toMutableList()
        for (i in start until end) {
            if (text[i] == '\n') continue
            out[i] = set(styles[i] ?: TextStyle.PLAIN, on).takeIf { it != TextStyle.PLAIN }
        }
        return RichText(text, out)
    }

    fun replace(start: Int, end: Int, with: String, style: TextStyle? = null) =
        RichText(text.substring(0, start) + with + text.substring(end), styles.subList(0, start) + List(with.length) { style } + styles.subList(end, styles.size))

    companion object { fun plain(text: String) = RichText(text, List(text.length) { null }) }
}

/**
 * Converts card bodies (TipTap JSON) to editable rich text and back, as the Swift app's `DocText`.
 *
 * Inline formatting is real rich text: bold, italic, strikethrough, underline, inline code and links. Blocks are
 * written as visible markers at the start of each line, so they survive any editing: `# ` headings, `• ` and `1. `
 * lists (two spaces of indent per level), `☐ ` checklists, `> ` quotes, ``` fences for code, and `---` rules. Card
 * links keep their ID. Anything else, such as a photo, shows as a placeholder, and the original node is kept in
 * `stash`.
 */
class DocText(val text: RichText, val stash: Map<String, JsonElement> = emptyMap()) {
    companion object {
        fun from(doc: JsonElement, titleOf: Doc.TitleOf? = null): DocText {
            val b = Builder(titleOf)
            b.blocks(doc["content"].arr ?: emptyList(), "")
            return DocText(RichText(b.out.toString(), b.styles), b.stash)
        }

        class ListMarker(val indent: Int, val ordered: Boolean, val number: Int, val length: Int)
        class TaskMarker(val indent: Int, val checked: Boolean, val length: Int)

        /** The list marker at the start of a line, such as "  • " or "3. ". */
        fun listMarker(s: String): ListMarker? {
            val spaces = s.takeWhile { it == ' ' }.length
            val rest = s.substring(spaces)
            if (listOf("• ", "- ", "* ").any { rest.startsWith(it) }) return ListMarker(spaces / 2, false, 1, spaces + 2)
            val digits = rest.takeWhile { it in '0'..'9' }
            if (digits.isNotEmpty() && digits.length <= 6 && rest.substring(digits.length).startsWith(". ")) return ListMarker(spaces / 2, true, digits.toInt(), spaces + digits.length + 2)
            return null
        }

        /**
         * What typing at the start of a line turns into, as the web's editor does: `[] ` a checkbox, `- ` a bullet. The
         * line's start, as typed, and what it becomes.
         */
        fun typedMarker(line: String): Pair<String, String>? {
            val spaces = line.takeWhile { it == ' ' }
            val rest = line.substring(spaces.length)
            for ((typed, marker) in listOf("[] " to "☐ ", "[ ] " to "☐ ", "[x] " to "☑ ", "[X] " to "☑ ", "- " to "• ", "* " to "• ")) {
                if (rest.startsWith(typed)) return spaces + typed to spaces + marker
            }
            return null
        }

        /** A checklist item's box at the start of a line: "☐ ", "☑ ", or as typed, "[ ] " and "[x] ". */
        fun taskMarker(s: String): TaskMarker? {
            val spaces = s.takeWhile { it == ' ' }.length
            val rest = s.substring(spaces)
            if (rest.startsWith("☐ ") || rest.startsWith("☑ ")) return TaskMarker(spaces / 2, rest.startsWith("☑"), spaces + 2)
            for ((box, checked) in listOf("[ ] " to false, "[] " to false, "[x] " to true, "[X] " to true)) if (rest.startsWith(box)) return TaskMarker(spaces / 2, checked, spaces + box.length)
            return null
        }

        fun headingLevel(s: String): Int? {
            val hashes = s.takeWhile { it == '#' }.length
            return if (hashes in 1..3 && s.substring(hashes).startsWith(" ")) hashes else null
        }

        /** Text cut where `||words||` marks words to hide; the bars go. */
        fun hiddenRuns(s: String): List<Pair<String, Boolean>> {
            val out = mutableListOf<Pair<String, Boolean>>()
            var rest = s
            while (true) {
                val open = rest.indexOf("||")
                if (open < 0) break
                val close = rest.indexOf("||", open + 2)
                if (close <= open + 2) break
                if (open > 0) out.add(rest.substring(0, open) to false)
                out.add(rest.substring(open + 2, close) to true)
                rest = rest.substring(close + 2)
            }
            if (rest.isNotEmpty() || out.isEmpty()) out.add(rest to false)
            return out.filter { it.first.isNotEmpty() }
        }
    }

    private class Builder(val titleOf: Doc.TitleOf?) {
        val out = StringBuilder()
        val styles = mutableListOf<TextStyle?>()
        val stash = mutableMapOf<String, JsonElement>()
        var lines = 0

        fun add(s: String, style: TextStyle? = null) { out.append(s); repeat(s.length) { styles.add(style) } }
        fun newLine() { if (lines > 0) add("\n"); lines++ }

        /** Block placeholders get keys starting with "b", inline ones with "i". */
        fun placeholder(node: JsonElement, block: Boolean) {
            val key = "${if (block) "b" else "i"}${stash.size + 1}"
            stash[key] = node
            val type = node["type"].str ?: "item"
            add(if (type == "photo") "[Photo${node["attrs"]["alt"].str?.let { ": $it" } ?: ""}]" else "[$type]", TextStyle(node = key))
        }

        fun blocks(nodes: List<JsonElement>, prefix: String) {
            if (nodes.isEmpty()) { newLine(); add(prefix) }
            for (n in nodes) block(n, prefix)
        }

        fun block(node: JsonElement, prefix: String) {
            when (node["type"].str) {
                "paragraph" -> { newLine(); add(prefix); inline(node["content"].arr ?: emptyList()) }
                "heading" -> {
                    val level = (node["attrs"]["level"].long ?: 1).toInt().coerceIn(1, 3)
                    newLine(); add(prefix + "#".repeat(level) + " "); inline(node["content"].arr ?: emptyList())
                }
                "bulletList", "orderedList" -> list(node, prefix, 0)
                "taskList" -> tasks(node, prefix, 0)
                "blockquote" -> blocks(node["content"].arr ?: emptyList(), "$prefix> ")
                "codeBlock" -> {
                    newLine(); add(prefix + "```" + (node["attrs"]["language"].str ?: ""))
                    val code = (node["content"].arr ?: emptyList()).mapNotNull { it["text"].str }.joinToString("")
                    for (line in code.split("\n")) { newLine(); add(prefix); add(line) }
                    newLine(); add("$prefix```")
                }
                "horizontalRule" -> { newLine(); add("$prefix---") }
                else -> { newLine(); add(prefix); placeholder(node, true) }
            }
        }

        /** A checklist: each item a line starting with ☐ or ☑, nested ones indented two spaces a level. */
        fun tasks(node: JsonElement, prefix: String, depth: Int) {
            val indent = "  ".repeat(depth)
            for (item in node["content"].arr ?: emptyList()) {
                val box = if (item["attrs"]["checked"].bool == true) "☑ " else "☐ "
                var first = true
                for (child in item["content"].arr ?: emptyList()) {
                    when (child["type"].str) {
                        "taskList" -> {
                            if (first) { newLine(); add(prefix + indent + box); first = false }
                            tasks(child, prefix, depth + 1)
                        }
                        "paragraph" -> { newLine(); add(prefix + indent + if (first) box else "  "); inline(child["content"].arr ?: emptyList()); first = false }
                        else -> { newLine(); add(prefix + indent + if (first) box else "  "); placeholder(child, true); first = false }
                    }
                }
                if (first) { newLine(); add(prefix + indent + box) }
            }
        }

        fun list(node: JsonElement, prefix: String, depth: Int) {
            val ordered = node["type"].str == "orderedList"
            val start = (node["attrs"]["start"].long ?: 1).toInt()
            val indent = "  ".repeat(depth)
            (node["content"].arr ?: emptyList()).forEachIndexed { i, item ->
                val bullet = if (ordered) "${start + i}. " else "• "
                var first = true
                val children = item["content"].arr ?: emptyList()
                if (children.isEmpty()) { newLine(); add(prefix + indent + bullet) }
                for (child in children) {
                    val type = child["type"].str
                    if (type == "bulletList" || type == "orderedList") {
                        if (first) { newLine(); add(prefix + indent + bullet); first = false }
                        list(child, prefix, depth + 1)
                    } else if (type == "paragraph") {
                        newLine(); add(prefix + indent + if (first) bullet else "  "); inline(child["content"].arr ?: emptyList()); first = false
                    } else {
                        newLine(); add(prefix + indent + if (first) bullet else "  "); placeholder(child, true); first = false
                    }
                }
            }
        }

        fun inline(nodes: List<JsonElement>) {
            for (n in nodes) when (n["type"].str) {
                "text" -> add(n["text"].str ?: "", styled(n["marks"].arr ?: emptyList()))
                "hardBreak" -> add(" ")
                "cardLink" -> {
                    val id = n["attrs"]["id"].str ?: ""
                    val label = n["attrs"]["label"].str ?: ""
                    add(titleOf?.title(id, label) ?: label, TextStyle(card = id))
                }
                else -> placeholder(n, false)
            }
        }

        fun styled(marks: List<JsonElement>): TextStyle? {
            var s = TextStyle.PLAIN
            for (m in marks) s = when (m["type"].str) {
                "bold" -> s.copy(bold = true)
                "italic" -> s.copy(italic = true)
                "code" -> s.copy(code = true)
                "strike" -> s.copy(strike = true)
                "underline" -> s.copy(underline = true)
                "link" -> s.copy(link = m["attrs"]["href"].str)
                "hidden" -> s.copy(hidden = true)
                else -> s
            }
            return s.takeIf { it != TextStyle.PLAIN }
        }
    }

    // Text to doc

    private class Line(val text: String, val styles: List<TextStyle?>) {
        fun dropping(n: Int): Line { val k = minOf(n, text.length); return Line(text.substring(k), styles.subList(k, styles.size)) }
        fun runs() = RichText(text, styles).runs()
    }

    /** The document for the edited text. */
    fun doc(): JsonElement {
        val lines = mutableListOf<Line>()
        var start = 0
        val t = text.text
        for (i in t.indices) if (t[i] == '\n') { lines.add(Line(t.substring(start, i), text.styles.subList(start, i))); start = i + 1 }
        lines.add(Line(t.substring(start), text.styles.subList(start, t.length)))
        val content = blocks(lines)
        return jobj("type" to j("doc"), "content" to jarr(content.ifEmpty { listOf(jobj("type" to j("paragraph"))) }))
    }

    private fun nonEmpty(l: List<JsonElement>) = l.ifEmpty { listOf(jobj("type" to j("paragraph"))) }

    /** Drops an empty `content` array, which ProseMirror leaves out for empty blocks. */
    private fun pruned(o: JsonObject): JsonObject = if (o["content"].arr?.isEmpty() == true) JsonObject(o - "content") else o

    /** A line that is nothing but one placeholder. */
    private fun placeholderBlock(line: Line): JsonElement? {
        val runs = line.runs().filter { line.text.substring(it.first, it.second).isNotBlank() }
        val key = runs.singleOrNull()?.third?.node ?: return null
        return if (key.startsWith("b")) stash[key] else null
    }

    private fun blocks(lines: List<Line>): List<JsonElement> {
        val out = mutableListOf<JsonElement>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val s = line.text
            if (s.startsWith(">")) {
                val quoted = mutableListOf<Line>()
                while (i < lines.size && lines[i].text.startsWith(">")) {
                    quoted.add(lines[i].dropping(if (lines[i].text.startsWith("> ")) 2 else 1)); i++
                }
                out.add(jobj("type" to j("blockquote"), "content" to jarr(nonEmpty(blocks(quoted)))))
                continue
            }
            if (s.startsWith("```")) {
                val language = s.substring(3).trim()
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && lines[i].text != "```") { code.add(lines[i].text); i++ }
                i++
                var node = jobj("type" to j("codeBlock"), "attrs" to jobj("language" to (if (language.isEmpty()) JsonNull else j(language))))
                val joined = code.joinToString("\n")
                if (joined.isNotEmpty()) node = node.with("content", jarr(listOf(jobj("type" to j("text"), "text" to j(joined)))))
                out.add(node)
                continue
            }
            val task = taskMarker(s)
            if (task != null) {
                val items = mutableListOf<Line>()
                while (i < lines.size) {
                    val l = lines[i].text
                    if (taskMarker(l) != null || (l.startsWith("  ") && l.isNotBlank() && listMarker(l) == null)) { items.add(lines[i]); i++ } else break
                }
                out.add(taskList(items, task.indent))
                continue
            }
            val marker = listMarker(s)
            if (marker != null) {
                val items = mutableListOf<Line>()
                while (i < lines.size) {
                    val l = lines[i].text
                    if (listMarker(l) != null || (l.startsWith("  ") && l.isNotBlank())) { items.add(lines[i]); i++ } else break
                }
                out.addAll(lists(items, marker.indent))
                continue
            }
            i++
            val level = headingLevel(s)
            when {
                level != null -> out.add(pruned(jobj("type" to j("heading"), "attrs" to jobj("level" to j(level)), "content" to jarr(inline(line.dropping(level + 1), true)))))
                s.trim() == "---" -> out.add(jobj("type" to j("horizontalRule")))
                else -> out.add(placeholderBlock(line) ?: pruned(jobj("type" to j("paragraph"), "content" to jarr(inline(line, false)))))
            }
        }
        return out
    }

    /** Checklist lines, starting at `indent`, as a task list; deeper ones nest in the item before them. */
    private fun taskList(lines: List<Line>, indent: Int): JsonElement {
        val items = mutableListOf<JsonElement>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val marker = taskMarker(line.text)
            if (marker == null || marker.indent > indent) { i++; continue }
            val content = mutableListOf<JsonElement>(pruned(jobj("type" to j("paragraph"), "content" to jarr(inline(line.dropping(marker.length), false)))))
            i++
            val nested = mutableListOf<Line>()
            while (i < lines.size) {
                val m = taskMarker(lines[i].text)
                if (m != null && m.indent <= indent) break
                nested.add(lines[i]); i++
            }
            val first = nested.firstOrNull()?.let { taskMarker(it.text) }
            if (first != null) content.add(taskList(nested, first.indent))
            else for (l in nested) content.addAll(blocks(listOf(l.dropping(l.text.takeWhile { it == ' ' }.length))))
            items.add(jobj("type" to j("taskItem"), "attrs" to jobj("checked" to j(marker.checked)), "content" to jarr(content)))
        }
        return jobj("type" to j("taskList"), "content" to jarr(items))
    }

    /** Consecutive list lines, starting at `indent`, as one or more lists. */
    private fun lists(lines: List<Line>, indent: Int): List<JsonElement> {
        val result = mutableListOf<JsonElement>()
        val items = mutableListOf<JsonElement>()
        var ordered: Boolean? = null
        var start = 1
        fun flush() {
            val o = ordered ?: return
            if (items.isEmpty()) return
            var list = jobj("type" to j(if (o) "orderedList" else "bulletList"), "content" to jarr(items.toList()))
            if (o) list = jobj("type" to list["type"], "attrs" to jobj("start" to j(start)), "content" to list["content"])
            result.add(list)
            items.clear()
        }
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val marker = listMarker(line.text)
            if (marker == null || marker.indent > indent) {
                // A deeper or unmarked line before any item at this level: its own paragraph.
                val trimmed = line.dropping(line.text.takeWhile { it == ' ' }.length)
                items.add(jobj("type" to j("listItem"), "content" to jarr(nonEmpty(blocks(listOf(trimmed))))))
                if (ordered == null) ordered = false
                i++
                continue
            }
            if (ordered != null && ordered != marker.ordered) flush()
            if (items.isEmpty()) { ordered = marker.ordered; start = marker.number }
            val content = mutableListOf<JsonElement>(pruned(jobj("type" to j("paragraph"), "content" to jarr(inline(line.dropping(marker.length), false)))))
            i++
            val nested = mutableListOf<Line>()
            while (i < lines.size) {
                val m = listMarker(lines[i].text)
                if (m != null && m.indent <= indent) break
                nested.add(lines[i]); i++
            }
            var k = 0
            while (k < nested.size) {
                if (listMarker(nested[k].text) != null) {
                    val group = mutableListOf<Line>()
                    while (k < nested.size && (listMarker(nested[k].text) != null || nested[k].text.startsWith("  ".repeat(indent + 2)))) { group.add(nested[k]); k++ }
                    content.addAll(lists(group, indent + 1))
                } else {
                    val l = nested[k]
                    content.addAll(blocks(listOf(l.dropping(l.text.takeWhile { it == ' ' }.length))))
                    k++
                }
            }
            items.add(jobj("type" to j("listItem"), "content" to jarr(content)))
        }
        flush()
        return result
    }

    /** Inline nodes for one line. Heading text is bold by its look, so bold isn't read from it. */
    private fun inline(line: Line, heading: Boolean): List<JsonElement> {
        val out = mutableListOf<JsonElement>()
        for ((a, b, style) in line.runs()) {
            val s = line.text.substring(a, b)
            if (s.isEmpty()) continue
            style?.card?.let { out.add(jobj("type" to j("cardLink"), "attrs" to jobj("id" to j(it), "label" to j(s)))); continue }
            style?.node?.let { key -> stash[key]?.let { out.add(it); continue } }
            val marks = mutableListOf<JsonElement>()
            if (style != null) {
                if (style.bold && !heading) marks.add(jobj("type" to j("bold")))
                if (style.italic) marks.add(jobj("type" to j("italic")))
                if (style.code) marks.add(jobj("type" to j("code")))
                if (style.strike) marks.add(jobj("type" to j("strike")))
                if (style.underline) marks.add(jobj("type" to j("underline")))
                style.link?.let { marks.add(jobj("type" to j("link"), "attrs" to jobj("href" to j(it)))) }
            }
            val hidden = style?.hidden == true
            // A line break inside a paragraph.
            s.split(' ').forEachIndexed { k, part ->
                if (k > 0) out.add(jobj("type" to j("hardBreak")))
                if (part.isEmpty()) return@forEachIndexed
                // `||words||` typed in hides them, as in the web app's editor.
                for ((piece, typedHidden) in hiddenRuns(part)) {
                    val pieceMarks = if (hidden || typedHidden) marks + jobj("type" to j("hidden")) else marks
                    var node = jobj("type" to j("text"), "text" to j(piece))
                    if (pieceMarks.isNotEmpty()) node = node.with("marks", JsonArray(pieceMarks))
                    val last = out.lastOrNull()
                    if (last != null && last["type"].str == "text" && last["marks"] == node["marks"]) {
                        out[out.size - 1] = (last as JsonObject).with("text", j((last["text"].str ?: "") + piece))
                    } else out.add(node)
                }
            }
        }
        return out
    }
}
