package dev.notesapp.app

import android.app.Application
import android.content.Intent
import android.os.Bundle
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
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        model.newDay()
        model.scope.launchSync(model)
    }

    /** A reminder opens its todo; text shared from another app goes into the journal box; Google Drive's answer is said. */
    private fun handle(intent: Intent?) {
        intent ?: return
        intent.getStringExtra("cardId")?.let { model.openEntry = it }
        if (intent.action == Intent.ACTION_SEND) intent.getStringExtra(Intent.EXTRA_TEXT)?.let { model.sharedText = it }
        val data = intent.data
        if (data?.scheme == "notesapp" && data.host == "drive") {
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
