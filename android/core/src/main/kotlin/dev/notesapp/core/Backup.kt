package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/** Backups, Markdown export and import, as the web app's `backup.ts`, `importNotes.ts` and `markdownIn.ts`. */
object Backup {
    const val FORMAT = "notes-app-backup"

    class BackupError(message: String) : Exception(message)

    fun cardJson(c: Card): JsonObject = JsonObject(
        c.payload + mapOf(
            "id" to j(c.id), "vaultId" to j(c.vaultId), "updatedAt" to j(c.updatedAt), "deleted" to j(c.deleted), "seq" to j(c.seq),
            "createdAt" to (c.payload["createdAt"] ?: j(c.createdAt)),
        ),
    )

    fun make(vaults: List<Vault>, cards: List<Card>, now: Long = System.currentTimeMillis()): String = jobj(
        "format" to j(FORMAT), "version" to j(1), "exportedAt" to j(Instant.ofEpochMilli(now).toString()),
        "vaults" to jarr(vaults.map { json.encodeToJsonElement(Vault.serializer(), it) }), "cards" to jarr(cards.map(::cardJson)),
    ).sortedText()

    private fun isCard(c: JsonObject): Boolean {
        val type = c["type"].str?.let { t -> CardType.entries.firstOrNull { it.name == t } } ?: return false
        if (c["id"].str.isNullOrEmpty() || c["vaultId"].str == null || c["updatedAt"].double == null || c["createdAt"].double == null) return false
        if (c["title"].str == null || c["content"]["type"].str != "doc" || c["tags"].arr?.all { it.str != null } != true) return false
        if (c["deleted"] != null && c["deleted"].bool == null) return false
        return when (type) {
            CardType.todo -> c["status"].str in setOf("open", "done") && (c["due"].isNull || DateKey.isKey(c["due"].str))
            CardType.tag -> c["pinned"].bool != null
            CardType.note -> true
        }
    }

    fun parse(text: String): List<Card> {
        val root = parseJson(text)?.obj ?: throw BackupError("That file is not valid JSON.")
        if (root["format"].str != FORMAT) throw BackupError("That file is not a backup from this app.")
        if (root["version"].long != 1L) throw BackupError("This backup uses a version this app can't read.")
        val list = root["cards"].arr ?: throw BackupError("That backup is damaged: some cards are missing required fields.")
        return list.map { v ->
            val o = modernPayload(v.obj ?: throw BackupError("That backup is damaged: some cards are missing required fields."))
            if (!isCard(o)) throw BackupError("That backup is damaged: some cards are missing required fields.")
            Card(o["id"].str!!, o["vaultId"].str!!, o["updatedAt"].long ?: 0, o["deleted"].bool ?: false, 0, JsonObject(o - setOf("id", "vaultId", "updatedAt", "deleted", "seq")))
        }
    }

    data class File(val path: String, val text: String)

    private fun safeName(title: String): String {
        val name = title.replace(Regex("""[/\\:*?"<>|\x00-\x1f]"""), " ").replace(Regex("\\s+"), " ").trim().trimStart('.')
        return name.take(80).trim().ifEmpty { "Untitled" }
    }

    private fun yaml(s: String) = j(s).toString()

    fun markdownFiles(index: CardIndex): List<File> {
        val used = mutableSetOf<String>()
        val folder = mapOf(CardType.note to "notes", CardType.todo to "todos", CardType.tag to "tags")
        return index.live.map { card ->
            val base = safeName(card.title)
            var path = "${folder[card.type]}/$base.md"
            var n = 2
            while (path.lowercase() in used) path = "${folder[card.type]}/$base (${n++}).md"
            used.add(path.lowercase())
            val front = mutableListOf("id: ${card.id}", "type: ${card.type.name}", "title: ${yaml(card.title)}")
            if (card.template) front.add("template: true")
            if (card.type == CardType.todo) {
                front.add("status: ${if (card.isDone) "done" else "open"}")
                card.start?.let { front.add("start: $it") }
                card.due?.let { d -> front.add("due: $d"); card.dueTime?.let { front.add("time: \"$it\"") }; card.repeat?.let { front.add("repeat: ${it.word}") } }
            }
            val tags = index.resolveTags(card.tags)
            if (tags.isNotEmpty()) front.add("tags: [${tags.joinToString(", ") { yaml(it.title) }}]")
            front.add("created: ${Instant.ofEpochMilli(card.createdAt)}")
            front.add("updated: ${Instant.ofEpochMilli(card.updatedAt)}")
            val pages = card.turnPages.withIndex().joinToString("") { (i, p) -> "\n\n## Page ${i + 2}\n\n" + Markdown.from(p, index.titleOf) }
            val entries = if (card.isStack) index.stackEntries(card) else emptyList()
            val stacked = if (entries.isEmpty()) "" else "\n\n## In this stack\n\n" + entries.withIndex().joinToString("\n") { (i, e) -> "${i + 1}. [[${index.linkTitle(e.id, e.displayTitle)}]]" }
            File(path, "---\n${front.joinToString("\n")}\n---\n\n# ${card.title}\n\n${Markdown.from(card.content, index.titleOf)}$pages$stacked\n")
        }
    }

    fun zip(files: List<File>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z -> for (f in files) { z.putNextEntry(ZipEntry(f.path)); z.write(f.text.toByteArray()); z.closeEntry() } }
        return out.toByteArray()
    }

    /** The Markdown and text files in a zip, hidden files and macOS's extras left out. */
    fun filesFromZip(bytes: ByteArray): List<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                val name = e.name
                val hidden = name.split("/").any { it.startsWith(".") || it == "__MACOSX" }
                if (!e.isDirectory && !hidden && Regex("""(?i).*\.(md|markdown|mdown|txt)""").matches(name)) out.add(name to z.readBytes().decodeToString())
            }
        }
        return out
    }
}

/** Markdown, as AI apps and other notes apps write it, as card bodies; Markdown files as entries. */
object MarkdownImport {
    fun interface LinkResolver { fun resolve(title: String): Pair<String, String>? }

    private val inlinePattern = Regex(
        """\\([\\`*_~\[\]()#>!|-])|`([^`]+)`|\[\[([^\]\n]+?)\]\]|\[([^\]\n]+)\]\((https?://[^\s)]+|mailto:[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\|\|(?!\s)(.+?)\|\||\*(?!\s)(.+?)\*|(?<![\p{L}\p{N}])_(?!\s)(.+?)_(?![\p{L}\p{N}])""",
    )

    private fun withMark(nodes: List<JsonElement>, mark: JsonElement) = nodes.map { n ->
        if (Doc.type(n) != "text") n else (n as JsonObject).with("marks", jarr((n["marks"].arr ?: emptyList()) + mark))
    }

    private fun inline(text: String, resolve: LinkResolver): List<JsonElement> {
        val out = mutableListOf<JsonElement>()
        fun push(t: String) {
            if (t.isEmpty()) return
            val last = out.lastOrNull()
            if (last != null && Doc.type(last) == "text" && last["marks"] == null) out[out.size - 1] = (last as JsonObject).with("text", j((last["text"].str ?: "") + t))
            else out.add(jobj("type" to j("text"), "text" to j(t)))
        }
        var at = 0
        for (m in inlinePattern.findAll(text)) {
            push(text.substring(at, m.range.first))
            at = m.range.last + 1
            val g = m.groups
            when {
                g[1] != null -> push(g[1]!!.value)
                g[2] != null -> out.add(jobj("type" to j("text"), "text" to j(g[2]!!.value), "marks" to jarr(listOf(jobj("type" to j("code"))))))
                g[3] != null -> {
                    val target = resolve.resolve(g[3]!!.value.trim())
                    if (target != null) out.add(jobj("type" to j("cardLink"), "attrs" to jobj("id" to j(target.first), "label" to j(target.second)))) else push(m.value)
                }
                g[4] != null -> out += withMark(inline(g[4]!!.value, resolve), jobj("type" to j("link"), "attrs" to jobj("href" to j(g[5]!!.value))))
                g[6] != null || g[7] != null -> out += withMark(inline((g[6] ?: g[7])!!.value, resolve), jobj("type" to j("bold")))
                g[8] != null -> out += withMark(inline(g[8]!!.value, resolve), jobj("type" to j("strike")))
                g[9] != null -> out += withMark(inline(g[9]!!.value, resolve), jobj("type" to j("hidden")))
                else -> out += withMark(inline((g[10] ?: g[11])!!.value, resolve), jobj("type" to j("italic")))
            }
        }
        push(text.substring(at))
        return out
    }

    private fun paragraph(lines: List<String>, resolve: LinkResolver): JsonElement {
        val content = mutableListOf<JsonElement>()
        lines.forEachIndexed { i, l -> if (i > 0) content.add(jobj("type" to j("hardBreak"))); content += inline(l.trim(), resolve) }
        return if (content.isEmpty()) jobj("type" to j("paragraph")) else jobj("type" to j("paragraph"), "content" to jarr(content))
    }

    private val listItem = Regex("""^(\s*)([-*+]|\d+[.)])\s+(.*)$""")
    private val taskBox = Regex("""^\[([ xX])\](?:\s+|$)""")
    private val photo = Regex("""^!\[([^\]]*)\]\(attachment:([\w-]{8,64})\)$""")
    private val file = Regex("""^\[([^\]]*)\]\(attachment:([\w-]{8,64})\)$""")
    private val rule = Regex("""^([-*_])(\s*\1){2,}$""")
    private fun indentOf(line: String) = line.takeWhile { it == ' ' || it == '\t' }.sumOf { if (it == '\t') 2 else 1 as Int }
    private fun startsBlock(line: String): Boolean {
        val t = line.trim()
        return Regex("""^(```|~~~|#{1,6}\s|>)""").containsMatchIn(t) || photo.matches(t) || file.matches(t) || listItem.matches(line) || rule.matches(t)
    }

    private fun blocks(lines: List<String>, resolve: LinkResolver): List<JsonElement> {
        val out = mutableListOf<JsonElement>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val t = line.trim()
            if (t.isEmpty()) { i++; continue }
            Regex("""^(```|~~~)\s*([\w+-]*)""").find(t)?.let { fence ->
                val body = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith(fence.groupValues[1])) body.add(lines[i++])
                i++
                val text = body.joinToString("\n")
                var node = jobj("type" to j("codeBlock"), "attrs" to jobj("language" to j(fence.groupValues[2].ifEmpty { null })))
                if (text.isNotEmpty()) node = node.with("content", jarr(listOf(jobj("type" to j("text"), "text" to j(text)))))
                out.add(node)
                return@let
            }?.let { continue }
            Regex("""^(#{1,6})\s+(.*?)\s*#*$""").matchEntire(t)?.let { h ->
                val content = inline(h.groupValues[2], resolve)
                var node = jobj("type" to j("heading"), "attrs" to jobj("level" to j(minOf(h.groupValues[1].length, 3))))
                if (content.isNotEmpty()) node = node.with("content", jarr(content))
                out.add(node); i++; return@let
            }?.let { continue }
            photo.matchEntire(t)?.let { out.add(jobj("type" to j("photo"), "attrs" to jobj("id" to j(it.groupValues[2]), "alt" to j(it.groupValues[1].ifEmpty { null })))); i++; return@let }?.let { continue }
            file.matchEntire(t)?.let { out.add(jobj("type" to j("file"), "attrs" to jobj("id" to j(it.groupValues[2]), "name" to j(it.groupValues[1].ifEmpty { "File" }), "mime" to kotlinx.serialization.json.JsonNull, "size" to kotlinx.serialization.json.JsonNull))); i++; return@let }?.let { continue }
            if (rule.matches(t)) { out.add(jobj("type" to j("horizontalRule"))); i++; continue }
            if (t.startsWith(">")) {
                val quoted = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) quoted.add(lines[i++].trim().replace(Regex("""^>\s?"""), ""))
                out.add(jobj("type" to j("blockquote"), "content" to jarr(blocksOrEmpty(quoted, resolve))))
                continue
            }
            if (listItem.matches(line)) {
                val (list, next) = parseList(lines, i, resolve)
                out.add(list); i = next; continue
            }
            val para = mutableListOf<String>()
            while (i < lines.size && lines[i].isNotBlank() && !startsBlock(lines[i])) para.add(lines[i++])
            if (para.isEmpty()) para.add(lines[i++])
            out.add(paragraph(para, resolve))
        }
        return out
    }

    private fun blocksOrEmpty(lines: List<String>, resolve: LinkResolver) = blocks(lines, resolve).ifEmpty { listOf(jobj("type" to j("paragraph"))) }

    private fun parseList(lines: List<String>, start: Int, resolve: LinkResolver): Pair<JsonElement, Int> {
        val first = listItem.matchEntire(lines[start])!!
        val base = indentOf(lines[start])
        val ordered = first.groupValues[2].any(Char::isDigit)
        val items = mutableListOf<JsonElement>()
        val boxes = mutableListOf<Boolean?>()
        var i = start
        while (i < lines.size) {
            val m = listItem.matchEntire(lines[i]) ?: break
            if (indentOf(lines[i]) != base || m.groupValues[2].any(Char::isDigit) != ordered) break
            val rest = m.groupValues[3]
            val box = if (ordered) null else taskBox.find(rest)
            boxes.add(box?.let { it.groupValues[1] != " " })
            val body = mutableListOf(box?.let { rest.substring(it.range.last + 1) } ?: rest)
            i++
            while (i < lines.size) {
                val l = lines[i]
                if (l.isBlank()) {
                    if (i + 1 < lines.size && lines[i + 1].isNotBlank() && indentOf(lines[i + 1]) > base) { body.add(""); i++; continue }
                    break
                }
                if (indentOf(l) > base) body.add(l.drop(minOf(l.takeWhile { it == ' ' || it == '\t' }.length, base + 2)))
                else if (!startsBlock(l) && !listItem.matches(l)) body.add(l) else break
                i++
            }
            items.add(jobj("type" to j("listItem"), "content" to jarr(blocksOrEmpty(body, resolve))))
        }
        if (!ordered && boxes.all { it != null }) {
            return jobj("type" to j("taskList"), "content" to jarr(items.mapIndexed { n, it -> jobj("type" to j("taskItem"), "attrs" to jobj("checked" to j(boxes[n]!!)), "content" to it["content"]) })) to i
        }
        val startAt = if (ordered) first.groupValues[2].filter(Char::isDigit).toIntOrNull() ?: 1 else 1
        var list = jobj("type" to j(if (ordered) "orderedList" else "bulletList"), "content" to jarr(items))
        if (ordered && startAt != 1) list = list.with("attrs", jobj("start" to j(startAt)))
        return list to i
    }

    fun doc(markdown: String, resolve: LinkResolver = LinkResolver { null }): JsonElement {
        val content = blocks(markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"), resolve)
        return Doc.of(content)
    }

    private fun scalar(raw: String): String {
        val v = raw.trim()
        if (v.length > 1 && v.startsWith("\"") && v.endsWith("\"")) return parseJson(v).str ?: v.substring(1, v.length - 1)
        if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) return v.substring(1, v.length - 1).replace("''", "'")
        return v
    }

    private fun splitFrontMatter(text: String): Pair<Map<String, List<String>>, String> {
        val src = text.removePrefix("﻿").replace("\r\n", "\n")
        val lines = src.split("\n")
        if (lines.firstOrNull()?.trim() != "---") return emptyMap<String, List<String>>() to src
        val end = (1 until lines.size).firstOrNull { lines[it].trim() == "---" || lines[it].trim() == "..." } ?: return emptyMap<String, List<String>>() to src
        val fields = mutableMapOf<String, MutableList<String>>()
        var listKey: String? = null
        for (line in lines.subList(1, end)) {
            Regex("""\s*-\s+(.*)""").matchEntire(line)?.let { m -> listKey?.let { fields.getOrPut(it) { mutableListOf() }.add(scalar(m.groupValues[1])) }; if (listKey != null) return@let true else null }?.let { continue }
            val pair = Regex("""([\w-]+)\s*:\s*(.*)""").matchEntire(line) ?: continue
            val key = pair.groupValues[1].lowercase()
            val value = pair.groupValues[2].trim()
            listKey = null
            if (value.isEmpty()) { fields[key] = mutableListOf(); listKey = key }
            else if (value.startsWith("[") && value.endsWith("]")) {
                fields[key] = Regex("""\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)""").findAll(value.substring(1, value.length - 1)).map { scalar(it.groupValues[1]) }.filter { it.isNotEmpty() }.toMutableList()
            } else fields[key] = mutableListOf(scalar(value))
        }
        return fields to lines.drop(end + 1).joinToString("\n")
    }

    private fun baseName(path: String) = path.substringAfterLast('/').replace(Regex("""(?i)\.(md|markdown|mdown|txt)$"""), "")

    /** Files as entries, one per file, titled by front matter, a first heading or the file's name. */
    fun entries(files: List<Pair<String, String>>, today: String, now: Long = System.currentTimeMillis()): List<Entry> {
        data class P(val path: String, val fields: Map<String, List<String>>, val named: String?, val title: String, val text: String, val id: String)
        val parsed = files.map { (name, text) ->
            val (fields, body) = splitFrontMatter(text)
            val lines = body.split("\n")
            val first = lines.indexOfFirst { it.isNotBlank() }
            val m = if (first >= 0) Regex("""#\s+(.*?)\s*#*""").matchEntire(lines[first].trim()) else null
            val heading = m?.groupValues?.get(1)?.trim()
            val rest = if (m != null) lines.drop(first + 1).joinToString("\n") else body
            val named = fields["title"]?.firstOrNull()?.takeIf { it.isNotBlank() } ?: heading
            val title = named ?: baseName(name)
            P(name, fields, named, title, if (heading != null && heading != title) body else rest, java.util.UUID.randomUUID().toString())
        }
        val byName = mutableMapOf<String, Pair<String, String>>()
        for (p in parsed) for (k in listOf(baseName(p.path), p.title)) byName[k.lowercase()] = p.id to p.title
        val resolve = LinkResolver { raw -> byName[raw.substringBefore('|').substringBefore('#').trim().lowercase()] }
        val out = mutableListOf<Entry>()
        for (p in parsed) {
            val type = p.fields["type"]?.firstOrNull()?.lowercase()
            if (type == "tag") continue
            var own = p.text
            if (p.fields["id"] != null) own = own.substringBefore("\n## In this stack\n")
            val parts = mutableListOf(mutableListOf<String>())
            for (line in own.split("\n")) {
                val m = Regex("""(?i)##\s+Page\s+(\d+)""").matchEntire(line.trim())
                if (m != null && m.groupValues[1].toInt() == parts.size + 1) parts.add(mutableListOf()) else parts.last().add(line)
            }
            val content = doc(parts[0].joinToString("\n"), resolve)
            val pages = parts.drop(1).map { doc(it.joinToString("\n"), resolve) }.filterNot(Doc::isBlank)
            if (p.named.isNullOrBlank() && Doc.isBlank(content) && pages.isEmpty()) continue
            val tags = (p.fields["tags"] ?: emptyList()).flatMap { it.split(Regex("""[,\s]+""")) }.map { it.trim().removePrefix("#").trim() }.filter { it.isNotEmpty() }.distinct()
            var e = Entry(if (type == "todo") Entry.Kind.todo else Entry.Kind.note, title = p.title.trim(), content = content, tags = tags, id = p.id, pages = pages)
            (p.fields["created"] ?: p.fields["date"])?.firstOrNull()?.let { c ->
                val at = if (DateKey.isKey(c)) DateKey.parse(c)!!.atTime(12, 0).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() else runCatching { Instant.parse(c).toEpochMilli() }.getOrNull()
                if (at != null) e = e.copy(createdAt = minOf(at, now))
            }
            if (p.fields["template"]?.firstOrNull() == "true") e = e.copy(template = true)
            if (e.kind == Entry.Kind.todo) {
                p.fields["due"]?.firstOrNull()?.takeIf(DateKey::isKey)?.let { d ->
                    e = e.copy(due = d, dueTime = p.fields["time"]?.firstOrNull()?.takeIf(TimeKey::isKey), repeat = parseRepeat(p.fields["repeat"]?.firstOrNull() ?: ""))
                }
                p.fields["start"]?.firstOrNull()?.takeIf { DateKey.isKey(it) && (e.due == null || it <= e.due!!) }?.let { e = e.copy(start = it) }
                if (Regex("(?i)done|completed|closed").matches(p.fields["status"]?.firstOrNull() ?: "") || p.fields["done"]?.firstOrNull() == "true") e = e.copy(done = true)
            }
            out.add(e)
        }
        return out
    }
}
