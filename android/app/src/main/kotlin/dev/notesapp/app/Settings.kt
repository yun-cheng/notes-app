package dev.notesapp.app

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Settings kept on this device only, as the web app keeps them in the browser: how previews show and how Copy copies. */
object Settings {
    private var prefs: android.content.SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
        copyStyle = prefs?.getString("copyStyle", null) ?: "rich"
        photoStyle = prefs?.getString("photoStyle", null) ?: "large"
        linkStyle = prefs?.getString("linkStyle", null) ?: "card"
        voiceVolume = prefs?.getFloat("voiceVolume", 1f) ?: 1f
        voiceMuted = prefs?.getBoolean("voiceMuted", false) ?: false
        folded = prefs?.getStringSet("sidebarFolded", null)?.toSet() ?: emptySet()
    }

    /** Sidebar sections folded on this device, by ID, as the web keeps them. */
    var folded by mutableStateOf(setOf<String>())
        private set

    fun isFolded(id: String) = id in folded

    fun toggleFolded(id: String) {
        folded = if (id in folded) folded - id else folded + id
        prefs?.edit()?.putStringSet("sidebarFolded", folded)?.apply()
    }

    private fun save(key: String, value: String) { prefs?.edit()?.putString(key, value)?.apply() }

    /** `markdown` pastes back whole; `plain` is just the words. */
    var copyStyle by mutableStateOf("rich")
        private set
    /** `large`, `thumbs`, or `off` for a count. */
    var photoStyle by mutableStateOf("large")
        private set
    /** `card`, `compact` or `off`. */
    var linkStyle by mutableStateOf("card")
        private set

    /** The volume all voice messages play at, 0 to 1, and whether they're muted, as the web keeps them. */
    var voiceVolume by mutableStateOf(1f)
        private set
    var voiceMuted by mutableStateOf(false)
        private set

    fun setVoice(volume: Float, muted: Boolean) {
        voiceVolume = volume.coerceIn(0f, 1f)
        voiceMuted = muted
        prefs?.edit()?.putFloat("voiceVolume", voiceVolume)?.putBoolean("voiceMuted", muted)?.apply()
    }

    fun copyAs(v: String) { copyStyle = v; save("copyStyle", v) }
    fun photosAs(v: String) { photoStyle = v; save("photoStyle", v) }
    fun linksAs(v: String) { linkStyle = v; save("linkStyle", v) }
}
