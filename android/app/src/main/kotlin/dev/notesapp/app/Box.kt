package dev.notesapp.app

import dev.notesapp.core.label
import dev.notesapp.core.word
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Add
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Layers
import dev.notesapp.core.DateKey
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Title
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.Card
import dev.notesapp.core.CardType
import dev.notesapp.core.Doc
import dev.notesapp.core.EntryParser
import dev.notesapp.core.Markdown
import dev.notesapp.core.SaveOptions
import dev.notesapp.core.SaveResult
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.Vault
import dev.notesapp.core.arr
import dev.notesapp.core.get
import dev.notesapp.core.jarr
import dev.notesapp.core.jobj
import dev.notesapp.core.j
import dev.notesapp.core.stackPlan
import dev.notesapp.core.str
import dev.notesapp.core.tagsForAll
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/**
 * The box at the foot of the journal, as the web app's `JournalBox`: `[]` makes a todo, `#tag` files it, `#diary`
 * sends it to the Diary vault, and `@fri @3pm @weekly` give a todo its date, time and repeat. Return is a new line and
 * the arrow saves. What's typed but not saved is kept as a draft, one for each view of the journal.
 */
@Composable
fun JournalBox(filter: StreamFilter) {
    val model = LocalModel.current
    // The web's name for this view's draft, so the box's draft follows the account to its other devices.
    val draftKey = filter.copy(sort = StreamFilter.Sort.Written).journalPath
    // The vault what's added goes into: the journal's, or the account's own.
    val targetVault = filter.vaultId ?: model.mainVault?.id ?: ""
    // A draft bound for an encrypted vault stays on this device, in memory only.
    val encrypted = model.vault(targetVault)?.isEncrypted == true
    var text by remember(draftKey) { mutableStateOf(Drafts.get("journal", draftKey)?.let(Drafts::text) ?: "") }
    var todos by remember(filter) { mutableStateOf(filter.effectiveType == StreamFilter.EntryType.todo) }
    var unlock by remember { mutableStateOf<Vault?>(null) }
    var focused by remember { mutableStateOf(false) }
    val attached = remember { mutableStateListOf<JsonElement>() }
    val focus = remember { FocusRequester() }
    val pickers = rememberAttachmentPickers(targetVault) { attached.add(it) }
    var recordNow by remember { mutableStateOf(0) }

    LaunchedEffect(model.focusBox) { if (model.focusBox > 0) runCatching { focus.requestFocus() } }
    LaunchedEffect(model.sharedText) { model.sharedText?.let { text = if (text.isBlank()) it else text + "\n" + it; model.sharedText = null } }
    LaunchedEffect(Drafts.arrived["journal:$draftKey"]) {
        // From another device: taken in while the box here is empty.
        if (text.isEmpty()) Drafts.get("journal", draftKey)?.let { text = Drafts.text(it) }
    }

    fun send() {
        val typed = text
        val added = Transcriber.fill(attached.toList())
        if (typed.isBlank() && added.isEmpty()) return
        // Photos and files go with the last entry written, as in the web's box, where they sit after the words; alone
        // they're a note of their own, or a todo named Photo.
        var entries = EntryParser.parseEntries(if (typed.isBlank() && todos && added.isNotEmpty()) "Photo" else typed, model.today, allTodos = todos)
        if (added.isNotEmpty()) {
            entries = if (entries.isEmpty()) EntryParser.entries(Doc.of(added), model.today)
            else {
                val last = entries.last()
                val words = (last.content["content"].arr ?: emptyList()).filterNot { it["type"].str == "paragraph" && it["content"] == null }
                entries.dropLast(1) + last.copy(content = Doc.of(words + added))
            }
        }
        val opts = SaveOptions.journal(filter, model.today)
        model.scope.launch {
            when (val r = model.save(entries, opts)) {
                is SaveResult.Saved -> {
                    if (text == typed) { text = ""; Drafts.set("journal", draftKey, null) }
                    val sent = added.mapNotNull { it["attrs"]["id"].str }.toSet()
                    attached.removeAll { it["attrs"]["id"].str in sent }
                    model.caughtUp()
                    model.lastSaved = r.ids.lastOrNull()
                }
                is SaveResult.Unlock -> unlock = model.vault(r.vaultId)
                SaveResult.Nothing -> {}
            }
        }
    }

    LaunchedEffect(model.lockedVaults) {
        val v = unlock
        if (v != null && v.id !in model.lockedVaults) { unlock = null; send() }
    }

    Box(Modifier.fillMaxWidth().background(Theme.bg).imePadding(), contentAlignment = Alignment.Center) {
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        unlock?.let { UnlockView(it, Modifier.heightIn(max = 300.dp)) }
        // What's typed after a / that starts the last line, while the menu of things to add is open.
        val slash = text.substringAfterLast('\n').takeIf { it.startsWith("/") && ' ' !in it }?.drop(1)
        // The `#` or `@` word being typed at the end, as the web's box suggests tags and due dates for it.
        val word = text.substringAfterLast(' ').substringAfterLast('\n').takeIf { slash == null && (it.startsWith("#") || it.startsWith("@")) }
        val suggestions = word?.let { typeahead(model, it.first(), it.drop(1), targetVault) }.orEmpty()
        if (word != null && suggestions.isNotEmpty()) TypeaheadMenu(if (word.startsWith("#")) "Tags" else "Due date", suggestions) { item ->
            text = text.dropLast(word.length) + item.insert
            Drafts.set("journal", draftKey, Drafts.doc(text), onlyHere = encrypted)
        }
        if (slash != null) SlashMenu(slash) { item ->
            text = text.substringBeforeLast('\n', "").let { if (text.contains('\n')) "$it\n" else "" } + (item.marker ?: "")
            Drafts.set("journal", draftKey, Drafts.doc(text), onlyHere = encrypted)
            when (item.id) {
                "photo" -> pickers.photos()
                "file" -> pickers.files()
                "voice" -> recordNow++
            }
        }
        if (attached.isNotEmpty()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                attached.forEachIndexed { i, node -> AttachedThumb(node, targetVault) { attached.removeAt(i) } }
            }
        }
        val empty = text.isBlank() && attached.isEmpty()
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Theme.surface).border(1.dp, if (focused) Theme.accent else Theme.line, RoundedCornerShape(22.dp))
                .padding(start = 10.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                if (todos) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, if (todos) "Every line is a todo" else "Write todos",
                Modifier.padding(bottom = 6.dp).size(24.dp).clip(CircleShape).clickable { todos = !todos }, tint = if (todos) Theme.accent else Theme.muted,
            )
            BasicTextField(
                text, { t ->
                    text = t
                    Drafts.set("journal", draftKey, Drafts.doc(t), onlyHere = encrypted)
                },
                Modifier.weight(1f).padding(vertical = 8.dp).focusRequester(focus).onFocusChanged { focused = it.isFocused },
                textStyle = TextStyle(color = Theme.text, fontSize = 16.sp), cursorBrush = SolidColor(Theme.accent), maxLines = 8,
                decorationBox = { inner ->
                    val hint = if (todos) "Todo · @ for a due date, time or repeat" else if (model.diaryVault?.id == targetVault) "Write in the diary" else "Write a note · [] todo · #tag · / for more"
                    if (text.isEmpty()) Text(hint, color = Theme.muted, fontSize = 16.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    inner()
                },
            )
            Icon(Icons.Outlined.Photo, "Add photos", Modifier.padding(bottom = 8.dp).size(22.dp).clickable { pickers.photos() }, tint = Theme.muted)
            Icon(Icons.Outlined.AttachFile, "Attach a file", Modifier.padding(bottom = 8.dp).size(22.dp).clickable { pickers.files() }, tint = Theme.muted)
            VoiceRecordButton(targetVault, recordNow) { attached.add(it) }
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(if (empty) Theme.sunken else Theme.accent).clickable(enabled = !empty) { send() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ArrowUpward, "Save", tint = if (empty) Theme.muted else Theme.onAccent) }
        }
    }
    }
}

/**
 * What can be done to entries picked together, as the web app's `BatchBar`: how many are picked, then icons to tag them
 * (a panel of their tags, each × to take it off all, and a field to add one to all), mark todos done or not, waiting or
 * dated (a panel of Today, Tomorrow, In a week and No date), make them todos or notes, move them to a vault, stack,
 * copy, archive or trash them, and × to stop.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BatchBar(picked: Set<String>, all: List<String>, set: (Set<String>) -> Unit) {
    val model = LocalModel.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val cards = picked.mapNotNull { model.card(it) }.sortedBy { it.createdAt }
    val editable = cards.filter { model.canEdit(it) }
    val manageable = cards.filter { model.canManage(it) }
    val todos = editable.filter { it.type == CardType.todo }
    val open = todos.filter { !it.isDone }
    val waiting = open.isNotEmpty() && open.all { it.waiting }
    val archiving = manageable.any { !it.archived }
    val targets = model.vaults.filter { it.id !in model.lockedVaults && !it.isWithheld && it.role != "viewer" }
    var panel by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf(false) }
    fun count(n: Int, one: String, many: String) = if (n == 1) "1 $one" else "$n $many"
    @Composable
    fun tool(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, active: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(if (active) Theme.accentSoft else androidx.compose.ui.graphics.Color.Transparent)
                .clickable(enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, label, Modifier.size(22.dp), tint = if (!enabled) Theme.muted.copy(alpha = 0.4f) else if (active) Theme.accent else Theme.text) }
    }
    Column(Modifier.fillMaxWidth().background(Theme.surface)) {
        HorizontalDivider(color = Theme.line)
        if (panel == "tags" && cards.isNotEmpty()) BatchTags(editable)
        if (panel == "due" && todos.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            fun due(d: String?) {
                model.performEach(todos.map { it.id }, "Changed the due date of ${count(todos.size, "todo", "todos")}") { repo, id, group -> repo.update(id, group) { it.withDue(d) } }
                panel = null
            }
            val today = model.today
            androidx.compose.material3.OutlinedButton(onClick = { due(today) }) { Text("Today") }
            androidx.compose.material3.OutlinedButton(onClick = { due(DateKey.adding(1, today)) }) { Text("Tomorrow") }
            androidx.compose.material3.OutlinedButton(onClick = { due(DateKey.adding(7, today)) }) { Text("In a week") }
            TextButton(onClick = { due(null) }) { Text("No date") }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (cards.isEmpty()) "Pick entries" else "${cards.size} selected", fontWeight = FontWeight.SemiBold, color = Theme.text, modifier = Modifier.padding(end = 6.dp))
            tool(Icons.AutoMirrored.Outlined.Label, "Tags", panel == "tags", cards.isNotEmpty()) { panel = if (panel == "tags") null else "tags" }
            if (todos.isNotEmpty()) {
                androidx.compose.material3.OutlinedButton(onClick = {
                    val ids = todos.filter { !it.isDone }.map { it.id }
                    val today = model.today
                    model.performEach(ids, "Marked ${ids.size} done") { repo, id, group -> repo.setDone(id, true, today, group) }
                }, contentPadding = PaddingValues(horizontal = 12.dp)) { Text("Done") }
                TextButton(onClick = {
                    val ids = todos.filter { it.isDone }.map { it.id }
                    val today = model.today
                    model.performEach(ids, "Reopened ${ids.size}") { repo, id, group -> repo.setDone(id, false, today, group) }
                }) { Text("Not done") }
                if (open.isNotEmpty()) tool(Icons.Outlined.HourglassEmpty, "Waiting", waiting) {
                    val on = !waiting
                    model.performEach(open.map { it.id }, if (on) "Marked ${open.size} waiting" else "${open.size} no longer waiting") { repo, id, group -> repo.update(id, group) { it.withWaiting(on) } }
                }
                tool(Icons.Outlined.CalendarMonth, "Due date", panel == "due") { panel = if (panel == "due") null else "due" }
            }
            val notes = editable.filter { it.type == CardType.note }
            if (notes.isNotEmpty()) tool(Icons.Outlined.CheckCircle, "Make them todos") {
                model.performEach(notes.map { it.id }, "Made ${notes.size} into ${if (notes.size == 1) "a todo" else "todos"}") { repo, id, group -> repo.retype(id, CardType.todo, group) }
            }
            if (todos.isNotEmpty()) tool(Icons.Outlined.Description, "Make them notes") {
                model.performEach(todos.map { it.id }, "Made ${todos.size} into ${if (todos.size == 1) "a note" else "notes"}") { repo, id, group -> repo.retype(id, CardType.note, group) }
            }
            if (targets.size > 1 && manageable.isNotEmpty()) Box {
                TextButton(onClick = { moving = true }) { Text("Move to…") }
                DropdownMenu(moving, { moving = false }, containerColor = Theme.raised) {
                    for (v in targets) DropdownMenuItem(text = { Text(v.name) }, onClick = {
                        moving = false
                        val ids = manageable.map { it.id }
                        model.performEach(ids, "Moved ${ids.size} to ${v.name}") { repo, id, group -> repo.move(id, v.id, group) }
                    })
                }
            }
            if (editable.size > 1) tool(Icons.Outlined.Layers, "Stack") { stack(model, cards); set(emptySet()) }
            tool(Icons.Outlined.ContentCopy, "Copy", enabled = cards.isNotEmpty()) { copyEntries(context, model, cards) }
            tool(Icons.Outlined.Archive, if (archiving) "Archive" else "Unarchive", enabled = manageable.isNotEmpty()) { model.archive(manageable.map { it.id }, archiving); set(emptySet()) }
            tool(Icons.Outlined.Delete, "Move to Trash", enabled = manageable.isNotEmpty()) { model.trash(manageable.map { it.id }); set(emptySet()) }
            Spacer(Modifier.width(8.dp))
            tool(Icons.Outlined.Close, "Stop selecting") { set(emptySet()) }
        }
    }
}

/** The picked entries' tags, each × to take it off all of them, and a field to add one to all, making it if it's new. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BatchTags(cards: List<Card>) {
    val model = LocalModel.current
    var query by remember { mutableStateOf("") }
    val counts = cards.flatMap { it.tags }.groupingBy { it }.eachCount()
    val present = model.index.resolveTags(model.index.tagGroups.order(counts.keys.toList()))
    val vaultIds = cards.map { it.vaultId }.distinct()
    val offered = tagsForAll(model.index.tags, vaultIds, model.sharedInto)
    val q = query.trim().lowercase()
    val options = if (q.isEmpty()) emptyList() else offered.filter { it.title.lowercase().contains(q) }.take(6)
    val exact = offered.firstOrNull { it.title.lowercase() == q }
    fun entries(n: Int) = if (n == 1) "1 entry" else "$n entries"
    fun add(id: String, name: String) {
        query = ""
        val groups = model.index.tagGroups
        model.performEach(cards.map { it.id }, "Tagged ${entries(cards.size)} #$name") { repo, cid, group -> repo.update(cid, group) { it.withTags(groups.with(it.tags, id)) } }
    }
    fun create() {
        val name = query.trim().removePrefix("#")
        if (name.isEmpty()) return
        if (exact != null) return add(exact.id, exact.displayTitle)
        val id = java.util.UUID.randomUUID().toString()
        val vault = vaultIds.singleOrNull()
        model.perform { it.createTag(id = id, title = name, vaultId = vault) }
        add(id, name)
    }
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (present.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (tag in present) Row(
                Modifier.clip(RoundedCornerShape(50)).background(tag.color?.let { Theme.tint(it).copy(alpha = 0.24f) } ?: Theme.sunken).padding(start = 10.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text("#" + tag.displayTitle, fontSize = 13.sp, color = Theme.text)
                counts[tag.id]?.takeIf { it < cards.size }?.let { Text("$it", fontSize = 13.sp, color = Theme.muted) }
                Icon(Icons.Outlined.Close, "Remove #${tag.displayTitle} from the selected entries", Modifier.size(16.dp).clickable {
                    val ids = cards.filter { tag.id in it.tags }.map { it.id }
                    model.performEach(ids, "Removed #${tag.displayTitle} from ${entries(ids.size)}") { repo, cid, group -> repo.update(cid, group) { it.withTags(it.tags - tag.id) } }
                }, tint = Theme.muted)
            }
        }
        FormField(query, { query = it }, "Add a tag to all", onDone = ::create)
        if (q.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (t in options) androidx.compose.material3.OutlinedButton(onClick = { add(t.id, t.displayTitle) }) { Text(t.displayTitle) }
            if (exact == null) androidx.compose.material3.OutlinedButton(onClick = ::create) { Text("Create “${query.trim().removePrefix("#")}”") }
        }
    }
}

/** A new stack of the picked entries, or, with a stack among them, into that one. */
fun stack(model: AppModel, cards: List<Card>) {
    val ordered = cards.sortedBy { it.createdAt }
    val stacks = model.index.live.filter { it.isStack }
    val into = ordered.firstOrNull { it.isStack }
    val ids = ordered.map { it.id }
    val vault = ordered.firstOrNull()?.vaultId
    val group = model.repo.action()
    model.perform { repo ->
        val target = into ?: repo.createNote(stack = emptyList(), vaultId = vault, group = group)
        for ((stackId, list) in stackPlan(ids, target, stacks + target)) repo.update(stackId, group) { it.withStack(list) }
    }
    model.say("Stacked ${ids.size}", undoable = true)
}

/** One choice in a menu that opens while a `#` or `@` word is typed: what it says, a hint, and what it puts in place of the word. */
data class TypeaheadItem(val id: String, val label: String, val hint: String?, val icon: androidx.compose.ui.graphics.vector.ImageVector, val insert: String)

/** What's offered for a `#` or `@` word, as the web's `tagItems` and `dateItems`: tags, or dates, times and repeats. */
fun typeahead(model: AppModel, mark: Char, query: String, vaultId: String): List<TypeaheadItem> {
    val q = query.trim().lowercase()
    if (mark == '#') {
        val tags = dev.notesapp.core.tagsFor(model.index.tags, vaultId, model.sharedInto)
        val found = tags.filter { q.isEmpty() || it.title.lowercase().contains(q) }
            .sortedWith(compareBy({ !it.title.lowercase().startsWith(q) }, { !it.pinned }))
            .take(6)
            .map { TypeaheadItem(it.id, "#" + it.title, model.index.tagGroups.groupOf[it.id]?.title, Icons.AutoMirrored.Outlined.Label, "#${it.title} ") }
            .toMutableList()
        val exact = tags.any { it.title.lowercase() == q } || q in listOf("todo", "diary") || model.index.tagGroups.isGroupName(q)
        if (q.isNotEmpty() && !exact && q.all { it.isLetterOrDigit() || it == '_' || it == '-' }) found.add(TypeaheadItem("new", "#" + query.trim(), "new tag", Icons.Outlined.Add, "#${query.trim()} "))
        return found
    }
    val today = model.today
    val weekday = { d: String -> java.time.LocalDate.parse(d).dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault()).lowercase() }
    val words = listOf("today", "tomorrow") + (2..7).map { weekday(DateKey.adding(it, today)) }
    val typed = if (Regex("""\d{4}-\d{2}-\d{2}""").matches(q) && dev.notesapp.core.EntryParser.parseDue(q, today) != null) listOf(q) else emptyList()
    val items = (words + typed).filter { it.startsWith(q) }.mapNotNull { w ->
        dev.notesapp.core.EntryParser.parseDue(w, today)?.let { TypeaheadItem(w, "@$w", DateKey.relativeDay(it, today), Icons.Outlined.CalendarMonth, "@$w ") }
    }.toMutableList()
    dev.notesapp.core.TimeKey.parse(q)?.let { items.add(TypeaheadItem("time", "@$q", dev.notesapp.core.TimeKey.format(it), Icons.Outlined.Schedule, "@$q ")) }
    if (q.isNotEmpty()) for (r in dev.notesapp.core.repeatChoices) {
        val w = r.word
        if (w.startsWith(q)) items.add(TypeaheadItem(w, "@$w", r.label, Icons.Outlined.Repeat, "@$w "))
    }
    return items
}

@Composable
fun TypeaheadMenu(title: String, items: List<TypeaheadItem>, pick: (TypeaheadItem) -> Unit) {
    Column(Modifier.widthIn(max = 320.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(12.dp)).padding(bottom = 4.dp)) {
        Text(title, Modifier.padding(start = 10.dp, top = 6.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted)
        for (item in items) Row(Modifier.fillMaxWidth().clickable { pick(item) }.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(item.icon, null, Modifier.size(18.dp), tint = Theme.muted)
            Text(item.label, Modifier.weight(1f), color = Theme.text)
            item.hint?.let { Text(it, fontSize = 12.sp, color = Theme.muted) }
        }
    }
}

/** The box's menu of things to add, as the web's / menu: a todo, lists, a quote, a heading, a photo, a file or a voice message, narrowed by what's typed after the /. */
data class SlashItem(val id: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val hint: String?, val words: String, val marker: String?)

val slashItems = listOf(
    SlashItem("todo", "Todo", Icons.Outlined.CheckBox, "[]", "todo task checkbox", "[] "),
    SlashItem("bullets", "Bullet list", Icons.AutoMirrored.Outlined.FormatListBulleted, "-", "bullet list", "- "),
    SlashItem("numbers", "Numbered list", Icons.Outlined.FormatListNumbered, "1.", "numbered ordered list", "1. "),
    SlashItem("quote", "Quote", Icons.Outlined.FormatQuote, ">", "quote blockquote", "> "),
    SlashItem("photo", "Photo", Icons.Outlined.Photo, null, "photo image picture", null),
    SlashItem("file", "File", Icons.Outlined.AttachFile, null, "file attach attachment document pdf upload", null),
    SlashItem("voice", "Voice message", Icons.Outlined.Mic, null, "voice message record audio sound microphone dictate transcript", null),
    SlashItem("heading", "Heading", Icons.Outlined.Title, "#", "heading title", "# "),
)

@Composable
fun SlashMenu(query: String, pick: (SlashItem) -> Unit) {
    val q = query.lowercase()
    val shown = slashItems.filter { q.isEmpty() || it.label.lowercase().startsWith(q) || it.words.split(" ").any { w -> w.startsWith(q) } }
    if (shown.isEmpty()) return
    Column(Modifier.widthIn(max = 320.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(12.dp)).padding(bottom = 4.dp)) {
        Text("Add", Modifier.padding(start = 10.dp, top = 6.dp), fontSize = 12.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = Theme.muted)
        for (item in shown) Row(Modifier.fillMaxWidth().clickable { pick(item) }.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(item.icon, null, Modifier.size(20.dp), tint = Theme.muted)
            Text(item.label, Modifier.weight(1f), color = Theme.text)
            item.hint?.let { Text(it, fontSize = 12.sp, color = Theme.muted, fontFamily = Theme.mono) }
        }
    }
}
