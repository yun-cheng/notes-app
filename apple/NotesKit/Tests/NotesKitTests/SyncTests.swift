import Foundation
import Testing

@testable import NotesKit

/// A server in memory: last write wins by `updated_at`, like the real one.
actor FakeServer: SyncAPI {
    var records: [String: CardRecord] = [:]
    var seq: Int64 = 0
    var vaultList: [Vault] = [personal]
    var reachable = true
    var goneIds: [String] = []

    func setReachable(_ value: Bool) { reachable = value }

    func put(_ record: CardRecord) {
        seq += 1
        var r = record
        r.seq = seq
        records[r.id] = r
    }

    func push(_ batch: [CardRecord]) async throws -> [PushResult] {
        guard reachable else { throw APIError.offline }
        return batch.map { local in
            if let current = records[local.id], current.seq != local.seq {
                if local.updated_at > current.updated_at {
                    put(local)
                    return .clientWon(id: local.id, seq: seq, loser: current)
                }
                return .serverWon(id: local.id, server: current)
            }
            put(local)
            return .ok(id: local.id, seq: seq)
        }
    }

    func pull(since: Int64) async throws -> PullResponse {
        guard reachable else { throw APIError.offline }
        let newer = records.values.filter { $0.seq > since }.sorted { $0.seq < $1.seq }
        return PullResponse(records: newer, gone: goneIds, next: newer.last?.seq ?? since, more: false)
    }

    func vaults() async throws -> [Vault] {
        guard reachable else { throw APIError.offline }
        return vaultList
    }

    func shared() async throws -> SharedResponse { SharedResponse(cards: [], vaults: [], comments: [CommentCount(card_id: "c-talk", open: 2)]) }

    func setGone(_ ids: [String]) { goneIds = ids }
    func setVaults(_ vaults: [Vault]) { vaultList = vaults }
}

@MainActor
@Suite struct SyncTests {
    @Test func twoDevicesMeetThroughTheServer() async throws {
        let server = FakeServer()
        let a = try await makeRepo()
        let b = try await makeRepo()
        let syncA = SyncEngine(repo: a, api: server)
        let syncB = SyncEngine(repo: b, api: server)

        let note = try await a.createNote(title: "Hello")
        await syncA.sync()
        #expect(syncA.state == .idle && syncA.pending == 0)
        await syncB.sync()
        #expect(try await b.card(note.id)?.title == "Hello")
    }

    @Test func aConflictKeepsBothVersions() async throws {
        let server = FakeServer()
        let clockA = Clock()
        let clockB = Clock()
        clockB.now = 5_000
        let a = try await makeRepo(clockA)
        let b = try await makeRepo(clockB)
        let syncA = SyncEngine(repo: a, api: server)
        let syncB = SyncEngine(repo: b, api: server)

        let note = try await a.createNote(title: "Draft")
        await syncA.sync()
        await syncB.sync()
        try await a.update(note.id) { $0.title = "From A" }
        try await b.update(note.id) { $0.title = "From B" }
        await syncB.sync()
        await syncA.sync()

        let titles = try await a.allCards().map(\.title).sorted()
        #expect(titles == ["From A (conflict copy)", "From B"])
    }

    @Test func offlineKeepsChangesWaiting() async throws {
        let server = FakeServer()
        await server.setReachable(false)
        let repo = try await makeRepo()
        let sync = SyncEngine(repo: repo, api: server)
        _ = try await repo.createTodo(title: "Call Mum")
        await sync.sync()
        #expect(sync.state == .offline && sync.pending == 1)
        #expect(sync.summary == "Offline, 1 change waiting")
        await server.setReachable(true)
        await sync.sync()
        #expect(sync.state == .idle && sync.pending == 0)
    }

    @Test func aCardMovedOutOfReachLeavesTheDevice() async throws {
        let server = FakeServer()
        let repo = try await makeRepo()
        let sync = SyncEngine(repo: repo, api: server)
        let note = try await repo.createNote(title: "Moving")
        await sync.sync()
        await server.setGone([note.id])
        await sync.sync()
        #expect(try await repo.card(note.id) == nil)
        #expect(try await repo.commentCounts() == ["c-talk": 2])
    }

    @Test func aWithheldVaultKeepsNoCards() async throws {
        let server = FakeServer()
        let repo = try await makeRepo()
        let sync = SyncEngine(repo: repo, api: server)
        _ = try await repo.createNote(title: "Before the PIN")
        await sync.sync()
        var held = personal
        held.withheld = true
        await server.setVaults([held])
        await sync.sync()
        #expect(try await repo.allCards().isEmpty)
        await server.setVaults([personal])
        await sync.sync()
        #expect(try await repo.allCards().map(\.title) == ["Before the PIN"])
    }

    @Test func anEditDuringAPushThatLostIsKept() async throws {
        let repo = try await makeRepo()
        let note = try await repo.createNote(title: "Mine")
        let sent = try #require(try await repo.pushable().first)
        try await repo.update(note.id) { $0.title = "Mine, edited" }
        let server = CardRecord(id: note.id, vault_id: "v1", updated_at: 99_999, deleted: false, seq: 4, payload: #"{"type":"note","title":"Theirs","content":{"type":"doc"},"tags":[]}"#)
        #expect(try await repo.forceRemote(server, ifUpdatedAt: sent.updated_at) == false)
        #expect(try await repo.card(note.id)?.title == "Mine, edited")
    }
}
