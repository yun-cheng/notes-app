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

    @Test func anOldDiaryCardReadsAsANoteOnItsDay() async throws {
        let repo = try await makeRepo()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Taipei")!
        // Started on the 10th, for the 11th: it reads as written at the end of the 11th.
        let started = Int64(calendar.date(from: DateComponents(year: 2026, month: 11, day: 10, hour: 9))!.timeIntervalSince1970 * 1000)
        let old: [String: JSONValue] = ["type": "diary", "date": "2026-11-11", "createdAt": .int(started), "title": "", "tags": [], "content": Doc.empty]
        let modern = modernPayload(old, calendar: calendar)
        #expect(modern["type"] == "note" && modern["date"] == nil)
        let end = Int64(calendar.date(from: DateComponents(year: 2026, month: 11, day: 11, hour: 23, minute: 59, second: 59, nanosecond: 999_000_000))!.timeIntervalSince1970 * 1000)
        #expect(modern["createdAt"]?.intValue == end)
        // Written on its day: its time stays.
        let sameDay = Int64(calendar.date(from: DateComponents(year: 2026, month: 11, day: 11, hour: 8))!.timeIntervalSince1970 * 1000)
        #expect(modernPayload(["type": "diary", "date": "2026-11-11", "createdAt": .int(sameDay)], calendar: calendar)["createdAt"]?.intValue == sameDay)

        let record = CardRecord(id: "diary:v1:2026-11-11", vault_id: "v1", updated_at: 5, deleted: false, seq: 2, payload: #"{"type":"diary","date":"2026-11-11","title":"","tags":[],"content":{"type":"doc"}}"#)
        try await repo.applyRemote([record])
        #expect(try await repo.card(record.id)?.type == .note)
    }

    @Test func pagesKeepBlankOnesInTheMiddleOnly() throws {
        let words = { (text: String) -> JSONValue in ["type": "doc", "content": [["type": "paragraph", "content": [["type": "text", "text": .string(text)]]]]] }
        var card = Card(id: "c", vaultId: "v1", updatedAt: 1, deleted: false, seq: 0, payload: ["type": "note", "back": words("Old back")])
        #expect(card.turnPages == [words("Old back")])
        card.morePages = [words("Two"), Doc.empty, words("Four"), Doc.empty]
        #expect(card.morePages == [words("Two"), Doc.empty, words("Four")])
        #expect(card.turnPages == [words("Two"), words("Four")])
        #expect(card.payload["back"] == .null)
        card.morePages = [Doc.empty]
        #expect(card.payload["pages"] == .null)
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

@Suite struct ChangeLogTests {
    static let me = "u1"
    static let vaults = [
        Vault(id: "vault-u1", name: "Personal", owner_id: "u1", lock: .none, ai_access: .off, created_at: 1, pin: nil, hidden: false),
        Vault(id: "diary-u1", name: "Diary", owner_id: "u1", lock: .pin, ai_access: .off, created_at: 2, pin: nil, hidden: false),
    ]

    func repo(_ clock: Clock = Clock()) async throws -> Repository {
        let repo = try Repository(path: ":memory:", now: { clock.tick() }, newId: { clock.id() })
        _ = try await repo.applyAccess(vaults: Self.vaults, shared: [])
        await repo.setMainVault("vault-u1")
        return repo
    }

    @Test func undoAndRedoAnEdit() async throws {
        let repo = try await repo()
        let note = try await repo.createNote(title: "First")
        try await repo.update(note.id) { $0.title = "Second" }
        #expect(try await repo.undo() == 1)
        #expect(try await repo.card(note.id)?.title == "First")
        #expect(try await repo.redo() == 1)
        #expect(try await repo.card(note.id)?.title == "Second")
        // Undoing the making of a card puts it in the Trash.
        _ = try await repo.undo()
        _ = try await repo.undo()
        #expect(try await repo.card(note.id)?.deleted == true)
    }

    @Test func typingJoinsOneChangeAndALaterEditBlocksUndo() async throws {
        let clock = Clock()
        let repo = try await repo(clock)
        let note = try await repo.createNote(content: Doc.fromText("a"))
        for word in ["ab", "abc", "abcd"] { try await repo.update(note.id, typed: true) { $0.content = Doc.fromText(word) } }
        #expect(try await repo.changes().count == 2)
        #expect(Changes.describe(try await repo.changes().last!.change) == "Edited")
        // Changed on another device since: undo leaves it alone.
        try await repo.applyRemote([])
        try await repo.update(note.id, group: "other") { $0.payload["color"] = "blue" }
        _ = try await repo.undo()
        #expect(try await repo.card(note.id)?.color == nil)
        _ = try await repo.undo()
        #expect(try await repo.card(note.id)?.content == Doc.fromText("a"))
    }

    @Test func savingTheBoxMakesTagsOnceAndIsOneUndo() async throws {
        let repo = try await repo()
        let context = SaveContext(accountId: Self.me, vaults: Self.vaults, locked: [], index: CardIndex(try await repo.allCards()), sharedInto: [:])
        let entries = EntryParser.parseEntries("Idea #diary\n[] milk #shop\n[] eggs #Shop @tomorrow", today: "2026-11-12")
        guard case .saved(let ids, _) = try await repo.save(entries, in: context), ids.count == 3 else { Issue.record("not saved"); return }
        let cards = try await repo.allCards()
        let tags = cards.filter { $0.type == .tag }
        #expect(tags.map(\.title) == ["shop"] && tags.first?.keptToVault == true && tags.first?.vaultId == "vault-u1")
        #expect(try await repo.card(ids[0])?.vaultId == "diary-u1")
        #expect(try await repo.card(ids[2])?.due == "2026-11-13")
        // A locked Diary keeps everything in the box.
        let locked = SaveContext(accountId: Self.me, vaults: Self.vaults, locked: ["diary-u1"], index: CardIndex(cards), sharedInto: [:])
        #expect(try await repo.save(EntryParser.parseEntries("x\n[] y #diary", today: "2026-11-12"), in: locked) == .unlock(vaultId: "diary-u1"))
        #expect(try await repo.undo() == 4)
        #expect(try await repo.allCards().allSatisfy(\.deleted))
    }

    @Test func aRepeatingTodoMovesOnWhenTicked() async throws {
        let repo = try await repo()
        let todo = try await repo.createTodo(title: "Gym", due: "2026-11-12", repeat: Repeat(unit: .week, every: 1))
        #expect(try await repo.setDone(todo.id, true, today: "2026-11-12") == "2026-11-19")
        #expect(try await repo.card(todo.id)?.isDone == false)
    }
}
