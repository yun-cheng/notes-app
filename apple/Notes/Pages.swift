import NotesKit
import SwiftUI

/// What's been moved to the Trash, as the web app's: its photos and files first, then entries as the journal shows
/// them, under the day each was trashed, newest first, narrowed by the journal's filters. They can be read and copied
/// but not changed: a press picks one, and the bar for those picked restores them; Restore is in each one's menu too,
/// and Restore all, in the title bar, restores everything shown. Trashed tags are listed after the entries.
struct TrashPage: View {
    @Environment(AppModel.self) private var model
    @State private var filter = StreamFilter()
    @State private var picked: Set<String> = []

    private var items: [Card] {
        let match = Stream.matcher(filter, today: model.today, sharedInto: model.sharedInto)
        return model.index.trash.filter { $0.isEntry && match($0, nil) }.sorted { $0.updatedAt > $1.updatedAt }
    }

    private var tags: [Card] { filter.isFiltered ? [] : model.index.trash.filter { $0.type == .tag } }

    var body: some View {
        let items = self.items
        let tags = self.tags
        let restorable: [Card] = (items + tags).filter { model.canWrite($0) }
        VStack(spacing: 0) {
            FilterRow(filter: $filter, pickDates: .constant(false), templates: false)
            ScrollView { list(items, tags) }
            if !picked.isEmpty { pickBar }
        }
        .pageBackground()
        .navigationTitle(picked.isEmpty ? "Trash" : "\(picked.count) selected")
        #if os(macOS)
        .navigationSubtitle(picked.isEmpty ? "\(items.count + tags.count)" : "of \(items.count)")
        #endif
        .task { await AttachmentKeeper.shared.sweep(model: model, now: true) }
        .toolbar {
            if !picked.isEmpty {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button("Select all") { picked = Set(items.map(\.id)) }
                    Button("Done") { picked = [] }
                    PhoneTail()
                }
            } else {
                ToolbarItemGroup(placement: .primaryAction) {
                    if restorable.count > 1 {
                        Button { restore(restorable.map(\.id)) } label: { Label("Restore all", systemImage: "arrow.uturn.backward") }
                            .labelStyle(.titleAndIcon)
                            .help("Restore everything shown here")
                    }
                    PhoneTail()
                }
            }
        }
        .placesPhoneTail()
    }

    private func list(_ items: [Card], _ tags: [Card]) -> some View {
        let days: [(key: String, value: [Card])] = Dictionary(grouping: items) { DateKey.of(Date(ms: $0.updatedAt)) }.sorted { $0.key > $1.key }
        let attachmentsShown = !filter.with { $0.vaultId = nil }.isFiltered
        return LazyVStack(alignment: .leading, spacing: 8) {
            if attachmentsShown { TrashedAttachments(vaultId: filter.vaultId) }
            ForEach(days, id: \.key) { day in
                DayBadge(day: day.key, sort: .edited) { _ in }
                ForEach(day.value) { card in trashedEntry(card) }
            }
            if items.isEmpty {
                Text(emptyText(tags))
                    .foregroundStyle(Theme.muted).frame(maxWidth: .infinity).padding(.vertical, 40)
            }
            if !tags.isEmpty {
                Text("Tags").font(.headline).padding(.top, 16)
                ForEach(tags) { tag in trashedTag(tag) }
            }
        }
        .padding(16)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
    }

    private func emptyText(_ tags: [Card]) -> String {
        if filter.isFiltered { return "Nothing in the Trash matches these filters." }
        if !tags.isEmpty || !AttachmentKeeper.shared.trash.isEmpty { return "No entries in the Trash." }
        return "The Trash is empty. Entries you move to the Trash wait here until you restore them."
    }

    private func trashedEntry(_ card: Card) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            BubbleView(card: card, picked: picked.contains(card.id), onPick: { toggle(card.id) }, picking: true)
            EntryAttachments(card: card)
        }
    }

    private func trashedTag(_ tag: Card) -> some View {
        HStack {
            Label(tag.displayTitle, systemImage: "tag")
            Spacer()
            if model.canWrite(tag) { Button("Restore") { restore([tag.id]) }.buttonStyle(.bordered) }
        }
    }

    private var pickBar: some View {
        let canRestore = picked.contains { id in model.card(id).map { model.canWrite($0) } ?? false }
        return HStack(spacing: 12) {
            Text("\(picked.count) selected").fontWeight(.semibold)
            Button { restore(Array(picked)); picked = [] } label: { Label("Restore", systemImage: "arrow.uturn.backward") }
                .buttonStyle(.borderedProminent)
                .disabled(!canRestore)
            Button { copyPicked() } label: { Image(systemName: "square.on.square") }
                .buttonStyle(.borderless).help("Copy").accessibilityLabel("Copy")
            Spacer()
            Button { picked = [] } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).accessibilityLabel("Stop selecting")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Theme.surface)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func copyPicked() {
        let cards = picked.compactMap { model.card($0) }.sorted { $0.createdAt < $1.createdAt }
        Clipboard.copy(Markdown.entries(cards, index: model.index))
        model.say("Copied \(cards.count)")
    }

    private func toggle(_ id: String) {
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
    }

    private func restore(_ ids: [String]) {
        let ok = ids.filter { id in model.card(id).map { model.canWrite($0) } ?? false }
        guard !ok.isEmpty else { return }
        model.performEach(ok, say: ok.count == 1 ? "Restored" : "Restored \(ok.count)") { repo, id, group in try await repo.setDeleted(id, false, group: group) }
    }
}

/// A page listing what entries hold, newest first under the day each entry was written, each with its entry named
/// under it, pressed to open the entry, as the web's `HeldList`; a count over it, and its own search.
struct HeldList<T: Identifiable, Row: View, Lead: View>: View where T.ID == String {
    @Environment(AppModel.self) private var model
    let title: String
    let noun: (String, String)
    let days: [HeldDay<T>]
    @Binding var filter: StreamFilter
    let filtered: Bool
    let text: (T) -> String
    let empty: String
    let emptyFiltered: String
    @ViewBuilder var lead: Lead
    @ViewBuilder var row: (T, Card) -> Row
    @State private var query = ""
    @State private var searching = false

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let hits = q.isEmpty ? nil : Set(model.search.search(q).map(\.card.id))
        let shown = days.map { d in HeldDay(day: d.day, items: d.items.filter { hits == nil || hits!.contains($0.card.id) || text($0.item).localizedCaseInsensitiveContains(q) }) }.filter { !$0.items.isEmpty }
        let all = shown.flatMap(\.items)
        VStack(spacing: 0) {
            LibraryFilterRow(filter: $filter) { lead }
            if searching { PageSearchField(query: $query, close: { searching = false; query = "" }) }
            if all.isEmpty {
                ContentUnavailableView {
                    Text(q.isEmpty ? "" : "No \(noun.1) here have “\(q)” in them or their entries.")
                } description: {
                    Text(q.isEmpty ? (filtered ? emptyFiltered : empty) : "")
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        Text(countLine(all.count == 1 ? "1 \(noun.0)" : "\(all.count) \(noun.1)", entries: Set(all.map(\.card.id)).count))
                            .font(.subheadline).foregroundStyle(Theme.muted).padding(.bottom, 8)
                        ForEach(shown) { day in
                            Text(DateKey.relativeDay(day.day, today: model.today)).font(.system(size: 15, weight: .semibold)).padding(.top, 12).padding(.bottom, 6)
                            ForEach(day.items, id: \.item.id) { pair in
                                VStack(alignment: .leading, spacing: 4) {
                                    row(pair.item, pair.card)
                                    Button { model.openEntry = pair.card.id } label: {
                                        HStack(spacing: 2) {
                                            Text(pair.card.displayTitle.isEmpty ? "Untitled" : pair.card.displayTitle).lineLimit(1)
                                            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                                        }
                                        .font(.caption).foregroundStyle(Theme.muted)
                                    }
                                    .buttonStyle(.plain)
                                    .help("Open the entry")
                                    .padding(.leading, 4)
                                }
                                .padding(.bottom, 10)
                                .contextMenu {
                                    Button("Open entry") { model.openEntry = pair.card.id }
                                    Button("Show in journal") { model.page = .journal(StreamFilter()); model.lastSaved = pair.card.id }
                                }
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: 760, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .pageBackground()
        .navigationTitle(title)
        // As the web's: a search button (or /) opens a field under the filters, narrowing the page as it's typed.
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { searching.toggle(); if !searching { query = "" } } label: { Label("Search", systemImage: "magnifyingglass") }
                    .keyboardShortcut("/", modifiers: [])
                PhoneTail()
            }
        }
        .placesPhoneTail()
    }
}

/// Every web link in the journal's entries, as the cards under an entry show them but with each one's whole address,
/// and the page's title and picture when it can be previewed (not in an encrypted vault).
struct LinksPage: View {
    @Environment(AppModel.self) private var model
    @State private var filter = StreamFilter()

    struct Link: Identifiable { let id: String }

    var body: some View {
        let days = HeldDay<Link>.of(model, filter, once: false) { card in
            ([card.content] + card.morePages).flatMap { Doc.linkUrls($0) }.map(Link.init)
        }
        HeldList(title: "Links", noun: ("link", "links"), days: days, filter: $filter, filtered: filter.isFiltered, text: { $0.id },
            empty: "No links yet. Paste or type a web address into an entry and it shows here.",
            emptyFiltered: "No links here match. Take a filter off above, or pick another.") {
            EmptyView()
        } row: { link, card in
            LinkCard(url: link.id, previewing: model.vault(card.vaultId)?.isEncrypted == false, address: true)
        }
    }
}

/// Every file attached to the journal's entries, as chips that open the file or save it, and a voice message as it
/// plays in its entry, with its transcript; videos are on the Photos page. A switch shows one kind alone.
struct FilesPage: View {
    @Environment(AppModel.self) private var model
    @State private var filter = StreamFilter()
    @State private var kind: FileKind?

    var body: some View {
        let every = HeldDay<Doc.FileInfo>.of(model, filter, once: true) { card in
            ([card.content] + card.morePages).flatMap(Doc.files).filter { !$0.isVideo }
        }
        let held = Set(every.flatMap { $0.items.map { FileKind.of($0.item) } })
        let kinds = FileKind.allCases.filter { held.contains($0) || $0 == kind }
        let days = kind.map { k in every.map { HeldDay(day: $0.day, items: $0.items.filter { FileKind.of($0.item) == k }) }.filter { !$0.items.isEmpty } } ?? every
        HeldList(title: "Files", noun: ("file", "files"), days: days, filter: $filter, filtered: filter.isFiltered || kind != nil, text: { $0.name },
            empty: "No files yet. Attach one to an entry with the paperclip, or by dropping it in.",
            emptyFiltered: kind.map { "No \($0 == .audio || $0 == .video ? "\($0.label.lowercased()) files" : $0.label.lowercased()) here. Pick All above, or take a filter off." } ?? "No files here match. Take a filter off above, or pick another.") {
            if kinds.count > 1 || kind != nil {
                Segmented(options: [(nil, "All")] + kinds.map { (Optional($0), $0.label) }, value: $kind)
            }
        } row: { file, card in
            FileChip(file: file, vaultId: card.vaultId)
        }
    }
}

/// What sort of file one is, for the Files page's switch, as the web's `fileKind`.
enum FileKind: String, CaseIterable, Hashable {
    case pdf, document, spreadsheet, slides, audio, image, video, archive, other

    var label: String {
        switch self {
        case .pdf: "PDFs"
        case .document: "Documents"
        case .spreadsheet: "Spreadsheets"
        case .slides: "Slides"
        case .audio: "Audio"
        case .image: "Images"
        case .video: "Video"
        case .archive: "Archives"
        case .other: "Other"
        }
    }

    private static let byExtension: [String: FileKind] = {
        var out: [String: FileKind] = [:]
        let lists: [(FileKind, String)] = [
            (.pdf, "pdf"), (.document, "doc docx odt rtf txt md markdown pages epub tex"), (.spreadsheet, "csv tsv xls xlsx xlsm ods numbers"),
            (.slides, "ppt pptx odp key"), (.audio, "mp3 m4a wav aac oga ogg opus flac aif aiff weba"),
            (.image, "jpg jpeg png gif webp heic heif avif svg tif tiff bmp"), (.video, "mp4 m4v mov webm mkv avi"), (.archive, "zip gz tgz tar 7z rar bz2 xz"),
        ]
        for (kind, exts) in lists { for e in exts.split(separator: " ") { out[String(e)] = kind } }
        return out
    }()

    static func of(_ file: Doc.FileInfo) -> FileKind {
        let ext = file.name.split(separator: ".").count > 1 ? String(file.name.split(separator: ".").last!).lowercased() : nil
        let mime = (file.mime ?? "").split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
        let parts = mime.split(separator: "/").map(String.init)
        let top = parts.first ?? "", sub = parts.count > 1 ? parts[1] : ""
        if top == "audio" { return .audio }
        if top == "video" { return .video }
        if let ext, let k = byExtension[ext] { return k }
        if sub == "pdf" { return .pdf }
        if top == "image" { return .image }
        if sub.contains("spreadsheet") || sub.contains("excel") || sub.contains("csv") { return .spreadsheet }
        if sub.contains("presentation") || sub.contains("powerpoint") { return .slides }
        if ["zip", "compressed", "tar", "rar", "7z"].contains(where: sub.contains) { return .archive }
        if top == "text" || ["wordprocessing", "msword", "rtf", "opendocument.text", "epub"].contains(where: sub.contains) { return .document }
        return .other
    }
}

/// Search over everything, as on the phone's Search tab and the web's Search page: notes, todos and tags, each with
/// its icon, its name and where the words are.
struct SearchPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let hits = q.isEmpty ? [] : model.search.search(q)
        List {
            ForEach(hits, id: \.card.id) { hit in
                Button {
                    if hit.card.type == .tag { model.page = .journal(StreamFilter(tagId: hit.card.id)) } else { model.openEntry = hit.card.id }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: hit.card.type == .tag ? "tag" : hit.card.type == .todo ? "checkmark.square" : "doc.text").foregroundStyle(Theme.muted).frame(width: 20)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hit.card.displayTitle).fontWeight(.semibold).lineLimit(1)
                            Text(hit.snippet).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(2)
                        }
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(Theme.surface)
            }
            if !q.isEmpty && hits.isEmpty {
                Text("No results for “\(q)”.").foregroundStyle(Theme.muted).listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .pageBackground()
        .searchable(text: $query, prompt: "Search notes, todos and tags")
        .navigationTitle("Search")
    }
}

/// Cmd+K: any page or action, and any entry, from the keyboard.
struct CommandPalette: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var focused: Bool

    struct Command: Identifiable {
        let id: String
        let icon: String
        let run: () -> Void
    }

    private var commands: [Command] {
        Page.destinations.map { d in Command(id: d.title, icon: d.icon) { model.page = d.page } } + [
            Command(id: "Undo", icon: "arrow.uturn.backward") { model.undo() },
            Command(id: "Redo", icon: "arrow.uturn.forward") { model.redo() },
            Command(id: "Lock private vaults", icon: "lock") { model.lockAll() },
        ]
    }

    /// Typed text with markers (`[]`, `#tag`, `@friday`) is offered for saving first; other text lists commands,
    /// then entries, then saving.
    private var marked: Bool {
        query.firstMatch(of: /(^|\s)(\[[ xX]?\]|TODO\s|#[\p{L}\p{N}_-]+|@[\p{L}\p{N}:-]+)/) != nil
    }

    private func saveTyped() {
        let entries = EntryParser.parseEntries(query, today: model.today)
        guard !entries.isEmpty else { return }
        let filter = model.page.filter ?? StreamFilter()
        Task {
            if case .saved(let ids, _) = await model.save(entries, SaveOptions(journal: filter, today: model.today)) {
                model.say("Saved \(ids.count == 1 ? "it" : "\(ids.count) entries")", undoable: true)
            }
        }
        dismiss()
    }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let matching = marked ? [] : commands.filter { q.isEmpty || $0.id.localizedCaseInsensitiveContains(q) }
        let hits = q.isEmpty ? [] : model.search.search(q).prefix(20)
        VStack(spacing: 0) {
            TextField("Search or run a command", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .padding(14)
                .focused($focused)
                .onSubmit {
                    if marked { saveTyped() } else if let first = matching.first { first.run(); dismiss() } else if let hit = hits.first { model.openEntry = hit.card.id; dismiss() } else if !q.isEmpty { saveTyped() }
                }
            Divider()
            List {
                if marked {
                    Button(action: saveTyped) { Label("Save “\(q)”", systemImage: "square.and.arrow.down") }.buttonStyle(.plain)
                }
                if !matching.isEmpty {
                    Section("Commands") {
                        ForEach(matching) { c in
                            Button { c.run(); dismiss() } label: { Label(c.id, systemImage: c.icon) }.buttonStyle(.plain)
                        }
                    }
                }
                if !hits.isEmpty {
                    Section("Entries") {
                        ForEach(Array(hits), id: \.card.id) { hit in
                            Button {
                                if hit.card.type == .tag { model.page = .journal(StreamFilter(tagId: hit.card.id)) } else { model.openEntry = hit.card.id }
                                dismiss()
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(hit.card.displayTitle).lineLimit(1)
                                    Text(hit.snippet).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if !q.isEmpty && !marked {
                    Section {
                        Button(action: saveTyped) { Label("Save “\(q)” as a note", systemImage: "square.and.pencil") }.buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(minWidth: 480, minHeight: 360)
        .onAppear { focused = true }
    }
}

