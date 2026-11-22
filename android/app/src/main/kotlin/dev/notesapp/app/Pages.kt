package dev.notesapp.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Card
import dev.notesapp.core.CardSearch
import dev.notesapp.core.DateKey
import dev.notesapp.core.Doc
import dev.notesapp.core.Stream
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.StreamLabels
import dev.notesapp.core.isOverdue
import kotlinx.coroutines.launch
import java.time.format.TextStyle as DayStyle
import java.util.Locale
import kotlin.math.roundToInt

/** A page's column of bubbles, as the Trash and lists of entries show them. */
@Composable
fun BubbleColumn(cards: List<Card>, empty: String, header: @Composable () -> Unit = {}, under: @Composable (Card) -> Unit = {}) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = minOf(560.dp, (minOf(maxWidth, 720.dp) - 32.dp) * 0.85f)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { header() }
            items(cards, key = { it.id }) { card -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) { BubbleView(card, width); under(card) } }
            if (cards.isEmpty()) item { Text(empty, Modifier.fillMaxWidth().padding(top = 60.dp), color = Theme.muted, textAlign = TextAlign.Center) }
        }
    }
}

/** The Trash: entries put there, to read, copy and restore, one by one or all at once. */
@Composable
fun TrashPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val trash = model.index.trash
    LaunchedEffect(Unit) { AttachmentKeeper.sweep(model, now = true) }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Trash", openDrawer) {
            if (trash.isNotEmpty()) TextButton(onClick = {
                val ids = trash.filter { model.canWrite(it) }.map { it.id }
                model.performEach(ids, "Restored ${ids.size}") { repo, id, group -> repo.setDeleted(id, false, group) }
            }) { Text("Restore all") }
        }
        BubbleColumn(trash, if (AttachmentKeeper.trash.value.isEmpty()) "The Trash is empty" else "", header = { TrashedAttachments() }) { card ->
            if (model.canWrite(card)) Text("Restore", Modifier.clickable { model.perform { it.setDeleted(card.id, false) }; model.say("Restored", undoable = true) }.padding(4.dp), color = Theme.accent, fontSize = 13.sp)
        }
    }
}

/** Every web link in the journal, under the entry it's in. */
@Composable
fun LinksPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val uri = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    var query by remember { mutableStateOf("") }
    val items = Stream.items(model.index, StreamFilter(sort = StreamFilter.Sort.Newest, has = StreamFilter.Contains.link), model.today)
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Links", openDrawer)
        PageSearchField(query, { query = it }) { query = "" }
        LazyColumn(Modifier.fillMaxSize()) {
            for (item in items) for (url in Doc.linkUrls(item.card.content).filter { query.isEmpty() || it.contains(query, ignoreCase = true) }) item {
                var menu by remember { mutableStateOf(false) }
                Box {
                    Column(Modifier.fillMaxWidth().combinedClickable(onClick = { runCatching { uri.openUri(url) } }, onLongClick = { menu = true }).padding(horizontal = 20.dp, vertical = 10.dp)) {
                        Text(url, color = Theme.accent, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(item.card.displayTitle, Modifier.clickable { model.openEntry = item.card.id }, fontSize = 12.sp, color = Theme.muted, maxLines = 1)
                    }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text("Copy link address") }, onClick = { menu = false; clipboard.setText(AnnotatedString(url)) })
                        DropdownMenuItem(text = { Text("Open entry") }, onClick = { menu = false; model.openEntry = item.card.id })
                    }
                }
                HorizontalDivider(color = Theme.line)
            }
        }
    }
}

/** Every file attached in the journal. */
@Composable
fun FilesPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val context = androidx.compose.ui.platform.LocalContext.current
    var query by remember { mutableStateOf("") }
    val items = Stream.items(model.index, StreamFilter(sort = StreamFilter.Sort.Newest, has = StreamFilter.Contains.file), model.today)
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Files", openDrawer)
        PageSearchField(query, { query = it }) { query = "" }
        LazyColumn(Modifier.fillMaxSize()) {
            for (item in items) for (file in Doc.files(item.card.content).filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }) item {
                Row(
                    Modifier.fillMaxWidth().clickable {
                        model.scope.launch { Attachments.fileFor(file.id, file.name, model)?.let { Attachments.open(context, it, file.mime) } ?: model.say("That file can't be fetched now.") }
                    }.padding(horizontal = 20.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(if (file.isAudio) Icons.Outlined.GraphicEq else if (file.isVideo) Icons.Outlined.Movie else Icons.Outlined.Description, null, tint = Theme.muted)
                    Column(Modifier.weight(1f)) {
                        Text(file.name, color = Theme.text, maxLines = 1)
                        Text(item.card.displayTitle, Modifier.clickable { model.openEntry = item.card.id }, fontSize = 12.sp, color = Theme.muted, maxLines = 1)
                    }
                    file.size?.let { Text(Attachments.size(it), fontSize = 12.sp, color = Theme.muted) }
                }
                HorizontalDivider(color = Theme.line)
            }
        }
    }
}

/** Search over everything, as on the phone's Search tab. */
@Composable
fun SearchPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var query by remember { mutableStateOf("") }
    val hits = remember(query, model.index) { model.search.search(query) }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Search", openDrawer)
        PageSearchField(query, { query = it }) { query = "" }
        LazyColumn(Modifier.fillMaxSize()) {
            items(hits, key = { it.card.id }) { hit ->
                Column(Modifier.fillMaxWidth().clickable { if (hit.card.isEntry) model.openEntry = hit.card.id else model.page = Page.Journal(StreamFilter(tagId = hit.card.id)) }.padding(horizontal = 20.dp, vertical = 10.dp)) {
                    Text(hit.card.displayTitle, fontWeight = FontWeight.SemiBold, color = Theme.text, maxLines = 1)
                    if (hit.snippet.isNotEmpty()) Text(hit.snippet, fontSize = 13.sp, color = Theme.muted, maxLines = 2)
                }
                HorizontalDivider(color = Theme.line)
            }
            if (query.isNotBlank() && hits.isEmpty()) item { Text("Nothing found", Modifier.fillMaxWidth().padding(top = 60.dp), color = Theme.muted, textAlign = TextAlign.Center) }
        }
    }
}

/** A todo on the calendar and the timeline: from its start date to its due date, or on the one day it has. */
val Card.span: Pair<String, String>?
    get() {
        val from = start ?: due ?: return null
        val to = due ?: start ?: return null
        return if (from <= to) from to to else to to from
    }

/** Moves a todo by some days: its due date and start date both, so a span keeps its length. */
fun AppModel.shift(id: String, days: Int) {
    if (days == 0) return
    perform { it.update(id) { c -> var n = c; c.due?.let { d -> n = n.withDue(DateKey.adding(days, d)) }; c.start?.let { s -> n = n.withStart(DateKey.adding(days, s)) }; n } }
}

/** Moves one end of a todo's span: its start (a start on its due date is none) or its due date. An end can't pass the other. */
fun AppModel.stretch(id: String, end: Boolean, days: Int) {
    val span = card(id)?.span ?: return
    if (days == 0) return
    perform {
        it.update(id) { c ->
            if (end) {
                val to = maxOf(span.first, DateKey.adding(days, span.second))
                var n = c.withDue(to)
                if (c.start == null && span.first != to) n = n.withStart(span.first)
                n
            } else {
                val from = minOf(span.second, DateKey.adding(days, span.first))
                var n = c.withStart(if (from == span.second) null else from)
                if (c.due == null) n = n.withDue(span.second)
                n
            }
        }
    }
}

/** Todos the calendar and the timeline show: the filter for them. */
fun AppModel.datedTodos(filter: StreamFilter): List<Card> {
    val match = Stream.matcher(filter.copy(type = StreamFilter.EntryType.todo), today, sharedInto)
    return index.todos.filter { it.span != null && match(it, null) }
}

/** The calendar's and timeline's filter: a todo status. */
@Composable
fun DatedFilter(filter: StreamFilter, set: (StreamFilter) -> Unit) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        FilterChip(filter.status?.let { StreamLabels.status[it] } ?: "Todos", filter.status != null, { set(filter.copy(status = null)) }) { close ->
            for (s in listOf(StreamFilter.TodoStatus.open, StreamFilter.TodoStatus.done, StreamFilter.TodoStatus.today, StreamFilter.TodoStatus.upcoming, StreamFilter.TodoStatus.waiting)) {
                DropdownMenuItem(text = { Text(StreamLabels.status[s]!!) }, onClick = { set(filter.copy(status = s)); close() })
            }
        }
    }
}

/**
 * A month of todos on their days, each from its start to its due date, as the web app's Calendar. A todo is moved to
 * another day from its menu; a day opens the journal for that day.
 */
@Composable
fun CalendarPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var month by remember { mutableStateOf(DateKey.monthKey(DateKey.today())) }
    var filter by remember { mutableStateOf(StreamFilter(type = StreamFilter.EntryType.todo)) }
    val todos = model.datedTodos(filter)
    val days = DateKey.monthGrid(month, weekStart)
    val diaryDays = remember(model.index) { model.index.live.filter { it.isEntry && it.vaultId == model.diaryVault?.id }.map(Stream::entryDay).toSet() }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Calendar", openDrawer) { TextButton(onClick = { month = DateKey.monthKey(model.today) }) { Text("Today") } }
        DatedFilter(filter) { filter = it }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
            MonthHeader(month) { month = it }
            Row {
                for (i in 0 until 7) Text(weekStart.plus(i.toLong()).getDisplayName(DayStyle.SHORT, Locale.getDefault()), Modifier.weight(1f), fontSize = 12.sp, color = Theme.muted, textAlign = TextAlign.Center)
            }
            for (row in 0 until 6) Row(Modifier.padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (day in days.subList(row * 7, row * 7 + 7)) {
                    DayCell(day, DateKey.monthKey(day) == month, todos.filter { t -> t.span!!.let { it.first <= day && day <= it.second } }, day in diaryDays, Modifier.weight(1f))
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DayCell(day: String, inMonth: Boolean, todos: List<Card>, diary: Boolean, modifier: Modifier) {
    val model = LocalModel.current
    var menu by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf<Card?>(null) }
    Box(modifier) {
        Column(
            Modifier.fillMaxWidth().heightIn(min = 76.dp).clip(RoundedCornerShape(6.dp)).background(if (inMonth) Theme.surface else Theme.bg)
                .combinedClickable(onClick = { model.page = Page.Journal(StreamFilter(`when` = day)) }, onLongClick = { menu = true }).padding(3.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("${day.takeLast(2).toInt()}", fontSize = 12.sp, fontWeight = if (day == model.today) FontWeight.Bold else FontWeight.Normal, color = if (day == model.today) Theme.accent else if (inMonth) Theme.text else Theme.muted)
                if (diary) Box(Modifier.size(4.dp).clip(RoundedCornerShape(50)).background(Theme.accent))
            }
            for (todo in todos.take(3)) {
                Text(
                    todo.title, Modifier.fillMaxWidth().clip(RoundedCornerShape(3.dp)).background(if (todo.isOverdue(model.today)) Theme.alert.copy(alpha = 0.2f) else Theme.accentSoft)
                        .combinedClickable(onClick = { model.openEntry = todo.id }, onLongClick = { moving = todo }).padding(horizontal = 3.dp),
                    fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Clip, color = Theme.text, textDecoration = if (todo.isDone) TextDecoration.LineThrough else null,
                )
            }
            if (todos.size > 3) Text("+${todos.size - 3}", fontSize = 10.sp, color = Theme.muted)
        }
        DropdownMenu(menu, { menu = false }) {
            DropdownMenuItem(text = { Text("Open this day in the journal") }, onClick = { menu = false; model.page = Page.Journal(StreamFilter(`when` = day)) })
            model.diaryVault?.let { d -> DropdownMenuItem(text = { Text("Diary for this day") }, onClick = { menu = false; model.page = Page.Journal(StreamFilter(`when` = day, vaultId = d.id)) }) }
        }
    }
    // A todo held is moved to the day picked, start and all.
    moving?.let { todo -> DayPicker(day, { moving = null }) { to -> model.shift(todo.id, DateKey.daysBetween(day, to)) } }
}

/** Todos with dates as bars from their start to their due date, dragged to move them and stretched at either end, as the web app's Timeline. */
@Composable
fun TimelinePage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var first by remember { mutableStateOf(DateKey.adding(-7, DateKey.today())) }
    var filter by remember { mutableStateOf(StreamFilter(type = StreamFilter.EntryType.todo, status = StreamFilter.TodoStatus.open)) }
    val dayWidth = 30.dp
    val days = 70
    val last = DateKey.adding(days - 1, first)
    val todos = model.datedTodos(filter).sortedWith(compareBy({ it.span!!.first }, { it.span!!.second })).filter { it.span!!.second >= first && it.span!!.first <= last }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Timeline", openDrawer) {
            IconButton(onClick = { first = DateKey.adding(-28, first) }) { Icon(Icons.Outlined.ChevronLeft, "Earlier", tint = Theme.text) }
            TextButton(onClick = { first = DateKey.adding(-7, model.today) }) { Text("Today") }
            IconButton(onClick = { first = DateKey.adding(28, first) }) { Icon(Icons.Outlined.ChevronRight, "Later", tint = Theme.text) }
        }
        DatedFilter(filter) { filter = it }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row {
                for (i in 0 until days) {
                    val day = DateKey.adding(i, first)
                    Column(Modifier.width(dayWidth)) {
                        Text(if (day.endsWith("-01") || i == 0) DateKey.formatMonth(DateKey.monthKey(day)) else " ", fontSize = 10.sp, color = Theme.muted, softWrap = false, maxLines = 1, overflow = TextOverflow.Visible)
                        Text("${day.takeLast(2).toInt()}", fontSize = 10.sp, color = if (day == model.today) Theme.accent else Theme.muted)
                    }
                }
            }
            for (todo in todos) TimelineBar(todo, first, dayWidth)
            if (todos.isEmpty()) Text("No todos with dates here.", color = Theme.muted)
        }
    }
}

@Composable
private fun TimelineBar(todo: Card, first: String, dayWidth: androidx.compose.ui.unit.Dp) {
    val model = LocalModel.current
    val density = LocalDensity.current
    val span = todo.span!!
    var drag by remember { mutableFloatStateOf(0f) }
    var stretchStart by remember { mutableFloatStateOf(0f) }
    var stretchEnd by remember { mutableFloatStateOf(0f) }
    val w = with(density) { dayWidth.toPx() }
    fun days(x: Float) = (x / w).roundToInt()
    val offset = dayWidth * DateKey.daysBetween(first, span.first)
    val length = dayWidth * (DateKey.daysBetween(span.first, span.second) + 1)
    val dragDp = with(density) { (drag + stretchStart).toDp() }
    val width = maxOf(dayWidth, length - 2.dp - with(density) { stretchStart.toDp() } + with(density) { stretchEnd.toDp() })
    Row(
        Modifier.offset(x = offset + dragDp).width(width).height(28.dp).clip(RoundedCornerShape(6.dp))
            .background(if (todo.isOverdue(model.today)) Theme.alert.copy(alpha = 0.3f) else if (todo.isDone) Theme.sunken else Theme.accentSoft)
            .pointerInput(todo.id) { detectHorizontalDragGestures(onDragEnd = { model.shift(todo.id, days(drag)); drag = 0f }, onDragCancel = { drag = 0f }) { _, d -> drag += d } }
            .clickable { model.openEntry = todo.id },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(10.dp).height(28.dp).pointerInput(todo.id) { detectHorizontalDragGestures(onDragEnd = { model.stretch(todo.id, false, days(stretchStart)); stretchStart = 0f }) { _, d -> stretchStart += d } })
        Text(todo.title, Modifier.weight(1f), fontSize = 12.sp, maxLines = 1, color = Theme.text)
        Box(Modifier.width(10.dp).height(28.dp).pointerInput(todo.id) { detectHorizontalDragGestures(onDragEnd = { model.stretch(todo.id, true, days(stretchEnd)); stretchEnd = 0f }) { _, d -> stretchEnd += d } })
    }
}

/**
 * Every photo and video in the journal, as a photo library shows them, as the web app's Photos page: under the day
 * each entry was written, opening full screen to page through them all, picked to share, with a menu to open their
 * entry or share by a public link. A switch shows them all, the photos alone or the videos alone.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PhotosPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val context = androidx.compose.ui.platform.LocalContext.current
    var kind by remember { mutableStateOf("All") }
    var viewing by remember { mutableStateOf<String?>(null) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    val items = Stream.items(model.index, StreamFilter(sort = StreamFilter.Sort.Newest, has = StreamFilter.Contains.photo), model.today, model.sharedInto) +
        Stream.items(model.index, StreamFilter(sort = StreamFilter.Sort.Newest, has = StreamFilter.Contains.file), model.today, model.sharedInto)
    val seen = mutableSetOf<String>()
    val all = items.sortedByDescending { it.at }.flatMap { item ->
        Doc.media(item.card.content).filter { m ->
            val skip = (kind == "Photos" && m is Doc.Media.Video) || (kind == "Videos" && m is Doc.Media.Photo)
            !skip && seen.add(m.id)
        }.map { it to item.card }
    }
    val days = all.groupBy { Stream.entryDay(it.second) }.toSortedMap(reverseOrder())
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Photos", openDrawer) {
            if (picked.isNotEmpty()) {
                TextButton(onClick = {
                    val chosen = all.filter { it.first.id in picked }
                    model.scope.launch {
                        val files = chosen.mapNotNull { (m, _) -> Attachments.fileFor(m.id, if (m is Doc.Media.Video) m.file.name else "Photo ${m.id.take(8)}.jpg", model) }
                        if (files.isNotEmpty()) shareFiles(context, files)
                    }
                }) { Text("Share ${picked.size}") }
                TextButton(onClick = { picked = emptySet() }) { Text("Done") }
            }
        }
        Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
            TypeSwitchOf(listOf("All", "Photos", "Videos"), kind) { kind = it }
        }
        LazyVerticalGrid(GridCells.Adaptive(110.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((day, dayItems) in days) {
                item(span = { GridItemSpan(maxLineSpan) }, key = "day:$day") {
                    Row(Modifier.padding(top = 10.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(DateKey.relativeDay(day, model.today), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = Theme.text)
                        val ids = dayItems.map { it.first.id }
                        Text(if (ids.all { it in picked }) "Unpick" else "Pick", Modifier.clickable { picked = if (ids.all { it in picked }) picked - ids.toSet() else picked + ids }, fontSize = 13.sp, color = Theme.accent)
                    }
                }
                items(dayItems, key = { it.first.id }) { (m, card) ->
                    var menu by remember { mutableStateOf(false) }
                    BoxWithConstraints {
                        PhotoThumb(m, card.vaultId, maxWidth, Modifier.combinedClickable(onClick = { if (picked.isEmpty()) viewing = m.id else picked = if (m.id in picked) picked - m.id else picked + m.id }, onLongClick = { menu = true }))
                        if (picked.isNotEmpty()) Icon(if (m.id in picked) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, Modifier.align(Alignment.TopEnd).padding(5.dp).size(22.dp), tint = Color.White)
                        DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { Text("Pick") }, onClick = { menu = false; picked = picked + m.id })
                            PhotoMenu(m.id, card) { menu = false }
                        }
                    }
                }
            }
            if (all.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("No photos yet", Modifier.padding(top = 60.dp), color = Theme.muted, textAlign = TextAlign.Center) }
        }
    }
    viewing?.let { start -> MediaViewer(all.map { it.first }, start, all.firstOrNull { it.first.id == start }?.second?.vaultId ?: "") { viewing = null } }
}

fun shareFiles(context: android.content.Context, files: List<java.io.File>) {
    val uris = ArrayList(files.map { androidx.core.content.FileProvider.getUriForFile(context, "dev.notesapp.notes.files", it) })
    val send = android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE).setType("*/*").putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, uris).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(android.content.Intent.createChooser(send, null).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** A row of choices, one picked, as the journal's All · Notes · Todos switch. */
@Composable
fun TypeSwitchOf(options: List<String>, value: String, set: (String) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(Theme.sunken).padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (o in options) {
            val on = o == value
            Text(o, Modifier.clip(RoundedCornerShape(50)).background(if (on) Theme.raised else Color.Transparent).clickable { set(o) }.padding(horizontal = 12.dp, vertical = 4.dp), fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = if (on) Theme.text else Theme.muted)
        }
    }
}

/**
 * Share via public link: shares the photo, video or file from Google Drive so anyone with the link can open it, and
 * copies the link; Stop sharing link takes it back.
 */
@Composable
fun PublicLinkMenu(id: String, vaultId: String, close: () -> Unit) {
    val model = LocalModel.current
    val clipboard = LocalClipboardManager.current
    if (model.vault(vaultId)?.let { it.role != "viewer" && !it.isEncrypted } != true) return
    DropdownMenuItem(text = { Text("Share via public link") }, onClick = {
        close()
        model.scope.launch {
            model.api.shareDriveLink(id).fold({ clipboard.setText(AnnotatedString(it)); model.say("Public link copied") }, { model.say(it.message ?: "It couldn't be shared. Try again.") })
        }
    })
    DropdownMenuItem(text = { Text("Stop sharing link") }, onClick = {
        close()
        model.scope.launch { model.say(if (model.api.stopDriveLink(id)) "No longer shared by link" else "That didn't work. Try again.") }
    })
}

