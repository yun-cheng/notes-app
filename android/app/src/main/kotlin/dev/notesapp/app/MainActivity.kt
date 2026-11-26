package dev.notesapp.app

import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.PowerManager
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.launch

val LocalModel = staticCompositionLocalOf<AppModel> { error("No model") }

class NotesApplication : Application() {
    lateinit var model: AppModel

    override fun onCreate() {
        super.onCreate()
        Drafts.init(this)
        Settings.init(this)
        Attachments.init(this)
        LinkPreviews.init(this)
        Reminders.channel(this)
        model = AppModel(this, BuildConfig.SERVER)
        model.syncPeriodically()
        BackgroundSync.plan(this)
    }
}

// A FragmentActivity, as the fingerprint sheet needs one; it's a ComponentActivity too.
class MainActivity : FragmentActivity() {
    private val model get() = (application as NotesApplication).model

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handle(intent)
        setContent {
            NotesTheme {
                CompositionLocalProvider(LocalModel provides model) { Root() }
            }
            // Tells Android when the journal first shows entries (the preview, or all of them), as its measure of a
            // launch: `adb logcat` says "Fully drawn" with the time since the app was opened.
            val drawn = model.preview != null || model.loaded
            androidx.compose.runtime.LaunchedEffect(drawn) { if (drawn) reportFullyDrawn() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    // Anything done in the app keeps its open vaults open for five more minutes, as the web's clicks and keys do.
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) model.touchVaults()
        return super.dispatchTouchEvent(ev)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) model.touchVaults()
        return super.dispatchKeyEvent(event)
    }

    /** Set while a screen the app opened itself is in front: a picker, the share sheet, a browser tab. */
    private var ownScreen = false

    override fun startActivity(intent: Intent, options: Bundle?) {
        ownScreen = true
        super.startActivity(intent, options)
    }

    @Deprecated("Called by the activity result launchers, which open the pickers")
    override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
        ownScreen = true
        @Suppress("DEPRECATION") super.startActivityForResult(intent, requestCode, options)
    }

    // Leaving the app (Home, or switching to another) locks every private vault, as the web's do when the page is
    // hidden. Android gives the same hint when the app opens a picker or a browser tab on a tap, so those are told
    // apart: locking there would lock the vault an entry being written is in. The idle minutes still run meanwhile.
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (ownScreen) ownScreen = false else model.lockAll()
    }

    override fun onStop() {
        super.onStop()
        // The screen going off locks them too.
        if (!(getSystemService(POWER_SERVICE) as PowerManager).isInteractive) model.lockAll()
    }

    override fun onResume() {
        super.onResume()
        ownScreen = false
        model.newDay()
        model.scope.launchSync(model)
    }

    /** A reminder opens its todo; text shared from another app goes into the journal box; Google Drive's answer is said. */
    private fun handle(intent: Intent?) {
        intent ?: return
        intent.getStringExtra("cardId")?.let { model.openEntry = it }
        if (intent.action == Intent.ACTION_SEND) intent.getStringExtra(Intent.EXTRA_TEXT)?.let { model.sharedText = it }
        val data = intent.data
        if (data?.scheme == BuildConfig.APP_SCHEME && data.host == "drive") {
            model.say(driveResult(data.getQueryParameter("result")))
            model.driveReturned++
            intent.data = null
        }
    }
}

private fun kotlinx.coroutines.CoroutineScope.launchSync(model: AppModel) = launch {
    model.refresh()
    model.sync?.sync()
    Drafts.sync()
}
