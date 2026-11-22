package dev.notesapp.core

import kotlinx.serialization.json.JsonElement

/** Card bodies as Markdown and plain text, and entries as the clipboard carries them, as `markdown.ts`/`clipboard.ts`. */
object Markdown {
    private fun escape(text: String): String {
        var out = text.replace(Regex("""[\\*`\[]""")) { "\\" + it.value }
        out = out.replace(Regex("""\|(?=\|)"""), "\\\\|")
        out = out.replace(Regex("""(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])""")) { it.value.replace("_", "\\_") }
        return out
    }

    private fun renderText(n: JsonElement): String {
        val marks = n["marks"].arr ?: emptyList()
        val types = marks.mapNotNull { it["type"].str }
        val text = n["text"].str ?: ""
        var out = if ("code" in types) "`$text`" else escape(text)
        for (m in marks) out = when (m["type"].str) {
            "bold" -> "**$out**"
            "italic" -> "*$out*"
            "strike" -> "~~$out~~"
            "hidden" -> "||$out||"
            "link" -> "[$out](${m["attrs"]["href"].str ?: ""})"
            else -> out
        }
        return out
    }

    private fun plainInline(n: JsonElement): String {
        val text = n["text"].str ?: ""
        val href = n["marks"].arr?.firstOrNull { it["type"].str == "link" }?.get("attrs")?.get("href").str
        if (href.isNullOrEmpty()) return text
        val bare = href.replace(Regex("""(?i)^[a-z]+://"""), "")
        return if (href == text || bare == text) href else "$text ($href)"
    }

    private fun renderInline(nodes: List<JsonElement>?, title: Doc.TitleOf, plain: Boolean = false) = (nodes ?: emptyList()).joinToString("") { n ->
        when (Doc.type(n)) {
            "text" -> if (plain) plainInline(n) else renderText(n)
            "hardBreak" -> if (plain) "\n" else "  \n"
            "cardLink" -> title.title(n["attrs"]["id"].str ?: "", n["attrs"]["label"].str ?: "").let { if (plain) it else "[[$it]]" }
            else -> ""
        }
    }.replace("||||", "")

    private fun indent(text: String, by: String) = text.split("\n").mapIndexed { i, l -> if (i > 0 && l.isNotEmpty()) by + l else l }.joinToString("\n")
    private fun items(n: JsonElement) = n["content"].arr ?: emptyList()

    private fun plainBlock(n: JsonElement, title: Doc.TitleOf): String = when (Doc.type(n)) {
        "bulletList" -> items(n).joinToString("\n") { "- " + indent(plainBlocks(it["content"].arr, title), "  ") }
        "taskList" -> items(n).joinToString("\n") { (if (it["attrs"]["checked"].bool == true) "☑ " else "☐ ") + indent(plainBlocks(it["content"].arr, title), "  ") }
        "orderedList" -> {
            val start = (n["attrs"]["start"].long ?: 1).toInt()
            items(n).withIndex().joinToString("\n") { (i, it) -> "${start + i}. " + indent(plainBlocks(it["content"].arr, title), "   ") }
        }
        "blockquote" -> plainBlocks(n["content"].arr, title)
        "codeBlock" -> items(n).joinToString("") { it["text"].str ?: "" }
        "file" -> n["attrs"]["transcript"].str ?: ""
        "photo", "horizontalRule" -> ""
        else -> renderInline(n["content"].arr, title, plain = true)
    }

    private fun plainBlocks(nodes: List<JsonElement>?, title: Doc.TitleOf) = (nodes ?: emptyList()).map { plainBlock(it, title) }.filter { it.isNotEmpty() }.joinToString("\n\n")

    fun plain(doc: JsonElement, title: Doc.TitleOf = Doc.TitleOf { _, l -> l }) = plainBlocks(doc["content"].arr, title).trim()

    private fun renderBlock(n: JsonElement, title: Doc.TitleOf): String = when (Doc.type(n)) {
        "paragraph" -> renderInline(n["content"].arr, title).replace(Regex("""^(#{1,6}\s|>|[-+]\s|\d+\.\s)""")) { "\\" + it.value }
        "heading" -> "#".repeat((n["attrs"]["level"].long ?: 1).toInt()) + " " + renderInline(n["content"].arr, title)
        "bulletList" -> items(n).joinToString("\n") { "- " + indent(renderBlocks(it["content"].arr, title), "  ") }
        "taskList" -> items(n).joinToString("\n") { "- [${if (it["attrs"]["checked"].bool == true) "x" else " "}] " + indent(renderBlocks(it["content"].arr, title), "  ") }
        "orderedList" -> {
            val start = (n["attrs"]["start"].long ?: 1).toInt()
            items(n).withIndex().joinToString("\n") { (i, it) -> val m = "${start + i}. "; m + indent(renderBlocks(it["content"].arr, title), " ".repeat(m.length)) }
        }
        "blockquote" -> renderBlocks(n["content"].arr, title).split("\n").joinToString("\n") { if (it.isEmpty()) ">" else "> $it" }
        "codeBlock" -> "```${n["attrs"]["language"].str ?: ""}\n" + items(n).joinToString("") { it["text"].str ?: "" } + "\n```"
        "photo" -> "![${(n["attrs"]["alt"].str?.takeIf { it.isNotEmpty() } ?: "Photo").replace(Regex("""[\[\]]"""), "")}](attachment:${n["attrs"]["id"].str ?: ""})"
        "file" -> {
            val link = "[${(n["attrs"]["name"].str?.takeIf { it.isNotEmpty() } ?: "File").replace(Regex("""[\[\]]"""), "")}](attachment:${n["attrs"]["id"].str ?: ""})"
            val words = n["attrs"]["transcript"].str?.trim() ?: ""
            if (words.isEmpty()) link else "$link\n\n> ${words.replace(Regex("\n+"), " ")}"
        }
        "horizontalRule" -> "---"
        else -> renderInline(n["content"].arr, title)
    }

    private fun renderBlocks(nodes: List<JsonElement>?, title: Doc.TitleOf) = (nodes ?: emptyList()).joinToString("\n\n") { renderBlock(it, title) }

    fun from(doc: JsonElement, title: Doc.TitleOf = Doc.TitleOf { _, l -> l }) = renderBlocks(doc["content"].arr, title).trim()

    private fun tagWords(tags: List<String>) = tags.joinToString(" ") { "#" + it.replace(Regex("\\s+"), "-") }

    /** Entries as text the journal box reads back: a todo as `[ ] Title @date #tag`, a note as Markdown with its tags. */
    fun entries(cards: List<Card>, index: CardIndex): String {
        val parts = cards.map { card ->
            val tags = tagWords(index.resolveTags(card.tags).map { it.title })
            val body = from(card.content, index.titleOf) + card.turnPages.withIndex().joinToString("") { (i, p) -> "\n\n## Page ${i + 2}\n\n" + from(p, index.titleOf) }
            if (card.type == CardType.todo) {
                val whenWords = listOfNotNull(card.due, card.due?.let { card.dueTime }, card.due?.let { card.repeat?.word }).map { "@$it" }
                val head = (listOf("[${if (card.isDone) "x" else " "}] ${card.title}") + whenWords + tags).filter { it.isNotEmpty() }.joinToString(" ")
                (if (body.isEmpty()) head else "$head\n$body") to body.isEmpty()
            } else listOf(card.title.trim(), body, tags).filter { it.isNotEmpty() }.joinToString("\n") to false
        }
        return parts.withIndex().joinToString("") { (i, p) -> (if (i == 0) "" else if (p.second && parts[i - 1].second) "\n" else "\n\n") + p.first }
    }

    fun words(card: Card, index: CardIndex): String {
        val pages = card.turnPages.withIndex().map { (i, p) -> "Page ${i + 2}:\n" + plain(p, index.titleOf) }
        return (listOf(card.title.trim(), plain(card.content, index.titleOf)) + pages).filter { it.isNotEmpty() }.joinToString("\n\n")
    }
}
