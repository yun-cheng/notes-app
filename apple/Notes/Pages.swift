import NotesKit
import SwiftUI

/// The Trash: entries put there, to read, copy and restore, one by one or all at once.
struct TrashPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let trash = model.index.trash
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                TrashedAttachments()
                ForEach(trash) { card in
                    VStack(alignment: .leading, spacing: 4) {
                        BubbleView(card: card)
                        EntryAttachments(card: card)
                        if model.canWrite(card) {
                            Button("Restore") {
                                let id = card.id
                                model.perform { try await $0.setDeleted(id, false) }
                                model.say("Restored", undoable: true)
                            }
                            .buttonStyle(.borderless)
                            .font(.caption)
                        }
                    }
                }
                if trash.isEmpty && AttachmentKeeper.shared.trash.isEmpty { ContentUnavailableView("The Trash is empty", systemImage: "trash").padding(.top, 60) }
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .pageBackground()
        .navigationTitle("Trash")
        .task { await AttachmentKeeper.shared.sweep(model: model, now: true) }
        .toolbar {
            if !trash.isEmpty {
                Button("Restore all") {
                    let ids = trash.filter { model.canWrite($0) }.map(\.id)
                    model.performEach(ids, say: "Restored \(ids.count)") { repo, id, group in try await repo.setDeleted(id, false, group: group) }
                }
            }
        }
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

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let hits = q.isEmpty ? nil : Set(model.search.search(q).map(\.card.id))
        let shown = days.map { d in HeldDay(day: d.day, items: d.items.filter { hits == nil || hits!.contains($0.card.id) || text($0.item).localizedCaseInsensitiveContains(q) }) }.filter { !$0.items.isEmpty }
        let all = shown.flatMap(\.items)
        VStack(spacing: 0) {
            LibraryFilterRow(filter: $filter) { lead }
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
        .searchable(text: $query, prompt: "Search \(noun.1)")
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

/// Search over everything, as on the phone's Search tab.
struct SearchPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let hits = q.isEmpty ? [] : model.search.search(q).filter { $0.card.isEntry }
        List(hits, id: \.card.id) { hit in
            Button { model.openEntry = hit.card.id } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.card.displayTitle).fontWeight(.semibold).lineLimit(1)
                    Text(hit.snippet).font(.caption).foregroundStyle(Theme.muted).lineLimit(2)
                }
            }
            .buttonStyle(.plain)
        }
        .searchable(text: $query, prompt: "Search everything")
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

