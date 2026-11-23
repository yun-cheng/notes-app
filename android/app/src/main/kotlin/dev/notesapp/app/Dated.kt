package dev.notesapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Card
import dev.notesapp.core.DateKey
import dev.notesapp.core.EntryParser
import dev.notesapp.core.SaveOptions
import dev.notesapp.core.SaveResult
import dev.notesapp.core.Stream
import dev.notesapp.core.StreamFilter
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToInt

/** A todo on the calendar and the timeline, from its start to its due date, as the web's `Span`. */
data class Span(val card: Card, val from: String, val to: String) {
    /** The days it covers within a run of days: the index of its first, and how many. */
    fun place(days: List<String>): Pair<Int, Int>? {
        val first = days.first()
        val last = days.last()
        if (to < first || from > last) return null
        val a = maxOf(from, first)
        val b = minOf(to, last)
        return DateKey.daysBetween(first, a) to DateKey.daysBetween(a, b) + 1
    }

    companion object {
        /** The todos' spans, the earliest first, a longer one before a shorter from the same day, then by time and title. */
        fun of(todos: List<Card>): List<Span> = todos.mapNotNull { c -> c.span?.let { Span(c, it.first, it.second) } }
            .sortedWith(compareBy<Span> { it.from }.thenByDescending { it.to }.thenBy { it.card.dueTime ?: "99" }.thenBy { it.card.title }.thenBy { it.card.id })

        /** The spans in a run of days in rows, each holding spans that don't overlap, so a span keeps one row. */
        fun lanes(days: List<String>, all: List<Span>): List<List<Span>> {
            val rows = mutableListOf<MutableList<Span>>()
            for (s in all) {
                if (s.to < days.first() || s.from > days.last()) continue
                rows.firstOrNull { it.last().to < s.from }?.add(s) ?: rows.add(mutableListOf(s))
            }
            return rows
        }
    }
}

/** A span's tint, as the web's chips and bars: the todo's color, waiting grey, the accent otherwise. */
@Composable
fun spanFill(card: Card): Color = when {
    card.waiting && !card.isDone -> Theme.sunken
    card.color != null -> Theme.tint(card.color!!).copy(alpha = 0.35f)
    else -> Theme.accentSoft
}

/** Paging through months or weeks, with Today, as the web's row under the title bar on a phone, naming what's shown. */
@Composable
fun DateNav(label: String, earlier: String, later: String, onEarlier: () -> Unit, onLater: () -> Unit, onToday: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onEarlier) { Icon(Icons.Outlined.ChevronLeft, earlier, tint = Theme.text) }
        Text(label, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Theme.text, textAlign = TextAlign.Center)
        IconButton(onClick = onLater) { Icon(Icons.Outlined.ChevronRight, later, tint = Theme.text) }
        OutlinedButton(onClick = onToday) { Text("Today") }
    }
}

/**
 * The month as a calendar with the todos on it, as the web app's: each from its start to its due date in rows that keep
 * a span on one line through its week, named on its first day and at the start of each week. A day is picked by
 * pressing it: its todos, and a box to add one due that day, show under the month. On a phone, where a day is too narrow
 * for names, a day shows how many it has.
 */
@Composable
fun CalendarPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var month by remember { mutableStateOf(DateKey.monthKey(DateKey.today())) }
    var picked by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf(StreamFilter(type = StreamFilter.EntryType.todo)) }
    val narrow = openDrawer != null
    val all = Span.of(model.datedTodos(filter))
    val grid = DateKey.monthGrid(month, weekStart)
    val weeks = (0 until 6).map { grid.subList(it * 7, it * 7 + 7) }
    val day = picked ?: if (DateKey.monthKey(model.today) == month) model.today else "$month-01"
    val diaryDays = remember(model.index) { model.index.live.filter { it.isEntry && it.vaultId == model.diaryVault?.id }.map(Stream::entryDay).toSet() }
    fun go(by: Int) { month = DateKey.addMonths(month, by); picked = null }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar(if (narrow) "Calendar" else DateKey.formatMonth(month), openDrawer) {
            if (!narrow) {
                OutlinedButton(onClick = { month = DateKey.monthKey(model.today); picked = model.today }) { Text("Today") }
                IconButton(onClick = { go(-1) }) { Icon(Icons.Outlined.ChevronLeft, "Previous month", tint = Theme.text) }
                IconButton(onClick = { go(1) }) { Icon(Icons.Outlined.ChevronRight, "Next month", tint = Theme.text) }
            }
        }
        DatedFilter(filter) { filter = it }
        if (narrow) DateNav(DateKey.formatMonth(month), "Previous month", "Next month", { go(-1) }, { go(1) }) { month = DateKey.monthKey(model.today); picked = model.today }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row {
                for (i in 0 until 7) Text(weekStart.plus(i.toLong()).getDisplayName(TextStyle.SHORT, Locale.getDefault()), Modifier.weight(1f), fontSize = 12.sp, color = Theme.muted, textAlign = TextAlign.Center)
            }
            for (week in weeks) MonthWeek(week, month, all, day, diaryDays, narrow) { d -> picked = d; if (DateKey.monthKey(d) != month) month = DateKey.monthKey(d) }
            DayAgenda(day, all, Modifier.padding(top = 18.dp, bottom = 24.dp))
        }
    }
}

private const val SHOWN_LANES = 3

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MonthWeek(week: List<String>, month: String, all: List<Span>, picked: String, diaryDays: Set<String>, narrow: Boolean, pick: (String) -> Unit) {
    val model = LocalModel.current
    val rows = Span.lanes(week, all)
    val shown = rows.take(SHOWN_LANES)
    val head = 28.dp
    val lane = 22.dp
    val height = if (narrow) 52.dp else maxOf(96.dp, head + lane * shown.size + (if (rows.size > shown.size) 18.dp else 0.dp) + 8.dp)
    BoxWithConstraints(Modifier.fillMaxWidth().height(height)) {
        val col = (maxWidth - 18.dp) / 7
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for (d in week) {
                val count = rows.count { l -> l.any { it.from <= d && d <= it.to } }
                val more = count - shown.count { l -> l.any { it.from <= d && d <= it.to } }
                val today = d == model.today
                var menu by remember { mutableStateOf(false) }
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    Column(
                        Modifier.fillMaxSize().clip(RoundedCornerShape(9.dp)).background(if (DateKey.monthKey(d) == month) Theme.surface else Theme.surface.copy(alpha = 0.45f))
                            .then(if (d == picked) Modifier.border(2.dp, Theme.accent, RoundedCornerShape(9.dp)) else Modifier)
                            .combinedClickable(onClick = { pick(d) }, onLongClick = { menu = true }).padding(top = 4.dp),
                        horizontalAlignment = if (narrow) Alignment.CenterHorizontally else Alignment.Start,
                    ) {
                        Row(Modifier.padding(horizontal = if (narrow) 0.dp else 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("${d.takeLast(2).toInt()}", Modifier.size(24.dp).clip(CircleShape).background(if (today) Theme.accent else Color.Transparent).padding(top = 3.dp), fontSize = 13.sp,
                                fontWeight = if (today) FontWeight.SemiBold else FontWeight.Normal, textAlign = TextAlign.Center,
                                color = if (today) Theme.onAccent else if (DateKey.monthKey(d) == month) Theme.text else Theme.muted)
                            if (d in diaryDays) Box(Modifier.size(5.dp).clip(CircleShape).background(Theme.accent))
                        }
                        if (narrow && count > 0) Text("$count", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.accent)
                        Spacer(Modifier.weight(1f))
                        if (!narrow && more > 0) Text("+$more more", Modifier.padding(start = 6.dp, bottom = 4.dp), fontSize = 11.sp, color = Theme.muted)
                    }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Written this day") }, onClick = { menu = false; model.page = Page.Journal(StreamFilter(`when` = d)) })
                        model.diaryVault?.let { v -> DropdownMenuItem(text = { Text("Diary for this day") }, onClick = { menu = false; model.page = Page.Journal(StreamFilter(`when` = d, vaultId = v.id)) }) }
                    }
                }
            }
        }
        if (!narrow) shown.forEachIndexed { n, laneSpans ->
            for (span in laneSpans) {
                val (at, length) = span.place(week) ?: continue
                val starts = span.from >= week.first()
                val ends = span.to <= week.last()
                val width = (col + 3.dp) * length - 3.dp - (if (starts) 4.dp else 0.dp) - (if (ends) 4.dp else 0.dp)
                val time = span.card.dueTime?.takeIf { maxOf(span.from, week.first()) == span.to }
                val shape = RoundedCornerShape(topStart = if (starts) 6.dp else 0.dp, bottomStart = if (starts) 6.dp else 0.dp, topEnd = if (ends) 6.dp else 0.dp, bottomEnd = if (ends) 6.dp else 0.dp)
                Row(
                    Modifier.offset(x = (col + 3.dp) * at + (if (starts) 4.dp else 0.dp), y = head + lane * n).width(maxOf(8.dp, width)).height(20.dp).clip(shape).background(spanFill(span.card))
                        .clickable { model.openEntry = span.card.id }.padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (time != null) Text(time, fontSize = 12.sp, color = Theme.muted)
                    Text(span.card.displayTitle, fontSize = 12.sp, color = if (span.card.isDone) Theme.muted else Theme.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** The picked day under the month: its todos, ticked or opened from here, and a box to add one due that day. */
@Composable
private fun DayAgenda(day: String, all: List<Span>, modifier: Modifier) {
    val model = LocalModel.current
    var text by remember { mutableStateOf("") }
    val items = all.filter { it.from <= day && day <= it.to }
    fun add() {
        val typed = text
        if (typed.isBlank()) return
        model.scope.launch {
            when (model.save(EntryParser.parseEntries(typed, model.today, allTodos = true), SaveOptions(due = day))) {
                is SaveResult.Saved -> if (text == typed) text = ""
                is SaveResult.Unlock -> model.say("Unlock the vault first.")
                else -> {}
            }
        }
    }
    Column(modifier) {
        Row(Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
            Text(DateKey.relativeDay(day, model.today), Modifier.weight(1f), fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Theme.text)
            Text("Written this day", Modifier.clickable { model.page = Page.Journal(StreamFilter(`when` = day)) }, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Theme.accent)
        }
        if (items.isEmpty()) Text("Nothing due or under way.", Modifier.padding(vertical = 4.dp), color = Theme.muted)
        for (s in items) {
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TodoCheck(s.card)
                Text(s.card.displayTitle, Modifier.weight(1f).clickable { model.openEntry = s.card.id }, color = if (s.card.isDone) Theme.muted else Theme.text)
                Text(if (s.from != s.to) "${DateKey.relativeDay(s.from, model.today)} – ${DateKey.relativeDay(s.to, model.today)}" else s.card.dueTime ?: "", fontSize = 13.sp, color = Theme.muted)
            }
            HorizontalDivider(color = Theme.line)
        }
        if (!model.viewOnly) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.Add, null, Modifier.size(16.dp), tint = Theme.muted)
            BasicTextField(
                text, { text = it }, Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 8.dp),
                singleLine = true, textStyle = androidx.compose.ui.text.TextStyle(color = Theme.text, fontSize = 16.sp), cursorBrush = SolidColor(Theme.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }),
                decorationBox = { inner -> if (text.isEmpty()) Text("Add a todo due ${DateKey.relativeDayInSentence(day, model.today)}", color = Theme.muted, fontSize = 16.sp); inner() },
            )
        }
    }
}

/**
 * Todos as bars on a run of weeks, as the web app's Timeline: one row each, its name in a column on the left, from its
 * start date to its due date, or a short bar on the day it has. A bar is dragged to move both dates, or by an end to
 * change one. The arrows move two weeks at a time.
 */
@Composable
fun TimelinePage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val narrow = openDrawer != null
    var from by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf(StreamFilter(type = StreamFilter.EntryType.todo)) }
    val start = from ?: DateKey.adding(-7, weekOf(model.today))
    val days = (0 until 56).map { DateKey.adding(it, start) }
    val rows = Span.of(model.datedTodos(filter)).mapNotNull { s -> s.place(days)?.let { Triple(s, it.first, it.second) } }
    val dayWidth = 34.dp
    val names = if (narrow) 110.dp else 180.dp
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Timeline", openDrawer) {
            if (!narrow) {
                OutlinedButton(onClick = { from = null }) { Text("Today") }
                IconButton(onClick = { from = DateKey.adding(-14, start) }) { Icon(Icons.Outlined.ChevronLeft, "Two weeks earlier", tint = Theme.text) }
                IconButton(onClick = { from = DateKey.adding(14, start) }) { Icon(Icons.Outlined.ChevronRight, "Two weeks later", tint = Theme.text) }
            }
        }
        DatedFilter(filter) { filter = it }
        if (narrow) DateNav("${DateKey.formatDay(days.first())} – ${DateKey.formatDay(days.last())}", "Two weeks earlier", "Two weeks later", { from = DateKey.adding(-14, start) }, { from = DateKey.adding(14, start) }) { from = null }
        if (rows.isEmpty()) {
            Text("No todos with dates in these weeks. Give a todo a due date, and a start date for one that takes days.", Modifier.fillMaxWidth().padding(24.dp), color = Theme.muted, textAlign = TextAlign.Center)
            return@Column
        }
        Row(Modifier.padding(16.dp).clip(RoundedCornerShape(12.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(12.dp)).verticalScroll(rememberScrollState())) {
            Column(Modifier.width(names)) {
                Spacer(Modifier.height(46.dp))
                for ((s, _, _) in rows) Text(
                    s.card.displayTitle, Modifier.fillMaxWidth().height(32.dp).clickable { model.openEntry = s.card.id }.padding(horizontal = 10.dp, vertical = 6.dp),
                    fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (s.card.isDone) Theme.muted else Theme.text,
                )
            }
            Box(Modifier.width(1.dp).height(46.dp + 32.dp * rows.size + 8.dp).background(Theme.line))
            Column(Modifier.horizontalScroll(rememberScrollState())) {
                Row {
                    days.forEachIndexed { i, d ->
                        val date = LocalDate.parse(d)
                        val weekend = date.dayOfWeek.value >= 6
                        val today = d == model.today
                        Box(Modifier.width(dayWidth).height(46.dp).background(if (weekend) Theme.sunken.copy(alpha = 0.6f) else Color.Transparent)) {
                            if (i == 0 || d.endsWith("-01")) Text(date.month.getDisplayName(TextStyle.SHORT, Locale.getDefault()), Modifier.padding(start = 4.dp, top = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.text, softWrap = false)
                            Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(date.dayOfWeek.getDisplayName(TextStyle.NARROW, Locale.getDefault()), fontSize = 10.sp, color = if (today) Theme.accent else Theme.muted)
                                Text("${date.dayOfMonth}", fontSize = 12.sp, fontWeight = if (today) FontWeight.Bold else FontWeight.Normal, color = if (today) Theme.accent else Theme.muted)
                            }
                        }
                    }
                }
                HorizontalDivider(Modifier.width(dayWidth * days.size), color = Theme.line)
                Box(Modifier.width(dayWidth * days.size).height(32.dp * rows.size + 8.dp)) {
                    Row(Modifier.fillMaxHeight()) { for (d in days) Box(Modifier.width(dayWidth).fillMaxHeight().background(if (LocalDate.parse(d).dayOfWeek.value >= 6) Theme.sunken.copy(alpha = 0.6f) else Color.Transparent)) }
                    days.indexOf(model.today).takeIf { it >= 0 }?.let { at -> Box(Modifier.offset(x = dayWidth * at + dayWidth / 2 - 1.dp).width(2.dp).fillMaxHeight().background(Theme.accent.copy(alpha = 0.5f))) }
                    rows.forEachIndexed { r, (s, at, length) -> TimelineBar(s, at, length, days, dayWidth, Modifier.offset(y = 32.dp * r)) }
                }
            }
        }
    }
}

/** The first day of the week a date is in. */
fun weekOf(day: String): String {
    val date = LocalDate.parse(day)
    val offset = (date.dayOfWeek.value - weekStart.value + 7) % 7
    return DateKey.adding(-offset, day)
}

@Composable
private fun TimelineBar(span: Span, at: Int, length: Int, days: List<String>, dayWidth: Dp, modifier: Modifier) {
    val model = LocalModel.current
    val density = LocalDensity.current
    var drag by remember { mutableFloatStateOf(0f) }
    var stretchStart by remember { mutableFloatStateOf(0f) }
    var stretchEnd by remember { mutableFloatStateOf(0f) }
    val w = with(density) { dayWidth.toPx() }
    fun days(x: Float) = (x / w).roundToInt()
    val movable = model.canEdit(span.card)
    val cutStart = span.from < days.first()
    val cutEnd = span.to > days.last()
    val width = maxOf(8.dp, dayWidth * length - 4.dp - with(density) { stretchStart.toDp() } + with(density) { stretchEnd.toDp() })
    val shape = RoundedCornerShape(topStart = if (cutStart) 0.dp else 7.dp, bottomStart = if (cutStart) 0.dp else 7.dp, topEnd = if (cutEnd) 0.dp else 7.dp, bottomEnd = if (cutEnd) 0.dp else 7.dp)
    Row(
        modifier.offset(x = dayWidth * at + 2.dp + with(density) { (drag + stretchStart).toDp() }, y = 5.dp).width(width).height(22.dp).clip(shape).background(spanFill(span.card))
            .then(if (movable) Modifier.pointerInput(span.card.id) { detectHorizontalDragGestures(onDragEnd = { model.shift(span.card.id, days(drag)); drag = 0f }, onDragCancel = { drag = 0f }) { _, d -> drag += d } } else Modifier)
            .clickable { model.openEntry = span.card.id },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (movable) Box(Modifier.width(7.dp).fillMaxHeight().pointerInput(span.card.id) { detectHorizontalDragGestures(onDragEnd = { model.stretch(span.card.id, false, days(stretchStart)); stretchStart = 0f }) { _, d -> stretchStart += d } })
        Text(if (width > dayWidth * 2) span.card.displayTitle else "", Modifier.weight(1f).padding(horizontal = 8.dp), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Theme.text)
        if (movable) Box(Modifier.width(7.dp).fillMaxHeight().pointerInput(span.card.id) { detectHorizontalDragGestures(onDragEnd = { model.stretch(span.card.id, true, days(stretchEnd)); stretchEnd = 0f }) { _, d -> stretchEnd += d } })
    }
}
