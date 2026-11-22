package dev.notesapp.app

import android.content.Context
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.notesapp.core.Account
import dev.notesapp.core.Board
import dev.notesapp.core.Card
import dev.notesapp.core.CardIndex
import dev.notesapp.core.DateKey
import dev.notesapp.core.Entry
import dev.notesapp.core.Repository
import dev.notesapp.core.SaveContext
import dev.notesapp.core.SaveOptions
import dev.notesapp.core.SaveResult
import dev.notesapp.core.ServerApi
import dev.notesapp.core.SessionInfo
import dev.notesapp.core.SharedCard
import dev.notesapp.core.SharedInto
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.SyncEngine
import dev.notesapp.core.Vault
import dev.notesapp.core.complete
import dev.notesapp.core.reopen
import dev.notesapp.core.save
import dev.notesapp.core.MemoryStore

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

/** What the main column shows. */
sealed class Page {
    data class Journal(val filter: StreamFilter = StreamFilter()) : Page()
    data object Trash : Page()
    data object History : Page()
    data object Calendar : Page()
    data object Timeline : Page()
    data object Photos : Page()
    data object Links : Page()
    data object Files : Page()
    data object Tags : Page()
    data object Vaults : Page()
    data object Settings : Page()
    data object Search : Page()
}

/** A panel an entry's menu opened: its tags, due date, vaults, sharing or history. */
sealed class EntryPanel(open val id: String) {
    data class Tags(override val id: String) : EntryPanel(id)
    data class Due(override val id: String) : EntryPanel(id)
    data class Vaults(override val id: String) : EntryPanel(id)
    data class Share(override val id: String) : EntryPanel(id)
    data class History(override val id: String) : EntryPanel(id)
}

data class Toast(val message: String, val undo: Boolean, val id: String = UUID.randomUUID().toString())

/** Everything the app's screens read: the account, its vaults and cards, and sync. As the web app's `CardsContext`. */
class AppModel(private val context: Context, val site: String) {
    enum class Phase { loading, signedOut, signedIn }

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tokens = Tokens(context)

    var phase by mutableStateOf(Phase.loading); private set
    var account by mutableStateOf<Account?>(null); private set
    var accounts by mutableStateOf<List<Account>>(emptyList()); private set
    var vaults by mutableStateOf<List<Vault>>(emptyList()); private set
    var shared by mutableStateOf<List<SharedCard>>(emptyList()); private set
    /** Every card on the device, sealed ones too: `index` keeps locked ones out of every list. */
    var cards by mutableStateOf<List<Card>>(emptyList()); private set
    var index by mutableStateOf(CardIndex()); private set
    /** The vaults each card is shared into besides its own. */
    var sharedInto by mutableStateOf<SharedInto>(emptyMap()); private set
    var commentCounts by mutableStateOf<Map<String, Int>>(emptyMap()); private set
    /** Private vaults opened with their PIN on this device, until the app locks them again. */
    var openVaults by mutableStateOf<Set<String>>(emptySet()); private set
    var sync by mutableStateOf<SyncEngine?>(null); private set
    var syncStatus by mutableStateOf(SyncEngine.Status()); private set
    var toast by mutableStateOf<Toast?>(null)
    var page by mutableStateOf<Page>(Page.Journal())
    var openEntry by mutableStateOf<String?>(null)
    var panel by mutableStateOf<EntryPanel?>(null)
    /** The entry the journal box saved last, to scroll to. */
    var lastSaved by mutableStateOf<String?>(null)
    var focusBox by mutableIntStateOf(0)
    /** View only, for reading without changing anything by mistake. */
    var viewOnly by mutableStateOf(false)
    var today by mutableStateOf(DateKey.today()); private set
    /** Shows the sign-in to add another account. */
    var addingAccount by mutableStateOf(false)
    /** Text shared into the app from another, for the journal box. */
    var sharedText by mutableStateOf<String?>(null)

    /** The signed-in account's own database on this device; each account has one. */
    var repo: Repository = Repository(MemoryStore()); private set
    private var store: SqliteStore? = null
    private var device: Pair<String, String>? = null
    private var refreshQueued = false
    private var watching: Job? = null

    init { scope.launch { start() } }

    private fun saveAccounts(list: List<Account>) { accounts = list; tokens.accounts = list }

    private suspend fun start() {
        val t0 = System.currentTimeMillis()
        accounts = tokens.accounts
        android.util.Log.i("Notes", "accounts in ${System.currentTimeMillis() - t0} ms")
        val current = tokens.current
        val account = accounts.firstOrNull { it.id == current } ?: accounts.firstOrNull()
        val token = account?.let { tokens.token(it.id) }
        android.util.Log.i("Notes", "token in ${System.currentTimeMillis() - t0} ms")
        if (account != null && token != null) open(account, token) else phase = Phase.signedOut
        android.util.Log.i("Notes", "started in ${System.currentTimeMillis() - t0} ms")
    }

    private fun openRepo(id: String): Repository {
        store?.close()
        val s = SqliteStore(context, "notes-$id.sqlite")
        store = s
        return Repository(s)
    }

    /** Opens an account's database and starts syncing it. */
    private suspend fun open(account: Account, token: String) {
        sync = null
        openVaults = emptySet()
        repo.keyring.forgetAll()
        repo = openRepo(account.id)
        repo.onChange = { scope.launch { changed() } }
        tokens.current = account.id
        page = Page.Journal()
        begin(account, token)
    }

    fun switchTo(a: Account) {
        if (a.id == account?.id) return
        val token = tokens.token(a.id) ?: return
        scope.launch { open(a, token) }
    }

    private suspend fun begin(account: Account, token: String) {
        this.account = account
        repo.setMainVault("vault-${account.id}")
        device = repo.deviceId() to deviceName
        val engine = SyncEngine(repo, ServerApi(site, token, device))
        sync = engine
        watching?.cancel()
        watching = scope.launch { engine.status.collectLatest { syncStatus = it; it.problem?.let { p -> android.util.Log.w("Notes", "Sync: $p") } } }
        Drafts.start(this, account.id)
        phase = Phase.signedIn
        refresh()
        engine.sync()
        if (engine.status.value.state == SyncEngine.State.signedOut) signOut()
    }

    /** Signed in, on its own or as another account: it goes first in the list, and is opened. */
    suspend fun signedIn(info: SessionInfo, token: String) {
        tokens.save(token, info.user.id)
        saveAccounts(listOf(info.user) + accounts.filter { it.id != info.user.id })
        addingAccount = false
        repo = openRepo(info.user.id)
        repo.applyAccess(info.vaults, emptyList())
        open(info.user, token)
    }

    /**
     * Signs this account out of this device: its database, token and drafts go. Another account signed in here is
     * opened instead, if there is one.
     */
    fun signOut() {
        val leaving = account ?: return
        Drafts.forget()
        val token = tokens.token(leaving.id)
        tokens.clear(leaving.id)
        saveAccounts(accounts.filter { it.id != leaving.id })
        val old = repo
        account = null
        sync = null
        cards = emptyList()
        index = CardIndex()
        vaults = emptyList()
        openVaults = emptySet()
        page = Page.Journal()
        scope.launch {
            if (token != null) ServerApi(site, token).signOut()
            runCatching { old.clear() }
            store?.close()
            store = null
            context.deleteDatabase("notes-${leaving.id}.sqlite")
            repo = Repository(MemoryStore())
            val next = accounts.firstOrNull()
            val t = next?.let { tokens.token(it.id) }
            if (next != null && t != null) open(next, t) else phase = Phase.signedOut
        }
    }

    val api: ServerApi get() = ServerApi(site, account?.let { tokens.token(it.id) }, device)
    val accountId get() = account?.id ?: ""

    companion object {
        /** What this device calls itself in the history its account sees. */
        val deviceName: String get() = "Notes app on ${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".replace("  ", " ")
    }

    // Cards

    /** Local changes refresh the screens at once and sync shortly after. */
    private suspend fun changed() {
        sync?.schedule(scope)
        if (refreshQueued) return
        refreshQueued = true
        refresh()
        refreshQueued = false
    }

    suspend fun refresh() {
        val all = runCatching { repo.allCards() }.getOrNull() ?: return
        val vs = repo.vaults()
        today = DateKey.today()
        vaults = vs.sortedWith(compareBy({ it.created_at }, { it.id }))
        shared = repo.sharedCards()
        val into = mutableMapOf<String, MutableList<String>>()
        for (s in repo.vaultShares()) into.getOrPut(s.card_id) { mutableListOf() }.add(s.vault_id)
        sharedInto = into
        commentCounts = repo.commentCounts()
        val locked = lockedVaults
        val next = kotlinx.coroutines.withContext(Dispatchers.Default) { CardIndex(all, locked) }
        cards = all
        index = next
        Reminders.reschedule(context, next)
    }

    /** Opens a private vault on this device: its cards show until the app locks again. */
    suspend fun openVault(vaultId: String) {
        openVaults = openVaults + vaultId
        sync?.schedule(scope, 200)
        refresh()
    }

    fun lock(vaultId: String) {
        openVaults = openVaults - vaultId
        repo.keyring.forget(vaultId)
        scope.launch { refresh() }
    }

    fun lockAll() {
        openVaults = emptySet()
        repo.keyring.forgetAll()
        scope.launch { refresh() }
    }

    /** Vaults with a PIN that this device hasn't opened. Their cards never reach a screen. */
    val lockedVaults: Set<String> get() = vaults.filter { it.isPrivate && it.id !in openVaults }.map { it.id }.toSet()

    fun card(id: String) = index.byId[id]
    fun vault(id: String) = vaults.firstOrNull { it.id == id }
    val mainVault get() = vaults.firstOrNull { it.isDefault(accountId) } ?: vaults.firstOrNull()
    val diaryVault get() = vaults.firstOrNull { it.isDiary(accountId) }

    /** Whether this account may change the card: its role in the card's vault, or the share that reached it, and not view only. */
    fun canEdit(card: Card) = !viewOnly && !card.viewOnly && canWrite(card)

    /** Whether this account could change it, view only aside. */
    fun canWrite(card: Card): Boolean {
        vault(card.vaultId)?.let { return it.role != "viewer" }
        return shared.firstOrNull { it.card_id == card.id }?.role == "edit"
    }

    /** Trash it or move it to another vault: members of its vault only. */
    fun canManage(card: Card): Boolean {
        if (viewOnly || card.viewOnly) return false
        val v = vault(card.vaultId) ?: return false
        return v.role != "viewer"
    }

    fun title(id: String, fallback: String) = index.linkTitle(id, fallback)

    /** The names of the vaults an entry is in: its own, then those it's shared into. */
    fun vaultNames(card: Card) = (listOf(card.vaultId) + (sharedInto[card.id] ?: emptyList())).mapNotNull { vault(it)?.name }

    val saveContext get() = SaveContext(accountId, vaults, lockedVaults, index, sharedInto)

    // Changes

    fun perform(work: suspend (Repository) -> Unit) {
        val r = repo
        scope.launch {
            try { work(r) } catch (e: Exception) { android.util.Log.w("Notes", "Change failed", e) }
        }
    }

    /** Shows a toast, with Undo when `undoable`, which takes back the last action. */
    fun say(message: String, undoable: Boolean = false) { toast = Toast(message, undoable) }

    fun undo() = perform { if (it.undo() == 0) say("Nothing to undo") }
    fun redo() = perform { if (it.redo() == 0) say("Nothing to redo") }

    /**
     * Ticks a todo or opens it again, saying when a repeating one is due next. On a board by a group with a Done tag,
     * it moves into Done, or out of it, as dragging it there does.
     */
    fun setDone(card: Card, done: Boolean) {
        val today = today
        val groups = index.tagGroups.groups
        perform { repo ->
            val at = System.currentTimeMillis()
            val updated = repo.update(card.id) { c ->
                if (done) {
                    val next = c.complete(today, at)
                    if (c.repeat == null) next.withTags(Board.tagsForStatus(next.tags, groups, true)) else next
                } else {
                    val next = c.reopen()
                    next.withTags(Board.tagsForStatus(next.tags, groups, false))
                }
            }
            if (done && updated?.repeat != null) updated.due?.let { say("Next due ${DateKey.relativeDayInSentence(it, today)}", undoable = true) }
        }
    }

    fun archive(ids: List<String>, on: Boolean) {
        val group = repo.action()
        perform { repo -> for (id in ids) repo.update(id, group) { it.withArchived(on) } }
        say(if (on) (if (ids.size == 1) "Archived" else "Archived ${ids.size} entries") else "Unarchived", undoable = true)
    }

    fun trash(ids: List<String>) {
        val group = repo.action()
        perform { repo -> for (id in ids) repo.setDeleted(id, true, group) }
        say(if (ids.size == 1) "Moved to Trash" else "Moved ${ids.size} entries to Trash", undoable = true)
    }

    /** Saves typed text as entries. Answers Unlock when a vault they need is locked, leaving the text to keep. */
    suspend fun save(entries: List<Entry>, opts: SaveOptions): SaveResult {
        if (viewOnly) {
            say("View only is on. Turn it off to change anything.")
            return SaveResult.Nothing
        }
        return try {
            repo.save(entries, opts, saveContext)
        } catch (e: Exception) {
            say("Couldn't save: ${e.message}")
            SaveResult.Nothing
        }
    }

    /** Once a minute while the app is open, with photos and files still waiting to go up. */
    fun syncPeriodically() = scope.launch {
        while (isActive) {
            Drafts.sync()
            delay(60_000)
            sync?.sync()
        }
    }
}
