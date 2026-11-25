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
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Card
import dev.notesapp.core.CardSearch
import dev.notesapp.core.DateKey
import dev.notesapp.core.Doc
import dev.notesapp.core.Markdown
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
            items(cards, key = { it.id }) { card -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { BubbleView(card, width); EntryAttachments(card); under(card) } }
            if (cards.isEmpty()) item { Text(empty, Modifier.fillMaxWidth().padding(top = 60.dp), color = Theme.muted, textAlign = TextAlign.Center) }
        }
    }
}

/**
 * What's been moved to the Trash, as the web app's: its photos and files first, then entries as the journal shows them,
 * under the day each was trashed, newest first, narrowed by the journal's filters. A press picks one, and the bar for
 * those picked restores them; Restore is in each one's menu too, and Restore all restores everything shown. Trashed tags
 * are listed after the entries.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TrashPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val context = androidx.compose.ui.platform.LocalContext.current
    var filter by remember { mutableStateOf(StreamFilter()) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    LaunchedEffect(Unit) { AttachmentKeeper.sweep(model, now = true) }
    val match = Stream.matcher(filter, model.today, model.sharedInto)
    val items = model.index.trash.filter { it.isEntry && match(it, null) }.sortedByDescending { it.updatedAt }
    val tags = if (filter.isFiltered) emptyList() else model.index.trash.filter { it.type == dev.notesapp.core.CardType.tag }
    val restorable = (items + tags).filter { model.canWrite(it) }
    fun restore(ids: List<String>) {
        val ok = ids.filter { id -> model.card(id)?.let { model.canWrite(it) } == true }
        if (ok.isNotEmpty()) model.performEach(ok, if (ok.size == 1) "Restored" else "Restored ${ok.size}") { repo, id, group -> repo.setDeleted(id, false, group) }
    }
    val days = items.groupBy { DateKey.of(java.time.Instant.ofEpochMilli(it.updatedAt)) }.toSortedMap(reverseOrder())
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar(if (picked.isEmpty()) "Trash" else "${picked.size} selected", openDrawer) {
            if (picked.isNotEmpty()) {
                TextButton(onClick = { picked = items.map { it.id }.toSet() }) { Text("Select all") }
                TextButton(onClick = { picked = emptySet() }) { Text("Done") }
            } else if (restorable.size > 1) IconButton(onClick = { restore(restorable.map { it.id }) }) { Icon(Icons.AutoMirrored.Outlined.Undo, "Restore all", tint = Theme.text) }
        }
        FilterRow(filter, { filter = it }, {}, templates = false)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val width = minOf(560.dp, (minOf(maxWidth, 720.dp) - 32.dp) * 0.85f)
            val list = androidx.compose.foundation.lazy.rememberLazyListState()
            val attachmentsShown = !filter.copy(vaultId = null).isFiltered
            // Rows in the list, for the rail to go to an entry: the photos and files, then each day and its entries.
            val rowOf = remember(days, attachmentsShown) {
                val m = mutableMapOf<String, Int>()
                var i = if (attachmentsShown) 1 else 0
                for ((_, cards) in days) { i++; for (c in cards) m[c.id] = i++ }
                m
            }
            LazyColumn(Modifier.fillMaxSize(), list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (attachmentsShown) item { TrashedAttachments(filter.vaultId) }
                for ((day, cards) in days) {
                    item(key = "day:$day") { DayBadge(day, StreamFilter.Sort.Edited) {} }
                    items(cards, key = { it.id }) { card ->
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            BubbleView(card, width, card.id in picked, picking = true) { picked = if (card.id in picked) picked - card.id else picked + card.id }
                            EntryAttachments(card)
                        }
                    }
                }
                if (items.isEmpty()) item {
                    Text(
                        if (filter.isFiltered) "Nothing in the Trash matches these filters." else if (tags.isNotEmpty() || AttachmentKeeper.trash.value.isNotEmpty()) "No entries in the Trash." else "The Trash is empty. Entries you move to the Trash wait here until you restore them.",
                        Modifier.fillMaxWidth().padding(vertical = 40.dp), color = Theme.muted, textAlign = TextAlign.Center,
                    )
                }
                if (tags.isNotEmpty()) {
                    item { Text("Tags", Modifier.padding(top = 16.dp), fontWeight = FontWeight.SemiBold, color = Theme.text) }
                    items(tags, key = { it.id }) { tag ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(tag.displayTitle, Modifier.weight(1f), color = Theme.text)
                            if (model.canWrite(tag)) TextButton(onClick = { restore(listOf(tag.id)) }) { Text("Restore") }
                        }
                    }
                }
            }
            // By the day each entry was trashed, newest first, as the web's.
            LazyRail(list, days.flatMap { (day, cards) -> cards.map { day } }, days.flatMap { (_, cards) -> cards.map { it.id } },
                { DateKey.relativeDay(it, model.today) }, { rowOf[it] }, Modifier.align(Alignment.CenterEnd))
        }
        if (picked.isNotEmpty()) Row(Modifier.fillMaxWidth().background(Theme.surface).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${picked.size} selected", fontWeight = FontWeight.SemiBold, color = Theme.text)
            androidx.compose.material3.Button(onClick = { restore(picked.toList()); picked = emptySet() }) { Text("Restore") }
            IconButton(onClick = {
                val cards = picked.mapNotNull { model.card(it) }.sortedBy { it.createdAt }
                (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Entries", Markdown.entries(cards, model.index)))
                model.say("Copied ${cards.size}")
            }) { Icon(Icons.Outlined.ContentCopy, "Copy", tint = Theme.muted) }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { picked = emptySet() }) { Icon(Icons.Outlined.Close, "Stop selecting", tint = Theme.muted) }
        }
    }
}

/** Search over everything, as on the phone's Search tab and the web's Search page: notes, todos and tags, each with its icon. */
@Composable
fun SearchPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var query by remember { mutableStateOf("") }
    val hits = remember(query, model.index) { model.search.search(query) }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Search", openDrawer, filters = false)
        PageSearchField(query, { query = it }, placeholder = "Search notes, todos and tags") { query = "" }
        LazyColumn(Modifier.fillMaxSize()) {
            items(hits, key = { it.card.id }) { hit ->
                Row(
                    Modifier.fillMaxWidth().clickable { if (hit.card.isEntry) model.openEntry = hit.card.id else model.page = Page.Journal(StreamFilter(tagId = hit.card.id)) }.padding(horizontal = 20.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(if (hit.card.type == dev.notesapp.core.CardType.tag) Icons.AutoMirrored.Outlined.Label else if (hit.card.type == dev.notesapp.core.CardType.todo) Icons.Outlined.CheckBox else Icons.Outlined.Description, null, Modifier.size(20.dp), tint = Theme.muted)
                    Column {
                        Text(hit.card.displayTitle, fontWeight = FontWeight.SemiBold, color = Theme.text, maxLines = 1)
                        if (hit.snippet.isNotEmpty()) Text(hit.snippet, fontSize = 13.sp, color = Theme.muted, maxLines = 2)
                    }
                }
                HorizontalDivider(color = Theme.line)
            }
            if (query.isNotBlank() && hits.isEmpty()) item { Text("No results for “${query.trim()}”.", Modifier.fillMaxWidth().padding(top = 60.dp), color = Theme.muted, textAlign = TextAlign.Center) }
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
    update(id) { c -> var n = c; c.due?.let { d -> n = n.withDue(DateKey.adding(days, d)) }; c.start?.let { s -> n = n.withStart(DateKey.adding(days, s)) }; n }
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

fun shareFiles(context: android.content.Context, files: List<java.io.File>, mime: String = "*/*") {
    val uris = ArrayList(files.map { Attachments.uriFor(context, it) })
    val send = (if (uris.size == 1) android.content.Intent(android.content.Intent.ACTION_SEND).putExtra(android.content.Intent.EXTRA_STREAM, uris[0])
        else android.content.Intent(android.content.Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(android.content.Intent.EXTRA_STREAM, uris))
        .setType(mime).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(android.content.Intent.createChooser(send, null).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** A row of choices, one picked, as the journal's All · Notes · Todos switch: each a label and the value it picks. */
@Composable
fun <T> Segmented(options: List<Pair<String, T>>, value: T, set: (T) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(Theme.sunken).padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for ((label, v) in options) {
            val on = v == value
            Text(
                label, Modifier.clip(RoundedCornerShape(50)).background(if (on) Theme.raised else Color.Transparent).clickable { set(v) }.padding(horizontal = 12.dp, vertical = 4.dp),
                fontSize = 14.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = if (on) Theme.text else Theme.muted,
            )
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

