import Foundation
import Observation

/// Pushes local changes and pulls remote ones. Mirrors the web app's `SyncEngine`.
@MainActor
@Observable
public final class SyncEngine {
    public enum State: Sendable, Equatable { case idle, syncing, offline, signedOut, error }

    public private(set) var state: State = .idle
    public private(set) var pending = 0
    public private(set) var lastSyncedAt: Date?

    private let repo: Repository
    private let api: any SyncAPI
    private var running: Task<Void, Never>?
    private var again = false
    private var debounce: Task<Void, Never>?

    public init(repo: Repository, api: any SyncAPI) {
        self.repo = repo
        self.api = api
    }

    public var summary: String {
        let waiting = pending == 0 ? "" : "\(pending) \(pending == 1 ? "change" : "changes") waiting"
        switch state {
        case .syncing: return "Syncing…"
        case .offline: return waiting.isEmpty ? "Offline" : "Offline, \(waiting)"
        case .signedOut: return "Sign in again to sync"
        case .error: return "Couldn't sync, will retry"
        case .idle: return waiting.isEmpty ? "Synced" : waiting.prefix(1).uppercased() + waiting.dropFirst()
        }
    }

    /// Syncs shortly after the latest local change.
    public func schedule(after seconds: Double = 1.5) {
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(for: .seconds(seconds))
            if !Task.isCancelled { await sync() }
        }
    }

    /// Runs a sync. If one is already running, another follows it.
    public func sync() async {
        if state == .signedOut { return }
        if let running {
            again = true
            return await running.value
        }
        let task = Task { await runUntilSettled() }
        running = task
        await task.value
        running = nil
    }

    private func runUntilSettled() async {
        repeat {
            again = false
            await runOnce()
        } while again && state != .signedOut
    }

    private func runOnce() async {
        state = .syncing
        var next: State = .idle
        do {
            let refused = try await push()
            // Vaults first, so a card in a newly private vault is never shown before its lock is known.
            async let vaults = api.vaults()
            async let shared = api.shared()
            let access = try await shared
            // Newly shared cards can be older than the cursor, so pull everything again when access grows.
            if try await repo.applyAccess(vaults: try await vaults, shared: access.cards, vaultShares: access.vaults ?? []) {
                try await repo.setCursor(0)
            }
            try await repo.putCommentCounts(access.comments ?? [])
            try await pull()
            if refused > 0 { next = .error } else { lastSyncedAt = Date() }
        } catch APIError.offline {
            next = .offline
        } catch APIError.signedOut {
            next = .signedOut
        } catch {
            next = .error
        }
        pending = (try? await repo.pendingCount()) ?? 0
        state = next
    }

    /// Pushes until nothing is left that can be pushed. Returns how many records the server refused.
    private func push() async throws -> Int {
        var refused = Set<String>()
        while true {
            let batch = try await repo.pushable(limit: Limits.pushBatch, excluding: refused)
            if batch.isEmpty { return refused.count }
            let results = try await api.push(batch)
            let byId = Dictionary(uniqueKeysWithValues: batch.map { ($0.id, $0) })
            for result in results {
                guard let local = byId[result.id] else { continue }
                switch result {
                case .ok(_, let seq):
                    try await repo.markSynced(id: local.id, updatedAt: local.updated_at, seq: seq)
                case .clientWon(_, let seq, let loser):
                    try await repo.markSynced(id: local.id, updatedAt: local.updated_at, seq: seq)
                    try await repo.saveConflictCopy(loser: loser, winner: local)
                case .serverWon(_, let server):
                    // An edit made while the push was on its way is newer than what lost: it stays, and the next push settles it.
                    if try await repo.forceRemote(server, ifUpdatedAt: local.updated_at) {
                        try await repo.saveConflictCopy(loser: local, winner: server)
                    }
                case .retry:
                    break
                case .refused:
                    refused.insert(local.id)
                }
            }
            if results.allSatisfy({ if case .retry = $0 { true } else { false } }) { return refused.count }
        }
    }

    /// How many pulled cards are put away at once, at most a page more (`pull`).
    static let pullBatch = 2000

    /// Takes what changed on the server since the last pull, a page at a time, and puts it away a few pages at once,
    /// as the web does: each time cards are put away the app reads them all again, so a first sync of thousands, page
    /// by page, would do so dozens of times over.
    private func pull() async throws {
        var since = try await repo.cursor()
        while true {
            var records: [CardRecord] = []
            var at: [String: Int] = [:]
            var gone: Set<String> = []
            var more = false
            repeat {
                let page = try await api.pull(since: since)
                // A later page has the newer copy, and a card back after leaving this account's vaults stays.
                for r in page.records {
                    if let i = at[r.id] { records[i] = r } else { at[r.id] = records.count; records.append(r) }
                    gone.remove(r.id)
                }
                gone.formUnion(page.gone ?? [])
                since = page.next
                more = page.more
            } while more && records.count < Self.pullBatch
            try await repo.applyRemote(records)
            if !gone.isEmpty { try await repo.dropCards(Array(gone)) }
            try await repo.setCursor(since)
            if !more { return }
        }
    }
}
