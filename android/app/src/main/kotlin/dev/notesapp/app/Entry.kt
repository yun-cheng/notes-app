package dev.notesapp.app

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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.notesapp.core.Card
import dev.notesapp.core.CardColor
import dev.notesapp.core.CardType
import dev.notesapp.core.DateKey
import dev.notesapp.core.Doc
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
 * An entry opened to read or change, over the page it was opened from, as the web app's sheet at `/journal/:id`: a
 * todo's title and checkbox, the text, its pages, tags, due date and vaults, its links and comments.
 */
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
    var menu by remember { mutableStateOf(false) }
    var tools by remember { mutableStateOf<(@Composable () -> Unit)?>(null) }
    // Its pages, and a blank one being added: kept only once something is written on it.
    val stored = listOf(card.content) + card.morePages
    val pages = stored + List(maxOf(0, page + 1 - stored.size)) { Doc.empty }
    fun saveTitle() {
        val c = model.card(id) ?: return
        // Only what was typed here: a title it opened with mustn't undo a rename made elsewhere since.
        if (!model.canEdit(c) || title == opened || title == c.title) return
        val t = title
        model.perform { it.update(id, typed = true) { x -> x.withTitle(t) } }
    }
    DisposableEffect(id) { onDispose { saveTitle() } }

    FullScreen(if (card.type == CardType.todo) "Todo" else if (card.isStack) "Stack" else "Note", { saveTitle(); dismiss() }, actions = {
        if (edit) {
            IconButton(onClick = { model.panel = EntryPanel.Tags(id) }) { Icon(Icons.Outlined.Label, "Tags", tint = Theme.text) }
            IconButton(onClick = { page = pages.size }) { Icon(Icons.Outlined.NoteAdd, "Add a page", tint = Theme.text) }
        }
        IconButton(onClick = { model.panel = EntryPanel.History(id) }) { Icon(Icons.Outlined.History, "History", tint = Theme.text) }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "More", tint = Theme.text) }
            EntryMenu(card, menu, onDismiss = { menu = false }, revealHidden = {}, onPick = {}, inSheet = true)
        }
    }) {
      Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (card.viewOnly || !model.canWrite(card)) {
                IconText(Icons.Outlined.Lock, if (card.viewOnly) "View only. Turn it off in the entry's menu to change it." else "You can view this entry.")
            }
            if (card.type == CardType.todo) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TodoCheck(card)
                    TitleField(title, "Todo", edit) { title = it }
                }
                TodoDates(card)
            } else if (card.isStack || card.title.isNotEmpty()) {
                TitleField(title, if (card.isStack) "Stack" else "Title", edit) { title = it }
            }
            if (pages.size > 1 || page > 0) {
                Row(Modifier.clip(RoundedCornerShape(10.dp)).background(Theme.sunken).padding(2.dp)) {
                    pages.indices.forEach { i ->
                        Text(
                            "Page ${i + 1}", Modifier.clip(RoundedCornerShape(8.dp)).background(if (page == i) Theme.raised else Color.Transparent).clickable { page = i }.padding(horizontal = 12.dp, vertical = 5.dp),
                            fontSize = 14.sp, color = Theme.text, fontWeight = if (page == i) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    }
                }
            }
            androidx.compose.runtime.key("$id:$page") {
                DocEditor(pages[page], edit, { doc -> savePage(model, id, page, doc) }, onTools = { tools = it })
            }
            if (card.isStack) StackPreview(card)
            BubbleAttachments(card)
            BubbleTags(card)
            Backlinks(card)
            CommentsSection(card)
        }
        tools?.let { HorizontalDivider(color = Theme.line); it() }
      }
    }
}

@Composable
private fun TitleField(title: String, placeholder: String, edit: Boolean, set: (String) -> Unit) {
    BasicTextField(
        title, set, Modifier.fillMaxWidth(), enabled = edit,
        textStyle = androidx.compose.ui.text.TextStyle(color = Theme.text, fontSize = 20.sp, fontWeight = FontWeight.SemiBold), cursorBrush = SolidColor(Theme.accent),
        decorationBox = { inner -> if (title.isEmpty()) Text(placeholder, color = Theme.muted, fontSize = 20.sp, fontWeight = FontWeight.SemiBold); inner() },
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

/** What links here and what's tagged with it. */
@Composable
fun Backlinks(card: Card) {
    val model = LocalModel.current
    val links = model.index.backlinks[card.id] ?: return
    if (links.isEmpty()) return
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(if (card.type == CardType.tag) "Tagged" else "Linked from", fontWeight = FontWeight.SemiBold, color = Theme.text)
        for (link in links.take(30).distinctBy { it.from.id }) Text(link.from.displayTitle, Modifier.clickable { model.openEntry = link.from.id }, color = Theme.accent)
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
    val clipboard = LocalClipboardManager.current
    var level by remember(open) { mutableStateOf("") }
    val edit = model.canEdit(card)
    fun item(label: String, color: Color? = null, action: () -> Unit) = @Composable {
        DropdownMenuItem(text = { Text(label, color = color ?: Theme.text) }, onClick = { onDismiss(); action() })
    }
    fun sub(label: String, to: String) = @Composable {
        DropdownMenuItem(text = { Text(label) }, onClick = { level = to }, trailingIcon = { Icon(Icons.Outlined.ChevronRight, null) })
    }
    DropdownMenu(open, onDismiss) {
        when (level) {
            "color" -> {
                item("None") { setColor(model, card, null) }()
                for (c in CardColor.entries) DropdownMenuItem(
                    text = { Text(Theme.colorName(c)) }, onClick = { onDismiss(); setColor(model, card, c) },
                    leadingIcon = { Icon(if (card.color == c) Icons.Outlined.Check else Icons.Outlined.Circle, null, tint = Theme.tint(c)) },
                )
            }
            "style" -> {
                Text("Link previews", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontSize = 12.sp, color = Theme.muted)
                val links = card.payload["preview"]["links"].str ?: ""
                for ((v, l) in listOf("" to "As set on this device", "card" to "Card", "compact" to "One line", "off" to "Off")) MenuCheck(l, links == v) { onDismiss(); setPreview(model, card, "links", v) }
                HorizontalDivider()
                Text("Photos", Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontSize = 12.sp, color = Theme.muted)
                val photos = card.payload["preview"]["photos"].str ?: ""
                for ((v, l) in listOf("" to "As set on this device", "large" to "Large", "thumbs" to "Thumbnails", "off" to "Count")) MenuCheck(l, photos == v) { onDismiss(); setPreview(model, card, "photos", v) }
            }
            "more" -> {
                val t = Translations.states[card.id]
                if (t is Translations.State.Done) item(if (t.shown) "Show original" else "Show in ${java.util.Locale.forLanguageTag(t.to).displayLanguage}") { Translations.show(card.id, !t.shown) }()
                else item("Translate") { Translations.translate(card, model) }()
                if (Doc.previewLines(card.content, hidden = Doc.Hidden.mark).joinToString("").contains(Doc.HIDE_OPEN)) item("Show hidden words", action = revealHidden)()
                if (!card.template && card.isEntry) item("Save as template") { model.saveAsTemplate(card) }()
                if (model.canManage(card)) item("Share…") { model.panel = EntryPanel.Share(card.id) }()
                if (model.canWrite(card) && !model.viewOnly) DropdownMenuItem(
                    text = { Text("View only") }, onClick = { onDismiss(); model.perform { it.update(card.id) { c -> c.withViewOnly(!card.viewOnly) } } },
                    trailingIcon = { Switch(card.viewOnly, null) },
                )
                item("History") { model.panel = EntryPanel.History(card.id) }()
                HorizontalDivider()
                if (model.canManage(card)) item("Vaults…") { model.panel = EntryPanel.Vaults(card.id) }()
                val stack = model.index.stackOf[card.id]
                if (stack != null && edit) item("Take out of the stack") { model.perform { it.update(stack) { s -> s.withStack((s.stack ?: emptyList()).filter { x -> x != card.id }) } } }()
                if (!inSheet) item("Pick") { onPick() }()
            }
            else -> {
                if (!inSheet) item(if (edit) "Edit" else "Open") { model.openEntry = card.id }()
                if (card.template) item("Use this template") { model.startFrom(card) }()
                item("Copy") {
                    clipboard.setText(AnnotatedString(if (copyPlain(model) ) Markdown.words(card, model.index) else Markdown.entries(listOf(card), model.index)))
                    model.say("Copied")
                }()
                if (edit) {
                    item("Tags…") { model.panel = EntryPanel.Tags(card.id) }()
                    if (card.type == CardType.todo) item("Due date…") { model.panel = EntryPanel.Due(card.id) }()
                    item(if (card.type == CardType.todo) "Make it a note" else "Make it a todo") {
                        model.perform { it.retype(card.id, if (card.type == CardType.todo) CardType.note else CardType.todo) }
                    }()
                    if (card.type == CardType.todo && !card.isDone) item(if (card.waiting) "No longer waiting" else "Waiting") {
                        model.perform { it.update(card.id) { c -> c.withWaiting(!card.waiting) } }
                    }()
                    sub("Style", "style")()
                    sub("Color", "color")()
                }
                sub("More", "more")()
                if (model.canManage(card)) {
                    HorizontalDivider()
                    item(if (card.archived) "Unarchive" else "Archive") { model.archive(listOf(card.id), !card.archived) }()
                    item("Move to Trash", Theme.alert) { model.trash(listOf(card.id)); if (inSheet) model.openEntry = null }()
                }
            }
        }
    }
}

/** Whether Copy gives plain words rather than Markdown: a setting on each device, as on the web. */
fun copyPlain(model: AppModel) = Settings.copyStyle == "plain"

/** One entry's own preview style; what it leaves out follows the device's setting. */
private fun setPreview(model: AppModel, card: Card, key: String, value: String) {
    model.perform {
        it.update(card.id) { c ->
            var preview = c.payload["preview"].obj ?: JsonObject(emptyMap())
            preview = if (value.isEmpty()) preview.with(key, null) else preview.with(key, j(value))
            c.with("preview", if (preview.isEmpty()) null else preview)
        }
    }
}

private fun setColor(model: AppModel, card: Card, color: CardColor?) = model.perform { it.update(card.id) { c -> c.withColor(color) } }

/** A copy under Templates, to start new entries from; the entry stays where it is. */
fun AppModel.saveAsTemplate(source: Card) {
    perform { repo ->
        var extra = jobj("template" to j(true))
        source.color?.let { extra = extra.with("color", j(it.name)) }
        if (source.type == CardType.todo) repo.createTodo(title = source.title, content = source.content, pages = source.turnPages, tags = source.tags, vaultId = source.vaultId, extra = extra)
        else repo.createNote(title = source.title, content = source.content, pages = source.turnPages, tags = source.tags, vaultId = source.vaultId, extra = extra)
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
        val card = if (fields["type"].str == "todo") repo.createTodo(title = fields["title"].str ?: "", content = fields["content"] ?: Doc.empty, pages = pages, tags = tags, vaultId = template.vaultId, extra = extra)
        else repo.createNote(title = fields["title"].str ?: "", content = fields["content"] ?: Doc.empty, pages = pages, tags = tags, vaultId = template.vaultId, extra = extra)
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
    fun change(next: List<String>) = model.perform { it.update(id) { c -> c.withTags(next) } }
    fun make() {
        val name = query.trim().replace("#", "")
        if (name.isEmpty()) return
        val existing = tagNamed(name, model.index.tags, card.vaultId, model.sharedInto)
        if (existing != null) model.perform { it.update(id) { c -> c.withTags(groups.with(c.tags, existing.id)) } }
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
    var repeating by remember { mutableStateOf(false) }
    fun set(change: (Card) -> Card) = model.perform { it.update(id, change = change) }
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
            Box {
                Row(Modifier.fillMaxWidth().clickable { repeating = true }.padding(horizontal = 20.dp, vertical = 13.dp)) {
                    Text("Repeat", Modifier.weight(1f), color = Theme.text)
                    Text(card.repeat?.label ?: "Never", color = Theme.accent, fontWeight = FontWeight.SemiBold)
                }
                DropdownMenu(repeating, { repeating = false }) {
                    MenuCheck("Never", card.repeat == null) { repeating = false; set { it.withRepeat(null).with("repeat", null) } }
                    val choices = repeatChoices + listOfNotNull(card.repeat?.takeIf { it !in repeatChoices })
                    for (r in choices) MenuCheck(r.label, card.repeat == r) { repeating = false; set { it.withRepeat(r) } }
                }
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
