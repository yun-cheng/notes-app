import CryptoKit
import NotesKit
import SwiftUI

/// Turning a vault's encryption on and off, changing its PIN, recovering it, and letting members in, as the web app's
/// `useVaultEncryption`. Each step that changes how cards are stored syncs first and after, so the server ends up
/// holding only one kind of payload.
@MainActor
struct VaultEncryption {
    let model: AppModel
    var repo: Repository { model.repo }
    var api: ServerAPI { model.api }

    struct NeedsPin: LocalizedError {
        var errorDescription: String? { "Lock the vault and open it with its PIN first." }
    }

    struct OutOfReach: LocalizedError {
        let count: Int
        var errorDescription: String? { "\(count == 1 ? "A photo or file" : "\(count) photos or files") in it can't be fetched now. Try again when you're online." }
    }

    static func encryptingName(_ vaultId: String) -> String { "encrypting:\(vaultId)" }

    @discardableResult
    func save(_ vault: Vault, _ changes: VaultChanges) async throws -> Vault {
        let updated = try await api.updateVault(vault.id, changes)
        try await repo.putVaults([updated])
        await model.refresh()
        return updated
    }

    /// Encrypts a vault's cards under a new key, setting `pin` as its PIN. Returns the recovery key to show once.
    func encrypt(_ vault: Vault, pin: String) async throws -> String {
        await model.sync?.sync()
        let made = try await Task.detached { try VaultKeys.create(pin: pin) }.value
        // Noted first, so the cards are still stored again if this stops partway.
        try await repo.setMeta(Self.encryptingName(vault.id), true)
        do {
            try await save(vault, VaultChanges(pin: .some(VaultPin.hash(pin)), encryption: .some(made.encryption)))
        } catch {
            try? await repo.setMeta(Self.encryptingName(vault.id), Bool?.none)
            throw error
        }
        repo.keyring.set(vault.id, key: made.key)
        await model.open(vault.id)
        _ = await finishEncrypting(vault.id)
        // Its photos and files are sealed too, in the background.
        Task { _ = try? await reseal(vault.id, seal: true) }
        return made.recoveryKey
    }

    /// Finishes turning encryption on: stores its cards again under the key, sends them, seals its comments and has
    /// the server drop the readable versions it kept. Asked again whenever the vault is opened. True once done.
    func finishEncrypting(_ vaultId: String) async -> Bool {
        guard (try? await repo.meta(Self.encryptingName(vaultId), as: Bool.self)) == true else { return true }
        guard let key = repo.keyring.key(vaultId) else { return false }
        try? await repo.recodeVault(vaultId)
        await model.sync?.sync()
        let unsent = ((try? await repo.pushable()) ?? []).contains { $0.vault_id == vaultId }
        guard !unsent, model.sync?.state == .idle else { return false }
        do {
            let open = try await api.vaultComments(vaultId).filter { !VaultCrypto.isEncrypted($0.body) }
            try await api.putVaultComments(vaultId, try open.map { ($0.id, try VaultKeys.encryptComment(key, $0.body, cardId: $0.card_id, vaultId: vaultId)) })
            try await api.purgePlaintextHistory(vaultId)
            try await repo.setMeta(Self.encryptingName(vaultId), Bool?.none)
            return true
        } catch {
            return false
        }
    }

    /// Stores the vault's cards readable again and drops its PIN, or with `keepPin`, keeps it locked by the PIN alone.
    func decrypt(_ vault: Vault, keepPin: Bool = false) async throws {
        await model.sync?.sync()
        // Its photos and files are opened first, while the key is here.
        let failed = try await reseal(vault.id, seal: false)
        if failed > 0 { throw OutOfReach(count: failed) }
        let key = repo.keyring.key(vault.id)
        try await save(vault, keepPin ? VaultChanges(encryption: .some(nil)) : VaultChanges(pin: .some(nil), encryption: .some(nil)))
        try await repo.recodeVault(vault.id)
        try? await repo.setMeta(Self.encryptingName(vault.id), Bool?.none)
        await model.sync?.sync()
        // Its comments last, once its cards are done.
        if let key, let sealed = try? await api.vaultComments(vault.id).filter({ VaultCrypto.isEncrypted($0.body) }) {
            let opened = sealed.compactMap { c in VaultKeys.decryptComment(key, c.body, cardId: c.card_id, vaultId: vault.id).map { (c.id, $0) } }
            try? await api.putVaultComments(vault.id, opened)
        }
    }

    /// A new PIN for an encrypted vault: the owner's wraps the same key again; a member's is a new key pair, with the
    /// key they have open sealed to it.
    func rewrap(_ vault: Vault, newPin: String) async throws {
        guard let key = repo.keyring.key(vault.id), let encryption = vault.encryption else { throw NeedsPin() }
        let id = vault.id
        let next: JSONValue = try await Task.detached {
            VaultKeys.isMemberCopy(encryption)
                ? ["version": 1, "member": try VaultKeys.changeMemberPin(key, newPin: newPin, vaultId: id)]
                : try VaultKeys.changePin(encryption, key: key, newPin: newPin)
        }.value
        try await save(vault, VaultChanges(pin: .some(VaultPin.hash(newPin)), encryption: .some(next)))
    }

    /// A member of an encrypted vault sets their own PIN, which asks its owner for its key.
    func askForKey(_ vault: Vault, pin: String) async throws {
        let member = try await Task.detached { try VaultKeys.request(pin: pin) }.value
        try await save(vault, VaultChanges(pin: .some(VaultPin.hash(pin)), encryption: .some(["version": 1, "member": member])))
    }

    /// The owner lets someone in: the vault key sealed to the public key they asked with. `pin` opens the key here if
    /// it isn't open. Nil if that PIN is wrong.
    func letIn(_ vault: Vault, userId: String, publicKey: String, pin: String?) async throws -> VaultPeople? {
        guard let encryption = vault.encryption, !vault.isMemberCopy else { return nil }
        var key = repo.keyring.key(vault.id)
        if key == nil, let pin {
            let id = vault.id
            key = await Task.detached { VaultKeys.unlock(encryption, pin: pin, vaultId: id) }.value
        }
        guard let key else { return nil }
        let grant = try VaultKeys.grant(key, to: publicKey, vaultId: vault.id)
        return try await api.giveVaultKey(vault.id, userId: userId, publicKey: publicKey, grant: grant)
    }

    /// Opens an encrypted vault with its recovery key and sets a new PIN. False if the recovery key is wrong.
    func recover(_ vault: Vault, recoveryKey: String, newPin: String) async throws -> Bool {
        guard let encryption = vault.encryption, !vault.isMemberCopy, let key = VaultCrypto.unlock(encryption: encryption, recoveryKey: recoveryKey) else { return false }
        let next = try await Task.detached { try VaultKeys.changePin(encryption, key: key, newPin: newPin) }.value
        try await save(vault, VaultChanges(pin: .some(VaultPin.hash(newPin)), encryption: .some(next)))
        repo.keyring.set(vault.id, key: key)
        await model.open(vault.id)
        return true
    }

    /// Copies each photo and file the vault's cards hold that isn't kept as the vault keeps them (sealed or open)
    /// under a new ID, has its entries hold the copy, and sends the old one to the Trash and deletes it once the copy is
    /// up, as the web app's `reseal.ts`. Returns how many couldn't be had now.
    func reseal(_ vaultId: String, seal: Bool) async throws -> Int {
        let cards = model.cards.filter { $0.vaultId == vaultId && $0.isEntry && !$0.sealed }
        var held: [String: Doc.FileInfo?] = [:]
        for card in cards {
            for page in [card.content] + card.morePages {
                for id in Doc.photoIds(page) where held[id] == nil { held[id] = .some(nil) }
                for file in Doc.files(page) where held[file.id] == nil { held[file.id] = file }
            }
        }
        guard !held.isEmpty else { return 0 }
        let stored = Dictionary((try? await api.attachments())?.map { ($0.id, $0) } ?? []) { a, _ in a }
        var renamed: [String: String?] = [:]
        var failed = 0
        for (id, file) in held {
            guard let there = stored[id] else { continue }
            let wrong = seal ? !there.isSealed || there.vault_id != vaultId : there.isSealed
            guard wrong else { continue }
            guard let by = await copy(id, vaultId: vaultId, file: file, seal: seal) else {
                failed += 1
                continue
            }
            renamed[id] = by
            if let poster = file?.poster { renamed[poster] = await copy(poster, vaultId: vaultId, file: nil, seal: seal, as: Doc.posterId(by)) }
        }
        guard !renamed.isEmpty else { return failed }
        let map = renamed
        for card in cards {
            try await repo.rewrite(card.id) { c in
                c.content = Self.withCopies(c.content, map)
                let pages = c.morePages.map { Self.withCopies($0, map) }
                if pages != c.morePages { c.morePages = pages }
            }
        }
        // The old ones go once their copies are up. One whose copy is still waiting stays on the server until then;
        // no entry holds it any more, so the attachment sweep sends it to the Trash later.
        await Attachments.shared.upload(model: model)
        let waiting = Set(Attachments.shared.pending.map(\.id))
        let done = renamed.filter { _, by in by.map { !waiting.contains($0) } ?? true }.map(\.key)
        guard !done.isEmpty else { return failed }
        try? await api.markAttachments(trash: done.map { ServerAPI.TrashMark(id: $0, from: nil, name: nil) }, keep: [])
        for id in done { _ = try? await api.deleteAttachment(id) }
        return failed
    }

    /// One photo or file copied under a new ID, sealed or opened as `seal` says (not as the vault is now: while
    /// encryption goes off, the vault is still encrypted), and queued to upload.
    private func copy(_ id: String, vaultId: String, file: Doc.FileInfo?, seal: Bool, as newId: String? = nil) async -> String? {
        guard let data = await Attachments.shared.data(id, model: model) else { return nil }
        do {
            let node: JSONValue
            if let file {
                node = try Attachments.shared.addFile(data, name: file.name, mime: file.mime ?? "application/octet-stream", vaultId: vaultId, model: model, duration: file.duration, id: newId, seal: seal)
            } else {
                node = try Attachments.shared.addPhoto(data, vaultId: vaultId, model: model, id: newId, seal: seal)
            }
            return node["attrs"]?["id"]?.stringValue
        } catch {
            return nil
        }
    }

    /// A document with each photo and file in `renamed` holding its copy instead; a still that couldn't be copied goes.
    nonisolated static func withCopies(_ node: JSONValue, _ renamed: [String: String?]) -> JSONValue {
        guard case .object(var o) = node else { return node }
        let type = o["type"]?.stringValue
        if type == "photo" || type == "file", var attrs = o["attrs"]?.objectValue {
            if let id = attrs["id"]?.stringValue, let by = renamed[id] ?? nil { attrs["id"] = .string(by) }
            if type == "file", let poster = attrs["poster"]?.stringValue, let by = renamed[poster] { attrs["poster"] = by.map(JSONValue.string) ?? .null }
            o["attrs"] = .object(attrs)
        }
        if let children = o["content"]?.arrayValue { o["content"] = .array(children.map { withCopies($0, renamed) }) }
        return .object(o)
    }
}
