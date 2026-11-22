package dev.notesapp.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.util.UUID

/** All card reads and writes go through here, one at a time, as the web app's `CardRepository`. */
class Repository(
    private val store: CardStore,
    val keyring: Keyring = Keyring(),
    private val now: () -> Long = { System.currentTimeMillis() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val context: CoroutineContext = Dispatchers.IO,
) {
    private val lock = Mutex()

    /** Every read and write runs one at a time, off the caller's thread, as the Swift app's repository actor. */
    private suspend fun <T> locked(block: suspend () -> T): T = withContext(context) { lock.withLock { block() } }
    private var mainVaultId: String? = null
    var onChange: (() -> Unit)? = null
    private var logged = 0
    private var lastCreated = 0L

    init { keyring.setVaults(store.listVaults()) }

    fun setMainVault(id: String?) { mainVaultId = id }
    fun action() = UUID.randomUUID().toString()
    fun newCardId() = newId()

    fun decode(r: CardRecord): Card {
        keyring.decode(r.payload, r.id, r.vault_id)?.let { return Card(r.id, r.vault_id, r.updated_at, r.deleted, r.seq, modernPayload(it)) }
        return Card(r.id, r.vault_id, r.updated_at, r.deleted, r.seq, jobj("type" to j("note"), "title" to j(""), "tags" to jarr(emptyList()), "content" to Doc.empty), sealed = true)
    }

    suspend fun allCards() = locked { store.listCards().map(::decode) }
    suspend fun card(id: String) = locked { store.getCard(id)?.let(::decode) }
    private fun read(id: String) = store.getCard(id)?.let(::decode)
    suspend fun vaults() = locked { store.listVaults() }

    private fun encode(c: Card): CardRecord {
        check(!c.sealed) { "A locked card can't be saved" }
        return CardRecord(c.id, c.vaultId, c.updatedAt, c.deleted, c.seq, keyring.encode(c.payload, c.id, c.vaultId))
    }

    // The change log

    private fun write(card: Card, group: String? = null, typed: Boolean = false, before: Card? = null): Card {
        val record = encode(card)
        val prior = if (group == null) null else store.getCard(card.id)
        store.putCards(listOf(record))
        if (group != null) runCatching { log(group, typed, prior, before ?: prior?.let(::decode), card, record) }
        onChange?.invoke()
        return card
    }

    private fun log(group: String, typedIn: Boolean, prior: CardRecord?, before: Card?, card: Card, record: CardRecord) {
        val made = prior == null || before == null || before.isBlank
        if (made && card.isBlank) return
        val fields = if (made) emptyList() else Changes.changed(before!!, card)
        if (!made && fields.isEmpty()) return
        val typed = typedIn && (made || Changes.isTextChange(fields))
        val at = card.updatedAt
        if (typed && !made) {
            val last = store.lastChange()
            if (last != null && last.joins == true && last.undoneAt == null && last.cardId == card.id && last.after.updated_at == prior!!.updated_at &&
                last.after.vault_id == record.vault_id && at - last.until <= 5 * 60_000 && at - last.at <= 30 * 60_000
            ) {
                store.putChange(last.copy(fields = if (last.before != null) (last.fields + fields).distinct().sorted() else last.fields, after = record, until = at))
                return
            }
        }
        var entry = ChangeEntry(at = at, until = at, group = group, cardId = card.id, before = if (made) null else prior, after = record, fields = fields, joins = if (typed) true else null)
        if (prior != null && !made && prior.vault_id != record.vault_id) {
            // Stored the way its new vault stores cards, so a move into an encrypted vault leaves nothing readable.
            entry = entry.copy(beforeVault = prior.vault_id, before = runCatching { encode(before!!.copy(vaultId = record.vault_id)) }.getOrNull())
        }
        store.putChange(entry)
        if (entry.beforeVault != null && keyring.isEncrypted(record.vault_id)) {
            store.deleteChanges(store.listChanges().filter { it.cardId == card.id && !VaultCrypto.isEncrypted(it.after.payload) }.mapNotNull { it.n })
        }
        if (++logged % 50 == 0) store.trimChanges(500)
    }

    private fun defaultVaultId(): String {
        val vaults = store.listVaults()
        mainVaultId?.let { id -> if (vaults.any { it.id == id }) return id }
        return vaults.minByOrNull { it.created_at }?.id ?: throw IllegalStateException("No vault yet. Sync first.")
    }

    private fun newCard(id: String?, vaultId: String?, createdAt: Long?, fields: JsonObject): Card {
        val at = maxOf(now(), lastCreated + 1)
        lastCreated = at
        val payload = JsonObject(mapOf("createdAt" to j(createdAt ?: at), "title" to j(""), "content" to Doc.empty, "tags" to jarr(emptyList())) + fields)
        return Card(id ?: newId(), vaultId ?: defaultVaultId(), at, false, 0, payload)
    }

    suspend fun createNote(
        id: String? = null, title: String = "", content: JsonElement = Doc.empty, pages: List<JsonElement> = emptyList(), stack: List<String>? = null,
        tags: List<String> = emptyList(), vaultId: String? = null, createdAt: Long? = null, extra: JsonObject = JsonObject(emptyMap()), group: String? = null,
    ): Card = locked {
        var f = jobj("type" to j("note"), "title" to j(title), "content" to content, "tags" to jstrings(tags))
        if (pages.isNotEmpty()) f = f.with("pages", jarr(pages))
        stack?.let { f = f.with("stack", jstrings(it)) }
        write(newCard(id, vaultId, createdAt, JsonObject(f + extra)), group ?: action())
    }

    suspend fun createTodo(
        id: String? = null, title: String, due: String? = null, dueTime: String? = null, start: String? = null, repeat: Repeat? = null,
        content: JsonElement = Doc.empty, pages: List<JsonElement> = emptyList(), tags: List<String> = emptyList(), vaultId: String? = null,
        done: Boolean = false, waiting: Boolean = false, createdAt: Long? = null, extra: JsonObject = JsonObject(emptyMap()), group: String? = null,
    ): Card = locked {
        var f = jobj("type" to j("todo"), "title" to j(title), "content" to content, "tags" to jstrings(tags), "status" to j(if (done) "done" else "open"), "due" to j(due), "completedAt" to JsonNull)
        if (pages.isNotEmpty()) f = f.with("pages", jarr(pages))
        if (due != null && dueTime != null) f = f.with("dueTime", j(dueTime))
        if (start != null) f = f.with("start", j(start))
        if (due != null && repeat != null) f = f.with("repeat", repeat.json)
        if (waiting && !done) f = f.with("waiting", j(true))
        var c = newCard(id, vaultId, createdAt, JsonObject(f + extra))
        if (done) c = c.with("completedAt", j(c.updatedAt))
        write(c, group ?: action())
    }

    suspend fun createTag(id: String? = null, title: String, vaultId: String? = null, members: List<String>? = null, choosesOne: Boolean = false, ordered: Boolean = false, group: String? = null): Card = locked {
        var f = jobj("type" to j("tag"), "title" to j(title), "pinned" to j(false))
        if (members != null) f = f.with("members", jstrings(members)).with("choice", j(if (choosesOne) "one" else "many")).with("ordered", j(ordered))
        else if (vaultId != null) f = f.with("scope", j("vault"))
        write(newCard(id, vaultId, null, f), group ?: action())
    }

    /** Applies `change` to the card and saves it, unless nothing changed. `typed` joins typing into one change. */
    suspend fun update(id: String, group: String? = null, typed: Boolean = false, change: (Card) -> Card): Card? = locked {
        val card = read(id)?.takeIf { !it.sealed } ?: return@locked null
        val next = change(card)
        if (next == card) return@locked card
        write(next.copy(updatedAt = now()), group ?: action(), typed && group == null, card)
    }

    suspend fun setDone(id: String, done: Boolean, today: String = DateKey.today(), group: String? = null): String? {
        val at = now()
        val updated = update(id, group) { if (done) it.complete(today, at) else it.reopen() }
        return if (done && updated?.repeat != null) updated.due else null
    }

    suspend fun retype(id: String, to: CardType, group: String? = null) = update(id, group) { it.retype(to) }
    suspend fun setDeleted(id: String, deleted: Boolean, group: String? = null) = update(id, group) { it.copy(deleted = deleted) }
    suspend fun move(id: String, vaultId: String, group: String? = null) = update(id, group) { it.copy(vaultId = vaultId) }

    suspend fun setTagScope(id: String, vaultId: String?, group: String? = null) {
        val home = locked { defaultVaultId() }
        update(id, group) { c -> if (c.type != CardType.tag) c else if (vaultId != null) c.copy(vaultId = vaultId).with("scope", j("vault")) else c.copy(vaultId = home).with("scope", null) }
    }

    /** Stores every readable card in a vault again, after its key was unlocked or its encryption changed. */
    suspend fun recodeVault(vaultId: String) = locked {
        val records = store.listCards().filter { it.vault_id == vaultId }.map(::decode).filter { !it.sealed }.map(::encode)
        if (records.isNotEmpty()) { store.putCards(records); onChange?.invoke() }
        store.deleteChanges(store.listChanges().filter { it.after.vault_id == vaultId || it.beforeVault == vaultId }.mapNotNull { it.n })
    }

    /** Rewrites a card from what it holds now, not logged. */
    suspend fun rewrite(id: String, change: (Card) -> Card) = locked {
        val c = read(id)?.takeIf { !it.sealed } ?: return@locked
        val next = change(c)
        if (next != c) write(next.copy(updatedAt = now()))
    }

    fun decodeChange(e: ChangeEntry): Change {
        val after = decode(e.after)
        var before = e.before?.let(::decode)
        if (e.beforeVault != null) before = before?.copy(vaultId = e.beforeVault)
        return Change(e.n ?: 0, e.at, e.until, e.group, e.cardId, before, after, e.fields, e.undoneAt, e.redoneAt, after.sealed || before?.sealed == true)
    }

    suspend fun changes(): List<Pair<Change, Card?>> = locked {
        val current = mutableMapOf<String, Card?>()
        store.listChanges().map { e -> decodeChange(e) to current.getOrPut(e.cardId) { read(e.cardId) } }
    }

    suspend fun revert(ns: List<Long>, undo: Boolean): List<Long> = locked {
        val done = mutableListOf<Long>()
        var stamp: Long? = null
        for (n in ns.distinct().let { if (undo) it.sortedDescending() else it.sorted() }) {
            val entry = store.getChange(n) ?: continue
            val current = read(entry.cardId)?.takeIf { !it.sealed } ?: continue
            val change = decodeChange(entry)
            if (!(if (undo) Changes.canUndo(change, current) else Changes.canRedo(change, current))) continue
            val at = now()
            if (runCatching { write(Changes.revert(current, change, undo).copy(updatedAt = at)) }.isFailure) continue
            stamp = stamp ?: at
            store.putChange(if (undo) entry.copy(undoneAt = stamp) else entry.copy(undoneAt = null, redoneAt = stamp))
            done.add(n)
        }
        done
    }

    suspend fun undo(): Int {
        val rows = changes()
        val current = rows.associate { it.first.cardId to it.second }
        return revert(Changes.nextUndo(rows.map { it.first }) { Changes.canUndo(it, current[it.cardId]) }.map { it.n }, true).size
    }

    suspend fun redo(): Int {
        val rows = changes()
        val current = rows.associate { it.first.cardId to it.second }
        return revert(Changes.nextRedo(rows.map { it.first }) { Changes.canRedo(it, current[it.cardId]) }.map { it.n }, false).size
    }

    suspend fun takeBack(change: Change): Boolean = locked {
        val current = read(change.cardId)?.takeIf { !it.sealed } ?: return@locked false
        if (!Changes.canUndo(change, current)) return@locked false
        write(Changes.revert(current, change, true).copy(updatedAt = now()), action(), before = current)
        true
    }

    /** A version from the server read as a change: what it changed and who made it. */
    fun syncedChange(v: RecentVersion): Change? {
        fun rec(p: String, d: Boolean, at: Long) = CardRecord(v.card_id, v.vault_id, at, d, 0, p)
        val after = decode(rec(v.payload, v.deleted, v.saved_at))
        val before = v.before?.let { decode(rec(it.payload, it.deleted, v.started_at)) }
        val c = Change(-v.id, v.started_at, v.saved_at, "v:${v.id}", v.card_id, before, after, emptyList(), null, null, after.sealed || before?.sealed == true, v.madeBy)
        if (c.sealed) return c
        if (before == null || before.isBlank) return if (after.isBlank) null else c.copy(before = null)
        val fields = Changes.changed(before, after)
        return if (fields.isEmpty()) null else c.copy(fields = fields)
    }

    // Sync

    suspend fun pushable(limit: Int = Int.MAX_VALUE, excluding: Set<String> = emptySet()): List<CardRecord> = locked {
        val out = mutableListOf<CardRecord>()
        for (r0 in store.listDirty()) {
            if (out.size >= limit) break
            if (r0.id in excluding) continue
            var r = r0
            if (keyring.isEncrypted(r.vault_id) && !VaultCrypto.isEncrypted(r.payload)) {
                if (!keyring.hasKey(r.vault_id)) continue
                r = encode(decode(r))
                store.putCards(listOf(r))
            }
            if (r.seq == 0L && decode(r).isBlank) continue
            out.add(r)
        }
        out
    }

    suspend fun pendingCount() = pushable().size

    private fun <T> meta(key: String, ser: kotlinx.serialization.KSerializer<T>): T? = store.getMeta(key)?.let { runCatching { json.decodeFromString(ser, it) }.getOrNull() }
    private fun <T> setMeta(key: String, ser: kotlinx.serialization.KSerializer<T>, value: T?) = store.setMeta(key, value?.let { json.encodeToString(ser, it) })

    suspend fun applyAccess(vaults: List<Vault>, shared: List<SharedCard>, vaultShares: List<VaultShare> = emptyList()): Boolean = locked {
        if ((meta("vaultShares", ListSerializer(VaultShare.serializer())) ?: emptyList()) != vaultShares) setMeta("vaultShares", ListSerializer(VaultShare.serializer()), vaultShares)
        val known = store.listVaults()
        val knownShared = meta("shared", ListSerializer(SharedCard.serializer())) ?: emptyList()
        val vaultIds = vaults.filterNot { it.isWithheld }.map { it.id }.toSet()
        val sharedIds = shared.map { it.card_id }.toSet()
        val outOfReach = { r: CardRecord -> r.vault_id !in vaultIds && r.id !in sharedIds }
        if (known.toSet() == vaults.toSet() && knownShared.toSet() == shared.toSet()) {
            val stray = store.listDirty().filter(outOfReach).map { it.id }
            if (stray.isNotEmpty()) { store.deleteCards(stray); onChange?.invoke() }
            keyring.setVaults(vaults)
            return@locked false
        }
        val reached = { list: List<Vault> -> list.filterNot { it.isWithheld }.map { "v:${it.id}" } }
        val before = (reached(known) + knownShared.map { "c:${it.card_id}" }).toSet()
        val after = reached(vaults) + shared.map { "c:${it.card_id}" }
        val gone = store.listCards().filter(outOfReach).map { it.id }
        store.replaceVaults(vaults)
        setMeta("shared", ListSerializer(SharedCard.serializer()), shared)
        keyring.setVaults(vaults)
        if (gone.isNotEmpty()) store.deleteCards(gone)
        val lost = gone.toSet()
        val encrypted = vaults.filter { it.isEncrypted }.map { it.id }.toSet()
        store.deleteChanges(store.listChanges().filter { it.cardId in lost || (it.after.vault_id in encrypted && !VaultCrypto.isEncrypted(it.after.payload)) }.mapNotNull { it.n })
        onChange?.invoke()
        after.any { it !in before }
    }

    suspend fun putVaults(vaults: List<Vault>) = locked {
        val known = store.listVaults().associateBy { it.id }
        store.putVaults(vaults)
        keyring.setVaults(store.listVaults())
        if (vaults.any { !it.isWithheld && known[it.id]?.isWithheld == true }) store.setMeta("cursor", "0")
        onChange?.invoke()
    }

    suspend fun sharedCards() = locked { meta("shared", ListSerializer(SharedCard.serializer())) ?: emptyList() }
    suspend fun vaultShares() = locked { meta("vaultShares", ListSerializer(VaultShare.serializer())) ?: emptyList() }
    suspend fun putCommentCounts(counts: List<CommentCount>) = locked {
        if ((meta("commentCounts", ListSerializer(CommentCount.serializer())) ?: emptyList()) != counts) {
            setMeta("commentCounts", ListSerializer(CommentCount.serializer()), counts)
            onChange?.invoke()
        }
    }
    suspend fun commentCounts(): Map<String, Int> = locked { (meta("commentCounts", ListSerializer(CommentCount.serializer())) ?: emptyList()).associate { it.card_id to it.open } }

    suspend fun dropCards(ids: List<String>) = locked {
        store.deleteCards(ids)
        val lost = ids.toSet()
        store.deleteChanges(store.listChanges().filter { it.cardId in lost }.mapNotNull { it.n })
        onChange?.invoke()
    }

    /** A pull that only echoes this device's own pushes changes nothing to show, so it says nothing. */
    suspend fun applyRemote(records: List<CardRecord>) = locked { if (store.applyRemote(records) > 0) onChange?.invoke() }
    suspend fun forceRemote(record: CardRecord, ifUpdatedAt: Long? = null): Boolean = locked { store.forceRemote(record, ifUpdatedAt).also { if (it) onChange?.invoke() } }
    suspend fun markSynced(id: String, updatedAt: Long, seq: Long) = locked { store.markSynced(id, updatedAt, seq) }
    suspend fun cursor() = locked { store.getMeta("cursor")?.toLongOrNull() ?: 0L }
    suspend fun setCursor(seq: Long) = locked { store.setMeta("cursor", seq.toString()) }

    suspend fun saveConflictCopy(loserRecord: CardRecord, winnerRecord: CardRecord) = locked {
        val loser = decode(loserRecord)
        val winner = decode(winnerRecord)
        if (loser.sealed || loser.deleted || loser.type == CardType.tag || loser.isBlank) return@locked
        if (loser.title == winner.title && loser.content == winner.content) return@locked
        var f = jobj("type" to j("note"), "title" to j("${loser.displayTitle} (conflict copy)"), "content" to loser.content, "tags" to jstrings(loser.tags), "createdAt" to j(loser.createdAt))
        if (loser.type == CardType.todo) f = f.with("type", j("todo")).with("status", loser.payload["status"] ?: j("open")).with("due", loser.payload["due"] ?: JsonNull).with("completedAt", loser.payload["completedAt"] ?: JsonNull)
        write(newCard(null, loser.vaultId, loser.createdAt, f))
    }

    suspend fun metaString(key: String) = locked { store.getMeta(key) }
    suspend fun setMetaString(key: String, value: String?) = locked { store.setMeta(key, value) }

    suspend fun deviceId(): String = locked { store.getMeta("deviceId") ?: newId().also { store.setMeta("deviceId", it) } }

    suspend fun clear() = locked { store.clear(); keyring.forgetAll(); keyring.setVaults(emptyList()); onChange?.invoke() }

    suspend fun importBackup(cards: List<Card>): Triple<Int, Int, Int> = locked {
        val known = store.listVaults().map { it.id }.toSet()
        // This account's own vault, not merely the oldest here, which may be someone else's shared one.
        val target = runCatching { defaultVaultId() }.getOrNull()
        var added = 0; var updated = 0; var skipped = 0
        for (c0 in cards) {
            var c = if (c0.vaultId !in known && target != null) c0.copy(vaultId = target) else c0
            val current = read(c.id)
            if (current != null) {
                if (current.updatedAt >= c.updatedAt) { skipped++; continue }
                c = c.copy(seq = current.seq); updated++
            } else added++
            store.putCards(listOf(encode(c)))
        }
        onChange?.invoke()
        Triple(added, updated, skipped)
    }

    @Suppress("unused") private val keepSerializers = MapSerializer(String.serializer(), String.serializer())
}
