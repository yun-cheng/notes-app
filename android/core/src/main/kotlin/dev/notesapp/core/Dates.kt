package dev.notesapp.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlinx.serialization.json.JsonNull

/** Local calendar days as `YYYY-MM-DD` keys, never UTC instants, as the web app's `dates.ts`. */
object DateKey {
    fun parse(key: String?): LocalDate? = key?.takeIf { Regex("""\d{4}-\d{2}-\d{2}""").matches(it) }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    fun isKey(s: String?) = parse(s) != null
    fun of(date: LocalDate): String = date.toString()
    fun of(instant: Instant, zone: ZoneId = ZoneId.systemDefault()): String = instant.atZone(zone).toLocalDate().toString()
    fun ofMillis(ms: Long, zone: ZoneId = ZoneId.systemDefault()) = of(Instant.ofEpochMilli(ms), zone)
    fun today(zone: ZoneId = ZoneId.systemDefault()): String = LocalDate.now(zone).toString()
    fun adding(days: Int, key: String): String = parse(key)?.plusDays(days.toLong())?.toString() ?: key
    fun daysBetween(from: String, to: String): Int {
        val a = parse(from) ?: return 0
        val b = parse(to) ?: return 0
        return ChronoUnit.DAYS.between(a, b).toInt()
    }
    fun monthKey(key: String) = key.take(7)
    fun addMonths(month: String, delta: Int): String = parse("$month-01")?.plusMonths(delta.toLong())?.toString()?.take(7) ?: month
    /** Whole months later, the same day of the month or the month's last day when it's shorter. */
    fun addMonthsClamped(key: String, months: Int): String = parse(key)?.plusMonths(months.toLong())?.toString() ?: key
    /** Six rows of seven days covering the month, starting on `weekStart`. */
    fun monthGrid(month: String, weekStart: DayOfWeek): List<String> {
        val first = parse("$month-01") ?: return emptyList()
        val offset = (first.dayOfWeek.value - weekStart.value + 7) % 7
        val start = first.minusDays(offset.toLong())
        return (0 until 42).map { start.plusDays(it.toLong()).toString() }
    }
    fun weekday(key: String): DayOfWeek = parse(key)?.dayOfWeek ?: DayOfWeek.MONDAY

    /** "Today", "Tomorrow", "Yesterday", or a short date, with the year when it isn't this one. */
    fun relativeDay(key: String, today: String, locale: Locale = Locale.getDefault()): String {
        if (key == today) return "Today"
        if (key == adding(1, today)) return "Tomorrow"
        if (key == adding(-1, today)) return "Yesterday"
        val d = parse(key) ?: return key
        val pattern = if (key.take(4) != today.take(4)) "EEE, MMM d, yyyy" else "EEE, MMM d"
        return d.format(DateTimeFormatter.ofPattern(pattern, locale))
    }

    fun relativeDayInSentence(key: String, today: String): String {
        val day = relativeDay(key, today)
        return if (day in setOf("Today", "Tomorrow", "Yesterday")) day.lowercase() else day
    }

    fun formatDay(key: String, locale: Locale = Locale.getDefault()): String =
        parse(key)?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)) ?: key

    fun formatMonth(month: String, locale: Locale = Locale.getDefault()): String =
        parse("$month-01")?.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale)) ?: month
}

/** Times of day as stored: `HH:MM`, 24-hour, local. */
object TimeKey {
    fun isKey(s: String?) = s != null && Regex("""([01]\d|2[0-3]):[0-5]\d""").matches(s)

    /** `15:00`, `9:30`, `3pm`, `3:30pm`, `9am` or `9a` as a time key. A bare number isn't a time. */
    fun parse(word: String): String? {
        val m = Regex("""(?i)(\d{1,2})(?::(\d{2}))?([ap]m?)?""").matchEntire(word) ?: return null
        val (h, min, suffix) = m.destructured
        if (min.isEmpty() && suffix.isEmpty()) return null
        var hour = h.toInt()
        val minute = if (min.isEmpty()) 0 else min.toInt()
        if (minute > 59) return null
        if (suffix.isNotEmpty()) {
            if (hour !in 1..12) return null
            hour = hour % 12 + if (suffix.lowercase().startsWith("p")) 12 else 0
        } else if (hour > 23) return null
        return "%02d:%02d".format(hour, minute)
    }

    fun of(t: LocalTime = LocalTime.now()) = "%02d:%02d".format(t.hour, t.minute)

    fun format(key: String, locale: Locale = Locale.getDefault()): String {
        val parts = key.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2) return key
        return LocalTime.of(parts[0], parts[1]).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
    }
}

/** Repeating todos: ticking one moves its due date to the next time, as the web app's `repeat.ts`. */
val Repeat.isValid get() = every in 1..999 && (unit != Repeat.Unit.weekday || every == 1)

private fun isWeekend(key: String) = DateKey.weekday(key).let { it == DayOfWeek.SATURDAY || it == DayOfWeek.SUNDAY }

private fun Repeat.step(from: String, times: Int): String = when (unit) {
    Repeat.Unit.day -> DateKey.adding(every * times, from)
    Repeat.Unit.week -> DateKey.adding(7 * every * times, from)
    Repeat.Unit.month -> DateKey.addMonthsClamped(from, every * times)
    Repeat.Unit.year -> DateKey.addMonthsClamped(from, 12 * every * times)
    Repeat.Unit.weekday -> {
        var day = from
        repeat(times) { do { day = DateKey.adding(1, day) } while (isWeekend(day)) }
        day
    }
}

/** The first due date for a new repeating todo with no date of its own: today, or for weekdays the next weekday. */
fun Repeat.firstDue(today: String) = if (unit == Repeat.Unit.weekday && isWeekend(today)) step(today, 1) else today

/** The due date after `due`; one that fell behind skips to the first time after today, keeping its rhythm. */
fun Repeat.nextDue(due: String?, today: String): String {
    val from = due ?: today
    if (unit == Repeat.Unit.weekday) return step(if (from > today) from else today, 1)
    var times = 1
    var next = step(from, 1)
    while (next <= today) next = step(from, ++times)
    return next
}

private val repeatNames = mapOf(Repeat.Unit.day to ("Daily" to "days"), Repeat.Unit.week to ("Weekly" to "weeks"), Repeat.Unit.month to ("Monthly" to "months"), Repeat.Unit.year to ("Yearly" to "years"))

/** "Weekly", "Every 2 weeks", "Every weekday". */
val Repeat.label: String
    get() {
        if (unit == Repeat.Unit.weekday) return "Every weekday"
        val (single, plural) = repeatNames.getValue(unit)
        return if (every == 1) single else "Every $every $plural"
    }

/** The word `parseRepeat` reads back: `weekly`, `every-2-weeks`, `weekdays`. */
val Repeat.word: String
    get() {
        if (unit == Repeat.Unit.weekday) return "weekdays"
        return if (every == 1) repeatNames.getValue(unit).first.lowercase() else "every-$every-${unit.name}s"
    }

fun parseRepeat(word: String): Repeat? {
    val w = word.lowercase()
    val words = mapOf("daily" to Repeat.Unit.day, "weekly" to Repeat.Unit.week, "monthly" to Repeat.Unit.month, "yearly" to Repeat.Unit.year, "annually" to Repeat.Unit.year, "weekdays" to Repeat.Unit.weekday)
    words[w]?.let { return Repeat(it, 1) }
    val m = Regex("""every-(?:(\d{1,3})-)?(day|week|month|year|weekday)s?""").matchEntire(w) ?: return null
    val every = m.groupValues[1].takeIf { it.isNotEmpty() }?.toInt() ?: 1
    if (every < 1) return null
    return Repeat(Repeat.Unit.valueOf(m.groupValues[2]), every).takeIf { it.isValid }
}

val repeatChoices = listOf(Repeat(Repeat.Unit.day, 1), Repeat(Repeat.Unit.weekday, 1), Repeat(Repeat.Unit.week, 1), Repeat(Repeat.Unit.week, 2), Repeat(Repeat.Unit.month, 1), Repeat(Repeat.Unit.year, 1))

/** Open and past its due date, or due today at a time already gone. A waiting todo never is. */
fun Card.isOverdue(today: String, now: String = TimeKey.of()): Boolean {
    if (type != CardType.todo || isDone || waiting) return false
    val d = due ?: return false
    return d < today || (d == today && dueTime?.let { it <= now } == true)
}

/** Ticks an open todo: a repeating one moves on to its next due date, its start as far; either way not waiting. */
fun Card.complete(today: String, at: Long): Card {
    var c = withWaiting(false)
    val rule = repeat ?: return c.with("status", j("done")).with("completedAt", j(at))
    val next = rule.nextDue(due, today)
    val s = start
    val d = due
    if (s != null && d != null) c = c.withStart(DateKey.adding(DateKey.daysBetween(d, next), s))
    return c.withDue(next)
}

fun Card.reopen() = with("status", j("open")).with("completedAt", JsonNull)
