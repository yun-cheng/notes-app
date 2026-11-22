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

    data class Status(val state: State = State.idle, val pending: Int = 0, val lastSyncedAt: Long? = null) {
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
    private var debounce: Job? = null

    /** Syncs shortly after the latest local change. */
    fun schedule(scope: CoroutineScope, afterMs: Long = 1500) {
        debounce?.cancel()
        debounce = scope.launch { delay(afterMs); sync() }
    }

    /** Runs a sync. If one is already running, another follows it. */
    suspend fun sync() {
        if (_status.value.state == State.signedOut) return
        if (!running.tryLock()) {
            again = true
            running.withLock { }
            return
        }
        try {
            do {
                again = false
                runOnce()
            } while (again && _status.value.state != State.signedOut)
        } finally {
            running.unlock()
        }
    }

    /** After signing in again. */
    fun reset() { _status.value = Status() }

    private suspend fun runOnce() {
        _status.value = _status.value.copy(state = State.syncing)
        var next = State.idle
        var synced = _status.value.lastSyncedAt
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
        } catch (_: Exception) {
            next = State.error
        }
        val pending = runCatching { repo.pendingCount() }.getOrDefault(0)
        _status.value = Status(next, pending, synced)
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

    private suspend fun pull() {
        var since = repo.cursor()
        while (true) {
            val page = api.pull(since)
            repo.applyRemote(page.records)
            page.gone?.takeIf { it.isNotEmpty() }?.let { repo.dropCards(it) }
            since = page.next
            repo.setCursor(since)
            if (!page.more) return
        }
    }
}
