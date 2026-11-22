import CryptoKit
import NotesKit
import SwiftUI

/// Sharing one entry, as the web app's `ShareDialog`: with people by email, with everyone in one of this account's
/// vaults, and by public links anyone can open, each with how far they may go (view, comment, edit).
struct SharePanel: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var shares: CardShares?
    @State private var email = ""
    @State private var role: SharedCard.Role = .view
    @State private var failed: String?
    @State private var expires = 0

    static let roles: [(SharedCard.Role, String)] = [(.view, "Can view"), (.comment, "Can comment"), (.edit, "Can edit")]

    var body: some View {
        Form {
            if let card = model.card(id), model.vault(card.vaultId)?.isEncrypted == true {
                Text("This entry is in an encrypted vault, so it can be shared only by sharing the vault.").foregroundStyle(Theme.muted)
            } else {
                Section("People") {
                    HStack {
                        TextField("Email", text: $email)
                            #if os(iOS)
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                            #endif
                            .onSubmit(addPerson)
                        Picker("", selection: $role) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
                        Button("Share", action: addPerson).disabled(!email.contains("@"))
                    }
                    ForEach(shares?.people ?? []) { person in
                        row(person.name.isEmpty ? person.email : person.name, detail: person.email, role: person.role) { remove("user", person.user_id) } change: { change(email: person.email, $0) }
                    }
                    ForEach(shares?.invites ?? [], id: \.email) { invite in
                        row(invite.email, detail: "Invited: they'll see it once they sign in", role: invite.role) { remove("invite", invite.email) } change: { change(email: invite.email, $0) }
                    }
                }
                Section("Vaults") {
                    let card = model.card(id)
                    let shared = Set(shares?.vaults.map(\.vault_id) ?? [])
                    ForEach(shares?.vaults ?? [], id: \.vault_id) { v in
                        row(v.name, detail: "\(v.members) \(v.members == 1 ? "person" : "people")", role: v.role) { remove("vault", v.vault_id) } change: { changeVault(v.vault_id, $0) }
                    }
                    let others = model.vaults.filter { $0.id != card?.vaultId && !shared.contains($0.id) && !$0.isEncrypted && $0.role != .viewer }
                    if !others.isEmpty {
                        Menu("Share with a vault") {
                            ForEach(others) { v in Button(v.name) { changeVault(v.id, .edit) } }
                        }
                    }
                }
                Section {
                    ForEach(shares?.links ?? [], id: \.token) { link in
                        let url = model.api.publicLink(link.token)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(url.absoluteString).font(.callout.monospaced()).textSelection(.enabled).lineLimit(1)
                            HStack {
                                Text(link.expires_at.map { "Until " + Date(timeIntervalSince1970: Double($0) / 1000).formatted(date: .abbreviated, time: .omitted) } ?? "Doesn't expire")
                                    .font(.caption).foregroundStyle(Theme.muted)
                                Spacer()
                                Button("Copy") { Clipboard.copy(url.absoluteString); model.say("Link copied") }
                                Button("Stop sharing", role: .destructive) { run { try await $0.deleteLink(id, token: link.token) } }
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    HStack {
                        Picker("Expires", selection: $expires) {
                            Text("Never").tag(0)
                            Text("In a day").tag(1)
                            Text("In a week").tag(7)
                            Text("In 30 days").tag(30)
                        }
                        Button("Make a public link") { run { try await $0.createLink(id, expiresInDays: expires == 0 ? nil : expires) } }
                    }
                } header: {
                    Text("Public links")
                } footer: {
                    Text("Anyone with a link can read this entry, without signing in.")
                }
            }
            if let failed { Text(failed).foregroundStyle(Theme.alert) }
        }
        .formStyle(.grouped)
        .navigationTitle("Share")
        .task { run { try await $0.shares(id) } }
    }

    private func row(_ name: String, detail: String, role: SharedCard.Role, remove: @escaping () -> Void, change: @escaping (SharedCard.Role) -> Void) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(name)
                Text(detail).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            Picker("", selection: Binding(get: { role }, set: change)) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }.labelsHidden().fixedSize()
            Button(role: .destructive, action: remove) { Image(systemName: "xmark.circle") }.buttonStyle(.borderless).accessibilityLabel("Stop sharing")
        }
    }

    private func addPerson() {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard address.contains("@") else { return }
        email = ""
        change(email: address, role)
    }

    private func change(email: String, _ role: SharedCard.Role) { run { try await $0.share(id, email: email, role: role) } }
    private func changeVault(_ vaultId: String, _ role: SharedCard.Role) {
        run { try await $0.share(id, vaultId: vaultId, role: role) }
        model.sync?.schedule(after: 0.5)
    }
    private func remove(_ type: String, _ target: String) {
        run { try await $0.unshare(id, type: type, target: target) }
        model.sync?.schedule(after: 0.5)
    }

    private func run(_ work: @escaping (ServerAPI) async throws -> CardShares) {
        let api = model.api
        Task {
            do {
                shares = try await work(api)
                failed = nil
            } catch APIError.offline {
                failed = "Sharing needs a connection."
            } catch {
                failed = "That didn't work. Try again."
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
                        Text(Date(timeIntervalSince1970: Double(comment.created_at) / 1000), format: .relative(presentation: .named)).font(.caption).foregroundStyle(Theme.muted)
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
