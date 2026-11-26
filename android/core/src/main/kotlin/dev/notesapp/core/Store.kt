package dev.notesapp.core

import java.util.concurrent.ConcurrentHashMap

/**
 * Cards, vaults, the change log and sync state on the device. A local write marks the card dirty until the server
 * has it, and a remote change never overwrites a dirty card, as the web app's IndexedDB store and the Swift app's
 * SQLite store. The Android app keeps it in SQLite; tests keep it in memory.
 */
interface CardStore {
    fun listCards(): List<CardRecord>
    /**
     * The newest `n` cards not deleted, by when they last changed, and those named in `also` (the tags, whose names
     * entries show): what the journal shows first at launch, read in a moment where reading every card takes seconds
     * (`AppModel.refresh`).
     */
    fun recentCards(n: Int, also: Collection<String> = emptyList()): List<CardRecord> {
        val all = listCards()
        val recent = all.filter { !it.deleted }.sortedByDescending { it.updated_at }.take(n)
        val ids = recent.mapTo(HashSet()) { it.id }
        val wanted = also.toSet()
        return recent + all.filter { it.id !in ids && !it.deleted && it.id in wanted }
    }
    fun getCard(id: String): CardRecord?
    /** A local write: stored, and marked to be pushed. */
    fun putCards(records: List<CardRecord>)
    fun listDirty(): List<CardRecord>
    /** Changes from the server; a card with unpushed changes keeps them. */
    /** Stores what the server sent, but not over a change waiting to go up; says how many it stored. */
    fun applyRemote(records: List<CardRecord>): Int
    /** The server's version wins, unless the card changed since `ifUpdatedAt`. */
    fun forceRemote(record: CardRecord, ifUpdatedAt: Long?): Boolean
    fun markSynced(id: String, updatedAt: Long, seq: Long)
    fun deleteCards(ids: List<String>)
    fun listVaults(): List<Vault>
    fun putVaults(vaults: List<Vault>)
    fun replaceVaults(vaults: List<Vault>)
    fun getMeta(key: String): String?
    fun setMeta(key: String, value: String?)
    fun putChange(entry: ChangeEntry)
    fun listChanges(): List<ChangeEntry>
    fun getChange(n: Long): ChangeEntry?
    fun lastChange(): ChangeEntry?
    fun deleteChanges(ns: List<Long>)
    fun trimChanges(limit: Int)
    fun clear()
}

class MemoryStore : CardStore {
    private val cards = LinkedHashMap<String, CardRecord>()
    private val dirty = mutableSetOf<String>()
    private val vaults = LinkedHashMap<String, Vault>()
    private val meta = ConcurrentHashMap<String, String>()
    private val changes = sortedMapOf<Long, ChangeEntry>()
    private var nextN = 1L

    @Synchronized override fun listCards() = cards.values.toList()
    @Synchronized override fun getCard(id: String) = cards[id]
    @Synchronized override fun putCards(records: List<CardRecord>) = records.forEach { cards[it.id] = it; dirty.add(it.id) }
    @Synchronized override fun listDirty() = dirty.mapNotNull { cards[it] }
    @Synchronized override fun applyRemote(records: List<CardRecord>): Int {
        var stored = 0
        for (r in records) {
            if (r.id in dirty) continue
            if (cards[r.id]?.seq == r.seq) continue
            cards[r.id] = r
            stored++
        }
        return stored
    }
    @Synchronized override fun forceRemote(record: CardRecord, ifUpdatedAt: Long?): Boolean {
        if (ifUpdatedAt != null && cards[record.id]?.updated_at != ifUpdatedAt) return false
        cards[record.id] = record
        dirty.remove(record.id)
        return true
    }
    @Synchronized override fun markSynced(id: String, updatedAt: Long, seq: Long) {
        val c = cards[id] ?: return
        cards[id] = c.copy(seq = seq)
        if (c.updated_at == updatedAt) dirty.remove(id)
    }
    @Synchronized override fun deleteCards(ids: List<String>) = ids.forEach { cards.remove(it); dirty.remove(it) }
    @Synchronized override fun listVaults() = vaults.values.toList()
    @Synchronized override fun putVaults(vaults: List<Vault>) = vaults.forEach { this.vaults[it.id] = it }
    @Synchronized override fun replaceVaults(vaults: List<Vault>) { this.vaults.clear(); putVaults(vaults) }
    override fun getMeta(key: String) = meta[key]
    override fun setMeta(key: String, value: String?) { if (value == null) meta.remove(key) else meta[key] = value }
    @Synchronized override fun putChange(entry: ChangeEntry) {
        val n = entry.n ?: nextN++
        changes[n] = entry.copy(n = n)
    }
    @Synchronized override fun listChanges() = changes.values.toList()
    @Synchronized override fun getChange(n: Long) = changes[n]
    @Synchronized override fun lastChange() = changes.values.lastOrNull()
    @Synchronized override fun deleteChanges(ns: List<Long>) = ns.forEach { changes.remove(it) }
    @Synchronized override fun trimChanges(limit: Int) { while (changes.size > limit) changes.remove(changes.firstKey()) }
    @Synchronized override fun clear() { cards.clear(); dirty.clear(); vaults.clear(); meta.clear(); changes.clear() }
}

/** The open vault keys on this device, in memory only, and the encoding of card payloads with them. */
class Keyring {
    private val keys = ConcurrentHashMap<String, ByteArray>()
    @Volatile private var encrypted = setOf<String>()

    fun setVaults(vaults: List<Vault>) { encrypted = vaults.filter { it.isEncrypted }.map { it.id }.toSet() }
    fun isEncrypted(vaultId: String) = vaultId in encrypted
    fun hasKey(vaultId: String) = keys.containsKey(vaultId)
    fun key(vaultId: String): ByteArray? = keys[vaultId]
    fun set(vaultId: String, key: ByteArray) { keys[vaultId] = key }
    fun forget(vaultId: String) { keys.remove(vaultId) }
    fun forgetAll() = keys.clear()

    class Locked : Exception("This vault is locked on this device.")

    fun encode(payload: kotlinx.serialization.json.JsonObject, id: String, vaultId: String): String {
        val text = payload.sortedText()
        if (vaultId !in encrypted) return text
        val key = keys[vaultId] ?: throw Locked()
        return VaultCrypto.encryptPayload(key, text, id, vaultId)
    }

    /** The payload, or null when it's encrypted and this device doesn't have the key. */
    fun decode(data: String, id: String, vaultId: String): kotlinx.serialization.json.JsonObject? {
        if (!VaultCrypto.isEncrypted(data)) return parseJson(data).obj
        val key = keys[vaultId] ?: return null
        return VaultCrypto.decryptPayload(key, data, id, vaultId)?.let { parseJson(it).obj }
    }
}
