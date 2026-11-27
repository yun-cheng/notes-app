package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** The vaults each card is in besides its own, by card ID, from `/shared`. */
typealias SharedInto = Map<String, List<String>>

/** A tag group, like Priority or Topics: a tag card with `members`, never put on entries itself. */
data class TagGroup(val id: String, val title: String, val choosesOne: Boolean, val ordered: Boolean, val members: List<Card>) {
    /** Where an entry ranks: the position of its first tag in the group, or after them all for none. */
    fun rank(tags: List<String>) = members.indexOfFirst { it.id in tags }.let { if (it < 0) members.size else it }

    /** An entry's tags after picking `tagId` from the group's menu; null takes every tag of the group off. */
    fun pick(tags: List<String>, tagId: String?): List<String> {
        val inGroup = { t: String -> members.any { it.id == t } }
        if (tagId == null) return tags.filterNot(inGroup)
        if (choosesOne) return tags.filterNot(inGroup) + tagId
        return if (tagId in tags) tags - tagId else tags + tagId
    }
}

class TagGroups(cards: List<Card> = emptyList()) {
    val groups = mutableListOf<TagGroup>()
    val groupOf = mutableMapOf<String, TagGroup>()
    val loose: List<Card>

    init {
        val tags = cards.filterNot { it.isGroup }.associateBy { it.id }
        for (card in cards.filter { it.isGroup }) {
            val claimed = mutableListOf<String>()
            val members = mutableListOf<Card>()
            for (id in card.members ?: emptyList()) {
                val tag = tags[id] ?: continue
                if (groupOf.containsKey(id) || id in claimed) continue
                members.add(tag)
                claimed.add(id)
            }
            val group = TagGroup(card.id, card.title, card.choosesOne, card.ordered, members)
            claimed.forEach { groupOf[it] = group }
            groups.add(group)
        }
        loose = cards.filter { !it.isGroup && !groupOf.containsKey(it.id) }
    }

    /** An entry's tags with one more; a tag from a one-choice group replaces the group's other tag. */
    fun with(tags: List<String>, tagId: String): List<String> {
        if (tagId in tags) return tags
        val group = groupOf[tagId]
        if (group == null || !group.choosesOne) return tags + tagId
        return tags.filter { groupOf[it]?.id != group.id } + tagId
    }

    fun settle(tags: List<String>) = tags.fold(emptyList<String>()) { acc, t -> with(acc, t) }

    fun order(tags: List<String>): List<String> {
        fun rank(id: String): Int {
            val g = groupOf[id] ?: return Int.MAX_VALUE
            val gi = groups.indexOfFirst { it.id == g.id }
            return gi * 10_000 + g.members.indexOfFirst { it.id == id }
        }
        return tags.withIndex().sortedWith(compareBy({ rank(it.value) }, { it.index })).map { it.value }
    }

    fun isGroupName(name: String): Boolean {
        val key = name.trim().lowercase()
        return groups.any { it.title.trim().lowercase() == key }
    }
}

fun moveMember(members: List<String>, id: String, by: Int): List<String> {
    val i = members.indexOf(id)
    if (i < 0 || i + by !in members.indices) return members
    val next = members.toMutableList()
    next[i] = members[i + by]
    next[i + by] = id
    return next
}

// Tag scope

fun Card.tagVaults(sharedInto: SharedInto): List<String>? = if (keptToVault) listOf(vaultId) + (sharedInto[id] ?: emptyList()).filter { it != vaultId } else null
fun Card.offeredIn(vault: String?, sharedInto: SharedInto): Boolean =
    !keptToVault || (vault != null && (vaultId == vault || (sharedInto[id] ?: emptyList()).contains(vault)))

fun tagsFor(tags: List<Card>, vaultId: String?, sharedInto: SharedInto): List<Card> {
    val offered = tags.filter { it.offeredIn(vaultId, sharedInto) }
    return offered.filter { it.keptToVault } + offered.filterNot { it.keptToVault }
}

fun tagNamed(name: String, tags: List<Card>, vaultId: String?, sharedInto: SharedInto): Card? =
    tagsFor(tags, vaultId, sharedInto).firstOrNull { it.title.equals(name, ignoreCase = true) }

fun tagsForAll(tags: List<Card>, vaultIds: List<String>, sharedInto: SharedInto) = tags.filter { t -> vaultIds.all { t.offeredIn(it, sharedInto) } }

data class Backlink(val from: Card, val kind: Kind) { enum class Kind { link, tag } }

/** Everything derived on the device and never synced. Cards in locked vaults go no further than this. */
/**
 * `partial`: only some of the cards, as the journal's preview at launch (`AppModel.preview`): a link to one not among
 * them is named as the link was written, not taken for one this account can't see.
 */
class CardIndex private constructor(
    val lockedCards: MutableMap<String, String>,
    val byId: Map<String, Card>,
    val live: List<Card>,
    val tags: List<Card>,
    val tagGroups: TagGroups,
    val pinnedTags: List<Card>,
    val todos: List<Card>,
    val trash: List<Card>,
    val backlinks: MutableMap<String, MutableList<Backlink>>,
    val stackOf: Map<String, String>,
    private val partial: Boolean,
) {
    private constructor(built: Built, partial: Boolean) : this(
        built.lockedCards, built.byId, built.live, built.tags, built.tagGroups, built.pinnedTags,
        built.todos, built.trash, built.backlinks, built.stackOf, partial,
    )

    constructor(all: List<Card> = emptyList(), locked: Set<String> = emptySet(), partial: Boolean = false) : this(build(all, locked), partial)

    /**
     * Updates this index incrementally when `locked` hasn't changed and only a small set of cards changed, avoiding
     * walking every card's TipTap JSON and re-sorting thousands of entries on every edit. Falls back to full rebuild
     * on bulk changes or locked-vault transitions.
     */
    fun updating(nextCards: List<Card>, locked: Set<String> = emptySet()): CardIndex {
        if (partial || (byId.isEmpty() && lockedCards.isEmpty())) return CardIndex(nextCards, locked)
        val changed = ArrayList<Pair<Card?, Card?>>()
        var seenOpen = 0
        var seenLocked = 0

        for (card in nextCards) {
            val nowLocked = card.vaultId in locked || card.sealed
            if (nowLocked) {
                if (lockedCards[card.id] == card.vaultId) {
                    seenLocked++
                    continue
                }
                return CardIndex(nextCards, locked)
            }
            if (lockedCards.containsKey(card.id)) return CardIndex(nextCards, locked)
            val old = byId[card.id]
            if (old != null) {
                seenOpen++
                if (old.updatedAt != card.updatedAt || old.deleted != card.deleted || old.vaultId != card.vaultId || old.sealed != card.sealed || old.seq != card.seq) {
                    changed.add(old to card)
                    if (changed.size > 32) return CardIndex(nextCards, locked)
                }
            } else {
                changed.add(null to card)
                if (changed.size > 32) return CardIndex(nextCards, locked)
            }
        }
        if (seenLocked != lockedCards.size) return CardIndex(nextCards, locked)
        if (seenOpen != byId.size) {
            val nextIds = nextCards.mapTo(HashSet(nextCards.size)) { it.id }
            for ((id, old) in byId) {
                if (id !in nextIds) {
                    changed.add(old to null)
                    if (changed.size > 32) return CardIndex(nextCards, locked)
                }
            }
        }
        if (changed.isEmpty()) return this

        val nextById = HashMap(byId)
        val nextLive = ArrayList(live)
        val nextTodos = ArrayList(todos)
        val nextTrash = ArrayList(trash)
        var nextBacklinks: MutableMap<String, MutableList<Backlink>>? = null
        fun ensureBacklinks(): MutableMap<String, MutableList<Backlink>> =
            nextBacklinks ?: HashMap(backlinks).also { nextBacklinks = it }
        var tagsChanged = false
        var stacksChanged = false

        fun insertUpdatedDesc(list: ArrayList<Card>, card: Card) {
            if (list.isEmpty() || card.updatedAt >= list[0].updatedAt) {
                list.add(0, card)
                return
            }
            var lo = 1
            var hi = list.size
            while (lo < hi) {
                val mid = (lo + hi) ushr 1
                if (list[mid].updatedAt >= card.updatedAt) lo = mid + 1 else hi = mid
            }
            list.add(lo, card)
        }

        fun isActiveTodo(c: Card) = !c.deleted && !c.isBlank && c.type == CardType.todo && !c.archived && !c.template

        for ((old, cur) in changed) {
            val id = (cur ?: old)!!.id
            if (cur != null) nextById[id] = cur else nextById.remove(id)

            val wasLive = old != null && !old.deleted && !old.isBlank
            val nowLive = cur != null && !cur.deleted && !cur.isBlank
            val wasTrash = old != null && old.deleted && !old.isBlank
            val nowTrash = cur != null && cur.deleted && !cur.isBlank

            if (old?.type == CardType.tag || cur?.type == CardType.tag) tagsChanged = true
            if (old?.isStack == true || cur?.isStack == true) stacksChanged = true

            if (wasLive && nowLive && old!!.updatedAt == cur!!.updatedAt) {
                val idx = nextLive.indexOfFirst { it.id == id }
                if (idx >= 0) nextLive[idx] = cur
            } else {
                if (wasLive) { val idx = nextLive.indexOfFirst { it.id == id }; if (idx >= 0) nextLive.removeAt(idx) }
                if (nowLive) insertUpdatedDesc(nextLive, cur!!)
            }

            val wasTodo = old != null && isActiveTodo(old)
            val nowTodo = cur != null && isActiveTodo(cur)
            if (wasTodo && nowTodo && old!!.updatedAt == cur!!.updatedAt) {
                val idx = nextTodos.indexOfFirst { it.id == id }
                if (idx >= 0) nextTodos[idx] = cur
            } else {
                if (wasTodo) { val idx = nextTodos.indexOfFirst { it.id == id }; if (idx >= 0) nextTodos.removeAt(idx) }
                if (nowTodo) insertUpdatedDesc(nextTodos, cur!!)
            }

            if (wasTrash && nowTrash && old!!.updatedAt == cur!!.updatedAt) {
                val idx = nextTrash.indexOfFirst { it.id == id }
                if (idx >= 0) nextTrash[idx] = cur
            } else {
                if (wasTrash) { val idx = nextTrash.indexOfFirst { it.id == id }; if (idx >= 0) nextTrash.removeAt(idx) }
                if (nowTrash) insertUpdatedDesc(nextTrash, cur!!)
            }

            if (wasLive) {
                val targets = LinkedHashSet<String>().apply { addAll(old!!.tags); addAll(linkedIds(old)) }
                for (to in targets) {
                    val map = ensureBacklinks()
                    val existing = map[to] ?: continue
                    val kept = existing.filterTo(ArrayList(existing.size)) { it.from.id != old!!.id }
                    if (kept.isEmpty()) map.remove(to) else map[to] = kept
                }
            }
            if (nowLive) {
                val map = ensureBacklinks()
                fun addOne(to: String, kind: Backlink.Kind) {
                    if (to == cur!!.id || lockedCards.containsKey(to)) return
                    val existing = map[to]
                    val nextList = if (existing == null) arrayListOf(Backlink(cur, kind)) else ArrayList<Backlink>(existing.size + 1).apply { addAll(existing); add(Backlink(cur, kind)) }
                    map[to] = nextList
                }
                for (to in cur!!.tags) addOne(to, Backlink.Kind.tag)
                for (to in linkedIds(cur)) addOne(to, Backlink.Kind.link)
            }
        }

        val nextTags: List<Card>
        val nextTagGroups: TagGroups
        val nextPinnedTags: List<Card>
        if (tagsChanged) {
            val tagCards = nextLive.filter { it.type == CardType.tag }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
            nextTagGroups = TagGroups(tagCards)
            nextTags = tagCards.filterNot { it.isGroup }
            nextPinnedTags = nextTags.filter { it.pinned }
        } else {
            nextTags = tags
            nextTagGroups = tagGroups
            nextPinnedTags = pinnedTags
        }
        val nextStackOf = if (stacksChanged) stackIndex(nextLive) else stackOf

        return CardIndex(
            lockedCards = lockedCards,
            byId = nextById,
            live = nextLive,
            tags = nextTags,
            tagGroups = nextTagGroups,
            pinnedTags = nextPinnedTags,
            todos = nextTodos,
            trash = nextTrash,
            backlinks = nextBacklinks ?: backlinks,
            stackOf = nextStackOf,
            partial = false,
        )
    }

    fun resolveTags(ids: List<String>) = ids.mapNotNull { byId[it] }.filter { it.type == CardType.tag && !it.deleted }

    fun linkTitle(id: String, fallback: String): String {
        if (lockedCards.containsKey(id)) return LOCKED_TITLE
        val target = byId[id] ?: return if (partial) fallback else UNSHARED_TITLE
        return if (target.deleted) fallback else target.displayTitle
    }

    val titleOf = Doc.TitleOf { id, label -> linkTitle(id, label) }
    fun text(card: Card) = Doc.plainText(card.content, titleOf)
    fun pagesText(card: Card) = card.turnPages.joinToString(" ") { Doc.plainText(it, titleOf) }

    fun stackEntries(stack: Card): List<Card> = (stack.stack ?: emptyList()).mapNotNull { id ->
        byId[id]?.takeIf { !it.deleted && !it.archived && !it.template && it.isEntry && !it.isStack && stackOf[id] == stack.id }
    }

    private class Built(
        val lockedCards: MutableMap<String, String>,
        val byId: Map<String, Card>,
        val live: List<Card>,
        val tags: List<Card>,
        val tagGroups: TagGroups,
        val pinnedTags: List<Card>,
        val todos: List<Card>,
        val trash: List<Card>,
        val backlinks: MutableMap<String, MutableList<Backlink>>,
        val stackOf: Map<String, String>,
    )

    companion object {
        /** What a link shows in place of a card this device can't read; never saved as the link's label. */
        const val LOCKED_TITLE = "Locked"
        const val UNSHARED_TITLE = "Not shared"

        private fun linkedIds(card: Card): List<String> =
            (listOf(card.content) + card.turnPages).flatMap(Doc::linkedCardIds).distinct()

        private fun build(all: List<Card>, locked: Set<String>): Built {
            val lockedCards = mutableMapOf<String, String>()
            val cards = mutableListOf<Card>()
            for (c in all) if (c.vaultId in locked || c.sealed) lockedCards[c.id] = c.vaultId else cards.add(c)
            val byId = cards.associateBy { it.id }
            val live = cards.filter { !it.deleted && !it.isBlank }.sortedByDescending { it.updatedAt }
            val backlinks = mutableMapOf<String, MutableList<Backlink>>()
            fun add(to: String, link: Backlink) {
                if (to == link.from.id || lockedCards.containsKey(to)) return
                backlinks.getOrPut(to) { mutableListOf() }.add(link)
            }
            for (card in live) {
                card.tags.forEach { add(it, Backlink(card, Backlink.Kind.tag)) }
                linkedIds(card).forEach { add(it, Backlink(card, Backlink.Kind.link)) }
            }
            val tagCards = live.filter { it.type == CardType.tag }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.title })
            val tagGroups = TagGroups(tagCards)
            val tags = tagCards.filterNot { it.isGroup }
            return Built(
                lockedCards = lockedCards,
                byId = byId,
                live = live,
                tags = tags,
                tagGroups = tagGroups,
                pinnedTags = tags.filter { it.pinned },
                todos = live.filter { it.type == CardType.todo && !it.archived && !it.template },
                trash = cards.filter { it.deleted && !it.isBlank }.sortedByDescending { it.updatedAt },
                backlinks = backlinks,
                stackOf = stackIndex(live),
            )
        }

        fun stackIndex(cards: List<Card>): Map<String, String> {
            val stacks = cards.filter { it.isStack && !it.deleted }.sortedWith(compareBy({ it.createdAt }, { it.id }))
            val of = mutableMapOf<String, String>()
            for (s in stacks) for (id in s.stack ?: emptyList()) if (id != s.id && !of.containsKey(id)) of[id] = s.id
            return of
        }
    }
}

fun stackPlan(ids: List<String>, into: Card, stacks: List<Card>): Map<String, List<String>> {
    val moving = ids.filter { it != into.id }
    val lists = mutableMapOf<String, List<String>>()
    for (s in stacks) {
        if (s.id == into.id) continue
        val list = s.stack ?: emptyList()
        val kept = list.filterNot { it in moving }
        if (kept.size != list.size) lists[s.id] = kept
    }
    val current = into.stack ?: emptyList()
    lists[into.id] = current + moving.filterNot { it in current }
    return lists
}

/** What a new entry started from this template gets, with `{date}` filled in and its checklists unticked. */
fun Card.fromTemplate(today: String): JsonObject {
    fun fillText(text: String) = text.replace(Regex("""(?i)\{(date|today)\}""")) { DateKey.formatDay(today) }
    fun fill(node: JsonElement): JsonElement {
        var o = node as? JsonObject ?: return node
        if (Doc.type(o) == "text") o["text"].str?.let { o = o.with("text", j(fillText(it))) }
        if (Doc.type(o) == "taskItem") o = o.with("attrs", (o["attrs"].obj ?: JsonObject(emptyMap())).with("checked", j(false)))
        o["content"].arr?.let { children -> o = o.with("content", jarr(children.map(::fill))) }
        return o
    }
    var out = jobj("type" to j(type.name), "title" to j(fillText(title)), "content" to fill(content), "tags" to jstrings(tags))
    if (turnPages.isNotEmpty()) out = out.with("pages", jarr(turnPages.map(::fill)))
    color?.let { out = out.with("color", j(it.name)) }
    payload["preview"].obj?.takeIf { it.isNotEmpty() }?.let { out = out.with("preview", it) }
    return out
}

/** Switches a note to a todo or back, moving its words between title and body as the web's `retypePatch`. */
fun Card.retype(to: CardType): Card {
    if (to == type || to == CardType.tag || !isEntry) return this
    var c = this
    if (to == CardType.todo && title.isBlank()) {
        liftFirstLine(content)?.let { (t, rest) -> c = c.withTitle(t).withContent(rest) }
    } else if (to == CardType.note && title.isNotBlank() && Doc.isBlank(content)) {
        c = c.withContent(Doc.of(listOf(jobj("type" to j("paragraph"), "content" to jarr(listOf(jobj("type" to j("text"), "text" to j(title.trim()))))))))
            .withTitle("")
    }
    c = if (to == CardType.note) {
        listOf("status", "due", "dueTime", "repeat", "waiting", "completedAt").fold(c) { acc, k -> acc.with(k, null) }
    } else {
        c.with("status", j("open")).with("due", JsonNull).with("completedAt", JsonNull)
    }
    return c.with("type", j(to.name))
}

private fun liftFirstLine(doc: JsonElement): Pair<String, JsonElement>? {
    val blocks = doc["content"].arr ?: return null
    val first = blocks.firstOrNull() ?: return null
    if (Doc.type(first) != "paragraph" && Doc.type(first) != "heading") return null
    val inline = first["content"].arr?.takeIf { it.isNotEmpty() } ?: return null
    val text = StringBuilder()
    for (n in inline) {
        val t = n["text"].str
        if (Doc.type(n) != "text" || t.isNullOrEmpty()) return null
        val link = n["marks"].arr?.firstOrNull { it["type"].str == "link" }
        if (link != null && link["attrs"]["href"].str != t) return null
        text.append(t)
    }
    val trimmed = text.toString().trim().takeIf { it.isNotEmpty() } ?: return null
    val rest = blocks.drop(1)
    return trimmed to (if (rest.isEmpty()) Doc.empty else Doc.of(rest))
}

val commonReactions = listOf("👍", "❤️", "😂", "🎉", "🔥", "👀")
