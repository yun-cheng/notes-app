package dev.notesapp.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Card
import dev.notesapp.core.DateKey
import dev.notesapp.core.Doc
import dev.notesapp.core.Stream
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.StreamLabels
import kotlinx.coroutines.launch

/** What entries hold on one day, for the Photos, Links and Files pages: each thing with the entry it's in. */
data class HeldDay<T>(val day: String, val items: List<Pair<T, Card>>)

/**
 * What entries hold, as the web's `entryDays`: the journal's entries the filter leaves, newest first, by the day each was
 * written; each thing in an entry's pages once, and with `once`, a thing in two entries (a template's copy) once, with
 * the newer.
 */
fun <T> heldDays(model: AppModel, filter: StreamFilter, once: Boolean, id: (T) -> String, take: (Card) -> List<T>): List<HeldDay<T>> {
    val cards = Stream.items(model.index, filter.copy(sort = StreamFilter.Sort.Newest), model.today, model.sharedInto).map { it.card }
        .sortedWith(compareByDescending<Card> { it.createdAt }.thenBy { it.id })
    val seen = mutableSetOf<String>()
    val days = mutableListOf<Pair<String, MutableList<Pair<T, Card>>>>()
    for (card in cards) {
        val mine = mutableSetOf<String>()
        val found = take(card).filter { id(it) !in seen && mine.add(id(it)) }
        if (found.isEmpty()) continue
        val day = Stream.entryDay(card)
        if (days.lastOrNull()?.first != day) days.add(day to mutableListOf())
        for (t in found) {
            if (once) seen.add(id(t))
            days.last().second.add(t to card)
        }
    }
    return days.map { HeldDay(it.first, it.second) }
}

/** "17 photos and 2 videos, in 12 entries", "3 links, in 2 entries". */
fun countLine(what: String, entries: Int) = "$what, in ${if (entries == 1) "1 entry" else "$entries entries"}"

/** The library pages' filter row, as the web's: a switch of their own first, then when the entries were written, and the sidebar's tag and vault. */
@Composable
fun LibraryFilterRow(filter: StreamFilter, set: (StreamFilter) -> Unit, lead: @Composable () -> Unit = {}) {
    val model = LocalModel.current
    var pickDates by remember { mutableStateOf(false) }
    Column {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            lead()
            FilterChip(filter.`when`?.let { StreamLabels.`when`(it, model.today) } ?: "Written", filter.`when` != null, { set(filter.copy(`when` = null)) }) { close ->
                DropdownMenuItem(text = { Text("Written today") }, onClick = { set(filter.copy(`when` = "today")); close() })
                DropdownMenuItem(text = { Text("Past 7 days") }, onClick = { set(filter.copy(`when` = "week")); close() })
                DropdownMenuItem(text = { Text("Past 30 days") }, onClick = { set(filter.copy(`when` = "month")); close() })
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Pick dates…") }, onClick = { close(); pickDates = true })
            }
            filter.tagId?.let { SetChip(model.card(it)?.displayTitle ?: "Tag", androidx.compose.material.icons.Icons.Outlined.Label) { set(filter.copy(tagId = null)) } }
            filter.vaultId?.let { SetChip(model.vault(it)?.name ?: "Vault", androidx.compose.material.icons.Icons.Outlined.Inventory2) { set(filter.copy(vaultId = null)) } }
        }
        HorizontalDivider(color = Theme.line)
    }
    if (pickDates) DatesDialog(filter, null, set) { pickDates = false }
}

/**
 * A page listing what entries hold, newest first under the day each entry was written, each with its entry named
 * under it, pressed to open the entry, as the web's `HeldList`; a count over it, and its own search.
 */
@Composable
fun <T> HeldList(
    title: String, noun: Pair<String, String>, days: List<HeldDay<T>>, filter: StreamFilter, setFilter: (StreamFilter) -> Unit, filtered: Boolean,
    text: (T) -> String, empty: String, emptyFiltered: String, openDrawer: (() -> Unit)?, id: (T) -> String, lead: @Composable () -> Unit = {}, row: @Composable (T, Card) -> Unit,
) {
    val model = LocalModel.current
    var query by remember { mutableStateOf("") }
    var searching by remember { mutableStateOf(false) }
    val q = query.trim()
    val hits = if (q.isEmpty()) null else remember(q, model.index, model.readySearch) { model.searchFor(q).map { it.card.id }.toSet() }
    val shown = days.map { d -> d.copy(items = d.items.filter { hits == null || it.second.id in hits || text(it.first).contains(q, ignoreCase = true) }) }.filter { it.items.isNotEmpty() }
    val all = shown.flatMap { it.items }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar(title, openDrawer, eye = false) {
            androidx.compose.material3.IconButton(onClick = { searching = !searching; if (!searching) query = "" }) { Icon(androidx.compose.material.icons.Icons.Outlined.Search, "Search ${noun.second}", tint = Theme.text) }
        }
        if (searching) PageSearchField(query, { query = it }) { searching = false; query = "" }
        LibraryFilterRow(filter, setFilter, lead)
        if (all.isEmpty()) {
            Text(if (q.isNotEmpty()) "No ${noun.second} here have “$q” in them or their entries." else if (filtered) emptyFiltered else empty, Modifier.fillMaxWidth().padding(24.dp), color = Theme.muted, textAlign = TextAlign.Center)
        } else Box(Modifier.fillMaxSize()) {
            val list = androidx.compose.foundation.lazy.rememberLazyListState()
            // Each one's key in the list, the thing and its entry (a link can be in two), and its row there.
            val keyOf = { t: T, card: Card -> "held:${id(t)}:${card.id}" }
            val ids = shown.flatMap { d -> d.items.map { (t, card) -> keyOf(t, card) } }
            val rowOf = remember(ids, shown.size) {
                val m = mutableMapOf<String, Int>()
                var i = 1
                for (d in shown) { i++; for ((t, card) in d.items) m[keyOf(t, card)] = i++ }
                m
            }
            KeepPlace("${model.accountId} $title", list) { rowOf[it as? String] }
            LazyColumn(Modifier.fillMaxSize(), list, contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
            item { Text(countLine(if (all.size == 1) "1 ${noun.first}" else "${all.size} ${noun.second}", all.map { it.second.id }.toSet().size), Modifier.padding(bottom = 8.dp), color = Theme.muted, fontSize = 14.sp) }
            for (day in shown) {
                item(key = "day:${day.day}") { Text(DateKey.relativeDay(day.day, model.today), Modifier.padding(top = 12.dp, bottom = 6.dp), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Theme.text) }
                for ((t, card) in day.items) item(key = keyOf(t, card)) {
                    Column(Modifier.padding(bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        row(t, card)
                        Row(Modifier.clickable { model.openEntry = card.id }.padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(card.displayTitle.ifEmpty { "Untitled" }, fontSize = 12.sp, color = Theme.muted, maxLines = 1)
                            Icon(Icons.Outlined.ChevronRight, "Open the entry", Modifier.size(14.dp), tint = Theme.muted)
                        }
                    }
                }
            }
            }
            // Each one by the day its entry was written, as the web's.
            LazyRail(list, shown.flatMap { d -> d.items.map { d.day } }, ids, { DateKey.relativeDay(it, model.today) }, { rowOf[it] }, Modifier.align(Alignment.CenterEnd))
        }
    }
}

/** Every web link in the journal's entries, as the cards under an entry show them but with each one's whole address. */
@Composable
fun LinksPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var filter by remember { mutableStateOf(StreamFilter()) }
    val days = heldDays(model, filter, once = false, id = { it }) { card -> (listOf(card.content) + card.morePages).flatMap { Doc.linkUrls(it) }.distinct() }
    HeldList("Links", "link" to "links", days, filter, { filter = it }, filter.isFiltered, { it },
        "No links yet. Paste or type a web address into an entry and it shows here.", "No links here match. Take a filter off above, or pick another.", openDrawer, id = { it },
    ) { url, card -> LinkCard(url, compact = false, preview = model.vault(card.vaultId)?.isEncrypted == false, address = true) }
}

/** What sort of file one is, for the Files page's switch, as the web's `fileKind`. */
enum class FileKind(val label: String) {
    pdf("PDFs"), document("Documents"), spreadsheet("Spreadsheets"), slides("Slides"), audio("Audio"), image("Images"), video("Video"), archive("Archives"), other("Other");

    companion object {
        private val byExtension: Map<String, FileKind> = buildMap {
            for ((kind, exts) in listOf(
                pdf to "pdf", document to "doc docx odt rtf txt md markdown pages epub tex", spreadsheet to "csv tsv xls xlsx xlsm ods numbers", slides to "ppt pptx odp key",
                audio to "mp3 m4a wav aac oga ogg opus flac aif aiff weba", image to "jpg jpeg png gif webp heic heif avif svg tif tiff bmp", video to "mp4 m4v mov webm mkv avi",
                archive to "zip gz tgz tar 7z rar bz2 xz",
            )) for (e in exts.split(" ")) put(e, kind)
        }

        fun of(file: Doc.FileInfo): FileKind {
            val ext = file.name.substringAfterLast('.', "").lowercase().takeIf { it.isNotEmpty() && file.name.contains('.') }
            val mime = (file.mime ?: "").substringBefore(';').trim().lowercase()
            val top = mime.substringBefore('/')
            val sub = mime.substringAfter('/', "")
            if (top == "audio") return audio
            if (top == "video") return video
            ext?.let { byExtension[it] }?.let { return it }
            if (sub == "pdf") return pdf
            if (top == "image") return image
            if (listOf("spreadsheet", "excel", "csv").any { it in sub }) return spreadsheet
            if (listOf("presentation", "powerpoint").any { it in sub }) return slides
            if (listOf("zip", "compressed", "tar", "rar", "7z").any { it in sub }) return archive
            if (top == "text" || listOf("wordprocessing", "msword", "rtf", "opendocument.text", "epub").any { it in sub }) return document
            return other
        }
    }
}

/** Every file attached to the journal's entries, as chips, and a voice message as it plays in its entry; videos are on the Photos page. */
@Composable
fun FilesPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var filter by remember { mutableStateOf(StreamFilter()) }
    var kind by remember { mutableStateOf<FileKind?>(null) }
    val every = heldDays(model, filter, once = true, id = { it.id }) { card -> (listOf(card.content) + card.morePages).flatMap { Doc.files(it) }.filter { !it.isVideo } }
    val held = every.flatMap { d -> d.items.map { FileKind.of(it.first) } }.toSet()
    val kinds = FileKind.entries.filter { it in held || it == kind }
    val days = kind?.let { k -> every.map { d -> d.copy(items = d.items.filter { FileKind.of(it.first) == k }) }.filter { it.items.isNotEmpty() } } ?: every
    HeldList("Files", "file" to "files", days, filter, { filter = it }, filter.isFiltered || kind != null, { it.name },
        "No files yet. Attach one to an entry with the paperclip, or by sharing it to the app.",
        kind?.let { "No ${if (it == FileKind.audio || it == FileKind.video) "${it.label.lowercase()} files" else it.label.lowercase()} here. Pick All above, or take a filter off." } ?: "No files here match. Take a filter off above, or pick another.",
        openDrawer, id = { it.id },
        lead = { if (kinds.size > 1 || kind != null) Segmented(listOf<Pair<String, FileKind?>>("All" to null) + kinds.map { it.label to it }, kind) { kind = it } },
    ) { file, card -> FileChip(file, card.vaultId) }
}

/** Each photo's width over its height, once it's been shown, kept while the app runs, so the Photos page lays out at once next time. */
object PhotoShapes {
    val ratios = mutableStateMapOf<String, Float>()
}

/**
 * Days of photos, each as its width over its height, laid out as the web's `layoutPhotos`: whole photos in rows of
 * about one height that fill the width; a day that fits in what's left of a row goes on beside the one before, under its
 * own heading.
 */
object PhotoLayout {
    data class Box(val x: Float = 0f, val y: Float = 0f, val w: Float = 0f, val h: Float = 0f)
    data class Options(val width: Float, val row: Float, val gap: Float, val dayGap: Float, val head: Float)

    fun options(width: Float) = if (width < 600) Options(width, 120f, 3f, 12f, 40f) else Options(width, 200f, 4f, 16f, 44f)

    fun layout(days: List<List<Float>>, o: Options): Triple<List<List<Box>>, List<Box>, Float> {
        data class Item(val d: Int, val i: Int, val r: Float)
        val W = maxOf(1f, o.width)
        val H = o.row
        fun gaps(line: List<Item>) = (1 until line.size).sumOf { k -> (if (line[k].d == line[k - 1].d) o.gap else o.dayGap).toDouble() }.toFloat()
        fun sumR(line: List<Item>) = line.sumOf { it.r.toDouble() }.toFloat()
        fun widthAt(line: List<Item>, h: Float) = sumR(line) * h + gaps(line)
        fun fitted(line: List<Item>) = (W - gaps(line)) / sumR(line)
        val lines = mutableListOf<Pair<List<Item>, Float>>()
        var line = mutableListOf<Item>()
        fun close(h: Float) { if (line.isNotEmpty()) lines.add(line.toList() to h); line = mutableListOf() }
        fun closeShort() { if (line.isNotEmpty()) close(if (widthAt(line, H) >= W * 0.8f) fitted(line) else H) }
        days.forEachIndexed { d, ratios ->
            val items = ratios.mapIndexed { i, r -> Item(d, i, if (r > 0 && r.isFinite()) r else 1f) }
            if (items.isEmpty()) return@forEachIndexed
            if (line.isNotEmpty()) {
                if (widthAt(line + items, H) <= W) { line.addAll(items); return@forEachIndexed }
                closeShort()
            }
            for (item in items) {
                val next = line + item
                if (line.isNotEmpty() && widthAt(next, H) > W) {
                    val shrunk = fitted(next)
                    val grown = fitted(line)
                    if (kotlin.math.abs(shrunk - H) <= kotlin.math.abs(grown - H)) { line = next.toMutableList(); close(shrunk); continue }
                    close(grown)
                    line = mutableListOf(item)
                } else line = next.toMutableList()
                if (line.size == 1 && widthAt(line, H) > W) close(fitted(line))
            }
        }
        if (line.isNotEmpty()) close(if (widthAt(line, H) > W) fitted(line) else H)
        val tiles = days.map { MutableList(it.size) { Box() } }
        val heads = MutableList(days.size) { Box() }
        var y = 0f
        lines.forEachIndexed { n, (items, h) ->
            if (n > 0) y += o.gap
            val top = if (items.any { it.i == 0 }) y + o.head else y
            var x = 0f
            items.forEachIndexed { k, it ->
                if (k > 0) x += if (it.d == items[k - 1].d) o.gap else o.dayGap
                val w = it.r * h
                tiles[it.d][it.i] = Box(x, top, w, h)
                if (it.i == 0) heads[it.d] = Box(x, y, 0f, o.head)
                if (items.any { o2 -> o2.d == it.d && o2.i == 0 }) heads[it.d] = heads[it.d].copy(w = x + w - heads[it.d].x)
                x += w
            }
            y = top + h
        }
        return Triple(tiles, heads, y)
    }
}

/**
 * Every photo and video in the journal's entries, as the web app's Photos page: whole, in rows that fill the width
 * under the day each entry was written, a day beside the one before when it fits; a count of them over it; opening full
 * screen to page through them all; picked to share. A switch shows them all, the photos alone or the videos alone.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PhotosPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val context = LocalContext.current
    var kind by remember { mutableStateOf("All") }
    var filter by remember { mutableStateOf(StreamFilter()) }
    var viewing by remember { mutableStateOf<String?>(null) }
    var picked by remember { mutableStateOf(setOf<String>()) }
    val days = heldDays(model, filter, once = true, id = { it.id }) { card ->
        (listOf(card.content) + card.morePages).flatMap { Doc.media(it) }.filter { m -> !((kind == "Photos" && m is Doc.Media.Video) || (kind == "Videos" && m is Doc.Media.Photo)) }
    }
    val all = days.flatMap { it.items }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar(if (picked.isEmpty()) "Photos" else "${picked.size} picked", openDrawer, eye = false) {
            if (picked.isNotEmpty()) {
                TextButton(onClick = {
                    val chosen = all.filter { it.first.id in picked }
                    model.scope.launch {
                        val files = chosen.mapNotNull { (m, _) -> Attachments.fileFor(m.id, if (m is Doc.Media.Video) m.file.name else "Photo ${m.id.take(8)}.jpg", model) }
                        if (files.isNotEmpty()) shareFiles(context, files)
                    }
                }) { Text("Share") }
                TextButton(onClick = { picked = emptySet() }) { Text("Done") }
            }
        }
        LibraryFilterRow(filter, { filter = it }) { Segmented(listOf("All", "Photos", "Videos").map { it to it }, kind) { kind = it } }
        if (all.isEmpty()) {
            Text(if (filter.isFiltered || kind != "All") "No photos here match. Take a filter off above, or pick another." else "No photos yet. Add one to an entry with the photo button.", Modifier.fillMaxWidth().padding(24.dp), color = Theme.muted, textAlign = TextAlign.Center)
            return@Column
        }
        val scroll = rememberScrollState()
        KeepPlace("${model.accountId} photos", scroll)
        // Where the photos' box is in the scrolled content, and each photo there, in pixels, for the rail.
        var content by remember { mutableStateOf<androidx.compose.ui.layout.LayoutCoordinates?>(null) }
        var boxTop by remember { mutableStateOf(0f) }
        var laidTiles by remember { mutableStateOf(emptyList<PhotoLayout.Box>()) }
        val density = androidx.compose.ui.platform.LocalDensity.current.density
        // The stretch of the scrolled content near what's in view, in pixels: only photos in it are drawn, as on the
        // web, since thousands at once each load and decode their picture. It moves in steps of half a screen.
        val near by remember {
            derivedStateOf {
                val screen = scroll.viewportSize.coerceAtLeast(1).toFloat()
                val step = maxOf(200f * density, screen / 2)
                kotlin.math.floor((scroll.value - screen * 1.5f) / step) * step to kotlin.math.ceil((scroll.value + screen * 2.5f) / step) * step
            }
        }
        Box(Modifier.weight(1f)) {
        Column(Modifier.verticalScroll(scroll).onGloballyPositioned { content = it }.padding(16.dp)) {
            Text(countLine(mediaCount(all.map { it.first }), all.map { it.second.id }.toSet().size), Modifier.padding(bottom = 4.dp), color = Theme.muted, fontSize = 14.sp)
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val width = maxWidth.value
                val ratios = days.map { d -> d.items.map { (m, _) -> PhotoShapes.ratios[m.id] ?: (m as? Doc.Media.Photo)?.ratio?.toFloat() ?: (if (m is Doc.Media.Video && (m.file.height ?: 0.0) > 0) (m.file.width ?: 1.0).toFloat() / m.file.height!!.toFloat() else 1f) } }
                val (tiles, heads, height) = PhotoLayout.layout(ratios, PhotoLayout.options(width))
                laidTiles = tiles.flatten()
                // In bands no taller than BAND, each starting with a day below all that's above it: one box as tall as
                // thousands of photos is more than a layout can say (its constraints top out at about 260,000 pixels).
                val bands = remember(heads, tiles, height) {
                    val starts = mutableListOf(0)
                    var top = 0f
                    var foot = 0f
                    heads.forEachIndexed { d, head ->
                        if (d > 0 && head.y >= foot && head.y - top > BAND) { starts.add(d); top = head.y }
                        foot = maxOf(foot, head.y + head.h, tiles[d].maxOfOrNull { it.y + it.h } ?: 0f)
                    }
                    starts.mapIndexed { k, first -> val next = starts.getOrNull(k + 1); Triple(first, next ?: heads.size, if (k == 0) 0f else heads[first].y) to (next?.let { heads[it].y } ?: height) }
                }
                Column(Modifier.fillMaxWidth().onGloballyPositioned { box -> content?.let { boxTop = it.localPositionOf(box, androidx.compose.ui.geometry.Offset.Zero).y } }) {
                    val (from, to) = near
                    // Where a stretch of the laid-out photos is in the scrolled content, and whether it's near the screen.
                    fun shown(y: Float, h: Float) = boxTop + (y + h) * density >= from && boxTop + y * density <= to
                    for ((span, bottom) in bands) {
                        val (firstDay, endDay, top) = span
                        Box(Modifier.fillMaxWidth().height((bottom - top).dp)) {
                            if (shown(top, bottom - top)) for (d in firstDay until endDay) {
                                val day = days[d]
                                val head = heads[d]
                                if (shown(head.y, tiles[d].maxOfOrNull { it.y + it.h - head.y } ?: head.h)) {
                                    Row(Modifier.offset(head.x.dp, (head.y - top).dp).width(maxOf(head.w, 120f).dp).height(head.h.dp).padding(bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
                                        Text(DateKey.relativeDay(day.day, model.today), Modifier.clickable {
                                            val ids = day.items.map { it.first.id }
                                            if (picked.isNotEmpty()) picked = if (ids.all { it in picked }) picked - ids.toSet() else picked + ids
                                        }, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = Theme.text, maxLines = 1)
                                    }
                                    day.items.forEachIndexed { i, (m, card) ->
                                        val b = tiles[d][i]
                                        if (shown(b.y, b.h)) key(m.id) {
                                            var menu by remember { mutableStateOf(false) }
                                            Box(Modifier.offset(b.x.dp, (b.y - top).dp).size(b.w.dp, b.h.dp)) {
                                                FillThumb(m, card.vaultId, Modifier.fillMaxSize().combinedClickable(onClick = { if (picked.isEmpty()) viewing = m.id else picked = if (m.id in picked) picked - m.id else picked + m.id }, onLongClick = { menu = true }))
                                                if (picked.isNotEmpty()) Icon(if (m.id in picked) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, Modifier.align(Alignment.TopStart).padding(6.dp).size(22.dp), tint = Color.White)
                                                DropdownMenu(menu, { menu = false }) {
                                                    DropdownMenuItem(text = { Text("Pick") }, onClick = { menu = false; picked = picked + m.id })
                                                    PhotoMenu(m.id, card) { menu = false }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Each photo by the day its entry was written, as the web's.
        LaidRail(scroll, days.flatMap { d -> d.items.map { d.day } }, laidTiles.map { boxTop + it.y * density }, laidTiles.map { boxTop + (it.y + it.h) * density },
            { DateKey.relativeDay(it, model.today) }, Modifier.align(Alignment.CenterEnd))
        }
    }
    viewing?.let { start -> MediaViewer(all.map { it.first }, start, all.firstOrNull { it.first.id == start }?.second?.vaultId ?: "", all.associate { it.first.id to it.second }) { viewing = null } }
}

/** The tallest band of the Photos page's layout, in points: see `bands` there. */
private const val BAND = 20_000f

/** A photo or a video's still filling its tile, cut to its shape; its shape kept once it's seen. */
@Composable
fun FillThumb(media: Doc.Media, vaultId: String, modifier: Modifier) {
    val model = LocalModel.current
    val id = when (media) { is Doc.Media.Photo -> media.id; is Doc.Media.Video -> media.file.poster ?: Doc.posterId(media.file.id) }
    val image by produceState<android.graphics.Bitmap?>(null, id) {
        value = Attachments.bitmap(id, model, 800)
        value?.let { if (it.height > 0) PhotoShapes.ratios[media.id] = it.width.toFloat() / it.height }
    }
    Box(modifier.clip(RoundedCornerShape(6.dp)).background(Theme.sunken), contentAlignment = Alignment.Center) {
        val b = image
        if (b != null) androidx.compose.foundation.Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(Icons.Outlined.Photo, null, tint = Theme.muted)
        if (media is Doc.Media.Video) VideoMark(media.file.duration, Modifier.align(Alignment.TopEnd))
    }
}
