package dev.notesapp.core

import java.time.format.DateTimeFormatter

/** One bubble in the journal: the day it's grouped under and where it sorts, as the web app's `stream.ts`. */
data class StreamItem(val card: Card, val day: String, val at: Long) {
    val id get() = card.id
}

data class StreamFilter(
    val sort: Sort = Sort.Written,
    val type: EntryType? = null,
    val status: TodoStatus? = null,
    /** `today`, `week`, `month`, a day, or a range written `from..to`. */
    val `when`: String? = null,
    val tagId: String? = null,
    val vaultId: String? = null,
    val has: Contains? = null,
    val archived: Boolean = false,
    val template: Boolean = false,
    /** Shown as a board: a tag group's ID, or `state`. */
    val board: String? = null,
) {
    enum class EntryType { note, todo, stack }
    enum class TodoStatus { open, done, today, upcoming, undated, waiting }
    enum class Contains { link, photo, file }
    sealed class Sort {
        data object Written : Sort()
        data object Newest : Sort()
        data object Edited : Sort()
        data object Due : Sort()
        data class Group(val id: String) : Sort()
    }

    val isFiltered get() = type != null || status != null || `when` != null || tagId != null || vaultId != null || has != null || archived || template
    val effectiveType get() = if (status != null) EntryType.todo else type

    /** The web app's address for this view of the journal, which names its draft. */
    val journalPath: String
        get() {
            val items = mutableListOf<Pair<String, String>>()
            when (sort) {
                Sort.Newest -> items.add("sort" to "newest")
                Sort.Edited -> items.add("sort" to "edited")
                Sort.Due -> items.add("sort" to "due")
                is Sort.Group -> items.add("sort" to "group:${sort.id}")
                Sort.Written -> {}
            }
            type?.let { items.add("type" to it.name) }
            status?.let { items.add("status" to it.name) }
            `when`?.let { items.add("when" to it) }
            tagId?.let { items.add("tag" to it) }
            vaultId?.let { items.add("vault" to it) }
            has?.let { items.add("has" to it.name) }
            if (template) items.add("template" to "1")
            board?.let { items.add("board" to it) }
            val query = items.joinToString("&") { (k, v) -> k + "=" + java.net.URLEncoder.encode(v, "UTF-8") }
            return (if (archived) "/archive" else "/journal") + if (query.isEmpty()) "" else "?$query"
        }
}

object StreamLabels {
    val status = mapOf(
        StreamFilter.TodoStatus.open to "Open", StreamFilter.TodoStatus.done to "Done", StreamFilter.TodoStatus.today to "Due today",
        StreamFilter.TodoStatus.upcoming to "Upcoming", StreamFilter.TodoStatus.undated to "No date", StreamFilter.TodoStatus.waiting to "Waiting",
    )
    val contains = mapOf(StreamFilter.Contains.link to "With links", StreamFilter.Contains.photo to "With photos", StreamFilter.Contains.file to "With files")
    val sorts = listOf(StreamFilter.Sort.Written to "Oldest first", StreamFilter.Sort.Newest to "Newest first", StreamFilter.Sort.Edited to "Recently edited", StreamFilter.Sort.Due to "Due date")
    private val presets = mapOf("today" to "Written today", "week" to "Past 7 days", "month" to "Past 30 days")

    fun sort(sort: StreamFilter.Sort, groups: List<TagGroup>): String =
        if (sort is StreamFilter.Sort.Group) groups.firstOrNull { it.id == sort.id }?.let { "By ${it.title.lowercase()}" } ?: "Oldest first"
        else sorts.firstOrNull { it.first == sort }?.second ?: "Oldest first"

    fun `when`(w: String, today: String): String {
        presets[w]?.let { return it }
        Stream.dayRange(w)?.let { (a, b) ->
            val fmt = DateTimeFormatter.ofPattern(if (a.take(4) != today.take(4) || b.take(4) != today.take(4)) "MMM d, yyyy" else "MMM d")
            return "${DateKey.parse(a)!!.format(fmt)} – ${DateKey.parse(b)!!.format(fmt)}"
        }
        return DateKey.relativeDay(w, today)
    }
}

object Stream {
    fun dayRange(w: String): Pair<String, String>? {
        val m = Regex("""(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})""").matchEntire(w) ?: return null
        val (a, b) = m.destructured
        return if (DateKey.isKey(a) && DateKey.isKey(b) && a <= b) a to b else null
    }

    fun daysWhen(a: String, b: String) = if (a == b) a else if (a < b) "$a..$b" else "$b..$a"

    fun whenRange(w: String, today: String): Pair<String, String> = when (w) {
        "today" -> today to today
        "week" -> DateKey.adding(-6, today) to today
        "month" -> DateKey.adding(-29, today) to today
        else -> dayRange(w) ?: (w to w)
    }

    fun entryDay(card: Card) = DateKey.ofMillis(card.createdAt)

    private fun matchesStatus(c: Card, s: StreamFilter.TodoStatus, today: String): Boolean {
        if (s == StreamFilter.TodoStatus.done) return c.isDone
        if (c.isDone) return false
        return when (s) {
            StreamFilter.TodoStatus.open -> true
            StreamFilter.TodoStatus.waiting -> c.waiting
            else -> if (c.waiting) false else when (s) {
                StreamFilter.TodoStatus.today -> c.due?.let { it <= today } == true
                StreamFilter.TodoStatus.upcoming -> c.due?.let { it > today } == true
                StreamFilter.TodoStatus.undated -> c.due == null
                else -> true
            }
        }
    }

    /** Whether an entry passes a filter. Tags aren't entries, so none does. */
    fun matcher(f: StreamFilter, today: String, sharedInto: SharedInto = emptyMap()): (Card, String?) -> Boolean {
        val type = f.effectiveType
        val (from, to) = f.`when`?.let { whenRange(it, today) } ?: ("" to "9999")
        return { card, dayIn ->
            var ok = card.isEntry
            if (ok && type != null) ok = if (type == StreamFilter.EntryType.stack) card.isStack else card.type.name == type.name && !card.isStack
            if (ok && f.tagId != null) ok = f.tagId in card.tags
            if (ok && f.vaultId != null) ok = card.vaultId == f.vaultId || (sharedInto[card.id] ?: emptyList()).contains(f.vaultId)
            if (ok && f.status != null) ok = card.type == CardType.todo && matchesStatus(card, f.status, today)
            if (ok && f.has != null) ok = when (f.has) {
                StreamFilter.Contains.link -> Doc.linkUrls(card.content).isNotEmpty()
                StreamFilter.Contains.file -> Doc.fileIds(card.content).isNotEmpty()
                StreamFilter.Contains.photo -> Doc.hasPhoto(card.content)
            }
            if (ok && f.archived) ok = card.archived
            if (ok && f.template) ok = card.template
            val d = dayIn ?: entryDay(card)
            ok && d >= from && d <= to
        }
    }

    fun items(index: CardIndex, f: StreamFilter = StreamFilter(), today: String = DateKey.today(), sharedInto: SharedInto = emptyMap()): List<StreamItem> {
        val keep = matcher(f, today, sharedInto)
        val items = index.live.filter { it.isEntry && it.archived == f.archived && it.template == f.template }
            .mapNotNull { c -> val day = entryDay(c); if (keep(c, day)) StreamItem(c, day, c.createdAt) else null }
        val sort = f.sort
        if (sort is StreamFilter.Sort.Group) {
            val group = index.tagGroups.groups.firstOrNull { it.id == sort.id }
            if (group != null) return items.map { i ->
                val r = group.rank(i.card.tags)
                i.copy(day = if (r < group.members.size) group.members[r].id else "") to r
            }.sortedWith(compareBy({ it.second }, { it.first.at })).map { it.first }
        }
        return when (sort) {
            StreamFilter.Sort.Newest -> items.sortedByDescending { it.at }
            StreamFilter.Sort.Edited -> items.map { it.copy(at = it.card.updatedAt, day = DateKey.ofMillis(it.card.updatedAt)) }.sortedBy { it.at }
            StreamFilter.Sort.Due -> {
                fun time(i: StreamItem) = if (i.card.type == CardType.todo) i.card.dueTime ?: "24:00" else "24:00"
                items.map { it.copy(day = if (it.card.type == CardType.todo) it.card.due ?: "" else "") }.sortedWith { a, b ->
                    when {
                        a.day == b.day -> compareValuesBy(a, b, { time(it) }, { it.at })
                        a.day.isEmpty() -> 1
                        b.day.isEmpty() -> -1
                        else -> a.day.compareTo(b.day)
                    }
                }
            }
            else -> items.sortedBy { it.at }
        }
    }

    fun foldStacks(items: List<StreamItem>, stackOf: Map<String, String>): List<StreamItem> {
        if (stackOf.isEmpty()) return items
        val shown = items.map { it.card.id }.toSet()
        return items.filter { i -> stackOf[i.card.id]?.let { it !in shown } ?: true }
    }
}

/** Search across cards, as the web app's MiniSearch: titles count most, words found by their start or a small typo. */
class CardSearch(index: CardIndex) {
    data class Hit(val card: Card, val snippet: String)
    private data class D(val card: Card, val text: String, val fields: List<Pair<Set<String>, Double>>)
    private val docs: List<D> = index.live.map { card ->
        val text = listOf(index.text(card), index.pagesText(card)).filter { it.isNotEmpty() }.joinToString(" ")
        val tags = index.resolveTags(card.tags).joinToString(" ") { it.title }
        D(card, text, listOf(terms(card.title) to 3.0, terms(text) to 1.0, terms(tags) to 2.0))
    }

    fun search(query: String): List<Hit> {
        val words = tokenize(query).map { it.lowercase() }
        if (words.isEmpty()) return emptyList()
        val scored = mutableListOf<Pair<Hit, Double>>()
        for (d in docs) {
            var score = 0.0
            var all = true
            for (w in words) {
                val s = d.fields.sumOf { match(w, it.first) * it.second }
                if (s == 0.0) { all = false; break }
                score += s
            }
            if (all) scored.add(Hit(d.card, snippet(d.text, words)) to score)
        }
        return scored.sortedByDescending { it.second }.map { it.first }
    }

    companion object {
        private fun isCJK(cp: Int) = cp in 0x3040..0x30FF || cp in 0x3400..0x4DBF || cp in 0x4E00..0x9FFF || cp in 0xF900..0xFAFF ||
            cp in 0xAC00..0xD7AF || cp in 0x1100..0x11FF || cp in 0x3130..0x318F || cp in 0x20000..0x2FA1F

        /** Splits on punctuation, and treats each CJK character as its own term. */
        fun tokenize(text: String): List<String> {
            val tokens = mutableListOf<String>()
            for (m in Regex("""[\p{L}\p{M}\p{N}_]+""").findAll(text)) {
                val run = StringBuilder()
                var i = 0
                val w = m.value
                while (i < w.length) {
                    val cp = w.codePointAt(i)
                    val ch = String(Character.toChars(cp))
                    if (isCJK(cp)) {
                        if (run.isNotEmpty()) { tokens.add(run.toString()); run.clear() }
                        tokens.add(ch)
                    } else run.append(ch)
                    i += Character.charCount(cp)
                }
                if (run.isNotEmpty()) tokens.add(run.toString())
            }
            return tokens
        }

        private fun terms(text: String) = tokenize(text).map { it.lowercase() }.toSet()

        private fun distance(a: String, b: String, limit: Int): Int {
            if (kotlin.math.abs(a.length - b.length) > limit) return limit + 1
            var prev = IntArray(b.length + 1) { it }
            for (i in 1..a.length) {
                val row = IntArray(b.length + 1)
                row[0] = i
                var best = row[0]
                for (k in 1..b.length) {
                    row[k] = minOf(prev[k] + 1, row[k - 1] + 1, prev[k - 1] + if (a[i - 1] == b[k - 1]) 0 else 1)
                    best = minOf(best, row[k])
                }
                if (best > limit) return limit + 1
                prev = row
            }
            return prev[b.length]
        }

        private fun match(q: String, terms: Set<String>): Double {
            if (q in terms) return 1.0
            var best = 0.0
            val fuzz = Math.round(q.length * 0.15).toInt()
            for (t in terms) {
                if (t.startsWith(q)) best = maxOf(best, 0.375 * q.length / t.length + 0.25)
                else if (fuzz > 0 && distance(q, t, fuzz) <= fuzz) best = maxOf(best, 0.2)
            }
            return best
        }

        private fun snippet(text: String, terms: List<String>, width: Int = 140): String {
            val lower = text.lowercase()
            val at = terms.mapNotNull { lower.indexOf(it).takeIf { i -> i >= 0 } }.minOrNull() ?: 0
            val start = maxOf(0, at - 40)
            val end = minOf(text.length, start + width)
            return (if (start > 0) "…" else "") + text.substring(minOf(start, text.length), end) + if (end < text.length) "…" else ""
        }
    }
}
