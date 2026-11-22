package dev.notesapp.app

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
            entries = if (entries.isEmpty()) EntryParser.entries(jobj("type" to j("doc"), "content" to jarr(added)), model.today)
            else {
                val last = entries.last()
                val words = (last.content["content"].arr ?: emptyList()).filterNot { it["type"].str == "paragraph" && it["content"] == null }
                entries.dropLast(1) + last.copy(content = jobj("type" to j("doc"), "content" to jarr(words + added)))
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
                    if (text.isEmpty()) Text(if (todos) "Write a todo · @fri · #tag" else "Write a note · [] todo · #tag", color = Theme.muted, fontSize = 16.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    inner()
                },
            )
            Icon(Icons.Outlined.Photo, "Add photos", Modifier.padding(bottom = 8.dp).size(22.dp).clickable { pickers.photos() }, tint = Theme.muted)
            Icon(Icons.Outlined.AttachFile, "Attach a file", Modifier.padding(bottom = 8.dp).size(22.dp).clickable { pickers.files() }, tint = Theme.muted)
            VoiceRecordButton(targetVault) { attached.add(it) }
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(if (empty) Theme.sunken else Theme.accent).clickable(enabled = !empty) { send() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Outlined.ArrowUpward, "Save", tint = if (empty) Theme.muted else Theme.onAccent) }
        }
    }
    }
}

/**
 * What can be done to entries picked together, as the web app's `BatchBar`: tag them, finish them, stack them, copy,
 * archive or trash them.
 */
@Composable
fun BatchBar(picked: Set<String>, all: List<String>, set: (Set<String>) -> Unit) {
    val model = LocalModel.current
    val clipboard = LocalClipboardManager.current
    val cards = picked.mapNotNull { model.card(it) }
    var tagging by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(Theme.surface)) {
        HorizontalDivider(color = Theme.line)
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${picked.size} picked", fontWeight = FontWeight.SemiBold, color = Theme.text, modifier = Modifier.padding(end = 4.dp))
            TextButton(onClick = { set(all.toSet()) }) { Text("All") }
            Box {
                TextButton(onClick = { tagging = true }) { Text("Tag") }
                DropdownMenu(tagging, { tagging = false }) {
                    for (tag in tagsForAll(model.index.tags, cards.map { it.vaultId }.distinct(), model.sharedInto)) {
                        DropdownMenuItem(text = { Text(tag.displayTitle) }, onClick = {
                            tagging = false
                            val groups = model.index.tagGroups
                            val ids = picked.toList()
                            model.performEach(ids, "Tagged ${ids.size}") { repo, id, group -> repo.update(id, group) { it.withTags(groups.with(it.tags, tag.id)) } }
                        })
                    }
                }
            }
            if (cards.any { it.type == CardType.todo && !it.isDone }) TextButton(onClick = {
                val today = model.today
                val ids = cards.filter { it.type == CardType.todo && !it.isDone }.map { it.id }
                model.performEach(ids, "Done") { repo, id, group -> repo.setDone(id, true, today, group) }
            }) { Text("Done") }
            TextButton(onClick = { stack(model, cards); set(emptySet()) }, enabled = cards.size >= 2) { Text("Stack") }
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(Markdown.entries(cards.sortedBy { it.createdAt }, model.index)))
                model.say("Copied ${cards.size}")
            }) { Text("Copy") }
            TextButton(onClick = { model.archive(picked.toList(), true); set(emptySet()) }) { Text("Archive") }
            TextButton(onClick = { model.trash(picked.toList()); set(emptySet()) }) { Text("Trash", color = Theme.alert) }
            Icon(Icons.Outlined.Close, "Stop picking", Modifier.padding(start = 4.dp).size(22.dp).clickable { set(emptySet()) }, tint = Theme.muted)
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
