package dev.notesapp.app

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.systemGestureExclusion
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Rail
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first

/** How long the handle stays after the page stops scrolling, as the web's on a touch screen. */
private const val AWAKE_MS = 1500L

/**
 * The rail beside a long page, as the web's `ScrollRail` on a touch screen: a handle at the right edge while the page
 * scrolls, held and dragged to go anywhere in it, with the years (or months, or days) down the side and the month or
 * day there shown while it's dragged. Each item is an equal share of the rail, in the order the page shows them; `at`
 * is where the page is, 0 at the top and 1 at the end. Screen readers skip it: the page scrolls as ever.
 */
@Composable
fun RailView(keys: List<String>, name: (String) -> String, at: Float, modifier: Modifier, go: (Float) -> Unit) {
    var height by remember { mutableIntStateOf(0) }
    var drag by remember { mutableStateOf<Float?>(null) }
    var awake by remember { mutableStateOf(false) }
    var heldFrom by remember { mutableFloatStateOf(0f) }
    var moved by remember { mutableFloatStateOf(0f) }
    val latestAt by rememberUpdatedState(at)
    val density = LocalDensity.current
    // Scrolled lately: the handle shows.
    LaunchedEffect(at) {
        awake = true
        delay(AWAKE_MS)
        awake = false
    }
    val marks = remember(keys, height) { Rail.marks(keys, height.toDouble(), name) }
    val scale = remember(keys) { Rail.scale(keys) }
    fun y(f: Float) = with(density) { (f * height).toDp() }
    Box(modifier.fillMaxHeight().width(44.dp).padding(vertical = 8.dp).onSizeChanged { height = it.height }) {
        if (height <= 0) return@Box
        // The marks, while it's dragged.
        if (drag != null) for (mark in marks) {
            val top = y(mark.at.toFloat())
            if (mark.label != null) {
                Text(
                    mark.label!!, Modifier.align(Alignment.TopEnd).wrapContentWidth(Alignment.End, unbounded = true).offset(x = (-40).dp, y = top).shadow(2.dp, RoundedCornerShape(50))
                        .background(Theme.surface, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 2.dp).alpha(0.85f),
                    fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted, maxLines = 1,
                )
            } else {
                Box(Modifier.align(Alignment.TopEnd).offset(x = (-34).dp, y = top - 2.dp).size(4.dp).background(Theme.line, CircleShape))
            }
        }
        val thumb = drag ?: at
        val handle = minOf(22.dp, with(density) { (height / 2f).toDp() })
        if (awake || drag != null) Column(
            Modifier.align(Alignment.TopEnd).offset(y = y(thumb).coerceIn(handle, with(density) { height.toDp() } - handle) - 22.dp)
                .shadow(4.dp, RoundedCornerShape(topStart = 22.dp, bottomStart = 22.dp))
                .background(Theme.surface, RoundedCornerShape(topStart = 22.dp, bottomStart = 22.dp))
                .border(1.dp, Theme.line, RoundedCornerShape(topStart = 22.dp, bottomStart = 22.dp))
                .size(32.dp, 44.dp)
                // At the screen's edge, where a swipe would otherwise be the system's Back.
                .systemGestureExclusion()
                .pointerInput(Unit) {
                    detectVerticalDragGestures(
                        onDragStart = { heldFrom = latestAt; moved = 0f; drag = latestAt; go(latestAt) },
                        onDragEnd = { drag = null },
                        onDragCancel = { drag = null },
                    ) { change, dy ->
                        change.consume()
                        moved += dy
                        // Held, it moves with the finger from where it was, as the web's.
                        val to = (heldFrom + moved / height).coerceIn(0f, 1f)
                        drag = to
                        go(to)
                    }
                },
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        ) {
            Icon(Icons.Outlined.KeyboardArrowUp, null, Modifier.size(12.dp), tint = Theme.muted)
            Icon(Icons.Outlined.KeyboardArrowDown, null, Modifier.size(12.dp), tint = Theme.muted)
        }
        drag?.let { told ->
            if (keys.isNotEmpty()) Text(
                Rail.label(keys[Rail.item(told.toDouble(), keys.size).first], scale, name),
                Modifier.align(Alignment.TopEnd).wrapContentWidth(Alignment.End, unbounded = true).offset(x = (-40).dp, y = y(told).coerceIn(14.dp, with(density) { height.toDp() } - 14.dp) - 12.dp)
                    .shadow(4.dp, RoundedCornerShape(50)).background(Theme.text, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
                fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.bg, maxLines = 1,
            )
        }
    }
}

/**
 * The rail for a lazy list (the journal, the Trash, Links and Files): `keys` is each item's day and `ids` its key in
 * the list, in order; `rowOf` gives an item's row in the list, and `reveal` draws an item that isn't yet (the journal
 * draws only some at a time). Where the page is goes by the item at the reading line, as the web's; a place on the rail
 * goes to its item, as far down the view as the place is down the rail.
 */
@Composable
fun LazyRail(state: LazyListState, keys: List<String>, ids: List<String>, name: (String) -> String, rowOf: (String) -> Int?, modifier: Modifier, reveal: (Int) -> Unit = {}) {
    val indexOf = remember(ids) { ids.withIndex().associate { it.value to it.index } }
    val n = ids.size
    val place by remember(state, indexOf) {
        derivedStateOf {
            val info = state.layoutInfo
            val rows = info.visibleItemsInfo
            if (rows.isEmpty() || n < 2) return@derivedStateOf null
            val viewport = (info.viewportEndOffset - info.viewportStartOffset).toDouble()
            // Rows not drawn are taken as tall as those drawn, on average.
            val average = rows.sumOf { it.size }.toDouble() / rows.size
            val scrollable = info.totalItemsCount * average - viewport
            if (scrollable <= viewport / 2) return@derivedStateOf null
            val fraction = when {
                !state.canScrollBackward -> 0.0
                !state.canScrollForward -> 1.0
                else -> ((state.firstVisibleItemIndex * average + state.firstVisibleItemScrollOffset) / scrollable).coerceIn(0.0, 1.0)
            }
            val line = info.viewportStartOffset + viewport * fraction
            val entries = rows.filter { it.key in indexOf }
            val found = entries.lastOrNull { it.offset <= line } ?: return@derivedStateOf fraction.toFloat()
            val next = entries.getOrNull(entries.indexOf(found) + 1)
            val extent = (next?.let { it.offset - found.offset } ?: found.size).toDouble()
            val down = if (extent > 0) (line - found.offset) / extent else 0.0
            Rail.rowRailAt(indexOf.getValue(found.key as String), 1, down, n).toFloat()
        }
    }
    val at = place ?: return
    val scope = rememberCoroutineScope()
    val latestRowOf by rememberUpdatedState(rowOf)
    var job by remember { mutableStateOf<Job?>(null) }
    RailView(keys, name, at, modifier) { to ->
        job?.cancel()
        job = scope.launch {
            val (index, into) = Rail.item(to.toDouble(), n)
            val id = ids[index]
            var row = latestRowOf(id)
            if (row == null) {
                reveal(index)
                repeat(20) { if (row == null) { withFrameNanos {}; row = latestRowOf(id) } }
            }
            val r = row ?: return@launch
            state.scrollToItem(r)
            val info = state.layoutInfo
            val size = info.visibleItemsInfo.firstOrNull { it.index == r }?.size ?: 0
            val viewport = info.viewportEndOffset - info.viewportStartOffset
            state.scrollBy((into * size - viewport * to).toFloat())
        }
    }
}

/**
 * The rail for a page that lays its items out itself (Photos): `tops` and `bottoms` are where each item is in the
 * scrolled content, in pixels, in order, items side by side in a row sharing its top. A place on the rail goes through
 * the row it falls in, as the web's.
 */
@Composable
fun LaidRail(state: ScrollState, keys: List<String>, tops: List<Float>, bottoms: List<Float>, name: (String) -> String, modifier: Modifier) {
    val n = tops.size
    fun row(index: Int): Triple<Int, Int, Pair<Float, Float>> {
        val top = tops[index]
        var first = index
        while (first > 0 && kotlin.math.abs(tops[first - 1] - top) < 1) first--
        var last = index
        var foot = bottoms[index]
        while (last + 1 < n && kotlin.math.abs(tops[last + 1] - top) < 1) { last++; foot = maxOf(foot, bottoms[last]) }
        val next = tops.getOrNull(last + 1)
        val extent = if (next != null && next > top) next - top else foot - top
        return Triple(first, last - first + 1, top to extent)
    }
    val viewport = state.viewportSize.toDouble()
    val scrollable = state.maxValue.toDouble()
    if (n < 2 || viewport <= 0 || scrollable <= viewport / 2) return
    val scrolled = state.value.toDouble()
    val line = Rail.readingLine(scrolled, scrollable, scrolled, viewport)
    val found = tops.indexOfLast { it <= line }
    val at = if (found < 0) 0f else {
        val (first, count, stretch) = row(found)
        val down = if (stretch.second > 0) (line - stretch.first) / stretch.second else 0.0
        Rail.rowRailAt(first, count, down, n).toFloat()
    }
    val scope = rememberCoroutineScope()
    var job by remember { mutableStateOf<Job?>(null) }
    RailView(keys, name, at, modifier) { to ->
        val (index, into) = Rail.item(to.toDouble(), n)
        val (first, count, stretch) = row(index)
        val y = stretch.first + Rail.intoRow(index, into, first, count) * stretch.second
        job?.cancel()
        job = scope.launch { state.scrollTo(Rail.scrollFor(y, scrollable, 0.0, viewport).toInt()) }
    }
}

/**
 * Where each page was scrolled to, kept while the app runs, so going back to a page (or a view of the journal, a tag or
 * a vault) finds it where it was left, as the web's `scrollPlace` and the Mac's and iPhone's `KeptPlaces`: the row at
 * the top of the screen, by its key, and how far down it was. At the end a page opens at (the newest, at the foot of
 * a chat), nothing is kept, so it opens there again with whatever was written meanwhile. Keys start with the account's ID.
 */
object KeptPlaces {
    data class Place(val key: Any, val offset: Int)

    private val places = mutableMapOf<String, Place>()
    private val pixels = mutableMapOf<String, Int>()

    fun place(key: String) = places[key]
    fun pixels(key: String) = pixels[key]

    /** Keeps where `list` is: the first row on screen whose key `counts`. None found leaves what was. */
    fun keep(key: String, list: LazyListState, chat: Boolean, counts: (Any) -> Boolean) {
        if (if (chat) !list.canScrollForward else list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset == 0) {
            places.remove(key)
            return
        }
        val row = list.layoutInfo.visibleItemsInfo.firstOrNull { it.offset + it.size > 0 && counts(it.key) } ?: return
        places[key] = Place(row.key, row.offset)
    }

    fun keepPixels(key: String, value: Int) {
        if (value > 0) pixels[key] = value else pixels.remove(key)
    }

    /** Follows `list` as it's scrolled, keeping its place under `key`, until the page goes. */
    suspend fun follow(key: String, list: LazyListState, chat: Boolean, counts: (Any) -> Boolean) {
        androidx.compose.runtime.snapshotFlow { list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset }.collect { keep(key, list, chat, counts) }
    }

    /** Scrolls `list` to a kept place, at row `row`. */
    suspend fun goTo(list: LazyListState, row: Int, place: Place) {
        list.scrollToItem(row)
        list.scrollBy(-place.offset.toFloat())
    }
}

/**
 * Opens a list that starts at its top (the Trash, Links, Files) where it was left (`KeptPlaces`), and keeps its place
 * as it's scrolled: `rowOf` finds the row of an item's key, null for rows that aren't items.
 */
@Composable
fun KeepPlace(key: String, list: LazyListState, rowOf: (Any) -> Int?) {
    val latestRowOf by rememberUpdatedState(rowOf)
    LaunchedEffect(key) {
        KeptPlaces.place(key)?.let { kept -> latestRowOf(kept.key)?.let { KeptPlaces.goTo(list, it, kept) } }
        KeptPlaces.follow(key, list, chat = false) { latestRowOf(it) != null }
    }
}

/**
 * Opens a page scrolled as a whole (Photos) where it was left, once it's tall enough to (it lays itself out a moment
 * after it shows), and keeps how far down it is.
 */
@Composable
fun KeepPlace(key: String, scroll: ScrollState) {
    LaunchedEffect(key) {
        KeptPlaces.pixels(key)?.let { y ->
            kotlinx.coroutines.withTimeoutOrNull(1500) { androidx.compose.runtime.snapshotFlow { scroll.maxValue }.first { it >= y } }
            scroll.scrollTo(minOf(y, scroll.maxValue))
        }
        androidx.compose.runtime.snapshotFlow { scroll.value }.collect { KeptPlaces.keepPixels(key, it) }
    }
}
