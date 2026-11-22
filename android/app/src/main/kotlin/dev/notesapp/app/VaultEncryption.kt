package dev.notesapp.app

import dev.notesapp.core.ApiError
import dev.notesapp.core.Doc
import dev.notesapp.core.ServerApi
import dev.notesapp.core.SyncEngine
import dev.notesapp.core.TrashMark
import dev.notesapp.core.Vault
import dev.notesapp.core.VaultChanges
import dev.notesapp.core.VaultCrypto
import dev.notesapp.core.VaultKeys
import dev.notesapp.core.VaultPeople
import dev.notesapp.core.VaultPin
import dev.notesapp.core.arr
import dev.notesapp.core.get
import dev.notesapp.core.isNull
import dev.notesapp.core.j
import dev.notesapp.core.jarr
import dev.notesapp.core.jobj
import dev.notesapp.core.obj
import dev.notesapp.core.str
import dev.notesapp.core.with
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** A PIN's verifier, worked out off the main thread: PBKDF2 at 300,000 rounds takes a moment on a phone. */
suspend fun hashPin(pin: String) = withContext(Dispatchers.Default) { VaultPin.hash(pin) }

/** Whether a PIN matches its verifier, worked out off the main thread too. */
suspend fun pinMatches(pin: String, verifier: kotlinx.serialization.json.JsonElement?) = withContext(Dispatchers.Default) { VaultPin.verify(pin, verifier) }

/** Opens a private vault. An encrypted one gets its key, so its cards can be read and written. */
suspend fun AppModel.unlock(vault: Vault, pin: String, recoveryKey: Boolean): Boolean {
    val keyring = repo.keyring
    // Argon2id takes a moment, so it runs off the main thread.
    val opened = withContext(Dispatchers.Default) {
        val encryption = vault.encryption
        if (!encryption.isNull) {
            val key = if (recoveryKey) VaultCrypto.unlock(encryption!!, pin) else VaultKeys.unlock(encryption!!, pin, vault.id)
            if (key == null) false else { keyring.set(vault.id, key); true }
        } else VaultPin.verify(pin, vault.pin)
    }
    if (opened) {
        openVault(vault.id)
        // Encrypting it may have stopped partway on this device: what's left is done now.
        scope.launch { VaultEncryption(this@unlock).finishEncrypting(vault.id) }
    }
    return opened
}

/**
 * Turning a vault's encryption on and off, changing its PIN, recovering it, and letting members in, as the web app's
 * `useVaultEncryption`. Each step that changes how cards are stored syncs first and after, so the server ends up
 * holding only one kind of payload.
 */
class VaultEncryption(private val model: AppModel) {
    private val repo get() = model.repo
    private val api get() = model.api

    class NeedsPin : Exception("Lock the vault and open it with its PIN first.")
    class OutOfReach(count: Int) : Exception("${if (count == 1) "A photo or file" else "$count photos or files"} in it can't be fetched now. Try again when you're online.")

    companion object { fun encryptingName(vaultId: String) = "encrypting:$vaultId" }

    suspend fun save(vault: Vault, changes: VaultChanges): Vault {
        val updated = api.updateVault(vault.id, changes)
        repo.putVaults(listOf(updated))
        model.refresh()
        return updated
    }

    /** Encrypts a vault's cards under a new key, setting `pin` as its PIN. Returns the recovery key to show once. */
    suspend fun encrypt(vault: Vault, pin: String): String {
        model.sync?.sync()
        val made = withContext(Dispatchers.Default) { VaultKeys.create(pin) }
        // Noted first, so the cards are still stored again if this stops partway.
        repo.setMetaString(encryptingName(vault.id), "true")
        try {
            save(vault, VaultChanges(pin = hashPin(pin), encryption = made.encryption))
        } catch (e: Exception) {
            repo.setMetaString(encryptingName(vault.id), null)
            throw e
        }
        repo.keyring.set(vault.id, made.key)
        model.openVault(vault.id)
        finishEncrypting(vault.id)
        // Its photos and files are sealed too, in the background.
        model.scope.launch { runCatching { reseal(vault.id, seal = true) } }
        return made.recoveryKey
    }

    /**
     * Finishes turning encryption on: stores its cards again under the key, sends them, seals its comments and has the
     * server drop the readable versions it kept. Asked again whenever the vault is opened. True once done.
     */
    suspend fun finishEncrypting(vaultId: String): Boolean {
        if (repo.metaString(encryptingName(vaultId)) != "true") return true
        val key = repo.keyring.key(vaultId) ?: return false
        runCatching { repo.recodeVault(vaultId) }
        model.sync?.sync()
        val unsent = repo.pushable().any { it.vault_id == vaultId }
        if (unsent || model.sync?.status?.value?.state != SyncEngine.State.idle) return false
        return try {
            val open = api.vaultComments(vaultId).filter { !VaultCrypto.isEncrypted(it.body) }
            api.putVaultComments(vaultId, open.map { it.id to VaultKeys.encryptComment(key, it.body, it.card_id, vaultId) })
            api.purgePlaintextHistory(vaultId)
            repo.setMetaString(encryptingName(vaultId), null)
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Stores the vault's cards readable again and drops its PIN, or with `keepPin`, keeps it locked by the PIN alone. */
    suspend fun decrypt(vault: Vault, keepPin: Boolean = false) {
        // Its cards can only be stored readable again with its key open here; without it they'd stay sealed for good.
        if (repo.keyring.key(vault.id) == null) throw NeedsPin()
        model.sync?.sync()
        // Its photos and files are opened first, while the key is here.
        val failed = reseal(vault.id, seal = false)
        if (failed > 0) throw OutOfReach(failed)
        val key = repo.keyring.key(vault.id)
        save(vault, if (keepPin) VaultChanges(clearEncryption = true) else VaultChanges(clearPin = true, clearEncryption = true))
        repo.recodeVault(vault.id)
        repo.setMetaString(encryptingName(vault.id), null)
        model.sync?.sync()
        // Its comments last, once its cards are done.
        if (key != null) runCatching {
            val sealed = api.vaultComments(vault.id).filter { VaultCrypto.isEncrypted(it.body) }
            api.putVaultComments(vault.id, sealed.mapNotNull { c -> VaultKeys.decryptComment(key, c.body, c.card_id, vault.id)?.let { c.id to it } })
        }
    }

    /**
     * A new PIN for an encrypted vault: the owner's wraps the same key again; a member's is a new key pair, with the key
     * they have open sealed to it.
     */
    suspend fun rewrap(vault: Vault, newPin: String) {
        val key = repo.keyring.key(vault.id) ?: throw NeedsPin()
        val encryption = vault.encryption ?: throw NeedsPin()
        val next: JsonElement = withContext(Dispatchers.Default) {
            if (VaultKeys.isMemberCopy(encryption)) jobj("version" to j(1), "member" to VaultKeys.changeMemberPin(key, newPin, vault.id))
            else VaultKeys.changePin(encryption, key, newPin)
        }
        save(vault, VaultChanges(pin = hashPin(newPin), encryption = next))
    }

    /** A member of an encrypted vault sets their own PIN, which asks its owner for its key. */
    suspend fun askForKey(vault: Vault, pin: String) {
        val member = withContext(Dispatchers.Default) { VaultKeys.request(pin) }
        save(vault, VaultChanges(pin = hashPin(pin), encryption = jobj("version" to j(1), "member" to member)))
    }

    /**
     * The owner lets someone in: the vault key sealed to the public key they asked with. `pin` opens the key here if
     * it isn't open. Null if that PIN is wrong.
     */
    suspend fun letIn(vault: Vault, userId: String, publicKey: String, pin: String?): VaultPeople? {
        val encryption = vault.encryption ?: return null
        if (vault.isMemberCopy) return null
        var key = repo.keyring.key(vault.id)
        if (key == null && pin != null) key = withContext(Dispatchers.Default) { VaultKeys.unlock(encryption, pin, vault.id) }
        key ?: return null
        val grant = VaultKeys.grant(key, publicKey, vault.id)
        return api.giveVaultKey(vault.id, userId, publicKey, grant)
    }

    /** Opens an encrypted vault with its recovery key and sets a new PIN. False if the recovery key is wrong. */
    suspend fun recover(vault: Vault, recoveryKey: String, newPin: String): Boolean {
        val encryption = vault.encryption ?: return false
        if (vault.isMemberCopy) return false
        val key = VaultCrypto.unlock(encryption, recoveryKey) ?: return false
        val next = withContext(Dispatchers.Default) { VaultKeys.changePin(encryption, key, newPin) }
        save(vault, VaultChanges(pin = hashPin(newPin), encryption = next))
        repo.keyring.set(vault.id, key)
        model.openVault(vault.id)
        return true
    }

    /**
     * Copies each photo and file the vault's cards hold that isn't kept as the vault keeps them (sealed or open) under a
     * new ID, has its entries hold the copy, and sends the old one to the Trash and deletes it once the copy is up, as
     * the web app's `reseal.ts`. Returns how many couldn't be had now.
     */
    suspend fun reseal(vaultId: String, seal: Boolean): Int {
        val cards = model.cards.filter { it.vaultId == vaultId && it.isEntry && !it.sealed }
        val held = linkedMapOf<String, Doc.FileInfo?>()
        for (card in cards) for (page in listOf(card.content) + card.morePages) {
            for (id in Doc.photoIds(page)) if (id !in held) held[id] = null
            for (f in Doc.files(page)) if (held[f.id] == null) held[f.id] = f
        }
        if (held.isEmpty()) return 0
        val stored = runCatching { api.attachments() }.getOrDefault(emptyList()).associateBy { it.id }
        val renamed = mutableMapOf<String, String?>()
        var failed = 0
        for ((id, file) in held) {
            val there = stored[id] ?: continue
            val wrong = if (seal) !there.isSealed || there.vault_id != vaultId else there.isSealed
            if (!wrong) continue
            val by = copy(id, vaultId, file, seal)
            if (by == null) { failed++; continue }
            renamed[id] = by
            file?.poster?.let { renamed[it] = copy(it, vaultId, null, seal, Doc.posterId(by)) }
        }
        if (renamed.isEmpty()) return failed
        for (card in cards) repo.rewrite(card.id) { c ->
            val pages = c.morePages.map { withCopies(it, renamed) }
            val next = c.withContent(withCopies(c.content, renamed))
            if (pages != c.morePages) next.withMorePages(pages) else next
        }
        // The old ones go once their copies are up. One whose copy still waits stays on the server; no entry holds it
        // any more, so the attachment sweep sends it to the Trash later.
        Attachments.upload(model)
        val waiting = Attachments.pending.map { it.id }.toSet()
        val done = renamed.filter { (_, by) -> by == null || by !in waiting }.keys
        if (done.isEmpty()) return failed
        runCatching { api.markAttachments(done.map { TrashMark(it) }, emptyList()) }
        for (id in done) runCatching { api.deleteAttachment(id) }
        return failed
    }

    /**
     * One photo or file copied under a new ID, sealed or opened as `seal` says (not as the vault is now: while encryption
     * goes off, the vault is still encrypted), and queued to upload.
     */
    private suspend fun copy(id: String, vaultId: String, file: Doc.FileInfo?, seal: Boolean, newId: String? = null): String? {
        val data = Attachments.data(id, model) ?: return null
        return runCatching {
            val node = if (file != null) Attachments.addFile(data, file.name, file.mime ?: "application/octet-stream", vaultId, model, file.duration, given = newId, seal = seal)
            else Attachments.addPhoto(data, vaultId, model, newId, seal)
            node["attrs"]["id"].str
        }.getOrNull()
    }
}

/** A document with each photo and file in `renamed` holding its copy instead; a still that couldn't be copied goes. */
fun withCopies(node: JsonElement, renamed: Map<String, String?>): JsonElement {
    var o = node as? JsonObject ?: return node
    val type = o["type"].str
    val attrs0 = o["attrs"].obj
    if ((type == "photo" || type == "file") && attrs0 != null) {
        var attrs: JsonObject = attrs0
        attrs["id"].str?.let { id -> renamed[id]?.let { attrs = attrs.with("id", j(it)) } }
        if (type == "file") attrs["poster"].str?.let { p -> if (renamed.containsKey(p)) attrs = attrs.with("poster", renamed[p]?.let(::j) ?: JsonNull) }
        o = o.with("attrs", attrs)
    }
    o["content"].arr?.let { o = o.with("content", jarr(it.map { c -> withCopies(c, renamed) })) }
    return o
}

/** What went wrong with a vault change, in a sentence. */
fun vaultProblem(e: Throwable) = when (e) {
    is VaultEncryption.NeedsPin, is VaultEncryption.OutOfReach -> e.message!!
    is ApiError.Offline -> "Connect to the internet to change a vault."
    else -> "That didn't work. Try again."
}

