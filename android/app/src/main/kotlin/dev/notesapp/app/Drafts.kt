package dev.notesapp.app

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf
import dev.notesapp.core.Doc
import dev.notesapp.core.DraftChange
import dev.notesapp.core.isNull
import dev.notesapp.core.json
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * What's written but not yet sent, kept for the account and following it between devices, as the web app's
 * `drafts.ts`: the journal box's, one for each view of the journal, and a comment's, one for each entry. Kept here as
 * it's typed, sent a moment after typing stops, others' taken in after each sync; one emptied or sent goes
 * everywhere. One bound for an encrypted vault stays in memory only, and is never sent.
 */
object Drafts {
    @Serializable data class Entry(val value: JsonElement? = null, val at: Long, val dirty: Boolean? = null, val server: Long? = null)
    @Serializable data class Kept(val entries: Map<String, Entry> = emptyMap(), val fetched: Long = 0)

    private val memory = mutableMapOf<String, JsonElement>()
    private var timer: Job? = null
    private var model: AppModel? = null
    private var accountId = ""
    private var prefs: android.content.SharedPreferences? = null
    /** Bumped when a draft comes from another device, so an empty box can take it in. */
    val arrived = mutableStateMapOf<String, Int>()

    fun init(context: Context) { prefs = context.getSharedPreferences("drafts", Context.MODE_PRIVATE) }

    fun start(model: AppModel, accountId: String) {
        this.model = model
        this.accountId = accountId
        memory.clear()
    }

    private val storeKey get() = "drafts:$accountId"

    private fun read(): Kept {
        val text = prefs?.getString(storeKey, null) ?: return Kept()
        val kept = runCatching { json.decodeFromString(Kept.serializer(), text) }.getOrNull() ?: return Kept()
        val now = System.currentTimeMillis()
        return kept.copy(entries = kept.entries.filter { it.value.dirty == true || (!it.value.value.isNull && now - it.value.at < 30 * 86_400_000L) })
    }

    private fun write(kept: Kept) { prefs?.edit()?.putString(storeKey, json.encodeToString(Kept.serializer(), kept))?.apply() }

    fun get(kind: String, key: String): JsonElement? {
        val k = "$kind:$key"
        memory[k]?.let { return it }
        return read().entries[k]?.value?.takeIf { !it.isNull }
    }

    /** Keeps what's in a box so far, to send in a moment; null drops it, everywhere. `onlyHere` keeps it in memory. */
    fun set(kind: String, key: String, value: JsonElement?, onlyHere: Boolean = false) {
        val k = "$kind:$key"
        if (value != null && onlyHere) memory[k] = value else memory.remove(k)
        val kept = read()
        val had = kept.entries[k]
        val entries = kept.entries.toMutableMap()
        val now = System.currentTimeMillis()
        when {
            value != null && !onlyHere -> {
                if (had != null && had.dirty != true && had.value == value) return
                entries[k] = Entry(value, now, true)
            }
            had != null && !had.value.isNull -> entries[k] = Entry(null, now, true)
            had != null && had.dirty != true -> entries.remove(k)
            else -> return
        }
        write(kept.copy(entries = entries))
        val m = model ?: return
        timer?.cancel()
        timer = m.scope.launch { delay(1000); send() }
    }

    suspend fun send() {
        val api = model?.api ?: return
        if (api.token == null) return
        val dirty = read().entries.filter { it.value.dirty == true }
        if (dirty.isEmpty()) return
        val changes = dirty.map { (k, e) -> DraftChange(k.substringBefore(":"), k.substringAfter(":"), e.value ?: JsonNull) }
        if (runCatching { api.sendDrafts(changes) }.isFailure) return
        val kept = read()
        val entries = kept.entries.toMutableMap()
        for ((k, e) in dirty) {
            val now = entries[k] ?: continue
            if (now.at != e.at || now.dirty != true) continue
            if (now.value.isNull) entries.remove(k) else entries[k] = now.copy(dirty = null)
        }
        write(kept.copy(entries = entries))
    }

    /** Sends what's waiting, then takes in what other devices changed since the last time. */
    suspend fun sync() {
        send()
        val api = model?.api ?: return
        if (api.token == null) return
        val since = read().fetched
        val (drafts, at) = runCatching { api.drafts(if (since > 0) maxOf(0, since - 60_000) else 0) }.getOrNull() ?: return
        val kept = read()
        val entries = kept.entries.toMutableMap()
        for (d in drafts) {
            val k = "${d.kind}:${d.key}"
            val here = entries[k]
            if (here?.dirty == true || (here?.server?.let { it >= d.at } == true) || memory.containsKey(k)) continue
            if (d.value.isNull) {
                if (here == null) continue
                entries.remove(k)
            } else {
                if (here?.value == d.value) { entries[k] = here!!.copy(server = d.at); continue }
                entries[k] = Entry(d.value, System.currentTimeMillis(), server = d.at)
            }
            arrived[k] = (arrived[k] ?: 0) + 1
        }
        write(kept.copy(entries = entries, fetched = maxOf(kept.fetched, at)))
    }

    fun forget() { prefs?.edit()?.remove(storeKey)?.apply() }

    /** A journal draft as the web keeps it, a document, from what's typed in the box. */
    fun doc(text: String): JsonElement? = if (text.isBlank()) null else Doc.fromText(text)

    /** A journal draft's words, as the box shows them. */
    fun text(doc: JsonElement) = Doc.previewLines(doc).joinToString("\n")
}
