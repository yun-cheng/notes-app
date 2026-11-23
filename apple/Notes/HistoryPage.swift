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
        let days = Dictionary(grouping: rows) { DateKey.of(Date(ms: $0.at)) }.sorted { $0.key > $1.key }
        VStack(spacing: 0) {
            FilterRow(filter: $filter, pickDates: .constant(false))
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Text("What was changed, newest first: on this device, on your other devices, by AI apps and by people you share with.")
                        .foregroundStyle(Theme.muted).padding(.bottom, 8)
                    if offline { Text("Connect to the internet to see changes made elsewhere.").foregroundStyle(Theme.muted).padding(.bottom, 8) }
                    if rows.isEmpty {
                        Text(filter.isFiltered ? "No changes here match. Take a filter off above, or pick another." : "Nothing has been changed yet.")
                            .foregroundStyle(Theme.muted).padding(.vertical, 24)
                    }
                    ForEach(days, id: \.key) { day, groups in
                        Text(DateKey.relativeDay(day, today: model.today)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                            .padding(.top, 14).padding(.bottom, 4)
                        ForEach(groups.sorted { $0.at > $1.at }) { row in groupView(row) }
                    }
                    if next != nil {
                        Button("Show older changes") { Task { await load(more: true) } }.buttonStyle(.bordered).padding(.top, 12)
                    } else if !rows.isEmpty {
                        Text("Undo and redo reach back through the newest 500 changes made on this device. Every version of an entry, with restore, is in its own version history.")
                            .font(.footnote).foregroundStyle(Theme.muted).padding(.top, 16)
                    }
                }
                .padding(16)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .pageBackground()
        .navigationTitle("History")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { model.undo() } label: { Label("Undo", systemImage: "arrow.uturn.backward") }.help("Undo the last change made on this device")
                Button { model.redo() } label: { Label("Redo", systemImage: "arrow.uturn.forward") }.help("Redo what was undone last")
            }
        }
        .task(id: model.cardsVersion) { await load() }
    }

    @ViewBuilder
    private func groupView(_ row: Row) -> some View {
        let undo = row.changes.filter { $0.n >= 0 && $0.undoneAt == nil && Changes.canUndo($0, current[$0.cardId] ?? model.card($0.cardId)) }
        let redo = row.changes.filter { $0.n >= 0 && $0.undoneAt != nil && Changes.canRedo($0, current[$0.cardId] ?? model.card($0.cardId)) }
        VStack(alignment: .leading, spacing: 0) {
            if row.changes.count > 1 {
                HStack(spacing: 10) {
                    Text("\(row.changes.count) changes at once").font(.footnote).foregroundStyle(Theme.muted)
                    if undo.count > 1 { Button("Undo all") { let ns = undo.map(\.n); model.perform { _ = try await $0.revert(ns, undo: true) } }.buttonStyle(.borderless).font(.footnote) }
                    if redo.count > 1 { Button("Redo all") { let ns = redo.map(\.n); model.perform { _ = try await $0.revert(ns, undo: false) } }.buttonStyle(.borderless).font(.footnote) }
                }
                .padding(.top, 6)
            }
            ForEach(row.changes) { change in ChangeRow(change: change, current: current[change.cardId], revert: revert) }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
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

    private func revert(_ change: Change, _ undo: Bool) {
        let n = change.n
        model.perform { _ = try await $0.revert([n], undo: undo) }
    }
}

/// One change, as the web's row: what it did and the entry's name, opening it; when, who or what made it, whether it
/// was undone or the entry changed since; the words it changed, shown on request; its entry's version history; and
/// Undo or Redo.
struct ChangeRow: View {
    @Environment(AppModel.self) private var model
    let change: Change
    let current: Card?
    let revert: (Change, Bool) -> Void
    @State private var open = false

    var body: some View {
        let card = model.card(change.cardId)
        let now = current ?? card
        let undone = change.undoneAt != nil
        let undoable = change.n < 0 ? (now.map { Changes.canUndo(change, $0) && model.canEdit($0) } ?? false) : !undone && Changes.canUndo(change, now)
        let redoable = change.n >= 0 && undone && Changes.canRedo(change, now)
        let passed = !change.sealed && now != nil && !(undone ? Changes.canRedo(change, now) : Changes.canUndo(change, now))
        let compared = !change.sealed && (change.before == nil || change.fields.contains { ["title", "content", "pages", "back", "tags"].contains($0) })
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: change.sealed ? "lock" : (card ?? change.after).type == .tag ? "tag" : (card ?? change.after).type == .todo ? "checkmark.square" : "doc.text")
                .foregroundStyle(Theme.muted).frame(width: 20).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(Changes.describe(change)).foregroundStyle(Theme.muted)
                    if let card, !card.deleted, !change.sealed {
                        Button { model.openEntry = card.id } label: { Text(card.displayTitle).fontWeight(.semibold).foregroundStyle(Theme.text).lineLimit(1) }.buttonStyle(.plain)
                    } else {
                        Text(change.sealed ? "Locked entry" : (card ?? change.after).displayTitle).fontWeight(.semibold).lineLimit(1)
                    }
                }
                FlowLayout(spacing: 8) {
                    Text(Date(ms: change.until).formatted(date: .omitted, time: .shortened))
                    if let by = change.by {
                        Text(by).padding(.horizontal, 7).padding(.vertical, 1).background(Capsule().fill(Theme.sunken))
                    }
                    if undone { Text("Undone") }
                    if passed { Text("Changed since").help("This entry was changed again later. \(undone ? "Redo" : "Undo") needs it the way this change left it.") }
                    if compared {
                        Button(open ? "Hide changes" : "Show changes") { open.toggle() }.buttonStyle(.plain).underline()
                    }
                    if change.by != nil, let card, !change.sealed {
                        Button("Version history") { model.panel = .history(card.id) }.buttonStyle(.plain).underline().help("Every version of this entry, with restore")
                    }
                }
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                if open && compared { ChangeComparison(change: change) }
            }
            Spacer(minLength: 8)
            if undoable {
                Button("Undo") {
                    if change.n < 0 {
                        model.perform { _ = try await $0.takeBack(change) }
                        model.say("Undone", undoable: true)
                    } else {
                        revert(change, true)
                    }
                }
                .buttonStyle(.bordered)
            }
            if redoable { Button("Redo") { revert(change, false) }.buttonStyle(.bordered) }
        }
        .opacity(undone ? 0.6 : 1)
        .padding(.vertical, 10)
    }
}

/// What a change did to the words, as the web's comparison: the lines it took out and put in, with a line of what's
/// around each.
struct ChangeComparison: View {
    @Environment(AppModel.self) private var model
    let change: Change

    var body: some View {
        let lines = Self.diff(Self.text(change.before), Self.text(change.after))
        VStack(alignment: .leading, spacing: 1) {
            if !lines.contains(where: { $0.kind != .same }) {
                Text("Only the formatting changed.").foregroundStyle(Theme.muted)
            }
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                switch line.kind {
                case .gap: Text("…").foregroundStyle(Theme.muted)
                case .same: Text(line.text).foregroundStyle(Theme.muted)
                case .added: Text(line.text).padding(.horizontal, 4).frame(maxWidth: .infinity, alignment: .leading).background(Theme.added)
                case .removed: Text(line.text).strikethrough().padding(.horizontal, 4).frame(maxWidth: .infinity, alignment: .leading).background(Theme.removed)
                }
            }
        }
        .font(.callout)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
    }

    struct Line { enum Kind { case same, added, removed, gap }; let kind: Kind; let text: String }

    @MainActor
    static func text(_ card: Card?) -> [String] {
        guard let card else { return [] }
        var out = card.title.isEmpty ? [] : [card.title]
        for page in [card.content] + card.morePages { out += Doc.previewLines(page, hidden: .mask) }
        return out
    }

    /// The lines that differ, by the longest run they share, with one line of context around each change.
    static func diff(_ a: [String], _ b: [String]) -> [Line] {
        let n = a.count, m = b.count
        var lcs = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in stride(from: n - 1, through: 0, by: -1) { for j in stride(from: m - 1, through: 0, by: -1) { lcs[i][j] = a[i] == b[j] ? lcs[i + 1][j + 1] + 1 : max(lcs[i + 1][j], lcs[i][j + 1]) } }
        var all: [Line] = []
        var i = 0, j = 0
        while i < n || j < m {
            if i < n, j < m, a[i] == b[j] { all.append(Line(kind: .same, text: a[i])); i += 1; j += 1 }
            else if j < m, i == n || lcs[i][j + 1] >= lcs[i + 1][j] { all.append(Line(kind: .added, text: b[j])); j += 1 }
            else { all.append(Line(kind: .removed, text: a[i])); i += 1 }
        }
        var out: [Line] = []
        for (k, line) in all.enumerated() {
            let near = (max(0, k - 1)...min(all.count - 1, k + 1)).contains { all[$0].kind != .same }
            if line.kind != .same || near { out.append(line) } else if out.last?.kind != .gap && !out.isEmpty { out.append(Line(kind: .gap, text: "")) }
        }
        if out.last?.kind == .gap { out.removeLast() }
        return out
    }
}
