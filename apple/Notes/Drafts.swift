import NotesKit
import SwiftUI

/// What's written but not yet sent, kept for the account and following it between devices, as the web app's
/// `drafts.ts`: the journal box's, one for each view of the journal, and a comment's, one for each entry. Kept here
/// as it's typed, sent a moment after typing stops, others' taken in after each sync; one emptied or sent goes
/// everywhere. One bound for an encrypted vault stays in memory only, and is never sent.
@MainActor
@Observable
final class Drafts {
    static let shared = Drafts()

    struct Entry: Codable {
        var value: JSONValue?
        var at: Date
        var dirty: Bool?
        var server: Int64?
    }

    struct Kept: Codable {
        var entries: [String: Entry] = [:]
        var fetched: Int64 = 0
    }

    @ObservationIgnored private var memory: [String: JSONValue] = [:]
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored var accountId = ""
    @ObservationIgnored var api: ServerAPI?
    /// Bumped when a draft comes from another device, so an empty box can take it in.
    var arrived: [String: Int] = [:]

    private var storeKey: String { "drafts:\(accountId)" }

    private func read() -> Kept {
        guard let data = UserDefaults.standard.data(forKey: storeKey), var kept = try? JSONDecoder().decode(Kept.self, from: data) else { return Kept() }
        kept.entries = kept.entries.filter { $0.value.dirty == true || ($0.value.value != nil && Date().timeIntervalSince($0.value.at) < 30 * 86400) }
        return kept
    }

    private func write(_ kept: Kept) { UserDefaults.standard.set(try? JSONEncoder().encode(kept), forKey: storeKey) }

    func get(_ kind: String, _ key: String) -> JSONValue? {
        let k = "\(kind):\(key)"
        if let m = memory[k] { return m }
        let v = read().entries[k]?.value
        return v?.isNull == true ? nil : v
    }

    /// Keeps what's in a box so far, to send in a moment; nil drops it, everywhere. `onlyHere` keeps it in memory.
    func set(_ kind: String, _ key: String, _ value: JSONValue?, onlyHere: Bool = false) {
        let k = "\(kind):\(key)"
        if let value, onlyHere { memory[k] = value } else { memory[k] = nil }
        var kept = read()
        let had = kept.entries[k]
        if let value, !onlyHere {
            if let had, had.dirty != true, had.value == value { return }
            kept.entries[k] = Entry(value: value, at: Date(), dirty: true)
        } else if let had, had.value != nil {
            kept.entries[k] = Entry(value: nil, at: Date(), dirty: true)
        } else if let had, had.dirty != true {
            _ = had
            kept.entries[k] = nil
        } else {
            return
        }
        write(kept)
        timer?.cancel()
        timer = Task {
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { await send() }
        }
    }

    func send() async {
        guard let api else { return }
        let dirty = read().entries.filter { $0.value.dirty == true }
        guard !dirty.isEmpty else { return }
        let changes = dirty.map { k, e -> ServerAPI.DraftChange in
            let at = k.firstIndex(of: ":")!
            return .init(kind: String(k[..<at]), key: String(k[k.index(after: at)...]), value: e.value ?? .null)
        }
        guard (try? await api.sendDrafts(changes)) != nil else { return }
        var kept = read()
        for (k, e) in dirty {
            guard let now = kept.entries[k], now.at == e.at, now.dirty == true else { continue }
            if now.value == nil { kept.entries[k] = nil } else { kept.entries[k]?.dirty = nil }
        }
        write(kept)
    }

    /// Sends what's waiting, then takes in what other devices changed since the last time.
    func sync() async {
        await send()
        guard let api else { return }
        let since = read().fetched
        guard let answer = try? await api.drafts(since: since > 0 ? max(0, since - 60_000) : 0) else { return }
        var kept = read()
        for d in answer.drafts {
            let k = "\(d.kind):\(d.key)"
            let here = kept.entries[k]
            if here?.dirty == true || (here?.server.map { $0 >= d.at } ?? false) || memory[k] != nil { continue }
            if d.value == nil || d.value?.isNull == true {
                guard here != nil else { continue }
                kept.entries[k] = nil
            } else {
                if here?.value == d.value {
                    kept.entries[k]?.server = d.at
                    continue
                }
                kept.entries[k] = Entry(value: d.value, at: Date(), server: d.at)
            }
            arrived[k, default: 0] += 1
        }
        kept.fetched = max(kept.fetched, answer.at)
        write(kept)
    }

    func forget() { UserDefaults.standard.removeObject(forKey: storeKey) }

    /// A journal draft as the web keeps it, a document, from what's typed in the box.
    static func doc(_ text: String) -> JSONValue? { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : Doc.fromText(text) }

    /// A journal draft's words, as the box shows them.
    static func text(_ doc: JSONValue) -> String { Doc.previewLines(doc).joined(separator: "\n") }
}
