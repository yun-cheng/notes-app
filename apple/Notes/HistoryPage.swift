import NotesKit
import SwiftUI

/// What was changed, newest first, as the web app's History page: on this device, with Undo and Redo for each, and
/// on other devices, by AI apps and by people sharing, each marked with who or what made it and with an Undo of its
/// own. The sidebar's filter narrows it as it narrows the journal.
struct HistoryPage: View {
    @Environment(AppModel.self) private var model
    @State private var local: [Change] = []
    @State private var current: [String: Card] = [:]
    @State private var versions: [RecentVersion] = []
    /// The server's versions read as changes, worked out when either changes rather than on every redraw.
    @State private var synced: [(version: RecentVersion, change: Change)] = []
    @State private var next: String?
    @State private var offline = false
    @State private var filter = StreamFilter()
    @State private var fetched = Date.distantPast

    struct Row: Identifiable {
        var group: String
        var changes: [Change]
        var at: Int64
        var by: String?
        var id: String { group }
    }

    var body: some View {
        let rows = merged()
        List {
            FilterRow(filter: $filter, pickDates: .constant(false)).listRowInsets(EdgeInsets())
            if offline { Text("Connect to the internet to see changes made elsewhere.").foregroundStyle(Theme.muted) }
            ForEach(rows) { row in
                Section {
                    ForEach(row.changes) { change in changeRow(change) }
                } header: {
                    Text(Date(timeIntervalSince1970: Double(row.at) / 1000).formatted(date: .abbreviated, time: .shortened) + (row.by.map { " · \($0)" } ?? ""))
                }
            }
            if next != nil { Button("Show older changes") { Task { await load(more: true) } } }
            if rows.isEmpty { ContentUnavailableView("No changes yet", systemImage: "clock.arrow.circlepath") }
        }
        .navigationTitle("History")
        .task(id: model.cardsVersion) { await load() }
    }

    private func changeRow(_ change: Change) -> some View {
        let card = current[change.cardId] ?? model.card(change.cardId)
        return HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(change.sealed ? "Locked entry" : (card ?? change.after).displayTitle).lineLimit(1)
                Text(Changes.describe(change) + (change.undoneAt != nil ? " · undone" : "")).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            if change.n < 0 {
                if Changes.canUndo(change, card), let card, model.canEdit(card) {
                    Button("Undo") {
                        model.perform { _ = try await $0.takeBack(change) }
                        model.say("Undone", undoable: true)
                    }
                    .buttonStyle(.borderless)
                }
            } else if change.undoneAt == nil, Changes.canUndo(change, card) {
                Button("Undo") { revert(change, undo: true) }.buttonStyle(.borderless)
            } else if change.undoneAt != nil, Changes.canRedo(change, card) {
                Button("Redo") { revert(change, undo: false) }.buttonStyle(.borderless)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if !change.sealed { model.openEntry = change.cardId } }
    }

    /// This device's actions and the changes that came by sync as one history, newest first, narrowed by the filter.
    private func merged() -> [Row] {
        let locked = model.lockedVaults
        let shown = { (c: Change) in !locked.contains(c.after.vaultId) && Changes.matches(c, filter, today: model.today) }
        var rows = Changes.grouped(local.filter(shown)).map { Row(group: $0.group, changes: $0.changes, at: $0.at) }
        // Older changes here wait for the server's versions of their time, so the history has no gaps.
        let reach = next.flatMap { $0.split(separator: "-").first.flatMap { Int64($0) } } ?? Int64.min
        rows = rows.filter { $0.at >= reach || next == nil }
        let logOf = Dictionary(grouping: local, by: \.cardId)
        for (v, change) in synced {
            var change = change
            guard shown(change), !Changes.inLog(change, v, logOf[change.cardId] ?? []) else { continue }
            change.by = Changes.madeBy(v)
            rows.append(Row(group: change.group, changes: [change], at: change.until, by: change.by))
        }
        return rows.sorted { $0.at > $1.at }
    }

    private func load(more: Bool = false) async {
        if let rows = try? await model.repo.changes() {
            local = rows.map(\.change)
            current = Dictionary(rows.compactMap { r in r.current.map { (r.change.cardId, $0) } }) { a, _ in a }
        }
        // The server's history is asked again at most every half minute; this device's log at each change.
        guard more || Date().timeIntervalSince(fetched) > 30 else {
            // A vault opened or locked since: its versions read differently now.
            await readSynced()
            return
        }
        fetched = Date()
        do {
            let page = try await model.api.recentVersions(before: more ? next : nil)
            if more {
                let known = Set(versions.map(\.id))
                versions += page.versions.filter { !known.contains($0.id) }
            } else {
                versions = page.versions
            }
            next = page.next
            offline = false
        } catch {
            offline = true
        }
        await readSynced()
    }

    /// Reads the server's versions as changes, off the main thread: each is decoded, and opened if sealed.
    private func readSynced() async {
        let repo = model.repo
        let all = versions
        synced = await Task.detached { all.compactMap { v in repo.syncedChange(v).map { (v, $0) } } }.value
    }

    private func revert(_ change: Change, undo: Bool) {
        let n = change.n
        model.perform { _ = try await $0.revert([n], undo: undo) }
    }
}
