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
import dev.notesapp.core.Doc
import dev.notesapp.core.DocText
import dev.notesapp.core.RichText
import dev.notesapp.core.TextStyle
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonElement

/** Colors the editor shows styles in. */
data class EditorColors(val accent: Color, val sunken: Color, val hidden: Color, val muted: Color)

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
                background = if (s.hidden) c.hidden else if (s.code) c.sunken else Color.Unspecified,
                color = if (s.link != null || s.card != null || s.node != null) c.accent else Color.Unspecified,
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
        }
        if (line.startsWith("```")) addStyle(SpanStyle(fontFamily = Theme.mono, color = c.muted), start, start + line.length)
        start += line.length + 1
    }
}

/**
 * Edits a card body as rich text, as the Swift app's `DocEditor`. Lists and checklists go on when Return is pressed,
 * and end on an empty item; a row of buttons over the keyboard marks the words picked or the line.
 */
@Composable
fun DocEditor(content: JsonElement, editable: Boolean, onSave: (JsonElement) -> Unit, modifier: Modifier = Modifier, onTools: ((@Composable () -> Unit)?) -> Unit = {}) {
    val model = LocalModel.current
    val start = remember { DocText.from(content, model.index.titleOf) }
    var rich by remember { mutableStateOf(start.text) }
    var value by remember { mutableStateOf(TextFieldValue(start.text.text)) }
    var dirty by remember { mutableStateOf(0) }
    val save by rememberUpdatedState(onSave)
    val colors = EditorColors(Theme.accent, Theme.sunken, Theme.muted.copy(alpha = 0.3f), Theme.muted)

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
        }
    }
    DisposableEffect(Unit) { onDispose { onTools(null) } }
    Column(modifier) {
        BasicTextField(
            value, ::changed, Modifier.fillMaxWidth().heightIn(min = 200.dp).onFocusChanged { onTools(if (it.isFocused) tools else null) },
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
