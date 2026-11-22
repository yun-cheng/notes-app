import NotesKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The box at the foot of the journal, as the web app's `JournalBox`: `[]` makes a todo, `#tag` files it, `#diary`
/// sends it to the Diary vault, and `@fri @3pm @weekly` give a todo its date, time and repeat. Return saves on a
/// computer, Shift-Return starts a new line; on a phone Return is a new line and the arrow saves. What's typed but not
/// saved is kept as a draft, one for each view of the journal.
struct JournalBox: View {
    @Environment(AppModel.self) private var model
    let filter: StreamFilter
    @State private var text = ""
    @State private var todos = false
    @State private var unlock: Vault?
    /// Photos and files added to the box, saved with what's typed.
    @State private var attached: [JSONValue] = []
    @State private var picking: [PhotosPickerItem] = []
    @State private var importing = false
    @FocusState private var focused: Bool

    /// The web's name for this view's draft, so the box's draft follows the account to its other devices.
    private var draftKey: String { filter.with { $0.sort = .written }.journalPath }

    /// A draft bound for an encrypted vault stays on this device, in memory only.
    private var encrypted: Bool { model.vault(targetVault)?.isEncrypted == true }

    var body: some View {
        VStack(spacing: 6) {
            if let unlock {
                UnlockView(vault: unlock).frame(maxHeight: 260)
            }
            if !attached.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(attached.enumerated()), id: \.offset) { i, node in
                            AttachedThumb(node: node, vaultId: targetVault) { attached.remove(at: i) }
                        }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button { todos.toggle() } label: {
                    Image(systemName: todos ? "checkmark.circle.fill" : "checkmark.circle")
                        .font(.title3)
                        .foregroundStyle(todos ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)
                .help(todos ? "Every line is a todo" : "Write todos")
                .accessibilityLabel("Todos")
                TextField(placeholder, text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...8)
                    .focused($focused)
                    #if os(macOS)
                    // A picture or file pasted in is added to the box, as on the web; text pastes where the cursor is.
                    .onPasteCommand(of: [.image, .fileURL]) { providers in paste(providers) }
                    .onKeyPress(.return, phases: .down) { press in
                        if press.modifiers.contains(.shift) || press.modifiers.contains(.option) {
                            text += "\n"
                            return .handled
                        }
                        send()
                        return .handled
                    }
                    #endif
                    .padding(.vertical, 6)
                PhotosPicker(selection: $picking, matching: .any(of: [.images, .videos])) {
                    Image(systemName: "photo").foregroundStyle(Theme.muted)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 8)
                .accessibilityLabel("Add photos")
                Button { importing = true } label: { Image(systemName: "paperclip").foregroundStyle(Theme.muted) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Attach a file")
                    .padding(.bottom, 8)
                VoiceRecordButton(vaultId: targetVault) { node in attached.append(node) }
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.semibold))
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Theme.sunken : Theme.accent))
                        .foregroundStyle(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Theme.muted : Theme.onAccent)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityLabel("Save")
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 22).fill(Theme.surface))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(focused ? Theme.accent : Theme.line))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .background(Theme.bg)
        .onAppear {
            text = Drafts.shared.get("journal", draftKey).map(Drafts.text) ?? ""
            todos = filter.effectiveType == .todo
        }
        .onChange(of: text) { _, t in
            Drafts.shared.set("journal", draftKey, Drafts.doc(t), onlyHere: encrypted)
        }
        .onChange(of: Drafts.shared.arrived["journal:\(draftKey)"]) {
            // From another device: taken in while the box here is empty.
            if text.isEmpty, let doc = Drafts.shared.get("journal", draftKey) { text = Drafts.text(doc) }
        }
        .onChange(of: model.focusBox) { focused = true }
        .onChange(of: picking) { _, items in
            guard !items.isEmpty else { return }
            picking = []
            Task { for item in items { await addPicked(item) } }
        }
        // Files and pictures dropped on the box are added to it; a picture dragged from a web page comes by its address.
        .dropDestination(for: URL.self) { urls, _ in
            urls.forEach(addFile)
            return !urls.isEmpty
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            for url in urls { addFile(url) }
        }
        .onChange(of: model.lockedVaults) { _, locked in
            if let v = unlock, !locked.contains(v.id) {
                unlock = nil
                send()
            }
        }
    }

    private var placeholder: String {
        todos ? "Write a todo · @fri · #tag" : "Write a note · [] todo · #tag"
    }

    /// The vault what's added goes into: the journal's, or the account's own.
    private var targetVault: String { filter.vaultId ?? model.mainVault?.id ?? "" }

    #if os(macOS)
    private func paste(_ providers: [NSItemProvider]) {
        let board = NSPasteboard.general
        if let urls = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            urls.forEach(addFile)
            return
        }
        if let data = board.data(forType: .png) ?? board.data(forType: .tiff) {
            Task {
                do { attached.append(try await Attachments.shared.addPhoto(data, vaultId: targetVault, model: model)) } catch { model.say(error.localizedDescription) }
            }
            return
        }
    }
    #endif

    private func addPicked(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let video = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
        do {
            if video {
                let type = item.supportedContentTypes.first { $0.conforms(to: .movie) }
                let mime = type?.preferredMIMEType ?? "video/quicktime"
                attached.append(try await Attachments.shared.addVideo(data, name: "Video.\(type?.preferredFilenameExtension ?? "mov")", mime: mime, vaultId: targetVault, model: model))
            } else {
                attached.append(try await Attachments.shared.addPhoto(data, vaultId: targetVault, model: model))
            }
        } catch {
            model.say(error.localizedDescription)
        }
    }

    private func addFile(_ url: URL) {
        // A picture's address from a web page: fetched by the server, since most sites don't let others fetch it.
        if url.scheme?.hasPrefix("http") == true {
            Task {
                do { attached.append(try await Attachments.shared.addPhoto(try await model.api.fetchPicture(url.absoluteString), vaultId: targetVault, model: model)) } catch { model.say(error.localizedDescription) }
            }
            return
        }
        let type = UTType(filenameExtension: url.pathExtension)
        let vault = targetVault
        Task {
            // Read off the main thread: a video can be a gigabyte.
            let data = await Task.detached { () -> Data? in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                return try? Data(contentsOf: url)
            }.value
            guard let data else {
                model.say("That file can't be read. Save it to a folder first, then add it from there.")
                return
            }
            do {
                if let type, type.conforms(to: .movie) {
                    attached.append(try await Attachments.shared.addVideo(data, name: url.lastPathComponent, mime: type.preferredMIMEType ?? "video/mp4", vaultId: vault, model: model))
                } else if let type, type.conforms(to: .image), !type.conforms(to: .svg) {
                    attached.append(try await Attachments.shared.addPhoto(data, vaultId: vault, model: model))
                } else {
                    attached.append(try await Attachments.shared.addFile(data, name: url.lastPathComponent, mime: type?.preferredMIMEType ?? "application/octet-stream", vaultId: vault, model: model))
                }
            } catch {
                model.say(error.localizedDescription)
            }
        }
    }

    private func send() {
        let typed = text
        let added = Transcriber.shared.fill(attached)
        guard !typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !added.isEmpty else { return }
        let words = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        // Photos and files go with the last entry written, as in the web's box, where they sit after the words; alone
        // they're a note of their own, or a todo named Photo.
        var entries = EntryParser.parseEntries(words.isEmpty && todos && !added.isEmpty ? "Photo" : typed, today: model.today, allTodos: todos)
        if !added.isEmpty {
            if let last = entries.indices.last {
                let words = (entries[last].content["content"]?.arrayValue ?? []).filter { !($0["type"] == "paragraph" && $0["content"] == nil) }
                entries[last].content = ["type": "doc", "content": .array(words + added)]
            } else {
                entries = EntryParser.entries(from: ["type": "doc", "content": .array(added)], today: model.today)
            }
        }
        let opts = SaveOptions(journal: filter, today: model.today)
        Task {
            switch await model.save(entries, opts) {
            case .saved(let ids, _):
                if text == typed { text = "" }
                let sent = Set(added.compactMap { $0["attrs"]?["id"]?.stringValue })
                attached.removeAll { sent.contains($0["attrs"]?["id"]?.stringValue ?? "") }
                // Once the stream has it, so there's somewhere to scroll to.
                await model.caughtUp()
                model.lastSaved = ids.last
            case .unlock(let vaultId):
                unlock = model.vault(vaultId)
            case .nothing:
                break
            }
        }
    }
}

/// What can be done to entries picked together, as the web app's `BatchBar`: tag them, finish them, date them,
/// archive or trash them.
struct BatchBar: View {
    @Environment(AppModel.self) private var model
    @Binding var picked: Set<String>
    let all: [String]

    var body: some View {
        let cards = picked.compactMap { model.card($0) }
        HStack(spacing: 12) {
            Text("\(picked.count) picked").fontWeight(.semibold)
            Button("All") { picked = Set(all) }
            Spacer()
            Menu("Tag") {
                ForEach(tagsForAll(model.index.tags, vaultIds: Array(Set(cards.map(\.vaultId))), model.sharedInto)) { tag in
                    Button(tag.displayTitle) { tagAll(tag.id) }
                }
            }
            if cards.contains(where: { $0.type == .todo && !$0.isDone }) {
                Button("Done") {
                    let group = model.repo.action()
                    let today = model.today
                    let ids = cards.filter { $0.type == .todo && !$0.isDone }.map(\.id)
                    model.perform { repo in for id in ids { try await repo.setDone(id, true, today: today, group: group) } }
                    model.say("Done", undoable: true)
                }
            }
            Button("Stack") { stack(cards) }.disabled(cards.count < 2)
            Button("Copy") {
                Clipboard.copy(Markdown.entries(cards.sorted { $0.createdAt < $1.createdAt }, index: model.index))
                model.say("Copied \(cards.count)")
            }
            Button("Archive") {
                model.archive(Array(picked), true)
                picked = []
            }
            Button("Trash", role: .destructive) {
                model.trash(Array(picked))
                picked = []
            }
            Button { picked = [] } label: { Image(systemName: "xmark") }.accessibilityLabel("Stop picking")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.surface)
        .overlay(alignment: .top) { Theme.line.frame(height: 1) }
    }

    private func tagAll(_ tagId: String) {
        let group = model.repo.action()
        let groups = model.index.tagGroups
        let ids = Array(picked)
        model.perform { repo in for id in ids { try await repo.update(id, group: group) { $0.tags = groups.with($0.tags, tagId) } } }
        model.say("Tagged \(ids.count)", undoable: true)
    }

    /// A new stack of the picked entries, or, with a stack among them, into that one.
    private func stack(_ cards: [Card]) {
        let ordered = cards.sorted { $0.createdAt < $1.createdAt }
        let stacks = model.index.live.filter(\.isStack)
        let into = ordered.first(where: \.isStack)
        let ids = ordered.map(\.id)
        let vault = ordered.first?.vaultId
        let group = model.repo.action()
        model.perform { repo in
            let target: Card
            if let into { target = into } else { target = try await repo.createNote(stack: [], vaultId: vault, group: group) }
            for (stackId, list) in stackPlan(ids, into: target, stacks: stacks + [target]) {
                try await repo.update(stackId, group: group) { $0.stack = list }
            }
        }
        picked = []
        model.say("Stacked \(ids.count)", undoable: true)
    }
}

/// A photo or file added to the box, before it's saved, with an × to take it out.
struct AttachedThumb: View {
    let node: JSONValue
    let vaultId: String
    let remove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if node["type"] == "photo", let id = node["attrs"]?["id"]?.stringValue {
                PhotoThumb(media: .photo(id), vaultId: vaultId, size: 56)
            } else {
                VStack(spacing: 2) {
                    Image(systemName: (node["attrs"]?["mime"]?.stringValue ?? "").hasPrefix("audio/") ? "waveform" : "doc")
                    Text(node["attrs"]?["name"]?.stringValue ?? "File").font(.caption2).lineLimit(1)
                }
                .frame(width: 76, height: 56)
                .background(RoundedRectangle(cornerRadius: 6).fill(Theme.sunken))
            }
            Button(action: remove) { Image(systemName: "xmark.circle.fill").foregroundStyle(.white, .black.opacity(0.6)) }
                .buttonStyle(.plain).padding(2)
                .accessibilityLabel("Take it out")
        }
    }
}
