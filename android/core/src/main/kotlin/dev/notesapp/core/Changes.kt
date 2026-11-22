package dev.notesapp.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** One change this device made to a card, as the change log stores it, as the web app's `changes.ts`. */
@Serializable
data class ChangeEntry(
    val n: Long? = null,
    val at: Long,
    val until: Long,
    /** Changes made by one action are undone together. */
    val group: String,
    val cardId: String,
    /** Null when the change made the card. */
    val before: CardRecord? = null,
    /** Set when the change moved the card to another vault: the vault it came from. */
    val beforeVault: String? = null,
    val after: CardRecord,
    val fields: List<String>,
    val joins: Boolean? = null,
    val undoneAt: Long? = null,
    val redoneAt: Long? = null,
)

/** A change with its cards readable. */
data class Change(
    val n: Long,
    val at: Long,
    val until: Long,
    val group: String,
    val cardId: String,
    val before: Card?,
    val after: Card,
    val fields: List<String>,
    val undoneAt: Long?,
    val redoneAt: Long?,
    val sealed: Boolean,
    val by: String? = null,
)

object Changes {
    private val text = setOf("title", "content", "pages", "back")

    /** A card's fields as the web names them: the payload's, its vault and whether it's in the Trash. */
    fun fields(c: Card): Map<String, JsonElement> = c.payload + mapOf("vaultId" to j(c.vaultId), "deleted" to j(c.deleted))

    fun changed(before: Card, after: Card): List<String> {
        val a = fields(before)
        val b = fields(after)
        return (a.keys + b.keys).filter { a[it] != b[it] }.sorted()
    }

    fun isTextChange(fields: List<String>) = fields.isNotEmpty() && fields.all { it in text }

    fun describe(c: Change): String {
        if (c.before == null) return "Created"
        val a = c.after
        val has = { k: String -> k in c.fields }
        return when {
            has("deleted") -> if (a.deleted) "Moved to Trash" else "Restored from Trash"
            has("archived") -> if (a.archived) "Archived" else "Unarchived"
            has("template") -> if (a.template) "Made a template" else "No longer a template"
            has("type") -> if (a.type == CardType.todo) "Turned into a todo" else "Turned into a note"
            has("vaultId") -> "Moved to another vault"
            has("status") && a.type == CardType.todo -> if (a.isDone) "Marked done" else "Reopened"
            has("waiting") && a.type == CardType.todo -> if (a.waiting) "Marked waiting" else "No longer waiting"
            has("content") -> "Edited"
            has("pages") || has("back") -> "Edited a page"
            has("title") -> if (a.type == CardType.todo) "Edited" else "Renamed"
            has("tags") -> if (has("position")) "Moved on the board" else "Changed tags"
            has("due") || has("dueTime") -> "Changed due date"
            has("start") -> "Changed start date"
            has("repeat") -> "Changed repeat"
            has("pinned") && a.type == CardType.tag -> if (a.pinned) "Pinned" else "Unpinned"
            has("color") -> "Changed color"
            has("preview") -> "Changed style"
            has("reactions") -> "Changed reactions"
            has("viewOnly") -> if (a.viewOnly) "Made view only" else "Made editable"
            has("members") || has("choice") || has("ordered") -> "Changed tag group"
            has("stack") -> "Changed the stack"
            has("position") -> "Moved on the board"
            else -> "Changed"
        }
    }

    fun canUndo(c: Change, current: Card?): Boolean {
        if (c.undoneAt != null || c.sealed || current == null) return false
        if (c.before == null) return !current.deleted
        val now = fields(current)
        val left = fields(c.after)
        return c.fields.all { now[it] == left[it] }
    }

    fun canRedo(c: Change, current: Card?): Boolean {
        if (c.undoneAt == null || c.sealed || current == null) return false
        val before = c.before ?: return current.deleted
        val now = fields(current)
        val was = fields(before)
        return c.fields.all { now[it] == was[it] }
    }

    fun revert(current: Card, c: Change, undo: Boolean): Card {
        val before = c.before ?: return current.copy(deleted = undo)
        val source = fields(if (undo) before else c.after)
        var next = current
        for (k in c.fields) next = when (k) {
            "vaultId" -> next.copy(vaultId = source[k].str ?: next.vaultId)
            "deleted" -> next.copy(deleted = source[k].bool ?: false)
            else -> next.with(k, source[k])
        }
        return next
    }

    fun matches(c: Change, f: StreamFilter, today: String): Boolean {
        val inVault = { card: Card -> f.vaultId == null || card.vaultId == f.vaultId }
        val narrowed = f.effectiveType != null || f.has != null || f.`when` != null || f.archived
        if (c.sealed) return !narrowed && f.tagId == null && inVault(c.after)
        val match = Stream.matcher(f, today)
        val fits = { card: Card? ->
            when {
                card == null -> false
                card.type == CardType.tag -> !narrowed && inVault(card) && (f.tagId == null || f.tagId == card.id)
                else -> match(card, null)
            }
        }
        return fits(c.before) || fits(c.after)
    }

    data class Group(val group: String, val changes: List<Change>, val at: Long)

    fun grouped(changes: List<Change>): List<Group> {
        val order = mutableListOf<String>()
        val groups = mutableMapOf<String, MutableList<Change>>()
        for (c in changes.sortedByDescending { it.n }) {
            if (c.group !in groups) order.add(c.group)
            groups.getOrPut(c.group) { mutableListOf() }.add(c)
        }
        return order.map { g -> Group(g, groups.getValue(g), groups.getValue(g).first().until) }
    }

    /** Whether this device's log already shows a change that came by sync, because this device made it. */
    fun inLog(change: Change, v: RecentVersion, log: List<Change>): Boolean {
        if (!v.mine || v.via != null || v.device?.here == false) return false
        return log.any { it.cardId == change.cardId && it.at <= change.until && maxOf(it.until, it.undoneAt ?: 0, it.redoneAt ?: 0) >= change.at }
    }

    fun nextUndo(changes: List<Change>, usable: (Change) -> Boolean): List<Change> {
        for (g in grouped(changes)) {
            val ready = g.changes.filter { it.undoneAt == null && usable(it) }
            if (ready.isNotEmpty()) return ready
        }
        return emptyList()
    }

    fun nextRedo(changes: List<Change>, usable: (Change) -> Boolean): List<Change> {
        val last = changes.mapNotNull { it.undoneAt }.maxOrNull() ?: return emptyList()
        if (changes.any { it.undoneAt == null && it.until > last }) return emptyList()
        return changes.filter { it.undoneAt == last && usable(it) }
    }
}

/** A version from the server's history, with the version it replaced, as `GET /api/versions` gives. */
@Serializable
data class RecentVersion(
    val id: Long,
    val card_id: String,
    val vault_id: String,
    val started_at: Long,
    val saved_at: Long,
    val author: String? = null,
    val via: String? = null,
    val payload: String,
    val deleted: Boolean,
    val before: Before? = null,
    val mine: Boolean,
    val device: Device? = null,
) {
    @Serializable data class Before(val payload: String, val deleted: Boolean)
    @Serializable data class Device(val here: Boolean, val name: String? = null)

    val madeBy: String
        get() {
            val who = author ?: "Someone"
            via?.let { return if (mine) "$it (AI)" else "$who via $it (AI)" }
            if (!mine) return who
            if (device?.here == true) return "This device"
            return device?.let { it.name ?: "Another device" } ?: "One of your devices"
        }
}

@Serializable
data class RecentVersions(val versions: List<RecentVersion>, val next: String? = null)

/** The fields restoring a version puts back, as the web app's `restorePatch`. */
fun Card.restoreFields(): JsonObject {
    var out = jobj("title" to j(title), "content" to content)
    if (type == CardType.tag) return out.with("pinned", j(pinned))
    out = out.with("type", j(type.name)).with("back", payload["back"] ?: kotlinx.serialization.json.JsonNull)
        .with("pages", payload["pages"] ?: kotlinx.serialization.json.JsonNull).with("tags", jstrings(tags))
    if (type == CardType.note) payload["stack"]?.let { out = out.with("stack", it) }
    if (type == CardType.todo) for (k in listOf("status", "due", "dueTime", "start", "repeat")) out = out.with(k, payload[k] ?: kotlinx.serialization.json.JsonNull)
    return out
}
