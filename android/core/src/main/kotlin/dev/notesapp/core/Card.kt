package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.ZoneId

/** Notes and todos are entries in the journal; a tag is a card too. The diary is a vault of ordinary entries. */
enum class CardType { note, todo, tag }

/** A color an entry's bubble can be tinted with, as the web app's `CARD_COLORS`. */
enum class CardColor { red, orange, yellow, green, blue, purple, pink, gray }

/** How a todo comes back: every N days, weeks, months or years, or every weekday. */
data class Repeat(val unit: Unit, val every: Int) {
    enum class Unit { day, week, month, year, weekday }

    val json: JsonElement get() = jobj("unit" to j(unit.name), "every" to j(every))

    companion object {
        fun from(e: JsonElement?): Repeat? {
            val unit = e["unit"].str?.let { u -> Unit.entries.firstOrNull { it.name == u } } ?: return null
            return Repeat(unit, maxOf(1, (e["every"].long ?: 1).toInt()))
        }
    }
}

/**
 * A decoded card. Its payload stays raw JSON, so fields written by a newer app aren't lost when this one saves.
 * Changes return a new card.
 */
data class Card(
    val id: String,
    val vaultId: String,
    val updatedAt: Long,
    val deleted: Boolean,
    val seq: Long,
    val payload: JsonObject,
    /** A stand-in for a card in an encrypted vault this device can't read yet. It must never be saved. */
    val sealed: Boolean = false,
) {
    fun with(key: String, value: JsonElement?) = copy(payload = payload.with(key, value))
    private fun flag(key: String) = payload[key].bool == true
    /** A flag most cards leave out: false removes it, as the web app does. */
    private fun withFlag(key: String, on: Boolean) = with(key, if (on) j(true) else null)

    val type: CardType get() = payload["type"].str?.let { t -> CardType.entries.firstOrNull { it.name == t } } ?: CardType.note
    val isEntry get() = type != CardType.tag
    val title: String get() = payload["title"].str ?: ""
    fun withTitle(t: String) = with("title", j(t))
    val content: JsonElement get() = payload["content"] ?: Doc.empty
    fun withContent(c: JsonElement) = with("content", c)
    /** IDs of tag cards. */
    val tags: List<String> get() = payload["tags"].arr?.mapNotNull { it.str } ?: emptyList()
    fun withTags(t: List<String>) = with("tags", jstrings(t))
    val createdAt: Long get() = payload["createdAt"].long ?: updatedAt

    val archived get() = flag("archived")
    fun withArchived(on: Boolean) = withFlag("archived", on)
    val template get() = flag("template")
    fun withTemplate(on: Boolean) = withFlag("template", on)
    val viewOnly get() = flag("viewOnly")
    fun withViewOnly(on: Boolean) = withFlag("viewOnly", on)
    val color: CardColor? get() = payload["color"].str?.let { c -> CardColor.entries.firstOrNull { it.name == c } }
    fun withColor(c: CardColor?) = with("color", j(c?.name))
    val position: Double? get() = payload["position"].double
    fun withPosition(p: Double?) = with("position", j(p))

    /** Its pages after the first, as kept, blank ones included; a card from before kept at most one, its `back`. */
    val morePages: List<JsonElement>
        get() {
            if (type == CardType.tag) return emptyList()
            payload["pages"].arr?.let { pages -> return pages.filter(Doc::isDoc) }
            val back = payload["back"]
            return if (back != null && Doc.isDoc(back)) listOf(back) else emptyList()
        }

    /** Its pages after the first, set: blank ones at the end go, and an old `back` is cleared. */
    fun withMorePages(pages: List<JsonElement>): Card {
        val kept = pages.dropLastWhile(Doc::isBlank)
        var c = with("pages", if (kept.isEmpty()) JsonNull else jarr(kept))
        if (payload["back"] != null && !payload["back"].isNull) c = c.with("back", JsonNull)
        return c
    }

    /** Every page with something on it after the first: what turning it over shows. */
    val turnPages: List<JsonElement> get() = morePages.filterNot(Doc::isBlank)

    /** Emoji reactions, each with the accounts that put it on. */
    val reactions: Map<String, List<String>>
        get() = payload["reactions"].obj?.mapNotNull { (k, v) -> v.arr?.mapNotNull { it.str }?.takeIf { it.isNotEmpty() }?.let { k to it } }?.toMap() ?: emptyMap()

    fun withReactions(r: Map<String, List<String>>): Card {
        val kept = r.filterValues { it.isNotEmpty() }
        return with("reactions", if (kept.isEmpty()) JsonNull else JsonObject(kept.mapValues { jstrings(it.value) }))
    }

    /** Puts this account's emoji on, or takes it off if it was there. */
    fun toggleReaction(emoji: String, me: String): Card {
        val r = reactions.toMutableMap()
        val by = (r[emoji] ?: emptyList()).toMutableList()
        if (!by.remove(me)) by.add(me)
        r[emoji] = by
        return withReactions(r)
    }

    /** Set on a stack only: the entries grouped in it, in order. */
    val stack: List<String>? get() = payload["stack"].arr?.mapNotNull { it.str }
    fun withStack(s: List<String>?) = with("stack", s?.let(::jstrings))
    val isStack get() = type == CardType.note && stack != null

    // Todos
    val isDone get() = payload["status"].str == "done"
    val due: String? get() = payload["due"].str
    fun withDue(d: String?) = with("due", j(d))
    val dueTime: String? get() = payload["dueTime"].str
    fun withDueTime(t: String?) = with("dueTime", j(t))
    val start: String? get() = payload["start"].str
    fun withStart(s: String?) = with("start", j(s))
    val repeat: Repeat? get() = Repeat.from(payload["repeat"])
    fun withRepeat(r: Repeat?) = with("repeat", r?.json ?: JsonNull)
    val waiting get() = flag("waiting")
    fun withWaiting(on: Boolean) = withFlag("waiting", on)
    val completedAt: Long? get() = payload["completedAt"].long

    // Tags
    val pinned get() = flag("pinned")
    val members: List<String>? get() = payload["members"].arr?.mapNotNull { it.str }
    val isGroup get() = type == CardType.tag && members != null
    val choosesOne get() = payload["choice"].str == "one"
    val ordered get() = flag("ordered")
    val keptToVault get() = payload["scope"].str == "vault"

    /** The title, or for a card without one, its first line of text; a stack with neither is a Stack. */
    val displayTitle: String
        get() {
            title.trim().takeIf { it.isNotEmpty() }?.let { return it }
            Doc.firstLine(content).takeIf { it.isNotEmpty() }?.let { return it }
            return if (isStack) "Stack" else "Untitled"
        }

    /** A note or todo the user opened but never wrote anything in. A photo or a file counts as something. */
    val isBlank: Boolean get() = type != CardType.tag && !isStack && title.isBlank() && tags.isEmpty() && Doc.isBlank(content)
}

/**
 * A card as it is now. The diary used to be its own type, one card per day; now it's a vault of ordinary entries,
 * so a diary card saved back then reads as a note written on its day (at the end of it, if started on another day).
 */
fun modernPayload(payload: JsonObject, zone: ZoneId = ZoneId.systemDefault()): JsonObject {
    if (payload["type"].str != "diary") return payload
    var out = payload.with("type", j("note"))
    val date = out["date"].str
    out = out.with("date", null)
    if (date == null) return out
    val created = out["createdAt"].long
    if (created != null && DateKey.of(Instant.ofEpochMilli(created), zone) == date) return out
    val day = DateKey.parse(date) ?: return out
    val end = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1
    return out.with("createdAt", j(end))
}
