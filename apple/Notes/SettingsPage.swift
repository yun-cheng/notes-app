import AuthenticationServices
import NotesKit
import SwiftUI
import UniformTypeIdentifiers

/// Backup & settings, as the web app's: the account, backups and Markdown export, importing, reminders, how the
/// journal shows, copy and paste, photos and Google Drive, AI apps, and deleting the account.
struct SettingsPage: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuth
    @AppStorage("linkStyle") private var linkStyle = LinkStyle.card.rawValue
    @AppStorage("photoStyle") private var photoStyle = "large"
    @AppStorage(RailYears.key) private var railYears = "entries"
    @AppStorage("copyStyle") private var copyStyle = "rich"
    @State private var exporting: ExportFile?
    @State private var restoring = false
    @State private var importing = false
    @State private var drive: DriveStatus?
    @State private var apps: [ConnectedApp]?
    @State private var defaultAiAccess: Vault.AIAccess?
    @State private var savingAiDefault = false
    @State private var aiVaultFilter = ""
    @State private var offline = false
    @State private var deleting = false

    /// Connects Google Drive in Apple's sign-in sheet, which closes on Google's answer, and says it as the web does.
    private func connectDrive() async {
        guard let url = try? await model.api.driveConnectURL(dev: AppBuild.isDev) else { return model.say("Couldn't start connecting. Check your connection and try again.") }
        do {
            let back = try await webAuth.authenticate(using: url, callback: .customScheme(AppBuild.scheme), additionalHeaderFields: [:])
            let result = URLComponents(url: back, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "result" }?.value
            model.say(Self.driveResult(result))
            await load()
            if result == "connected" { await model.sync?.sync() }
        } catch {
            // Closed the sheet: Drive isn't connected, and there's nothing to say.
        }
    }

    private func disconnectDrive() async {
        do {
            try await model.api.disconnectDrive()
            model.say("Google Drive disconnected. Photos already there stay in your Drive.")
        } catch {
            model.say("Couldn't disconnect. Check your connection and try again.")
        }
        await load()
    }

    static func driveResult(_ result: String?) -> String {
        switch result {
        case "connected": "Google Drive is connected. Waiting photos and files will upload now."
        case "denied": "Google Drive was not connected."
        case "expired": "That took too long. Try connecting Google Drive again."
        default: "Google Drive couldn't be connected. Try again."
        }
    }

    var body: some View {
        Form {
            Section("Account") {
                if let account = model.account {
                    let synced = model.sync.map { s in " " + s.summary + (s.lastSyncedAt.map { ", last synced at " + $0.formatted(date: .omitted, time: .shortened) } ?? "") + "." } ?? ""
                    Text("Signed in as \(account.name) (\(account.email)).\(synced)")
                    if account.email.lowercased().hasSuffix(".test") {
                        Text("This is the demo account on your local server, for trying the app. Running npm run demo puts its sample notes back as they were and keeps anything you added, but keep notes that matter in your own account: sign out, then sign in with Google.")
                            .font(.callout)
                            .padding(10)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.accentSoft))
                    }
                }
                HStack {
                    if let sync = model.sync { Button("Sync now") { Task { await sync.sync() } }.disabled(sync.state == .syncing) }
                    Button("Sign out", action: model.signOut)
                }
                .buttonStyle(.bordered)
            }
            Section {
                HStack {
                    Button("Download backup") { exportBackup() }.buttonStyle(.borderedProminent)
                    Button("Restore from backup") { restoring = true }.buttonStyle(.bordered)
                    Button("Export as Markdown") { exportMarkdown() }.buttonStyle(.bordered)
                }
            } header: {
                Text("Backup")
            } footer: {
                Text("Your notes sync to your account. A backup is an extra copy you control. Unlock a private vault first to include it.")
            }
            Section {
                Button("Import Markdown") { importing = true }.buttonStyle(.bordered)
            } header: {
                Text("Import")
            } footer: {
                Text("Bring in notes from Markdown or text files, or a zip of them, like a folder from Obsidian or Bear, or this app's Markdown export. Each file becomes an entry, titled by its front matter, its first heading or its name, with the front matter's tags, date and todo fields. Links between the files are kept.")
            }
            RemindersSettings()
            Section {
                Picker("Link previews", selection: $linkStyle) {
                    Text("Cards").tag("card")
                    Text("One line").tag("compact")
                    Text("Off").tag("off")
                }
                Picker("Photos", selection: $photoStyle) {
                    Text("Large").tag("large")
                    Text("Thumbnails").tag("thumbs")
                    Text("Off").tag("off")
                }
                Picker("Rail years", selection: $railYears) {
                    ForEach(RailYears.choices, id: \.0) { Text($0.1).tag($0.0) }
                }
            } header: {
                Text("Journal display")
            } footer: {
                Text("How web links and photos show under entries on this device. Links in the text can always be clicked. The rail beside a long page gives each year room for its entries, or, nearer years larger, more room to the years nearest the one you're reading, less the further off. It changes once the pointer leaves the rail, or the rail is let go.")
            }
            Section {
                Picker("Copy as", selection: $copyStyle) {
                    Text("Rich text").tag("rich")
                    Text("Markdown").tag("markdown")
                    Text("Plain text").tag("plain")
                }
            } header: {
                Text("Copy & paste")
            } footer: {
                Text((copyStyle == "markdown" ? "Copied text is Markdown, with **bold**, - lists and [links](…), and copied todos read [ ] Title @date #tag." : copyStyle == "plain" ? "Copied text is just the words: lists keep their markers, links show their addresses." : "Copied text keeps its bold, lists and links in apps like Mail, Notes and Docs, and is plain words where only text goes.") + " Entries pasted back into the journal come back whole either way.")
            }
            Section {
                if offline { Text("Connect to the internet to see whether Google Drive is connected.").foregroundStyle(Theme.muted) }
                if let drive {
                    if !drive.configured {
                        Text("Photo and file storage isn't set up on the server yet, so they stay on the device that added them for now.").foregroundStyle(Theme.muted)
                    } else if drive.connected {
                        LabeledContent("Google Drive", value: "Connected" + (drive.email.map { " to \($0)" } ?? ""))
                        Button("Disconnect Google Drive") { Task { await disconnectDrive() } }
                    } else {
                        Button("Connect Google Drive") { Task { await connectDrive() } }
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
                let ownedOpen = model.vaults.filter { $0.isOwner && !$0.isPrivate }
                let ownedConfigurable = model.vaults.filter { $0.isOwner && !$0.isEncrypted && (!$0.isPrivate || !model.lockedVaults.contains($0.id)) }
                let shownDefault = defaultAiAccess ?? ownedOpen.first(where: { $0.ai_access_override == nil })?.ai_access ?? .off
                Picker("Default for open vaults", selection: Binding(get: { shownDefault }, set: { next in Task { await changeAiDefault(next) } })) {
                    ForEach(Vault.AIAccess.allCases, id: \.self) { a in Text(a.label).tag(a) }
                }
                .disabled(offline || savingAiDefault || defaultAiAccess == nil)
                Text("Applies to every unlocked vault you own, including new ones, unless you choose otherwise below. Private vaults default to off; end-to-end encrypted vaults are always off.")
                    .font(.caption).foregroundStyle(Theme.muted)
                if ownedConfigurable.count > 6 {
                    TextField("Filter vaults…", text: $aiVaultFilter)
                }
                let q = aiVaultFilter.trimmingCharacters(in: .whitespaces).lowercased()
                let shownVaults = q.isEmpty ? ownedConfigurable : ownedConfigurable.filter { $0.name.lowercased().contains(q) }
                ForEach(shownVaults) { vault in
                    if vault.isPrivate {
                        Picker("\(vault.name) (Private)", selection: Binding(
                            get: { vault.ai_access },
                            set: { next in Task { await changeVaultAi(vault, next == .off ? .default : Vault.AIAccessSetting(rawValue: next.rawValue) ?? .default) } }
                        )) {
                            Text("Off (default)").tag(Vault.AIAccess.off)
                            Text("Read").tag(Vault.AIAccess.read)
                            Text("Read and write").tag(Vault.AIAccess.write)
                        }
                        .disabled(offline)
                    } else {
                        Picker(vault.name, selection: Binding(get: { vault.aiAccessSetting }, set: { next in Task { await changeVaultAi(vault, next) } })) {
                            Text("Default (\(shownDefault.label))").tag(Vault.AIAccessSetting.default)
                            Text("Off").tag(Vault.AIAccessSetting.off)
                            Text("Read").tag(Vault.AIAccessSetting.read)
                            Text("Read and write").tag(Vault.AIAccessSetting.write)
                        }
                        .disabled(offline)
                    }
                }
                if !q.isEmpty && shownVaults.isEmpty {
                    Text("No vault matches “\(aiVaultFilter)”.").foregroundStyle(Theme.muted)
                }
                let lockedPrivateCount = model.vaults.filter { $0.isOwner && $0.isPrivate && !$0.isEncrypted && model.lockedVaults.contains($0.id) && !$0.hidden }.count
                if lockedPrivateCount > 0 {
                    Text("\(lockedPrivateCount) \(lockedPrivateCount == 1 ? "locked private vault" : "locked private vaults") — unlock \(lockedPrivateCount == 1 ? "it" : "them") first to change AI access (off by default).")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                let encryptedCount = model.vaults.filter { $0.isEncrypted && !($0.hidden && model.lockedVaults.contains($0.id)) }.count
                if encryptedCount > 0 {
                    Text("\(encryptedCount) \(encryptedCount == 1 ? "encrypted vault is" : "encrypted vaults are") always off.")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
                let sharedOpen = model.vaults.filter { !$0.isOwner && !$0.isPrivate && !$0.isWithheld && $0.ai_access != .off }
                if !sharedOpen.isEmpty {
                    Text("Shared vaults open to AI (read only): " + sharedOpen.map(\.name).joined(separator: ", ") + ".")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
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
            Section {
                Button("Delete account…", role: .destructive) { deleting = true }
            } header: {
                Text("Delete account")
            } footer: {
                Text("Deletes this account and everything in it from the server, for good. Other accounts signed in on this device stay as they are.")
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
            let info = try await model.api.aiAppsInfo()
            apps = info.apps
            defaultAiAccess = info.default_access ?? .off
            offline = false
        } catch {
            offline = true
        }
    }

    private func changeAiDefault(_ next: Vault.AIAccess) async {
        savingAiDefault = true
        defer { savingAiDefault = false }
        do {
            let res = try await model.api.setAiDefaultAccess(next)
            defaultAiAccess = res.default_access
            try await model.repo.putVaults(res.vaults)
            await model.refresh()
            model.say("Default AI access updated")
        } catch {
            model.say((error as? APIError == .offline) ? "Connect to the internet to change AI access." : "That change couldn't be saved.")
        }
    }

    private func changeVaultAi(_ vault: Vault, _ next: Vault.AIAccessSetting) async {
        do {
            try await VaultEncryption(model: model).save(vault, VaultChanges(ai_access: next))
            model.say("AI access changed")
        } catch {
            model.say((error as? APIError == .offline) ? "Connect to the internet to change a vault." : "That change couldn't be saved.")
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
