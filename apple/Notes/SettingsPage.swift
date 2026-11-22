import NotesKit
import SwiftUI
import UniformTypeIdentifiers

/// Backup & settings, as the web app's: the account, backups and Markdown export, importing, reminders, how the
/// journal shows, copy and paste, photos and Google Drive, AI apps, and deleting the account.
struct SettingsPage: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @AppStorage("linkStyle") private var linkStyle = LinkStyle.card.rawValue
    @AppStorage("photoStyle") private var photoStyle = "large"
    @AppStorage("copyStyle") private var copyStyle = "markdown"
    @State private var exporting: ExportFile?
    @State private var restoring = false
    @State private var importing = false
    @State private var drive: DriveStatus?
    @State private var apps: [ConnectedApp]?
    @State private var offline = false
    @State private var deleting = false

    var body: some View {
        Form {
            Section("Account") {
                if let account = model.account {
                    LabeledContent("Signed in as", value: "\(account.name) (\(account.email))")
                }
                if let sync = model.sync {
                    LabeledContent("Sync", value: sync.summary + (sync.lastSyncedAt.map { ", last at " + $0.formatted(date: .omitted, time: .shortened) } ?? ""))
                    Button("Sync now") { Task { await sync.sync() } }.disabled(sync.state == .syncing)
                }
                Button("Sign out", action: model.signOut)
            }
            Section {
                Button("Save a backup") { exportBackup() }
                Button("Restore from a backup") { restoring = true }
                Button("Export as Markdown") { exportMarkdown() }
            } header: {
                Text("Backup")
            } footer: {
                Text("Your notes sync to your account. A backup is an extra copy you control. Unlock a private vault first to include it.")
            }
            Section {
                Button("Import Markdown") { importing = true }
            } header: {
                Text("Import")
            } footer: {
                Text("Bring in notes from Markdown or text files, like a folder from Obsidian or Bear, or this app's Markdown export. Each file becomes an entry, titled by its front matter, its first heading or its name.")
            }
            RemindersSettings()
            Section("Journal display") {
                Picker("Link previews", selection: $linkStyle) {
                    Text("Card").tag("card")
                    Text("One line").tag("compact")
                    Text("Off").tag("off")
                }
                Picker("Photos", selection: $photoStyle) {
                    Text("Large").tag("large")
                    Text("Thumbnails").tag("thumbs")
                    Text("Count").tag("off")
                }
            }
            Section {
                Picker("Copying an entry", selection: $copyStyle) {
                    Text("Markdown").tag("markdown")
                    Text("Plain text").tag("plain")
                }
            } header: {
                Text("Copy & paste")
            } footer: {
                Text("Markdown copies an entry the way the journal box reads it back, todos as [ ] lines with their dates and tags. Plain text copies just its words.")
            }
            Section {
                if offline { Text("Connect to the internet to see whether Google Drive is connected.").foregroundStyle(Theme.muted) }
                if let drive {
                    if !drive.configured {
                        Text("Photo and file storage isn't set up on the server yet, so they stay on the device that added them for now.").foregroundStyle(Theme.muted)
                    } else if drive.connected {
                        LabeledContent("Google Drive", value: "Connected" + (drive.email.map { " to \($0)" } ?? ""))
                        Button("Disconnect Google Drive") { Task { try? await model.api.disconnectDrive(); await load() } }
                    } else {
                        Button("Connect Google Drive") { Task { if let url = try? await model.api.driveConnectURL() { openURL(url) } } }
                    }
                }
                let waiting = Attachments.shared.pending.count
                if waiting > 0 { Text("\(waiting) \(waiting == 1 ? "photo or file is" : "photos and files are") waiting to upload.").foregroundStyle(Theme.muted) }
            } header: {
                Text("Photos and files")
            } footer: {
                Text("Photos and attached files (up to 25 MB each) are saved on this device first, then uploaded to a folder called “Notes app photos” in the Google Drive of the vault's owner.")
            }
            Section {
                LabeledContent("Connector address") {
                    Text(model.api.mcpURL.absoluteString).textSelection(.enabled)
                }
                Button("Copy address") { Clipboard.copy(model.api.mcpURL.absoluteString); model.say("Copied") }
                let open = model.vaults.filter { $0.lock == .none && $0.ai_access != .off }
                Text(open.isEmpty ? "No vault is open to AI yet. Turn it on for a vault under Vaults." : "Open to AI: " + open.map { "\($0.name) (\($0.ai_access == .write ? "read and write" : "read"))" }.joined(separator: ", ") + ".")
                    .foregroundStyle(Theme.muted)
                ForEach(apps ?? []) { app in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(app.name)
                            Text(app.last_used_at.map { "Last used " + Date(ms: $0).formatted(date: .abbreviated, time: .shortened) } ?? "Not used yet")
                                .font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Button("Disconnect") { Task { try? await model.api.disconnectAiApp(app.id); await load() } }
                    }
                }
                if apps?.isEmpty == true { Text("No AI app is connected.").foregroundStyle(Theme.muted) }
            } header: {
                Text("AI apps")
            } footer: {
                Text("Claude and other AI apps can read and edit vaults you open to them. In the app, add a custom connector with this address.")
            }
            Section("Delete account") {
                Button("Delete account…", role: .destructive) { deleting = true }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Backup & settings")
        .task { await load() }
        .fileExporter(isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }), document: exporting, contentType: exporting?.type ?? .json, defaultFilename: exporting?.name) { _ in
            exporting = nil
        }
        .fileImporter(isPresented: $restoring, allowedContentTypes: [.json]) { result in
            guard case .success(let url) = result else { return }
            restore(url)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText, UTType(filenameExtension: "md") ?? .plainText, .zip], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            importMarkdown(urls)
        }
        .sheet(isPresented: $deleting) { DeleteAccountSheet(onExport: exportMarkdown) }
    }

    private func load() async {
        do {
            drive = try await model.api.driveStatus()
            apps = try await model.api.aiApps()
            offline = false
        } catch {
            offline = true
        }
    }

    private var stamp: String { DateKey.today() }

    private func exportBackup() {
        let locked = model.lockedVaults
        guard let data = try? Backup.make(vaults: model.vaults.filter { !locked.contains($0.id) }, cards: model.cards.filter { !locked.contains($0.vaultId) && !$0.sealed }) else { return }
        exporting = ExportFile(data: data, type: .json, name: "notes-backup-\(stamp).json")
    }

    private func exportMarkdown() {
        exporting = ExportFile(data: Backup.zip(Backup.markdownFiles(model.index)), type: .zip, name: "notes-markdown-\(stamp).zip")
    }

    private func restore(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let cards = try Backup.parse(try Data(contentsOf: url))
            Task {
                let r = try await model.repo.importBackup(cards)
                model.say("Restored: \(r.added) added, \(r.updated) updated, \(r.skipped) already newer")
            }
        } catch {
            model.say(error.localizedDescription)
        }
    }

    private func importMarkdown(_ urls: [URL]) {
        var files: [(name: String, text: String)] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if url.pathExtension.lowercased() == "zip" {
                // An export from this app, Obsidian or Bear: its Markdown and text files.
                if let data = try? Data(contentsOf: url) { files += MarkdownImport.filesFromZip(data) }
            } else if let text = try? String(contentsOf: url, encoding: .utf8) {
                files.append((url.lastPathComponent, text))
            }
        }
        let entries = MarkdownImport.entries(files, today: model.today)
        Task {
            if case .saved(let ids, _) = await model.save(entries, SaveOptions()) { model.say("Imported \(ids.count) \(ids.count == 1 ? "file" : "files")", undoable: true) }
        }
    }
}

/// A file to save, for the system's save panel.
struct ExportFile: FileDocument {
    static let readableContentTypes: [UTType] = [.json, .zip]
    var data: Data
    var type: UTType
    var name: String

    init(data: Data, type: UTType, name: String) {
        self.data = data
        self.type = type
        self.name = name
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
        type = .json
        name = "file"
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// Deleting this account, after it says what goes with it and the account's email is typed to confirm.
struct DeleteAccountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let onExport: () -> Void
    @State private var summary: AccountSummary?
    @State private var email = ""
    @State private var failed: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This deletes your account and everything in the vaults you own, on the server and on your devices. It can't be undone.")
                    if let summary {
                        ForEach(summary.vaults) { v in
                            Text("\(v.name): \(v.cards) \(v.cards == 1 ? "entry" : "entries")\(v.others > 0 ? ", shared with \(v.others) \(v.others == 1 ? "person" : "people") who'll lose it" : "")")
                        }
                        if summary.joined > 0 { Text("You'll also leave \(summary.joined) \(summary.joined == 1 ? "vault" : "vaults") of other people.") }
                    }
                    Button("Export as Markdown first") { onExport() }
                }
                Section("Type your email to confirm") {
                    TextField("Email", text: $email)
                    if let failed { Text(failed).foregroundStyle(Theme.alert) }
                    Button("Delete my account", role: .destructive) {
                        Task {
                            do {
                                try await model.api.deleteAccount(email: email)
                                dismiss()
                                model.signOut()
                            } catch {
                                failed = error.localizedDescription
                            }
                        }
                    }
                    .disabled(email.lowercased() != model.account?.email.lowercased())
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Delete account")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { summary = try? await model.api.accountSummary() }
        }
    }
}
