package dev.notesapp.core

import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The web app's own test cases for the journal box, run against the Kotlin port. */
class EntryTest {
    private val today = "2026-11-12" // a Thursday
    private fun t(text: String, marks: List<JsonElement>? = null) = jobj("type" to j("text"), "text" to j(text), "marks" to marks?.let(::jarr))
    private fun para(vararg c: JsonElement) = if (c.isEmpty()) jobj("type" to j("paragraph")) else jobj("type" to j("paragraph"), "content" to jarr(c.toList()))
    private fun item(checked: Boolean, vararg c: JsonElement) = jobj("type" to j("taskItem"), "attrs" to jobj("checked" to j(checked)), "content" to jarr(c.toList()))
    private fun tasks(vararg items: JsonElement) = jobj("type" to j("taskList"), "content" to jarr(items.toList()))
    private fun doc(vararg c: JsonElement) = jobj("type" to j("doc"), "content" to jarr(c.toList()))
    private fun parse(s: String) = EntryParser.parseEntry(s, today)

    @Test fun plainTextIsANote() {
        val e = parse("Call the bank\nabout the card")!!
        assertEquals(Entry.Kind.note, e.kind)
        assertEquals(Doc.fromText("Call the bank\nabout the card"), e.content)
        assertNull(parse("  \n "))
        assertNull(parse("#work #home"))
        assertNull(parse("[] "))
    }

    @Test fun tags() {
        val e = parse("Idea for the #Work offsite\n#ideas #work")!!
        assertEquals(listOf("Work", "ideas"), e.tags)
        assertEquals(Doc.fromText("Idea for the offsite"), e.content)
        assertEquals(listOf("家裡"), parse("買菜 #家裡")!!.tags)
        assertEquals(emptyList(), parse("issue#12 and C#")!!.tags)
    }

    @Test fun todoMarkers() {
        for (text in listOf("[] Buy milk", "[ ] Buy milk", "[]Buy milk", "TODO Buy milk", "Buy milk #todo")) {
            val e = parse(text)!!
            assertEquals(Entry.Kind.todo, e.kind, text)
            assertEquals("Buy milk", e.title, text)
        }
        assertEquals(Entry.Kind.note, parse("todo list for the week")!!.kind)
        assertTrue(parse("[x] Bought milk")!!.done)
        assertEquals(Doc.fromText("passport\ncharger"), parse("[] Pack for the trip\npassport\ncharger")!!.content)
        assertEquals(Doc.empty, parse("[] Pack")!!.content)
    }

    @Test fun dueDatesAndDiary() {
        val rent = parse("[] Pay rent @tomorrow #home")!!
        assertEquals("Pay rent", rent.title)
        assertEquals("2026-11-13", rent.due)
        assertEquals(listOf("home"), rent.tags)
        assertEquals("Email @someone", parse("[] Email @someone")!!.title)
        assertEquals(Doc.fromText("Lunch @friday was fun"), parse("Lunch @friday was fun")!!.content)
        val walk = parse("Long walk by the river. #diary")!!
        assertTrue(walk.diary)
        assertEquals(Doc.fromText("Long walk by the river."), walk.content)
    }

    @Test fun severalEntries() {
        fun titles(text: String, all: Boolean = false) = EntryParser.parseEntries(text, today, all).map { e ->
            "${e.kind}:${e.title.ifEmpty { e.content["content"][0]["content"][0]["text"].str ?: "" }}"
        }
        assertEquals(listOf("todo:milk", "todo:eggs", "todo:call mom"), titles("[] milk\n[] eggs @tomorrow\nTODO call mom"))
        assertEquals(listOf("note:Shopping for the party", "todo:cake", "todo:candles"), titles("Shopping for the party\n[] cake\n[] candles"))
        assertEquals(listOf(listOf("dairy", "groceries", "home"), listOf("groceries", "home")), EntryParser.parseEntries("[] milk #dairy\n[] bread\n\n#groceries #home", today).map { it.tags })
        assertEquals(listOf("todo:milk", "todo:eggs", "todo:bread"), titles("milk\n\neggs\n[] bread", true))
    }

    @Test fun fromTheBox() {
        val entries = EntryParser.entries(doc(para(t("Party prep")), para(t("at Sam’s")), tasks(item(false, para(t("cake @fri"))), item(true, para(t("balloons")))), para(t("#home"))), today)
        assertEquals(3, entries.size)
        assertEquals(doc(para(t("Party prep")), para(t("at Sam’s"))), entries[0].content)
        assertEquals(listOf("home"), entries[0].tags)
        assertEquals("cake", entries[1].title)
        assertEquals("2026-11-13", entries[1].due)
        assertTrue(entries[2].done)
        val code = jobj("type" to j("codeBlock"), "content" to jarr(listOf(t("#include <stdio.h>\n@media print {}"))))
        val inline = listOf(jobj("type" to j("code")))
        val coded = EntryParser.entries(doc(para(t("Snippet #c")), code, tasks(item(false, para(t("run "), t("@daily", inline), t(" #ops @fri"))))), today)
        assertEquals(doc(para(t("Snippet")), code), coded[0].content)
        assertEquals("run @daily", coded[1].title)
        assertEquals("2026-11-13", coded[1].due)
        val nested = item(false, para(t("Trip")), para(t("passport")), tasks(item(false, para(t("book hotel")))))
        assertEquals(listOf("Trip", "book hotel"), EntryParser.entries(doc(tasks(nested)), today).map { it.title })
    }

    @Test fun dueWords() {
        assertEquals("2026-11-13", EntryParser.parseDue("fri", today))
        assertEquals("2026-11-16", EntryParser.parseDue("monday", today))
        assertEquals("2026-11-19", EntryParser.parseDue("thu", today))
        assertNull(EntryParser.parseDue("2026-02-30", today))
        assertNull(EntryParser.parseDue("fr", today))
        val rent = parse("[] Pay rent @monthly @2026-12-01 @9am")!!
        assertEquals("2026-12-01", rent.due)
        assertEquals("09:00", rent.dueTime)
        assertEquals(Repeat(Repeat.Unit.month, 1), rent.repeat)
        assertEquals("15:30", parse("[] Call the dentist @3:30pm")!!.dueTime)
        assertEquals("Ask @bob about 3pm", parse("[] Ask @bob about 3pm")!!.title)
    }
}

class RepeatTest {
    private val today = "2026-11-12"
    private val weekly = Repeat(Repeat.Unit.week, 1)
    private val monthly = Repeat(Repeat.Unit.month, 1)
    private val weekdays = Repeat(Repeat.Unit.weekday, 1)

    @Test fun nextDue() {
        assertEquals("2026-11-13", Repeat(Repeat.Unit.day, 1).nextDue(today, today))
        assertEquals("2026-11-26", Repeat(Repeat.Unit.week, 2).nextDue(today, today))
        assertEquals("2026-11-16", weekly.nextDue("2026-11-09", today))
        assertEquals("2026-11-30", monthly.nextDue("2026-08-30", today))
        assertEquals("2026-02-28", monthly.nextDue("2026-01-31", "2026-01-31"))
        assertEquals("2026-03-31", monthly.nextDue("2026-01-31", "2026-03-05"))
        assertEquals("2029-02-28", Repeat(Repeat.Unit.year, 1).nextDue("2028-02-29", "2028-02-29"))
        assertEquals("2026-11-16", weekdays.nextDue("2026-11-13", "2026-11-13"))
        assertEquals("2026-11-16", weekdays.firstDue("2026-11-14"))
        assertEquals("2026-11-19", weekly.nextDue(null, today))
    }

    @Test fun words() {
        assertEquals(weekly, parseRepeat("Weekly"))
        assertEquals(Repeat(Repeat.Unit.month, 3), parseRepeat("every-3-months"))
        for (w in listOf("every-0-days", "every-2-weekdays", "fortnightly", "every", "every-2")) assertNull(parseRepeat(w), w)
        for (r in repeatChoices + Repeat(Repeat.Unit.day, 3)) assertEquals(r, parseRepeat(r.word))
        assertEquals(listOf("Daily", "Every weekday", "Weekly", "Every 2 weeks", "Monthly", "Yearly"), repeatChoices.map { it.label })
    }
}
