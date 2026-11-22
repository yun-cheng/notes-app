import NotesKit
import SwiftUI

/// A page's list of entries under day headings, as the Trash and the search show them.
struct EntryList: View {
    let cards: [Card]
    var empty: String = "Nothing here"

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(cards) { BubbleView(card: $0) }
                if cards.isEmpty { ContentUnavailableView(empty, systemImage: "tray").padding(.top, 60) }
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .pageBackground()
    }
}

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
                    let group = model.repo.action()
                    let ids = trash.filter { model.canWrite($0) }.map(\.id)
                    model.perform { repo in for id in ids { try await repo.setDeleted(id, false, group: group) } }
                    model.say("Restored \(ids.count)", undoable: true)
                }
            }
        }
    }
}

/// Every web link in the journal, under the day its entry was written.
struct LinksPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .link), today: model.today)
        List {
            ForEach(items) { item in
                ForEach(Doc.linkUrls(item.card.content).filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }, id: \.self) { url in
                    VStack(alignment: .leading, spacing: 2) {
                        Link(destination: URL(string: url)!) { Text(url).lineLimit(2) }
                        Button(item.card.displayTitle) { model.openEntry = item.card.id }.buttonStyle(.plain).font(.caption).foregroundStyle(Theme.muted)
                    }
                    .contextMenu {
                        Button("Copy link address") { Clipboard.copy(url) }
                        Button("Open entry") { model.openEntry = item.card.id }
                    }
                }
            }
        }
        .searchable(text: $query)
        .navigationTitle("Links")
    }
}

/// Every file attached in the journal.
struct FilesPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .file), today: model.today)
        List {
            ForEach(items) { item in
                ForEach(Doc.files(item.card.content).filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { file in
                    HStack {
                        Image(systemName: file.isAudio ? "waveform" : file.isVideo ? "film" : "doc")
                        VStack(alignment: .leading) {
                            Text(file.name)
                            Button(item.card.displayTitle) { model.openEntry = item.card.id }.buttonStyle(.plain).font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        if let size = file.size { Text(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)).font(.caption).foregroundStyle(Theme.muted) }
                    }
                }
            }
        }
        .searchable(text: $query)
        .navigationTitle("Files")
    }
}

/// Every photo and video in the journal, under the day each entry was written.
struct PhotosPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .photo), today: model.today)
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 4)], spacing: 4) {
                ForEach(items) { item in
                    ForEach(Doc.media(item.card.content)) { media in
                        PhotoThumb(media: media, vaultId: item.card.vaultId)
                            .onTapGesture { model.openEntry = item.card.id }
                    }
                }
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Photos")
    }
}

/// Search over everything, as on the phone's Search tab.
struct SearchPage: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let hits = CardSearch(model.index).search(query).filter { $0.card.isEntry }
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
        [
            Command(id: "Journal", icon: "doc.text") { model.page = .journal(StreamFilter()) },
            Command(id: "Today", icon: "sun.max") { model.page = .journal(StreamFilter(status: .today)) },
            Command(id: "Upcoming", icon: "calendar.badge.clock") { model.page = .journal(StreamFilter(status: .upcoming)) },
            Command(id: "History", icon: "clock.arrow.circlepath") { model.page = .history },
            Command(id: "Calendar", icon: "calendar") { model.page = .calendar },
            Command(id: "Timeline", icon: "chart.bar.xaxis") { model.page = .timeline },
            Command(id: "Photos", icon: "photo") { model.page = .photos },
            Command(id: "Links", icon: "link") { model.page = .links },
            Command(id: "Files", icon: "doc") { model.page = .files },
            Command(id: "Archive", icon: "archivebox") { model.page = .journal(StreamFilter(archived: true)) },
            Command(id: "Templates", icon: "doc.on.doc") { model.page = .journal(StreamFilter(template: true)) },
            Command(id: "Trash", icon: "trash") { model.page = .trash },
            Command(id: "All tags", icon: "tag") { model.page = .tags },
            Command(id: "Vaults", icon: "tray.2") { model.page = .vaults },
            Command(id: "Settings", icon: "gear") { model.page = .settings },
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
        let hits = q.isEmpty ? [] : CardSearch(model.index).search(q).prefix(20)
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

/// Every tag, grouped, with how many entries have each, as the web app's Tags page.
struct TagsPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let groups = model.index.tagGroups
        List {
            ForEach(groups.groups) { group in
                Section(group.title) { ForEach(group.members) { TagRow(tag: $0) } }
            }
            Section("Tags") { ForEach(groups.loose) { TagRow(tag: $0) } }
        }
        .navigationTitle("Tags")
    }
}

struct TagRow: View {
    @Environment(AppModel.self) private var model
    let tag: Card

    var body: some View {
        let count = model.index.backlinks[tag.id]?.filter { $0.kind == .tag }.count ?? 0
        Button { model.page = .journal(StreamFilter(tagId: tag.id)) } label: {
            HStack {
                Label(tag.displayTitle, systemImage: "tag")
                Spacer()
                Text(tag.tagVaults(model.sharedInto)?.compactMap { model.vault($0)?.name }.joined(separator: ", ") ?? "All vaults")
                    .font(.caption).foregroundStyle(Theme.muted)
                Text("\(count)").monospacedDigit().foregroundStyle(Theme.muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

