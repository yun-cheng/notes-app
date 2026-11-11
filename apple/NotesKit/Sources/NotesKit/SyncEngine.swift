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
            if try await repo.applyAccess(vaults: try await vaults, shared: try await shared) { try await repo.setCursor(0) }
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
                    try await repo.saveConflictCopy(loser: local, winner: server)
                    try await repo.forceRemote(server)
                case .retry:
                    break
                case .refused:
                    refused.insert(local.id)
                }
            }
            if results.allSatisfy({ if case .retry = $0 { true } else { false } }) { return refused.count }
        }
    }

    private func pull() async throws {
        var since = try await repo.cursor()
        while true {
            let page = try await api.pull(since: since)
            try await repo.applyRemote(page.records)
            since = page.next
            try await repo.setCursor(since)
            if !page.more { return }
        }
    }
}
