package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.net.URI

/** Helpers for card bodies, which are TipTap (ProseMirror) JSON documents, as the web app's `content.ts`. */
object Doc {
    val empty: JsonElement = jobj("type" to j("doc"), "content" to jarr(listOf(jobj("type" to j("paragraph")))))

    /** A document of these blocks; with none, one empty paragraph, as ProseMirror keeps an empty document. */
    fun of(blocks: List<JsonElement>): JsonObject = jobj("type" to j("doc"), "content" to jarr(blocks.ifEmpty { listOf(jobj("type" to j("paragraph"))) }))

    /** A photo as an entry holds it. */
    /** A photo's block, with its size in pixels when known, so its shape is known before it loads (`photoRatios`). */
    fun photoNode(id: String, width: Double? = null, height: Double? = null): JsonObject =
        jobj("type" to j("photo"), "attrs" to if (width != null && height != null && width > 0 && height > 0) jobj("id" to j(id), "width" to j(Math.round(width)), "height" to j(Math.round(height))) else jobj("id" to j(id)))

    /**
     * A file as an entry holds it, with what else is known: a video's still and shape, a sound's length, and any
     * `extra` attributes.
     */
    fun fileNode(
        id: String, name: String, mime: String, size: Long, poster: String? = null, width: Double? = null, height: Double? = null,
        duration: Double? = null, extra: JsonObject = jobj(),
    ): JsonObject {
        var attrs = jobj("id" to j(id), "name" to j(name), "mime" to j(mime), "size" to j(size))
        poster?.let { attrs = attrs.with("poster", j(it)) }
        width?.let { attrs = attrs.with("width", j(it)) }
        height?.let { attrs = attrs.with("height", j(it)) }
        duration?.let { attrs = attrs.with("duration", j(it)) }
        return jobj("type" to j("file"), "attrs" to JsonObject(attrs + extra))
    }

    const val CODE_OPEN = ""
    const val CODE_CLOSE = ""
    const val HIDE_OPEN = ""
    const val HIDE_CLOSE = ""
    const val HIDDEN_MASK = "•••"

    enum class Hidden { show, mark, mask }

    fun interface TitleOf { fun title(id: String, label: String): String }

    fun walk(node: JsonElement, visit: (JsonElement) -> Unit) {
        visit(node)
        node["content"].arr?.forEach { walk(it, visit) }
    }

    fun type(n: JsonElement?) = n["type"].str
    fun marks(n: JsonElement?) = n["marks"].arr?.mapNotNull { it["type"].str } ?: emptyList()
    fun isDoc(n: JsonElement) = type(n) == "doc"

    /** The body as plain text, a voice message's words among it. */
    fun plainText(node: JsonElement, titleOf: TitleOf? = null): String {
        val parts = StringBuilder()
        fun visit(n: JsonElement) {
            when (type(n)) {
                "text" -> parts.append(n["text"].str ?: "")
                "cardLink" -> {
                    val label = n["attrs"]["label"].str ?: ""
                    parts.append(titleOf?.title(n["attrs"]["id"].str ?: "", label) ?: label)
                }
                "hardBreak" -> parts.append(' ')
                "file" -> n["attrs"]["transcript"].str?.let { parts.append(" $it ") }
            }
            n["content"].arr?.let { children ->
                children.forEach(::visit)
                if (type(n) != "doc") parts.append(' ')
            }
        }
        visit(node)
        return parts.toString().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
    }

    fun linkedCardIds(node: JsonElement): List<String> {
        val ids = LinkedHashSet<String>()
        walk(node) { n -> if (type(n) == "cardLink") n["attrs"]["id"].str?.let(ids::add) }
        return ids.toList()
    }

    fun photoIds(node: JsonElement): List<String> {
        val ids = mutableListOf<String>()
        walk(node) { n -> if (type(n) == "photo") n["attrs"]["id"].str?.let(ids::add) }
        return ids
    }

    fun fileIds(node: JsonElement): List<String> {
        val ids = mutableListOf<String>()
        walk(node) { n -> if (type(n) == "file") n["attrs"]["id"].str?.let(ids::add) }
        return ids
    }

    /** A document with no words, no photos and no files. */
    fun isBlank(node: JsonElement) = plainText(node).isEmpty() && photoIds(node).isEmpty() && fileIds(node).isEmpty()

    /** A block's text on one line, with card links as their titles. */
    fun inlineText(node: JsonElement, titleOf: TitleOf? = null, markCode: Boolean = false, hidden: Hidden = Hidden.show): String {
        when (type(node)) {
            "text" -> {
                val text = node["text"].str ?: ""
                val isHidden = hidden != Hidden.show && text.isNotEmpty() && "hidden" in marks(node)
                if (isHidden && hidden == Hidden.mask) return HIDDEN_MASK
                val shown = if (markCode && text.isNotEmpty() && "code" in marks(node)) CODE_OPEN + text + CODE_CLOSE else text
                return if (isHidden) HIDE_OPEN + shown + HIDE_CLOSE else shown
            }
            "hardBreak" -> return "\n"
            "cardLink" -> {
                val label = node["attrs"]["label"].str ?: ""
                return titleOf?.title(node["attrs"]["id"].str ?: "", label) ?: label
            }
        }
        val text = (node["content"].arr ?: emptyList()).joinToString("") { inlineText(it, titleOf, markCode, hidden) }
        return when (hidden) {
            Hidden.mark -> text.replace(HIDE_CLOSE + HIDE_OPEN, "")
            Hidden.mask -> text.replace(HIDDEN_MASK + HIDDEN_MASK, HIDDEN_MASK)
            Hidden.show -> text
        }
    }

    /** A run of a document's text: lines of plain text, or a code block, kept as typed. */
    sealed class PreviewPart {
        data class Text(val lines: List<String>) : PreviewPart()
        data class Code(val text: String, val language: String?, val prefix: String) : PreviewPart()
    }

    /** A document as runs of text lines, with list markers, and code blocks between them; trailing empty lines go. */
    fun previewParts(content: JsonElement, titleOf: TitleOf? = null, full: Boolean = false, markCode: Boolean = false, hidden: Hidden = Hidden.show): List<PreviewPart> {
        val parts = mutableListOf<PreviewPart>()
        fun line(text: String) {
            val last = parts.lastOrNull()
            if (last is PreviewPart.Text) parts[parts.size - 1] = PreviewPart.Text(last.lines + text) else parts.add(PreviewPart.Text(listOf(text)))
        }
        fun block(node: JsonElement, prefix: String) {
            val children = node["content"].arr ?: emptyList()
            when (type(node)) {
                "bulletList", "orderedList" -> {
                    val start = (node["attrs"]["start"].long ?: 1).toInt()
                    children.forEachIndexed { i, item ->
                        val marker = if (type(node) == "bulletList") "• " else "${start + i}. "
                        (item["content"].arr ?: emptyList()).forEachIndexed { k, child -> block(child, if (k == 0) prefix + marker else "$prefix  ") }
                    }
                }
                "taskList" -> children.forEach { item ->
                    val marker = if (item["attrs"]["checked"].bool == true) "☑ " else "☐ "
                    (item["content"].arr ?: emptyList()).forEachIndexed { k, child -> block(child, if (k == 0) prefix + marker else "$prefix  ") }
                }
                "blockquote" -> children.forEach { block(it, if (full) "$prefix> " else prefix) }
                "doc" -> children.forEach { block(it, prefix) }
                "photo" -> if (full) {
                    val alt = node["attrs"]["alt"].str ?: ""
                    line("$prefix[Photo${if (alt.isEmpty()) "" else ": $alt"}]")
                }
                "file" -> if (full) {
                    val mime = node["attrs"]["mime"].str ?: ""
                    val name = node["attrs"]["name"].str ?: ""
                    val kind = if (mime.startsWith("video/")) "Video" else if (mime.startsWith("audio/")) "Voice" else "File"
                    line("$prefix[$kind: ${name.ifEmpty { "Untitled" }}]")
                    node["attrs"]["transcript"].str?.takeIf { it.isNotEmpty() }?.let { line("$prefix“$it”") }
                }
                "horizontalRule" -> if (full) line("$prefix———")
                "codeBlock" -> {
                    val language = node["attrs"]["language"].str?.takeIf { it.isNotEmpty() }
                    parts.add(PreviewPart.Code(inlineText(node).trimEnd('\n'), language, prefix))
                }
                else -> (prefix + inlineText(node, titleOf, markCode, hidden)).split("\n").forEach(::line)
            }
        }
        block(content, "")
        while (parts.isNotEmpty()) {
            when (val last = parts.last()) {
                is PreviewPart.Code -> if (last.text.isNotBlank()) return parts else parts.removeAt(parts.size - 1)
                is PreviewPart.Text -> {
                    val lines = last.lines.dropLastWhile { it.isBlank() }
                    if (lines.isNotEmpty()) {
                        parts[parts.size - 1] = PreviewPart.Text(lines)
                        return parts
                    }
                    parts.removeAt(parts.size - 1)
                }
            }
        }
        return parts
    }

    fun previewLines(content: JsonElement, titleOf: TitleOf? = null, full: Boolean = false, hidden: Hidden = Hidden.show): List<String> =
        previewParts(content, titleOf, full, hidden = hidden).flatMap { part ->
            when (part) {
                is PreviewPart.Text -> part.lines
                is PreviewPart.Code -> {
                    val blank = part.prefix.map { if (it.isWhitespace()) it else ' ' }.joinToString("")
                    part.text.split("\n").mapIndexed { i, l -> (if (i == 0) part.prefix else blank) + l }
                }
            }
        }

    private fun shortened(line: String) = if (line.length > 80) line.take(79).trimEnd() + "…" else line
    private fun stripMarker(line: String) = line.replace(Regex("""^(• |\d+\. )"""), "").trim()

    /** The first line of text in the body, shortened to fit a title. Hidden words stay hidden. */
    fun firstLine(content: JsonElement): String {
        val line = previewLines(content, hidden = Hidden.mask).firstOrNull { it.isNotBlank() } ?: return ""
        return shortened(stripMarker(line))
    }

    // Links

    val urlInText = Regex("""\bhttps?://[^\s<>"']*[^\s<>"'.,;:!?)\]}]""")

    /** Text cut into plain runs and web addresses. */
    fun splitLinks(text: String): List<Pair<String, String?>> {
        val parts = mutableListOf<Pair<String, String?>>()
        var at = 0
        for (m in urlInText.findAll(text)) {
            if (m.range.first > at) parts.add(text.substring(at, m.range.first) to null)
            parts.add(m.value to m.value)
            at = m.range.last + 1
        }
        if (at < text.length || parts.isEmpty()) parts.add(text.substring(at) to null)
        return parts
    }

    private fun inlineWithLinks(line: String): List<JsonElement> = splitLinks(line).filter { it.first.isNotEmpty() }.map { (text, href) ->
        if (href != null) jobj("type" to j("text"), "text" to j(text), "marks" to jarr(listOf(jobj("type" to j("link"), "attrs" to jobj("href" to j(href))))))
        else jobj("type" to j("text"), "text" to j(text))
    }

    /** A body made from typed text: one paragraph per line, with web addresses as links. */
    fun fromText(text: String): JsonElement {
        val t = text.replace("\r\n", "\n").replace("\r", "\n").trim('\n')
        // As the web's box reads what's typed: "- " or "• " starts a bulleted list, "1. " a numbered one, "> " a quote
        // and "# " or "## " a heading; anything else is a paragraph.
        fun paragraph(line: String) = if (line.isEmpty()) jobj("type" to j("paragraph")) else jobj("type" to j("paragraph"), "content" to jarr(inlineWithLinks(line)))
        fun item(line: String) = jobj("type" to j("listItem"), "content" to jarr(listOf(paragraph(line))))
        val blocks = mutableListOf<JsonElement>()
        val bullets = mutableListOf<JsonElement>()
        val numbers = mutableListOf<JsonElement>()
        val quoted = mutableListOf<JsonElement>()
        var start = 1
        fun flush() {
            if (bullets.isNotEmpty()) { blocks.add(jobj("type" to j("bulletList"), "content" to jarr(bullets.toList()))); bullets.clear() }
            if (numbers.isNotEmpty()) { blocks.add(jobj("type" to j("orderedList"), "attrs" to jobj("start" to j(start)), "content" to jarr(numbers.toList()))); numbers.clear() }
            if (quoted.isNotEmpty()) { blocks.add(jobj("type" to j("blockquote"), "content" to jarr(quoted.toList()))); quoted.clear() }
        }
        for (line in t.split("\n")) {
            val bullet = Regex("[-•*] (.*)").matchEntire(line)
            val number = Regex("(\\d{1,4})\\. (.*)").matchEntire(line)
            val quote = Regex("> ?(.*)").matchEntire(line)
            val heading = Regex("(#{1,3}) (.+)").matchEntire(line)
            when {
                bullet != null -> { if (bullets.isEmpty()) flush(); bullets.add(item(bullet.groupValues[1])) }
                number != null -> { if (numbers.isEmpty()) { flush(); start = number.groupValues[1].toInt() }; numbers.add(item(number.groupValues[2])) }
                quote != null -> { if (quoted.isEmpty()) flush(); quoted.add(paragraph(quote.groupValues[1])) }
                heading != null -> { flush(); blocks.add(jobj("type" to j("heading"), "attrs" to jobj("level" to j(heading.groupValues[1].length)), "content" to jarr(inlineWithLinks(heading.groupValues[2])))) }
                else -> { flush(); blocks.add(paragraph(line)) }
            }
        }
        flush()
        return jobj("type" to j("doc"), "content" to jarr(blocks))
    }

    /** Web addresses in the body, from links and from addresses typed as plain text, each once and in order. */
    fun linkUrls(content: JsonElement): List<String> {
        val urls = LinkedHashSet<String>()
        walk(content) { n ->
            if (type(n) != "text") return@walk
            val href = n["marks"].arr?.firstOrNull { it["type"].str == "link" }?.get("attrs")?.get("href").str
            if (href != null && (href.lowercase().startsWith("http://") || href.lowercase().startsWith("https://"))) urls.add(href)
            else urlInText.findAll(n["text"].str ?: "").forEach { urls.add(it.value) }
        }
        return urls.toList()
    }

    fun siteName(url: String): String = runCatching { URI(url).host?.removePrefix("www.") }.getOrNull() ?: url

    fun isImageUrl(url: String): Boolean = runCatching {
        Regex("""(?i).*\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)""").matches(URI(url).path ?: "")
    }.getOrDefault(false)

    fun hasPhoto(content: JsonElement) = photoIds(content).isNotEmpty() || linkUrls(content).any(::isImageUrl)

    fun checklistProgress(content: JsonElement): Pair<Int, Int>? {
        var done = 0
        var total = 0
        walk(content) { n ->
            if (type(n) == "taskItem") {
                total++
                if (n["attrs"]["checked"].bool == true) done++
            }
        }
        return if (total > 0) done to total else null
    }

    // Files

    data class Cue(val start: Double, val text: String)

    data class FileInfo(
        val id: String,
        val name: String,
        val mime: String?,
        val size: Long?,
        val poster: String? = null,
        val width: Double? = null,
        val height: Double? = null,
        val duration: Double? = null,
        val transcript: String? = null,
        val language: String? = null,
        val cues: List<Cue> = emptyList(),
        val peaks: List<Double> = emptyList(),
    ) {
        val isVideo get() = mime?.startsWith("video/") == true
        val isAudio get() = mime?.startsWith("audio/") == true
    }

    private fun positive(v: JsonElement?) = v.double?.takeIf { it.isFinite() && it > 0 }

    fun files(content: JsonElement): List<FileInfo> {
        val out = mutableListOf<FileInfo>()
        walk(content) { n ->
            if (type(n) != "file") return@walk
            val a = n["attrs"]
            val id = a["id"].str ?: return@walk
            val mime = a["mime"].str?.takeIf { it.isNotEmpty() }
            var f = FileInfo(id, a["name"].str?.takeIf { it.isNotEmpty() } ?: "Untitled", mime, a["size"].long?.takeIf { it >= 0 })
            if (f.isVideo) f = f.copy(poster = a["poster"].str?.takeIf { it.isNotEmpty() }, width = positive(a["width"]), height = positive(a["height"]), duration = positive(a["duration"]))
            if (f.isAudio) f = f.copy(
                duration = positive(a["duration"]), transcript = a["transcript"].str, language = a["language"].str?.takeIf { it.isNotEmpty() },
                cues = a["cues"].arr?.mapNotNull { c -> val s = c["start"].double; val t = c["text"].str; if (s != null && s >= 0 && t != null) Cue(s, t) else null } ?: emptyList(),
                peaks = a["peaks"].arr?.mapNotNull { it.double?.coerceIn(0.0, 100.0) } ?: emptyList(),
            )
            out.add(f)
        }
        return out
    }

    sealed class Media(open val id: String) {
        /** `ratio`, its width over its height, where its block says (one added since 2026-11-26 keeps its size). */
        data class Photo(override val id: String, val ratio: Double? = null) : Media(id)
        data class Video(val file: FileInfo) : Media(file.id)
    }

    fun media(content: JsonElement): List<Media> {
        val items = mutableListOf<Media>()
        walk(content) { n ->
            if (type(n) == "photo") n["attrs"]["id"].str?.let {
                val w = positive(n["attrs"]["width"])
                val h = positive(n["attrs"]["height"])
                items.add(Media.Photo(it, if (w != null && h != null) w / h else null))
            }
            if (type(n) == "file") files(n).firstOrNull()?.takeIf { it.isVideo }?.let { items.add(Media.Video(it)) }
        }
        return items
    }

    fun posterId(videoId: String) = "$videoId-poster"

    fun clipLength(seconds: Double): String {
        val s = maxOf(0, Math.round(seconds).toInt())
        val h = s / 3600
        val m = (s % 3600) / 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s % 60) else "%d:%02d".format(m, s % 60)
    }

}
