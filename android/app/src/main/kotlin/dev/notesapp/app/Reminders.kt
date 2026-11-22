package dev.notesapp.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.notesapp.core.Card
import dev.notesapp.core.CardIndex
import dev.notesapp.core.CardType
import dev.notesapp.core.DateKey
import dev.notesapp.core.TimeKey
import java.time.LocalTime
import java.time.ZoneId

/**
 * Due-date reminders on this device, as the web app's: an open todo with a due date (not waiting, archived or a
 * template) reminds at its time less the lead, or for a date alone at the time picked. The device schedules them
 * itself, which works offline and for encrypted vaults alike.
 */
object Reminders {
    private const val MOST = 60
    private const val CHANNEL = "due"
    private var scheduled = ""
    private var ids = listOf<String>()

    private fun prefs(c: Context) = c.getSharedPreferences("reminders", Context.MODE_PRIVATE)
    fun on(c: Context) = prefs(c).getBoolean("on", false)
    fun at(c: Context) = prefs(c).getString("at", "09:00")!!
    fun lead(c: Context) = prefs(c).getInt("lead", 0)
    fun set(c: Context, on: Boolean? = null, at: String? = null, lead: Int? = null) {
        prefs(c).edit().apply { on?.let { putBoolean("on", it) }; at?.let { putString("at", it) }; lead?.let { putInt("lead", it) } }.apply()
        scheduled = "-"
    }

    /** When a todo reminds, in milliseconds, or null. */
    fun fireAt(c: Context, card: Card): Long? {
        if (card.type != CardType.todo || card.isDone || card.waiting || card.archived || card.template) return null
        val day = DateKey.parse(card.due) ?: return null
        val time = card.dueTime ?: at(c)
        val parts = time.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2) return null
        var ms = day.atTime(LocalTime.of(parts[0], parts[1])).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        if (card.dueTime != null) ms -= lead(c) * 60_000L
        return ms
    }

    private fun pending(c: Context, id: String, card: Card? = null): PendingIntent {
        val intent = Intent(c, ReminderReceiver::class.java).setAction("due:$id").putExtra("cardId", id)
        if (card != null) {
            intent.putExtra("title", card.title.trim().ifEmpty { "Todo" })
            intent.putExtra("body", card.dueTime?.let { "Due at ${TimeKey.format(it)}" } ?: "Due today")
        }
        return PendingIntent.getBroadcast(c, id.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** Schedules the soonest reminders again from the todos as they are now, when they changed. */
    fun reschedule(c: Context, index: CardIndex) {
        val now = System.currentTimeMillis()
        val soon = if (on(c)) index.todos.mapNotNull { card -> fireAt(c, card)?.let { card to it } }.filter { it.second > now }.sortedBy { it.second }.take(MOST) else emptyList()
        val signature = soon.joinToString(",") { "${it.first.id}|${it.first.title}|${it.second}" }
        if (signature == scheduled) return
        scheduled = signature
        val alarms = c.getSystemService(AlarmManager::class.java)
        for (id in ids) alarms.cancel(pending(c, id))
        for ((card, at) in soon) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(c, card.id, card))
        ids = soon.map { it.first.id }
    }

    fun channel(c: Context) {
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Due todos", NotificationManager.IMPORTANCE_DEFAULT))
    }

    /** Nothing to do itself: the app's start, which a broadcast brings, reschedules the reminders. */
    class BootReceiver : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {}
    }

    class ReminderReceiver : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val id = intent.getStringExtra("cardId") ?: return
            channel(c)
            val open = PendingIntent.getActivity(
                c, id.hashCode(), Intent(c, MainActivity::class.java).putExtra("cardId", id).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = android.app.Notification.Builder(c, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(intent.getStringExtra("title") ?: "Todo")
                .setContentText(intent.getStringExtra("body"))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            runCatching { c.getSystemService(NotificationManager::class.java).notify(id.hashCode(), n) }
        }
    }
}
