import NotesKit
import SwiftUI

/// An entry's versions from the server's history, as the web app's history page: each with when it was saved and by
/// whom, shown when picked, and restored with one press. Needs a connection.
struct EntryHistory: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var versions: [VersionInfo] = []
    @State private var picked: VersionInfo.ID?
    @State private var shown: Card?
    @State private var failed = false

    var body: some View {
        HStack(spacing: 0) {
            List(versions, selection: $picked) { v in
                VStack(alignment: .leading, spacing: 2) {
                    Text(Date(timeIntervalSince1970: Double(v.saved_at) / 1000).formatted(date: .abbreviated, time: .shortened))
                    Text([v.author, v.via.map { "with \($0)" }].compactMap { $0 }.joined(separator: " ")).font(.caption).foregroundStyle(Theme.muted)
                }
                .tag(v.id)
            }
            .frame(minWidth: 200, maxWidth: 260)
            Divider()
            ScrollView {
                if let shown {
                    VStack(alignment: .leading, spacing: 8) {
                        if !shown.title.isEmpty { Text(shown.title).font(.title3.weight(.semibold)) }
                        ForEach(Array(Doc.previewLines(shown.content, titleOf: model.index.titleOf, full: true).enumerated()), id: \.offset) { Text($0.element) }
                        if let card = model.card(id), model.canEdit(card) {
                            Button("Restore this version") { restore(shown) }.buttonStyle(.borderedProminent).padding(.top, 8)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(failed ? "History needs a connection." : versions.isEmpty ? "No versions yet." : "Pick a version to see it.")
                        .foregroundStyle(Theme.muted).padding()
                }
            }
        }
        .navigationTitle("History")
        .task { await load() }
        .onChange(of: picked) { _, v in
            guard let v else { return }
            Task { await show(v) }
        }
    }

    private func load() async {
        do {
            versions = try await model.api.versions(id).sorted { $0.saved_at > $1.saved_at }
        } catch {
            failed = true
        }
    }

    private func show(_ versionId: Int64) async {
        guard let card = model.card(id), let v = try? await model.api.version(id, versionId),
            let payload = model.repo.openPayload(v.payload, id: id, vaultId: card.vaultId)
        else {
            shown = nil
            return
        }
        shown = Card(id: id, vaultId: card.vaultId, updatedAt: v.saved_at, deleted: false, seq: 0, payload: payload)
    }

    private func restore(_ version: Card) {
        let fields = version.restoreFields()
        let id = id
        let api = model.api
        model.perform { repo in
            // The newest version is closed first, so the restore shows up as its own entry.
            try? await api.sealVersions(id)
            try await repo.update(id) { card in
                for (key, value) in fields { card.payload[key] = value }
            }
        }
        model.say("Restored", undoable: true)
        dismiss()
    }
}
