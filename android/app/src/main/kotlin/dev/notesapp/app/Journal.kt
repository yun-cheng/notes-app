package dev.notesapp.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.CardSearch
import dev.notesapp.core.DateKey
import dev.notesapp.core.Stream
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.StreamItem
import dev.notesapp.core.StreamLabels
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.format.TextStyle as DayStyle
import java.time.temporal.WeekFields
import java.util.Locale
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Check

private const val PAGE_SIZE = 150

/**
 * The journal: every note and todo as compact bubbles like a chat, under day badges, with a box to write the next one,
 * as the web app's `journal.tsx`. A filter row narrows it; the sidebar narrows it to a tag or a vault.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun JournalView(initial: StreamFilter, openDrawer: () -> Unit, fixed: Boolean = false) {
    val model = LocalModel.current
    var filter by remember { mutableStateOf(initial) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var shown by remember(filter) { mutableIntStateOf(PAGE_SIZE) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    var pickDates by remember { mutableStateOf<String?>(null) }
    val setFilter: (StreamFilter) -> Unit = { f ->
        filter = f
        if (!fixed) model.page = Page.Journal(f)
    }

    val title = when {
        filter.archived -> "Archive"
        filter.template -> "Templates"
        filter.tagId != null -> model.card(filter.tagId!!)?.displayTitle ?: "Tag"
        filter.vaultId != null -> model.vault(filter.vaultId!!)?.name ?: "Vault"
        filter.status == StreamFilter.TodoStatus.today -> "Today"
        else -> "Journal"
    }
    var all = Stream.items(model.index, filter, model.today, model.sharedInto)
    all = if (searching && query.isNotBlank()) {
        val hits = CardSearch(model.index).search(query).map { it.card.id }.toSet()
        all.filter { it.card.id in hits }
    } else Stream.foldStacks(all, model.index.stackOf)
    // Whether the stream reads like a chat, newest at the bottom.
    val chat = filter.sort == StreamFilter.Sort.Written || filter.sort == StreamFilter.Sort.Edited
    val visible = if (chat) all.takeLast(shown) else all.take(shown)
    val locked = filter.vaultId?.takeIf { it in model.lockedVaults }?.let { model.vault(it) }

    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar(title, openDrawer, subtitle = "${all.size}") {
            SyncBadge()
            IconButton(onClick = { model.viewOnly = !model.viewOnly }) {
                Icon(if (model.viewOnly) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff, if (model.viewOnly) "Turn off view only" else "View only", tint = if (model.viewOnly) Theme.accent else Theme.muted)
            }
            IconButton(onClick = { searching = !searching; if (!searching) query = "" }) { Icon(Icons.Outlined.Search, "Search", tint = Theme.text) }
            SortMenu(filter, setFilter)
            BoardMenu(filter, setFilter)
        }
        FilterRow(filter, setFilter) { pickDates = "" }
        if (searching) PageSearchField(query, { query = it }) { searching = false; query = "" }
        when {
            locked != null -> UnlockView(locked, Modifier.weight(1f))
            filter.board != null -> Box(Modifier.weight(1f)) { BoardView(filter, filter.board!!) }
            else -> {
                val list = rememberLazyListState()
                val scope = rememberCoroutineScope()
                val groups = remember(visible) { dayGroups(visible) }
                // Rows in the list, in order, for scrolling to an entry: a header and its entries.
                val rowOf = remember(groups) {
                    val m = mutableMapOf<String, Int>()
                    var i = if (chat && all.size > visible.size) 1 else 0
                    for (g in groups) { i++; for (it in g.second) m[it.card.id] = i++ }
                    m
                }
                val rows = (if (chat && all.size > visible.size) 1 else 0) + groups.sumOf { 1 + it.second.size }
                // A chat opens at its newest entry, at the foot.
                LaunchedEffect(filter, rows > 0) { if (chat && rows > 0) list.scrollToItem(rows - 1, Int.MAX_VALUE / 2) }
                LaunchedEffect(model.lastSaved) { model.lastSaved?.let { id -> rowOf[id]?.let { list.animateScrollToItem(it) } } }
                BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                    val bubbleWidth = minOf(560.dp, (minOf(maxWidth, 720.dp) - 32.dp) * 0.85f)
                    LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (chat && all.size > visible.size) item { TextButton(onClick = { shown += PAGE_SIZE }, Modifier.fillMaxWidth()) { Text("Show earlier entries") } }
                        for ((day, items) in groups) {
                            stickyHeader(key = "day:$day:${items.first().id}") {
                                DayBadge(day, filter.sort) { if (DateKey.isKey(it)) pickDates = it }
                            }
                            items(items, key = { it.card.id }) { item ->
                                BubbleView(item.card, bubbleWidth, item.card.id in picked, picked.isNotEmpty()) {
                                    picked = if (item.card.id in picked) picked - item.card.id else picked + item.card.id
                                }
                            }
                        }
                        if (!chat && all.size > visible.size) item { TextButton(onClick = { shown += PAGE_SIZE }, Modifier.fillMaxWidth()) { Text("Show more entries") } }
                        if (all.isEmpty()) item { EmptyJournal(filter, searching) }
                    }
                    JournalRail(visible, Modifier.align(Alignment.CenterEnd)) { id -> rowOf[id]?.let { scope.launch { list.scrollToItem(it) } } }
                }
                if (picked.isNotEmpty()) BatchBar(picked, all.map { it.card.id }) { picked = it }
                else if (!model.viewOnly) JournalBox(filter)
            }
        }
    }
    pickDates?.let { start -> DatesDialog(filter, start.ifEmpty { null }, setFilter) { pickDates = null } }
}

private fun dayGroups(items: List<StreamItem>): List<Pair<String, List<StreamItem>>> {
    val out = mutableListOf<Pair<String, MutableList<StreamItem>>>()
    for (item in items) {
        if (out.lastOrNull()?.first == item.day) out.last().second.add(item) else out.add(item.day to mutableListOf(item))
    }
    return out
}

@Composable
private fun SortMenu(filter: StreamFilter, set: (StreamFilter) -> Unit) {
    val model = LocalModel.current
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Outlined.SwapVert, StreamLabels.sort(filter.sort, model.index.tagGroups.groups), tint = Theme.text) }
        DropdownMenu(open, { open = false }) {
            for ((sort, label) in StreamLabels.sorts) MenuCheck(label, filter.sort == sort) { set(filter.copy(sort = sort)); open = false }
            for (g in model.index.tagGroups.groups.filter { it.ordered }) {
                val s = StreamFilter.Sort.Group(g.id)
                MenuCheck("By ${g.title.lowercase()}", filter.sort == s) { set(filter.copy(sort = s)); open = false }
            }
        }
    }
}

@Composable
private fun BoardMenu(filter: StreamFilter, set: (StreamFilter) -> Unit) {
    val model = LocalModel.current
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Outlined.ViewKanban, "Board", tint = if (filter.board != null) Theme.accent else Theme.text) }
        DropdownMenu(open, { open = false }) {
            MenuCheck("List", filter.board == null) { set(filter.copy(board = null)); open = false }
            MenuCheck("Board by state", filter.board == "state") { set(filter.copy(board = "state")); open = false }
            for (g in model.index.tagGroups.groups) MenuCheck("Board by ${g.title.lowercase()}", filter.board == g.id) { set(filter.copy(board = g.id)); open = false }
        }
    }
}

@Composable
fun MenuCheck(label: String, checked: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, fontWeight = if (checked) FontWeight.SemiBold else FontWeight.Normal) }, onClick = onClick,
        trailingIcon = { if (checked) Icon(Icons.Outlined.Check, null, tint = Theme.accent) },
    )
}

/**
 * The row under the title bar that narrows the journal, as the web app's `FilterPanel`: a switch between All, Notes,
 * Todos and Stacks, then chips for todo status, when written and what an entry holds, and Templates. A chip in use
 * names its choice and has an × to take it off; the sidebar's tag and vault show as chips too.
 */
@Composable
fun FilterRow(filter: StreamFilter, set: (StreamFilter) -> Unit, pickDates: () -> Unit) {
    val model = LocalModel.current
    Column {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            TypeSwitch(filter.effectiveType) { t -> set(filter.copy(type = t, status = if (t != StreamFilter.EntryType.todo) null else filter.status)) }
            FilterChip(filter.status?.let { StreamLabels.status[it] } ?: "Todos", filter.status != null, { set(filter.copy(status = null)) }) { close ->
                for (s in StreamFilter.TodoStatus.entries) DropdownMenuItem(text = { Text(StreamLabels.status[s]!!) }, onClick = { set(filter.copy(status = s)); close() })
            }
            FilterChip(filter.`when`?.let { StreamLabels.`when`(it, model.today) } ?: "Written", filter.`when` != null, { set(filter.copy(`when` = null)) }) { close ->
                DropdownMenuItem(text = { Text("Written today") }, onClick = { set(filter.copy(`when` = "today")); close() })
                DropdownMenuItem(text = { Text("Past 7 days") }, onClick = { set(filter.copy(`when` = "week")); close() })
                DropdownMenuItem(text = { Text("Past 30 days") }, onClick = { set(filter.copy(`when` = "month")); close() })
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Pick dates…") }, onClick = { close(); pickDates() })
            }
            FilterChip(filter.has?.let { StreamLabels.contains[it] } ?: "Contains", filter.has != null, { set(filter.copy(has = null)) }) { close ->
                for (c in StreamFilter.Contains.entries) DropdownMenuItem(text = { Text(StreamLabels.contains[c]!!) }, onClick = { set(filter.copy(has = c)); close() })
            }
            ToggleChip("Templates", filter.template) { set(filter.copy(template = !filter.template)) }
            filter.tagId?.let { SetChip(model.card(it)?.displayTitle ?: "Tag", Icons.Outlined.Label) { set(filter.copy(tagId = null)) } }
            filter.vaultId?.let { SetChip(model.vault(it)?.name ?: "Vault", Icons.Outlined.Inventory2) { set(filter.copy(vaultId = null)) } }
            if (filter.archived) SetChip("Archived", Icons.Outlined.Archive) { set(filter.copy(archived = false)) }
        }
        HorizontalDivider(color = Theme.line)
    }
}

/** All, Notes, Todos, Stacks. */
@Composable
fun TypeSwitch(type: StreamFilter.EntryType?, set: (StreamFilter.EntryType?) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(Theme.sunken).padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for ((label, value) in listOf("All" to null, "Notes" to StreamFilter.EntryType.note, "Todos" to StreamFilter.EntryType.todo, "Stacks" to StreamFilter.EntryType.stack)) {
            val on = type == value
            Text(
                label, Modifier.clip(RoundedCornerShape(50)).background(if (on) Theme.raised else Color.Transparent).clickable { set(value) }.padding(horizontal = 10.dp, vertical = 3.dp),
                fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = if (on) Theme.text else Theme.muted,
            )
        }
    }
}

/** A chip that opens a menu of choices; once one is picked it's tinted, names it, and has an × to take it off. */
@Composable
fun FilterChip(label: String, set: Boolean, clear: () -> Unit, items: @Composable (close: () -> Unit) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(50)).background(if (set) Theme.accentSoft else Theme.sunken),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(Modifier.clickable { open = true }.padding(start = 10.dp, end = if (set) 2.dp else 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, fontSize = 14.sp, fontWeight = if (set) FontWeight.Medium else FontWeight.Normal, color = if (set) Theme.text else Theme.muted)
                Icon(Icons.Outlined.KeyboardArrowDown, null, Modifier.size(16.dp), tint = if (set) Theme.text else Theme.muted)
            }
            if (set) Icon(Icons.Outlined.Close, "Clear", Modifier.padding(end = 8.dp).size(14.dp).clickable(onClick = clear), tint = Theme.text)
        }
        DropdownMenu(open, { open = false }) { items { open = false } }
    }
}

@Composable
fun ToggleChip(label: String, on: Boolean, toggle: () -> Unit) {
    Text(
        label, Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(50)).background(if (on) Theme.accentSoft else Theme.sunken).clickable(onClick = toggle).padding(horizontal = 10.dp, vertical = 4.dp),
        fontSize = 14.sp, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal, color = if (on) Theme.text else Theme.muted,
    )
}

/** A chip for a part of the filter set elsewhere (the sidebar's tag or vault), with an × to take it off. */
@Composable
fun SetChip(label: String, icon: ImageVector, clear: () -> Unit) {
    Row(
        Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(50)).background(Theme.accentSoft).padding(horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(14.dp), tint = Theme.text)
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Theme.text)
        Icon(Icons.Outlined.Close, "Clear", Modifier.size(14.dp).clickable(onClick = clear), tint = Theme.text)
    }
}

/** A day's badge over its entries, pinned under the title bar while they scroll past. Pressing it opens the date picker there. */
@Composable
fun DayBadge(day: String, sort: StreamFilter.Sort, pick: (String) -> Unit) {
    val model = LocalModel.current
    val label = when {
        sort is StreamFilter.Sort.Group -> model.card(day)?.displayTitle ?: "No tag"
        day.isEmpty() -> "No due date"
        else -> DateKey.relativeDay(day, model.today)
    }
    Box(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 2.dp), contentAlignment = Alignment.Center) {
        Text(
            label,
            Modifier.shadow(2.dp, RoundedCornerShape(50)).clip(RoundedCornerShape(50)).background(Theme.sunken).clickable { pick(day) }.padding(horizontal = 10.dp, vertical = 2.dp),
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted,
        )
    }
}

@Composable
fun EmptyJournal(filter: StreamFilter, searching: Boolean) {
    Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(if (searching) Icons.Outlined.Search else Icons.Outlined.ChatBubbleOutline, null, Modifier.size(40.dp), tint = Theme.muted)
        Text(if (searching) "Nothing found" else if (filter.isFiltered) "Nothing here" else "Nothing yet", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Theme.text)
        Text(if (searching) "Try other words." else if (filter.isFiltered) "No entries match this filter." else "Write a note below, or [] for a todo.", color = Theme.muted)
    }
}

/** A page's search field, a row under the title bar. */
@Composable
fun PageSearchField(query: String, set: (String) -> Unit, close: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(10.dp)).background(Theme.surface).border(1.dp, Theme.accent, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Outlined.Search, null, Modifier.size(18.dp), tint = Theme.muted)
        BasicTextField(
            query, set, Modifier.weight(1f).focusRequester(focus), singleLine = true, textStyle = TextStyle(color = Theme.text, fontSize = 16.sp), cursorBrush = SolidColor(Theme.accent),
            decorationBox = { inner -> if (query.isEmpty()) Text("Search", color = Theme.muted, fontSize = 16.sp); inner() },
        )
        Icon(Icons.Outlined.Close, "Close search", Modifier.size(18.dp).clickable(onClick = close), tint = Theme.muted)
    }
}

/**
 * A rail down the right, as a photo library has, with the years or months marked down it: pressed or dragged to go
 * anywhere in the journal at once, as the web app's `ScrollRail`.
 */
@Composable
fun JournalRail(items: List<StreamItem>, modifier: Modifier, go: (String) -> Unit) {
    val months = remember(items) {
        val out = mutableListOf<Pair<String, String>>()
        for (item in items) if (DateKey.isKey(item.day)) {
            val m = DateKey.monthKey(item.day)
            if (out.lastOrNull()?.first != m) out.add(m to item.id)
        }
        out
    }
    if (months.size < 2) return
    val years = months.map { it.first.take(4) }.toSet().size > 1
    var height by remember { mutableIntStateOf(1) }
    var pointing by remember { mutableStateOf<String?>(null) }
    val density = LocalDensity.current
    fun at(y: Float) {
        val i = (y / height * months.size).toInt().coerceIn(0, months.size - 1)
        pointing = months[i].first
        go(months[i].second)
    }
    Box(
        modifier.fillMaxHeight().width(40.dp).padding(vertical = 8.dp).onSizeChanged { height = maxOf(1, it.height) }
            .pointerInput(months) { detectVerticalDragGestures(onDragStart = { at(it.y) }, onDragEnd = { pointing = null }, onDragCancel = { pointing = null }) { change, _ -> at(change.position.y) } },
    ) {
        val step = with(density) { (height.toFloat() / months.size).toDp() }
        months.forEachIndexed { i, (m, _) ->
            val mark = if (years) (if (m.endsWith("-01") || i == 0) m.take(4) else null) else DateKey.formatMonth(m).take(3)
            if (mark != null && (step > 14.dp || years)) Text(mark, Modifier.align(Alignment.TopEnd).offset(y = step * i), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
        }
        pointing?.let { p ->
            val i = months.indexOfFirst { it.first == p }
            Text(
                DateKey.formatMonth(p), Modifier.align(Alignment.TopEnd).offset(x = (-44).dp, y = step * i).shadow(3.dp, RoundedCornerShape(50)).background(Theme.raised, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 3.dp),
                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.text,
            )
        }
    }
}

/** Picks a day or a range of days, as the web app's `DatesDialog`: a first press picks a day, the next the other end. */
@Composable
fun DatesDialog(filter: StreamFilter, startDay: String?, set: (StreamFilter) -> Unit, dismiss: () -> Unit) {
    val model = LocalModel.current
    var month by remember { mutableStateOf(DateKey.monthKey(startDay ?: DateKey.today())) }
    var from by remember { mutableStateOf<String?>(null) }
    var to by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        val w = filter.`when`
        if (startDay != null) from = startDay
        else if (w != null && (DateKey.isKey(w) || Stream.dayRange(w) != null)) {
            val (a, b) = Stream.whenRange(w, model.today)
            from = a; to = if (b == a) null else b; month = DateKey.monthKey(a)
        }
    }
    val days = remember(model.index) { model.index.live.filter { it.isEntry }.map(Stream::entryDay).toSet() }
    val range = from?.let { f -> val e = to ?: f; minOf(f, e)..maxOf(f, e) }
    Sheet(dismiss) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            MonthHeader(month) { month = it }
            MonthGrid(month, days, range) { day -> if (from == null || to != null) { from = day; to = null } else to = day }
            Text(from?.let { StreamLabels.`when`(Stream.daysWhen(it, to ?: it), model.today) } ?: "Pick a day, then another for a range.", fontSize = 14.sp, color = Theme.muted)
            Row(Modifier.fillMaxWidth()) {
                TextButton(onClick = dismiss) { Text("Cancel") }
                Spacer(Modifier.weight(1f))
                androidx.compose.material3.Button(onClick = { from?.let { set(filter.copy(`when` = Stream.daysWhen(it, to ?: it))) }; dismiss() }, enabled = from != null) { Text("Show") }
            }
        }
    }
}

@Composable
fun MonthHeader(month: String, set: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { set(DateKey.addMonths(month, -1)) }) { Icon(Icons.Outlined.ChevronLeft, "Previous month", tint = Theme.text) }
        Text(DateKey.formatMonth(month), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Theme.text, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        IconButton(onClick = { set(DateKey.addMonths(month, 1)) }) { Icon(Icons.Outlined.ChevronRight, "Next month", tint = Theme.text) }
    }
}

val weekStart: DayOfWeek get() = WeekFields.of(Locale.getDefault()).firstDayOfWeek

/** Six weeks of a month, each day a button, days with something marked by a dot. */
@Composable
fun MonthGrid(month: String, marked: Set<String>, selected: ClosedRange<String>?, pick: (String) -> Unit) {
    val days = DateKey.monthGrid(month, weekStart)
    val today = DateKey.today()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (i in 0 until 7) Text(weekStart.plus(i.toLong()).getDisplayName(DayStyle.NARROW, Locale.getDefault()), Modifier.width(38.dp), fontSize = 12.sp, color = Theme.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
        for (row in 0 until 6) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for (day in days.subList(row * 7, row * 7 + 7)) {
                val inMonth = DateKey.monthKey(day) == month
                val on = selected?.contains(day) == true
                Column(
                    Modifier.size(38.dp).clip(RoundedCornerShape(8.dp)).background(if (on) Theme.accentSoft else Color.Transparent).clickable { pick(day) },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                ) {
                    Text("${day.takeLast(2).toInt()}", color = if (inMonth) Theme.text else Theme.muted.copy(alpha = 0.6f), fontWeight = if (day == today) FontWeight.Bold else FontWeight.Normal, fontSize = 15.sp)
                    Box(Modifier.size(4.dp).clip(RoundedCornerShape(50)).background(if (day in marked) Theme.accent else Color.Transparent))
                }
            }
        }
    }
}
