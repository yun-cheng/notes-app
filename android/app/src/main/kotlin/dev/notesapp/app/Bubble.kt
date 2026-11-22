package dev.notesapp.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Comment
import androidx.compose.material.icons.outlined.AddReaction
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FileCopy
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import dev.notesapp.core.Card
import dev.notesapp.core.CardType
import dev.notesapp.core.DateKey
import dev.notesapp.core.Doc
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.TimeKey
import dev.notesapp.core.commonReactions
import dev.notesapp.core.isOverdue
import kotlinx.serialization.json.JsonElement
import java.text.DateFormat
import java.util.Date
import androidx.compose.foundation.layout.widthIn

private val bubbleShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 4.dp)

/**
 * One entry in the journal, as the web app's bubble: a note's text or a todo's checkbox and title, its tags, its dates
 * and where it lives, its reactions, and its pages to turn through. A tap opens it; a long press opens its menu, or
 * picks it while picking.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BubbleView(card: Card, maxWidth: Dp, picked: Boolean = false, picking: Boolean = false, onPick: () -> Unit = {}) {
    val model = LocalModel.current
    var page by remember(card.id) { mutableIntStateOf(0) }
    var unfolded by remember(card.id) { mutableStateOf(false) }
    var revealed by remember(card.id) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    // What the bubble works out from its document is kept per version of the card, so a redraw that changes nothing
    // about it (a pick, focus, scrolling back) doesn't walk the document again.
    val pages = remember(card.id, card.updatedAt) { listOf(card.content) + card.turnPages }
    val shown = minOf(page, pages.size - 1)
    val doc = pages[shown]
    val blank = remember(card.id, card.updatedAt, shown) { Doc.isBlank(doc) }
    val long = remember(card.id, card.updatedAt, shown) { Doc.previewLines(doc).size > 6 }
    val tint = card.color?.let { Theme.tint(it) }
    val background = if (picked) Theme.accentSoft else tint?.copy(alpha = 0.16f) ?: Theme.surface
    Box {
        Column(
            Modifier.widthIn(max = maxWidth)
                .clip(bubbleShape)
                .background(background)
                .border(if (picked) 2.dp else 1.dp, if (picked) Theme.accent else tint?.copy(alpha = 0.5f) ?: Theme.line, bubbleShape)
                .combinedClickable(onClick = { if (picking) onPick() else model.openEntry = card.id }, onLongClick = { if (picking) onPick() else menu = true })
                .padding(start = 12.dp, end = 12.dp, top = 7.dp, bottom = 5.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            if (card.type == CardType.todo) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TodoCheck(card)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            card.title, color = if (card.isDone) Theme.muted else Theme.text, fontSize = 16.sp,
                            textDecoration = if (card.isDone) TextDecoration.LineThrough else null,
                        )
                        if (!blank || page > 0) BubbleText(doc, folded = !unfolded, revealed = revealed, memo = "${card.id}:${card.updatedAt}:$shown")
                    }
                }
            } else {
                if (card.title.isNotBlank() && page == 0) Text(card.title, fontWeight = FontWeight.SemiBold, color = Theme.text, fontSize = 16.sp)
                if (card.isStack) StackPreview(card)
                BubbleText(doc, folded = !unfolded, revealed = revealed, memo = "${card.id}:${card.updatedAt}:$shown")
            }
            if (page == 0) {
                BubbleAttachments(card)
                BubbleLinks(card)
                BubbleTranslation(card)
            }
            if (long) {
                Text(if (unfolded) "Less" else "More", Modifier.clickable { unfolded = !unfolded }, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.accent)
            }
            BubbleTags(card)
            BubbleMeta(card, page, pages.size) { page = it }
        }
        EntryMenu(card, menu, onDismiss = { menu = false }, revealHidden = { revealed = !revealed }, onPick = onPick)
    }
}

/** A todo's checkbox: ticking it finishes it, or moves a repeating one on. */
@Composable
fun TodoCheck(card: Card) {
    val model = LocalModel.current
    val icon = when {
        card.isDone -> Icons.Outlined.CheckBox
        card.waiting -> Icons.Outlined.HourglassEmpty
        else -> Icons.Outlined.CheckBoxOutlineBlank
    }
    Icon(
        icon, if (card.isDone) "Done" else "Not done",
        Modifier.size(22.dp).clip(RoundedCornerShape(4.dp)).clickable(enabled = model.canEdit(card)) { model.setDone(card, !card.isDone) },
        tint = if (card.isDone) Theme.accent else Theme.muted,
    )
}

/**
 * A document's text as a bubble shows it: lines with list markers, code blocks apart, links pressable, hidden words
 * under dots until shown, folded to six lines.
 */
@Composable
fun BubbleText(doc: JsonElement, folded: Boolean = true, revealed: Boolean = false, memo: String? = null) {
    val model = LocalModel.current
    // `memo` names the card version and page shown, a cheaper key than the document; links show under the index's titles.
    val parts = remember(memo ?: doc, model.index) { Doc.previewParts(doc, model.index.titleOf, markCode = true, hidden = Doc.Hidden.mark) }
    val limited = if (folded) fold(parts, 6) else parts
    val sunken = Theme.sunken
    val muted = Theme.muted
    val accent = Theme.accent
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (part in limited) {
            when (part) {
                is Doc.PreviewPart.Text -> SelectionContainer {
                    Text(attributed(part.lines.joinToString("\n"), revealed, sunken, muted, accent), color = Theme.text, fontSize = 16.sp, lineHeight = 22.sp)
                }
                is Doc.PreviewPart.Code -> CodeSnippet(part.text, part.language)
            }
        }
    }
}

/** The first `lines` lines of a preview. */
fun fold(parts: List<Doc.PreviewPart>, lines: Int): List<Doc.PreviewPart> {
    var left = lines
    val out = mutableListOf<Doc.PreviewPart>()
    for (part in parts) {
        if (left <= 0) break
        when (part) {
            is Doc.PreviewPart.Text -> { out.add(Doc.PreviewPart.Text(part.lines.take(left))); left -= minOf(left, part.lines.size) }
            is Doc.PreviewPart.Code -> {
                val l = part.text.split("\n")
                out.add(part.copy(text = l.take(left).joinToString("\n")))
                left -= minOf(left, l.size)
            }
        }
    }
    return out
}

/** Text with inline code in a code font, hidden words as dots, and web addresses as links. */
fun attributed(text: String, revealed: Boolean, sunken: androidx.compose.ui.graphics.Color, muted: androidx.compose.ui.graphics.Color, accent: androidx.compose.ui.graphics.Color): AnnotatedString = buildAnnotatedString {
    var inCode = false
    var inHidden = false
    val run = StringBuilder()
    fun flush() {
        if (run.isEmpty()) return
        val s = run.toString()
        if (inHidden && !revealed) {
            withStyle(SpanStyle(color = muted, background = sunken)) { append("•".repeat(minOf(12, maxOf(3, s.length / 2)))) }
        } else if (inCode) {
            withStyle(SpanStyle(fontFamily = Theme.mono, background = sunken, fontSize = 14.sp)) { append(s) }
        } else {
            for ((piece, href) in Doc.splitLinks(s)) {
                val bg = if (inHidden) SpanStyle(background = sunken) else SpanStyle()
                if (href != null) {
                    withLink(LinkAnnotation.Url(href, TextLinkStyles(SpanStyle(color = accent, textDecoration = TextDecoration.Underline)))) { withStyle(bg) { append(piece) } }
                } else withStyle(bg) { append(piece) }
            }
        }
        run.clear()
    }
    for (ch in text) {
        when (ch.toString()) {
            Doc.CODE_OPEN -> { flush(); inCode = true }
            Doc.CODE_CLOSE -> { flush(); inCode = false }
            Doc.HIDE_OPEN -> { flush(); inHidden = true }
            Doc.HIDE_CLOSE -> { flush(); inHidden = false }
            else -> run.append(ch)
        }
    }
    flush()
}

/** A code block in a bubble: in a code font, kept as typed, its language named over it, with a copy button. */
@Composable
fun CodeSnippet(text: String, language: String?) {
    val clipboard = LocalClipboardManager.current
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Theme.sunken)) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            if (language != null) Text(language, fontSize = 11.sp, color = Theme.muted)
            SelectionContainer {
                Text(text, Modifier.horizontalScroll(rememberScrollState()), fontFamily = Theme.mono, fontSize = 13.sp, color = Theme.text, softWrap = false)
            }
        }
        Icon(
            Icons.Outlined.ContentCopy, "Copy code", Modifier.align(Alignment.TopEnd).padding(6.dp).size(16.dp).clickable { clipboard.setText(AnnotatedString(text)) }, tint = Theme.muted,
        )
    }
}

/** The entries in a stack, named, under its own words. */
@Composable
fun StackPreview(stack: Card) {
    val model = LocalModel.current
    val entries = model.index.stackEntries(stack)
    Column(Modifier.padding(vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        for (entry in entries.take(5)) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Theme.sunken).clickable { model.openEntry = entry.id }.padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (entry.type == CardType.todo) (if (entry.isDone) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank) else Icons.Outlined.Description, null, Modifier.size(14.dp), tint = Theme.muted)
                Text(entry.displayTitle, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Theme.text, fontSize = 15.sp)
            }
        }
        if (entries.size > 5) Text("and ${entries.size - 5} more", fontSize = 12.sp, color = Theme.muted)
    }
}

/** An entry's tags, grouped ones first. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BubbleTags(card: Card) {
    val model = LocalModel.current
    val tags = model.index.resolveTags(model.index.tagGroups.order(card.tags))
    if (tags.isEmpty()) return
    FlowRow(Modifier.padding(top = 4.dp, bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (tag in tags) Chip(tag.displayTitle, tint = Theme.accent, modifier = Modifier.clickable { model.page = Page.Journal(StreamFilter(tagId = tag.id)) })
    }
}

/**
 * The bubble's bottom row: reactions, comments, checklist progress, pages, then a todo's due date, where it lives and
 * when it was written.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BubbleMeta(card: Card, page: Int, pages: Int, setPage: (Int) -> Unit) {
    val model = LocalModel.current
    val muted = Theme.muted
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides muted, androidx.compose.material3.LocalTextStyle provides androidx.compose.ui.text.TextStyle(fontSize = 12.sp, color = muted)) {
        FlowRow(Modifier.padding(top = 1.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.Center, itemVerticalAlignment = Alignment.CenterVertically) {
            Reactions(card)
            model.commentCounts[card.id]?.takeIf { it > 0 }?.let { IconText(Icons.AutoMirrored.Outlined.Comment, "$it") }
            remember(card.id, card.updatedAt) { Doc.checklistProgress(card.content) }?.let { (done, total) ->
                val all = done == total
                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if (all) Theme.tint(dev.notesapp.core.CardColor.green).copy(alpha = 0.22f) else androidx.compose.ui.graphics.Color.Transparent).padding(horizontal = if (all) 5.dp else 0.dp)) {
                    IconText(Icons.Outlined.Checklist, "$done/$total")
                }
            }
            if (pages > 1) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.ChevronLeft, "Previous page", Modifier.size(20.dp).clickable(enabled = page > 0) { setPage(maxOf(0, page - 1)) })
                    Text("${page + 1}/$pages", color = Theme.accent, fontWeight = FontWeight.SemiBold)
                    Icon(Icons.Outlined.ChevronRight, "Next page", Modifier.size(20.dp).clickable(enabled = page < pages - 1) { setPage(minOf(pages - 1, page + 1)) })
                }
            }
            if (card.template) IconText(Icons.Outlined.FileCopy, "Template", Theme.accent)
            Spacer(Modifier.weight(1f))
            if (card.type == CardType.todo) DueLabel(card)
            if (card.viewOnly) Icon(Icons.Outlined.Lock, "View only", Modifier.size(13.dp), tint = Theme.accent)
            val names = model.vaultNames(card).joinToString(", ")
            if (names.isNotEmpty()) Text(names, maxLines = 1)
            Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(card.createdAt)))
        }
    }
}

@Composable
fun IconText(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, color: androidx.compose.ui.graphics.Color = Theme.muted) {
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(13.dp), tint = color)
        Text(text, color = color, fontSize = 12.sp)
    }
}

/** A todo's due date, time and repeat, red once overdue, or Waiting. */
@Composable
fun DueLabel(card: Card) {
    val model = LocalModel.current
    if (card.waiting && !card.isDone) { IconText(Icons.Outlined.HourglassEmpty, "Waiting"); return }
    val due = card.due ?: return
    val color = if (card.isOverdue(model.today)) Theme.alert else Theme.muted
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        if (card.repeat != null) Icon(Icons.Outlined.Repeat, "Repeats", Modifier.size(13.dp), tint = color)
        Text(DateKey.relativeDay(due, model.today) + (card.dueTime?.let { " " + TimeKey.format(it) } ?: ""), color = color, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
    }
}

/** An entry's reactions, each with its count, pressed to put yours on or take it off; a smiley adds one. */
@Composable
fun Reactions(card: Card) {
    val model = LocalModel.current
    var picking by remember { mutableStateOf(false) }
    fun toggle(emoji: String) {
        val me = model.accountId
        model.perform { it.update(card.id) { c -> c.toggleReaction(emoji, me) } }
    }
    for ((emoji, by) in card.reactions.toSortedMap()) {
        val mine = model.accountId in by
        Text(
            "$emoji ${by.size}", Modifier.clip(RoundedCornerShape(50)).background(if (mine) Theme.accentSoft else Theme.sunken).clickable { toggle(emoji) }.padding(horizontal = 6.dp),
            fontSize = 12.sp, color = Theme.text,
        )
    }
    if (model.canEdit(card) || model.commentCounts[card.id] != null) {
        Box {
            Icon(Icons.Outlined.AddReaction, "Add a reaction", Modifier.size(16.dp).clickable { picking = true }, tint = Theme.muted)
            if (picking) EmojiPicker(onDismiss = { picking = false }) { toggle(it); picking = false }
        }
    }
}

/** The common reactions first, then any emoji typed in. */
@Composable
fun EmojiPicker(onDismiss: () -> Unit, pick: (String) -> Unit) {
    var typed by remember { mutableStateOf("") }
    Popup(onDismissRequest = onDismiss, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
        Column(Modifier.clip(RoundedCornerShape(14.dp)).background(Theme.raised).border(1.dp, Theme.line, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (e in commonReactions) Text(e, Modifier.clickable { pick(e) }, fontSize = 24.sp)
            }
            OutlinedTextField(typed, { t ->
                typed = t
                firstEmoji(t)?.let(pick)
            }, placeholder = { Text("Any emoji") }, singleLine = true, modifier = Modifier.size(width = 220.dp, height = 56.dp))
        }
    }
}

/** The first emoji in what's typed. */
fun firstEmoji(text: String): String? {
    val it = java.text.BreakIterator.getCharacterInstance()
    it.setText(text)
    var start = it.first()
    var end = it.next()
    while (end != java.text.BreakIterator.DONE) {
        val g = text.substring(start, end)
        val cp = g.codePointAt(0)
        if (Character.getType(cp) == Character.OTHER_SYMBOL.toInt() || g.codePointCount(0, g.length) > 1 && cp > 0x2000) return g
        start = end
        end = it.next()
    }
    return null
}
