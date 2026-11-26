package dev.notesapp.core

import java.util.Locale
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The web app's own test cases for the rail beside a long page (`rail.test.ts`), run against the Kotlin port. */
class RailTest {
    private val us = Locale.US
    private val name = { key: String -> if (key.isEmpty()) "None" else "#$key" }
    private fun labels(keys: List<String>, height: Double = 1000.0) = Rail.marks(keys, height, name, us).filter { it.label != null }

    @Test fun scale() {
        assertEquals(Rail.Scale.Year, Rail.scale(listOf("2024-03-01", "2026-11-19")))
        assertEquals(Rail.Scale.Month, Rail.scale(listOf("2026-10-30", "", "2026-11-19")))
        assertEquals(Rail.Scale.Day, Rail.scale(listOf("2026-11-18", "2026-11-19")))
        assertEquals(Rail.Scale.Name, Rail.scale(listOf("2026-11-19", "tag-1")))
    }

    @Test fun yearsWithDotsForMonths() {
        val keys = listOf("2024-12-30", "2025-01-02", "2025-01-03", "2025-03-01", "2026-11-19")
        assertEquals(listOf(Rail.Mark(0.0, "2024"), Rail.Mark(0.2, "2025"), Rail.Mark(0.8, "2026")), labels(keys))
        assertEquals(listOf(0.6), Rail.marks(keys, 1000.0, name).filter { it.label == null }.map { it.at })
        assertEquals(listOf("2026", "2025", "2024"), labels(keys.reversed()).map { it.label })
    }

    @Test fun monthsAndStretchesWithNoDay() {
        assertEquals(listOf(Rail.Mark(0.0, "Oct"), Rail.Mark(0.25, "Nov"), Rail.Mark(0.5, "None")), labels(listOf("2026-10-30", "2026-11-01", "", "")))
        assertEquals(listOf("Oct", "None", "Nov"), labels(listOf("2026-10-30", "", "2026-10-31", "2026-11-02")).map { it.label })
    }

    @Test fun crowdedLabelsLeftOut() {
        val keys = listOf("2020-01-01", "2021-01-01") + List(8) { "2025-06-01" } + List(90) { "2026-01-01" }
        assertEquals(listOf("2020", "2026"), labels(keys).map { it.label })
        assertEquals(listOf("2020", "2021", "2025", "2026"), labels(keys, 5000.0).map { it.label })
        assertEquals(emptyList(), Rail.marks(emptyList(), 1000.0, name))
    }

    @Test fun dotsKeepOffLabels() {
        // As the web's: a hundred items on a 1000-pixel rail; months begin at 10, 50, 490, 510 and 520, years at 0 and 500.
        val at = mapOf(0 to "2025-01-01", 1 to "2025-02-01", 5 to "2025-03-01", 49 to "2025-12-01", 50 to "2026-01-01", 51 to "2026-02-01", 52 to "2026-03-01")
        var last = ""
        val keys = List(100) { i -> (at[i] ?: last).also { last = it } }
        assertEquals(listOf(50L, 490L, 520L), Rail.marks(keys, 1000.0, name).filter { it.label == null }.map { Math.round(it.at * 1000) })
    }

    @Test fun label() {
        assertEquals("Mar 2025", Rail.label("2025-03-04", Rail.Scale.Year, name, us))
        assertEquals("#2025-03-04", Rail.label("2025-03-04", Rail.Scale.Month, name))
        assertEquals("None", Rail.label("", Rail.Scale.Year, name))
    }

    @Test fun item() {
        assertEquals(0 to 0.0, Rail.item(0.0, 4))
        val (index, into) = Rail.item(0.6, 4)
        assertEquals(2, index)
        assertTrue(abs(into - 0.4) < 1e-9)
        assertEquals(3 to 1.0, Rail.item(1.0, 4))
        assertEquals(0, Rail.item(-1.0, 4).first)
    }

    @Test fun readingLineAndBack() {
        assertEquals(60.0, Rail.readingLine(0.0, 1000.0, 60.0, 500.0))
        assertEquals(560.0, Rail.readingLine(1000.0, 1000.0, 60.0, 500.0))
        assertEquals(310.0, Rail.readingLine(500.0, 1000.0, 60.0, 500.0))
        assertEquals(60.0, Rail.readingLine(0.0, 0.0, 60.0, 500.0))
        val s = Rail.scrollFor(2000.0, 3000.0, 60.0, 500.0)
        assertTrue(abs(s + Rail.readingLine(s, 3000.0, 60.0, 500.0) - 2000) < 1e-9)
        assertEquals(0.0, Rail.scrollFor(10.0, 3000.0, 60.0, 500.0))
        assertEquals(3000.0, Rail.scrollFor(99_999.0, 3000.0, 60.0, 500.0))
    }

    @Test fun rowsOfItemsSideBySide() {
        assertEquals(listOf(0.25 / 3, 1.25 / 3, 2.25 / 3), listOf(4, 5, 6).map { Rail.intoRow(it, 0.25, 4, 3) })
        assertEquals(1.0, Rail.intoRow(6, 1.0, 4, 3))
        assertEquals(0.5, Rail.intoRow(9, 0.5, 9, 1))
        for ((index, into) in listOf(4 to 0.25, 5 to 0.9, 6 to 0.0)) {
            assertTrue(abs(Rail.rowRailAt(4, 3, Rail.intoRow(index, into, 4, 3), 20) - (index + into) / 20) < 1e-9)
        }
        assertTrue(abs(Rail.rowRailAt(4, 3, 2.0, 20) - 7.0 / 20) < 1e-9)
    }
}
