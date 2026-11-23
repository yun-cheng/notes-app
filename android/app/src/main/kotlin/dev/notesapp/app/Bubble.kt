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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Add
import dev.notesapp.core.label
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
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
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
 * One entry in the journal, as the web app's bubble: a note's title and text or a todo's checkbox and title, its tags
 * with a todo's dates on their right, and a bottom row of its reactions on the left and its badges, page, More or
 * Less, vault and time on the right. Its pages turn with the arrows along its sides. A tap opens it; a long press opens
 * its menu, or picks it while picking. Its photos, files and links show under it (`EntryAttachments`).
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
    val paged = pages.size > 1
    Box(Modifier.widthIn(max = maxWidth)) {
        Column(
            Modifier
                .clip(bubbleShape)
                .background(background)
                .border(if (picked) 2.dp else 1.dp, if (picked) Theme.accent else tint?.copy(alpha = 0.5f) ?: Theme.line, bubbleShape)
                // A mouse's right button opens the menu, as on the web on a computer.
                .pointerInput(card.id) {
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent()
                            if (e.type == androidx.compose.ui.input.pointer.PointerEventType.Press && e.buttons.isSecondaryPressed) menu = true
                        }
                    }
                }
                // A long press picks, as on the web on a phone; the menu's actions are in the open entry and the picking bar.
                .combinedClickable(onClick = { if (picking) onPick() else model.openEntry = card.id }, onLongClick = onPick)
                .padding(start = if (paged) (if (card.type == CardType.todo) 22.dp else 24.dp) else 12.dp, end = if (paged) 24.dp else 12.dp, top = 7.dp, bottom = 5.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            if (page == 0) BubbleTranslation(card)
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
            BubbleTags(card)
            BubbleMeta(card, shown, pages.size, long, unfolded) { unfolded = !unfolded }
        }
        if (paged) {
            // The previous and next page, each the full height of a side, going round past the last or the first.
            Box(Modifier.matchParentSize()) {
                Icon(Icons.Outlined.ChevronLeft, "Previous page", Modifier.align(Alignment.CenterStart).fillMaxHeight().width(22.dp).clickable { page = (shown - 1 + pages.size) % pages.size }.padding(horizontal = 2.dp), tint = Theme.accent.copy(alpha = 0.6f))
                Icon(Icons.Outlined.ChevronRight, "Next page", Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(22.dp).clickable { page = (shown + 1) % pages.size }.padding(horizontal = 2.dp), tint = Theme.accent.copy(alpha = 0.6f))
            }
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
    // Hidden stretches pressed to show, by their place in the text, as the web's: each shown or hidden on its own.
    var shown by remember(memo ?: doc) { mutableStateOf(setOf<Int>()) }
    var start = 0
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (part in limited) {
            when (part) {
                is Doc.PreviewPart.Text -> {
                    val text = part.lines.joinToString("\n")
                    val from = start
                    start += text.count { it.toString() == Doc.HIDE_OPEN }
                    SelectionContainer {
                        Text(attributed(text, revealed, sunken, muted, accent, shown, from) { n -> shown = if (n in shown) shown - n else shown + n }, color = Theme.text, fontSize = 16.sp, lineHeight = 22.sp)
                    }
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

/**
 * Text with inline code in a code font, hidden words as dots (each pressed to show it, and again to hide it, by
 * `toggle`), and web addresses as links. `from` numbers its first hidden stretch.
 */
fun attributed(
    text: String, revealed: Boolean, sunken: androidx.compose.ui.graphics.Color, muted: androidx.compose.ui.graphics.Color, accent: androidx.compose.ui.graphics.Color,
    shown: Set<Int> = emptySet(), from: Int = 0, toggle: ((Int) -> Unit)? = null,
): AnnotatedString = buildAnnotatedString {
    var inCode = false
    var inHidden = false
    var hiddenAt = from - 1
    val run = StringBuilder()
    fun flush() {
        if (run.isEmpty()) return
        val s = run.toString()
        val open = revealed || hiddenAt in shown
        if (inHidden && toggle != null) {
            val n = hiddenAt
            withLink(LinkAnnotation.Clickable("hidden$n", linkInteractionListener = { toggle(n) })) {
                if (open) withStyle(SpanStyle(background = sunken)) { append(s) }
                else withStyle(SpanStyle(color = muted, background = sunken)) { append("•".repeat(minOf(12, maxOf(3, s.length / 2)))) }
            }
        } else if (inHidden && !open) {
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
            Doc.HIDE_OPEN -> { flush(); inHidden = true; hiddenAt++ }
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

/** An entry's tags, grouped ones first, in their tags' colors, with a todo's dates kept to the right on the same row, as the web's `bubble__tags`. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BubbleTags(card: Card, dates: Boolean = true) {
    val model = LocalModel.current
    val tags = model.index.resolveTags(model.index.tagGroups.order(card.tags))
    val dated = dates && card.type == CardType.todo && (card.due != null || card.start != null)
    if (tags.isEmpty() && !dated) return
    FlowRow(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        // As on the web, a tag on a bubble is only a label: pressing it does what pressing the bubble does.
        for (tag in tags) TagChip(tag)
        if (dated) {
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (card.waiting && !card.isDone) WaitingMark()
                DueLabel(card)
            }
        }
    }
}

/** A tag as a small chip: in its color, if it has one; a grouped one bolder, as the web's `chip--small`. */
@Composable
fun TagChip(tag: Card, modifier: Modifier = Modifier, large: Boolean = false) {
    val model = LocalModel.current
    val grouped = model.index.tagGroups.groupOf[tag.id] != null
    val tint = tag.color?.let { Theme.tint(it) }
    Text(
        tag.displayTitle,
        modifier.clip(RoundedCornerShape(50)).background(tint?.copy(alpha = 0.24f) ?: Theme.sunken)
            .then(if (grouped) Modifier.border(1.dp, Theme.accent.copy(alpha = 0.45f), RoundedCornerShape(50)) else Modifier)
            .padding(horizontal = if (large) 10.dp else 8.dp, vertical = if (large) 4.dp else 1.dp),
        fontSize = if (large) 13.sp else 12.sp, fontWeight = if (grouped) FontWeight.SemiBold else FontWeight.Normal, color = if (tint == null) Theme.muted else Theme.text, maxLines = 1,
    )
}

/** Waiting on someone else, as the web's mark beside a todo's dates. */
@Composable
fun WaitingMark() = IconText(Icons.Outlined.HourglassEmpty, "Waiting")

/**
 * The bubble's bottom row, as the web's: on the left, whether it's view only, its reactions; on the right, Use template,
 * its checklist and comment counts, the page shown, More or Less, its vaults and the time it was written.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BubbleMeta(card: Card, page: Int, pages: Int, long: Boolean, unfolded: Boolean, fold: () -> Unit) {
    val model = LocalModel.current
    val muted = Theme.muted
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides muted, androidx.compose.material3.LocalTextStyle provides androidx.compose.ui.text.TextStyle(fontSize = 11.sp, color = muted)) {
        FlowRow(Modifier.fillMaxWidth().padding(top = 1.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.Center, itemVerticalAlignment = Alignment.CenterVertically) {
            if (card.viewOnly) Icon(Icons.Outlined.Visibility, "View only", Modifier.size(13.dp), tint = Theme.accent)
            Reactions(card)
            // Beside the smiley, as the web's: on an entry others can comment on that has no open comments yet.
            if (!card.deleted && model.canComment(card) && (model.commentCounts[card.id] ?: 0) == 0) Icon(
                Icons.AutoMirrored.Outlined.Comment, "Comment",
                Modifier.size(22.dp).clip(CircleShape).clickable { model.openEntry = card.id }.padding(4.dp), tint = Theme.muted,
            )
            Spacer(Modifier.weight(1f))
            if (card.template) {
                if (model.viewOnly || card.deleted) IconText(Icons.Outlined.FileCopy, "Template", Theme.accent)
                else Box(Modifier.clickable { model.startFrom(card) }) { IconText(Icons.Outlined.FileCopy, "Use", Theme.accent) }
            }
            remember(card.id, card.updatedAt) { Doc.checklistProgress(card.content) }?.let { (done, total) ->
                val all = done == total
                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(if (all) Theme.tint(dev.notesapp.core.CardColor.green).copy(alpha = 0.22f) else androidx.compose.ui.graphics.Color.Transparent).padding(horizontal = if (all) 5.dp else 0.dp)) {
                    IconText(Icons.Outlined.Checklist, "$done/$total", if (all) Theme.text else Theme.muted)
                }
            }
            model.commentCounts[card.id]?.takeIf { it > 0 }?.let { Box(Modifier.clickable { model.openEntry = card.id }) { IconText(Icons.AutoMirrored.Outlined.Comment, "$it") } }
            if (pages > 1) Text("${page + 1}/$pages", color = Theme.accent, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            if (long) {
                Row(Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = fold).padding(end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (unfolded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown, null, Modifier.size(14.dp), tint = Theme.accent)
                    Text(if (unfolded) "Less" else "More", color = Theme.accent, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                }
            }
            if ((card.type != CardType.todo || (card.due == null && card.start == null)) && card.waiting && !card.isDone) WaitingMark()
            VaultLabel(card)
            Text(formatMillis(card.createdAt, date = null), Modifier.padding(start = 4.dp))
        }
    }
}

/**
 * The vaults an entry is in, as the web's: its own, then any it's also in; left out with only one vault, or when the
 * journal already shows its one vault. An entry shared with this account alone says so.
 */
@Composable
fun VaultLabel(card: Card) {
    val model = LocalModel.current
    val vaults = (listOf(card.vaultId) + (model.sharedInto[card.id] ?: emptyList())).mapNotNull { model.vault(it) }
    if (vaults.isEmpty()) {
        if (model.vault(card.vaultId) == null) Text("Shared with you")
        return
    }
    val narrowed = (model.page as? Page.Journal)?.filter?.vaultId != null
    if (model.vaults.size < 2 || (narrowed && vaults.size < 2)) return
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        vaults.forEachIndexed { i, v ->
            if (v.isPrivate) Icon(Icons.Outlined.Lock, null, Modifier.size(11.dp))
            Text(v.name + if (i < vaults.size - 1) "," else "")
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

/**
 * A todo's dates as a sentence, red once overdue, and how it repeats, named, as the web's `DueLabel`: "Due tomorrow at
 * 6:00 PM", "Starts Mon, Nov 30, due Fri, Dec 4", "↻ Every 3 days".
 */
@Composable
fun DueLabel(card: Card, short: Boolean = false) {
    val model = LocalModel.current
    val text = dueText(card, model.today, short)
    if (text.isEmpty()) return
    val color = if (card.isOverdue(model.today)) Theme.alert else Theme.muted
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, color = color, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        card.repeat?.let { r ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Repeat, "Repeats: ${r.label.lowercase()}", Modifier.size(12.dp), tint = Theme.muted)
                if (!short) Text(r.label, color = Theme.muted, fontSize = 12.sp)
            }
        }
    }
}

/** The web's `dueText`. */
fun dueText(card: Card, today: String, short: Boolean = false): String {
    val starts = if (!card.isDone) card.start?.takeIf { it > today } else null
    val due = card.due ?: return starts?.let { if (short) "From ${DateKey.relativeDay(it, today)}" else "Starts ${DateKey.relativeDayInSentence(it, today)}" } ?: ""
    val time = card.dueTime?.let { TimeKey.format(it) } ?: ""
    if (short) return (starts?.let { DateKey.relativeDay(it, today) + " – " } ?: "") + DateKey.relativeDay(due, today) + if (time.isEmpty()) "" else ", $time"
    val whenDue = DateKey.relativeDayInSentence(due, today) + if (time.isEmpty()) "" else " at $time"
    return starts?.let { "Starts ${DateKey.relativeDayInSentence(it, today)}, due $whenDue" } ?: "Due $whenDue"
}

/** An entry's reactions as the web's chips, each emoji with how many put it on, filled where this account did, a press toggling it; then the faint smiley that opens the picker. */
@Composable
fun Reactions(card: Card, large: Boolean = false) {
    val model = LocalModel.current
    var picking by remember { mutableStateOf(false) }
    val canReact = !card.deleted && model.canWrite(card)
    fun toggle(emoji: String) {
        val me = model.accountId
        model.update(card.id) { c -> c.toggleReaction(emoji, me) }
    }
    for ((emoji, by) in card.reactions.filterValues { it.isNotEmpty() }.toSortedMap()) {
        val mine = model.accountId in by
        val shape = RoundedCornerShape(50)
        Row(
            Modifier.clip(shape).background(if (mine) Theme.accentSoft else Theme.surface).border(1.dp, if (mine) Theme.accent.copy(alpha = 0.55f) else Theme.line, shape)
                .clickable(enabled = canReact) { toggle(emoji) }.padding(start = if (large) 8.dp else 5.dp, end = if (large) 10.dp else 7.dp, top = 1.dp, bottom = 1.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(emoji, fontSize = if (large) 16.sp else 13.sp)
            Text("${by.size}", fontSize = if (large) 13.sp else 11.sp, fontWeight = FontWeight.Medium, color = if (mine) Theme.text else Theme.muted)
        }
    }
    if (canReact) {
        Box {
            Smiley(Modifier.size(if (large) 28.dp else 22.dp).clip(CircleShape).clickable { picking = true }.padding(if (large) 6.dp else 4.dp), Theme.muted.copy(alpha = if (picking) 1f else 0.6f))
            if (picking) ReactionPicker(mine = { e -> model.accountId in (card.reactions[e] ?: emptyList()) }, onDismiss = { picking = false }) { toggle(it); picking = false }
        }
    }
}

/** An outline smiley, as the web's icon. */
@Composable
fun Smiley(modifier: Modifier, color: androidx.compose.ui.graphics.Color) {
    androidx.compose.foundation.Canvas(modifier) {
        val r = size.minDimension / 2 - 1f
        val c = center
        val line = maxOf(1.5f, size.minDimension / 11)
        drawCircle(color, r, c, style = androidx.compose.ui.graphics.drawscope.Stroke(line))
        val eye = r * 0.13f
        drawCircle(color, eye, androidx.compose.ui.geometry.Offset(c.x - r * 0.33f, c.y - r * 0.28f))
        drawCircle(color, eye, androidx.compose.ui.geometry.Offset(c.x + r * 0.33f, c.y - r * 0.28f))
        drawArc(color, 25f, 130f, false, androidx.compose.ui.geometry.Offset(c.x - r * 0.5f, c.y + r * 0.05f - r * 0.5f), androidx.compose.ui.geometry.Size(r, r), style = androidx.compose.ui.graphics.drawscope.Stroke(line, cap = androidx.compose.ui.graphics.StrokeCap.Round))
    }
}

/**
 * The emoji picker, as the web's: the common reactions in a row, then + for any emoji, by group with the ones used
 * lately first, or found by name, or typed or pasted in from the keyboard's emoji.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReactionPicker(mine: (String) -> Boolean, onDismiss: () -> Unit, pick: (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val prefs = remember { context.getSharedPreferences("reactions", android.content.Context.MODE_PRIVATE) }
    var more by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val recent = remember { (prefs.getString("recent", "") ?: "").split(" ").filter { it.isNotEmpty() } }
    fun choose(e: String) {
        prefs.edit().putString("recent", (listOf(e) + recent.filter { it != e }).take(16).joinToString(" ")).apply()
        pick(e)
    }
    @Composable
    fun cell(e: String, big: Boolean) {
        Box(
            Modifier.size(if (big) 36.dp else 34.dp).clip(RoundedCornerShape(8.dp)).background(if (mine(e)) Theme.accentSoft else androidx.compose.ui.graphics.Color.Transparent).clickable { choose(e) },
            contentAlignment = Alignment.Center,
        ) { Text(e, fontSize = if (big) 22.sp else 20.sp) }
    }
    Popup(onDismissRequest = onDismiss, properties = androidx.compose.ui.window.PopupProperties(focusable = true)) {
        Column(Modifier.width(296.dp).clip(RoundedCornerShape(14.dp)).background(Theme.raised).border(1.dp, Theme.line, RoundedCornerShape(14.dp)).padding(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                for (e in commonReactions) cell(e, true)
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).clickable { more = !more }, contentAlignment = Alignment.Center) {
                    Icon(if (more) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.Add, "More emoji", tint = Theme.muted)
                }
            }
            if (more) {
                OutlinedTextField(query, { query = it }, placeholder = { Text("Search, or type any emoji") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                val q = query.trim()
                val found = if (q.isEmpty()) emptyList() else (emojisIn(q) + EmojiData.search(q)).distinct()
                androidx.compose.foundation.lazy.LazyColumn(Modifier.height(232.dp)) {
                    if (q.isNotEmpty()) {
                        if (found.isEmpty()) item { Text("No emoji called that. Type or paste one, from the keyboard's emoji.", color = Theme.muted, fontSize = 13.sp, modifier = Modifier.padding(4.dp)) }
                        else item { FlowRow { for (e in found) cell(e, false) } }
                    } else {
                        val groups = (if (recent.isNotEmpty()) listOf("Recent" to recent) else emptyList()) + EmojiData.groups.map { g -> g.name to g.emoji.map { it.char }.distinct() }
                        for ((name, list) in groups) {
                            item { Text(name, color = Theme.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, top = 6.dp, bottom = 2.dp)) }
                            item { FlowRow { for (e in list) cell(e, false) } }
                        }
                    }
                }
            }
        }
    }
}

/** The emoji in what was typed or pasted, one per character as seen, in order and without repeats. */
fun emojisIn(text: String): List<String> {
    val it = java.text.BreakIterator.getCharacterInstance()
    it.setText(text)
    val out = LinkedHashSet<String>()
    var start = it.first()
    var end = it.next()
    while (end != java.text.BreakIterator.DONE) {
        val g = text.substring(start, end)
        val cp = g.codePointAt(0)
        if (Character.getType(cp) == Character.OTHER_SYMBOL.toInt() || g.codePointCount(0, g.length) > 1 && cp > 0x2000) out.add(g)
        start = end
        end = it.next()
    }
    return out.toList()
}

/** The first emoji in what's typed. */
fun firstEmoji(text: String): String? = emojisIn(text).firstOrNull()
