package dev.notesapp.core

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class Clock(var now: Long = 1_000) {
    private var ids = 0
    fun tick(): Long { now += 1; return now }
    fun id(): String { ids += 1; return "id-$ids" }
}

val personal = Vault(id = "v1", name = "Personal", owner_id = "u1", created_at = 1)

suspend fun makeRepo(clock: Clock = Clock(), vaults: List<Vault> = listOf(personal)): Repository {
    val repo = Repository(MemoryStore(), now = clock::tick, newId = clock::id)
    repo.applyAccess(vaults, emptyList())
    return repo
}

/** The Swift app's repository tests, run against the Kotlin port. */
class RepositoryTest {
    @Test fun createsAndUpdatesCards() = runBlocking {
        val repo = makeRepo()
        val note = repo.createNote(title = "First")
        assertEquals("v1", note.vaultId)
        repo.update(note.id) { it.withTitle("Renamed") }
        assertEquals("Renamed", repo.card(note.id)?.title)
        val todo = repo.createTodo(title = "Buy milk", due = "2026-11-12")
        repo.setDone(todo.id, true)
        val done = repo.card(todo.id)!!
        assertTrue(done.isDone && done.completedAt != null && done.due == "2026-11-12")
    }

    @Test fun blankNewCardsStayLocal() = runBlocking {
        val repo = makeRepo()
        repo.createNote()
        val named = repo.createNote(title = "Kept")
        assertEquals(listOf(named.id), repo.pushable().map { it.id })
    }

    @Test fun remoteChangesNeverOverwriteUnpushedOnes() = runBlocking {
        val repo = makeRepo()
        val note = repo.createNote(title = "Mine")
        val remote = CardRecord(note.id, "v1", 5, false, 9, """{"type":"note","title":"Theirs","content":{"type":"doc"},"tags":[]}""")
        repo.applyRemote(listOf(remote))
        assertEquals("Mine", repo.card(note.id)?.title)
        val pushed = repo.pushable().first()
        repo.markSynced(note.id, pushed.updated_at, 3)
        assertTrue(repo.pushable().isEmpty())
        repo.applyRemote(listOf(remote))
        assertEquals("Theirs", repo.card(note.id)?.title)
    }

    @Test fun lostAccessRemovesCards() = runBlocking {
        val repo = makeRepo()
        val other = Vault(id = "v2", name = "Team", owner_id = "u2", created_at = 2, role = "editor")
        assertTrue(repo.applyAccess(listOf(personal, other), emptyList()))
        repo.createNote(title = "Team note", vaultId = "v2")
        assertFalse(repo.applyAccess(listOf(personal), emptyList()))
        assertTrue(repo.allCards().isEmpty())
    }

    @Test fun anOldDiaryCardReadsAsANote() = runBlocking {
        val repo = makeRepo()
        val record = CardRecord("diary:v1:2026-11-11", "v1", 5, false, 2, """{"type":"diary","date":"2026-11-11","title":"","tags":[],"content":{"type":"doc"}}""")
        repo.applyRemote(listOf(record))
        assertEquals(CardType.note, repo.card(record.id)?.type)
    }
}

class ChangeLogTest {
    private val me = "u1"
    private val vaults = listOf(
        Vault(id = "vault-u1", name = "Personal", owner_id = "u1", created_at = 1),
        Vault(id = "diary-u1", name = "Diary", owner_id = "u1", lock = "pin", created_at = 2),
    )

    private suspend fun repo(clock: Clock = Clock()) = makeRepo(clock, vaults).also { it.setMainVault("vault-u1") }

    @Test fun undoAndRedoAnEdit() = runBlocking {
        val repo = repo()
        val note = repo.createNote(title = "First")
        repo.update(note.id) { it.withTitle("Second") }
        assertEquals(1, repo.undo())
        assertEquals("First", repo.card(note.id)?.title)
        assertEquals(1, repo.redo())
        assertEquals("Second", repo.card(note.id)?.title)
        // Undoing the making of a card puts it in the Trash.
        repo.undo(); repo.undo()
        assertEquals(true, repo.card(note.id)?.deleted)
    }

    @Test fun typingJoinsOneChangeAndALaterEditBlocksUndo() = runBlocking {
        val repo = repo()
        val note = repo.createNote(content = Doc.fromText("a"))
        for (word in listOf("ab", "abc", "abcd")) repo.update(note.id, typed = true) { it.withContent(Doc.fromText(word)) }
        assertEquals(2, repo.changes().size)
        assertEquals("Edited", Changes.describe(repo.changes().last().first))
        repo.update(note.id, group = "other") { it.withColor(CardColor.entries.first()) }
        repo.undo()
        assertNull(repo.card(note.id)?.color)
        repo.undo()
        assertEquals(Doc.fromText("a"), repo.card(note.id)?.content)
    }

    @Test fun savingTheBoxMakesTagsOnceAndIsOneUndo() = runBlocking {
        val repo = repo()
        val context = SaveContext(me, vaults, emptySet(), CardIndex(repo.allCards()), emptyMap())
        val entries = EntryParser.parseEntries("Idea #diary\n[] milk #shop\n[] eggs #Shop @tomorrow", "2026-11-12")
        val saved = repo.save(entries, context = context) as SaveResult.Saved
        assertEquals(3, saved.ids.size)
        val cards = repo.allCards()
        val tags = cards.filter { it.type == CardType.tag }
        assertEquals(listOf("shop"), tags.map { it.title })
        assertTrue(tags.first().keptToVault && tags.first().vaultId == "vault-u1")
        assertEquals("diary-u1", repo.card(saved.ids[0])?.vaultId)
        assertEquals("2026-11-13", repo.card(saved.ids[2])?.due)
        val locked = context.copy(locked = setOf("diary-u1"), index = CardIndex(cards))
        assertEquals(SaveResult.Unlock("diary-u1"), repo.save(EntryParser.parseEntries("x\n[] y #diary", "2026-11-12"), context = locked))
        assertEquals(4, repo.undo())
        assertTrue(repo.allCards().all { it.deleted })
    }

    @Test fun aRepeatingTodoMovesOnWhenTicked() = runBlocking {
        val repo = repo()
        val todo = repo.createTodo(title = "Gym", due = "2026-11-12", repeat = Repeat(Repeat.Unit.week, 1))
        assertEquals("2026-11-19", repo.setDone(todo.id, true, today = "2026-11-12"))
        assertEquals(false, repo.card(todo.id)?.isDone)
    }
}

class BackupRestoreTest {
    @Test fun aBackupRestores() = runBlocking {
        val repo = makeRepo()
        val note = repo.createNote(title = "Kept", content = Doc.fromText("Hello"))
        val data = Backup.make(listOf(personal), listOf(note))
        val other = makeRepo()
        val cards = Backup.parse(data)
        val (added, _, _) = other.importBackup(cards)
        assertEquals(1, added)
        assertEquals("Kept", other.card(note.id)?.title)
        assertEquals(1, other.importBackup(cards).third)
    }
}

/** A server in memory: last write wins by `updated_at`, like the real one. */
class FakeServer : SyncApi {
    val records = mutableMapOf<String, CardRecord>()
    var seq = 0L
    var vaultList = listOf(personal)
    var reachable = true
    var goneIds = listOf<String>()

    private fun put(r: CardRecord) { seq += 1; records[r.id] = r.copy(seq = seq) }

    override suspend fun push(records: List<CardRecord>): List<PushResult> {
        if (!reachable) throw ApiError.Offline()
        return records.map { local ->
            val current = this.records[local.id]
            if (current != null && current.seq != local.seq) {
                if (local.updated_at > current.updated_at) { put(local); PushResult.ClientWon(local.id, seq, current) }
                else PushResult.ServerWon(local.id, current)
            } else { put(local); PushResult.Ok(local.id, seq) }
        }
    }

    override suspend fun pull(since: Long): PullResponse {
        if (!reachable) throw ApiError.Offline()
        val newer = records.values.filter { it.seq > since }.sortedBy { it.seq }
        return PullResponse(newer, goneIds, newer.lastOrNull()?.seq ?: since, false)
    }

    override suspend fun vaults(): List<Vault> { if (!reachable) throw ApiError.Offline(); return vaultList }
    override suspend fun shared() = SharedResponse(emptyList(), emptyList(), listOf(CommentCount("c-talk", 2)))
}

class SyncTest {
    @Test fun twoDevicesMeetThroughTheServer() = runBlocking {
        val server = FakeServer()
        val a = makeRepo(); val b = makeRepo()
        val syncA = SyncEngine(a, server); val syncB = SyncEngine(b, server)
        val note = a.createNote(title = "Hello")
        syncA.sync()
        assertEquals(SyncEngine.State.idle, syncA.status.value.state)
        assertEquals(0, syncA.status.value.pending)
        syncB.sync()
        assertEquals("Hello", b.card(note.id)?.title)
    }

    @Test fun aConflictKeepsBothVersions() = runBlocking {
        val server = FakeServer()
        val a = makeRepo(Clock()); val b = makeRepo(Clock(5_000))
        val syncA = SyncEngine(a, server); val syncB = SyncEngine(b, server)
        val note = a.createNote(title = "Draft")
        syncA.sync(); syncB.sync()
        a.update(note.id) { it.withTitle("From A") }
        b.update(note.id) { it.withTitle("From B") }
        syncB.sync(); syncA.sync()
        assertEquals(listOf("From A (conflict copy)", "From B"), a.allCards().map { it.title }.sorted())
    }

    @Test fun offlineKeepsChangesWaiting() = runBlocking {
        val server = FakeServer().apply { reachable = false }
        val repo = makeRepo()
        val sync = SyncEngine(repo, server)
        repo.createTodo(title = "Call Mum")
        sync.sync()
        assertEquals(SyncEngine.State.offline, sync.status.value.state)
        assertEquals("Offline, 1 change waiting", sync.status.value.summary)
        server.reachable = true
        sync.sync()
        assertEquals(SyncEngine.State.idle, sync.status.value.state)
        assertEquals(0, sync.status.value.pending)
    }

    @Test fun aCardMovedOutOfReachLeavesTheDevice() = runBlocking {
        val server = FakeServer()
        val repo = makeRepo()
        val sync = SyncEngine(repo, server)
        val note = repo.createNote(title = "Moving")
        sync.sync()
        server.goneIds = listOf(note.id)
        sync.sync()
        assertNull(repo.card(note.id))
        assertEquals(mapOf("c-talk" to 2), repo.commentCounts())
    }

    @Test fun aWithheldVaultKeepsNoCards() = runBlocking {
        val server = FakeServer()
        val repo = makeRepo()
        val sync = SyncEngine(repo, server)
        repo.createNote(title = "Before the PIN")
        sync.sync()
        server.vaultList = listOf(personal.copy(withheld = true))
        sync.sync()
        assertTrue(repo.allCards().isEmpty())
        server.vaultList = listOf(personal)
        sync.sync()
        assertEquals(listOf("Before the PIN"), repo.allCards().map { it.title })
    }

    @Test fun anEditDuringAPushThatLostIsKept() = runBlocking {
        val repo = makeRepo()
        val note = repo.createNote(title = "Mine")
        val sent = repo.pushable().first()
        repo.update(note.id) { it.withTitle("Mine, edited") }
        val server = CardRecord(note.id, "v1", 99_999, false, 4, """{"type":"note","title":"Theirs","content":{"type":"doc"},"tags":[]}""")
        assertFalse(repo.forceRemote(server, sent.updated_at))
        assertEquals("Mine, edited", repo.card(note.id)?.title)
    }

    @Test fun lockedCardsAreSealedUntilTheKeyArrives() = runBlocking {
        val secret = Vault(id = "vault-1", name = "Private", owner_id = "u1", lock = "pin", created_at = 1, encryption = CryptoTest.ENCRYPTION)
        val repo = makeRepo(Clock(), listOf(personal, secret))
        repo.applyRemote(listOf(CardRecord("card-1", "vault-1", 1, false, 1, CryptoTest.PAYLOAD)))
        val sealed = repo.card("card-1")!!
        assertTrue(sealed.sealed && sealed.title.isEmpty())
        assertNull(repo.update("card-1") { it.withTitle("x") })
        repo.keyring.set("vault-1", assertNotNull(VaultCrypto.unlock(CryptoTest.ENCRYPTION, CryptoTest.RECOVERY)))
        repo.update("card-1") { it.withTitle("Still secret") }
        val stored = repo.pushable().first()
        assertTrue(stored.payload.startsWith("e1:") && !stored.payload.contains("Still secret"))
        assertEquals("Still secret", repo.card("card-1")?.title)
    }
}

class AttachmentSweepTest {
    private fun vault(id: String, encrypted: Boolean = false) =
        Vault(id = id, name = id, owner_id = "u1", encryption = if (encrypted) jobj("version" to j(1)) else null)

    @Test fun aVaultItCantReadAllOfIsLeftAlone() {
        val vaults = listOf(vault("plain"), vault("sealedCards"), vault("noKey", true), vault("keyed", true))
        val cards = listOf(
            Card("a", "plain", 1, false, 0, jobj()),
            Card("b", "sealedCards", 1, false, 0, jobj(), sealed = true),
        )
        val unread = AttachmentSweep.unreadVaults(setOf("locked"), vaults, cards) { it == "keyed" }
        kotlin.test.assertEquals(setOf("locked", "noKey", "sealedCards"), unread)
    }
}
