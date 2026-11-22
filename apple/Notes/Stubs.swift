import NotesKit
import SwiftUI

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
