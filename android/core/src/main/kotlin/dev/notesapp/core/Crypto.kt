package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
fun unb64(text: String?): ByteArray? = text?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }

/**
 * End-to-end encryption for private vaults, byte for byte as the web app's `crypto/vaultKeys.ts`. A card payload in an
 * encrypted vault is `e1:` + base64(iv + ciphertext + tag), AES-256-GCM, with the card's ID and vault as associated data.
 */
object VaultCrypto {
    const val PREFIX = "e1:"
    val wrapAAD = "notes-app vault key v1".toByteArray()
    const val RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    private val random = SecureRandom()

    fun random(n: Int) = ByteArray(n).also(random::nextBytes)
    fun isEncrypted(payload: String) = payload.startsWith(PREFIX)
    private fun aad(cardId: String, vaultId: String) = "$cardId|$vaultId".toByteArray()

    /** AES-GCM: IV, then ciphertext and tag. */
    fun sealBytes(key: ByteArray, plain: ByteArray, aad: ByteArray?, iv: ByteArray = random(12)): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        if (aad != null) c.updateAAD(aad)
        return iv + c.doFinal(plain)
    }

    fun openBytes(key: ByteArray, sealed: ByteArray, aad: ByteArray?): ByteArray? = runCatching {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, sealed, 0, 12))
        if (aad != null) c.updateAAD(aad)
        c.doFinal(sealed, 12, sealed.size - 12)
    }.getOrNull()

    fun seal(key: ByteArray, plain: ByteArray, aad: ByteArray) = b64(sealBytes(key, plain, aad))
    fun open(key: ByteArray, sealed: String, aad: ByteArray) = unb64(sealed)?.takeIf { it.size > 28 }?.let { openBytes(key, it, aad) }

    fun encryptPayload(key: ByteArray, text: String, cardId: String, vaultId: String) = PREFIX + seal(key, text.toByteArray(), aad(cardId, vaultId))
    fun decryptPayload(key: ByteArray, data: String, cardId: String, vaultId: String): String? {
        if (!isEncrypted(data)) return null
        return open(key, data.removePrefix(PREFIX), aad(cardId, vaultId))?.decodeToString()
    }

    /** The recovery key as typed: case, spaces and dashes don't matter, and look-alike letters are forgiven. */
    fun normalizeRecoveryKey(text: String): String? {
        val clean = text.uppercase().filter { !it.isWhitespace() && it != '-' }.replace("O", "0").replace("I", "1").replace("L", "1")
        return clean.takeIf { it.length == 32 && it.all { c -> c in RECOVERY_ALPHABET } }
    }

    fun recoveryKek(text: String): ByteArray? = normalizeRecoveryKey(text)?.let { MessageDigest.getInstance("SHA-256").digest("notes-app recovery v1:$it".toByteArray()) }

    fun unlock(encryption: JsonElement, recoveryKey: String): ByteArray? {
        val kek = recoveryKek(recoveryKey) ?: return null
        return open(kek, encryption["recovery"].str ?: return null, wrapAAD)
    }
}

/** Opening private vaults with their PIN, as the web app's `domain/pin.ts`. */
object VaultPin {
    const val MIN_LENGTH = 4

    fun pbkdf2(pin: String, salt: ByteArray, iterations: Int): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, iterations, 256)).encoded

    fun verify(pin: String, stored: JsonElement?): Boolean {
        val salt = unb64(stored["salt"].str) ?: return false
        val hash = stored["hash"].str ?: return false
        val iterations = stored["iterations"].long ?: return false
        if (iterations !in 1..10_000_000) return false
        return b64(pbkdf2(pin, salt, iterations.toInt())) == hash
    }

    /** A verifier for a PIN: PBKDF2-SHA256, 300,000 rounds, a random salt. */
    fun hash(pin: String): JsonObject {
        val salt = VaultCrypto.random(16)
        return jobj("salt" to j(b64(salt)), "hash" to j(b64(pbkdf2(pin, salt, 300_000))), "iterations" to j(300_000L))
    }
}

/** Making and sharing encrypted vaults' keys, as the web app's `crypto/vaultKeys.ts`, byte for byte. */
object VaultKeys {
    private val memberAAD = "notes-app member key v1".toByteArray()
    private val grantInfo = "notes-app vault grant v1".toByteArray()

    data class Kdf(val memory: Int = 19_456, val iterations: Int = 2, val parallelism: Int = 1)

    fun pinKey(pin: String, kdf: JsonElement?): ByteArray? {
        if (kdf["name"].str != "argon2id") return null
        val salt = unb64(kdf["salt"].str) ?: return null
        val memory = kdf["memory"].long ?: return null
        val iterations = kdf["iterations"].long ?: return null
        val parallelism = kdf["parallelism"].long ?: return null
        if (memory !in 8..1_048_576 || iterations !in 1..64 || parallelism !in 1..16) return null
        return Argon2id.hash(java.text.Normalizer.normalize(pin, java.text.Normalizer.Form.NFC).toByteArray(), salt, memoryKiB = memory.toInt(), iterations = iterations.toInt(), parallelism = parallelism.toInt(), length = 32)
    }

    private fun newKdf(k: Kdf) = jobj("name" to j("argon2id"), "salt" to j(b64(VaultCrypto.random(16))), "memory" to j(k.memory.toLong()), "iterations" to j(k.iterations.toLong()), "parallelism" to j(k.parallelism.toLong()))

    /** Recovery keys: 160 random bits in Crockford base32, grouped in fours. */
    fun base32(bytes: ByteArray): String {
        var bits = 0
        var value = 0
        val out = StringBuilder()
        for (b in bytes) {
            value = (value shl 8) or (b.toInt() and 0xFF)
            bits += 8
            while (bits >= 5) { out.append(VaultCrypto.RECOVERY_ALPHABET[(value ushr (bits - 5)) and 31]); bits -= 5 }
            value = value and ((1 shl bits) - 1)
        }
        return out.chunked(4).joinToString("-")
    }

    data class NewKey(val key: ByteArray, val encryption: JsonObject, val recoveryKey: String)

    fun create(pin: String, kdf: Kdf = Kdf()): NewKey {
        val raw = VaultCrypto.random(32)
        val recoveryKey = base32(VaultCrypto.random(20))
        val params = newKdf(kdf)
        return NewKey(
            raw,
            jobj("version" to j(1), "kdf" to params, "wrapped" to j(VaultCrypto.seal(pinKey(pin, params)!!, raw, VaultCrypto.wrapAAD)), "recovery" to j(VaultCrypto.seal(VaultCrypto.recoveryKek(recoveryKey)!!, raw, VaultCrypto.wrapAAD))),
            recoveryKey,
        )
    }

    fun changePin(encryption: JsonElement, key: ByteArray, newPin: String, kdf: Kdf = Kdf()): JsonObject {
        val params = newKdf(kdf)
        return (encryption as JsonObject).with("kdf", params).with("wrapped", j(VaultCrypto.seal(pinKey(newPin, params)!!, key, VaultCrypto.wrapAAD)))
    }

    fun isMemberCopy(encryption: JsonElement?) = encryption.obj?.containsKey("member") == true

    fun unlock(encryption: JsonElement, pin: String, vaultId: String): ByteArray? {
        if (isMemberCopy(encryption)) {
            val member = encryption["member"]
            if (member.isNull) return null
            return openMemberKey(member!!, pin, vaultId)
        }
        val kek = pinKey(pin, encryption["kdf"]) ?: return null
        return VaultCrypto.open(kek, encryption["wrapped"].str ?: return null, VaultCrypto.wrapAAD)
    }

    // A member's copy: P-256 key agreement.

    private val ecSpec = ECGenParameterSpec("secp256r1")
    private fun ecParams() = (KeyPairGenerator.getInstance("EC").apply { initialize(ecSpec) }.generateKeyPair().public as ECPublicKey).params

    /** An uncompressed point, as WebCrypto's `raw` export of a P-256 public key: 0x04, X, Y. */
    private fun raw(pub: ECPublicKey): ByteArray {
        fun fixed(n: BigInteger) = n.toByteArray().let { b -> if (b.size > 32) b.copyOfRange(b.size - 32, b.size) else ByteArray(32 - b.size) + b }
        return byteArrayOf(4) + fixed(pub.w.affineX) + fixed(pub.w.affineY)
    }

    private fun fromRaw(bytes: ByteArray): ECPublicKey {
        val x = BigInteger(1, bytes.copyOfRange(1, 33))
        val y = BigInteger(1, bytes.copyOfRange(33, 65))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), ecParams())) as ECPublicKey
    }

    private fun hkdf(secret: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = mac.doFinal(secret)
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        return mac.doFinal(info + byteArrayOf(1)).copyOf(32)
    }

    private fun agree(private: java.security.PrivateKey, public: java.security.PublicKey): ByteArray =
        KeyAgreement.getInstance("ECDH").apply { init(private); doPhase(public, true) }.generateSecret()

    private fun grantAAD(vaultId: String) = "grant|$vaultId".toByteArray()

    /** A new key pair for asking a vault's owner for its key, the private half wrapped under the member's PIN. */
    fun request(pin: String, kdf: Kdf = Kdf()): JsonObject {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ecSpec) }.generateKeyPair()
        val params = newKdf(kdf)
        return jobj("kdf" to params, "wrapped" to j(VaultCrypto.seal(pinKey(pin, params)!!, pair.private.encoded, memberAAD)), "public" to j(b64(pair.public.encoded)), "grant" to JsonNull)
    }

    /** Seals a vault key for a member's public key: an ephemeral public half, then the key sealed under ECDH and HKDF. */
    fun grant(vaultKey: ByteArray, memberPublic: String, vaultId: String): String {
        val member = unb64(memberPublic)!!
        val theirs = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(member))
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ecSpec) }.generateKeyPair()
        val ephemeral = raw(pair.public as ECPublicKey)
        val key = hkdf(agree(pair.private, theirs), ephemeral, grantInfo + member)
        return b64(ephemeral + VaultCrypto.sealBytes(key, vaultKey, grantAAD(vaultId)))
    }

    private fun openMemberKey(member: JsonElement, pin: String, vaultId: String): ByteArray? = runCatching {
        val grant = unb64(member["grant"].str) ?: return null
        val publicBytes = unb64(member["public"].str) ?: return null
        val kek = pinKey(pin, member["kdf"]) ?: return null
        val privateBytes = VaultCrypto.open(kek, member["wrapped"].str ?: return null, memberAAD) ?: return null
        val private = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(privateBytes))
        val ephemeral = grant.copyOfRange(0, 65)
        val key = hkdf(agree(private, fromRaw(ephemeral)), ephemeral, grantInfo + publicBytes)
        VaultCrypto.openBytes(key, grant.copyOfRange(65, grant.size), grantAAD(vaultId))
    }.getOrNull()

    fun changeMemberPin(vaultKey: ByteArray, newPin: String, vaultId: String, kdf: Kdf = Kdf()): JsonObject {
        val next = request(newPin, kdf)
        return next.with("grant", j(grant(vaultKey, next["public"].str!!, vaultId)))
    }

    private fun code(bytes: ByteArray) = (0 until 8 step 2).joinToString(" ") { i -> "%04d".format((((bytes[i].toInt() and 0xFF) shl 8) or (bytes[i + 1].toInt() and 0xFF)) % 10_000) }

    fun keyCode(publicKey: String) = code(MessageDigest.getInstance("SHA-256").digest(unb64(publicKey) ?: ByteArray(0)))

    /** The tag of nothing sealed under a nonce of zeros, bound to the vault. */
    fun vaultKeyCode(key: ByteArray, vaultId: String): String {
        val sealed = VaultCrypto.sealBytes(key, ByteArray(0), "key check|$vaultId".toByteArray(), ByteArray(12))
        return code(sealed.copyOfRange(12, sealed.size))
    }

    private fun commentAAD(cardId: String, vaultId: String) = "comment|$cardId|$vaultId".toByteArray()
    fun encryptComment(key: ByteArray, body: String, cardId: String, vaultId: String) = VaultCrypto.PREFIX + VaultCrypto.seal(key, body.toByteArray(), commentAAD(cardId, vaultId))
    fun decryptComment(key: ByteArray, body: String, cardId: String, vaultId: String): String? =
        if (!VaultCrypto.isEncrypted(body)) null else VaultCrypto.open(key, body.removePrefix(VaultCrypto.PREFIX), commentAAD(cardId, vaultId))?.decodeToString()
}

/** Photos and files of encrypted vaults, sealed as the web app's `crypto/attachmentSeal.ts`. */
object AttachmentSeal {
    private val magic = byteArrayOf(0x6E, 0x61, 0x65, 0x31)
    const val PIECE = 1024 * 1024
    private const val TAG = 16

    @kotlinx.serialization.Serializable
    data class Facts(val mime: String, val size: Int, val name: String? = null, val width: Double? = null, val height: Double? = null, val duration: Double? = null)

    fun padded(size: Int): Int {
        if (size < 2) return size
        val e = 31 - Integer.numberOfLeadingZeros(size)
        val s = (31 - Integer.numberOfLeadingZeros(e)) + 1
        val step = 1 shl (e - s)
        return (size + step - 1) / step * step
    }

    private fun u32(d: ByteArray, at: Int) = ((d[at].toInt() and 0xFF) shl 24) or ((d[at + 1].toInt() and 0xFF) shl 16) or ((d[at + 2].toInt() and 0xFF) shl 8) or (d[at + 3].toInt() and 0xFF)
    private fun u16(d: ByteArray, at: Int) = ((d[at].toInt() and 0xFF) shl 8) or (d[at + 1].toInt() and 0xFF)

    private data class Header(val vaultId: String, val pieceBytes: Int, val bodyAt: Int, val facts: ByteArray)

    private fun readHeader(d: ByteArray): Header? {
        if (d.size < 14 || !d.copyOfRange(0, 4).contentEquals(magic)) return null
        val pieceBytes = u32(d, 4)
        val idLength = u16(d, 8)
        val factsAt = 10 + idLength
        if (pieceBytes < 1 || d.size < factsAt + 4) return null
        val factsLength = u32(d, factsAt)
        val bodyAt = factsAt + 4 + factsLength
        if (factsLength < 12 + TAG || d.size < bodyAt) return null
        return Header(d.copyOfRange(10, factsAt).decodeToString(), pieceBytes, bodyAt, d.copyOfRange(factsAt + 4, bodyAt))
    }

    fun sealedVault(d: ByteArray) = readHeader(d)?.vaultId
    private fun factsAAD(id: String, vaultId: String) = "notes-app attachment v1|$id|$vaultId".toByteArray()
    private fun nonce(index: Int, last: Boolean) = ByteArray(12).also { n -> n[0] = (index ushr 24).toByte(); n[1] = (index ushr 16).toByte(); n[2] = (index ushr 8).toByte(); n[3] = index.toByte(); n[11] = if (last) 1 else 0 }

    fun open(d: ByteArray, id: String, vaultKey: ByteArray): Pair<ByteArray, Facts>? {
        val header = readHeader(d) ?: return null
        val plain = VaultCrypto.openBytes(vaultKey, header.facts, factsAAD(id, header.vaultId)) ?: return null
        val told = parseJson(plain.decodeToString()) ?: return null
        val facts = runCatching { json.decodeFromJsonElement(Facts.serializer(), told) }.getOrNull() ?: return null
        val key = unb64(told["k"].str) ?: return null
        val sealedPiece = header.pieceBytes + TAG
        val body = d.size - header.bodyAt
        val count = maxOf(1, (body + sealedPiece - 1) / sealedPiece)
        val out = java.io.ByteArrayOutputStream(body)
        for (i in 0 until count) {
            val at = header.bodyAt + i * sealedPiece
            val piece = d.copyOfRange(at, minOf(d.size, at + sealedPiece))
            val opened = VaultCrypto.openBytes(key, nonce(i, i == count - 1) + piece, null) ?: return null
            out.write(opened)
        }
        val bytes = out.toByteArray()
        if (bytes.size != padded(facts.size) && bytes.size != facts.size) return null
        return bytes.copyOf(facts.size) to facts
    }

    fun seal(data: ByteArray, id: String, vaultId: String, vaultKey: ByteArray, facts: Facts): ByteArray {
        val raw = VaultCrypto.random(32)
        var text = json.encodeToJsonElement(Facts.serializer(), facts.copy(size = data.size)).let { (it as JsonObject).with("k", j(b64(raw))) }.sortedText().toByteArray()
        text += ByteArray((text.size + 127) / 128 * 128 - text.size) { 0x20 }
        val sealedFacts = VaultCrypto.sealBytes(vaultKey, text, factsAAD(id, vaultId))
        val vault = vaultId.toByteArray()
        val out = java.io.ByteArrayOutputStream()
        fun be(v: Int, n: Int) = ByteArray(n) { (v ushr (8 * (n - 1 - it))).toByte() }
        out.write(magic); out.write(be(PIECE, 4)); out.write(be(vault.size, 2)); out.write(vault); out.write(be(sealedFacts.size, 4)); out.write(sealedFacts)
        val plain = data + ByteArray(padded(data.size) - data.size)
        val count = maxOf(1, (plain.size + PIECE - 1) / PIECE)
        for (i in 0 until count) {
            val piece = plain.copyOfRange(i * PIECE, minOf(plain.size, (i + 1) * PIECE))
            val sealed = VaultCrypto.sealBytes(raw, piece, null, nonce(i, i == count - 1))
            out.write(sealed, 12, sealed.size - 12)
        }
        return out.toByteArray()
    }
}
