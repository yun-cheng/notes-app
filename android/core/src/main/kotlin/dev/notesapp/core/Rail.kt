package dev.notesapp.core

import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The rail beside a long page of entries, as a photo library has, as the web's `rail.ts`: marks for the years (or
 * months, or groups) down its length, a thumb at where the page is, and a label for the place pointed at or dragged
 * to. Each item has a key, the day it's under (or what else groups it, a tag), and a share of the rail, in the order
 * the page shows them, top to bottom: an equal share, or, spaced by nearness (`spacing`), a share of its year's, which
 * is larger the nearer the year is to the one being read.
 */
object Rail {
    /** A mark on the rail, a fraction of the way down: a label, or a dot where there's no room or need for one. */
    data class Mark(val at: Double, val label: String?)

    /** How the items are told apart: by year, by month or by day, when they're all under days; else by what groups them. */
    enum class Scale { Year, Month, Day, Name }

    /** The labels' least room between them, and the dots', in pixels (or points). */
    private const val LABEL_GAP = 22.0
    private const val DOT_GAP = 9.0
    /** How far down from where it's placed a label reaches (it starts at its top), and the room a dot keeps from it, as the web's. */
    private const val LABEL_HEIGHT = 16.0
    private const val DOT_ROOM = 3.0

    fun scale(keys: List<String>): Scale {
        val years = mutableSetOf<String>()
        val months = mutableSetOf<String>()
        for (key in keys) {
            // A day, or none (a todo with no due date), sorted among days.
            if (key.isEmpty()) continue
            if (!DateKey.isKey(key)) return Scale.Name
            years.add(key.take(4))
            months.add(key.take(7))
        }
        return if (years.size > 1) Scale.Year else if (months.size > 1) Scale.Month else Scale.Day
    }

    private fun format(key: String, pattern: String, locale: Locale) = DateKey.parse(key)?.format(DateTimeFormatter.ofPattern(pattern, locale)) ?: key

    /** What the place an item is at is called, pointed at or dragged to: its month on a rail of years, else its own name. */
    fun label(key: String, scale: Scale, name: (String) -> String, locale: Locale = Locale.getDefault()): String =
        if (scale == Scale.Year && DateKey.isKey(key)) format(key, "MMM yyyy", locale) else name(key)

    /**
     * The marks for a rail `height` pixels tall: a label where each year starts (on a rail of years), each month (of
     * months) or each group, with a dot for each month among years and each day among a month's; `name` names a key
     * that isn't a day. Labels too near the one above are left out, then dots too near anything kept.
     */
    fun marks(keys: List<String>, height: Double, name: (String) -> String, locale: Locale = Locale.getDefault(), spacing: DoubleArray? = null): List<Mark> {
        val n = keys.size
        if (n == 0 || height <= 0) return emptyList()
        val scale = scale(keys)
        val labels = mutableListOf<Mark>()
        val dots = mutableListOf<Double>()
        var last: String? = null
        // The last day passed, past any stretch with none.
        var day: String? = null
        keys.forEachIndexed { i, key ->
            if (key == last) return@forEachIndexed
            last = key
            val at = railAt(i.toDouble(), n, spacing)
            if (scale == Scale.Name || !DateKey.isKey(key)) {
                labels.add(Mark(at, name(key)))
                return@forEachIndexed
            }
            val before = day
            day = key
            when (scale) {
                Scale.Year ->
                    if (before == null || before.take(4) != key.take(4)) labels.add(Mark(at, key.take(4)))
                    else if (before.take(7) != key.take(7)) dots.add(at)
                // A rail of months or days names the year where it starts ("Mar 2026"), as the web's.
                Scale.Month ->
                    if (before == null) labels.add(Mark(at, format(key, "MMM yyyy", locale)))
                    else if (before.take(7) != key.take(7)) labels.add(Mark(at, format(key, "MMM", locale))) else dots.add(at)
                else -> if (before == null) labels.add(Mark(at, format(key, "MMM yyyy", locale))) else dots.add(at)
            }
        }
        val kept = mutableListOf<Mark>()
        for (mark in labels) {
            val above = kept.lastOrNull()
            if (above == null || (mark.at - above.at) * height >= LABEL_GAP) kept.add(mark)
        }
        val labelled = kept.map { it.at * height }
        val taken = mutableListOf<Double>()
        val shown = kept.toMutableList()
        for (at in dots) {
            val y = at * height
            val clear = labelled.all { y < it - DOT_ROOM || y > it + LABEL_HEIGHT + DOT_ROOM }
            if (clear && taken.all { kotlin.math.abs(it - y) >= DOT_GAP }) {
                taken.add(y)
                shown.add(Mark(at, null))
            }
        }
        return shown.sortedBy { it.at }
    }

    /**
     * The rail spaced by nearness: where each item starts, from 0, and 1 after the last (`n + 1` in all). Each year with
     * items has a share by how many years it is from `year`, the one being read (1 for it, ½ the year either side, ⅓
     * the next, and so on), and its items share that evenly; an item with no day goes with the year above it. Null, an
     * equal share each, on a rail that isn't of years or with no year to go by. As the web's `railSpacing`.
     */
    fun spacing(keys: List<String>, year: Int?): DoubleArray? {
        val n = keys.size
        if (year == null || n < 2 || scale(keys) != Scale.Year) return null
        val years = arrayOfNulls<Int>(n)
        var last: Int? = null
        keys.forEachIndexed { i, key ->
            if (key.isNotEmpty()) last = key.take(4).toIntOrNull()
            years[i] = last
        }
        // Items with no day above any with one go with the first year after them.
        val first = years.firstOrNull { it != null } ?: year
        val resolved = IntArray(n) { years[it] ?: first }
        val counts = HashMap<Int, Int>()
        for (y in resolved) counts[y] = (counts[y] ?: 0) + 1
        val total = counts.keys.sumOf { 1.0 / (1 + kotlin.math.abs(it - year)) }
        val starts = DoubleArray(n + 1)
        for (i in 0 until n) {
            val y = resolved[i]
            starts[i + 1] = starts[i] + 1.0 / (1 + kotlin.math.abs(y - year)) / counts.getValue(y) / total
        }
        starts[n] = 1.0
        return starts
    }

    /** The year of the item at `index`, the year a rail spaced by nearness is spaced around; null when it has no day. */
    fun year(keys: List<String>, index: Int): Int? {
        for (i in minOf(index, keys.size - 1) downTo 0) if (DateKey.isKey(keys[i])) return keys[i].take(4).toIntOrNull()
        return keys.firstOrNull { DateKey.isKey(it) }?.take(4)?.toIntOrNull()
    }

    /** The place on the rail of a place among the items: `x` items down, part way into one when it isn't whole. */
    fun railAt(x: Double, n: Int, spacing: DoubleArray? = null): Double {
        if (n <= 0) return 0.0
        val at = x.coerceIn(0.0, n.toDouble())
        if (spacing == null) return at / n
        val index = minOf(n - 1, kotlin.math.floor(at).toInt())
        return spacing[index] + (at - index) * (spacing[index + 1] - spacing[index])
    }

    /** The item a place on the rail (0 at the top, 1 at the foot) falls in, and how far into it. */
    fun item(at: Double, n: Int, spacing: DoubleArray? = null): Pair<Int, Double> {
        if (spacing != null && n > 0) {
            val to = at.coerceIn(0.0, 1.0)
            // The last item starting at or above it.
            var lo = 0
            var hi = n - 1
            while (lo < hi) {
                val mid = (lo + hi + 1) / 2
                if (spacing[mid] <= to) lo = mid else hi = mid - 1
            }
            val size = spacing[lo + 1] - spacing[lo]
            return lo to (if (size > 0) ((to - spacing[lo]) / size).coerceIn(0.0, 1.0) else 0.0)
        }
        val exact = at.coerceIn(0.0, 1.0) * n
        val index = minOf(n - 1, kotlin.math.floor(exact).toInt())
        return index to minOf(1.0, exact - index)
    }

    /**
     * Items side by side (photos in a row) share one stretch of the page, from the row's top to the next row's: `first`
     * is the row's first item and `count` how many it holds. How far down that stretch the place `into` the item at
     * `index` is, so a slow drag goes smoothly down a row and the gap and heading under it, never back to its top.
     */
    fun intoRow(index: Int, into: Double, first: Int, count: Int): Double =
        if (count > 0) ((index - first + into) / count).coerceIn(0.0, 1.0) else 0.0

    /** `intoRow`, turned round: the place on a rail of `n` items that's `down` the stretch of a row. */
    fun rowRailAt(first: Int, count: Int, down: Double, n: Int, spacing: DoubleArray? = null): Double =
        if (n > 0) minOf(1.0, railAt(first + down.coerceIn(0.0, 1.0) * count, n, spacing)) else 0.0

    /**
     * Where the page is, as the rail tells it: the line it reads at runs from the top of what's in view, scrolled to
     * the top, to its foot, scrolled to the end, so the thumb is at either end exactly when the page is.
     */
    fun readingLine(scrolled: Double, scrollable: Double, top: Double, height: Double): Double =
        top + if (scrollable > 0) height * (scrolled / scrollable).coerceIn(0.0, 1.0) else 0.0

    /** How far to scroll so the reading line meets `y`, a place on the page (from its top): `readingLine`, turned round. */
    fun scrollFor(y: Double, scrollable: Double, top: Double, height: Double): Double =
        if (scrollable <= 0) 0.0 else ((y - top) / (1 + height / scrollable)).coerceIn(0.0, scrollable)
}
