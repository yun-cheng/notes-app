import NotesKit
import SwiftUI

struct CardDetail: View {
    @Environment(AppModel.self) private var model
    let id: String
    @Binding var route: Route?
    @State private var title = ""
    @State private var loaded = false

    var body: some View {
        if let card = model.card(id) {
            content(card)
                .onAppear {
                    if !loaded {
                        title = card.title
                        loaded = true
                    }
                }
        } else {
            ContentUnavailableView("This card isn't available", systemImage: "questionmark.square.dashed", description: Text("It may be in a locked vault, or no longer shared with you."))
        }
    }

    @ViewBuilder
    private func content(_ card: Card) -> some View {
        let editable = model.canEdit(card) && !card.deleted
        VStack(alignment: .leading, spacing: 12) {
            if let note = accessNote(card) {
                Label(note, systemImage: "person.2").font(.footnote).foregroundStyle(.secondary)
            }
            if card.deleted {
                Label("In the trash", systemImage: "trash").font(.footnote).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline) {
                if card.type == .todo { TodoCheck(card: card) }
                TextField(card.type == .tag ? "Tag name" : "Title", text: $title, axis: .vertical)
                    .font(.title.bold())
                    .textFieldStyle(.plain)
                    .disabled(!editable)
                    .onChange(of: title) { _, new in
                        let id = card.id
                        model.perform { try await $0.update(id) { $0.title = new } }
                    }
            }
            if card.type == .todo { DueEditor(card: card, editable: editable) }
            if !card.tags.isEmpty { TagChips(card: card, route: $route) }
            DocEditor(content: card.content, editable: editable, titleOf: model.title) { doc in
                let id = card.id
                model.perform { try await $0.update(id) { $0.content = doc } }
            }
            .frame(maxHeight: .infinity)
            .environment(\.openURL, OpenURLAction { url in
                if let target = DocText.cardId(from: url) {
                    route = .card(target)
                    return .handled
                }
                return url.scheme == DocText.nodeScheme ? .handled : .systemAction
            })
            Backlinks(card: card, route: $route)
        }
        .padding()
        .navigationTitle(card.displayTitle)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if model.vault(card.vaultId) != nil, model.canEdit(card) {
                    if card.deleted {
                        Button { setDeleted(card, false) } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
                    } else {
                        Button(role: .destructive) { setDeleted(card, true) } label: { Label("Move to trash", systemImage: "trash") }
                    }
                }
            }
        }
    }

    private func setDeleted(_ card: Card, _ deleted: Bool) {
        let id = card.id
        model.perform { try await $0.setDeleted(id, deleted) }
        if deleted { route = nil }
    }

    private func accessNote(_ card: Card) -> String? {
        if let vault = model.vault(card.vaultId) {
            guard let role = vault.role, role != .owner else { return nil }
            return "In \(vault.name), shared with you as \(role == .editor ? "an editor" : "a viewer")"
        }
        guard let share = model.shared.first(where: { $0.card_id == card.id }) else { return nil }
        let can = share.role == .edit ? "You can edit it" : share.role == .comment ? "You can view and comment" : "You can view it"
        return "Shared with you by \(share.shared_by). \(can)."
    }
}

struct TodoCheck: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        Button {
            let id = card.id
            let done = !card.isDone
            model.perform { try await $0.setDone(id, done) }
        } label: {
            Image(systemName: card.isDone ? "checkmark.circle.fill" : "circle").font(.title)
        }
        .buttonStyle(.plain)
        .disabled(!model.canEdit(card))
    }
}

struct DueEditor: View {
    @Environment(AppModel.self) private var model
    let card: Card
    let editable: Bool

    var body: some View {
        let id = card.id
        HStack {
            Toggle("Due date", isOn: Binding(
                get: { card.due != nil },
                set: { on in
                    let value = on ? DateKey.today() : nil
                    model.perform { try await $0.update(id) { $0.due = value } }
                }))
            .fixedSize()
            if let due = card.due {
                DatePicker("", selection: Binding(
                    get: { DateKey.date(due) ?? Date() },
                    set: { date in
                        let key = DateKey.of(date)
                        model.perform { try await $0.update(id) { $0.due = key } }
                    }), displayedComponents: .date)
                .labelsHidden()
            }
        }
        .disabled(!editable)
    }
}

struct TagChips: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @Binding var route: Route?

    var body: some View {
        HStack {
            ForEach(card.tags, id: \.self) { tagId in
                Button("#" + model.title(of: tagId, fallback: "tag")) { route = .card(tagId) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
    }
}

/// Cards that link to or are tagged with this one.
struct Backlinks: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @Binding var route: Route?

    var body: some View {
        let links = model.live.filter { $0.id != card.id && (Doc.linkedCardIds($0.content).contains(card.id) || $0.tags.contains(card.id)) }
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(card.type == .tag ? "Tagged" : "Linked from").font(.headline)
                ForEach(links.prefix(20)) { other in
                    Button(other.displayTitle) { route = other.type == .diary ? .diary(other.date) : .card(other.id) }
                        .buttonStyle(.borderless)
                }
            }
        }
    }
}

struct DiaryDetail: View {
    @Environment(AppModel.self) private var model
    @State var date: String

    var body: some View {
        if model.diaryLocked, let vault = model.diaryVault {
            ContentUnavailableView("\(vault.name) is locked", systemImage: "lock")
        } else {
            let entry = model.diary[date]
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button { date = DateKey.adding(-1, to: date) } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Previous day")
                    Text(DateKey.date(date)?.formatted(date: .complete, time: .omitted) ?? date).font(.title2.bold())
                    Button { date = DateKey.adding(1, to: date) } label: { Image(systemName: "chevron.right") }
                        .accessibilityLabel("Next day")
                    Spacer()
                    if date != DateKey.today() { Button("Today") { date = DateKey.today() } }
                }
                .buttonStyle(.borderless)
                // Fixed now, so a save while switching days lands on the day being left.
                let day = date
                let existing = entry?.id
                let vault = model.diaryVault?.id
                DocEditor(content: entry?.content ?? Doc.empty, editable: entry.map(model.canEdit) ?? true, titleOf: model.title) { doc in
                    model.perform { _ = try await $0.saveDiary(date: day, content: doc, existingId: existing, vaultId: existing == nil ? vault : nil) }
                }
                .id(date)
            }
            .padding()
            .navigationTitle("Diary")
        }
    }
}
