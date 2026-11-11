import NotesKit
import SwiftUI

struct CardRow: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(card.displayTitle).font(.headline).lineLimit(1)
            let preview = Doc.plainText(card.content, titleOf: model.title)
            if !preview.isEmpty {
                Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Text(Date(timeIntervalSince1970: Double(card.updatedAt) / 1000), format: .relative(presentation: .named))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }
}

struct TodoRow: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        HStack(spacing: 10) {
            Button {
                let id = card.id
                let done = !card.isDone
                model.perform { try await $0.setDone(id, done) }
            } label: {
                Image(systemName: card.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(card.isDone ? Color.accentColor : .secondary)
            }
            .buttonStyle(.plain)
            .disabled(!model.canEdit(card))
            .accessibilityLabel(card.isDone ? "Mark as not done" : "Mark as done")
            VStack(alignment: .leading, spacing: 2) {
                Text(card.displayTitle).strikethrough(card.isDone).foregroundStyle(card.isDone ? .secondary : .primary)
                if let due = card.due { DueLabel(due: due, done: card.isDone) }
            }
        }
    }
}

struct DueLabel: View {
    let due: String
    var done = false

    var body: some View {
        let today = DateKey.today()
        let overdue = !done && due < today
        Text(due == today ? "Today" : due == DateKey.adding(1, to: today) ? "Tomorrow" : DateKey.date(due).map { $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) } ?? due)
            .font(.caption)
            .foregroundStyle(overdue ? .red : .secondary)
    }
}

/// Adds a todo from one line of text.
struct AddTodoField: View {
    @Environment(AppModel.self) private var model
    var due: String?
    @State private var text = ""

    var body: some View {
        TextField("Add a todo", text: $text)
            .onSubmit {
                let title = text.trimmingCharacters(in: .whitespaces)
                guard !title.isEmpty else { return }
                text = ""
                let due = due
                model.perform { _ = try await $0.createTodo(title: title, due: due) }
            }
    }
}

struct TodayList: View {
    @Environment(AppModel.self) private var model
    @Binding var route: Route?

    var body: some View {
        let today = DateKey.today()
        let due = model.todos.filter { !$0.isDone && ($0.due.map { $0 <= today } ?? false) }.sorted { ($0.due ?? "") < ($1.due ?? "") }
        List(selection: $route) {
            SwiftUI.Section("Diary") {
                if model.diaryLocked {
                    Label("Your diary is in a private vault. Unlock it in Diary.", systemImage: "lock").foregroundStyle(.secondary)
                } else {
                    let entry = model.diary[today]
                    VStack(alignment: .leading) {
                        Text(entry == nil ? "Write about today" : "Today's entry").font(.headline)
                        if let entry { Text(Doc.plainText(entry.content)).lineLimit(2).foregroundStyle(.secondary) }
                    }
                    .tag(Route.diary(today))
                }
            }
            SwiftUI.Section("Due") {
                AddTodoField(due: today)
                ForEach(due) { TodoRow(card: $0).tag(Route.card($0.id)) }
            }
            SwiftUI.Section("Recently edited") {
                ForEach(model.live.filter { $0.type == .note }.prefix(8)) { CardRow(card: $0).tag(Route.card($0.id)) }
            }
        }
    }
}

struct NotesList: View {
    @Environment(AppModel.self) private var model
    @Binding var route: Route?
    @State private var query = ""

    var body: some View {
        let notes = query.isEmpty ? model.notes : model.notes.filter { matches($0, query) }
        List(selection: $route) {
            ForEach(notes) { CardRow(card: $0).tag(Route.card($0.id)) }
        }
        .overlay {
            if notes.isEmpty {
                ContentUnavailableView(query.isEmpty ? "No notes yet" : "No matches", systemImage: "note.text")
            }
        }
        .searchable(text: $query, prompt: "Search")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        if let card = try? await model.repo.createNote() {
                            await model.refresh()
                            route = .card(card.id)
                        }
                    }
                } label: { Label("New note", systemImage: "square.and.pencil") }
            }
        }
    }

    private func matches(_ card: Card, _ query: String) -> Bool {
        card.title.localizedStandardContains(query) || Doc.plainText(card.content).localizedStandardContains(query)
    }
}

struct TodosList: View {
    @Environment(AppModel.self) private var model
    @Binding var route: Route?
    @State private var showDone = false

    var body: some View {
        let today = DateKey.today()
        let open = model.todos.filter { !$0.isDone }
        let groups: [(String, [Card])] = [
            ("Overdue", open.filter { ($0.due ?? "9") < today }),
            ("Today", open.filter { $0.due == today }),
            ("Upcoming", open.filter { ($0.due ?? "") > today }.sorted { $0.due! < $1.due! }),
            ("No date", open.filter { $0.due == nil }),
        ]
        List(selection: $route) {
            AddTodoField()
            ForEach(groups, id: \.0) { name, cards in
                if !cards.isEmpty {
                    SwiftUI.Section(name) { ForEach(cards) { TodoRow(card: $0).tag(Route.card($0.id)) } }
                }
            }
            let done = model.todos.filter(\.isDone)
            if !done.isEmpty {
                SwiftUI.Section(isExpanded: $showDone) {
                    ForEach(done) { TodoRow(card: $0).tag(Route.card($0.id)) }
                } header: {
                    Text("Done (\(done.count))")
                }
            }
        }
    }
}

struct DiaryList: View {
    @Environment(AppModel.self) private var model
    @Binding var route: Route?

    var body: some View {
        if model.diaryLocked, let vault = model.diaryVault {
            ContentUnavailableView("\(vault.name) is locked", systemImage: "lock")
        } else {
            let today = DateKey.today()
            let dates = Set(model.diary.keys).union([today]).sorted(by: >)
            List(selection: $route) {
                ForEach(dates, id: \.self) { date in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(DateKey.date(date)?.formatted(date: .complete, time: .omitted) ?? date).font(.headline)
                        let text = model.diary[date].map { Doc.plainText($0.content) } ?? ""
                        Text(text.isEmpty ? (date == today ? "Write about today" : "") : text).lineLimit(2).foregroundStyle(.secondary)
                    }
                    .tag(Route.diary(date))
                }
            }
        }
    }
}

struct TagsList: View {
    @Environment(AppModel.self) private var model
    @Binding var route: Route?

    var body: some View {
        List(selection: $route) {
            ForEach(model.tags) { tag in
                let count = model.live.filter { $0.tags.contains(tag.id) }.count
                Label("\(tag.displayTitle) (\(count))", systemImage: tag.pinned ? "pin" : "tag").tag(Route.card(tag.id))
            }
        }
        .overlay { if model.tags.isEmpty { ContentUnavailableView("No tags yet", systemImage: "tag") } }
    }
}

struct TrashList: View {
    @Environment(AppModel.self) private var model
    @Binding var route: Route?

    var body: some View {
        List(selection: $route) {
            ForEach(model.trash) { card in
                CardRow(card: card)
                    .tag(Route.card(card.id))
                    .swipeActions {
                        Button("Restore") {
                            let id = card.id
                            model.perform { try await $0.setDeleted(id, false) }
                        }
                        .tint(.accentColor)
                    }
                    .contextMenu {
                        Button("Restore") {
                            let id = card.id
                            model.perform { try await $0.setDeleted(id, false) }
                        }
                    }
            }
        }
        .overlay { if model.trash.isEmpty { ContentUnavailableView("Trash is empty", systemImage: "trash") } }
    }
}
