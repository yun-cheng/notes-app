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
        copyStyle = prefs?.getString("copyStyle", null) ?: "markdown"
        photoStyle = prefs?.getString("photoStyle", null) ?: "large"
        linkStyle = prefs?.getString("linkStyle", null) ?: "card"
    }

    private fun save(key: String, value: String) { prefs?.edit()?.putString(key, value)?.apply() }

    /** `markdown` pastes back whole; `plain` is just the words. */
    var copyStyle by mutableStateOf("markdown")
        private set
    /** `large`, `thumbs`, or `off` for a count. */
    var photoStyle by mutableStateOf("large")
        private set
    /** `card`, `compact` or `off`. */
    var linkStyle by mutableStateOf("card")
        private set

    fun copyAs(v: String) { copyStyle = v; save("copyStyle", v) }
    fun photosAs(v: String) { photoStyle = v; save("photoStyle", v) }
    fun linksAs(v: String) { linkStyle = v; save("linkStyle", v) }
}
