package dev.notesapp.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * Syncs now and then with the app closed, while reminders are on, so a todo given a time on another device still
 * reminds here; the web gets this from the server's pushes. Each sync sets this device's reminders again.
 */
class BackgroundSync(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!Reminders.on(applicationContext)) return Result.success()
        val model = (applicationContext as NotesApplication).model
        // The account opens as the process starts: wait for it, a little.
        val sync = withTimeoutOrNull(30_000) {
            while (model.sync == null) delay(250)
            model.sync
        } ?: return Result.success()
        runCatching { sync.sync(); model.refresh() }
        return Result.success()
    }

    companion object {
        private const val NAME = "background-sync"

        /** Asks Android to run it about every half hour with a network, or stops it when reminders are off. */
        fun plan(c: Context) {
            val work = WorkManager.getInstance(c)
            if (!Reminders.on(c)) return run { work.cancelUniqueWork(NAME) }
            val request = PeriodicWorkRequestBuilder<BackgroundSync>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            work.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
