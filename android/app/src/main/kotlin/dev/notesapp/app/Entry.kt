package dev.notesapp.app

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.NoteAdd
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.FileCopy
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.automirrored.outlined.Redo
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.notesapp.core.Card
import dev.notesapp.core.CardColor
import dev.notesapp.core.CardType
import dev.notesapp.core.DateKey
import dev.notesapp.core.Doc
import dev.notesapp.core.isOverdue
import dev.notesapp.core.Markdown
import dev.notesapp.core.Repeat
import dev.notesapp.core.TimeKey
import dev.notesapp.core.arr
import dev.notesapp.core.fromTemplate
import dev.notesapp.core.get
import dev.notesapp.core.j
import dev.notesapp.core.jobj
import dev.notesapp.core.label
import dev.notesapp.core.obj
import dev.notesapp.core.repeatChoices
import dev.notesapp.core.str
import dev.notesapp.core.tagNamed
import dev.notesapp.core.tagsFor
import dev.notesapp.core.with
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/** A screen over the app, with a bar to close it: the entry sheet and its panels. */
@Composable
fun FullScreen(title: String, dismiss: () -> Unit, actions: @Composable () -> Unit = {}, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Theme.bg)) {
            Row(Modifier.fillMaxWidth().padding(top = statusBarTop()).height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = dismiss) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Done", tint = Theme.text) }
                Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Theme.text, maxLines = 1)
                actions()
            }
            Box(Modifier.weight(1f).navigationBarsPadding().imePadding()) { content() }
        }
    }
}

/**
 * An entry opened to read or change, as the web app's sheet: a todo's checkbox and title, its pages as numbered tabs,
 * the text, its tags and reactions, comments and what links to it; then a bar of the web's tools (note or todo, the
 * due date, Aa for formatting, tags, a page, a title, color and previews, view only, template, copy, share, archive,
 * trash, the vault), when it was edited, Undo, Redo and Discard, which puts it back as it was when opened.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EntrySheet(id: String, dismiss: () -> Unit) {
    val model = LocalModel.current
    val card = model.card(id)
    if (card == null) {
        FullScreen("Not here", dismiss) {
            Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("This entry isn't on this device, or its vault is locked.", color = Theme.muted)
            }
        }
        return
    }
    val edit = model.canEdit(card)
    var page by remember(id) { mutableIntStateOf(0) }
    var title by remember(id) { mutableStateOf(card.title) }
    // The title as last taken from the card: the field differs from it only once something is typed there.
    var opened by remember(id) { mutableStateOf(card.title) }
    // Renamed elsewhere while open: the field follows, unless something was typed in it.
    LaunchedEffect(card.title) {
        if (title == opened) title = card.title
        opened = card.title
    }
    var showTools by remember { mutableStateOf(false) }
    var titled by remember { mutableStateOf(false) }
    var tools by remember { mutableStateOf<(@Composable () -> Unit)?>(null) }
    // As it was when opened, for Discard to put back.
    val original = remember(id) { card.payload }
    // Its pages, and a blank one being added: kept only once something is written on it.
    val stored = listOf(card.content) + card.morePages
    val pages = stored + List(maxOf(0, page + 1 - stored.size)) { Doc.empty }
    val behind = maxOf(stored.size - 1, page)
    val isTodo = card.type == CardType.todo
    val showTitle = isTodo || card.title.isNotBlank() || titled || card.isStack
    fun saveTitle() {
        val c = model.card(id) ?: return
        // Only what was typed here: a title it opened with mustn't undo a rename made elsewhere since.
        if (!model.canEdit(c) || title == opened || title == c.title) return
        val t = title
        model.update(id, typed = true) { x -> x.withTitle(t) }
    }
    DisposableEffect(id) { onDispose { saveTitle() } }
    val close = { saveTitle(); dismiss() }

    // As the web's on a phone: a sheet from the foot as tall as what's in it (up to most of the screen), over the dimmed
    // page, closed by a tap above it.
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
     androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
      val tallest = maxHeight * 0.88f
      Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)).clickable(interactionSource = null, indication = null, onClick = close))
      Column(
          Modifier.align(Alignment.BottomCenter).widthIn(max = 660.dp).fillMaxWidth().heightIn(max = tallest)
              .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)).background(Theme.bg).clickable(interactionSource = null, indication = null) {}
              .navigationBarsPadding(),
      ) {
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (card.viewOnly || !model.canWrite(card)) {
                IconText(Icons.Outlined.Visibility, if (card.viewOnly) "View only. Turn it off in the entry's menu to change it." else "You can view this entry.")
            }
            if (card.template) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.FileCopy, null, Modifier.size(16.dp), tint = Theme.accent)
                    Text("Template: entries started from it get a copy, its checklists unticked and {date} filled in.", Modifier.weight(1f), color = Theme.muted, fontSize = 14.sp)
                    if (!model.viewOnly) androidx.compose.material3.Button(onClick = { model.startFrom(card) }) { Text("Use it") }
                }
            }
            if (showTitle) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (isTodo) TodoCheck(card)
                    TitleField(title, if (isTodo) "Todo" else if (card.isStack) "Stack" else "Title", edit, bold = !isTodo) { title = it }
                }
            }
            if (behind > 0) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Outlined.MenuBook, null, Modifier.size(14.dp), tint = Theme.muted)
                    for (i in 0..behind) {
                        Text(
                            "${i + 1}",
                            Modifier.size(28.dp).clip(CircleShape).background(if (page == i) Theme.accentSoft else Color.Transparent).border(1.dp, if (page == i) Theme.accent else Theme.line, CircleShape).clickable { page = i }.wrapContentHeight(),
                            textAlign = TextAlign.Center, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (page == i) Theme.text else Theme.muted,
                        )
                    }
                    if (edit && page < stored.size) {
                        Box(Modifier.size(28.dp).clip(CircleShape).border(1.dp, Theme.line, CircleShape).clickable { page = behind + 1 }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.Add, "Add a page", Modifier.size(14.dp), tint = Theme.muted)
                        }
                    }
                    if (edit && page > 0) Text("Take out page ${page + 1}", Modifier.padding(start = 6.dp).clickable {
                        val at = page
                        page -= 1
                        if (at < stored.size) {
                            model.update(id) { c -> c.withMorePages(c.morePages.toMutableList().also { if (at - 1 < it.size) it.removeAt(at - 1) }) }
                            model.say("Took out page ${at + 1}")
                        }
                    }, fontSize = 13.sp, color = Theme.muted)
                }
            }
            androidx.compose.runtime.key("$id:$page") {
                DocEditor(pages[page], edit, { doc -> savePage(model, id, page, doc) }, onTools = { tools = it }, placeholder = if (page > 0) "Page ${page + 1}" else if (isTodo) "Details" else "Note")
            }
            // Its photos, voice messages and files as the journal shows them, where the web shows them in the text; in
            // the text they're named, to move or take out.
            if (page == 0) EntryAttachments(card)
            SheetTags(card, edit)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) { Reactions(card, large = true) }
            if (card.isStack && page == 0) StackPreview(card)
            CommentsSection(card)
            Backlinks(card)
        }
        if (showTools) tools?.let { HorizontalDivider(color = Theme.line); it() }
        HorizontalDivider(color = Theme.line)
        SheetBar(card, edit, showTools, { showTools = !showTools }, showTitle, { titled = true }, behind, { page = stored.size }, original, close)
      }
     }
    }
}

/**
 * An entry's tags in its sheet, as the web's `TagChips` there: a grouped tag opens its group, to switch it in place (or,
 * in a group of any number, add or take off one), each one-choice group the entry has none from offers itself as
 * "+ Priority" to set one, and any other tag is only a label (tags are added and taken off from the bar's Tags).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SheetTags(card: Card, edit: Boolean) {
    val model = LocalModel.current
    val groups = model.index.tagGroups
    val tags = model.index.resolveTags(groups.order(card.tags))
    val unset = if (edit) groups.groups.filter { g -> g.choosesOne && g.members.isNotEmpty() && g.members.none { it.id in card.tags } } else emptyList()
    if (tags.isEmpty() && unset.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (tag in tags) {
            val group = groups.groupOf[tag.id]
            if (edit && group != null) GroupChipMenu(card, group) { open -> TagChip(tag, Modifier.clickable(onClick = open), large = true) }
            else TagChip(tag, large = true)
        }
        for (g in unset) GroupChipMenu(card, g) { open ->
            Text(
                "+ ${g.title}", Modifier.clip(RoundedCornerShape(50)).border(1.dp, Theme.line, RoundedCornerShape(50)).clickable(onClick = open).padding(horizontal = 10.dp, vertical = 4.dp),
                fontSize = 13.sp, color = Theme.muted,
            )
        }
    }
}

/** A group's tags in a menu, as the web's `GroupChip`: in a group of one choice, picking one swaps it in, and "No priority" takes it off; in a group of any number, each is added or taken off. */
@Composable
fun GroupChipMenu(card: Card, group: dev.notesapp.core.TagGroup, chip: @Composable (open: () -> Unit) -> Unit) {
    val model = LocalModel.current
    var open by remember { mutableStateOf(false) }
    fun pick(id: String?) {
        val inGroup = group.members.map { it.id }.toSet()
        val tags = card.tags
        val next = when {
            id == null -> tags.filter { it !in inGroup }
            group.choosesOne -> tags.filter { it !in inGroup } + id
            id in tags -> tags - id
            else -> tags + id
        }
        if (next != tags) model.update(card.id) { c -> c.withTags(next) }
        if (group.choosesOne) open = false
    }
    Box {
        chip { open = true }
        androidx.compose.material3.DropdownMenu(open, { open = false }, containerColor = Theme.raised) {
            Text(group.title, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
            for (m in group.members) MenuCheck(m.displayTitle, m.id in card.tags) { pick(m.id) }
            if (group.choosesOne) MenuCheck("No ${group.title.lowercase()}", false) { pick(null) }
        }
    }
}

/** The sheet's bar, as the web's: its tools in the web's order, then when it was edited, Undo, Redo, Discard and Done. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SheetBar(card: Card, edit: Boolean, tools: Boolean, toggleTools: () -> Unit, showTitle: Boolean, addTitle: () -> Unit, behind: Int, addPage: () -> Unit, original: JsonObject, close: () -> Unit) {
    val model = LocalModel.current
    val context = LocalContext.current
    var style by remember { mutableStateOf(false) }
    @Composable
    fun tool(icon: ImageVector, label: String, on: Boolean = false, action: () -> Unit) {
        Icon(icon, label, Modifier.size(38.dp, 36.dp).clip(RoundedCornerShape(7.dp)).background(if (on) Theme.accentSoft else Color.Transparent).clickable(onClick = action).padding(8.dp), tint = Theme.muted)
    }
    Column(Modifier.fillMaxWidth().background(Theme.surface).padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            if (edit && !card.isStack) tool(if (card.type == CardType.todo) Icons.Outlined.Description else Icons.Outlined.CheckCircle, if (card.type == CardType.todo) "Make it a note" else "Make it a todo") {
                model.perform { it.retype(card.id, if (card.type == CardType.todo) CardType.note else CardType.todo) }
            }
            if (card.type == CardType.todo && edit) {
                Row(Modifier.height(36.dp).clip(RoundedCornerShape(7.dp)).clickable { model.panel = EntryPanel.Due(card.id) }.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CalendarMonth, null, Modifier.size(18.dp), tint = Theme.muted)
                    val t = dueText(card, model.today, short = true)
                    Text(t.ifEmpty { "Due date" }, fontSize = 13.sp, color = if (card.isOverdue(model.today)) Theme.alert else Theme.muted)
                }
            }
            if (edit) {
                Text("Aa", Modifier.height(36.dp).clip(RoundedCornerShape(7.dp)).background(if (tools) Theme.accentSoft else Color.Transparent).clickable(onClick = toggleTools).padding(horizontal = 8.dp).wrapContentHeight(), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
                tool(Icons.AutoMirrored.Outlined.Label, "Tags") { model.panel = EntryPanel.Tags(card.id) }
                if (behind == 0) tool(Icons.AutoMirrored.Outlined.MenuBook, "Add a second page", action = addPage)
                if (!showTitle) Text("T", Modifier.height(36.dp).clickable(onClick = addTitle).padding(horizontal = 12.dp).wrapContentHeight(), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
                Box {
                    Box(Modifier.size(38.dp, 36.dp).clickable { style = true }, contentAlignment = Alignment.Center) {
                        val tint = card.color?.let { Theme.tint(it) }
                        Box(Modifier.size(18.dp).clip(CircleShape).background(tint ?: Color.Transparent).border(1.5.dp, tint ?: Theme.muted, CircleShape))
                    }
                    DropdownMenu(style, { style = false }) { StyleItems(card) { style = false } }
                }
            }
            if (model.canWrite(card) && !model.viewOnly) tool(Icons.Outlined.Visibility, if (card.viewOnly) "Turn off view only" else "View only", on = card.viewOnly) {
                model.update(card.id) { c -> c.withViewOnly(!card.viewOnly) }
            }
            if (edit && !card.isStack && !card.template) tool(Icons.Outlined.FileCopy, "Save a copy as a template") { model.saveAsTemplate(card) }
            model.index.stackOf[card.id]?.let { stack -> if (edit) tool(Icons.Outlined.Layers, "Take out of the stack") { model.update(stack) { s -> s.withStack((s.stack ?: emptyList()).filter { x -> x != card.id }) } } }
            tool(Icons.Outlined.ContentCopy, "Copy") { copyEntry(context, model, card) }
            if (model.canManage(card)) {
                tool(Icons.Outlined.Share, "Share") { model.panel = EntryPanel.Share(card.id) }
                tool(Icons.Outlined.Archive, if (card.archived) "Unarchive" else "Archive") { model.archive(listOf(card.id), !card.archived); close() }
                tool(Icons.Outlined.Delete, "Move to Trash") { model.trash(listOf(card.id)); close() }
                Row(Modifier.padding(start = 4.dp).height(30.dp).clip(RoundedCornerShape(7.dp)).border(1.dp, Theme.line, RoundedCornerShape(7.dp)).clickable { model.panel = EntryPanel.Vaults(card.id) }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(model.vaultNames(card).joinToString(", "), fontSize = 13.sp, color = Theme.muted, maxLines = 1)
                    Icon(Icons.Outlined.UnfoldMore, null, Modifier.size(14.dp), tint = Theme.muted)
                }
            }
            Text(edited(card), Modifier.padding(start = 8.dp).clickable { model.panel = EntryPanel.History(card.id) }.padding(vertical = 8.dp), fontSize = 13.sp, color = Theme.muted)
        }
        // As the web's: Undo and Redo, and Discard (when it was edited closes the row of tools above).
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            tool(Icons.AutoMirrored.Outlined.Undo, "Undo") { model.undo() }
            tool(Icons.AutoMirrored.Outlined.Redo, "Redo") { model.redo() }
            Spacer(Modifier.weight(1f))
            if (edit) {
                val changed = original != card.payload
                TextButton(onClick = { model.update(card.id) { c -> c.copy(payload = original) }; model.say("Discarded changes"); close() }, enabled = changed) { Text("Discard") }
            }
        }
    }
}

/** "Edited 3:55 AM" today, "Edited Nov 18" before, as the web's. */
fun edited(card: Card): String {
    val at = java.util.Calendar.getInstance().apply { timeInMillis = card.updatedAt }
    val now = java.util.Calendar.getInstance()
    val sameDay = at.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR) && at.get(java.util.Calendar.DAY_OF_YEAR) == now.get(java.util.Calendar.DAY_OF_YEAR)
    return "Edited " + if (sameDay) formatMillis(card.updatedAt, date = null) else java.text.SimpleDateFormat("MMM d", java.util.Locale.getDefault()).format(java.util.Date(card.updatedAt))
}

/** An entry's color, as swatches, and how its links and photos show, as the web's style menu. */
@Composable
fun StyleItems(card: Card, close: () -> Unit) {
    val model = LocalModel.current
    Text("Color", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), fontSize = 12.sp, color = Theme.muted)
    Swatches(card.color) { c -> close(); model.update(card.id) { it.withColor(c) } }
    HorizontalDivider()
    Text("Link previews", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontSize = 12.sp, color = Theme.muted)
    val links = card.payload["preview"]["links"].str ?: ""
    for ((v, l) in listOf("" to "As set on this device", "card" to "Cards", "compact" to "One line", "off" to "Off")) MenuCheck(l, links == v) { close(); setPreview(model, card, "links", v) }
    HorizontalDivider()
    Text("Photos", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontSize = 12.sp, color = Theme.muted)
    val photos = card.payload["preview"]["photos"].str ?: ""
    for ((v, l) in listOf("" to "As set on this device", "large" to "Large", "thumbs" to "Thumbnails", "off" to "Off")) MenuCheck(l, photos == v) { close(); setPreview(model, card, "photos", v) }
}

/** The colors as a row of swatches, none struck through, as the web's. */
@Composable
fun Swatches(value: CardColor?, pick: (CardColor?) -> Unit) {
    Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(22.dp).clip(CircleShape).border(if (value == null) 2.dp else 1.dp, if (value == null) Theme.text else Theme.line, CircleShape).clickable { pick(null) }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(14.dp, 2.dp).background(Theme.alert).graphicsLayer { rotationZ = -45f })
        }
        for (c in CardColor.entries) Box(Modifier.size(22.dp).clip(CircleShape).background(Theme.tint(c)).border(if (value == c) 2.dp else 0.dp, Theme.text, CircleShape).clickable { pick(c) })
    }
}

@Composable
private fun TitleField(title: String, placeholder: String, edit: Boolean, bold: Boolean = true, set: (String) -> Unit) {
    val weight = if (bold) FontWeight.SemiBold else FontWeight.Normal
    BasicTextField(
        title, set, Modifier.fillMaxWidth(), enabled = edit,
        textStyle = androidx.compose.ui.text.TextStyle(color = Theme.text, fontSize = 20.sp, fontWeight = weight), cursorBrush = SolidColor(Theme.accent),
        decorationBox = { inner -> if (title.isEmpty()) Text(placeholder, color = Theme.muted, fontSize = 20.sp, fontWeight = weight); inner() },
    )
}

private fun savePage(model: AppModel, id: String, page: Int, doc: kotlinx.serialization.json.JsonElement) {
    model.perform { repo ->
        repo.update(id, typed = true) { card ->
            if (page == 0) card.withContent(doc) else {
                val more = card.morePages.toMutableList()
                while (more.size < page) more.add(Doc.empty)
                more[page - 1] = doc
                card.withMorePages(more)
            }
        }
    }
}

/** A todo's due date, time, start and repeat, and Waiting. */
@Composable
fun TodoDates(card: Card) {
    val model = LocalModel.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        DueLabel(card)
        if (card.due == null && !(card.waiting && !card.isDone)) Text("No due date", color = Theme.muted, fontSize = 14.sp)
        Spacer(Modifier.weight(1f))
        if (model.canEdit(card)) TextButton(onClick = { model.panel = EntryPanel.Due(card.id) }) { Text("Change…") }
    }
}

/** What links here, as the web's: "Linked from (2)", each entry named with a line of its text, opening it. */
@Composable
fun Backlinks(card: Card) {
    val model = LocalModel.current
    val links = (model.index.backlinks[card.id] ?: return).filter { it.kind != dev.notesapp.core.Backlink.Kind.tag || card.type == CardType.tag }.distinctBy { it.from.id }
    if (links.isEmpty()) return
    var open by remember { mutableStateOf(true) }
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Text("${if (card.type == CardType.tag) "Tagged" else "Linked from"} (${links.size})", Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Theme.muted, fontSize = 14.sp)
            Icon(if (open) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown, null, tint = Theme.muted)
        }
        if (open) for (link in links.take(30)) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(10.dp)).clickable { model.openEntry = link.from.id }.padding(10.dp)) {
                Text(link.from.displayTitle, fontWeight = FontWeight.SemiBold, color = Theme.text, maxLines = 1)
                val preview = remember(link.from.id, link.from.updatedAt) { Doc.previewLines(link.from.content, hidden = Doc.Hidden.mask).joinToString(" ") }
                if (preview.isNotEmpty()) Text(preview, fontSize = 13.sp, color = Theme.muted, maxLines = 2)
            }
        }
    }
}

/**
 * An entry's menu, as the web app's: Edit, Tags…, Due date…, Make it a todo or a note, Color, Save as template,
 * Share…, View only, Vaults…, Take out of the stack, Archive and Move to Trash, each only where this account may. A
 * phone's menu is short: the rarer items go one level down, so Archive and Move to Trash stay in reach.
 */
@Composable
fun EntryMenu(card: Card, open: Boolean, onDismiss: () -> Unit, revealHidden: () -> Unit, onPick: () -> Unit, inSheet: Boolean = false) {
    val model = LocalModel.current
    val context = LocalContext.current
    val edit = model.canEdit(card)
    fun item(label: String, color: Color? = null, action: () -> Unit) = @Composable {
        DropdownMenuItem(text = { Text(label, color = color ?: Theme.text) }, onClick = { onDismiss(); action() })
    }
    DropdownMenu(open, onDismiss) {
        if (card.deleted) {
            if (model.canWrite(card)) item("Restore") { model.perform { it.setDeleted(card.id, false) }; model.say("Restored") }()
            item("Copy") { copyEntry(context, model, card) }()
            return@DropdownMenu
        }
        // In the web's order: what opens it; what it is; its color; what's done with it; where it goes.
        if (!inSheet) item(if (edit) "Edit" else "Open") { model.openEntry = card.id }()
        if (card.template && !model.viewOnly) item("Use this template") { model.startFrom(card) }()
        if (edit) {
            item("Tags…") { model.panel = EntryPanel.Tags(card.id) }()
            if (card.type == CardType.todo) item("Due date…") { model.panel = EntryPanel.Due(card.id) }()
            item(if (card.type == CardType.todo) "Make it a note" else "Make it a todo") {
                model.perform { it.retype(card.id, if (card.type == CardType.todo) CardType.note else CardType.todo) }
            }()
            HorizontalDivider()
            Text("Color", Modifier.padding(horizontal = 16.dp, vertical = 4.dp), fontSize = 12.sp, color = Theme.muted)
            Swatches(card.color) { c -> onDismiss(); model.update(card.id) { it.withColor(c) } }
        }
        HorizontalDivider()
        val t = Translations.states[card.id]
        if (t is Translations.State.Done) item(if (t.shown) "Show original" else "Show in ${java.util.Locale.forLanguageTag(t.to).displayLanguage}") { Translations.show(card.id, !t.shown) }()
        else item("Translate") { Translations.translate(card, model) }()
        if (Doc.previewLines(card.content, hidden = Doc.Hidden.mark).joinToString("").contains(Doc.HIDE_OPEN)) item("Show hidden words", action = revealHidden)()
        if (!card.template && card.isEntry && edit) item("Save as template") { model.saveAsTemplate(card) }()
        if (model.canManage(card)) item("Share…") { model.panel = EntryPanel.Share(card.id) }()
        if (model.canWrite(card) && !model.viewOnly) DropdownMenuItem(
            text = { Text("View only") }, onClick = { onDismiss(); model.update(card.id) { c -> c.withViewOnly(!card.viewOnly) } },
            trailingIcon = { Switch(card.viewOnly, null) },
        )
        val stack = model.index.stackOf[card.id]
        if (model.canManage(card) || (stack != null && edit)) HorizontalDivider()
        if (model.canManage(card)) item("Vaults…") { model.panel = EntryPanel.Vaults(card.id) }()
        if (stack != null && edit) item("Take out of the stack") { model.update(stack) { s -> s.withStack((s.stack ?: emptyList()).filter { x -> x != card.id }) } }()
        if (!inSheet) item("Pick") { onPick() }()
        if (model.canManage(card)) {
            HorizontalDivider()
            item(if (card.archived) "Unarchive" else "Archive") { model.archive(listOf(card.id), !card.archived) }()
            item("Move to Trash", Theme.alert) { model.trash(listOf(card.id)); if (inSheet) model.openEntry = null }()
        }
    }
}

/**
 * An entry as the device's copy style says, as on the web: rich text (formatted for apps like Gmail, with the
 * Markdown as its plain text, so it pastes back whole), Markdown, or just its words.
 */
fun copyEntry(context: android.content.Context, model: AppModel, card: Card) {
    val markdown = Markdown.entries(listOf(card), model.index)
    val clip = when (Settings.copyStyle) {
        "plain" -> android.content.ClipData.newPlainText("Entry", Markdown.words(card, model.index))
        "markdown" -> android.content.ClipData.newPlainText("Entry", markdown)
        else -> android.content.ClipData.newHtmlText("Entry", markdown, markdownHtml(markdown))
    }
    (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(clip)
    model.say("Copied")
}

/** Several entries at once, oldest first, as the device's copy style says. */
fun copyEntries(context: android.content.Context, model: AppModel, cards: List<Card>) {
    val markdown = Markdown.entries(cards, model.index)
    val clip = when (Settings.copyStyle) {
        "plain" -> android.content.ClipData.newPlainText("Entries", cards.joinToString("\n\n") { Markdown.words(it, model.index) })
        "markdown" -> android.content.ClipData.newPlainText("Entries", markdown)
        else -> android.content.ClipData.newHtmlText("Entries", markdown, markdownHtml(markdown))
    }
    (context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(clip)
    model.say("Copied ${cards.size}")
}

/** Markdown as simple HTML, for apps that paste formatted text: bold, italics, links and lines. */
fun markdownHtml(md: String): String {
    fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return md.lines().joinToString("<br>") { line ->
        esc(line)
            .replace(Regex("\\*\\*(.+?)\\*\\*"), "<b>$1</b>")
            .replace(Regex("(?<![*\\w])\\*(?!\\s)(.+?)\\*"), "<i>$1</i>")
            .replace(Regex("\\[([^\\]]+)]\\((https?://[^)]+)\\)"), "<a href=\"$2\">$1</a>")
    }
}

/** Whether Copy gives plain words rather than Markdown: a setting on each device, as on the web. */
fun copyPlain(model: AppModel) = Settings.copyStyle == "plain"

/** One entry's own preview style; what it leaves out follows the device's setting. */
private fun setPreview(model: AppModel, card: Card, key: String, value: String) = model.update(card.id) { c ->
    var preview = c.payload["preview"].obj ?: JsonObject(emptyMap())
    preview = if (value.isEmpty()) preview.with(key, null) else preview.with(key, j(value))
    c.with("preview", if (preview.isEmpty()) null else preview)
}

/** A copy under Templates, to start new entries from; the entry stays where it is. */
fun AppModel.saveAsTemplate(source: Card) {
    perform { repo ->
        var extra = jobj("template" to j(true))
        source.color?.let { extra = extra.with("color", j(it.name)) }
        repo.createEntry(source.type == CardType.todo, title = source.title, content = source.content, pages = source.turnPages, tags = source.tags, vaultId = source.vaultId, extra = extra)
    }
    say("Saved as a template", undoable = true)
}

/** A new entry from a template: its words with the date filled in and its checklists unticked. */
fun AppModel.startFrom(template: Card) {
    val fields = template.fromTemplate(today)
    perform { repo ->
        val tags = fields["tags"].arr?.mapNotNull { it.str } ?: emptyList()
        val pages = fields["pages"].arr ?: emptyList()
        var extra = jobj()
        fields["color"]?.let { extra = extra.with("color", it) }
        fields["preview"]?.let { extra = extra.with("preview", it) }
        val card = repo.createEntry(fields["type"].str == "todo", title = fields["title"].str ?: "", content = fields["content"] ?: Doc.empty, pages = pages, tags = tags, vaultId = template.vaultId, extra = extra)
        openEntry = card.id
    }
}

/** The panels an entry's menu opens: its tags, due date, vaults, sharing and history. */
@Composable
fun EntryPanelView(panel: EntryPanel, dismiss: () -> Unit) {
    val title = when (panel) {
        is EntryPanel.Tags -> "Tags"
        is EntryPanel.Due -> "Due date"
        is EntryPanel.Vaults -> "Vaults"
        is EntryPanel.Share -> "Share"
        is EntryPanel.History -> "History"
    }
    FullScreen(title, dismiss) {
        when (panel) {
            is EntryPanel.Tags -> TagPicker(panel.id)
            is EntryPanel.Due -> DuePicker(panel.id)
            is EntryPanel.Vaults -> VaultPicker(panel.id)
            is EntryPanel.Share -> SharePanel(panel.id)
            is EntryPanel.History -> EntryHistory(panel.id, dismiss)
        }
    }
}

@Composable
fun CheckRow(label: String, checked: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(horizontal = 20.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = if (enabled) Theme.text else Theme.muted)
        if (checked) Icon(Icons.Outlined.Check, null, tint = Theme.accent)
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(text, Modifier.padding(start = 20.dp, top = 18.dp, bottom = 4.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
}

/** Picks an entry's tags: those offered in its vault, a group's tags by its rule, and a new one typed in. */
@Composable
fun TagPicker(id: String) {
    val model = LocalModel.current
    val card = model.card(id) ?: return
    var query by remember { mutableStateOf("") }
    val offered = tagsFor(model.index.tags, card.vaultId, model.sharedInto)
    val groups = model.index.tagGroups
    val shown = offered.filter { query.isEmpty() || it.title.contains(query, ignoreCase = true) }
    fun change(next: List<String>) = model.update(id) { c -> c.withTags(next) }
    fun make() {
        val name = query.trim().replace("#", "")
        if (name.isEmpty()) return
        val existing = tagNamed(name, model.index.tags, card.vaultId, model.sharedInto)
        if (existing != null) model.update(id) { c -> c.withTags(groups.with(c.tags, existing.id)) }
        else model.perform { repo ->
            val group = repo.action()
            val tag = repo.createTag(title = name, vaultId = card.vaultId, group = group)
            repo.update(id, group) { c -> c.withTags(c.tags + tag.id) }
        }
        query = ""
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Box(Modifier.padding(horizontal = 4.dp)) {
            PageSearchField(query, { query = it }) { query = "" }
        }
        if (query.isNotBlank() && tagNamed(query, offered, card.vaultId, model.sharedInto) == null && !groups.isGroupName(query)) {
            Text("Make “${query.trim()}”", Modifier.fillMaxWidth().clickable { make() }.padding(horizontal = 20.dp, vertical = 13.dp), color = Theme.accent, fontWeight = FontWeight.SemiBold)
        }
        for (group in groups.groups) {
            val members = group.members.filter { m -> shown.any { it.id == m.id } }
            if (members.isEmpty()) continue
            SectionTitle(group.title + if (group.choosesOne) " (one)" else "")
            for (tag in members) CheckRow(tag.displayTitle, tag.id in card.tags) { change(group.pick(card.tags, if (tag.id in card.tags && group.choosesOne) null else tag.id)) }
        }
        SectionTitle("Tags")
        for (tag in shown.filter { groups.groupOf[it.id] == null }) {
            CheckRow(tag.displayTitle, tag.id in card.tags) { change(if (tag.id in card.tags) card.tags - tag.id else card.tags + tag.id) }
        }
    }
}

@Composable
fun SwitchRow(label: String, on: Boolean, enabled: Boolean = true, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { set(!on) }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Theme.text)
        Switch(on, set, enabled = enabled)
    }
}

/** A todo's due date, time, start, repeat and Waiting. */
@Composable
fun DuePicker(id: String) {
    val model = LocalModel.current
    val context = LocalContext.current
    val card = model.card(id) ?: return
    var picking by remember { mutableStateOf<String?>(null) }
    fun set(change: (Card) -> Card) = model.update(id, change = change)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        SwitchRow("Due date", card.due != null) { on ->
            // Taking the date off takes the time and repeat with it.
            set { c -> if (on) c.withDue(model.today) else c.withDue(null).with("dueTime", null).with("repeat", null) }
        }
        val due = card.due
        if (due != null) {
            Row(Modifier.fillMaxWidth().clickable { picking = "due" }.padding(horizontal = 20.dp, vertical = 13.dp)) {
                Text("Due", Modifier.weight(1f), color = Theme.text)
                Text(DateKey.relativeDay(due, model.today), color = Theme.accent, fontWeight = FontWeight.SemiBold)
            }
            Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((label, days) in listOf("Today" to 0, "Tomorrow" to 1, "Next week" to 7)) OutlinedButton(onClick = { set { it.withDue(DateKey.adding(days, model.today)) } }) { Text(label) }
            }
            SwitchRow("At a time", card.dueTime != null) { on -> set { it.withDueTime(if (on) "09:00" else null) } }
            card.dueTime?.let { time ->
                Row(Modifier.fillMaxWidth().clickable {
                    val p = time.split(":").map { it.toInt() }
                    TimePickerDialog(context, { _, h, m -> set { c -> c.withDueTime("%02d:%02d".format(h, m)) } }, p[0], p[1], android.text.format.DateFormat.is24HourFormat(context)).show()
                }.padding(horizontal = 20.dp, vertical = 13.dp)) {
                    Text("Time", Modifier.weight(1f), color = Theme.text)
                    Text(TimeKey.format(time), color = Theme.accent, fontWeight = FontWeight.SemiBold)
                }
            }
            ChoiceRow("Repeat", card.repeat?.label ?: "Never", inset = 20.dp) { close ->
                MenuCheck("Never", card.repeat == null) { close(); set { it.withRepeat(null).with("repeat", null) } }
                val choices = repeatChoices + listOfNotNull(card.repeat?.takeIf { it !in repeatChoices })
                for (r in choices) MenuCheck(r.label, card.repeat == r) { close(); set { it.withRepeat(r) } }
            }
            SwitchRow("Starts on a day", card.start != null) { on -> set { it.withStart(if (on) minOf(due, model.today) else null) } }
            card.start?.let { start ->
                Row(Modifier.fillMaxWidth().clickable { picking = "start" }.padding(horizontal = 20.dp, vertical = 13.dp)) {
                    Text("Start", Modifier.weight(1f), color = Theme.text)
                    Text(DateKey.relativeDay(start, model.today), color = Theme.accent, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Theme.line)
        SwitchRow("Waiting on someone or something", card.waiting) { on -> set { it.withWaiting(on) } }
    }
    picking?.let { which ->
        DayPicker(if (which == "due") card.due else card.start, { picking = null }) { day ->
            set { c -> if (which == "due") c.withDue(day) else c.withStart(c.due?.let { minOf(it, day) } ?: day) }
        }
    }
}


/** One day picked from a month. */
@Composable
fun DayPicker(day: String?, dismiss: () -> Unit, pick: (String) -> Unit) {
    var month by remember { mutableStateOf(DateKey.monthKey(day ?: DateKey.today())) }
    Sheet(dismiss) {
        Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            MonthHeader(month) { month = it }
            MonthGrid(month, emptySet(), day?.let { it..it }) { pick(it); dismiss() }
        }
    }
}

/** Which vaults an entry is in: it lives in one, and can be shared into others. */
@Composable
fun VaultPicker(id: String) {
    val model = LocalModel.current
    val card = model.card(id) ?: return
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        SectionTitle("Lives in")
        for (vault in model.vaults.filter { it.role != "viewer" && !it.isWithheld }) {
            CheckRow(vault.name, card.vaultId == vault.id, enabled = vault.id !in model.lockedVaults) { model.perform { it.move(id, vault.id) } }
        }
        val shared = model.sharedInto[card.id]
        if (!shared.isNullOrEmpty()) {
            SectionTitle("Also in")
            for (v in shared) Text(model.vault(v)?.name ?: v, Modifier.padding(horizontal = 20.dp, vertical = 13.dp), color = Theme.text)
        }
    }
}
