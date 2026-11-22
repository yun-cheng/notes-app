package dev.notesapp.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import dev.notesapp.core.Account
import dev.notesapp.core.json
import kotlinx.serialization.builtins.ListSerializer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Each account's session token, sealed with a key the Android Keystore keeps and never lets out, as the Swift app
 * keeps them in the Keychain. The accounts signed in on this device are listed beside them.
 */
class Tokens(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val alias = "dev.notesapp.notes.session"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return gen.generateKey()
    }

    fun token(accountId: String): String? {
        val sealed = prefs.getString("token:$accountId", null) ?: return null
        return runCatching {
            val bytes = Base64.decode(sealed, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
            String(c.doFinal(bytes, 12, bytes.size - 12))
        }.getOrNull()
    }

    fun save(token: String, accountId: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val sealed = c.iv + c.doFinal(token.toByteArray())
        prefs.edit().putString("token:$accountId", Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    fun clear(accountId: String) = prefs.edit().remove("token:$accountId").apply()

    var accounts: List<Account>
        get() = prefs.getString("accounts", null)?.let { runCatching { json.decodeFromString(ListSerializer(Account.serializer()), it) }.getOrNull() } ?: emptyList()
        set(v) = prefs.edit().putString("accounts", json.encodeToString(ListSerializer(Account.serializer()), v)).apply()

    var current: String?
        get() = prefs.getString("current", null)
        set(v) = prefs.edit().putString("current", v).apply()
}
