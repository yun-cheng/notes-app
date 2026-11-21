import NotesKit
import SwiftUI

/// Sharing an entry: people, vaults and public links.
struct SharePanel: View {
    let id: String
    var body: some View {
        ContentUnavailableView("Sharing", systemImage: "person.2", description: Text("Coming next to this app."))
            .navigationTitle("Share")
    }
}

/// An entry's versions from the server's history.
struct EntryHistory: View {
    let id: String
    var body: some View {
        ContentUnavailableView("History", systemImage: "clock", description: Text("Coming next to this app."))
            .navigationTitle("History")
    }
}

/// The journal as a board.
struct BoardView: View {
    let filter: StreamFilter
    let board: String
    var body: some View {
        ContentUnavailableView("Board", systemImage: "rectangle.split.3x1", description: Text("Coming next to this app."))
    }
}

struct SettingsPage: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Form {
            if let account = model.account {
                LabeledContent("Name", value: account.name)
                LabeledContent("Email", value: account.email)
            }
            if let sync = model.sync { LabeledContent("Sync", value: sync.summary) }
            Button("Sign out", role: .destructive, action: model.signOut)
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }
}
