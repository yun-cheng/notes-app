import NotesKit
import SwiftUI

enum Section: String, Hashable, CaseIterable, Identifiable {
    case today, notes, todos, diary, tags, trash
    var id: Self { self }

    var title: String {
        switch self {
        case .today: "Today"
        case .notes: "Notes"
        case .todos: "Todos"
        case .diary: "Diary"
        case .tags: "Tags"
        case .trash: "Trash"
        }
    }

    var icon: String {
        switch self {
        case .today: "sun.max"
        case .notes: "note.text"
        case .todos: "checklist"
        case .diary: "book.closed"
        case .tags: "tag"
        case .trash: "trash"
        }
    }
}

/// What the detail column shows.
enum Route: Hashable {
    case card(String)
    case diary(String)
}

extension AppModel {
    /// The Mac's File > New Note asks the main view to make one.
    func requestNewNote() { newNoteRequests += 1 }
}

struct MainView: View {
    @Environment(AppModel.self) private var model
    @State private var section: Section? = .today
    @State private var route: Route?
    @State private var showAccount = false

    var body: some View {
        NavigationSplitView {
            List(selection: $section) {
                ForEach(Section.allCases) { s in
                    Label(s.title, systemImage: s.icon).tag(s)
                }
            }
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem {
                    Button { showAccount = true } label: { Label("Account", systemImage: "person.crop.circle") }
                }
            }
            .safeAreaInset(edge: .bottom) { SyncStatusView().padding(8) }
        } content: {
            Group {
                switch section ?? .today {
                case .today: TodayList(route: $route)
                case .notes: NotesList(route: $route)
                case .todos: TodosList(route: $route)
                case .diary: DiaryList(route: $route)
                case .tags: TagsList(route: $route)
                case .trash: TrashList(route: $route)
                }
            }
            .navigationTitle((section ?? .today).title)
        } detail: {
            NavigationStack {
                switch route {
                case .card(let id): CardDetail(id: id, route: $route).id(id)
                case .diary(let date): DiaryDetail(date: date).id(date)
                case nil: ContentUnavailableView("Nothing selected", systemImage: "note.text", description: Text("Pick a card, or make a new one."))
                }
            }
        }
        .sheet(isPresented: $showAccount) { AccountView() }
        .onChange(of: model.newNoteRequests) { newNote() }
    }

    private func newNote() {
        section = .notes
        Task {
            if let card = try? await model.repo.createNote() {
                await model.refresh()
                route = .card(card.id)
            }
        }
    }
}

struct SyncStatusView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let sync = model.sync {
            Button {
                Task { await sync.sync() }
            } label: {
                Label(sync.summary, systemImage: sync.state == .idle ? "checkmark.icloud" : sync.state == .syncing ? "arrow.triangle.2.circlepath.icloud" : "exclamationmark.icloud")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
    }
}

struct AccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let account = model.account {
                    LabeledContent("Name", value: account.name)
                    LabeledContent("Email", value: account.email)
                }
                if let sync = model.sync { LabeledContent("Sync", value: sync.summary) }
                SwiftUI.Section("Vaults") {
                    ForEach(model.vaults) { vault in
                        LabeledContent(vault.name) {
                            Text(vault.isPrivate ? (model.lockedVaults.contains(vault.id) ? "Private, locked" : "Private, open") : vault.isOwner ? "Yours" : "Shared with you")
                        }
                    }
                }
                Button("Sign out", role: .destructive) {
                    model.signOut()
                    dismiss()
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Account")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .frame(minWidth: 360, minHeight: 360)
    }
}
