package dev.notesapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.Title
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.combinedClickable
import dev.notesapp.core.Doc
import dev.notesapp.core.str
import dev.notesapp.core.jobj
import dev.notesapp.core.jarr
import dev.notesapp.core.j
import dev.notesapp.core.get
import dev.notesapp.core.arr
import dev.notesapp.core.Card
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.foundation.layout.widthIn
import dev.notesapp.core.DocText
import dev.notesapp.core.RichText
import dev.notesapp.core.TextStyle
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonElement

/** Colors the editor shows styles in. */
data class EditorColors(val accent: Color, val sunken: Color, val hidden: Color, val muted: Color, val cover: Color? = null)

/** Rich text as the editor shows it: marks as styles, headings large, links tinted, markers quiet. */
fun styled(rich: RichText, c: EditorColors): AnnotatedString = buildAnnotatedString {
    append(rich.text)
    for ((a, b, s) in rich.runs()) {
        s ?: continue
        addStyle(
            SpanStyle(
                fontWeight = if (s.bold) FontWeight.Bold else null,
                fontStyle = if (s.italic) FontStyle.Italic else null,
                fontFamily = if (s.code) Theme.mono else null,
                // Hidden words are covered, as the web draws them, unless shown from the formatting row.
                background = if (s.hidden) (c.cover ?: c.hidden) else if (s.code) c.sunken else Color.Unspecified,
                color = if (s.hidden && c.cover != null) Color.Transparent else if (s.link != null || s.card != null || s.node != null) c.accent else Color.Unspecified,
                textDecoration = listOfNotNull(if (s.strike) TextDecoration.LineThrough else null, if (s.underline || s.link != null) TextDecoration.Underline else null)
                    .takeIf { it.isNotEmpty() }?.let { TextDecoration.combine(it) },
            ),
            a, b,
        )
    }
    // Headings by their markers, a line at a time.
    var start = 0
    for (line in rich.text.split('\n')) {
        DocText.headingLevel(line)?.let { level ->
            addStyle(SpanStyle(fontWeight = FontWeight.Bold, fontSize = when (level) { 1 -> 24.sp; 2 -> 21.sp; else -> 18.sp }), start, start + line.length)
            // Its # marks drawn as nothing, as the web shows a heading.
            addStyle(SpanStyle(fontSize = 1.sp, color = Color.Transparent), start, start + level)
        }
        DocText.taskMarker(line)?.let { task -> if (task.checked) addStyle(SpanStyle(color = c.accent), start + task.indent * 2, start + task.indent * 2 + 1) }
        if (line.startsWith("```")) addStyle(SpanStyle(fontFamily = Theme.mono, color = c.muted), start, start + line.length)
        start += line.length + 1
    }
}

/** A stretch of a page's text, or an attachment between two (a photo or a file), as the Swift app's `DocPart`. */
private data class DocPart(val key: Int, val node: JsonElement? = null, val blocks: List<JsonElement> = emptyList())

/** Whether a page's block shows as itself rather than in the text: a photo, a video, a voice message or a file. */
private fun isAttachment(node: JsonElement) = node["type"].str in setOf("photo", "file")

/** A page as stretches of text and the attachments between them, with text last, to write after them. */
private fun splitPage(content: JsonElement, first: Int = 0): List<DocPart> {
    val parts = mutableListOf<DocPart>()
    val run = mutableListOf<JsonElement>()
    var key = first
    for (block in content["content"].arr.orEmpty()) {
        if (isAttachment(block)) {
            if (run.isNotEmpty()) { parts.add(DocPart(key++, blocks = run.toList())); run.clear() }
            parts.add(DocPart(key++, node = block))
        } else run.add(block)
    }
    parts.add(DocPart(key, blocks = run.toList()))
    return parts
}

private fun pageOf(blocks: List<JsonElement>) = jobj("type" to j("doc"), "content" to jarr(blocks.ifEmpty { listOf(jobj("type" to j("paragraph"))) }))

/**
 * Edits a card body as rich text, as the Swift app's `DocEditor`. With the entry it's in (`card`), its photos, videos,
 * voice messages and files show where they are in the text, as the web's editor shows them, each with its menu (and
 * Remove from the entry, where it can be changed); the stretches of text around them are edited as before, and the
 * page reads back in the same order. Without it, they're named in the text ([Photo], [File: name]).
 */
@Composable
fun DocEditor(content: JsonElement, editable: Boolean, onSave: (JsonElement) -> Unit, modifier: Modifier = Modifier, onTools: ((@Composable () -> Unit)?) -> Unit = {}, placeholder: String = "", card: Card? = null) {
    if (card == null || content["content"].arr.orEmpty().none(::isAttachment)) {
        TextStretch(content, editable, onSave, modifier, onTools, placeholder)
        return
    }
    val save by rememberUpdatedState(onSave)
    var parts by remember { mutableStateOf(splitPage(content)) }
    // Each stretch's text as last saved, by its key.
    val texts = remember { mutableMapOf<Int, JsonElement>() }
    fun page(of: List<DocPart> = parts): JsonElement {
        val out = mutableListOf<JsonElement>()
        for (part in of) {
            part.node?.let { out.add(it); continue }
            val blocks = texts[part.key]?.get("content").arr?.toList() ?: part.blocks
            // A stretch left empty beside an attachment adds nothing.
            if (blocks != listOf(jobj("type" to j("paragraph")))) out += blocks
        }
        return pageOf(out)
    }
    // Changed elsewhere while open, as a voice message's transcript is written in: the attachments take it, by ID.
    LaunchedEffect(content) {
        val latest = content["content"].arr.orEmpty().mapNotNull { n -> n["attrs"]["id"].str?.let { it to n } }.toMap()
        val next = parts.map { p -> p.node?.get("attrs")?.get("id").str?.let(latest::get)?.takeIf { it != p.node }?.let { p.copy(node = it) } ?: p }
        if (next != parts) parts = next
    }
    val media = remember(content) { Doc.media(content) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (part in parts) androidx.compose.runtime.key(part.key) {
            val node = part.node
            if (node != null) {
                InlineAttachment(node, card, media, if (editable) ({
                    // Out, and the text around it joined, as the web's when one is selected and deleted.
                    val joined = page(parts.filter { it.key != part.key })
                    texts.clear()
                    parts = splitPage(joined, (parts.maxOf { it.key }) + 1)
                    save(joined)
                }) else null)
            } else {
                TextStretch(pageOf(part.blocks), editable, { doc -> texts[part.key] = doc; save(page()) }, Modifier, onTools, if (parts.size == 1) placeholder else "", minHeight = if (part == parts.last()) 80.dp else 0.dp)
            }
        }
    }
}

/**
 * A photo, a video, a voice message or a file where it is in an open entry's text, as the web's editor shows it: a
 * photo or a video whole, opening full screen; a voice message's player; a file's chip. A long press on a photo gives
 * its menu; a file or a voice message has a menu button beside it, where the entry can be changed.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun InlineAttachment(node: JsonElement, card: Card, media: List<Doc.Media>, remove: (() -> Unit)?) {
    val one = pageOf(listOf(node))
    val m = remember(node) { Doc.media(one).firstOrNull() }
    val file = remember(node) { Doc.files(one).firstOrNull() }
    var menu by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf(false) }
    androidx.compose.foundation.layout.Box(Modifier.widthIn(max = 560.dp)) {
        if (m != null) {
            ShapedThumb(m, card.vaultId, 180.dp, alone = true, modifier = Modifier.combinedClickable(onClick = { viewing = true }, onLongClick = { menu = true }))
            androidx.compose.material3.DropdownMenu(menu, { menu = false }) {
                PhotoMenu(m.id, card) { menu = false }
                remove?.let { r -> androidx.compose.material3.DropdownMenuItem(text = { Text("Remove from the entry") }, onClick = { menu = false; r() }) }
            }
        } else if (file != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.foundation.layout.Box(Modifier.weight(1f, fill = false)) { if (file.isAudio) VoicePlayer(file, card.vaultId, card) else FileChip(file, card.vaultId) }
                if (remove != null) androidx.compose.foundation.layout.Box {
                    androidx.compose.material3.IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = Theme.muted) }
                    androidx.compose.material3.DropdownMenu(menu, { menu = false }) {
                        androidx.compose.material3.DropdownMenuItem(text = { Text("Remove from the entry") }, onClick = { menu = false; remove() })
                    }
                }
            }
        }
    }
    if (viewing && m != null) MediaViewer(media, m.id, card.vaultId) { viewing = false }
}

/**
 * Edits a stretch of a card body as rich text, as the Swift app's `DocEditor`. Lists and checklists go on when Return
 * is pressed, and end on an empty item; a row of buttons over the keyboard marks the words picked or the line, for the
 * stretch last typed in.
 */
@Composable
private fun TextStretch(content: JsonElement, editable: Boolean, onSave: (JsonElement) -> Unit, modifier: Modifier = Modifier, onTools: ((@Composable () -> Unit)?) -> Unit = {}, placeholder: String = "", minHeight: androidx.compose.ui.unit.Dp = 200.dp) {
    val model = LocalModel.current
    val start = remember { DocText.from(content, model.index.titleOf) }
    var rich by remember { mutableStateOf(start.text) }
    var value by remember { mutableStateOf(TextFieldValue(start.text.text)) }
    var dirty by remember { mutableStateOf(0) }
    val save by rememberUpdatedState(onSave)
    var showHidden by remember { mutableStateOf(false) }
    val colors = EditorColors(Theme.accent, Theme.sunken, Theme.muted.copy(alpha = 0.3f), Theme.muted, Theme.muted.copy(alpha = 0.55f).takeIf { !showHidden })

    fun saveNow() { if (editable && dirty > 0) { save(DocText(rich, start.stash).doc()); dirty = 0 } }
    LaunchedEffect(dirty) { if (dirty > 0) { delay(400); saveNow() } }
    DisposableEffect(Unit) { onDispose { saveNow() } }

    fun set(next: RichText, selection: TextRange) {
        rich = next
        value = TextFieldValue(next.text, selection)
        dirty++
    }

    if (!editable) {
        SelectionContainer(modifier) { Text(styled(rich, colors), color = Theme.text, fontSize = 17.sp, lineHeight = 24.sp) }
        return
    }

    /** The start and end of the line holding the cursor. */
    fun line(): Pair<Int, Int> {
        val t = rich.text
        val at = value.selection.start.coerceIn(0, t.length)
        val s = t.lastIndexOf('\n', at - 1) + 1
        val e = t.indexOf('\n', at).let { if (it < 0) t.length else it }
        return s to e
    }

    fun toggleMarker(marker: String) {
        val (s, e) = line()
        val text = rich.text.substring(s, e)
        val existing = DocText.taskMarker(text)?.let { text.take(it.length) } ?: DocText.listMarker(text)?.let { text.take(it.length) }
            ?: listOf("## ", "# ", "### ", "> ").firstOrNull { text.startsWith(it) }
        var next = rich
        var shift = 0
        if (existing != null) {
            next = next.replace(s, s + existing.length, "")
            shift -= existing.length
            val same = existing == marker || DocText.listMarker(existing)?.ordered?.let { it == DocText.listMarker(marker)?.ordered } == true
            if (same) { set(next, TextRange(maxOf(s, value.selection.start + shift))); return }
        }
        next = next.replace(s, s, marker)
        shift += marker.length
        set(next, TextRange(value.selection.start + shift))
    }

    fun tick() {
        val (s, e) = line()
        val task = DocText.taskMarker(rich.text.substring(s, e)) ?: return
        val at = s + task.indent * 2
        set(rich.replace(at, at + 1, if (task.checked) "☐" else "☑"), value.selection)
    }

    fun mark(has: (TextStyle) -> Boolean, change: (TextStyle, Boolean) -> TextStyle) {
        val sel = value.selection
        if (sel.collapsed) return
        set(rich.toggle(sel.min, sel.max, has, change), sel)
    }

    /** After Return on a list item, starts the next item, or ends the list if the item was empty. */
    fun changed(next: TextFieldValue) {
        val old = rich.text
        var edited = rich.edited(next.text)
        var selection = next.selection
        if (next.text.length == old.length + 1 && selection.collapsed) {
            val at = selection.start - 1
            if (at >= 0 && next.text[at] == '\n') {
                val s = next.text.lastIndexOf('\n', at - 1) + 1
                val line = next.text.substring(s, at)
                val task = DocText.taskMarker(line)
                val list = DocText.listMarker(line)
                if (task != null || list != null) {
                    val length = task?.length ?: list!!.length
                    if (line.substring(length).isBlank()) {
                        // An empty item: end the list.
                        edited = edited.replace(s, at + 1, "")
                        selection = TextRange(s)
                    } else {
                        val marker = if (task != null) "  ".repeat(task.indent) + "☐ " else "  ".repeat(list!!.indent) + if (list.ordered) "${list.number + 1}. " else "• "
                        edited = edited.replace(at + 1, at + 1, marker)
                        selection = TextRange(at + 1 + marker.length)
                    }
                }
            }
        }
        // `[] ` typed at the start of a line becomes a checkbox, `- ` a bullet, as in the web's editor.
        if (edited.text.length > old.length && selection.collapsed) {
            var p = 0
            while (p < old.length && old[p] == edited.text[p]) p++
            val at = selection.start
            val s = edited.text.lastIndexOf('\n', at - 1) + 1
            val e = edited.text.indexOf('\n', s).let { if (it < 0) edited.text.length else it }
            DocText.typedMarker(edited.text.substring(s, e))?.let { (typed, marker) ->
                if (p <= s + typed.length && at >= s + typed.length) {
                    edited = edited.replace(s, s + typed.length, marker)
                    selection = TextRange(at - typed.length + marker.length)
                }
            }
        }
        rich = edited
        value = next.copy(text = edited.text, selection = selection)
        if (edited.text != old) dirty++
    }

    val tools: @Composable () -> Unit = {
        Row(
            Modifier.fillMaxWidth().background(Theme.surface).horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Tool(Icons.Outlined.FormatBold, "Bold") { mark({ it.bold }) { s, on -> s.copy(bold = on) } }
            Tool(Icons.Outlined.FormatItalic, "Italic") { mark({ it.italic }) { s, on -> s.copy(italic = on) } }
            Tool(Icons.Outlined.FormatStrikethrough, "Strikethrough") { mark({ it.strike }) { s, on -> s.copy(strike = on) } }
            Tool(Icons.Outlined.Code, "Code") { mark({ it.code }) { s, on -> s.copy(code = on) } }
            Tool(Icons.Outlined.VisibilityOff, "Hide") { mark({ it.hidden }) { s, on -> s.copy(hidden = on) } }
            Tool(Icons.Outlined.Checklist, "Checklist") { toggleMarker("☐ ") }
            Tool(Icons.Outlined.CheckBox, "Tick") { tick() }
            Tool(Icons.AutoMirrored.Outlined.FormatListBulleted, "Bulleted list") { toggleMarker("• ") }
            Tool(Icons.Outlined.FormatListNumbered, "Numbered list") { toggleMarker("1. ") }
            Tool(Icons.Outlined.Title, "Heading") { toggleMarker("## ") }
            Tool(Icons.Outlined.FormatQuote, "Quote") { toggleMarker("> ") }
            Tool(Icons.Outlined.Visibility, if (showHidden) "Cover hidden words" else "Show hidden words") { showHidden = !showHidden }
        }
    }
    DisposableEffect(Unit) { onDispose { onTools(null) } }
    // The formatting row is offered to the sheet, which shows it from its Aa.
    LaunchedEffect(showHidden) { onTools(tools) }
    Column(modifier) {
        BasicTextField(
            value, ::changed, Modifier.fillMaxWidth().heightIn(min = minHeight).onFocusChanged { if (it.isFocused) onTools(tools) },
            decorationBox = { inner -> androidx.compose.foundation.layout.Box { if (value.text.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = Theme.muted.copy(alpha = 0.7f), fontSize = 17.sp); inner() } },
            textStyle = androidx.compose.ui.text.TextStyle(color = Theme.text, fontSize = 17.sp, lineHeight = 24.sp),
            cursorBrush = SolidColor(Theme.accent),
            visualTransformation = { _ -> TransformedText(styled(rich, colors), OffsetMapping.Identity) },
        )
    }
}

@Composable
private fun Tool(icon: ImageVector, label: String, action: () -> Unit) {
    Icon(icon, label, Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = action).padding(8.dp).size(20.dp), tint = Theme.text)
}
