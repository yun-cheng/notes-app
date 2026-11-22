package dev.notesapp.core

import kotlinx.serialization.Serializable
import kotlin.math.ceil

/** A photo or file as the server keeps it. */
@Serializable
data class StoredAttachment(
    val id: String,
    val vault_id: String,
    val mime: String,
    val size: Long,
    val name: String? = null,
    val width: Double? = null,
    val height: Double? = null,
    val duration: Double? = null,
    val created_at: Long,
    /** When it was found in no entry, and so went to the Trash. */
    val trashed_at: Long? = null,
    /** The entry it was last in, to put it back there. */
    val trashed_from: String? = null,
    /** 1 when it's sealed with its vault's key. */
    val sealed: Int? = null,
) {
    val isSealed get() = (sealed ?: 0) != 0
    /** A file, as against a photo: it has a name, or isn't a picture. */
    val isFile get() = name != null || !mime.startsWith("image/")

    /** Days left before it's deleted for good. */
    fun daysLeft(now: Long): Int {
        val at = trashed_at ?: return TRASH_DAYS
        return maxOf(0, ceil((at + TRASH_DAYS * 86_400_000L - now) / 86_400_000.0).toInt())
    }

    companion object { const val TRASH_DAYS = 30 }
}

@Serializable
data class TrashMark(val id: String, val from: String? = null, val name: String? = null)

/** Which photos and files go to the Trash, come back from it, or go for good, as the web app's `planSweep`. */
object AttachmentSweep {
    /**
     * Vaults this device can't read all of: locked here, holding a card it couldn't open, or encrypted with no key
     * here, as when another device has just encrypted one this device had open. Which of their photos are held can't
     * be told here, so the sweep leaves them alone.
     */
    fun unreadVaults(locked: Set<String>, vaults: List<Vault>, cards: List<Card>, hasKey: (String) -> Boolean): Set<String> =
        locked + cards.filter { it.sealed }.map { it.vaultId } + vaults.filter { it.isEncrypted && !hasKey(it.id) }.map { it.id }

    @Serializable
    data class Holder(val card: String, val name: String? = null)

    data class Plan(
        val trash: List<TrashMark> = emptyList(),
        val keep: List<String> = emptyList(),
        val remove: List<String> = emptyList(),
        val holders: Map<String, Holder> = emptyMap(),
    )

    /** The photos and files a card holds, on every page, a video's still too. */
    fun held(card: Card): List<Pair<String, String?>> {
        if (!card.isEntry) return emptyList()
        return (listOf(card.content) + card.morePages).flatMap { page ->
            Doc.photoIds(page).map { it to null } + Doc.files(page).flatMap { f -> listOf(f.id to f.name) + listOfNotNull(f.poster?.let { it to null }) }
        }
    }

    /**
     * Held ones stay or come back; ones no entry holds go to the Trash (in vaults this device can judge, and not just
     * made); ones in the Trash 30 days go for good, when this device may.
     */
    fun plan(stored: List<StoredAttachment>, cards: List<Card>, judges: (String) -> Boolean, mayDelete: Boolean, holders: Map<String, Holder>, now: Long): Plan {
        val heldBy = mutableMapOf<String, Holder>()
        for (card in cards.filter { !it.deleted } + cards.filter { it.deleted }) {
            for ((id, name) in held(card)) if (id !in heldBy) heldBy[id] = Holder(card.id, name)
        }
        val trash = mutableListOf<TrashMark>()
        val keep = mutableListOf<String>()
        val remove = mutableListOf<String>()
        val out = mutableMapOf<String, Holder>()
        for (a in stored) {
            val holder = heldBy[a.id]
            if (holder != null) {
                out[a.id] = holder
                if (a.trashed_at != null) keep.add(a.id)
                continue
            }
            val last = holders[a.id]
            if (last != null) out[a.id] = last
            if (!judges(a.vault_id) || now - a.created_at < 10 * 60_000) continue
            val at = a.trashed_at
            if (at == null) trash.add(TrashMark(a.id, last?.card, last?.name))
            else if (mayDelete && now - at >= StoredAttachment.TRASH_DAYS * 86_400_000L) remove.add(a.id)
        }
        return Plan(trash, keep, remove, out)
    }
}
