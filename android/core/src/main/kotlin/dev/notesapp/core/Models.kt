package dev.notesapp.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** The stored and synced shape of a card. `payload` is opaque to the server: JSON, or `e1:` ciphertext. */
@Serializable
data class CardRecord(
    val id: String,
    val vault_id: String,
    val updated_at: Long,
    val deleted: Boolean,
    val seq: Long,
    val payload: String,
)

@Serializable
data class Vault(
    val id: String,
    val name: String,
    val owner_id: String,
    val lock: String = "none",
    val ai_access: String = "off",
    val created_at: Long = 0,
    /** PIN verifier: salt, hash and iterations, as the web app makes them. This account's own. */
    val pin: JsonElement? = null,
    val hidden: Boolean = false,
    val role: String? = null,
    val members: Int? = null,
    /** Set when the vault is end-to-end encrypted: the owner's copy of its key, or a member's (`member`). */
    val encryption: JsonElement? = null,
    /** For the owner of an encrypted vault: how many members wait to be let in. */
    val waiting: Int? = null,
    val members_need_pin: Boolean? = null,
    /** This account hasn't set the PIN the owner asks for, or hasn't been let in: the server sends none of its cards. */
    val withheld: Boolean? = null,
    /** Explicit per-vault override, or null when following the owner's default AI access. */
    val ai_access_override: String? = null,
) {
    val isPrivate get() = lock == "pin"
    val isEncrypted get() = !encryption.isNull
    val isOwner get() = (role ?: "owner") == "owner"
    val isWithheld get() = withheld == true
    val needsMemberPins get() = members_need_pin == true
    val isMemberCopy get() = encryption.obj?.containsKey("member") == true
    val aiAccessSetting get() = ai_access_override ?: "default"
    fun isDiary(userId: String) = id == "diary-$userId"
    fun isDefault(userId: String) = id == "vault-$userId"
}

@Serializable
data class Account(val id: String, val email: String, val name: String, val picture: String? = null)

@Serializable
data class SessionInfo(val user: Account, val vaults: List<Vault>, val token: String? = null)

/** A card shared with this account from outside its vaults. */
@Serializable
data class SharedCard(val card_id: String, val role: String, val shared_by: String)

/** A card shared with everyone in one of this account's vaults: it shows there as well as in its own. */
@Serializable
data class VaultShare(val card_id: String, val vault_id: String)

@Serializable
data class CommentCount(val card_id: String, val open: Int)

@Serializable
data class SharedResponse(val cards: List<SharedCard>, val vaults: List<VaultShare>? = null, val comments: List<CommentCount>? = null)

@Serializable
data class PullResponse(val records: List<CardRecord>, val gone: List<String>? = null, val next: Long, val more: Boolean)

sealed class PushResult(open val id: String) {
    data class Ok(override val id: String, val seq: Long) : PushResult(id)
    /** Both sides changed; this device's newer version was saved, replacing `loser`. */
    data class ClientWon(override val id: String, val seq: Long, val loser: CardRecord) : PushResult(id)
    /** Both sides changed; the server's newer version was kept. */
    data class ServerWon(override val id: String, val server: CardRecord) : PushResult(id)
    data class Retry(override val id: String) : PushResult(id)
    data class Refused(override val id: String) : PushResult(id)

    companion object {
        fun from(o: JsonObject): PushResult {
            val id = o["id"].str ?: ""
            return when (o["status"].str) {
                "ok" -> Ok(id, o["seq"].long ?: 0)
                "conflict_client_won" -> ClientWon(id, o["seq"].long ?: 0, json.decodeFromJsonElement(CardRecord.serializer(), o["loser"]!!))
                "conflict_server_won" -> ServerWon(id, json.decodeFromJsonElement(CardRecord.serializer(), o["server"]!!))
                "retry" -> Retry(id)
                else -> Refused(id)
            }
        }
    }
}

const val PUSH_BATCH = 40
