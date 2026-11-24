import CryptoKit
import NotesKit
import SwiftUI

/// Sharing one entry, as the web app's `ShareDialog`: where it is now; with people by email; with another vault's
/// members, after saying where it goes; and by a read-only link anyone can open. Each with how far they may go (view,
/// comment, edit). One in a private vault asks first, since whoever it's shared with reads it without the PIN.
struct SharePanel: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var shares: CardShares?
    @State private var email = ""
    @State private var role: SharedCard.Role = .view
    @State private var vaultRole: SharedCard.Role = .view
    @State private var target = ""
    @State private var failed: String?
    @State private var expires = 0
    @State private var confirmed = false

    static let roles: [(SharedCard.Role, String)] = [(.view, "Can view"), (.comment, "Can comment"), (.edit, "Can edit")]

    private func people(_ n: Int) -> String { n == 1 ? "1 person" : "\(n) people" }

    var body: some View {
        let card = model.card(id)
        let home = card.flatMap { model.vault($0.vaultId) }
        let isPrivate = home?.isPrivate == true
        Form {
            if let home {
                Text("This card is in \(home.name)\((home.members ?? 1) > 1 ? " (\(people(home.members ?? 1)))" : ""). Sharing it doesn't share the cards it links to.")
                    .foregroundStyle(Theme.muted)
            }
            if home?.isEncrypted == true {
                // The server shares nothing from an encrypted vault; the web says only that it didn't work.
                Text("This entry is in an encrypted vault, so it can be shared only by sharing the vault.").foregroundStyle(Theme.muted)
            } else if let failed {
                Text(failed).foregroundStyle(Theme.alert)
            }
            if isPrivate && !confirmed && home?.isEncrypted != true {
                Section {
                    Text("This card is in a private vault. Whoever you share it with can read it without your PIN.")
                    Button("I understand, continue") { confirmed = true }
                }
            }
            if shares != nil && (!isPrivate || confirmed) && home?.isEncrypted != true {
                Section("People") {
                    HStack {
                        TextField("Email address", text: $email)
                            #if os(iOS)
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                            #endif
                            .onSubmit(addPerson)
                        Picker("", selection: $role) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
                        Button("Share", action: addPerson).buttonStyle(.borderedProminent).disabled(email.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    ForEach(shares?.people ?? []) { person in
                        row(person.name.isEmpty ? person.email : person.name, detail: person.email, role: person.role) { remove("user", person.user_id) } change: { change(email: person.email, $0) }
                    }
                    ForEach(shares?.invites ?? [], id: \.email) { invite in
                        row(invite.email, detail: "invited, sees it after signing up", role: invite.role) { remove("invite", invite.email) } change: { change(email: invite.email, $0) }
                    }
                }
                let others = model.vaults.filter { $0.id != card?.vaultId && !$0.isEncrypted && !$0.isWithheld && !model.lockedVaults.contains($0.id) }
                if !others.isEmpty {
                    Section("A vault's members") {
                        HStack {
                            Picker("", selection: $target) {
                                Text("Choose a vault").tag("")
                                ForEach(others) { v in Text(v.name + (v.members.map { " (\(people($0)))" } ?? "")).tag(v.id) }
                            }
                            .labelsHidden()
                            Picker("", selection: $vaultRole) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
                        }
                        if let chosen = others.first(where: { $0.id == target }) {
                            Text("This card is in \(home?.name ?? "its vault")\(home?.members.map { " (\(people($0)))" } ?? ""). Share it with \(chosen.name)\(chosen.members.map { " (\(people($0)))" } ?? "")?")
                            Button("Share with \(chosen.name)") {
                                let name = chosen.name
                                changeVault(chosen.id, vaultRole, done: "Shared with \(name)")
                                target = ""
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        ForEach(shares?.vaults ?? [], id: \.vault_id) { v in
                            // Only a vault the sharer is in can have its access changed by them.
                            if model.vault(v.vault_id) != nil {
                                row(v.name, detail: people(v.members), role: v.role) { remove("vault", v.vault_id) } change: { changeVault(v.vault_id, $0) }
                            } else {
                                HStack {
                                    VStack(alignment: .leading) { Text(v.name); Text(people(v.members)).font(.caption).foregroundStyle(Theme.muted) }
                                    Spacer()
                                    Text(Self.roles.first { $0.0 == v.role }?.1 ?? "").foregroundStyle(Theme.muted)
                                    Button("Remove") { remove("vault", v.vault_id) }.buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
                Section {
                    HStack {
                        Picker("", selection: $expires) {
                            Text("Never expires").tag(0)
                            Text("Expires in 1 day").tag(1)
                            Text("Expires in 7 days").tag(7)
                            Text("Expires in 30 days").tag(30)
                        }
                        .labelsHidden()
                        Button("Create link") { run(done: "Link created") { try await $0.createLink(id, expiresInDays: expires == 0 ? nil : expires) } }
                    }
                    ForEach(shares?.links ?? [], id: \.token) { link in
                        let url = model.api.publicLink(link.token)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(url.absoluteString).font(.callout.monospaced()).textSelection(.enabled).lineLimit(1)
                            HStack {
                                Text(link.expires_at.map { "Until " + Date(ms: $0).formatted(date: .abbreviated, time: .omitted) } ?? "No expiry")
                                    .font(.caption).foregroundStyle(Theme.muted)
                                Spacer()
                                Button("Copy") { Clipboard.copy(url.absoluteString); model.say("Link copied") }
                                Button("Turn off") { run(done: "Link turned off") { try await $0.deleteLink(id, token: link.token) } }
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                } header: {
                    Text("Anyone with the link")
                } footer: {
                    Text("Read only. The link isn't listed anywhere, and you can turn it off.")
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Share “\(card?.displayTitle ?? "")”")
        .task {
            confirmed = !isPrivate
            run(missing: "This card can't be shared until it has synced.") { try await $0.shares(id) }
        }
    }

    private func row(_ name: String, detail: String, role: SharedCard.Role, remove: @escaping () -> Void, change: @escaping (SharedCard.Role) -> Void) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(name)
                Text(detail).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            Picker("", selection: Binding(get: { role }, set: change)) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
            Button("Remove", action: remove).buttonStyle(.borderless)
        }
    }

    private func addPerson() {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard address.contains("@") else { return }
        email = ""
        change(email: address, role)
    }

    private func change(email: String, _ role: SharedCard.Role) { run { try await $0.share(id, email: email, role: role) } }
    private func changeVault(_ vaultId: String, _ role: SharedCard.Role, done: String? = nil) {
        run(done: done) { try await $0.share(id, vaultId: vaultId, role: role) }
        model.sync?.schedule(after: 0.5)
    }
    private func remove(_ type: String, _ target: String) {
        run { try await $0.unshare(id, type: type, target: target) }
        model.sync?.schedule(after: 0.5)
    }

    private func run(done: String? = nil, missing: String? = nil, _ work: @escaping (ServerAPI) async throws -> CardShares) {
        let api = model.api
        Task {
            do {
                shares = try await work(api)
                failed = nil
                if let done { model.say(done) }
            } catch APIError.offline {
                failed = "Sharing needs a connection."
            } catch {
                failed = missing ?? "That didn't work. Try again."
            }
        }
    }
}

/// An entry's comments, as the web app's: written, resolved and deleted, sealed with its vault's key in an encrypted
/// vault.
struct CommentsSection: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @State private var comments: [CardComment] = []
    @State private var draft = ""
    private var sealed: Bool { model.vault(card.vaultId)?.isEncrypted == true }
    @State private var failed = false
    @State private var showResolved = false

    private var key: SymmetricKey? { model.vault(card.vaultId)?.isEncrypted == true ? model.repo.keyring.key(card.vaultId) : nil }

    var body: some View {
        let open = comments.filter { $0.resolved_at == nil }
        let resolved = comments.filter { $0.resolved_at != nil }
        // As on the web: only where someone else can read them, or where some were written before.
        let shown = card.seq > 0 && (model.canComment(card) || !comments.isEmpty)
        Group {
        if shown {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Comments").font(.headline)
                Spacer()
                if !resolved.isEmpty { Button(showResolved ? "Hide resolved" : "\(resolved.count) resolved") { showResolved.toggle() }.buttonStyle(.borderless).font(.caption) }
            }
            ForEach(open + (showResolved ? resolved : [])) { comment in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(comment.author).font(.caption.weight(.semibold))
                        Text(Date(ms: comment.created_at), format: .relative(presentation: .named)).font(.caption).foregroundStyle(Theme.muted)
                        Spacer()
                        Button(comment.resolved_at == nil ? "Resolve" : "Reopen") { run { try await $0.resolveComment(card.id, id: comment.id, resolved: comment.resolved_at == nil) } }
                        if comment.author_id == model.accountId {
                            Button("Delete", role: .destructive) { run { try await $0.deleteComment(card.id, id: comment.id) } }
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    Text(text(comment)).foregroundStyle(comment.resolved_at == nil ? Theme.text : Theme.muted).textSelection(.enabled)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
            }
            HStack(alignment: .bottom) {
                TextField("Write a comment", text: $draft, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...5)
                Button("Send", action: send).disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if failed { Text("Comments need a connection.").font(.caption).foregroundStyle(Theme.alert) }
        }
        .padding(.top, 12)
        }
        }
        .task(id: card.id) {
            draft = Drafts.shared.get("comment", card.id)?.stringValue ?? ""
            run { try await $0.comments(card.id) }
        }
        .onChange(of: draft) { _, t in Drafts.shared.set("comment", card.id, t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .string(t), onlyHere: sealed) }
    }

    private func text(_ comment: CardComment) -> String {
        guard VaultCrypto.isEncrypted(comment.body) else { return comment.body }
        guard let key else { return "Locked comment" }
        return VaultKeys.decryptComment(key, comment.body, cardId: card.id, vaultId: card.vaultId) ?? "A comment this key can't open"
    }

    private func send() {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let sealed: String
        if model.vault(card.vaultId)?.isEncrypted == true {
            guard let key, let s = try? VaultKeys.encryptComment(key, body, cardId: card.id, vaultId: card.vaultId) else { return }
            sealed = s
        } else {
            sealed = body
        }
        draft = ""
        run { try await $0.addComment(card.id, body: sealed) }
    }

    private func run(_ work: @escaping (ServerAPI) async throws -> [CardComment]) {
        let api = model.api
        Task {
            do {
                comments = try await work(api)
                failed = false
                model.sync?.schedule(after: 0.5)
            } catch {
                failed = true
            }
        }
    }
}
