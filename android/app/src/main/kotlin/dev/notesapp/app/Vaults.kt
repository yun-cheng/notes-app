package dev.notesapp.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.notesapp.core.ApiError
import dev.notesapp.core.ServerApi
import dev.notesapp.core.Vault
import dev.notesapp.core.VaultChanges
import dev.notesapp.core.VaultKeys
import dev.notesapp.core.VaultMember
import dev.notesapp.core.VaultPeople
import dev.notesapp.core.VaultPin
import dev.notesapp.core.get
import dev.notesapp.core.isNull
import dev.notesapp.core.str
import kotlinx.coroutines.launch

/** Opens a private vault with its PIN, or with its recovery key if the PIN is forgotten. */
@Composable
fun UnlockView(vault: Vault, modifier: Modifier = Modifier) {
    val model = LocalModel.current
    var pin by remember { mutableStateOf("") }
    var useRecoveryKey by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var wrong by remember { mutableStateOf(false) }
    fun unlock() {
        if (pin.isEmpty() || working) return
        working = true
        wrong = false
        val entered = pin
        model.scope.launch {
            val opened = model.unlock(vault, entered, useRecoveryKey)
            working = false
            wrong = !opened
            if (opened) pin = ""
        }
    }
    Column(modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        Icon(Icons.Outlined.Lock, null, Modifier.size(40.dp), tint = Theme.muted)
        Text("${vault.name} is private", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Theme.text)
        Text(if (useRecoveryKey) "Enter the recovery key you saved when the vault was encrypted." else "Enter its PIN to open it on this device.", color = Theme.muted, textAlign = TextAlign.Center)
        PinField(pin, { pin = it }, if (useRecoveryKey) "Recovery key" else "PIN", ::unlock, Modifier.widthIn(max = 300.dp))
        if (wrong) Text(if (useRecoveryKey) "That recovery key doesn't open this vault." else "Wrong PIN.", color = Theme.alert)
        Button(onClick = ::unlock, enabled = pin.isNotEmpty() && !working) {
            if (working) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Unlock")
        }
        if (vault.isEncrypted) TextButton(onClick = { useRecoveryKey = !useRecoveryKey; pin = ""; wrong = false }) { Text(if (useRecoveryKey) "Use the PIN instead" else "Forgot PIN?") }
    }
}

/** The recovery key of a vault just encrypted, shown once. */
@Composable
fun RecoveryKeySheet(key: String, dismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    Dialog(onDismissRequest = {}, properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Column(Modifier.clip(RoundedCornerShape(20.dp)).background(Theme.bg).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(Icons.Outlined.Key, null, Modifier.size(36.dp), tint = Theme.accent)
            Text("Save this recovery key", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Theme.text)
            Text("It's the only way into this vault if the PIN is forgotten. It isn't stored anywhere, and won't be shown again.", color = Theme.muted, textAlign = TextAlign.Center)
            androidx.compose.foundation.text.selection.SelectionContainer {
                Text(key, Modifier.clip(RoundedCornerShape(10.dp)).background(Theme.sunken).padding(14.dp), fontFamily = Theme.mono, fontSize = 18.sp, color = Theme.text, textAlign = TextAlign.Center)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TextButton(onClick = { clipboard.setText(AnnotatedString(key)) }) { Text("Copy") }
                Button(onClick = dismiss) { Text("I saved it") }
            }
        }
    }
}

fun describe(vault: Vault): String {
    val parts = mutableListOf(if (vault.isOwner) "Yours" else "Shared with you as ${if (vault.role == "viewer") "a viewer" else "an editor"}")
    vault.members?.takeIf { it > 1 }?.let { parts.add("$it people") }
    if (vault.isEncrypted) parts.add("end-to-end encrypted") else if (vault.isPrivate) parts.add("locked by a PIN")
    if (vault.hidden) parts.add("hidden")
    if (vault.isWithheld) parts.add(if (vault.isEncrypted) "waiting to be let in" else "set a PIN to see it")
    vault.waiting?.takeIf { it > 0 }?.let { parts.add("$it waiting to be let in") }
    return parts.joinToString(" · ")
}

/** This account's vaults, as the web app's Vaults page: a new one, hidden ones opened by their PIN, and each one's settings and people. */
@Composable
fun VaultsPage(openDrawer: (() -> Unit)?) {
    val model = LocalModel.current
    var detail by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    var encrypt by remember { mutableStateOf(true) }
    var hiddenPin by remember { mutableStateOf("") }
    var recoveryKey by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    detail?.let { id ->
        BackHandler { detail = null }
        VaultDetail(id) { detail = null }
        return
    }
    fun create() {
        val n = name.trim()
        val p = pin
        if (n.isEmpty()) return
        if (p.isNotEmpty() && p.length < VaultPin.MIN_LENGTH) { message = "A PIN needs at least ${VaultPin.MIN_LENGTH} characters."; return }
        working = true
        model.scope.launch {
            try {
                var vault = model.api.createVault(VaultChanges(name = n, pin = if (p.isEmpty()) null else VaultPin.hash(p)))
                model.repo.putVaults(listOf(vault))
                model.refresh()
                if (p.isNotEmpty()) {
                    model.openVault(vault.id)
                    if (encrypt) {
                        vault = model.vault(vault.id) ?: vault
                        recoveryKey = VaultEncryption(model).encrypt(vault, p)
                    }
                }
                name = ""; pin = ""; message = null
                model.say("Made $n")
            } catch (_: Exception) {
                message = "Making a vault needs a connection."
            }
            working = false
        }
    }
    /** Opens every hidden vault this PIN is for. */
    fun openHidden() {
        val entered = hiddenPin
        hiddenPin = ""
        model.scope.launch {
            var opened = 0
            for (v in model.vaults) if (v.hidden && v.id !in model.openVaults && model.unlock(v, entered, false)) opened++
            message = if (opened == 0) "No hidden vault has that PIN." else null
        }
    }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar("Vaults", openDrawer)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            FormSection("Vaults") {
                model.vaults.filter { !it.hidden || it.id in model.openVaults }.forEachIndexed { i, v ->
                    if (i > 0) FormDivider()
                    FormRow(v.name, describe(v), Modifier.clickable { detail = v.id }) { Icon(Icons.Outlined.ChevronRight, null, tint = Theme.muted) }
                }
            }
            FormSection("New vault") {
                FormField(name, { name = it }, "Vault name")
                PinField(pin, { pin = it }, "PIN (optional, makes it private)")
                if (pin.isNotEmpty()) SwitchRow("Encrypt end to end", encrypt) { encrypt = it }
                FormButton(if (working) "Making…" else "Make vault", enabled = name.isNotBlank() && !working, onClick = ::create)
            }
            FormSection("Hidden vaults", "A hidden vault stays out of the app until its PIN is entered here.") {
                PinField(hiddenPin, { hiddenPin = it }, onDone = ::openHidden)
                FormButton("Open", enabled = hiddenPin.isNotEmpty(), onClick = ::openHidden)
            }
            message?.let { Text(it, Modifier.padding(horizontal = 20.dp), color = Theme.alert) }
        }
    }
    recoveryKey?.let { RecoveryKeySheet(it) { recoveryKey = null } }
}

/**
 * A vault's settings, as the web app's VaultSettings and VaultPeopleSection: its name, the lock (a PIN, encryption,
 * members' own PINs, hidden), AI access, and who's in it.
 */
@Composable
fun VaultDetail(id: String, back: () -> Unit) {
    val model = LocalModel.current
    val vault = model.vault(id)
    var name by remember(id) { mutableStateOf(vault?.name ?: "") }
    var pin by remember { mutableStateOf("") }
    var currentPin by remember { mutableStateOf("") }
    var encryptNew by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf<String?>(null) }
    var recoveryKey by remember { mutableStateOf<String?>(null) }
    var confirmStop by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Theme.bg)) {
        TopBar(vault?.name ?: "Not found", null) { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = Theme.text) } }
        vault ?: return@Column
        val owner = vault.isOwner
        fun step(label: String, work: suspend () -> Unit) {
            busy = label
            model.scope.launch {
                try { work() } catch (e: Exception) { model.say(vaultProblem(e)) }
                busy = null
            }
        }
        fun change(changes: VaultChanges, done: String) = step("Saving…") { VaultEncryption(model).save(vault, changes); model.say(done) }
        fun setPin() {
            val next = pin
            pin = ""
            val crypt = VaultEncryption(model)
            when {
                vault.isEncrypted -> step("Changing the PIN…") { crypt.rewrap(vault, next); model.say("PIN changed") }
                !vault.isPrivate && owner && encryptNew -> step("Encrypting…") { recoveryKey = crypt.encrypt(vault, next) }
                else -> change(VaultChanges(pin = VaultPin.hash(next)), if (vault.isPrivate) "PIN changed" else if (owner) "Vault is private" else "Locked with your PIN")
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            if (owner) FormSection("Name") {
                FormField(name, { name = it }, "Vault name")
                FormButton("Rename", enabled = name.isNotBlank() && name != vault.name) { change(VaultChanges(name = name.trim()), "Renamed") }
            }
            FormSection(if (owner) "Lock" else "Your lock") {
                if (vault.isEncrypted) FormText(
                    if (vault.isMemberCopy) "End-to-end encrypted. Your PIN holds your copy of its key."
                    else "End-to-end encrypted. Only devices where the PIN is entered${if ((vault.members ?: 1) > 1) ", yours or that of someone you let in," else ""} can read this vault.",
                )
                if (vault.isMemberCopy && vault.encryption["member"].isNull) {
                    // A member who hasn't asked for its key yet.
                    PinField(pin, { pin = it }, "Your PIN")
                    FormButton("Set PIN and ask for its key", enabled = pin.length >= VaultPin.MIN_LENGTH) {
                        val p = pin; pin = ""
                        step("Asking…") { VaultEncryption(model).askForKey(vault, p); model.say("Asked for its key") }
                    }
                } else {
                    val pub = vault.encryption["member"]["public"].str
                    if (pub != null && vault.isWithheld) FormText("Asked for its key. Compare this code with the owner's: ${VaultKeys.keyCode(pub)}", muted = false)
                    PinField(pin, { pin = it }, if (vault.isPrivate) "New PIN" else "PIN")
                    if (!vault.isPrivate && owner) SwitchRow("Encrypt end to end", encryptNew) { encryptNew = it }
                    FormButton(if (vault.isPrivate) "Change PIN" else if (owner) "Make private" else "Lock with my PIN", enabled = pin.length >= VaultPin.MIN_LENGTH && busy == null, onClick = ::setPin)
                }
                if (owner && vault.isPrivate && !vault.isEncrypted) {
                    FormDivider()
                    PinField(currentPin, { currentPin = it }, "Current PIN, to encrypt with")
                    FormButton("Encrypt end to end", enabled = currentPin.isNotEmpty() && busy == null) {
                        val entered = currentPin; currentPin = ""
                        if (!VaultPin.verify(entered, vault.pin)) model.say("That PIN isn't right.")
                        else step("Encrypting…") { recoveryKey = VaultEncryption(model).encrypt(vault, entered) }
                    }
                }
                if (owner && vault.isEncrypted) FormButton("Stop encrypting…", enabled = busy == null) { confirmStop = true }
                if (owner && vault.isPrivate) SwitchRow("Everyone in it needs a PIN of their own to see it", vault.needsMemberPins) { on ->
                    change(VaultChanges(members_need_pin = on), if (on) "Members need a PIN" else "Members need no PIN")
                }
                if (vault.isPrivate) {
                    SwitchRow("Hide this vault until it is unlocked", vault.hidden) { on -> change(VaultChanges(hidden = on), if (on) "Hidden" else "No longer hidden") }
                    if (vault.id !in model.lockedVaults) FormButton("Lock now") { model.lock(vault.id) }
                    when {
                        vault.isMemberCopy -> FormText("Your PIN holds your copy of its key, so it can be changed but not removed. To give the vault up, leave it.")
                        !owner && vault.needsMemberPins -> FormText("Its owner asks everyone in it to keep a PIN on it, so yours can be changed but not removed.")
                        else -> FormButton("Remove PIN…", enabled = busy == null, color = Theme.alert) { confirmRemove = true }
                    }
                }
            }
            if (owner) FormSection("AI apps") {
                val label = mapOf("off" to "Off", "read" to "Read", "write" to "Read and write")
                ChoiceRow("AI access", label[vault.ai_access] ?: "Off") { close ->
                    for ((k, l) in label) MenuCheck(l, vault.ai_access == k) { close(); change(VaultChanges(ai_access = k), "AI access changed") }
                }
            }
            VaultPeopleSection(vault)
            busy?.let { b -> Row(Modifier.padding(20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Text(b, color = Theme.text) } }
        }
        recoveryKey?.let { RecoveryKeySheet(it) { recoveryKey = null } }
        if (confirmStop) Confirm("Stop encrypting ${vault.name}?", "Its cards, photos and files will be stored readable again, still locked by its PIN.", "Stop encrypting", { confirmStop = false }) {
            step("Decrypting…") { VaultEncryption(model).decrypt(vault, keepPin = true); model.say("Vault is no longer encrypted") }
        }
        if (confirmRemove) Confirm(
            "Remove the PIN from ${vault.name}?", if (vault.isEncrypted) "Its cards, photos and files will be decrypted and stored readable again." else "It won't be private any more.", "Remove PIN", { confirmRemove = false }, destructive = true,
        ) {
            if (vault.isEncrypted) step("Decrypting…") { VaultEncryption(model).decrypt(vault); model.say("Vault is no longer private") }
            else change(VaultChanges(clearPin = true), if (owner) "Vault is no longer private" else "Your PIN is removed")
        }
    }
}

/** A question before something that can't easily be taken back. */
@Composable
fun Confirm(title: String, text: String, action: String, dismiss: () -> Unit, destructive: Boolean = false, confirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = dismiss, title = { Text(title) }, text = { Text(text) }, containerColor = Theme.raised,
        confirmButton = { TextButton(onClick = { dismiss(); confirm() }) { Text(action, color = if (destructive) Theme.alert else Theme.accent) } },
        dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } },
    )
}

/** Who can see a vault: its members and invites, adding and removing them, and letting members into an encrypted vault after comparing a code. */
@Composable
fun VaultPeopleSection(vault: Vault) {
    val model = LocalModel.current
    var people by remember(vault.id) { mutableStateOf<VaultPeople?>(null) }
    var offline by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("editor") }
    var confirmFirst by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var letting by remember { mutableStateOf<VaultMember?>(null) }
    fun run(done: String? = null, work: suspend (ServerApi) -> VaultPeople) {
        val api = model.api
        model.scope.launch {
            try {
                people = work(api)
                offline = false
                done?.let { model.say(it) }
                model.sync?.sync()
            } catch (_: ApiError.Offline) {
                offline = true
            } catch (_: Exception) {
                model.say("That didn't work. Check the address and try again.")
            }
        }
    }
    LaunchedEffect("${vault.id}|${vault.isWithheld}|${vault.lock}") { run { it.vaultPeople(vault.id) } }
    fun add() {
        val address = email.trim()
        email = ""
        val r = role
        run { it.addMember(vault.id, address, r) }
    }
    fun detail(m: VaultMember): String {
        var s = "${m.email} · ${when (m.role) { "owner" -> "Owner"; "editor" -> "Can edit"; else -> "Can view and comment" }}"
        if (vault.needsMemberPins && !vault.isEncrypted && m.role != "owner" && !m.locked) s += " · No PIN yet, so sees nothing in it"
        if (vault.isEncrypted && m.role != "owner" && m.key == null) s += " · Hasn't set a PIN to ask for its key"
        if (vault.isEncrypted && m.key?.given == false) s += " · Asked for its key"
        return s
    }
    val footer = if (!vault.isOwner) null else if (vault.isEncrypted) "Everyone here sees every card in this vault once you let them in: each sets a PIN of their own, which asks you for its key, sealed for them alone."
    else "Everyone here sees every card in this vault${if (vault.needsMemberPins) ", once they've locked it with a PIN of their own" else ""}. To share just one card, use Share on that card."
    FormSection("People", footer) {
        if (offline) FormText("Connect to the internet to see who can see this vault.")
        for (m in people?.members ?: emptyList()) {
            FormRow(m.name + if (m.user_id == model.accountId) " (you)" else "", detail(m)) {
                if (vault.isOwner && m.key?.given == false) TextButton(onClick = { letting = m }) { Text("Let in…") }
                if (vault.isOwner && m.role != "owner") TextButton(onClick = { run("Removed ${m.name}") { it.removeMember(vault.id, m.user_id); it.vaultPeople(vault.id) } }) { Text("Remove", color = Theme.alert) }
            }
        }
        for (i in people?.invites ?: emptyList()) {
            FormRow(i.email, "Invited · ${if (i.role == "viewer") "Can view and comment" else "Can edit"} · joins when they first sign in") {
                if (vault.isOwner) TextButton(onClick = { run { it.cancelInvite(vault.id, i.email) } }) { Text("Cancel") }
            }
        }
        if (vault.isOwner && people != null) {
            FormField(email, { email = it }, "Email address", keyboard = androidx.compose.ui.text.input.KeyboardType.Email)
            ChoiceRow("Role", if (role == "viewer") "Can view and comment" else "Can edit") { close ->
                MenuCheck("Can edit", role == "editor") { role = "editor"; close() }
                MenuCheck("Can view and comment", role == "viewer") { role = "viewer"; close() }
            }
            FormButton("Share", enabled = email.contains("@")) {
                if ((people?.members?.size ?: 1) + (people?.invites?.size ?: 0) == 1) confirmFirst = true else add()
            }
        }
        val key = model.repo.keyring.key(vault.id)
        if (vault.isEncrypted && key != null && (people?.members?.size ?: 0) > 1) {
            FormText("Its key's code here is ${VaultKeys.vaultKeyCode(key, vault.id)}. Everyone let in sees the same code. Compare it once with ${if (vault.isOwner) "each of them" else "its owner"}.")
        }
        if (!vault.isOwner) FormButton("Leave this vault", color = Theme.alert) { confirmLeave = true }
    }
    if (confirmFirst) Confirm("Share ${vault.name}?", "Everything in ${vault.name} will be visible to $email${if (vault.isEncrypted) " once you let them in" else ""}.", "Share", { confirmFirst = false }, confirm = ::add)
    if (confirmLeave) Confirm("Leave ${vault.name}?", "Its cards will be removed from your devices.", "Leave", { confirmLeave = false }, destructive = true) {
        run("You left ${vault.name}") { it.removeMember(vault.id, model.accountId); VaultPeople(emptyList(), emptyList()) }
    }
    letting?.let { m -> LetInSheet(vault, m, { letting = null }) { people = it } }
}

/** Letting someone into an encrypted vault, after comparing the code made from the key they asked with. */
@Composable
fun LetInSheet(vault: Vault, person: VaultMember, dismiss: () -> Unit, done: (VaultPeople) -> Unit) {
    val model = LocalModel.current
    var pin by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }
    Dialog(onDismissRequest = dismiss) {
        Column(Modifier.clip(RoundedCornerShape(20.dp)).background(Theme.bg).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Let ${person.name} in?", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Theme.text)
            person.key?.let { key ->
                Text("Ask them to read you the code they see. It should be:", color = Theme.muted, textAlign = TextAlign.Center)
                Text(VaultKeys.keyCode(key.public), fontFamily = Theme.mono, fontSize = 22.sp, color = Theme.text)
                Text("If it isn't the same, someone may have put their key in place of theirs: don't let them in.", fontSize = 12.sp, color = Theme.muted, textAlign = TextAlign.Center)
            }
            if (model.repo.keyring.key(vault.id) == null) PinField(pin, { pin = it }, "Your PIN")
            if (wrong) Text("Wrong PIN.", color = Theme.alert)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TextButton(onClick = dismiss) { Text("Cancel") }
                Button(onClick = {
                    val key = person.key ?: return@Button
                    model.scope.launch {
                        try {
                            val people = VaultEncryption(model).letIn(vault, person.user_id, key.public, pin.ifEmpty { null })
                            if (people != null) { done(people); model.say("${person.name} can open ${vault.name} now"); dismiss() } else wrong = true
                        } catch (_: Exception) {
                            model.say("That didn't work. Try again.")
                        }
                    }
                }) { Text("Let in") }
            }
        }
    }
}

