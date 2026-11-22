package dev.notesapp.core

/** The journal as a board, as the web app's `board.ts`. */
data class BoardColumn(val key: String, val title: String, val items: List<StreamItem>)

object Board {
    const val STATE = "state"
    private const val STEP = 1024.0

    fun position(c: Card) = c.position?.takeIf { it.isFinite() } ?: c.createdAt.toDouble()
    private val byPosition = compareBy<StreamItem>({ position(it.card) }, { it.card.createdAt }, { it.card.id })

    fun columns(items: List<StreamItem>, group: TagGroup): List<BoardColumn> {
        val cols = (listOf(BoardColumn("", "No ${group.title.lowercase()}", emptyList())) + group.members.map { BoardColumn(it.id, it.displayTitle, emptyList()) }).toMutableList()
        val lists = cols.map { mutableListOf<StreamItem>() }
        for (i in items) lists[(group.rank(i.card.tags) + 1) % cols.size].add(i)
        return cols.mapIndexed { k, c -> c.copy(items = lists[k].sortedWith(byPosition)) }
    }

    enum class TodoState { open, waiting, done }
    fun stateOf(t: Card) = if (t.isDone) TodoState.done else if (t.waiting) TodoState.waiting else TodoState.open

    fun stateColumns(items: List<StreamItem>): List<BoardColumn> = TodoState.entries.map { s ->
        BoardColumn(s.name, s.name.replaceFirstChar { it.uppercase() }, items.filter { it.card.type == CardType.todo && stateOf(it.card) == s }.sortedWith(byPosition))
    }

    fun columnOf(c: Card, group: TagGroup): String = group.rank(c.tags).let { if (it < group.members.size) group.members[it].id else "" }

    fun tags(tags: List<String>, group: TagGroup, from: String, to: String): List<String> {
        if (from == to) return tags
        if (to.isEmpty()) return group.pick(tags, null)
        if (group.choosesOne) return group.pick(tags, to)
        val kept = tags.filter { it != from }
        return if (to in kept) kept else kept + to
    }

    fun place(moved: Card, index: Int, others: List<Card>): Map<String, Double> {
        val at = index.coerceIn(0, others.size)
        val low = if (at > 0) position(others[at - 1]) else null
        val high = if (at < others.size) position(others[at]) else null
        val now = position(moved)
        if ((low == null || low < now) && (high == null || now < high)) return emptyMap()
        val place = when {
            low == null && high == null -> now
            low == null -> high!! - STEP
            high == null -> low + STEP
            else -> low + (high - low) / 2
        }
        if ((low == null || low < place) && (high == null || place < high)) return mapOf(moved.id to place)
        val order = others.toMutableList().also { it.add(at, moved) }
        val start = position(if (order.first().id == moved.id) others.firstOrNull() ?: moved else order[0])
        val spaced = mutableMapOf<String, Double>()
        order.forEachIndexed { i, c -> val p = start + i * STEP; if (c.id == moved.id || position(c) != p) spaced[c.id] = p }
        return spaced
    }

    fun doneTag(group: TagGroup) = if (group.choosesOne) group.members.firstOrNull { it.title.trim().lowercase() == "done" } else null

    fun tagsForStatus(tags: List<String>, groups: List<TagGroup>, done: Boolean): List<String> {
        var next = tags
        for (g in groups) {
            val d = doneTag(g) ?: continue
            if (g.members.none { it.id in next }) continue
            if (done && d.id !in next) next = g.pick(next, d.id)
            if (!done && d.id in next) g.members.firstOrNull { it.id != d.id }?.let { next = g.pick(next, it.id) }
        }
        return next
    }

    /** Moves a card between a group's columns; into Done ticks a todo (a repeating one moves on and stays). */
    fun groupMove(card: Card, group: TagGroup, from: String, to: String, today: String, at: Long): Card {
        val doneId = doneTag(group)?.id
        val status = if (card.type != CardType.todo || doneId == null || from == to) null
            else if (to == doneId && !card.isDone) "done" else if (from == doneId && card.isDone) "open" else null
        if (status == "done" && card.repeat != null) return card.complete(today, at)
        var c = card.withTags(tags(card.tags, group, from, to))
        if (status == "done") c = c.complete(today, at)
        if (status == "open") c = c.reopen()
        return c
    }

    fun stateMove(todo: Card, to: TodoState, today: String, at: Long, groups: List<TagGroup>): Card {
        val from = stateOf(todo)
        if (from == to) return todo
        if (to == TodoState.done) {
            if (todo.repeat != null) return todo.complete(today, at)
            return todo.complete(today, at).let { it.withTags(tagsForStatus(it.tags, groups, true)) }
        }
        var c = todo
        if (from == TodoState.done) c = c.reopen().let { it.withTags(tagsForStatus(it.tags, groups, false)) }
        return c.withWaiting(to == TodoState.waiting)
    }
}
