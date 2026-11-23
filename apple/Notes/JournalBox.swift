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
    @State private var pickingPhotos = false
    @State private var recordNow = 0
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
            if let query = slashQuery {
                SlashMenu(query: query) { pickSlash($0) }
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
                VoiceRecordButton(vaultId: targetVault, start: recordNow) { node in attached.append(node) }
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
        .photosPicker(isPresented: $pickingPhotos, selection: $picking, matching: .any(of: [.images, .videos]))
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
        if todos { return "Todo · @ for a due date, time or repeat" }
        if model.diaryVault.map({ $0.id == targetVault }) == true { return "Write in the diary" }
        return "Write a note · [] todo · #tag · / for more"
    }

    /// What's typed after a / that starts the last line, while the box's menu of things to add is open.
    private var slashQuery: String? {
        let last = text.split(separator: "\n", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        guard last.hasPrefix("/"), !last.contains(" ") else { return nil }
        return String(last.dropFirst())
    }

    /// Takes the /word off the last line, then starts that line as the item picked, or opens what it adds.
    private func pickSlash(_ item: SlashMenu.Item) {
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        lines[lines.count - 1] = item.marker ?? ""
        text = lines.joined(separator: "\n")
        switch item.id {
        case "photo": pickingPhotos = true
        case "file": importing = true
        case "voice": recordNow += 1
        default: break
        }
        focused = true
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

/// What can be done to entries picked together, as the web app's `BatchBar`: how many are picked, then icons to tag
/// them (a panel of their tags, each × to take it off all, and a field to add one to all), mark todos done or not,
/// waiting or dated (a panel of Today, Tomorrow, In a week and No date), make them todos or notes, move them to a vault,
/// stack, copy, archive or trash them, and × to stop.
struct BatchBar: View {
    @Environment(AppModel.self) private var model
    @Binding var picked: Set<String>
    let all: [String]
    enum Panel { case tags, due }
    @State private var panel: Panel?
    @State private var query = ""

    var body: some View {
        let cards = picked.compactMap { model.card($0) }.sorted { $0.createdAt < $1.createdAt }
        let editable = cards.filter { model.canEdit($0) }
        let manageable = cards.filter { model.canManage($0) }
        let todos = editable.filter { $0.type == .todo }
        let open = todos.filter { !$0.isDone }
        let waiting = !open.isEmpty && open.allSatisfy(\.waiting)
        let archiving = manageable.contains { !$0.archived }
        let targets = model.vaults.filter { !model.lockedVaults.contains($0.id) && !$0.isWithheld && $0.role != .viewer }
        let none = cards.isEmpty
        VStack(spacing: 0) {
            if panel == .tags, !none { tagsPanel(editable) }
            if panel == .due, !todos.isEmpty { duePanel(todos) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    Text(none ? "Pick entries" : "\(cards.count) selected").fontWeight(.semibold).padding(.trailing, 6).fixedSize()
                    tool("tag", "Tags", "Add or remove tags", active: panel == .tags) { panel = panel == .tags ? nil : .tags }.disabled(none)
                    if !todos.isEmpty {
                        Button("Done") { setStatus(todos, done: true) }.buttonStyle(.bordered)
                        Button("Not done") { setStatus(todos, done: false) }.buttonStyle(.borderless)
                        if !open.isEmpty {
                            tool("hourglass", "Waiting", waiting ? "No longer waiting" : "Waiting on someone or something", active: waiting) {
                                let on = !waiting
                                model.performEach(open.map(\.id), say: on ? "Marked \(open.count) waiting" : "\(open.count) no longer waiting") { repo, id, group in
                                    try await repo.update(id, group: group) { $0.waiting = on }
                                }
                            }
                        }
                        tool("calendar", "Due date", "Set a due date", active: panel == .due) { panel = panel == .due ? nil : .due }
                    }
                    if editable.contains(where: { $0.type == .note }) {
                        tool("checkmark.circle", "Make them todos", "Make the notes todos") { retype(editable.filter { $0.type == .note }, to: .todo) }
                    }
                    if !todos.isEmpty {
                        tool("doc.text", "Make them notes", "Make the todos notes") { retype(todos, to: .note) }
                    }
                    if targets.count > 1, !manageable.isEmpty {
                        Menu("Move to…") {
                            ForEach(targets) { v in
                                Button(v.name) {
                                    let ids = manageable.map(\.id)
                                    model.performEach(ids, say: "Moved \(ids.count) to \(v.name)") { repo, id, group in try await repo.move(id, toVault: v.id, group: group) }
                                }
                            }
                        }
                        .fixedSize()
                    }
                    if editable.count > 1 {
                        tool("square.stack", "Stack", cards.contains(where: \.isStack) ? "Put them in the stack picked with them" : "Stack them: one entry holding them, in an order of their own") { stack(cards) }
                    }
                    tool("doc.on.doc", "Copy", "Copy") {
                        Clipboard.copyEntries(cards, model: model)
                        model.say("Copied \(cards.count)")
                    }
                    .disabled(none)
                    tool("archivebox", archiving ? "Archive" : "Unarchive", archiving ? "Archive: out of the journal, still in search" : "Unarchive: back to the journal") {
                        model.archive(manageable.map(\.id), archiving)
                        picked = []
                    }
                    .disabled(manageable.isEmpty)
                    tool("trash", "Move to Trash", "Move to Trash (Delete)") {
                        model.trash(manageable.map(\.id))
                        picked = []
                    }
                    .disabled(manageable.isEmpty)
                    Spacer(minLength: 8)
                    tool("xmark", "Stop selecting", "Stop selecting (Esc)") { picked = [] }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
        }
        .buttonStyle(.borderless)
        .background(Theme.surface)
        .overlay(alignment: .top) { Theme.line.frame(height: 1) }
        .onChange(of: picked.isEmpty) { _, empty in if empty { panel = nil } }
    }

    private func tool(_ icon: String, _ label: String, _ help: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 16)).frame(width: 34, height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(active ? Theme.accentSoft : .clear))
        }
        .foregroundStyle(active ? Theme.accent : Theme.text)
        .help(help)
        .accessibilityLabel(label)
    }

    /// Their tags, each × to take it off all of them, and a field to add one to all, making it if it's new.
    private func tagsPanel(_ cards: [Card]) -> some View {
        let counts = Dictionary(cards.flatMap(\.tags).map { ($0, 1) }, uniquingKeysWith: +)
        let present = model.index.resolveTags(model.index.tagGroups.order(Array(counts.keys)))
        let vaultIds = Array(Set(cards.map(\.vaultId)))
        let offered = tagsForAll(model.index.tags, vaultIds: vaultIds, model.sharedInto)
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let options = q.isEmpty ? [] : Array(offered.filter { $0.title.lowercased().contains(q) }.prefix(6))
        let exact = offered.first { $0.title.lowercased() == q }
        return VStack(alignment: .leading, spacing: 8) {
            if !present.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(present) { tag in
                        HStack(spacing: 4) {
                            Text("#" + tag.displayTitle)
                            if let n = counts[tag.id], n < cards.count { Text("\(n)").foregroundStyle(Theme.muted) }
                            Button { removeTag(tag, from: cards) } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)) }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Remove #\(tag.displayTitle) from the selected entries")
                        }
                        .font(.system(size: 13))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(tag.color.map { Theme.tint($0).opacity(0.24) } ?? Theme.sunken))
                    }
                }
            }
            TextField("Add a tag to all", text: $query)
                .textFieldStyle(.roundedBorder)
                .onSubmit { create(exact: exact, vaultIds: vaultIds, cards: cards) }
            if !q.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(options) { t in Button(t.displayTitle) { addTag(t.id, t.displayTitle, to: cards) }.buttonStyle(.bordered) }
                    if exact == nil { Button("Create “\(query.trimmingCharacters(in: .whitespaces))”") { create(exact: nil, vaultIds: vaultIds, cards: cards) }.buttonStyle(.bordered) }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func duePanel(_ todos: [Card]) -> some View {
        let today = model.today
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button("Today") { setDue(todos, today) }
                Button("Tomorrow") { setDue(todos, DateKey.adding(1, to: today)) }
                Button("In a week") { setDue(todos, DateKey.adding(7, to: today)) }
                Button("No date") { setDue(todos, nil) }.buttonStyle(.borderless)
            }
            .buttonStyle(.bordered)
            .padding(12)
        }
    }

    private func setDue(_ todos: [Card], _ due: String?) {
        model.performEach(todos.map(\.id), say: "Changed the due date of \(todos.count == 1 ? "1 todo" : "\(todos.count) todos")") { repo, id, group in
            try await repo.update(id, group: group) { $0.due = due }
        }
        panel = nil
    }

    private func setStatus(_ todos: [Card], done: Bool) {
        let today = model.today
        let ids = todos.filter { $0.isDone != done }.map(\.id)
        model.performEach(ids, say: done ? "Marked \(ids.count) done" : "Reopened \(ids.count)") { repo, id, group in
            _ = try await repo.setDone(id, done, today: today, group: group)
        }
    }

    private func retype(_ cards: [Card], to type: CardType) {
        let n = cards.count
        model.performEach(cards.map(\.id), say: type == .todo ? "Made \(n) into \(n == 1 ? "a todo" : "todos")" : "Made \(n) into \(n == 1 ? "a note" : "notes")") { repo, id, group in
            try await repo.retype(id, to: type, group: group)
        }
    }

    private func addTag(_ tagId: String, _ name: String, to cards: [Card]) {
        query = ""
        let groups = model.index.tagGroups
        model.performEach(cards.map(\.id), say: "Tagged \(cards.count == 1 ? "1 entry" : "\(cards.count) entries") #\(name)") { repo, id, group in
            try await repo.update(id, group: group) { $0.tags = groups.with($0.tags, tagId) }
        }
    }

    private func removeTag(_ tag: Card, from cards: [Card]) {
        let ids = cards.filter { $0.tags.contains(tag.id) }.map(\.id)
        model.performEach(ids, say: "Removed #\(tag.displayTitle) from \(ids.count == 1 ? "1 entry" : "\(ids.count) entries")") { repo, id, group in
            try await repo.update(id, group: group) { $0.tags = $0.tags.filter { $0 != tag.id } }
        }
    }

    private func create(exact: Card?, vaultIds: [String], cards: [Card]) {
        let name = query.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "^#", with: "", options: .regularExpression)
        guard !name.isEmpty else { return }
        if let exact { return addTag(exact.id, exact.displayTitle, to: cards) }
        let id = UUID().uuidString.lowercased()
        let vault = vaultIds.count == 1 ? vaultIds[0] : nil
        model.perform { repo in _ = try await repo.createTag(id: id, title: name, vaultId: vault) }
        addTag(id, name, to: cards)
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
                    Image(systemName: Doc.fileSymbol(mime: node["attrs"]?["mime"]?.stringValue))
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

/// The box's menu of things to add, as the web's / menu: a todo, lists, a quote, a heading, a photo, a file or a voice
/// message, narrowed by what's typed after the /.
struct SlashMenu: View {
    struct Item: Identifiable {
        let id: String
        let label: String
        let icon: String
        let hint: String?
        let words: String
        let marker: String?
    }

    static let items: [Item] = [
        Item(id: "todo", label: "Todo", icon: "checkmark.square", hint: "[]", words: "todo task checkbox", marker: "[] "),
        Item(id: "bullets", label: "Bullet list", icon: "list.bullet", hint: "-", words: "bullet list", marker: "- "),
        Item(id: "numbers", label: "Numbered list", icon: "list.number", hint: "1.", words: "numbered ordered list", marker: "1. "),
        Item(id: "quote", label: "Quote", icon: "text.quote", hint: ">", words: "quote blockquote", marker: "> "),
        Item(id: "photo", label: "Photo", icon: "photo", hint: nil, words: "photo image picture", marker: nil),
        Item(id: "file", label: "File", icon: "paperclip", hint: nil, words: "file attach attachment document pdf upload", marker: nil),
        Item(id: "voice", label: "Voice message", icon: "mic", hint: nil, words: "voice message record audio sound microphone dictate transcript", marker: nil),
        Item(id: "heading", label: "Heading", icon: "textformat.size", hint: "#", words: "heading title", marker: "# "),
    ]

    let query: String
    let pick: (Item) -> Void

    var body: some View {
        let q = query.lowercased()
        let shown = Self.items.filter { q.isEmpty || $0.label.lowercased().hasPrefix(q) || $0.words.split(separator: " ").contains { $0.hasPrefix(q) } }
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Add").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted).padding(.horizontal, 10).padding(.top, 6)
                ForEach(shown) { item in
                    Button { pick(item) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: item.icon).frame(width: 20).foregroundStyle(Theme.muted)
                            Text(item.label)
                            Spacer()
                            if let hint = item.hint { Text(hint).font(.caption.monospaced()).foregroundStyle(Theme.muted) }
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 4)
            .frame(maxWidth: 320, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface).shadow(color: .black.opacity(0.12), radius: 8, y: 2))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
