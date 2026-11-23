package dev.notesapp.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.text.format.Formatter
import android.util.LruCache
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import dev.notesapp.core.AttachmentSeal
import dev.notesapp.core.AttachmentSweep
import dev.notesapp.core.Card
import dev.notesapp.core.Doc
import dev.notesapp.core.ServerApi
import dev.notesapp.core.StoredAttachment
import dev.notesapp.core.SyncEngine
import dev.notesapp.core.TrashMark
import dev.notesapp.core.arr
import dev.notesapp.core.get
import dev.notesapp.core.j
import dev.notesapp.core.jarr
import dev.notesapp.core.jobj
import dev.notesapp.core.json
import dev.notesapp.core.with
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Photos and files on this device, as the web app's photo queue: each is kept here as the server keeps it (sealed, in
 * an encrypted vault), shown from here at once, and uploaded in the background until the server has it.
 */
object Attachments {
    /** One waiting to go up. */
    @Serializable
    data class Pending(
        val id: String, val vaultId: String, val mime: String, val sealed: Boolean = false, val fileName: String? = null,
        val width: Double? = null, val height: Double? = null, val duration: Double? = null,
        /** The account it's for; others wait until that account is open again. */
        val account: String? = null,
    )

    class AddError(message: String) : Exception(message)

    /** The largest file the server takes, and the largest video. */
    const val MAX_FILE_BYTES = 25 * 1024 * 1024
    const val MAX_VIDEO_BYTES = 1024 * 1024 * 1024

    private lateinit var folder: File
    private lateinit var cache: File
    private val loading = mutableMapOf<String, CompletableDeferred<ByteArray?>>()
    private var uploading = false

    fun init(context: Context) {
        folder = File(context.filesDir, "attachments").apply { mkdirs() }
        cache = context.cacheDir
    }

    private fun file(id: String) = File(folder, id.replace("/", "_"))
    private val queueFile get() = File(folder, "pending.json")

    /** What waits to go up: read from its file once, then kept in memory and written back as it changes. */
    private var queue: List<Pending>? = null
    var pending: List<Pending>
        get() = queue ?: runCatching { json.decodeFromString(ListSerializer(Pending.serializer()), queueFile.readText()) }.getOrDefault(emptyList()).also { queue = it }
        set(v) {
            queue = v
            queueFile.writeText(json.encodeToString(ListSerializer(Pending.serializer()), v))
        }

    /** Deletes an account's photos and files from this device as it signs out, with any still waiting to go up. */
    fun forget(accountId: String, ids: Set<String>) {
        val leaving = pending.filter { it.account == accountId }
        for (id in ids + leaving.map { it.id }) file(id).delete()
        pending = pending.filter { it.account != accountId }
        bitmaps.evictAll()
    }

    /** The bytes as stored: from this device, or fetched once from the server. */
    suspend fun stored(id: String, api: ServerApi): ByteArray? {
        val f = file(id)
        withContext(Dispatchers.IO) { if (f.exists()) f.readBytes() else null }?.let { return it }
        loading[id]?.let { return it.await() }
        val waiting = CompletableDeferred<ByteArray?>()
        loading[id] = waiting
        val data = runCatching { api.attachment(id) }.getOrNull()
        if (data != null) withContext(Dispatchers.IO) { f.writeBytes(data) }
        waiting.complete(data)
        loading.remove(id)
        return data
    }

    /** The photo's or file's own bytes: opened with its vault's key when sealed. Null while that key isn't open. */
    suspend fun data(id: String, model: AppModel): ByteArray? {
        val stored = stored(id, model.api) ?: return null
        val vault = AttachmentSeal.sealedVault(stored) ?: return stored
        val key = model.repo.keyring.key(vault) ?: return null
        return withContext(Dispatchers.Default) { AttachmentSeal.open(stored, id, key)?.first }
    }

    /** The bytes in a file of their own, with the name given, for a player or for opening in another app. */
    suspend fun fileFor(id: String, name: String, model: AppModel): File? {
        val data = data(id, model) ?: return null
        return withContext(Dispatchers.IO) {
            val dir = File(cache, "open/$id").apply { mkdirs() }
            File(dir, name.ifEmpty { "file" }.replace("/", "_")).apply { writeBytes(data) }
        }
    }

    /** Opens a file in the app that reads it. */
    fun open(context: Context, file: File, mime: String?) {
        val uri = uriFor(context, file)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(Intent.createChooser(intent, file.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /** A copy of a file in Downloads, under its name, as the web's download. */
    suspend fun saveToDownloads(context: Context, file: File, name: String, mime: String?): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name.ifEmpty { file.name })
                put(android.provider.MediaStore.Downloads.MIME_TYPE, mime ?: "application/octet-stream")
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return@runCatching false
            resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } ?: return@runCatching false
            true
        }.getOrDefault(false)
    }

    // Adding

    data class Prepared(val data: ByteArray, val mime: String, val width: Double, val height: Double)

    /**
     * A photo shrunk as the web app's `prepare.ts` does: no edge over 2048 points, a JPEG at 0.85, except a small PNG,
     * GIF or WebP, which stays as it is.
     */
    fun prepare(raw: ByteArray): Prepared? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        val mime = bounds.outMimeType ?: return null
        val w = bounds.outWidth.toDouble()
        val h = bounds.outHeight.toDouble()
        if (mime in setOf("image/png", "image/gif", "image/webp") && raw.size < 2_000_000 && maxOf(w, h) <= 2048) return Prepared(raw, mime, w, h)
        val bitmap = decodeScaled(raw, 2048, software = true) ?: return null
        return Prepared(bitmap.jpeg(85), "image/jpeg", bitmap.width.toDouble(), bitmap.height.toDouble())
    }

    /**
     * A picture decoded no bigger than `edge` pixels, turned the way its camera says it was held. `software` keeps it
     * in memory the app can read, to encode it again.
     */
    fun decodeScaled(data: ByteArray, edge: Int, software: Boolean = false): Bitmap? = runCatching {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(java.nio.ByteBuffer.wrap(data))) { decoder, info, _ ->
            val big = maxOf(info.size.width, info.size.height)
            if (big > edge) decoder.setTargetSize(maxOf(1, info.size.width * edge / big), maxOf(1, info.size.height * edge / big))
            if (software) decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    }.getOrNull()

    fun Bitmap.jpeg(quality: Int): ByteArray = ByteArrayOutputStream().also { compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()

    /** The address another app opens one of this app's files by. */
    fun uriFor(context: Context, file: File): Uri = FileProvider.getUriForFile(context, "dev.notesapp.notes.files", file)

    private fun newId() = UUID.randomUUID().toString().lowercase()

    /**
     * Keeps a photo for an entry in `vaultId` and queues its upload. Returns the photo node to put in the entry. `seal`
     * says whether it's sealed, which otherwise follows the vault.
     */
    suspend fun addPhoto(raw: ByteArray, vaultId: String, model: AppModel, given: String? = null, seal: Boolean? = null): JsonElement {
        val photo = withContext(Dispatchers.Default) { prepare(raw) } ?: throw AddError("That isn't a picture this app can read.")
        val id = given ?: newId()
        keep(id, photo.data, vaultId, model, seal, Pending(id, vaultId, photo.mime, width = photo.width, height = photo.height))
        return Doc.photoNode(id)
    }

    data class VideoFacts(val poster: ByteArray?, val width: Double?, val height: Double?, val duration: Double?)

    /** A video's still, its size and its length, as the web app's `video.ts` finds them when one is added. */
    suspend fun videoFacts(data: ByteArray): VideoFacts = withContext(Dispatchers.IO) {
        val f = File(cache, "video-${newId()}")
        f.writeBytes(data)
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(f.path)
            val duration = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()?.div(1000)
            var w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toDoubleOrNull()
            var h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toDoubleOrNull()
            val rotation = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            if (rotation == 90 || rotation == 270) { val t = w; w = h; h = t }
            val frame = r.getFrameAtTime((minOf(0.5, (duration ?: 0.0) / 2) * 1_000_000).toLong(), MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            val poster = frame?.let { b ->
                val scale = minOf(1.0, 1280.0 / maxOf(b.width, b.height))
                val s = if (scale < 1) Bitmap.createScaledBitmap(b, (b.width * scale).toInt(), (b.height * scale).toInt(), true) else b
                s.jpeg(82)
            }
            VideoFacts(poster, w, h, duration?.takeIf { it.isFinite() && it > 0 })
        } catch (_: Exception) {
            VideoFacts(null, null, null, null)
        } finally {
            r.release()
            f.delete()
        }
    }

    /** Keeps a video with its still beside it, as a photo under the video's ID plus `-poster`. */
    suspend fun addVideo(data: ByteArray, name: String, mime: String, vaultId: String, model: AppModel): JsonElement {
        val facts = videoFacts(data)
        val id = newId()
        var extra = jobj()
        facts.poster?.let { p -> runCatching { addPhoto(p, vaultId, model, Doc.posterId(id)) }.getOrNull()?.let { extra = extra.with("poster", it["attrs"]["id"]) } }
        facts.width?.let { extra = extra.with("width", j(it)) }
        facts.height?.let { extra = extra.with("height", j(it)) }
        return addFile(data, name, mime, vaultId, model, facts.duration, extra, id)
    }

    /** Keeps a file (a video, a sound, a PDF, anything) and queues its upload. Returns the file node. */
    suspend fun addFile(data: ByteArray, name: String, mime: String, vaultId: String, model: AppModel, duration: Double? = null, extra: JsonObject = jobj(), given: String? = null, seal: Boolean? = null): JsonElement {
        val video = mime.startsWith("video/")
        val limit = if (video) MAX_VIDEO_BYTES else MAX_FILE_BYTES
        if (data.size > limit) throw AddError("$name is ${size(data.size.toLong())}. ${if (video) "Videos" else "Files"} can be up to ${size(limit.toLong())}.")
        val id = given ?: newId()
        keep(id, data, vaultId, model, seal, Pending(id, vaultId, mime, fileName = name, duration = duration))
        return Doc.fileNode(id, name, mime, data.size.toLong(), duration = duration, extra = extra)
    }

    fun size(bytes: Long): String = Formatter.formatShortFileSize(null, bytes).ifEmpty { "$bytes B" }

    /** Seals it if it's to be sealed and writes it here, both off the main thread (a video can be large). */
    private suspend fun keep(id: String, data: ByteArray, vaultId: String, model: AppModel, seal: Boolean?, item0: Pending) {
        var item = item0.copy(account = model.accountId)
        var key: ByteArray? = null
        if (seal ?: (model.vault(vaultId)?.isEncrypted == true)) {
            key = model.repo.keyring.key(vaultId) ?: throw AddError("Open the vault first.")
            item = item.copy(sealed = true)
        }
        val facts = AttachmentSeal.Facts(item.mime, data.size, item.fileName, item.width, item.height, item.duration)
        val f = file(id)
        withContext(Dispatchers.Default) {
            val stored = key?.let { AttachmentSeal.seal(data, id, vaultId, it, facts) } ?: data
            withContext(Dispatchers.IO) { f.writeBytes(stored) }
        }
        pending = pending + item
        model.scope.launch { upload(model) }
    }

    /** Sends what's waiting, one at a time, until the server has them all or can't take more now. */
    suspend fun upload(model: AppModel) {
        if (uploading || model.account == null) return
        uploading = true
        try {
            for (item in pending) {
                if (item.account != null && item.account != model.accountId) continue
                val f = file(item.id)
                if (!f.exists()) { pending = pending.filter { it.id != item.id }; continue }
                val data = withContext(Dispatchers.IO) { f.readBytes() }
                val result = runCatching {
                    model.api.upload(item.id, data, if (item.sealed) "application/octet-stream" else item.mime, item.vaultId, item.sealed, item.fileName, item.width, item.height, item.duration)
                }.getOrNull()
                when (result) {
                    ServerApi.UploadResult.Ok, ServerApi.UploadResult.Rejected -> pending = pending.filter { it.id != item.id }
                    // Kept here until Google Drive is connected; shown from this device meanwhile.
                    else -> return
                }
            }
        } finally {
            uploading = false
        }
    }

    // Pictures to show

    private val bitmaps = object : LruCache<String, Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    private val decoding = mutableMapOf<String, CompletableDeferred<Bitmap?>>()

    /** A photo decoded no bigger than `edge` pixels, kept a while. Two asking for the same one at once share it. */
    suspend fun bitmap(id: String, model: AppModel, edge: Int): Bitmap? {
        val key = "$id@$edge"
        bitmaps.get(key)?.let { return it }
        decoding[key]?.let { return it.await() }
        val waiting = CompletableDeferred<Bitmap?>()
        decoding[key] = waiting
        try {
            return decode(id, model, edge, key).also { waiting.complete(it) }
        } finally {
            decoding.remove(key)
            if (!waiting.isCompleted) waiting.complete(null)
        }
    }

    private suspend fun decode(id: String, model: AppModel, edge: Int, key: String): Bitmap? {
        val data = data(id, model) ?: return null
        val b = withContext(Dispatchers.Default) { decodeScaled(data, edge) } ?: return null
        bitmaps.put(key, b)
        return b
    }
}

/** Photos, videos and files picked to add, read and kept for the vault they're going into. */
class Pickers(val photos: () -> Unit, val files: () -> Unit)

@Composable
fun rememberAttachmentPickers(vaultId: String, add: (JsonElement) -> Unit): Pickers {
    val model = LocalModel.current
    val context = LocalContext.current
    fun read(uri: Uri) {
        model.scope.launch {
            try {
                val resolver = context.contentResolver
                val mime = resolver.getType(uri) ?: "application/octet-stream"
                val name = resolver.query(uri, null, null, null, null)?.use { c ->
                    val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (i >= 0 && c.moveToFirst()) c.getString(i) else null
                } ?: "File"
                // Too big is said before reading it all into memory.
                val size = resolver.query(uri, arrayOf(android.provider.OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
                val limit = if (mime.startsWith("video/")) Attachments.MAX_VIDEO_BYTES else Attachments.MAX_FILE_BYTES
                if (size != null && size > limit && !mime.startsWith("image/")) throw Attachments.AddError("$name is ${Attachments.size(size)}. ${if (mime.startsWith("video/")) "Videos" else "Files"} can be up to ${Attachments.size(limit.toLong())}.")
                val data = withContext(Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } } ?: throw Attachments.AddError("That file can't be read.")
                val node = when {
                    mime.startsWith("video/") -> Attachments.addVideo(data, name, mime, vaultId, model)
                    mime.startsWith("image/") && mime != "image/svg+xml" -> Attachments.addPhoto(data, vaultId, model)
                    else -> Attachments.addFile(data, name, mime, vaultId, model)
                }
                add(node)
            } catch (e: Exception) {
                model.say(e.message ?: "That couldn't be added.")
            }
        }
    }
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris -> uris.forEach(::read) }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> uris.forEach(::read) }
    return Pickers(
        { photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
        { files.launch(arrayOf("*/*")) },
    )
}

/**
 * Sends photos and files no entry holds to the Trash, brings back those held again, and deletes for good those 30
 * days in it, as the web app's `AttachmentKeeper`: after a sync that left nothing waiting, every ten minutes.
 */
object AttachmentKeeper {
    val trash = mutableStateOf<List<StoredAttachment>>(emptyList())
    private var last = 0L
    private var running = false
    private val holdersSer = MapSerializer(String.serializer(), AttachmentSweep.Holder.serializer())

    suspend fun sweep(model: AppModel, now: Boolean = false) {
        val s = model.syncStatus
        if (running || (!now && System.currentTimeMillis() - last < 600_000) || model.sync == null || s.state != SyncEngine.State.idle || s.pending > 0 || s.lastSyncedAt == null) return
        running = true
        try {
            last = System.currentTimeMillis()
            val api = model.api
            val stored = runCatching { api.attachments() }.getOrNull() ?: return
            val holders = model.repo.metaString("attachmentHolders")?.let { runCatching { json.decodeFromString(holdersSer, it) }.getOrNull() } ?: emptyMap()
            // A vault this device can't read all of (locked, or just encrypted elsewhere) isn't judged.
            val unread = AttachmentSweep.unreadVaults(model.lockedVaults, model.vaults, model.cards) { model.repo.keyring.key(it) != null }
            val plan = AttachmentSweep.plan(
                stored, model.cards.filter { it.vaultId !in unread },
                judges = { id -> model.vault(id)?.let { it.role != "viewer" && id !in unread } ?: false }, mayDelete = unread.isEmpty(),
                holders = holders, now = System.currentTimeMillis(),
            )
            model.repo.setMetaString("attachmentHolders", json.encodeToString(holdersSer, plan.holders))
            if (plan.trash.isNotEmpty() || plan.keep.isNotEmpty()) runCatching { api.markAttachments(plan.trash, plan.keep) }
            for (id in plan.remove) runCatching { api.deleteAttachment(id) }
            val changed = plan.trash.isNotEmpty() || plan.keep.isNotEmpty() || plan.remove.isNotEmpty()
            val latest = if (changed) runCatching { api.attachments() }.getOrNull() ?: stored else stored
            trash.value = latest.filter { it.trashed_at != null }.sortedByDescending { it.trashed_at }
        } finally {
            running = false
        }
    }

    /** Puts a photo or file back: at the end of the entry it was in, or in a new note in its vault. */
    fun putBack(a: StoredAttachment, model: AppModel) {
        val stillId = Doc.posterId(a.id)
        val still = if (a.mime.startsWith("video/") && trash.value.any { it.id == stillId }) stillId else null
        val node = if (a.isFile) Doc.fileNode(a.id, a.name ?: "Untitled", a.mime, a.size, still, a.width, a.height, a.duration) else Doc.photoNode(a.id)
        val from = a.trashed_from?.let { model.card(it) }
        model.perform { repo ->
            if (from != null && from.isEntry && !from.deleted && model.canEdit(from)) {
                repo.update(from.id) { c -> c.withContent(c.content.let { (it as JsonObject).with("content", jarr((it["content"].arr ?: emptyList()) + node)) }) }
                model.say("Put back in “${from.displayTitle}”", undoable = true)
            } else {
                repo.createNote(content = Doc.of(listOf(node)), vaultId = a.vault_id)
                model.say("Put back, in a new note", undoable = true)
            }
            runCatching { model.api.markAttachments(emptyList(), listOfNotNull(a.id, still)) }
        }
        trash.value = trash.value.filter { it.id != a.id && it.id != still }
    }

    fun deleteForGood(a: StoredAttachment, model: AppModel) {
        model.scope.launch {
            when (runCatching { model.api.deleteAttachment(a.id) }.getOrNull()) {
                ServerApi.DeleteResult.Ok, ServerApi.DeleteResult.Gone -> { trash.value = trash.value.filter { it.id != a.id }; model.say("Deleted for good") }
                ServerApi.DeleteResult.NeedsDrive -> model.say("Connect Google Drive to delete it from there too.")
                ServerApi.DeleteResult.InUse -> model.say("An entry holds it again, so it stays.")
                else -> model.say("It couldn't be deleted now. Try again.")
            }
        }
    }
}

