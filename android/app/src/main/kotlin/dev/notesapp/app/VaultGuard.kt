package dev.notesapp.app

import dev.notesapp.core.Vault
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Keeping private vaults shut, as the web's `VaultLocks`: every open vault locks after five minutes with no touch or
 * key, and when the phone's owner leaves the app or the screen goes off (`MainActivity`); after five wrong PINs, the
 * next try waits 30 seconds. Before 2026-11-25 the app locked only when asked to.
 */
object VaultGuard {
    /** Five minutes; a debug build takes `-PvaultIdleSeconds=20` to try it sooner. */
    val idleMs: Long get() = BuildConfig.VAULT_IDLE_SECONDS * 1000L
    const val FREE_TRIES = 5
    const val WAIT_MS = 30_000L
}

/** What trying a PIN came to, with the web's words for it. */
enum class PinResult(val problem: String?) {
    Ok(null),
    Wrong("That PIN isn't right."),
    Throttled("Too many tries. Wait 30 seconds and try again."),
}

/** Starts the five idle minutes again, as anything done in the app does. */
fun AppModel.touchVaults() {
    idleLock?.cancel()
    idleLock = if (openVaults.isEmpty()) null else scope.launch {
        delay(VaultGuard.idleMs)
        lockAll()
    }
}

private val AppModel.pinThrottled get() = System.currentTimeMillis() < pinBlockedUntil

/** A wrong PIN: the fifth in a row makes the next try wait. */
private fun AppModel.pinFailed(): PinResult {
    if (++pinFailures >= VaultGuard.FREE_TRIES) {
        pinBlockedUntil = System.currentTimeMillis() + VaultGuard.WAIT_MS
        pinFailures = 0
    }
    return PinResult.Wrong
}

/** Opens a private vault with its PIN, unless too many wrong ones were just tried. */
suspend fun AppModel.unlockWithPin(vault: Vault, pin: String): PinResult {
    if (pinThrottled) return PinResult.Throttled
    return if (unlock(vault, pin, false)) PinResult.Ok else pinFailed()
}

/** Opens every hidden vault this PIN opens, as one try, as the web's. */
suspend fun AppModel.unlockHidden(pin: String): PinResult {
    if (pinThrottled) return PinResult.Throttled
    var opened = 0
    for (v in vaults) if (v.hidden && v.id !in openVaults && unlock(v, pin, false)) opened++
    return if (opened > 0) PinResult.Ok else pinFailed()
}
