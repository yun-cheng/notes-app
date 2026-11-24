package dev.notesapp.app

import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.notesapp.core.Vault
import kotlinx.coroutines.suspendCancellableCoroutine
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume

/**
 * Opening a private vault with the phone's fingerprint, as the web app's "Unlock with fingerprint". Each vault gets a
 * key in the Android Keystore that only a strong biometric unlocks, for one use at a time; it seals the vault's key
 * (an encrypted vault) or a mark (one locked by a PIN alone). Adding a fingerprint to the phone turns it off, as
 * the Keystore throws such a key away.
 */
object DeviceUnlock {
    private val mark = "open".toByteArray()
    private fun prefs(c: Context) = c.getSharedPreferences("deviceUnlock", Context.MODE_PRIVATE)
    private fun name(userId: String, vaultId: String) = "$userId:$vaultId"
    private fun alias(userId: String, vaultId: String) = "dev.notesapp.notes.vault.$userId.$vaultId"

    class NeedsPin : Exception("Open the vault first.")
    class Failed : Exception("Fingerprint couldn't be set up on this device.")

    /** Whether the phone can check a fingerprint (or another strong biometric) at all. */
    fun available(c: Context) = BiometricManager.from(c).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    fun isOn(c: Context, userId: String, vaultId: String) = prefs(c).contains(name(userId, vaultId))

    fun turnOff(c: Context, userId: String, vaultId: String) {
        prefs(c).edit().remove(name(userId, vaultId)).apply()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias(userId, vaultId)) }
    }

    private fun newKey(userId: String, vaultId: String): SecretKey {
        val spec = KeyGenParameterSpec.Builder(alias(userId, vaultId), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        else @Suppress("DEPRECATION") spec.setUserAuthenticationValidityDurationSeconds(-1)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec.build()) }.generateKey()
    }

    private fun storedKey(userId: String, vaultId: String) =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(alias(userId, vaultId), null) as? SecretKey

    /** Shows the system's fingerprint sheet for a cipher, and gives it back unlocked, or null if it wasn't given. */
    private suspend fun prompt(activity: FragmentActivity, title: String, cipher: Cipher): Cipher? = suspendCancellableCoroutine { done ->
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { if (done.isActive) done.resume(result.cryptoObject?.cipher) }
            override fun onAuthenticationError(code: Int, message: CharSequence) { if (done.isActive) done.resume(null) }
            // A finger that didn't match: the sheet stays up for another try.
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setNegativeButtonText("Use PIN").setAllowedAuthenticators(BIOMETRIC_STRONG).build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
        done.invokeOnCancellation { prompt.cancelAuthentication() }
    }

    /** Turns it on: a fingerprint seals the open vault's key (or the mark) with a key only a fingerprint opens again. */
    suspend fun turnOn(activity: FragmentActivity, vault: Vault, userId: String, vaultKey: ByteArray?): Boolean {
        val secret = if (vault.isEncrypted) vaultKey ?: throw NeedsPin() else mark
        val cipher = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, newKey(userId, vault.id)) }
        } catch (_: Exception) { throw Failed() }
        val open = prompt(activity, "Open ${vault.name} with your fingerprint", cipher) ?: run { turnOff(activity, userId, vault.id); return false }
        val sealed = try { open.iv + open.doFinal(secret) } catch (_: Exception) { turnOff(activity, userId, vault.id); throw Failed() }
        prefs(activity).edit().putString(name(userId, vault.id), Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
        return true
    }

    /** Asks for the fingerprint and gives what's kept: the vault's key, or the mark. Null if it wasn't given. */
    suspend fun read(activity: FragmentActivity, vault: Vault, userId: String): ByteArray? {
        val sealed = prefs(activity).getString(name(userId, vault.id), null)?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null
        val cipher = try {
            val key = storedKey(userId, vault.id) ?: throw KeyPermanentlyInvalidatedException()
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed, 0, 12)) }
        } catch (_: KeyPermanentlyInvalidatedException) {
            // A fingerprint was added since: the key is gone, and the PIN has to open the vault.
            turnOff(activity, userId, vault.id)
            return null
        }
        val open = prompt(activity, "Open ${vault.name}", cipher) ?: return null
        return runCatching { open.doFinal(sealed, 12, sealed.size - 12) }.getOrNull()
    }
}

/** The activity behind a Compose context, which the fingerprint sheet needs. */
fun Context.fragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.fragmentActivity()
    else -> null
}

/** Opens a private vault with the fingerprint. An encrypted one gets its key back from the Keystore. */
suspend fun AppModel.unlockWithDevice(activity: FragmentActivity, vault: Vault): Boolean {
    val secret = DeviceUnlock.read(activity, vault, accountId) ?: return false
    if (vault.isEncrypted) {
        // A mark kept before the vault was encrypted holds no key: the PIN has to open it now.
        if (secret.size != 32) { DeviceUnlock.turnOff(activity, accountId, vault.id); return false }
        repo.keyring.set(vault.id, secret)
    }
    openVault(vault.id)
    return true
}
