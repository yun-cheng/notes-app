import NotesKit
import SwiftUI

/// This account's vaults, as the web app's Vaults page: a new one, hidden ones opened by their PIN, and each one's
/// settings and people.
struct VaultsPage: View {
    @Environment(AppModel.self) private var model
    @State private var name = ""
    @State private var pin = ""
    @State private var encrypt = true
    @State private var hiddenPin = ""
    @State private var recoveryKey: String?
    @State private var working = false
    @State private var message: String?

    var body: some View {
        Form {
            Section("Vaults") {
                ForEach(model.vaults.filter { !$0.hidden || model.openVaults.contains($0.id) }) { vault in
                    NavigationLink(value: vault.id) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(vault.name).fontWeight(.semibold)
                            Text(Self.describe(vault)).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
            Section("New vault") {
                TextField("Vault name", text: $name)
                PinField("PIN (optional, makes it private)", text: $pin)
                if !pin.isEmpty { Toggle("Encrypt end to end", isOn: $encrypt) }
                Button("Make vault", action: create).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || working)
            }
            Section {
                PinField("PIN", text: $hiddenPin, onSubmit: openHidden)
                Button("Open", action: openHidden).disabled(hiddenPin.isEmpty)
            } header: {
                Text("Hidden vaults")
            } footer: {
                Text("A hidden vault stays out of the app until its PIN is entered here.")
            }
            if let message { Text(message).foregroundStyle(Theme.alert) }
        }
        .formStyle(.grouped)
        .navigationTitle("Vaults")
        .navigationDestination(for: String.self) { id in VaultDetail(id: id) }
        .sheet(id: $recoveryKey) { key in RecoveryKeySheet(key: key) }
    }

    static func describe(_ vault: Vault) -> String {
        var parts: [String] = []
        parts.append(vault.isOwner ? "Yours" : "Shared with you as \(vault.role == .viewer ? "a viewer" : "an editor")")
        if let n = vault.members, n > 1 { parts.append("\(n) people") }
        if vault.isEncrypted { parts.append("end-to-end encrypted") } else if vault.isPrivate { parts.append("locked by a PIN") }
        if vault.hidden { parts.append("hidden") }
        if vault.isWithheld { parts.append(vault.isEncrypted ? "waiting to be let in" : "set a PIN to see it") }
        if let w = vault.waiting, w > 0 { parts.append("\(w) waiting to be let in") }
        return parts.joined(separator: " · ")
    }

    private func create() {
        let n = name.trimmingCharacters(in: .whitespaces)
        let p = pin
        guard !n.isEmpty, p.isEmpty || p.count >= VaultPin.minLength else {
            message = "A PIN needs at least \(VaultPin.minLength) characters."
            return
        }
        working = true
        Task {
            defer { working = false }
            do {
                var vault = try await model.api.createVault(VaultChanges(name: n, pin: p.isEmpty ? nil : .some(VaultPin.hash(p))))
                try await model.repo.putVaults([vault])
                await model.refresh()
                if !p.isEmpty {
                    await model.open(vault.id)
                    if encrypt {
                        vault = model.vault(vault.id) ?? vault
                        recoveryKey = try await VaultEncryption(model: model).encrypt(vault, pin: p)
                    }
                }
                name = ""
                pin = ""
                message = nil
                model.say("Made \(n)")
            } catch {
                message = "Making a vault needs a connection."
            }
        }
    }

    /// Opens every hidden vault this PIN is for.
    private func openHidden() {
        let entered = hiddenPin
        hiddenPin = ""
        Task {
            var opened = 0
            for vault in model.vaults where vault.hidden && !model.openVaults.contains(vault.id) {
                if await model.unlock(vault, pin: entered, recoveryKey: false) { opened += 1 }
            }
            message = opened == 0 ? "No hidden vault has that PIN." : nil
        }
    }
}

/// The recovery key of a vault just encrypted, shown once.
struct RecoveryKeySheet: View {
    @Environment(\.dismiss) private var dismiss
    let key: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "key.fill").font(.largeTitle).foregroundStyle(Theme.accent)
            Text("Save this recovery key").font(.title2.bold())
            Text("It's the only way into this vault if the PIN is forgotten. It isn't stored anywhere, and won't be shown again.")
                .multilineTextAlignment(.center).foregroundStyle(Theme.muted)
            Text(key).font(.title3.monospaced()).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true).textSelection(.enabled).padding().background(RoundedRectangle(cornerRadius: 10).fill(Theme.sunken))
            HStack {
                Button("Copy") { Clipboard.copy(key) }
                Button("I saved it") { dismiss() }.buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(minWidth: 380)
        .interactiveDismissDisabled()
    }
}

/// A vault's settings, as the web app's VaultSettings and VaultPeopleSection: its name, the lock (a PIN, encryption,
/// members' own PINs, hidden), AI access, and who's in it.
struct VaultDetail: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var name = ""
    @State private var pin = ""
    @State private var currentPin = ""
    @State private var encryptNew = true
    @State private var busy: String?
    @State private var recoveryKey: String?
    @State private var confirmStop = false
    @State private var confirmRemove = false

    var body: some View {
        if let vault = model.vault(id) {
            let owner = vault.isOwner
            Form {
                if owner {
                    Section("Name") {
                        HStack {
                            TextField("Vault name", text: $name)
                            Button("Rename") { change(vault, VaultChanges(name: name.trimmingCharacters(in: .whitespaces)), done: "Renamed") }
                                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name == vault.name)
                        }
                    }
                }
                Section(owner ? "Lock" : "Your lock") { lock(vault) }
                if owner {
                    Section("AI apps") {
                        Picker("AI access", selection: Binding(get: { vault.ai_access }, set: { a in change(vault, VaultChanges(ai_access: a), done: "AI access changed") })) {
                            Text("Off").tag(Vault.AIAccess.off)
                            Text("Read").tag(Vault.AIAccess.read)
                            Text("Read and write").tag(Vault.AIAccess.write)
                        }
                    }
                }
                VaultPeopleSection(vault: vault)
                if let busy { Section { HStack { ProgressView(); Text(busy) } } }
            }
            .formStyle(.grouped)
            .navigationTitle(vault.name)
            .onAppear { name = vault.name }
            .sheet(id: $recoveryKey) { key in RecoveryKeySheet(key: key) }
            .confirmationDialog("Stop encrypting \(vault.name)?", isPresented: $confirmStop) {
                Button("Stop encrypting") { step("Decrypting…") { try await VaultEncryption(model: model).decrypt(vault, keepPin: true); model.say("Vault is no longer encrypted") } }
            } message: {
                Text("Its cards, photos and files will be stored readable again, still locked by its PIN.")
            }
            .confirmationDialog("Remove the PIN from \(vault.name)?", isPresented: $confirmRemove) {
                Button("Remove PIN", role: .destructive) { removePin(vault) }
            } message: {
                Text(vault.isEncrypted ? "Its cards, photos and files will be decrypted and stored readable again." : "It won't be private any more.")
            }
        } else {
            ContentUnavailableView("Not found", systemImage: "questionmark.folder")
        }
    }

    @ViewBuilder
    private func lock(_ vault: Vault) -> some View {
        let owner = vault.isOwner
        if vault.isEncrypted {
            Text(vault.isMemberCopy
                ? "End-to-end encrypted. Your PIN holds your copy of its key."
                : "End-to-end encrypted. Only devices where the PIN is entered\((vault.members ?? 1) > 1 ? ", yours or that of someone you let in," : "") can read this vault.")
                .font(.callout).foregroundStyle(Theme.muted)
        }
        if vault.isMemberCopy && vault.encryption?["member"]?.isNull != false {
            // A member who hasn't asked for its key yet.
            PinField("Your PIN", text: $pin)
            Button("Set PIN and ask for its key") {
                let p = pin
                pin = ""
                step("Asking…") { try await VaultEncryption(model: model).askForKey(vault, pin: p); model.say("Asked for its key") }
            }
            .disabled(pin.count < VaultPin.minLength)
        } else {
            if let pub = vault.encryption?["member"]?["public"]?.stringValue, vault.isWithheld {
                Text("Asked for its key. Compare this code with the owner's: \(VaultKeys.keyCode(pub))").font(.callout)
            }
            PinField(vault.isPrivate ? "New PIN" : "PIN", text: $pin)
            if !vault.isPrivate && owner { Toggle("Encrypt end to end", isOn: $encryptNew) }
            Button(vault.isPrivate ? "Change PIN" : owner ? "Make private" : "Lock with my PIN") { setPin(vault) }
                .disabled(pin.count < VaultPin.minLength || busy != nil)
        }
        if owner && vault.isPrivate && !vault.isEncrypted {
            PinField("Current PIN, to encrypt with", text: $currentPin)
            Button("Encrypt end to end") { encryptNow(vault) }.disabled(currentPin.isEmpty || busy != nil)
        }
        if owner && vault.isEncrypted { Button("Stop encrypting…") { confirmStop = true }.disabled(busy != nil) }
        if owner && vault.isPrivate {
            Toggle("Everyone in it needs a PIN of their own to see it", isOn: Binding(get: { vault.needsMemberPins }, set: { on in change(vault, VaultChanges(members_need_pin: on), done: on ? "Members need a PIN" : "Members need no PIN") }))
        }
        if vault.isPrivate {
            Toggle("Hide this vault until it is unlocked", isOn: Binding(get: { vault.hidden }, set: { on in change(vault, VaultChanges(hidden: on), done: on ? "Hidden" : "No longer hidden") }))
            if !model.lockedVaults.contains(vault.id) { Button("Lock now") { model.lock(vault.id) } }
            if vault.isMemberCopy {
                Text("Your PIN holds your copy of its key, so it can be changed but not removed. To give the vault up, leave it.").font(.caption).foregroundStyle(Theme.muted)
            } else if !owner && vault.needsMemberPins {
                Text("Its owner asks everyone in it to keep a PIN on it, so yours can be changed but not removed.").font(.caption).foregroundStyle(Theme.muted)
            } else {
                Button("Remove PIN…", role: .destructive) { confirmRemove = true }.disabled(busy != nil)
            }
        }
    }

    private func step(_ label: String, _ work: @escaping () async throws -> Void) {
        busy = label
        Task {
            defer { busy = nil }
            do { try await work() } catch {
                model.say((error as? LocalizedError)?.errorDescription ?? (error as? APIError == .offline ? "Connect to the internet to change a vault." : "That didn't work. Try again."))
            }
        }
    }

    private func change(_ vault: Vault, _ changes: VaultChanges, done: String) {
        step("Saving…") {
            try await VaultEncryption(model: model).save(vault, changes)
            model.say(done)
        }
    }

    private func setPin(_ vault: Vault) {
        let next = pin
        pin = ""
        let crypt = VaultEncryption(model: model)
        if vault.isEncrypted {
            step("Changing the PIN…") { try await crypt.rewrap(vault, newPin: next); model.say("PIN changed") }
        } else if !vault.isPrivate && vault.isOwner && encryptNew {
            step("Encrypting…") { recoveryKey = try await crypt.encrypt(vault, pin: next) }
        } else {
            change(vault, VaultChanges(pin: .some(VaultPin.hash(next))), done: vault.isPrivate ? "PIN changed" : vault.isOwner ? "Vault is private" : "Locked with your PIN")
        }
    }

    private func encryptNow(_ vault: Vault) {
        let entered = currentPin
        currentPin = ""
        guard let stored = vault.pin, VaultPin.verify(entered, against: stored) else {
            model.say("That PIN isn't right.")
            return
        }
        step("Encrypting…") { recoveryKey = try await VaultEncryption(model: model).encrypt(vault, pin: entered) }
    }

    private func removePin(_ vault: Vault) {
        if vault.isEncrypted {
            step("Decrypting…") { try await VaultEncryption(model: model).decrypt(vault); model.say("Vault is no longer private") }
        } else {
            change(vault, VaultChanges(pin: .some(nil)), done: vault.isOwner ? "Vault is no longer private" : "Your PIN is removed")
        }
    }
}

/// Who can see a vault: its members and invites, adding and removing them, and letting members into an encrypted
/// vault after comparing a code.
struct VaultPeopleSection: View {
    @Environment(AppModel.self) private var model
    let vault: Vault
    @State private var people: VaultPeople?
    @State private var offline = false
    @State private var email = ""
    @State private var role: Vault.Role = .editor
    @State private var confirmFirst = false
    @State private var confirmLeave = false
    @State private var letting: VaultPeople.Member?

    var body: some View {
        Section {
            if offline { Text("Connect to the internet to see who can see this vault.").foregroundStyle(Theme.muted) }
            ForEach(people?.members ?? []) { m in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.name + (m.user_id == model.accountId ? " (you)" : ""))
                        Text(detail(m)).font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if vault.isOwner, let key = m.key, !key.given { Button("Let in…") { letting = m } }
                    if vault.isOwner && m.role != .owner {
                        Button("Remove", role: .destructive) { run(done: "Removed \(m.name)") { try await $0.removeMember(vault.id, userId: m.user_id); return try await $0.vaultPeople(vault.id) } }
                    }
                }
            }
            ForEach(people?.invites ?? [], id: \.email) { i in
                HStack {
                    VStack(alignment: .leading) {
                        Text(i.email)
                        Text("Invited · \(i.role == .viewer ? "Can view and comment" : "Can edit") · joins when they first sign in").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if vault.isOwner { Button("Cancel") { run { try await $0.cancelInvite(vault.id, email: i.email) } } }
                }
            }
            if vault.isOwner && people != nil {
                HStack {
                    TextField("Email address", text: $email)
                    Picker("", selection: $role) {
                        Text("Can edit").tag(Vault.Role.editor)
                        Text("Can view and comment").tag(Vault.Role.viewer)
                    }
                    .labelsHidden().fixedSize()
                    Button("Share") {
                        if (people?.members.count ?? 1) + (people?.invites.count ?? 0) == 1 { confirmFirst = true } else { add() }
                    }
                    .disabled(!email.contains("@"))
                }
            }
            if vault.isEncrypted, let key = model.repo.keyring.key(vault.id), (people?.members.count ?? 0) > 1 {
                Text("Its key's code here is \(VaultKeys.vaultKeyCode(key, vaultId: vault.id)). Everyone let in sees the same code. Compare it once with \(vault.isOwner ? "each of them" : "its owner").")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            if !vault.isOwner { Button("Leave this vault", role: .destructive) { confirmLeave = true } }
        } header: {
            Text("People")
        } footer: {
            if vault.isOwner {
                Text(vault.isEncrypted
                    ? "Everyone here sees every card in this vault once you let them in: each sets a PIN of their own, which asks you for its key, sealed for them alone."
                    : "Everyone here sees every card in this vault\(vault.needsMemberPins ? ", once they've locked it with a PIN of their own" : ""). To share just one card, use Share on that card.")
            }
        }
        .task(id: "\(vault.id)|\(vault.isWithheld)|\(vault.lock)") { run { try await $0.vaultPeople(vault.id) } }
        .confirmationDialog("Share \(vault.name)?", isPresented: $confirmFirst) {
            Button("Share", action: add)
        } message: {
            Text("Everything in \(vault.name) will be visible to \(email)\(vault.isEncrypted ? " once you let them in" : "").")
        }
        .confirmationDialog("Leave \(vault.name)?", isPresented: $confirmLeave) {
            Button("Leave", role: .destructive) {
                run(done: "You left \(vault.name)") { api in
                    try await api.removeMember(vault.id, userId: model.accountId)
                    return VaultPeople(members: [], invites: [])
                }
            }
        } message: {
            Text("Its cards will be removed from your devices.")
        }
        .sheet(item: $letting) { m in LetInSheet(vault: vault, person: m) { people = $0 } }
    }

    private func detail(_ m: VaultPeople.Member) -> String {
        var s = "\(m.email) · \(m.role == .owner ? "Owner" : m.role == .editor ? "Can edit" : "Can view and comment")"
        if vault.needsMemberPins && !vault.isEncrypted && m.role != .owner && !m.locked { s += " · No PIN yet, so sees nothing in it" }
        if vault.isEncrypted && m.role != .owner && m.key == nil { s += " · Hasn't set a PIN to ask for its key" }
        if vault.isEncrypted, let k = m.key, !k.given { s += " · Asked for its key" }
        return s
    }

    private func add() {
        let address = email.trimmingCharacters(in: .whitespaces)
        email = ""
        let r = role
        run { try await $0.addMember(vault.id, email: address, role: r) }
    }

    private func run(done: String? = nil, _ work: @escaping (ServerAPI) async throws -> VaultPeople) {
        let api = model.api
        Task {
            do {
                people = try await work(api)
                offline = false
                if let done { model.say(done) }
                await model.sync?.sync()
            } catch APIError.offline {
                offline = true
            } catch {
                model.say("That didn't work. Check the address and try again.")
            }
        }
    }
}

/// Letting someone into an encrypted vault, after comparing the code made from the key they asked with.
struct LetInSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let vault: Vault
    let person: VaultPeople.Member
    let done: (VaultPeople) -> Void
    @State private var pin = ""
    @State private var wrong = false

    var body: some View {
        VStack(spacing: 14) {
            Text("Let \(person.name) in?").font(.title3.bold())
            if let key = person.key {
                Text("Ask them to read you the code they see. It should be:").foregroundStyle(Theme.muted)
                Text(VaultKeys.keyCode(key.public)).font(.title2.monospaced())
                Text("If it isn't the same, someone may have put their key in place of theirs: don't let them in.").font(.caption).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            }
            if model.repo.keyring.key(vault.id) == nil {
                PinField("Your PIN", text: $pin).frame(maxWidth: 240)
            }
            if wrong { Text("Wrong PIN.").foregroundStyle(Theme.alert) }
            HStack {
                Button("Cancel") { dismiss() }
                Button("Let in") {
                    guard let key = person.key else { return }
                    Task {
                        do {
                            if let people = try await VaultEncryption(model: model).letIn(vault, userId: person.user_id, publicKey: key.public, pin: pin.isEmpty ? nil : pin) {
                                done(people)
                                model.say("\(person.name) can open \(vault.name) now")
                                dismiss()
                            } else {
                                wrong = true
                            }
                        } catch {
                            model.say("That didn't work. Try again.")
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(minWidth: 360)
    }
}
