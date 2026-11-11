import Foundation
import Testing

@testable import NotesKit

final class Clock: @unchecked Sendable {
    var now: Int64 = 1_000
    var ids = 0
    func tick() -> Int64 {
        now += 1
        return now
    }
    func id() -> String {
        ids += 1
        return "id-\(ids)"
    }
}

let personal = Vault(id: "v1", name: "Personal", owner_id: "u1", lock: .none, ai_access: .off, created_at: 1, pin: nil, hidden: false)

func makeRepo(_ clock: Clock = Clock()) async throws -> Repository {
    let repo = try Repository(path: ":memory:", now: { clock.tick() }, newId: { clock.id() })
    _ = try await repo.applyAccess(vaults: [personal], shared: [])
    return repo
}

@Suite struct CardTests {
    @Test func keepsFieldsItDoesNotKnow() throws {
        let text = #"{"type":"note","title":"Hi","content":{"type":"doc","content":[{"type":"callout","attrs":{"tone":"warm"}}]},"tags":[],"futureField":{"a":[1,2.5,true,null]}}"#
        let payload = try JSON.decode([String: JSONValue].self, from: text)
        let again = try JSON.decode([String: JSONValue].self, from: try JSON.string(payload))
        #expect(again == payload)
        #expect(again["futureField"]?["a"] == [1, .double(2.5), true, nil])
    }

    @Test func plainTextAndBlankness() {
        let doc: JSONValue = ["type": "doc", "content": [
            ["type": "paragraph", "content": [["type": "text", "text": "See "], ["type": "cardLink", "attrs": ["id": "c2", "label": "Old"]]]],
            ["type": "paragraph", "content": [["type": "text", "text": "next"]]],
        ]]
        #expect(Doc.plainText(doc) == "See Old next")
        #expect(Doc.plainText(doc, titleOf: { _, _ in "New" }) == "See New next")
        #expect(Doc.linkedCardIds(doc) == ["c2"])
        var card = Card(id: "a", vaultId: "v", updatedAt: 1, deleted: false, seq: 0, payload: ["type": "note", "title": "", "tags": [], "content": Doc.empty])
        #expect(card.isBlank)
        card.content = ["type": "doc", "content": [["type": "photo", "attrs": ["id": "p1"]]]]
        #expect(!card.isBlank)
    }

    @Test func dateKeys() {
        #expect(DateKey.adding(1, to: "2026-02-28") == "2026-03-01")
        #expect(DateKey.adding(-1, to: "2026-01-01") == "2025-12-31")
    }
}

@Suite struct RepositoryTests {
    @Test func createsAndUpdatesCards() async throws {
        let repo = try await makeRepo()
        let note = try await repo.createNote(title: "First")
        #expect(note.vaultId == "v1")
        try await repo.update(note.id) { $0.title = "Renamed" }
        #expect(try await repo.card(note.id)?.title == "Renamed")

        let todo = try await repo.createTodo(title: "Buy milk", due: "2026-11-12")
        try await repo.setDone(todo.id, true)
        let done = try #require(try await repo.card(todo.id))
        #expect(done.isDone && done.completedAt != nil && done.due == "2026-11-12")
    }

    @Test func blankNewCardsStayLocal() async throws {
        let repo = try await makeRepo()
        _ = try await repo.createNote()
        let named = try await repo.createNote(title: "Kept")
        #expect(try await repo.pushable().map(\.id) == [named.id])
    }

    @Test func diaryIdComesFromTheDate() async throws {
        let repo = try await makeRepo()
        let doc: JSONValue = ["type": "doc", "content": [["type": "paragraph", "content": [["type": "text", "text": "Sunny"]]]]]
        let entry = try await repo.saveDiary(date: "2026-11-11", content: doc)
        #expect(entry.id == "diary:v1:2026-11-11")
        #expect(entry.date == "2026-11-11")
        let again = try await repo.saveDiary(date: "2026-11-11", content: Doc.empty)
        #expect(again.id == entry.id && again.content == Doc.empty)
    }

    @Test func remoteChangesNeverOverwriteUnpushedOnes() async throws {
        let repo = try await makeRepo()
        let note = try await repo.createNote(title: "Mine")
        let remote = CardRecord(id: note.id, vault_id: "v1", updated_at: 5, deleted: false, seq: 9, payload: #"{"type":"note","title":"Theirs","content":{"type":"doc"},"tags":[]}"#)
        try await repo.applyRemote([remote])
        #expect(try await repo.card(note.id)?.title == "Mine")

        let pushed = try #require(try await repo.pushable().first)
        try await repo.markSynced(id: note.id, updatedAt: pushed.updated_at, seq: 3)
        #expect(try await repo.pushable().isEmpty)
        try await repo.applyRemote([remote])
        #expect(try await repo.card(note.id)?.title == "Theirs")
    }

    @Test func lostAccessRemovesCards() async throws {
        let repo = try await makeRepo()
        let other = Vault(id: "v2", name: "Team", owner_id: "u2", lock: .none, ai_access: .off, created_at: 2, pin: nil, hidden: false, role: .editor)
        #expect(try await repo.applyAccess(vaults: [personal, other], shared: []))
        _ = try await repo.createNote(title: "Team note", vaultId: "v2")
        #expect(try await repo.applyAccess(vaults: [personal], shared: []) == false)
        #expect(try await repo.allCards().isEmpty)
    }
}

@Suite struct EncryptionTests {
    // Made by the web app's crypto/vaultKeys.ts.
    static let rawKey = "NumxWqjRaxqTH/cZae5pbj+iXJYtaaJ6QGZudOs8NFE="
    static let encryption: JSONValue = [
        "version": 1,
        "kdf": ["name": "argon2id", "salt": "UdG8McNxBKga+AkND5BO6A==", "memory": 64, "iterations": 1, "parallelism": 1],
        "wrapped": "j9QUtfKym3mFCfhZLA06kYQaLDWCy3RBHP57Cw0dtC4r9bzkzFpdEHYerFEw85H4Dm6S1TY9w9Bol5d/",
        "recovery": "2Im3QIq3MJ3aTelWXJR71EMlK1yyjleLNu/Akta1vIu5tY9jtQ0n0BqIymb5z6Agm6SyfU0JTi74g1d9",
    ]
    static let recoveryKey = "4J66-R6XW-KDJY-9XRC-CN6B-GR8T-HEA9-YJRK"
    static let payload =
        "e1:IUhZ3PNrJsDhgwfcJzFiTstho5VHFxnJG19z0mSLpaoEU4us3VbaUYEnCEzxZbYqx+BWKONybxFIg7/fNfEvNoWrb+7QSBUcvWYA5BNtoarJRYksnWM8aF7CixHFqlaDNDhMgEj5BCY0Cp1O"

    @Test func readsTheWebAppsCiphertext() throws {
        let key = try #require(VaultCrypto.unlock(encryption: Self.encryption, recoveryKey: Self.recoveryKey.lowercased()))
        #expect(key.withUnsafeBytes { Data($0).base64EncodedString() } == Self.rawKey)
        #expect(VaultCrypto.unlock(encryption: Self.encryption, recoveryKey: "0000-0000-0000-0000-0000-0000-0000-0000") == nil)
        let text = try #require(VaultCrypto.decryptPayload(key, Self.payload, cardId: "card-1", vaultId: "vault-1"))
        #expect(text.contains(#""title":"Secret""#))
        // Bound to its card: the same ciphertext under another ID doesn't open.
        #expect(VaultCrypto.decryptPayload(key, Self.payload, cardId: "card-2", vaultId: "vault-1") == nil)
    }

    @Test func lockedCardsAreSealedUntilTheKeyArrives() async throws {
        let clock = Clock()
        let repo = try Repository(path: ":memory:", now: { clock.tick() }, newId: { clock.id() })
        var secret = Vault(id: "vault-1", name: "Private", owner_id: "u1", lock: .pin, ai_access: .off, created_at: 1, pin: nil, hidden: false)
        secret.encryption = Self.encryption
        _ = try await repo.applyAccess(vaults: [personal, secret], shared: [])
        try await repo.applyRemote([CardRecord(id: "card-1", vault_id: "vault-1", updated_at: 1, deleted: false, seq: 1, payload: Self.payload)])

        let sealed = try #require(try await repo.card("card-1"))
        #expect(sealed.sealed && sealed.title.isEmpty)
        #expect(try await repo.update("card-1") { $0.title = "x" } == nil)

        repo.keyring.set("vault-1", key: try #require(VaultCrypto.unlock(encryption: Self.encryption, recoveryKey: Self.recoveryKey)))
        try await repo.update("card-1") { $0.title = "Still secret" }
        let stored = try #require(try await repo.pushable().first)
        #expect(stored.payload.hasPrefix("e1:") && !stored.payload.contains("Still secret"))
        #expect(try await repo.card("card-1")?.title == "Still secret")
    }
}
