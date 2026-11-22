import NotesKit
import SwiftUI

/// The journal as a board, as the web app's `board.tsx`: by todo state (Open, Waiting, Done), where dragging a todo
/// ticks it, reopens it or marks it waiting, or with a tag group's tags as columns, where cards are dragged between
/// columns to change their tag and up or down to set their order, or added straight into a column.
struct BoardView: View {
    @Environment(AppModel.self) private var model
    let filter: StreamFilter
    let board: String

    var body: some View {
        let items = Stream.items(model.index, filter.with { $0.board = nil }, today: model.today, sharedInto: model.sharedInto)
        let group = model.index.tagGroups.groups.first { $0.id == board }
        let columns = board == Board.state ? Board.stateColumns(items) : group.map { Board.columns(items, group: $0) } ?? []
        if columns.isEmpty {
            ContentUnavailableView("No board", systemImage: "rectangle.split.3x1", description: Text("The tag group for this board is gone."))
        } else {
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(columns) { column in
                        BoardColumnView(column: column, group: group, filter: filter)
                    }
                }
                .padding(16)
            }
            .pageBackground()
        }
    }
}

struct BoardColumnView: View {
    @Environment(AppModel.self) private var model
    let column: BoardColumn
    let group: TagGroup?
    let filter: StreamFilter
    @State private var adding = ""
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(column.title).font(.headline)
                Text("\(column.items.count)").foregroundStyle(Theme.muted)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(column.items.enumerated()), id: \.element.id) { i, item in
                        VStack(alignment: .leading, spacing: 4) {
                            BubbleView(card: item.card)
                            EntryAttachments(card: item.card)
                        }
                            .draggable(item.card.id)
                            .dropDestination(for: String.self) { ids, _ in
                                guard let id = ids.first else { return false }
                                drop(id, at: i)
                                return true
                            }
                    }
                    Color.clear.frame(height: 40)
                        .dropDestination(for: String.self) { ids, _ in
                            guard let id = ids.first else { return false }
                            drop(id, at: column.items.count)
                            return true
                        }
                }
            }
            if !model.viewOnly {
                TextField(column.key == "done" ? "Add a done todo" : "Add a card", text: $adding)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(add)
            }
        }
        .padding(10)
        .frame(width: 300)
        .background(RoundedRectangle(cornerRadius: 12).fill(targeted ? Theme.accentSoft : Theme.sunken.opacity(0.5)))
        .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first else { return false }
            drop(id, at: column.items.count)
            return true
        } isTargeted: { targeted = $0 }
    }

    /// A card dropped at `index` in this column: its place saved, and moved here from another column, its tag or
    /// state changed.
    private func drop(_ id: String, at index: Int) {
        guard let card = model.card(id), model.canEdit(card) else { return }
        let others = column.items.map(\.card).filter { $0.id != id }
        let places = Board.place(card, at: index, among: others)
        let today = model.today
        let groups = model.index.tagGroups.groups
        let group = group
        let to = column.key
        let action = model.repo.action()
        model.perform { repo in
            let at = Repository.milliseconds()
            let updated = try await repo.update(id, group: action) { c in
                var moved: String?
                if let group {
                    let from = Board.columnOf(c, group: group)
                    moved = Board.groupMove(&c, group: group, from: from, to: to, today: today, at: at).1
                } else if let state = Board.TodoState(rawValue: to) {
                    moved = Board.stateMove(&c, to: state, today: today, at: at, groups: groups).1
                }
                // A repeating todo moved on to its next date stays where it was.
                if moved == nil, let p = places[c.id] { c.position = p }
            }
            for (other, p) in places where other != id { try await repo.update(other, group: action) { $0.position = p } }
            if let updated, updated.repeat != nil, updated.due != card.due, let next = updated.due { await MainActor.run { self.model.say("Next due \(DateKey.relativeDayInSentence(next, today: today))", undoable: true) } }
        }
    }

    /// A new card straight into this column: with its tag, or in its state.
    private func add() {
        let text = adding.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        var opts = SaveOptions(journal: filter, today: model.today)
        let state = Board.TodoState(rawValue: column.key)
        if group != nil, !column.key.isEmpty { opts.tags = [column.key] }
        if state == .waiting { opts.waiting = true }
        var entries = EntryParser.parseEntries(text, today: model.today, allTodos: state != nil)
        if state == .done { for i in entries.indices { entries[i].done = true } }
        adding = ""
        Task { _ = await model.save(entries, opts) }
    }
}
