package dev.notesapp.app

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material3.Button
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.notesapp.core.ApiError
import dev.notesapp.core.Card
import dev.notesapp.core.CardComment
import dev.notesapp.core.CardShares
import dev.notesapp.core.Doc
import dev.notesapp.core.ServerApi
import dev.notesapp.core.VaultCrypto
import dev.notesapp.core.VaultKeys
import dev.notesapp.core.VersionInfo
import dev.notesapp.core.j
import dev.notesapp.core.modernPayload
import dev.notesapp.core.restoreFields
import dev.notesapp.core.str
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val roles = listOf("view" to "Can view", "comment" to "Can comment", "edit" to "Can edit")

/**
 * Sharing one entry, as the web app's `ShareDialog`: with people by email, with everyone in one of this account's
 * vaults, and by public links anyone can open, each with how far they may go (view, comment, edit).
 */
@Composable
fun SharePanel(id: String) {
    val model = LocalModel.current
    val clipboard = LocalClipboardManager.current
    var shares by remember { mutableStateOf<CardShares?>(null) }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("view") }
    var failed by remember { mutableStateOf<String?>(null) }
    var expires by remember { mutableStateOf(0) }
    fun run(work: suspend (ServerApi) -> CardShares) {
        val api = model.api
        model.scope.launch {
            try { shares = work(api); failed = null } catch (_: ApiError.Offline) { failed = "Sharing needs a connection." } catch (_: Exception) { failed = "That didn't work. Try again." }
        }
    }
    LaunchedEffect(id) { run { it.shares(id) } }
    fun change(email: String, r: String) = run { it.share(id, email = email, role = r) }
    fun changeVault(vaultId: String, r: String) { run { it.share(id, vaultId = vaultId, role = r) }; model.sync?.schedule(model.scope, 500) }
    fun remove(type: String, target: String) { run { it.unshare(id, type, target) }; model.sync?.schedule(model.scope, 500) }
    val card = model.card(id)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        if (card != null && model.vault(card.vaultId)?.isEncrypted == true) {
            FormText("This entry is in an encrypted vault, so it can be shared only by sharing the vault.")
            return@Column
        }
        FormSection("People") {
            FormField(email, { email = it }, "Email", keyboard = androidx.compose.ui.text.input.KeyboardType.Email)
            ChoiceRow("Role", roles.first { it.first == role }.second) { close -> for ((r, l) in roles) MenuCheck(l, role == r) { role = r; close() } }
            FormButton("Share", enabled = email.contains("@")) { val a = email.trim(); email = ""; change(a, role) }
            for (p in shares?.people ?: emptyList()) { FormDivider(); ShareRow(p.name.ifEmpty { p.email }, p.email, p.role, { remove("user", p.user_id) }) { change(p.email, it) } }
            for (i in shares?.invites ?: emptyList()) { FormDivider(); ShareRow(i.email, "Invited: they'll see it once they sign in", i.role, { remove("invite", i.email) }) { change(i.email, it) } }
        }
        FormSection("Vaults") {
            val shared = shares?.vaults?.map { it.vault_id }?.toSet() ?: emptySet()
            for (v in shares?.vaults ?: emptyList()) ShareRow(v.name, "${v.members} ${if (v.members == 1) "person" else "people"}", v.role, { remove("vault", v.vault_id) }) { changeVault(v.vault_id, it) }
            val others = model.vaults.filter { it.id != card?.vaultId && it.id !in shared && !it.isEncrypted && it.role != "viewer" }
            if (others.isNotEmpty()) ChoiceRow("Share with a vault", "Pick…") { close -> for (v in others) DropdownMenuItem(text = { Text(v.name) }, onClick = { close(); changeVault(v.id, "edit") }) }
        }
        FormSection("Public links", "Anyone with a link can read this entry, without signing in.") {
            for (link in shares?.links ?: emptyList()) {
                val url = model.api.publicLink(link.token)
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    SelectionContainer { Text(url, fontFamily = Theme.mono, fontSize = 13.sp, color = Theme.text, maxLines = 1) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(link.expires_at?.let { "Until " + DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(it)) } ?: "Doesn't expire", Modifier.weight(1f), fontSize = 12.sp, color = Theme.muted)
                        TextButton(onClick = { clipboard.setText(AnnotatedString(url)); model.say("Link copied") }) { Text("Copy") }
                        TextButton(onClick = { run { it.deleteLink(id, link.token) } }) { Text("Stop sharing", color = Theme.alert) }
                    }
                }
                FormDivider()
            }
            val labels = mapOf(0 to "Never", 1 to "In a day", 7 to "In a week", 30 to "In 30 days")
            ChoiceRow("Expires", labels[expires]!!) { close -> for ((d, l) in labels) MenuCheck(l, expires == d) { expires = d; close() } }
            FormButton("Make a public link") { run { it.createLink(id, if (expires == 0) null else expires) } }
        }
        failed?.let { Text(it, Modifier.padding(horizontal = 20.dp), color = Theme.alert) }
    }
}

@Composable
private fun ShareRow(name: String, detail: String, role: String, remove: () -> Unit, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    FormRow(name, detail) {
        Box {
            Text(roles.firstOrNull { it.first == role }?.second ?: role, Modifier.clickable { open = true }.padding(6.dp), color = Theme.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            DropdownMenu(open, { open = false }) { for ((r, l) in roles) MenuCheck(l, role == r) { open = false; change(r) } }
        }
        Icon(Icons.Outlined.Cancel, "Stop sharing", Modifier.size(22.dp).clickable(onClick = remove), tint = Theme.alert)
    }
}

/** An entry's comments, as the web app's: written, resolved and deleted, sealed with its vault's key in an encrypted vault. */
@Composable
fun CommentsSection(card: Card) {
    val model = LocalModel.current
    var comments by remember(card.id) { mutableStateOf<List<CardComment>>(emptyList()) }
    var draft by remember(card.id) { mutableStateOf(Drafts.get("comment", card.id)?.str ?: "") }
    var failed by remember { mutableStateOf(false) }
    var showResolved by remember { mutableStateOf(false) }
    val encrypted = model.vault(card.vaultId)?.isEncrypted == true
    val key = if (encrypted) model.repo.keyring.key(card.vaultId) else null
    fun run(work: suspend (ServerApi) -> List<CardComment>) {
        val api = model.api
        model.scope.launch {
            try { comments = work(api); failed = false; model.sync?.schedule(model.scope, 500) } catch (_: Exception) { failed = true }
        }
    }
    LaunchedEffect(card.id) { run { it.comments(card.id) } }
    fun text(c: CardComment): String {
        if (!VaultCrypto.isEncrypted(c.body)) return c.body
        key ?: return "Locked comment"
        return VaultKeys.decryptComment(key, c.body, card.id, card.vaultId) ?: "A comment this key can't open"
    }
    fun send() {
        val body = draft.trim()
        if (body.isEmpty()) return
        val sealed = if (encrypted) { key ?: return; VaultKeys.encryptComment(key, body, card.id, card.vaultId) } else body
        draft = ""
        Drafts.set("comment", card.id, null)
        run { it.addComment(card.id, sealed) }
    }
    val open = comments.filter { it.resolved_at == null }
    val resolved = comments.filter { it.resolved_at != null }
    Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Comments", Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = Theme.text)
            if (resolved.isNotEmpty()) Text(if (showResolved) "Hide resolved" else "${resolved.size} resolved", Modifier.clickable { showResolved = !showResolved }, fontSize = 13.sp, color = Theme.accent)
        }
        for (c in open + if (showResolved) resolved else emptyList()) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Theme.surface).padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(c.author, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Theme.text)
                    Text(DateUtils.getRelativeTimeSpanString(c.created_at).toString(), Modifier.weight(1f), fontSize = 12.sp, color = Theme.muted)
                    Text(if (c.resolved_at == null) "Resolve" else "Reopen", Modifier.clickable { run { it.resolveComment(card.id, c.id, c.resolved_at == null) } }, fontSize = 12.sp, color = Theme.accent)
                    if (c.author_id == model.accountId) Text("Delete", Modifier.clickable { run { it.deleteComment(card.id, c.id) } }, fontSize = 12.sp, color = Theme.alert)
                }
                SelectionContainer { Text(text(c), color = if (c.resolved_at == null) Theme.text else Theme.muted) }
            }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            BasicTextField(
                draft, { t -> draft = t; Drafts.set("comment", card.id, if (t.isBlank()) null else j(t), onlyHere = encrypted) },
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(Theme.surface).padding(10.dp), maxLines = 5,
                textStyle = TextStyle(color = Theme.text, fontSize = 15.sp), cursorBrush = SolidColor(Theme.accent),
                decorationBox = { inner -> Box { if (draft.isEmpty()) Text("Write a comment", color = Theme.muted, fontSize = 15.sp); inner() } },
            )
            Button(onClick = ::send, enabled = draft.isNotBlank()) { Text("Send") }
        }
        if (failed) Text("Comments need a connection.", fontSize = 12.sp, color = Theme.alert)
    }
}

/**
 * An entry's versions from the server's history, as the web app's history page: each with when it was saved and by
 * whom, shown when picked, and restored with one press. Needs a connection.
 */
@Composable
fun EntryHistory(id: String, dismiss: () -> Unit) {
    val model = LocalModel.current
    var versions by remember { mutableStateOf<List<VersionInfo>>(emptyList()) }
    var failed by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf<Long?>(null) }
    var shown by remember { mutableStateOf<Card?>(null) }
    LaunchedEffect(id) {
        try { versions = model.api.versions(id).sortedByDescending { it.saved_at } } catch (_: Exception) { failed = true }
    }
    LaunchedEffect(picked) {
        val v = picked ?: return@LaunchedEffect
        val card = model.card(id) ?: return@LaunchedEffect
        val r = runCatching { model.api.version(id, v) }.getOrNull()
        val payload = r?.let { model.repo.keyring.decode(it.payload, id, card.vaultId) }
        shown = if (r == null || payload == null) null else Card(id, card.vaultId, r.saved_at, false, 0, modernPayload(payload))
    }
    Column(Modifier.fillMaxSize()) {
        val s = shown
        if (s != null) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { shown = null; picked = null }) { Text("‹ All versions") }
                if (s.title.isNotEmpty()) Text(s.title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Theme.text)
                for (line in Doc.previewLines(s.content, model.index.titleOf, full = true)) Text(line, color = Theme.text)
                val card = model.card(id)
                if (card != null && model.canEdit(card)) Button(onClick = {
                    val fields = s.restoreFields()
                    val api = model.api
                    model.perform { repo ->
                        // The newest version is closed first, so the restore shows up as its own entry.
                        runCatching { api.sealVersions(id) }
                        repo.update(id) { c -> fields.entries.fold(c) { acc, (k, v) -> acc.with(k, v) } }
                    }
                    model.say("Restored", undoable = true)
                    dismiss()
                }, Modifier.padding(top = 8.dp)) { Text("Restore this version") }
            }
        } else {
            if (failed || versions.isEmpty()) FormText(if (failed) "History needs a connection." else "No versions yet.")
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                for (v in versions) {
                    Column(Modifier.fillMaxWidth().clickable { picked = v.id }.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(v.saved_at)), color = Theme.text)
                        val by = listOfNotNull(v.author, v.via?.let { "with $it" }).joinToString(" ")
                        if (by.isNotEmpty()) Text(by, fontSize = 12.sp, color = Theme.muted)
                    }
                    HorizontalDivider(color = Theme.line)
                }
            }
        }
    }
}
