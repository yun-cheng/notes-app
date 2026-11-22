package dev.notesapp.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder

sealed class ApiError(message: String) : Exception(message) {
    /** The server couldn't be reached. */
    class Offline : ApiError("offline")
    /** The session is gone; sign in again. */
    class SignedOut : ApiError("signed out")
    class Status(val code: Int, val error: String? = null) : ApiError(error ?: "status $code")
}

/** What sync needs from the server. Replaced by a fake in tests. */
interface SyncApi {
    suspend fun push(records: List<CardRecord>): List<PushResult>
    suspend fun pull(since: Long): PullResponse
    suspend fun vaults(): List<Vault>
    suspend fun shared(): SharedResponse
}

/** One request and its answer, so tests and the app can carry them their own way. */
data class HttpRequest(val method: String, val url: String, val headers: Map<String, String>, val body: ByteArray?)
data class HttpResponse(val status: Int, val body: ByteArray)

fun interface Transport { fun send(request: HttpRequest): HttpResponse }

/** Plain `HttpURLConnection`, which on Android takes PATCH as well. */
object UrlConnectionTransport : Transport {
    override fun send(request: HttpRequest): HttpResponse {
        val c = URI(request.url).toURL().openConnection() as HttpURLConnection
        try {
            c.requestMethod = request.method
        } catch (_: java.net.ProtocolException) {
            // A desktop JVM refuses PATCH; set it anyway, as Android's does.
            HttpURLConnection::class.java.getDeclaredField("method").apply { isAccessible = true }.set(c, request.method)
        }
        c.connectTimeout = 15_000
        c.readTimeout = 60_000
        c.instanceFollowRedirects = true
        for ((k, v) in request.headers) c.setRequestProperty(k, v)
        if (request.body != null) {
            c.doOutput = true
            c.setFixedLengthStreamingMode(request.body.size)
            c.outputStream.use { it.write(request.body) }
        }
        val status = c.responseCode
        val bytes = (if (status >= 400) c.errorStream else c.inputStream)?.use { it.readBytes() } ?: ByteArray(0)
        c.disconnect()
        return HttpResponse(status, bytes)
    }
}

@Serializable data class VaultMember(val user_id: String, val name: String, val email: String, val role: String, val locked: Boolean = false, val key: MemberKey? = null)
@Serializable data class MemberKey(val public: String, val given: Boolean)
@Serializable data class VaultInvite(val email: String, val role: String)
@Serializable data class VaultPeople(val members: List<VaultMember>, val invites: List<VaultInvite>)

@Serializable data class SharePerson(val user_id: String, val name: String, val email: String, val role: String)
@Serializable data class ShareInvite(val email: String, val role: String)
@Serializable data class ShareVault(val vault_id: String, val name: String, val role: String, val members: Int)
@Serializable data class ShareLink(val token: String, val created_at: Long, val expires_at: Long? = null)
@Serializable data class CardShares(val people: List<SharePerson>, val invites: List<ShareInvite>, val vaults: List<ShareVault>, val links: List<ShareLink>)

@Serializable data class CardComment(val id: String, val author_id: String, val author: String, val body: String, val created_at: Long, val resolved_at: Long? = null)
@Serializable data class VersionInfo(val id: Long, val started_at: Long, val saved_at: Long, val author: String? = null, val via: String? = null)
@Serializable data class VersionResponse(val id: Long, val started_at: Long, val saved_at: Long, val author: String? = null, val via: String? = null, val payload: String)

/** What a link's page says about itself, for a preview card. Only `url` is certain. */
@Serializable data class LinkPreview(val url: String, val title: String? = null, val description: String? = null, val image: String? = null, val site: String? = null)

@Serializable data class VaultComment(val id: String, val card_id: String, val body: String)
@Serializable data class DriveStatus(val configured: Boolean, val connected: Boolean, val email: String? = null)
@Serializable data class ConnectedApp(val id: String, val name: String, val created_at: Long, val last_used_at: Long? = null)
@Serializable data class OwnedVault(val id: String, val name: String, val cards: Int, val others: Int)
/** What deleting an account would take: the vaults it owns, with their entries and other members. */
@Serializable data class AccountSummary(val vaults: List<OwnedVault>, val joined: Int)

@Serializable data class DraftChange(val kind: String, val key: String, val value: JsonElement)
@Serializable data class ServerDraft(val kind: String, val key: String, val value: JsonElement? = null, val at: Long)

@Serializable data class Pairing(val pair: String, val code: String)

/**
 * What a vault's settings change: its name, this account's PIN, whether it's hidden, AI access, encryption. A field
 * left null is left out; `clearPin` and `clearEncryption` send null to clear them.
 */
data class VaultChanges(
    val name: String? = null, val pin: JsonElement? = null, val clearPin: Boolean = false, val hidden: Boolean? = null, val ai_access: String? = null,
    val encryption: JsonElement? = null, val clearEncryption: Boolean = false, val members_need_pin: Boolean? = null,
) {
    val json: JsonObject get() = jobj(
        "name" to name?.let(::j), "pin" to (if (clearPin) JsonNull else pin), "hidden" to hidden?.let(::j), "ai_access" to ai_access?.let(::j),
        "encryption" to (if (clearEncryption) JsonNull else encryption), "members_need_pin" to members_need_pin?.let(::j),
    )
}

/** The notes server over HTTPS, signed in with a bearer token, as the Swift app's `ServerAPI` and the web's `http.ts`. */
class ServerApi(
    val site: String = PRODUCTION,
    val token: String?,
    /** Which device this is, sent with each push, so history can tell this device's changes from the others'. */
    var device: Pair<String, String>? = null,
    private val transport: Transport = UrlConnectionTransport,
) : SyncApi {
    companion object {
        const val PRODUCTION = "https://notes-app.yuncheng-dev.workers.dev"
        /** A file bigger than this goes up in pieces, which can pick up where they left off. */
        const val WHOLE_BYTES = 5 * 1024 * 1024
        const val UPLOAD_PIECE = 8 * 1024 * 1024
        fun part(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20").replace("%7E", "~").replace("*", "%2A")
        fun card(id: String) = "/cards/${part(id)}"
        fun vault(id: String) = "/vaults/${part(id)}"
        fun query(items: List<Pair<String, String>>) = if (items.isEmpty()) "" else "?" + items.joinToString("&") { "${part(it.first)}=${part(it.second)}" }
    }

    suspend fun send(path: String, method: String = "GET", raw: ByteArray? = null, type: String = "application/json", headers: Map<String, String> = emptyMap()): HttpResponse {
        val h = mutableMapOf("Content-Type" to type)
        h.putAll(headers)
        token?.let { h["Authorization"] = "Bearer $it" }
        device?.let { h["X-Device-Id"] = it.first; h["X-Device-Name"] = it.second }
        val request = HttpRequest(method, site.trimEnd('/') + "/api" + path, h, raw)
        val response = try {
            withContext(Dispatchers.IO) { transport.send(request) }
        } catch (_: IOException) {
            throw ApiError.Offline()
        }
        if (response.status == 401) throw ApiError.SignedOut()
        return response
    }

    suspend fun send(path: String, method: String, body: JsonElement): HttpResponse = send(path, method, body.toString().toByteArray())

    private fun errorOf(r: HttpResponse) = runCatching { parseJson(r.body.decodeToString())["error"].str }.getOrNull()

    private fun ok(r: HttpResponse): HttpResponse {
        if (r.status !in 200..299) throw ApiError.Status(r.status, errorOf(r))
        return r
    }

    suspend fun obj(path: String, method: String = "GET", body: JsonElement? = null): JsonElement =
        parseJson(ok(if (body == null && method == "GET") send(path) else send(path, method, body ?: JsonObject(emptyMap()))).body.decodeToString()) ?: throw ApiError.Status(200, "unreadable")

    suspend fun <T> json(ser: KSerializer<T>, path: String, method: String = "GET", body: JsonElement? = null): T = json.decodeFromJsonElement(ser, obj(path, method, body))

    private suspend fun <T> list(ser: KSerializer<T>, key: String, path: String, method: String = "GET", body: JsonElement? = null): List<T> =
        json.decodeFromJsonElement(ListSerializer(ser), obj(path, method, body)[key] ?: JsonArray(emptyList()))

    // Sync

    override suspend fun push(records: List<CardRecord>): List<PushResult> {
        val body = jobj("records" to json.encodeToJsonElement(ListSerializer(CardRecord.serializer()), records))
        return obj("/sync/push", "POST", body)["results"].arr?.mapNotNull { it.obj?.let(PushResult::from) } ?: emptyList()
    }

    override suspend fun pull(since: Long) = json(PullResponse.serializer(), "/sync/pull?since=$since")
    suspend fun me() = json(SessionInfo.serializer(), "/me")
    override suspend fun vaults() = me().vaults
    override suspend fun shared() = json(SharedResponse.serializer(), "/shared")

    // Signing in through the browser

    sealed class Claim {
        data object Pending : Claim()
        data object Expired : Claim()
        data class SignedIn(val info: SessionInfo, val token: String) : Claim()
    }

    suspend fun startPairing() = json(Pairing.serializer(), "/auth/pair/start", "POST", jobj())

    /** The page the browser opens to approve this device; it comes back to the app at `notesapp://paired`. */
    fun pairingPage(p: Pairing) = site.trimEnd('/') + "/pair" + query(listOf("p" to p.pair, "return" to "app"))

    suspend fun claim(p: Pairing): Claim {
        val r = send("/auth/pair/claim", "POST", jobj("pair" to j(p.pair), "token" to j(true)))
        return when (r.status) {
            202 -> Claim.Pending
            200 -> {
                val info = json.decodeFromString(SessionInfo.serializer(), r.body.decodeToString())
                Claim.SignedIn(info, info.token ?: throw ApiError.Status(200))
            }
            else -> Claim.Expired
        }
    }

    suspend fun signOut() { runCatching { send("/auth/logout", "POST", jobj()) } }

    // Vaults

    suspend fun createVault(c: VaultChanges) = json(Vault.serializer(), "/vaults", "POST", c.json)
    suspend fun updateVault(id: String, c: VaultChanges) = json(Vault.serializer(), vault(id), "PATCH", c.json)
    suspend fun vaultPeople(id: String) = json(VaultPeople.serializer(), vault(id) + "/members")
    suspend fun addMember(vaultId: String, email: String, role: String) = json(VaultPeople.serializer(), vault(vaultId) + "/members", "POST", jobj("email" to j(email), "role" to j(role)))
    suspend fun removeMember(vaultId: String, userId: String) { ok(send(vault(vaultId) + "/members/" + part(userId), "DELETE")) }
    suspend fun cancelInvite(vaultId: String, email: String) = json(VaultPeople.serializer(), vault(vaultId) + "/invites/" + part(email), "DELETE")
    /** The owner lets someone into an encrypted vault, with its key sealed to the public key they asked with. */
    suspend fun giveVaultKey(vaultId: String, userId: String, publicKey: String, grant: String) =
        json(VaultPeople.serializer(), vault(vaultId) + "/members/" + part(userId) + "/key", "PUT", jobj("public" to j(publicKey), "grant" to j(grant)))

    suspend fun vaultComments(vaultId: String) = list(VaultComment.serializer(), "comments", vault(vaultId) + "/comments")
    suspend fun putVaultComments(vaultId: String, comments: List<Pair<String, String>>) {
        for (batch in comments.chunked(500)) {
            ok(send(vault(vaultId) + "/comments", "PUT", jobj("comments" to JsonArray(batch.map { jobj("id" to j(it.first), "body" to j(it.second)) }))))
        }
    }
    /** Removes plaintext versions from an encrypted vault's history on the server. */
    suspend fun purgePlaintextHistory(vaultId: String) { ok(send(vault(vaultId) + "/purge-plaintext", "POST", jobj())) }

    // Sharing a card

    suspend fun shares(cardId: String) = json(CardShares.serializer(), card(cardId) + "/shares")
    suspend fun share(cardId: String, email: String? = null, vaultId: String? = null, role: String) =
        json(CardShares.serializer(), card(cardId) + "/shares", "POST", jobj("email" to j(email), "vault_id" to j(vaultId), "role" to j(role)))
    /** `type` is `user`, `vault` or `invite`. */
    suspend fun unshare(cardId: String, type: String, target: String) = json(CardShares.serializer(), card(cardId) + "/shares/$type/" + part(target), "DELETE")
    suspend fun createLink(cardId: String, expiresInDays: Int?) = json(CardShares.serializer(), card(cardId) + "/links", "POST", jobj("expires_in_days" to (expiresInDays?.let(::j) ?: JsonNull)))
    suspend fun deleteLink(cardId: String, token: String) = json(CardShares.serializer(), card(cardId) + "/links/" + part(token), "DELETE")
    fun publicLink(token: String) = site.trimEnd('/') + "/s/" + token

    // Comments

    suspend fun comments(cardId: String) = list(CardComment.serializer(), "comments", card(cardId) + "/comments")
    suspend fun addComment(cardId: String, body: String) = list(CardComment.serializer(), "comments", card(cardId) + "/comments", "POST", jobj("body" to j(body)))
    suspend fun resolveComment(cardId: String, id: String, resolved: Boolean) = list(CardComment.serializer(), "comments", card(cardId) + "/comments/" + part(id), "PATCH", jobj("resolved" to j(resolved)))
    suspend fun deleteComment(cardId: String, id: String) = list(CardComment.serializer(), "comments", card(cardId) + "/comments/" + part(id), "DELETE")

    // History

    suspend fun versions(cardId: String) = list(VersionInfo.serializer(), "versions", card(cardId) + "/versions")
    suspend fun version(cardId: String, versionId: Long) = json(VersionResponse.serializer(), card(cardId) + "/versions/$versionId")
    /** The account's recent versions across entries, for the History page, as the web's `fetchRecentVersions`. */
    suspend fun recentVersions(before: String? = null) = json(RecentVersions.serializer(), "/versions" + (before?.let { "?before=" + part(it) } ?: ""))
    /** Closes the card's newest version, so a restore shows up as its own entry. */
    suspend fun sealVersions(cardId: String) { send(card(cardId) + "/versions/seal", "POST", jobj()) }

    // Links, pictures, translation

    /** The server reads the page's Open Graph tags, as the web app's `fetchLinkPreview`. */
    suspend fun unfurl(url: String) = json(LinkPreview.serializer(), "/unfurl", "POST", jobj("url" to j(url)))

    /** A picture on the web, fetched by the server, since most sites don't let others fetch their pictures. */
    suspend fun fetchPicture(url: String): ByteArray = ok(send("/fetch-image", "POST", jobj("url" to j(url)))).body

    sealed class Translated {
        data class Done(val from: String, val to: String, val pieces: List<String>) : Translated()
        data class Same(val from: String) : Translated()
        data object Limit : Translated()
        data object Failed : Translated()
    }

    /** An entry's pieces translated by the server into `to`, or into `otherwise` when they're in `to` already. */
    suspend fun translate(cardId: String, pieces: List<String>, to: String, otherwise: String?): Translated {
        val r = runCatching { send("/translate", "POST", jobj("cardId" to j(cardId), "pieces" to jstrings(pieces), "to" to j(to), "otherwise" to j(otherwise))) }.getOrNull() ?: return Translated.Failed
        if (r.status == 429) return Translated.Limit
        if (r.status !in 200..299) return Translated.Failed
        val o = runCatching { parseJson(r.body.decodeToString()) }.getOrNull() ?: return Translated.Failed
        if (o["kind"].str == "same") return Translated.Same(o["from"].str ?: "")
        val got = o["pieces"].arr?.mapNotNull { it.str } ?: return Translated.Failed
        return Translated.Done(o["from"].str ?: return Translated.Failed, o["to"].str ?: to, got)
    }

    sealed class TranscribeError : Exception() {
        class Encrypted : TranscribeError()
        class Limit : TranscribeError()
        class NotSetUp : TranscribeError()
        class Offline : TranscribeError()
        class Failed : TranscribeError()
    }

    data class Heard(val text: String, val language: String?, val cues: List<Doc.Cue>)

    /** One piece of a voice message transcribed by the server's Whisper, as WAV at 16 kHz. */
    suspend fun transcribe(vaultId: String, wav: ByteArray): Heard {
        val r = try { send("/transcribe?vault=" + part(vaultId), "POST", wav, "audio/wav") } catch (_: Exception) { throw TranscribeError.Offline() }
        when (r.status) {
            in 200..299 -> {
                val o = runCatching { parseJson(r.body.decodeToString()) }.getOrNull() ?: throw TranscribeError.Failed()
                val cues = o["cues"].arr?.mapNotNull { c -> val s = c["start"].double; val t = c["text"].str; if (s != null && t != null) Doc.Cue(s, t) else null } ?: emptyList()
                return Heard(o["text"].str ?: throw TranscribeError.Failed(), o["language"].str, cues)
            }
            403 -> throw TranscribeError.Encrypted()
            429 -> throw TranscribeError.Limit()
            501 -> throw TranscribeError.NotSetUp()
            else -> throw TranscribeError.Failed()
        }
    }

    // Drafts

    suspend fun drafts(since: Long): Pair<List<ServerDraft>, Long> {
        val o = obj("/drafts?since=$since")
        return json.decodeFromJsonElement(ListSerializer(ServerDraft.serializer()), o["drafts"] ?: JsonArray(emptyList())) to (o["at"].long ?: since)
    }

    suspend fun sendDrafts(drafts: List<DraftChange>) { ok(send("/drafts", "PUT", jobj("drafts" to json.encodeToJsonElement(ListSerializer(DraftChange.serializer()), drafts)))) }

    // Photos and files

    /** A photo's or file's bytes, as stored (sealed, in an encrypted vault). Null when the server has none. */
    suspend fun attachment(id: String): ByteArray? {
        val r = send("/attachments/" + part(id))
        if (r.status in listOf(404, 409, 503)) return null
        return ok(r).body
    }

    enum class UploadResult { Ok, NeedsDrive, NotConfigured, Rejected }

    /** Uploads a photo or file as the web app's `photoTransport.upload`. A sealed one says nothing of what it is. */
    suspend fun upload(
        id: String, data: ByteArray, mime: String, vaultId: String, sealed: Boolean, fileName: String? = null, width: Double? = null, height: Double? = null, duration: Double? = null,
    ): UploadResult {
        val q = mutableListOf("vault" to vaultId)
        if (sealed) q.add("sealed" to "1") else {
            if (fileName != null) { q.add("kind" to "file"); q.add("name" to fileName) }
            width?.let { q.add("w" to it.toInt().toString()) }
            height?.let { q.add("h" to it.toInt().toString()) }
            duration?.let { q.add("d" to it.toString()) }
        }
        val path = "/attachments/" + part(id)
        fun refused(r: HttpResponse): UploadResult {
            val error = errorOf(r)
            if (error == "drive_not_connected") return UploadResult.NeedsDrive
            if (error == "photos_not_configured") return UploadResult.NotConfigured
            if (r.status >= 500) throw ApiError.Status(r.status, error)
            return UploadResult.Rejected
        }
        if ((fileName != null || sealed) && data.size > WHOLE_BYTES) {
            q.add("size" to data.size.toString())
            repeat(2) {
                var r = send(path + "/upload" + query(q), "POST", null, mime)
                if (r.status !in 200..299) return refused(r)
                var at = runCatching { parseJson(r.body.decodeToString())["next"].long }.getOrNull()
                var expired = false
                while (at != null) {
                    val start = at.toInt()
                    val end = minOf(data.size, start + UPLOAD_PIECE)
                    r = send(path + "/upload", "PUT", data.copyOfRange(start, end), "application/octet-stream", mapOf("Content-Range" to "bytes $start-${end - 1}/${data.size}"))
                    val next = runCatching { parseJson(r.body.decodeToString()) }.getOrNull()
                    if (r.status == 409 && next["error"].str == "upload_expired") { expired = true; break }
                    if (r.status !in 200..299) return refused(r)
                    if (next["id"].str != null) return UploadResult.Ok
                    at = next["next"].long
                }
                if (!expired) return UploadResult.Ok
            }
            throw ApiError.Status(409)
        }
        val r = send(path + query(q), "PUT", data, mime)
        return if (r.status in 200..299) UploadResult.Ok else refused(r)
    }

    suspend fun attachments() = list(StoredAttachment.serializer(), "attachments", "/attachments")
    /** Sends photos and files no entry holds to the Trash, and brings back those held again. */
    suspend fun markAttachments(trash: List<TrashMark>, keep: List<String>) {
        ok(send("/attachments/state", "POST", jobj("trash" to json.encodeToJsonElement(ListSerializer(TrashMark.serializer()), trash), "keep" to jstrings(keep))))
    }

    enum class DeleteResult { Ok, Gone, InUse, NeedsDrive, Error }

    /** Deletes a photo or file in the Trash for good, from Google Drive too. */
    suspend fun deleteAttachment(id: String): DeleteResult {
        val r = send("/attachments/" + part(id), "DELETE")
        if (r.status in 200..299) return DeleteResult.Ok
        if (r.status == 404) return DeleteResult.Gone
        return when (errorOf(r)) { "in_use" -> DeleteResult.InUse; "drive_not_connected" -> DeleteResult.NeedsDrive; else -> DeleteResult.Error }
    }

    /** Lets anyone with its Drive link open it, and answers with the link, or a sentence saying why not. */
    suspend fun shareDriveLink(id: String): Result<String> {
        val r = runCatching { send("/attachments/" + part(id) + "/link", "POST", jobj()) }.getOrElse { return Result.failure(Exception("Sharing needs a connection.")) }
        val o = runCatching { parseJson(r.body.decodeToString()) }.getOrNull()
        o["url"].str?.takeIf { r.status in 200..299 }?.let { return Result.success(it) }
        val why = when {
            r.status == 404 -> "It isn't uploaded yet. Try again in a moment."
            o["error"].str == "drive_not_connected" -> "Connect Google Drive in Settings first."
            o["error"].str == "drive_refused" -> "Google Drive won't share it by a link (a Workspace that forbids it)."
            o["error"].str == "not_in_drive" -> "It isn't in a Google Drive."
            else -> "It couldn't be shared. Try again."
        }
        return Result.failure(Exception(why))
    }

    suspend fun stopDriveLink(id: String) = runCatching { send("/attachments/" + part(id) + "/link", "DELETE").status in 200..299 }.getOrDefault(false)

    // Settings

    suspend fun driveStatus() = json(DriveStatus.serializer(), "/drive")
    /** The Google page that connects Drive; opened in the browser. */
    suspend fun driveConnectUrl(): String = obj("/drive/connect", "POST", jobj())["url"].str ?: throw ApiError.Status(0)
    suspend fun disconnectDrive() { ok(send("/drive", "DELETE")) }
    suspend fun aiApps() = list(ConnectedApp.serializer(), "apps", "/ai/apps")
    suspend fun disconnectAiApp(id: String) { ok(send("/ai/apps/" + part(id), "DELETE")) }
    /** The address AI apps connect to. */
    val mcpUrl get() = site.trimEnd('/') + "/api/mcp"
    suspend fun accountSummary() = json(AccountSummary.serializer(), "/account/summary")

    /** Deletes this account and everything it owns. Throws a sentence saying what went wrong. */
    suspend fun deleteAccount(email: String) {
        val r = send("/account/delete", "POST", jobj("email" to j(email)))
        if (r.status !in 200..299) throw Exception(errorOf(r) ?: "The account couldn't be deleted. Try again.")
    }
}
