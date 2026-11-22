package dev.notesapp.core

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Values made by the web app's crypto code, the same ones the Swift tests check. */
class CryptoTest {
    private val rawKey = "NumxWqjRaxqTH/cZae5pbj+iXJYtaaJ6QGZudOs8NFE="
    private val vaultKey = unb64(rawKey)!!
    companion object {
        val ENCRYPTION = jobj(
        "version" to j(1),
        "kdf" to jobj("name" to j("argon2id"), "salt" to j("UdG8McNxBKga+AkND5BO6A=="), "memory" to j(64L), "iterations" to j(1L), "parallelism" to j(1L)),
        "wrapped" to j("j9QUtfKym3mFCfhZLA06kYQaLDWCy3RBHP57Cw0dtC4r9bzkzFpdEHYerFEw85H4Dm6S1TY9w9Bol5d/"),
        "recovery" to j("2Im3QIq3MJ3aTelWXJR71EMlK1yyjleLNu/Akta1vIu5tY9jtQ0n0BqIymb5z6Agm6SyfU0JTi74g1d9"),
    )
        const val RECOVERY = "4J66-R6XW-KDJY-9XRC-CN6B-GR8T-HEA9-YJRK"
        const val PAYLOAD = "e1:IUhZ3PNrJsDhgwfcJzFiTstho5VHFxnJG19z0mSLpaoEU4us3VbaUYEnCEzxZbYqx+BWKONybxFIg7/fNfEvNoWrb+7QSBUcvWYA5BNtoarJRYksnWM8aF7CixHFqlaDNDhMgEj5BCY0Cp1O"
    }
    private val encryption = ENCRYPTION
    private val payload = PAYLOAD
    private val member = jobj(
        "kdf" to jobj("name" to j("argon2id"), "salt" to j("lZzrYH35XzG7gPtLZCQsMg=="), "memory" to j(64L), "iterations" to j(1L), "parallelism" to j(1L)),
        "wrapped" to j("HesSL2rbAghnlq5FbqMLjoj0FXlW5SkCIxbWp92kz0PQtD/Bd6i4+PFcJVTzAROg4I3FYyas/LEu5IayeMZvTMk8+CnaE5UNHqEvT5FzG0rvjr2YHtyAV4liSJCkl6tthLY1cvVN/ZXSPi2UhaaDA8kzlDsXxNHr/l9JN/NkSotuJ4gZmlB/00W0a+DR6N324T//SZ7gB3RTPlJ1b9v5hdZL8Utg+A=="),
        "public" to j("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4D4PtP3c4xGMv7jqLZS2lyco78mR2nAGjDiUh8hCqB18etZ9Or2Ov99g1ElIM7MyZaKu3NiJT8ePBefkOmeBCA=="),
        "grant" to j("BG+WET4OYMhPWAJrZTpLyUrSIe7iFgB0a576stpESlOHlQpFb/RApnFvTPr1Gd/VO0c15utm/Ju0KK3XlWsztG0McY5JWA1edWOeMN3KM+2wLQJcWaFEiTdgXvXZ+jX0bP1IE2SHu5hfJa8L7td5uHgKIwXMXdotpgvxPTc="),
    )
    private val fast = VaultKeys.Kdf(64, 1, 1)
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun blake2bAndArgon2idMatchTheirRFCs() {
        assertEquals("ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923", hex(Blake2b.hash("abc".toByteArray(), 64)))
        val tag = Argon2id.hash(ByteArray(32) { 1 }, ByteArray(16) { 2 }, ByteArray(8) { 3 }, ByteArray(12) { 4 }, memoryKiB = 32, iterations = 3, parallelism = 4, length = 32)
        assertEquals("0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659", hex(tag))
    }

    @Test fun opensTheWebAppsVault() {
        assertEquals(rawKey, b64(VaultKeys.unlock(encryption, "2468", "v")!!))
        assertNull(VaultKeys.unlock(encryption, "1357", "v"))
        assertEquals(rawKey, b64(VaultCrypto.unlock(encryption, "4j66-r6xw-kdjy-9xrc-cn6b-gr8t-hea9-yjrk")!!))
        val text = VaultCrypto.decryptPayload(vaultKey, payload, "card-1", "vault-1")!!
        assertTrue(text.contains(""""title":"Secret""""))
        assertNull(VaultCrypto.decryptPayload(vaultKey, payload, "card-2", "vault-1"))
        val salt = ByteArray(16) { 7 }
        assertTrue(VaultPin.verify("4321", jobj("salt" to j(b64(salt)), "hash" to j("c1Gl7KFFAESaww/JAnmMf2hIA+g+cyYUK9+LPoRe+tg="), "iterations" to j(1000L))))
    }

    @Test fun membersAndCodes() {
        val copy = jobj("version" to j(1), "member" to member)
        assertEquals(rawKey, b64(VaultKeys.unlock(copy, "1357", "v-shared")!!))
        assertNull(VaultKeys.unlock(copy, "1358", "v-shared"))
        assertNull(VaultKeys.unlock(copy, "1357", "v-other"))
        assertEquals("8554 4710 2605 6903", VaultKeys.keyCode(member["public"].str!!))
        assertEquals("9938 2600 6745 6795", VaultKeys.vaultKeyCode(vaultKey, "v-shared"))
        assertEquals("Looks good", VaultKeys.decryptComment(vaultKey, "e1:+ZQlq41cEpZTRBnGlliNIcnovvBlqWNHxTTefpZQqTQltBBVqqI=", "c1", "v-shared"))
        // Let in here, and with a new PIN.
        val asked = VaultKeys.request("2580", fast)
        val let = asked.with("grant", j(VaultKeys.grant(vaultKey, asked["public"].str!!, "v-shared")))
        assertContentEquals(vaultKey, VaultKeys.unlock(jobj("version" to j(1), "member" to let), "2580", "v-shared"))
        val changed = VaultKeys.changeMemberPin(vaultKey, "0000", "v-shared", fast)
        assertContentEquals(vaultKey, VaultKeys.unlock(jobj("version" to j(1), "member" to changed), "0000", "v-shared"))
        val made = VaultKeys.create("4821", fast)
        assertEquals(39, made.recoveryKey.length)
        assertContentEquals(made.key, VaultKeys.unlock(made.encryption, "4821", "v"))
        assertContentEquals(made.key, VaultCrypto.unlock(VaultKeys.changePin(made.encryption, made.key, "1111", fast), made.recoveryKey))
    }

    @Test fun sealedFiles() {
        val web = unb64("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")!!
        assertEquals("v-enc", AttachmentSeal.sealedVault(web))
        val (data, facts) = AttachmentSeal.open(web, "att-1", vaultKey)!!
        assertContentEquals(ByteArray(3000) { (it % 251).toByte() }, data)
        assertEquals("cat.jpg", facts.name)
        assertNull(AttachmentSeal.open(web, "att-2", vaultKey))
        val big = ByteArray(2 * AttachmentSeal.PIECE + 5) { (it % 199).toByte() }
        val sealed = AttachmentSeal.seal(big, "v1", "v-enc", vaultKey, AttachmentSeal.Facts("video/mp4", big.size, "clip.mp4", duration = 3.0))
        val opened = assertNotNull(AttachmentSeal.open(sealed, "v1", vaultKey))
        assertContentEquals(big, opened.first)
        assertEquals(1024, AttachmentSeal.padded(1000))
    }
}
