package dev.notesapp.app

import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.material.icons.outlined.DragIndicator
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.automirrored.outlined.Redo
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.border
import dev.notesapp.core.CardType
import dev.notesapp.core.Doc
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.ApiError
import dev.notesapp.core.Backlink
import dev.notesapp.core.Board
import dev.notesapp.core.Card
import dev.notesapp.core.Change
import dev.notesapp.core.Changes
import dev.notesapp.core.DateKey
import dev.notesapp.core.EntryParser
import dev.notesapp.core.RecentVersion
import dev.notesapp.core.Stream
import dev.notesapp.core.StreamFilter
import dev.notesapp.core.TagGroup
import dev.notesapp.core.j
import dev.notesapp.core.jstrings
import dev.notesapp.core.moveMember
import dev.notesapp.core.offeredIn
import dev.notesapp.core.tagNamed
import dev.notesapp.core.tagVaults
import dev.notesapp.core.SaveOptions
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/** The vaults a tag can be kept to: open here, not withheld, and changeable. */
fun tagHomes(model: AppModel) = model.vaults.filter { it.id !in model.lockedVaults && !it.isWithheld && it.role != "viewer" }

/**
 * Sets the vaults a tag is offered in (null: every vault): it lives in one of them and is in the others besides, as an
 * entry can be, so their members see it. Being in another vault needs a connection.
 */
fun setTagVaults(tag: Card, next: List<String>?, model: AppModel) {
    val shared = model.sharedInto[tag.id] ?: emptyList()
    val home = next?.let { if (tag.vaultId in it) tag.vaultId else it[0] }
    val besides = next?.filter { it != home } ?: emptyList()
    val api = model.api
    model.scope.launch {
        try {
            for (v in shared) if (v !in besides) api.unshare(tag.id, "vault", v)
            model.repo.setTagScope(tag.id, home)
            if (besides.any { it !in shared }) {
                // The server must have it where it now lives before it can be in other vaults besides.
                model.sync?.sync()
                for (v in besides) if (v !in shared) api.share(tag.id, vaultId = v, role = "edit")
            }
            model.sync?.sync()
            model.say("${tag.title} is offered in ${next?.mapNotNull { model.vault(it)?.name }?.joinToString(", ") ?: "all vaults"}")
        } catch (e: Exception) {
            model.say(if (e is ApiError.Offline) "Offering a tag in more than one vault needs a connection." else "That didn't work. A new tag can go in more vaults once it has synced.")
        }
    }
}

/**
 * Every tag, as the web app's Tags page: groups first, like Priority (one per entry, in order) or Topics (any number),
 * each renamed, set to one or any number, ordered, its tags moved up and down; then tags in no group. A tag is renamed
 * in place, pinned to the sidebar, kept to one or more vaults or offered in all, and moved to the Trash.
 */
@Composable
fun TagsPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var newGroup by remember { mutableStateOf("") }
    var newTag by remember { mutableStateOf("") }
    var pickedVault by remember { mutableStateOf<String?>(null) }
    val newTagVault = pickedVault ?: model.mainVault?.id ?: ""
    val groups = model.index.tagGroups
    fun makeGroup() {
        val title = newGroup.trim()
        if (title.isEmpty()) return
        if (groups.isGroupName(title) || model.index.tags.any { it.title.equals(title, ignoreCase = true) }) { model.say("There's a $title already."); return }
        newGroup = ""
        model.perform { it.createTag(title = title, members = emptyList()) }
    }
    fun makeTag() {
        val title = newTag.trim().replace("#", "")
        if (title.isEmpty()) return
        val vault = newTagVault.ifEmpty { null }
        if (tagNamed(title, model.index.tags, vault ?: model.mainVault?.id, model.sharedInto) != null) { model.say("There's a $title tag already."); return }
        newTag = ""
        model.perform { it.createTag(title = title, vaultId = vault) }
    }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Tags", openDrawer, filters = false)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            FormSection("Groups", footer = null) {
                FormText("A group gathers tags under a name. In a group of one choice, like Priority, an entry takes one of its tags, and adding another swaps it. An ordered group can sort the journal.")
            }
            for (group in groups.groups) GroupBlock(group)
            FormSection {
                if (groups.groups.none { it.title.equals("Priority", ignoreCase = true) }) FormButton("Add Priority: High, Medium, Low") {
                    model.perform { repo ->
                        val ids = listOf("High", "Medium", "Low").map { repo.createTag(title = it).id }
                        repo.createTag(title = "Priority", members = ids, choosesOne = true, ordered = true)
                    }
                }
                FormField(newGroup, { newGroup = it }, "New group, like Topics or Area", onDone = ::makeGroup)
                FormButton("Add group", enabled = newGroup.isNotBlank(), onClick = ::makeGroup)
            }
            FormSection(if (groups.groups.isEmpty()) "Tags" else "Other tags") {
                FormText("A tag is kept to the vaults you pick: it's offered only on entries there, and everyone in them has it. One for all vaults is offered everywhere, and only you see it.")
                FormField(newTag, { newTag = it }, "New tag", onDone = ::makeTag)
                ChoiceRow("Where the new tag can go", model.vault(newTagVault)?.name ?: "All vaults") { close ->
                    for (v in tagHomes(model)) MenuCheck(v.name, newTagVault == v.id) { pickedVault = v.id; close() }
                    MenuCheck("All vaults", newTagVault.isEmpty()) { pickedVault = ""; close() }
                }
                FormButton("Add tag", enabled = newTag.isNotBlank(), onClick = ::makeTag)
                FormDivider()
                groups.loose.forEachIndexed { i, t -> if (i > 0) FormDivider(); TagRow(t) }
                if (groups.loose.isEmpty()) FormText(if (model.index.tags.isEmpty()) "No tags yet. Pin a tag and it appears as a folder." else "Every tag is in a group.")
            }
        }
    }
}

/** A tag's color, shown on its chips: a dot that opens the colors. */
@Composable
fun TagColorDot(tag: Card) {
    val model = LocalModel.current
    var open by remember { mutableStateOf(false) }
    Box {
        val tint = tag.color?.let { Theme.tint(it) }
        Box(Modifier.size(18.dp).clip(CircleShape).background(tint ?: androidx.compose.ui.graphics.Color.Transparent).border(1.5.dp, tint ?: Theme.muted, CircleShape).clickable { open = true })
        androidx.compose.material3.DropdownMenu(open, { open = false }) { Swatches(tag.color) { c -> open = false; model.update(tag.id) { it.withColor(c) } } }
    }
}

/** A tag's row: its name, leading to its entries, with a menu to rename, keep to vaults, pin, order and trash it. */
@Composable
fun TagRow(tag: Card, group: TagGroup? = null, rank: Int? = null) {
    val model = LocalModel.current
    var menu by remember { mutableStateOf(false) }
    var vaultsMenu by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<String?>(null) }
    val count = model.index.backlinks[tag.id]?.count { it.kind == Backlink.Kind.tag } ?: 0
    val vaults = tag.tagVaults(model.sharedInto)
    /** Entries hold the tag itself, not its name, so they all follow. A name another tag has where this one can go, or a group's, is refused. */
    fun rename(text: String) {
        editing = null
        val name = text.trim().replace("#", "")
        if (name.isEmpty() || name == tag.title) return
        val places = tag.tagVaults(model.sharedInto) ?: model.vaults.map { it.id }
        model.index.tags.firstOrNull { t -> t.id != tag.id && t.title.equals(name, ignoreCase = true) && places.any { v -> t.offeredIn(v, model.sharedInto) } }?.let {
            model.say("There's a ${it.title} tag already."); return
        }
        if (model.index.tagGroups.isGroupName(name)) { model.say("$name is a group's name."); return }
        val old = tag.title
        model.update(tag.id) { c -> c.withTitle(name) }
        model.say("Renamed $old to $name", undoable = true)
    }
    fun members(next: List<String>) = group?.let { g -> model.update(g.id) { c -> c.with("members", jstrings(next)) } }
    val e = editing
    if (e != null) {
        FormField(e, { editing = it }, "Name", onDone = { rename(e) })
        return
    }
    Box {
        Row(Modifier.fillMaxWidth().clickable { model.page = Page.Journal(StreamFilter(tagId = tag.id)) }.padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            rank?.let { Text("$it", fontSize = 12.sp, color = Theme.muted) }
            TagColorDot(tag)
            if (tag.pinned) Icon(Icons.Outlined.PushPin, "Pinned to the sidebar", Modifier.size(16.dp), tint = Theme.muted)
            Column(Modifier.weight(1f)) {
                Text(tag.displayTitle, color = Theme.text, fontWeight = FontWeight.SemiBold)
                Text((if (count == 1) "1 entry" else "$count entries") + " · " + (vaults?.mapNotNull { model.vault(it)?.name }?.joinToString(", ") ?: "All vaults"), fontSize = 12.sp, color = Theme.muted)
            }
            if (group != null) {
                Icon(Icons.Outlined.KeyboardArrowUp, "Move up", Modifier.size(28.dp).clickable(enabled = group.members.first().id != tag.id) { members(moveMember(group.members.map { it.id }, tag.id, -1)) }, tint = Theme.muted)
                Icon(Icons.Outlined.KeyboardArrowDown, "Move down", Modifier.size(28.dp).clickable(enabled = group.members.last().id != tag.id) { members(moveMember(group.members.map { it.id }, tag.id, 1)) }, tint = Theme.muted)
            }
            Icon(Icons.Outlined.MoreVert, "More", Modifier.size(36.dp).clip(RoundedCornerShape(50)).clickable { menu = true }.padding(6.dp), tint = Theme.muted)
        }
        DropdownMenu(menu, { menu = false }, Modifier.align(Alignment.TopEnd)) {
            DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; editing = tag.title })
            DropdownMenuItem(text = { Text("Vaults…") }, onClick = { menu = false; vaultsMenu = true })
            DropdownMenuItem(text = { Text(if (tag.pinned) "Unpin from the sidebar" else "Pin to the sidebar") }, onClick = { menu = false; model.update(tag.id) { c -> c.with("pinned", j(!tag.pinned)) } })
            if (group != null) DropdownMenuItem(text = { Text("Take out of the group (the tag stays)") }, onClick = { menu = false; members(group.members.map { it.id }.filter { it != tag.id }) })
            if (model.canManage(tag)) DropdownMenuItem(text = { Text("Move to Trash", color = Theme.alert) }, onClick = {
                menu = false
                model.perform { it.setDeleted(tag.id, true) }
                model.say("Moved ${tag.title} to Trash" + if (count > 0) ", off $count ${if (count == 1) "entry" else "entries"}" else "", undoable = true)
            })
        }
        DropdownMenu(vaultsMenu, { vaultsMenu = false }, Modifier.align(Alignment.TopEnd)) {
            MenuCheck("All vaults", !tag.keptToVault || vaults == null) { vaultsMenu = false; if (tag.keptToVault && vaults != null) setTagVaults(tag, null, model) }
            HorizontalDivider()
            for (v in tagHomes(model)) {
                val on = vaults?.contains(v.id) == true
                MenuCheck(v.name, on) {
                    vaultsMenu = false
                    val next = (vaults ?: emptyList()).toMutableList()
                    if (on) next.remove(v.id)
                    else if (v.isPrivate && next.isNotEmpty()) { model.say("${v.name} keeps its tags to itself: it's locked by a PIN."); return@MenuCheck }
                    else next.add(v.id)
                    setTagVaults(tag, next.ifEmpty { null }, model)
                }
            }
        }
    }
}

/** A tag group: its name, its rule (one per entry or any number), whether it's ordered, its tags, and adding one. */
@Composable
fun GroupBlock(group: TagGroup) {
    val model = LocalModel.current
    var name by remember(group.id) { mutableStateOf(group.title) }
    var adding by remember { mutableStateOf("") }
    fun set(key: String, value: kotlinx.serialization.json.JsonElement) = model.update(group.id) { c -> c.with(key, value) }
    /** Adds a tag to this group; it leaves any other group it was in. */
    fun addTag(tagId: String) {
        val groupCards = model.index.live.filter { it.isGroup }
        model.perform { repo ->
            val action = repo.action()
            for (other in groupCards) if (other.id != group.id && tagId in (other.members ?: emptyList())) repo.update(other.id, action) { c -> c.with("members", jstrings((other.members ?: emptyList()) - tagId)) }
            repo.update(group.id, action) { c -> c.with("members", jstrings(group.members.map { it.id }.filter { it != tagId } + tagId)) }
        }
        adding = ""
    }
    fun add() {
        val q = adding.trim().replace("#", "")
        if (q.isEmpty()) return
        val found = model.index.tags.firstOrNull { it.title.equals(q, ignoreCase = true) }
        if (found != null) addTag(found.id) else model.perform { repo ->
            val action = repo.action()
            val tag = repo.createTag(title = q, group = action)
            repo.update(group.id, action) { c -> c.with("members", jstrings(group.members.map { it.id } + tag.id)) }
        }
        adding = ""
    }
    FormSection(group.title) {
        FormField(name, { name = it }, "Group name", onDone = { val t = name.trim(); if (t.isEmpty() || t == group.title) name = group.title else set("title", j(t)) })
        Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
            Segmented(listOf("One per entry" to "one", "Any number" to "many"), if (group.choosesOne) "one" else "many") { set("choice", j(it)) }
        }
        SwitchRow("Ordered, to sort the journal by it", group.ordered) { set("ordered", j(it)) }
        group.members.forEachIndexed { i, tag -> FormDivider(); TagRow(tag, group, if (group.ordered) i + 1 else null) }
        FormDivider()
        FormField(adding, { adding = it }, "Add a tag to ${group.title}", onDone = ::add)
        val q = adding.trim().lowercase()
        if (q.isNotEmpty()) for (t in model.index.tags.filter { t -> t.title.lowercase().contains(q) && group.members.none { it.id == t.id } }.take(8)) {
            Text(t.title + (model.index.tagGroups.groupOf[t.id]?.let { " (from ${it.title})" } ?: ""), Modifier.fillMaxWidth().clickable { addTag(t.id) }.padding(horizontal = 16.dp, vertical = 10.dp), color = Theme.accent)
        }
        FormButton("Remove group", color = Theme.alert) {
            model.perform { it.setDeleted(group.id, true) }
            model.say("Removed the ${group.title} group. Its tags stay on entries.", undoable = true)
        }
    }
}

/**
 * What was changed, newest first, as the web app's History page: on this device, with Undo and Redo for each, and on
 * other devices, by AI apps and by people sharing, each marked with who or what made it and with an Undo of its own.
 * A filter narrows it as it narrows the journal.
 */
private data class HistoryRow(val group: String, val changes: List<Change>, val at: Long, val by: String? = null)

@Composable
fun HistoryPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var local by remember { mutableStateOf<List<Change>>(emptyList()) }
    var current by remember { mutableStateOf<Map<String, Card>>(emptyMap()) }
    var versions by remember { mutableStateOf<List<RecentVersion>>(emptyList()) }
    // The server's versions read as changes, worked out when they or the cards change rather than on every redraw.
    var synced by remember { mutableStateOf<List<Pair<RecentVersion, Change>>>(emptyList()) }
    var next by remember { mutableStateOf<String?>(null) }
    var offline by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(StreamFilter()) }
    var fetched by remember { mutableStateOf(0L) }
    var loadMore by remember { mutableStateOf(0) }
    LaunchedEffect(model.cardsVersion, loadMore) {
        val rows = model.repo.changes()
        local = rows.map { it.first }
        current = rows.mapNotNull { r -> r.second?.let { r.first.cardId to it } }.toMap()
        // The server's history is asked again at most every half minute; this device's log at each change.
        val more = loadMore > 0 && next != null
        if (more || System.currentTimeMillis() - fetched >= 30_000) {
            fetched = System.currentTimeMillis()
            try {
                val page = model.api.recentVersions(if (more) next else null)
                val known = versions.map { it.id }.toSet()
                versions = if (more) versions + page.versions.filter { it.id !in known } else page.versions
                next = page.next
                offline = false
            } catch (_: Exception) { offline = true }
        }
        // Each is decoded, and opened if sealed, off the main thread; again when the cards change, as a vault opened
        // or locked reads differently.
        val repo = model.repo
        val all = versions
        synced = withContext(Dispatchers.Default) { all.mapNotNull { v -> repo.syncedChange(v)?.let { v to it } } }
    }
    val locked = model.lockedVaults
    val rows = remember(local, synced, filter, locked, model.today, next) {
        val shown = { c: Change -> c.after.vaultId !in locked && Changes.matches(c, filter, model.today) }
        // Older changes here wait for the server's versions of their time, so the history has no gaps.
        val reach = next?.split("-")?.firstOrNull()?.toLongOrNull() ?: Long.MIN_VALUE
        val mine = Changes.grouped(local.filter(shown)).map { HistoryRow(it.group, it.changes, it.at) }.filter { it.at >= reach || next == null }
        val logOf = local.groupBy { it.cardId }
        val theirs = synced.mapNotNull { (v, change) ->
            if (!shown(change) || Changes.inLog(change, v, logOf[change.cardId] ?: emptyList())) null
            else HistoryRow(change.group, listOf(change.copy(by = v.madeBy)), change.until, v.madeBy)
        }
        (mine + theirs).sortedByDescending { it.at }
    }
    val days = rows.groupBy { DateKey.of(java.time.Instant.ofEpochMilli(it.at)) }.toSortedMap(reverseOrder())
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("History", openDrawer) {
            androidx.compose.material3.IconButton(onClick = { model.undo() }) { Icon(Icons.AutoMirrored.Outlined.Undo, "Undo", tint = Theme.text) }
            androidx.compose.material3.IconButton(onClick = { model.redo() }) { Icon(Icons.AutoMirrored.Outlined.Redo, "Redo", tint = Theme.text) }
        }
        FilterRow(filter, { filter = it }, {})
        // Lazy, as the history can be long: only the rows on screen are laid out.
        androidx.compose.foundation.lazy.LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
            item { Text("What was changed, newest first: on this device, on your other devices, by AI apps and by people you share with.", Modifier.padding(vertical = 8.dp), color = Theme.muted) }
            if (offline) item { Text("Connect to the internet to see changes made elsewhere.", color = Theme.muted) }
            if (rows.isEmpty()) item { Text(if (filter.isFiltered) "No changes here match. Take a filter off above, or pick another." else "Nothing has been changed yet.", Modifier.padding(vertical = 24.dp), color = Theme.muted) }
            for ((day, dayRows) in days) {
                item(key = "day:$day") { Text(DateKey.relativeDay(day, model.today), Modifier.padding(top = 14.dp, bottom = 4.dp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Theme.muted) }
                for (row in dayRows) item(key = "g:${row.group}") {
                    Column {
                        if (row.changes.size > 1) {
                            val undo = row.changes.filter { it.n >= 0 && it.undoneAt == null && Changes.canUndo(it, current[it.cardId] ?: model.card(it.cardId)) }
                            val redo = row.changes.filter { it.n >= 0 && it.undoneAt != null && Changes.canRedo(it, current[it.cardId] ?: model.card(it.cardId)) }
                            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text("${row.changes.size} changes at once", fontSize = 13.sp, color = Theme.muted)
                                if (undo.size > 1) TextButton(onClick = { model.perform { it.revert(undo.map { c -> c.n }, true) } }) { Text("Undo all") }
                                if (redo.size > 1) TextButton(onClick = { model.perform { it.revert(redo.map { c -> c.n }, false) } }) { Text("Redo all") }
                            }
                        }
                        for (change in row.changes) ChangeRow(change, current[change.cardId])
                        androidx.compose.material3.HorizontalDivider(color = Theme.line)
                    }
                }
            }
            if (next != null) item { TextButton(onClick = { loadMore++ }) { Text("Show older changes") } }
            else if (rows.isNotEmpty()) item { Text("Undo and redo reach back through the newest 500 changes made on this device. Every version of an entry, with restore, is in its own version history.", Modifier.padding(top = 16.dp), fontSize = 13.sp, color = Theme.muted) }
        }
    }
}

/**
 * One change, as the web's row: what it did and the entry's name, opening it; when, who or what made it, whether it was
 * undone or the entry changed since; the words it changed, shown on request; its entry's version history; and Undo or
 * Redo.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChangeRow(change: Change, current: Card?) {
    val model = LocalModel.current
    var open by remember { mutableStateOf(false) }
    val card = model.card(change.cardId)
    val now = current ?: card
    val undone = change.undoneAt != null
    val undoable = if (change.n < 0) now != null && Changes.canUndo(change, now) && model.canEdit(now) else !undone && Changes.canUndo(change, now)
    val redoable = change.n >= 0 && undone && Changes.canRedo(change, now)
    val passed = !change.sealed && now != null && !(if (undone) Changes.canRedo(change, now) else Changes.canUndo(change, now))
    val compared = !change.sealed && (change.before == null || change.fields.any { it in setOf("title", "content", "pages", "back", "tags") })
    val type = (card ?: change.after).type
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp).then(if (undone) Modifier.alpha(0.6f) else Modifier), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(if (change.sealed) Icons.Outlined.Lock else if (type == CardType.tag) Icons.Outlined.Label else if (type == CardType.todo) Icons.Outlined.CheckBox else Icons.Outlined.Description, null, Modifier.size(20.dp), tint = Theme.muted)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(Changes.describe(change), color = Theme.muted)
                Text(
                    if (change.sealed) "Locked entry" else (card ?: change.after).displayTitle,
                    if (card != null && !card.deleted && !change.sealed) Modifier.clickable { model.openEntry = card.id } else Modifier,
                    fontWeight = FontWeight.SemiBold, color = Theme.text, maxLines = 1,
                )
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(formatMillis(change.until, date = null), fontSize = 13.sp, color = Theme.muted)
                change.by?.let { Text(it, Modifier.clip(RoundedCornerShape(50)).background(Theme.sunken).padding(horizontal = 7.dp, vertical = 1.dp), fontSize = 13.sp, color = Theme.muted) }
                if (undone) Text("Undone", fontSize = 13.sp, color = Theme.muted)
                if (passed) Text("Changed since", fontSize = 13.sp, color = Theme.muted)
                if (compared) Text(if (open) "Hide changes" else "Show changes", Modifier.clickable { open = !open }, fontSize = 13.sp, color = Theme.muted, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)
                if (change.by != null && card != null && !change.sealed) Text("Version history", Modifier.clickable { model.panel = EntryPanel.History(card.id) }, fontSize = 13.sp, color = Theme.muted, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)
            }
            if (open && compared) ChangeComparison(change)
        }
        if (undoable) androidx.compose.material3.OutlinedButton(onClick = {
            if (change.n < 0) { model.perform { it.takeBack(change) }; model.say("Undone", undoable = true) } else model.perform { it.revert(listOf(change.n), true) }
        }) { Text("Undo") }
        if (redoable) androidx.compose.material3.OutlinedButton(onClick = { model.perform { it.revert(listOf(change.n), false) } }) { Text("Redo") }
    }
}

/** What a change did to the words, as the web's comparison: the lines it took out and put in, with a line of what's around each. */
@Composable
private fun ChangeComparison(change: Change) {
    val lines = remember(change.n) { diffLines(changeText(change.before), changeText(change.after)) }
    val added = Theme.p.added
    val removed = Theme.p.removed
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Theme.surface).border(1.dp, Theme.line, RoundedCornerShape(10.dp)).padding(8.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
        if (lines.none { it.first != ' ' }) Text("Only the formatting changed.", color = Theme.muted, fontSize = 14.sp)
        for ((kind, text) in lines) when (kind) {
            '…' -> Text("…", color = Theme.muted)
            '+' -> Text(text, Modifier.fillMaxWidth().background(added).padding(horizontal = 4.dp), color = Theme.text, fontSize = 14.sp)
            '-' -> Text(text, Modifier.fillMaxWidth().background(removed).padding(horizontal = 4.dp), color = Theme.text, fontSize = 14.sp, textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough)
            else -> Text(text, color = Theme.muted, fontSize = 14.sp)
        }
    }
}

private fun changeText(card: Card?): List<String> {
    card ?: return emptyList()
    return (if (card.title.isEmpty()) emptyList() else listOf(card.title)) + (listOf(card.content) + card.morePages).flatMap { Doc.previewLines(it, hidden = Doc.Hidden.mask) }
}

/** The lines that differ, by the longest run they share, with one line of context around each change: ' ', '+', '-' or '…' for a gap. */
fun diffLines(a: List<String>, b: List<String>): List<Pair<Char, String>> {
    val n = a.size
    val m = b.size
    val lcs = Array(n + 1) { IntArray(m + 1) }
    for (i in n - 1 downTo 0) for (j in m - 1 downTo 0) lcs[i][j] = if (a[i] == b[j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
    val all = mutableListOf<Pair<Char, String>>()
    var i = 0
    var j = 0
    while (i < n || j < m) {
        if (i < n && j < m && a[i] == b[j]) { all.add(' ' to a[i]); i++; j++ }
        else if (j < m && (i == n || lcs[i][j + 1] >= lcs[i + 1][j])) { all.add('+' to b[j]); j++ }
        else { all.add('-' to a[i]); i++ }
    }
    val out = mutableListOf<Pair<Char, String>>()
    all.forEachIndexed { k, line ->
        val near = (maxOf(0, k - 1)..minOf(all.size - 1, k + 1)).any { all[it].first != ' ' }
        if (line.first != ' ' || near) out.add(line) else if (out.isNotEmpty() && out.last().first != '…') out.add('…' to "")
    }
    if (out.lastOrNull()?.first == '…') out.removeAt(out.size - 1)
    return out
}

/**
 * The journal as a board, as the web app's `board.tsx`: by todo state (Open, Waiting, Done), or with a tag group's
 * tags as columns. A card is moved to another column, or up and down in its own, from its menu; one is added straight
 * into a column.
 */
@Composable
fun BoardView(filter: StreamFilter, board: String) {
    val model = LocalModel.current
    val items = Stream.items(model.index, filter.copy(board = null), model.today, model.sharedInto)
    val group = model.index.tagGroups.groups.firstOrNull { it.id == board }
    val columns = if (board == Board.STATE) Board.stateColumns(items) else group?.let { Board.columns(items, it) } ?: emptyList()
    if (columns.isEmpty()) { FormText("The tag group for this board is gone."); return }
    // A card held by its grip, as the web's on a phone: a copy follows the finger, and it's dropped in the column and
    // at the place under it.
    val drag = remember { BoardDrag() }
    val scroll = rememberScrollState()
    var width by remember { mutableStateOf(0f) }
    // Near the board's left or right side, it scrolls that way while a card is held there, as the web's.
    LaunchedEffect(drag.card != null) {
        while (drag.card != null) {
            val x = drag.point.x - drag.origin.x
            val edge = 64f
            if (x < edge) scroll.scrollBy(-18f) else if (x > width - edge) scroll.scrollBy(18f)
            kotlinx.coroutines.delay(16)
        }
    }
    Box(Modifier.fillMaxSize().onGloballyPositioned { drag.origin = it.positionInRoot(); width = it.size.width.toFloat() }) {
        Row(Modifier.fillMaxSize().horizontalScroll(scroll).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (column in columns) BoardColumnView(column, columns, group, filter, drag)
        }
        drag.card?.let { held ->
            val at = drag.point - drag.origin - drag.grab
            Box(Modifier.offset { androidx.compose.ui.unit.IntOffset(at.x.toInt(), at.y.toInt()) }.graphicsLayer(alpha = 0.9f, shadowElevation = 12f)) {
                BubbleView(held, 280.dp)
            }
        }
    }
}

/** Where a board's cards and columns are, and the card being dragged, for dropping it where the finger lets go. */
class BoardDrag {
    var card by mutableStateOf<Card?>(null)
    var point by mutableStateOf(androidx.compose.ui.geometry.Offset.Zero)
    var grab = androidx.compose.ui.geometry.Offset.Zero
    var origin = androidx.compose.ui.geometry.Offset.Zero
    val columns = mutableMapOf<String, androidx.compose.ui.geometry.Rect>()
    val cards = mutableMapOf<String, androidx.compose.ui.geometry.Rect>()
    val grips = mutableMapOf<String, androidx.compose.ui.geometry.Offset>()

    /** The column under the finger, and how many of its cards (other than the one held) are above it. */
    fun target(all: List<dev.notesapp.core.BoardColumn>): Pair<dev.notesapp.core.BoardColumn, Int>? {
        val column = all.firstOrNull { c -> columns[c.key]?.let { point.x in it.left..it.right } == true } ?: return null
        val index = column.items.count { it.card.id != card?.id && (cards[it.card.id]?.center?.y ?: Float.MAX_VALUE) < point.y }
        return column to index
    }
}

/** A card dropped at `index` in `to`: its place saved, and moved there from another column, its tag or state changed. */
fun boardDrop(model: AppModel, card: Card, to: dev.notesapp.core.BoardColumn, index: Int, group: TagGroup?) {
    if (!model.canEdit(card)) return
    val others = to.items.map { it.card }.filter { it.id != card.id }
    val places = Board.place(card, index, others)
    val today = model.today
    val groups = model.index.tagGroups.groups
    val action = model.repo.action()
    model.perform { repo ->
        val at = System.currentTimeMillis()
        val updated = repo.update(card.id, action) { c ->
            val moved = when {
                group != null -> Board.groupMove(c, group, Board.columnOf(c, group), to.key, today, at)
                else -> Board.TodoState.entries.firstOrNull { it.name == to.key }?.let { Board.stateMove(c, it, today, at, groups) } ?: c
            }
            // A repeating todo moved on to its next date stays where it was.
            val movedOn = moved.repeat != null && moved.due != c.due
            if (!movedOn) places[c.id]?.let { moved.withPosition(it) } ?: moved else moved
        }
        for ((other, p) in places) if (other != card.id) repo.update(other, action) { it.withPosition(p) }
        if (updated?.repeat != null && updated.due != card.due) updated.due?.let { model.say("Next due ${DateKey.relativeDayInSentence(it, today)}", undoable = true) }
    }
}

@Composable
private fun BoardColumnView(column: dev.notesapp.core.BoardColumn, columns: List<dev.notesapp.core.BoardColumn>, group: TagGroup?, filter: StreamFilter, drag: BoardDrag) {
    val model = LocalModel.current
    var adding by remember { mutableStateOf("") }
    fun drop(card: Card, to: dev.notesapp.core.BoardColumn, index: Int) = boardDrop(model, card, to, index, group)
    /** A new card straight into this column: with its tag, or in its state. */
    fun add() {
        val text = adding.trim()
        if (text.isEmpty()) return
        var opts = SaveOptions.journal(filter, model.today)
        val state = Board.TodoState.entries.firstOrNull { it.name == column.key }
        if (group != null && column.key.isNotEmpty()) opts = opts.copy(tags = listOf(column.key))
        if (state == Board.TodoState.waiting) opts = opts.copy(waiting = true)
        var entries = EntryParser.parseEntries(text, model.today, allTodos = state != null)
        if (state == Board.TodoState.done) entries = entries.map { it.copy(done = true) }
        adding = ""
        model.scope.launch { model.save(entries, opts) }
    }
    Column(Modifier.width(300.dp).fillMaxHeight().onGloballyPositioned { drag.columns[column.key] = it.boundsInRoot() }.clip(RoundedCornerShape(12.dp)).background(Theme.sunken.copy(alpha = 0.5f)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(column.title, fontWeight = FontWeight.SemiBold, color = Theme.text)
            Text("${column.items.size}", color = Theme.muted)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            column.items.forEachIndexed { i, item ->
                var menu by remember { mutableStateOf(false) }
                val held = drag.card?.id == item.card.id
                Box(Modifier.onGloballyPositioned { drag.cards[item.card.id] = it.boundsInRoot() }.graphicsLayer(alpha = if (held) 0.35f else 1f)) {
                    // Pressing a card opens it, as the web's; its grip moves it, dragged, or from its menu, tapped.
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { BubbleView(item.card, 280.dp); EntryAttachments(item.card) }
                    if (model.canEdit(item.card) && !model.viewOnly) Icon(
                        Icons.Outlined.DragIndicator, "Drag to move, or tap for a menu",
                        Modifier.align(Alignment.TopEnd).padding(4.dp).size(28.dp).clip(RoundedCornerShape(6.dp)).background(Theme.surface)
                            .onGloballyPositioned { drag.grips[item.card.id] = it.positionInRoot() }
                            .pointerInput(item.card.id) {
                                detectDragGestures(
                                    onDragStart = { o ->
                                        val inRoot = (drag.grips[item.card.id] ?: androidx.compose.ui.geometry.Offset.Zero) + o
                                        drag.grab = inRoot - (drag.cards[item.card.id]?.topLeft ?: inRoot)
                                        drag.point = inRoot
                                        drag.card = item.card
                                    },
                                    onDrag = { change, amount -> change.consume(); drag.point += amount },
                                    onDragEnd = {
                                        val card = drag.card
                                        drag.target(columns)?.let { (to, at) -> if (card != null) drop(card, to, at) }
                                        drag.card = null
                                    },
                                    onDragCancel = { drag.card = null },
                                )
                            }
                            .clickable { menu = true }.padding(4.dp),
                        tint = Theme.muted,
                    )
                    DropdownMenu(menu, { menu = false }) {
                        if (i > 0) DropdownMenuItem(text = { Text("Move up") }, onClick = { menu = false; drop(item.card, column, i - 1) })
                        if (i < column.items.size - 1) DropdownMenuItem(text = { Text("Move down") }, onClick = { menu = false; drop(item.card, column, i + 1) })
                        for (other in columns) if (other.key != column.key) DropdownMenuItem(text = { Text("Move to ${other.title}") }, onClick = { menu = false; drop(item.card, other, other.items.size) })
                        DropdownMenuItem(text = { Text("Open") }, onClick = { menu = false; model.openEntry = item.card.id })
                    }
                }
            }
        }
        if (!model.viewOnly) FormField(adding, { adding = it }, if (column.key == "done") "Add a done todo" else "Add a card", onDone = ::add)
    }
}
