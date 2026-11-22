package dev.notesapp.app

import android.Manifest
import android.app.TimePickerDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.notesapp.core.AccountSummary
import dev.notesapp.core.Backup
import dev.notesapp.core.ConnectedApp
import dev.notesapp.core.DateKey
import dev.notesapp.core.DriveStatus
import dev.notesapp.core.MarkdownImport
import dev.notesapp.core.SaveOptions
import dev.notesapp.core.SaveResult
import dev.notesapp.core.SyncEngine
import dev.notesapp.core.TimeKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

/**
 * Backup & settings, as the web app's: the account, backups and Markdown export, importing, reminders, how the journal
 * shows, copy and paste, photos and Google Drive, AI apps, and deleting the account.
 */
@Composable
fun SettingsPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var drive by remember { mutableStateOf<DriveStatus?>(null) }
    var apps by remember { mutableStateOf<List<ConnectedApp>?>(null) }
    var offline by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    var remindersOn by remember { mutableStateOf(Reminders.on(context)) }
    var remindAt by remember { mutableStateOf(Reminders.at(context)) }
    var lead by remember { mutableIntStateOf(Reminders.lead(context)) }
    LaunchedEffect(reload) {
        try { drive = model.api.driveStatus(); apps = model.api.aiApps(); offline = false } catch (_: Exception) { offline = true }
    }
    var pendingExport by remember { mutableStateOf<ByteArray?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri: Uri? ->
        val data = pendingExport
        pendingExport = null
        if (uri != null && data != null) model.scope.launch {
            runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(data) } } }
                .onSuccess { model.say("Saved") }.onFailure { model.say("It couldn't be saved there.") }
        }
    }
    fun exportBackup() {
        val locked = model.lockedVaults
        pendingExport = Backup.make(model.vaults.filter { it.id !in locked }, model.cards.filter { it.vaultId !in locked && !it.sealed }).toByteArray()
        save.launch("notes-backup-${DateKey.today()}.json")
    }
    fun exportMarkdown() {
        pendingExport = Backup.zip(Backup.markdownFiles(model.index))
        save.launch("notes-markdown-${DateKey.today()}.zip")
    }
    val restore = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        model.scope.launch {
            try {
                val text = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)!!.use { it.readBytes().decodeToString() } }
                val (added, updated, skipped) = model.repo.importBackup(Backup.parse(text))
                model.say("Restored: $added added, $updated updated, $skipped already newer")
            } catch (e: Exception) {
                model.say(e.message ?: "That isn't a backup this app can read.")
            }
        }
    }
    val import = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        model.scope.launch {
            val files = withContext(Dispatchers.IO) {
                uris.flatMap { uri ->
                    val name = context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                        val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (i >= 0 && c.moveToFirst()) c.getString(i) else null
                    } ?: "Untitled.md"
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@flatMap emptyList()
                    if (name.endsWith(".zip", ignoreCase = true)) Backup.filesFromZip(bytes) else listOf(name to bytes.decodeToString())
                }
            }
            val r = model.save(MarkdownImport.entries(files, model.today), SaveOptions())
            if (r is SaveResult.Saved) model.say("Imported ${r.ids.size} ${if (r.ids.size == 1) "file" else "files"}", undoable = true)
        }
    }
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { Reminders.set(context, on = true); remindersOn = true; Reminders.reschedule(context, model.index) }
        else model.say("Notifications are off for this app. Turn them on in Android's settings.")
    }

    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Backup & settings", openDrawer)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            FormSection("Account") {
                model.account?.let { FormRow("Signed in as", "${it.name} (${it.email})") }
                model.sync?.let { sync ->
                    val s = model.syncStatus
                    FormRow("Sync", s.summary + (s.lastSyncedAt?.let { ", last at " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)) } ?: ""))
                    FormButton("Sync now", enabled = s.state != SyncEngine.State.syncing) { model.scope.launch { sync.sync() } }
                }
                FormButton("Add another account") { model.addingAccount = true }
                FormButton("Sign out", color = Theme.alert) { model.signOut() }
            }
            FormSection("Backup", "Your notes sync to your account. A backup is an extra copy you control. Unlock a private vault first to include it.") {
                FormButton("Save a backup", onClick = ::exportBackup)
                FormButton("Restore from a backup") { restore.launch(arrayOf("application/json", "*/*")) }
                FormButton("Export as Markdown", onClick = ::exportMarkdown)
            }
            FormSection("Import", "Bring in notes from Markdown or text files, like a folder from Obsidian or Bear, or this app's Markdown export. Each file becomes an entry, titled by its front matter, its first heading or its name.") {
                FormButton("Import Markdown") { import.launch(arrayOf("text/*", "application/zip", "application/octet-stream")) }
            }
            FormSection("Reminders", "Open todos with a due date remind on this device, even with the app closed.") {
                SwitchRow("Remind me when todos come due", remindersOn) { want ->
                    if (want) {
                        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else { Reminders.set(context, on = true); remindersOn = true; Reminders.reschedule(context, model.index) }
                    } else { Reminders.set(context, on = false); remindersOn = false; Reminders.reschedule(context, model.index) }
                }
                if (remindersOn) {
                    FormRow("A date alone reminds at", TimeKey.format(remindAt), Modifier.clickableRow {
                        val p = remindAt.split(":").map { it.toInt() }
                        TimePickerDialog(context, { _, h, m -> remindAt = "%02d:%02d".format(h, m); Reminders.set(context, at = remindAt); Reminders.reschedule(context, model.index) }, p[0], p[1], android.text.format.DateFormat.is24HourFormat(context)).show()
                    })
                    val leads = listOf(0 to "At the time", 5 to "5 minutes before", 10 to "10 minutes before", 15 to "15 minutes before", 30 to "30 minutes before", 60 to "1 hour before", 120 to "2 hours before")
                    ChoiceRow("A time reminds", leads.first { it.first == lead }.second) { close ->
                        for ((m, l) in leads) MenuCheck(l, lead == m) { lead = m; Reminders.set(context, lead = m); Reminders.reschedule(context, model.index); close() }
                    }
                }
            }
            FormSection("Journal display") {
                val links = mapOf("card" to "Card", "compact" to "One line", "off" to "Off")
                ChoiceRow("Link previews", links[Settings.linkStyle] ?: "Card") { close -> for ((k, l) in links) MenuCheck(l, Settings.linkStyle == k) { Settings.linksAs(k); close() } }
                val photos = mapOf("large" to "Large", "thumbs" to "Thumbnails", "off" to "Count")
                ChoiceRow("Photos", photos[Settings.photoStyle] ?: "Large") { close -> for ((k, l) in photos) MenuCheck(l, Settings.photoStyle == k) { Settings.photosAs(k); close() } }
            }
            FormSection("Copy & paste", "Markdown copies an entry the way the journal box reads it back, todos as [ ] lines with their dates and tags. Plain text copies just its words.") {
                val styles = mapOf("markdown" to "Markdown", "plain" to "Plain text")
                ChoiceRow("Copying an entry", styles[Settings.copyStyle] ?: "Markdown") { close -> for ((k, l) in styles) MenuCheck(l, Settings.copyStyle == k) { Settings.copyAs(k); close() } }
            }
            FormSection("Photos and files", "Photos and attached files (up to 25 MB each) are saved on this device first, then uploaded to a folder called “Notes app photos” in the Google Drive of the vault's owner.") {
                if (offline) FormText("Connect to the internet to see whether Google Drive is connected.")
                drive?.let { d ->
                    when {
                        !d.configured -> FormText("Photo and file storage isn't set up on the server yet, so they stay on the device that added them for now.")
                        d.connected -> {
                            FormRow("Google Drive", "Connected" + (d.email?.let { " to $it" } ?: ""))
                            FormButton("Disconnect Google Drive") { model.scope.launch { runCatching { model.api.disconnectDrive() }; reload++ } }
                        }
                        else -> FormButton("Connect Google Drive") {
                            model.scope.launch { runCatching { model.api.driveConnectUrl() }.getOrNull()?.let { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) } }
                        }
                    }
                }
                val waiting = Attachments.pending.size
                if (waiting > 0) FormText("$waiting ${if (waiting == 1) "photo or file is" else "photos and files are"} waiting to upload.")
            }
            FormSection("AI apps", "Claude and other AI apps can read and edit vaults you open to them. In the app, add a custom connector with this address.") {
                FormRow("Connector address")
                SelectionContainer { Text(model.api.mcpUrl, Modifier.padding(horizontal = 16.dp), fontFamily = Theme.mono, fontSize = 13.sp, color = Theme.text) }
                FormButton("Copy address") { clipboard.setText(AnnotatedString(model.api.mcpUrl)); model.say("Copied") }
                val open = model.vaults.filter { it.lock == "none" && it.ai_access != "off" }
                FormText(if (open.isEmpty()) "No vault is open to AI yet. Turn it on for a vault under Vaults." else "Open to AI: " + open.joinToString(", ") { "${it.name} (${if (it.ai_access == "write") "read and write" else "read"})" } + ".")
                for (app in apps ?: emptyList()) FormRow(app.name, app.last_used_at?.let { "Last used " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)) } ?: "Not used yet") {
                    TextButton(onClick = { model.scope.launch { runCatching { model.api.disconnectAiApp(app.id) }; reload++ } }) { Text("Disconnect") }
                }
                if (apps?.isEmpty() == true) FormText("No AI app is connected.")
            }
            FormSection("Delete account") { FormButton("Delete account…", color = Theme.alert) { deleting = true } }
        }
    }
    if (deleting) DeleteAccountSheet({ deleting = false }, ::exportMarkdown)
}

private fun Modifier.clickableRow(onClick: () -> Unit) = this.then(Modifier.clickable(onClick = onClick))

/** Deleting this account, after it says what goes with it and the account's email is typed to confirm. */
@Composable
fun DeleteAccountSheet(dismiss: () -> Unit, onExport: () -> Unit) {
    val model = LocalModel.current
    var summary by remember { mutableStateOf<AccountSummary?>(null) }
    var email by remember { mutableStateOf("") }
    var failed by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { summary = runCatching { model.api.accountSummary() }.getOrNull() }
    FullScreen("Delete account", dismiss) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            FormSection {
                FormText("This deletes your account and everything in the vaults you own, on the server and on your devices. It can't be undone.", muted = false)
                summary?.let { s ->
                    for (v in s.vaults) FormText("${v.name}: ${v.cards} ${if (v.cards == 1) "entry" else "entries"}${if (v.others > 0) ", shared with ${v.others} ${if (v.others == 1) "person" else "people"} who'll lose it" else ""}")
                    if (s.joined > 0) FormText("You'll also leave ${s.joined} ${if (s.joined == 1) "vault" else "vaults"} of other people.")
                }
                FormButton("Export as Markdown first", onClick = onExport)
            }
            FormSection("Type your email to confirm") {
                FormField(email, { email = it }, "Email", keyboard = androidx.compose.ui.text.input.KeyboardType.Email)
                failed?.let { Text(it, Modifier.padding(horizontal = 16.dp), color = Theme.alert) }
                FormButton("Delete my account", enabled = email.trim().equals(model.account?.email ?: "-", ignoreCase = true), color = Theme.alert) {
                    model.scope.launch {
                        try { model.api.deleteAccount(email.trim()); dismiss(); model.signOut() } catch (e: Exception) { failed = e.message }
                    }
                }
            }
        }
    }
}
