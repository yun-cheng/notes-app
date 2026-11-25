package dev.notesapp.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Pushes local changes and pulls remote ones, as the web app's `SyncEngine` and the Swift app's. */
class SyncEngine(private val repo: Repository, private val api: SyncApi) {
    enum class State { idle, syncing, offline, signedOut, error }

    data class Status(val state: State = State.idle, val pending: Int = 0, val lastSyncedAt: Long? = null, val problem: String? = null) {
        val summary: String
            get() {
                val waiting = if (pending == 0) "" else "$pending ${if (pending == 1) "change" else "changes"} waiting"
                return when (state) {
                    State.syncing -> "Syncing…"
                    State.offline -> if (waiting.isEmpty()) "Offline" else "Offline, $waiting"
                    State.signedOut -> "Sign in again to sync"
                    State.error -> "Couldn't sync, will retry"
                    State.idle -> if (waiting.isEmpty()) "Synced" else waiting.replaceFirstChar { it.uppercase() }
                }
            }
    }

    private val _status = MutableStateFlow(Status())
    val status: StateFlow<Status> = _status
    private val running = Mutex()
    @Volatile private var again = false
    @Volatile private var stopped = false
    private var debounce: Job? = null

    /** Syncs shortly after the latest local change. */
    fun schedule(scope: CoroutineScope, afterMs: Long = 1500) {
        debounce?.cancel()
        debounce = scope.launch { delay(afterMs); sync() }
    }

    /** Runs a sync. If one is already running, another follows it. */
    suspend fun sync() {
        if (stopped || _status.value.state == State.signedOut) return
        if (!running.tryLock()) {
            again = true
            running.withLock { }
            return
        }
        try {
            do {
                again = false
                runOnce()
            } while (again && !stopped && _status.value.state != State.signedOut)
        } finally {
            running.unlock()
        }
    }

    /** For signing out: no more syncs start, and this returns once the one running, if any, has finished. */
    suspend fun stop() {
        stopped = true
        debounce?.cancel()
        running.withLock { }
    }

    private suspend fun runOnce() {
        _status.value = _status.value.copy(state = State.syncing)
        var next = State.idle
        var synced = _status.value.lastSyncedAt
        var problem: String? = null
        try {
            val refused = push()
            // Vaults first, so a card in a newly private vault is never shown before its lock is known.
            coroutineScope {
                val vaults = async { api.vaults() }
                val access = api.shared()
                // Newly shared cards can be older than the cursor, so pull everything again when access grows.
                if (repo.applyAccess(vaults.await(), access.cards, access.vaults ?: emptyList())) repo.setCursor(0)
                repo.putCommentCounts(access.comments ?: emptyList())
            }
            pull()
            if (refused > 0) next = State.error else synced = System.currentTimeMillis()
        } catch (_: ApiError.Offline) {
            next = State.offline
        } catch (_: ApiError.SignedOut) {
            next = State.signedOut
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            next = State.error
            problem = e.toString()
        }
        val pending = runCatching { repo.pendingCount() }.getOrDefault(0)
        _status.value = Status(next, pending, synced, problem)
    }

    /** Pushes until nothing is left that can be pushed. Returns how many records the server refused. */
    private suspend fun push(): Int {
        val refused = mutableSetOf<String>()
        while (true) {
            val batch = repo.pushable(PUSH_BATCH, refused)
            if (batch.isEmpty()) return refused.size
            val results = api.push(batch)
            val byId = batch.associateBy { it.id }
            for (result in results) {
                val local = byId[result.id] ?: continue
                when (result) {
                    is PushResult.Ok -> repo.markSynced(local.id, local.updated_at, result.seq)
                    is PushResult.ClientWon -> {
                        repo.markSynced(local.id, local.updated_at, result.seq)
                        repo.saveConflictCopy(result.loser, local)
                    }
                    // An edit made while the push was on its way is newer than what lost: it stays, and the next push settles it.
                    is PushResult.ServerWon -> if (repo.forceRemote(result.server, local.updated_at)) repo.saveConflictCopy(local, result.server)
                    is PushResult.Retry -> {}
                    is PushResult.Refused -> refused.add(local.id)
                }
            }
            if (results.all { it is PushResult.Retry }) return refused.size
        }
    }

    /**
     * Takes what changed on the server since the last pull, a page at a time, and puts it away a few pages at once
     * (`PULL_BATCH` cards), as the web does: each time cards are put away the app reads them all again, so a first sync
     * of thousands, page by page, would do so dozens of times over.
     */
    private suspend fun pull() {
        var since = repo.cursor()
        while (true) {
            val records = LinkedHashMap<String, CardRecord>()
            val gone = LinkedHashSet<String>()
            var more: Boolean
            do {
                val page = api.pull(since)
                // A later page has the newer copy, and a card back after leaving this account's vaults stays.
                for (r in page.records) {
                    records[r.id] = r
                    gone.remove(r.id)
                }
                page.gone?.let { gone.addAll(it) }
                since = page.next
                more = page.more
            } while (more && records.size < PULL_BATCH)
            repo.applyRemote(records.values.toList())
            if (gone.isNotEmpty()) repo.dropCards(gone.toList())
            repo.setCursor(since)
            if (!more) return
        }
    }

    companion object {
        /** How many pulled cards are put away at once, at most a page more (`pull`). */
        const val PULL_BATCH = 2000
    }
}
