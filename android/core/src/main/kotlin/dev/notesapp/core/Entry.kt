package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * What the journal box turns typed text into, as the web app's `entry.ts`: `[] ` or `TODO ` (or `#todo`) makes a
 * todo, `#diary` files it in the Diary vault, any other `#tag` files it under that tag, and on a todo `@tomorrow`,
 * `@fri` or `@2026-12-01` sets the due date, `@3pm` its time, and `@weekly` or `@every-2-weeks` makes it repeat.
 */
data class Entry(
    val kind: Kind,
    val diary: Boolean = false,
    /** A todo's first line. Notes have none and are named by their first line. */
    val title: String,
    val content: JsonElement,
    /** Tag names as typed, without `#`, each once. Never `todo` or `diary`. */
    val tags: List<String>,
    val due: String? = null,
    val dueTime: String? = null,
    val repeat: Repeat? = null,
    val done: Boolean = false,
    /** An imported file's: the ID it's saved under. */
    val id: String? = null,
    val pages: List<JsonElement> = emptyList(),
    val start: String? = null,
    val createdAt: Long? = null,
    val template: Boolean = false,
) {
    enum class Kind { note, todo }
}

object EntryParser {
    private val todoMarker = Regex("""^(?:\[[ xX]?\]\s*|TODO\s+)""")
    private val doneMarker = Regex("""^\[[xX]\]""")
    val tag = Regex("""(^|\s)#([\p{L}\p{N}_-]+)""")
    val dueWord = Regex("""(^|\s)@([\p{L}\p{N}:-]+)""")
    private val tagsOnly = Regex("""^\s*(#[\p{L}\p{N}_-]+\s*)+$""")
    private val weekdays = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

    /** `@today`, `@tomorrow`, `@2026-12-01`, or a weekday (`@fri`) meaning the next one after today. */
    fun parseDue(word: String, today: String): String? {
        val w = word.lowercase()
        if (w == "today") return today
        if (w == "tomorrow") return DateKey.adding(1, today)
        if (DateKey.isKey(word)) return word
        if (w.length < 3) return null
        val day = weekdays.indexOfFirst { it.startsWith(w) }.takeIf { it >= 0 } ?: return null
        val now = DateKey.weekday(today).value - 1
        val ahead = (day - now + 7) % 7
        return DateKey.adding(if (ahead == 0) 7 else ahead, today)
    }

    enum class DueKind { date, time, repeat }

    fun dueKind(word: String, today: String): DueKind? = when {
        parseDue(word, today) != null -> DueKind.date
        TimeKey.parse(word) != null -> DueKind.time
        parseRepeat(word) != null -> DueKind.repeat
        else -> null
    }

    /** One entry from typed text; null if it holds nothing but markers. */
    fun parseEntry(text: String, today: String): Entry? {
        val lines = text.replace("\r\n", "\n").split("\n").toMutableList()
        val first = lines.indexOfFirst { it.isNotBlank() }
        var marked = false
        var done = false
        if (first >= 0) {
            val head = lines[first].trimStart()
            marked = todoMarker.containsMatchIn(head)
            done = marked && doneMarker.containsMatchIn(head)
            if (marked) lines[first] = head.replaceFirst(todoMarker, "")
        }
        val body = Doc.fromText(lines.joinToString("\n").trim())
        return entryFrom(body["content"].arr ?: emptyList(), marked, done, emptyList(), today)
    }

    /** Several entries from one text: each line starting with `[] ` or `TODO ` begins a new one. */
    fun parseEntries(text: String, today: String, allTodos: Boolean = false): List<Entry> {
        val lines = text.replace("\r\n", "\n").split("\n").toMutableList()
        val shared = mutableListOf<String>()
        while (lines.isNotEmpty() && (lines.last().isBlank() || tagsOnly.matches(lines.last()))) {
            val last = lines.removeAt(lines.size - 1).trim()
            if (last.isNotEmpty()) shared.add(0, last)
        }
        val chunks = mutableListOf<MutableList<String>>()
        for (line in lines) {
            val marked = todoMarker.containsMatchIn(line.trimStart())
            if (allTodos) {
                if (line.isNotBlank()) chunks.add(mutableListOf(if (marked) line else "[] " + line.trimStart()))
            } else if (marked || chunks.isEmpty()) chunks.add(mutableListOf(line)) else chunks.last().add(line)
        }
        val tags = shared.joinToString(" ")
        val suffix = if (tags.isEmpty()) "" else "\n$tags"
        val texts = if (chunks.size > 1) chunks.map { it.joinToString("\n") + suffix } else listOf((chunks.firstOrNull()?.joinToString("\n") ?: "") + suffix)
        return texts.mapNotNull { parseEntry(it, today) }
    }

    private fun isEmptyBlock(b: JsonElement) =
        Doc.type(b) == "paragraph" && Doc.inlineText(b).isBlank() && (b["content"].arr ?: emptyList()).all { Doc.type(it) == "text" }

    private fun hasSubstance(blocks: List<JsonElement>) = blocks.any { b ->
        Doc.inlineText(b).isNotBlank() || Doc.photoIds(b).isNotEmpty() || Doc.fileIds(b).isNotEmpty() || Doc.type(b) == "horizontalRule"
    }

    private fun taskItems(list: JsonElement): List<JsonElement> = (list["content"].arr ?: emptyList()).flatMap { item ->
        val children = item["content"].arr ?: emptyList()
        val own = (item as JsonObject).with("content", jarr(children.filter { Doc.type(it) != "taskList" }))
        listOf<JsonElement>(own) + children.filter { Doc.type(it) == "taskList" }.flatMap(::taskItems)
    }

    /** Entries from the journal box's rich text: each checkbox a todo, the blocks between them one note. */
    fun entries(doc: JsonElement, today: String): List<Entry> {
        val blocks = (doc["content"].arr ?: emptyList()).toMutableList()
        val shared = mutableListOf<String>()
        while (blocks.isNotEmpty()) {
            val last = blocks.last()
            if (isEmptyBlock(last)) blocks.removeAt(blocks.size - 1)
            else if (Doc.type(last) == "paragraph" && tagsOnly.matches(Doc.inlineText(last))) {
                blocks.removeAt(blocks.size - 1)
                shared.add(0, Doc.inlineText(last).trim())
            } else break
        }
        data class Chunk(val todo: Boolean, val done: Boolean, val blocks: MutableList<JsonElement>)
        val chunks = mutableListOf<Chunk>()
        for (block in blocks) {
            if (Doc.type(block) == "taskList") {
                for (item in taskItems(block)) chunks.add(Chunk(true, item["attrs"]["checked"].bool == true, (item["content"].arr ?: emptyList()).toMutableList()))
                continue
            }
            val text = if (Doc.type(block) == "paragraph") Doc.inlineText(block).trimStart() else ""
            if (todoMarker.containsMatchIn(text)) {
                chunks.add(Chunk(true, doneMarker.containsMatchIn(text), strip(listOf(block), Regex("""^(\s*)(\[[ xX]?\]\s*|TODO\s+)""")) { true }.toMutableList()))
                continue
            }
            val last = chunks.lastOrNull()
            if (last != null && !last.todo) last.blocks.add(block) else chunks.add(Chunk(false, false, mutableListOf(block)))
        }
        val sharedTags = Regex("""#([\p{L}\p{N}_-]+)""").findAll(shared.joinToString(" ")).map { it.groupValues[1] }.toList()
        return chunks.mapNotNull { entryFrom(it.blocks, it.todo, it.done, sharedTags, today) }
    }

    /** Removes matching words from the text in some blocks, leaving code alone. A paragraph left empty goes away. */
    fun strip(blocks: List<JsonElement>, pattern: Regex, take: (String) -> Boolean): List<JsonElement> {
        fun inText(node: JsonElement): Pair<JsonElement, Boolean> {
            val type = Doc.type(node)
            if (type == "codeBlock" || (type == "text" && "code" in Doc.marks(node))) return node to false
            if (type == "text") {
                var touched = false
                val text = pattern.replace(node["text"].str ?: "") { m ->
                    if (!take(m.groupValues[2])) m.value else {
                        touched = true
                        m.groupValues[1]
                    }
                }
                if (!touched) return node to false
                return (node as JsonObject).with("text", j(text.replace(Regex("[ \t]{2,}"), " "))) to true
            }
            val children = node["content"].arr ?: return node to false
            var touched = false
            val kept = mutableListOf<JsonElement>()
            for (child in children) {
                val (n, t) = inText(child)
                touched = touched || t
                if (Doc.type(n) == "text" && (n["text"].str ?: "").isEmpty()) continue
                kept.add(n)
            }
            return (node as JsonObject).with("content", jarr(kept)) to touched
        }
        return blocks.flatMap { block ->
            val (node, touched) = inText(block)
            if (!touched || Doc.type(node) != "paragraph") return@flatMap listOf(node)
            val content = (node["content"].arr ?: emptyList()).toMutableList()
            content.firstOrNull()?.let { head -> if (Doc.type(head) == "text") content[0] = (head as JsonObject).with("text", j((head["text"].str ?: "").trimStart())) }
            content.lastOrNull()?.let { last -> if (Doc.type(last) == "text") content[content.size - 1] = (last as JsonObject).with("text", j((last["text"].str ?: "").trimEnd())) }
            val kept = content.filter { Doc.type(it) != "text" || !(it["text"].str ?: "").isEmpty() }
            if (kept.isEmpty()) emptyList() else listOf((node as JsonObject).with("content", jarr(kept)))
        }
    }

    private fun entryFrom(blocks: List<JsonElement>, todoIn: Boolean, done: Boolean, shared: List<String>, today: String): Entry? {
        var todo = todoIn
        var diary = false
        val tags = mutableListOf<String>()
        fun addTag(name: String) {
            when (name.lowercase()) {
                "todo" -> todo = true
                "diary" -> diary = true
                else -> if (tags.none { it.equals(name, ignoreCase = true) }) tags.add(name)
            }
        }
        var body = strip(blocks, tag) { addTag(it); true }
        shared.forEach(::addTag)
        var date: String? = null
        var time: String? = null
        var rule: Repeat? = null
        if (todo) body = strip(body, dueWord) { word ->
            when (dueKind(word, today)) {
                DueKind.date -> { date = parseDue(word, today); true }
                DueKind.time -> { time = TimeKey.parse(word); true }
                DueKind.repeat -> { rule = parseRepeat(word); true }
                null -> false
            }
        }
        fun trim(list: List<JsonElement>) = list.dropWhile(::isEmptyBlock).dropLastWhile(::isEmptyBlock)
        body = trim(body)
        if (!hasSubstance(body)) return null
        if (!todo) return Entry(Entry.Kind.note, diary, "", Doc.of(body), tags)
        val title = Doc.inlineText(body[0]).trim()
        val details = trim(if (title.isEmpty()) body else body.drop(1))
        val due = date ?: rule?.firstDue(today) ?: if (time != null) today else null
        return Entry(
            Entry.Kind.todo, diary, title.ifEmpty { "Photo" }, if (details.isEmpty()) Doc.fromText("") else Doc.of(details), tags,
            due = due, dueTime = if (due == null) null else time, repeat = if (due == null) null else rule, done = done,
        )
    }
}

@Suppress("unused")
private val keepImport = JsonPrimitive("")
