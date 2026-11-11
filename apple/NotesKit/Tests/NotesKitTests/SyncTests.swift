import Foundation
import Testing

@testable import NotesKit

/// A server in memory: last write wins by `updated_at`, like the real one.
actor FakeServer: SyncAPI {
    var records: [String: CardRecord] = [:]
    var seq: Int64 = 0
    var vaultList: [Vault] = [personal]
    var reachable = true

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
        return PullResponse(records: newer, next: newer.last?.seq ?? since, more: false)
    }

    func vaults() async throws -> [Vault] {
        guard reachable else { throw APIError.offline }
        return vaultList
    }

    func shared() async throws -> [SharedCard] { [] }
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
}
