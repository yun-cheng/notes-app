import NotesKit
import SwiftUI

#if os(macOS)
/// An open entry on a Mac, as the web's dialog: the page dimmed behind it, the entry in the middle, at most 660 points
/// wide and as tall as what's in it, closed by a click outside it or Esc.
struct EntryOverlay: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Rectangle()
                    .fill(Color.black.opacity(0.35))
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { model.openEntry = nil }
                    .accessibilityLabel("Close")
                    .accessibilityAddTraits(.isButton)
                EntrySheet(id: id)
                    .id(id)
                    .frame(width: min(660, geo.size.width - 32))
                    .frame(maxHeight: geo.size.height * 0.88)
                    .fixedSize(horizontal: false, vertical: true)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.3), radius: 24, y: 8)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}
#endif

/// An entry opened to read or change, over the page it was opened from, as the web app's sheet at `/journal/:id`:
/// a todo's title and checkbox, the text, its pages, tags, due date and vaults, and its links.
struct EntrySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var page = 0
    /// How tall its content is, so the sheet on a Mac fits it, as the web's does, up to most of the window.
    @State private var contentHeight: CGFloat = 240
    /// How tall the bar is, so a phone's sheet fits the entry and its bar, as the web's does.
    @State private var barHeight: CGFloat = 96
    @State private var title = ""
    /// The title as last taken from the card: the field differs from it only once something is typed there.
    @State private var opened = ""
    /// The formatting buttons, shown from the bar's Aa.
    @State private var tools = false
    /// A title added to a note from the bar's T.
    @State private var titled = false
    /// The entry as it was when opened, for Discard to put back.
    @State private var original: [String: JSONValue]?

    var body: some View {
        #if os(macOS)
        // Over the page in an overlay of its own, as the web's dialog (`EntryOverlay`), so no navigation stack.
        frame
        #else
        NavigationStack { frame }
        #endif
    }

    @ViewBuilder
    private var frame: some View {
        if let card = model.card(id) {
            content(card)
        } else {
            ContentUnavailableView("Not here", systemImage: "questionmark.square.dashed", description: Text("This entry isn't on this device, or its vault is locked."))
                #if os(macOS)
                .frame(height: 240)
                #endif
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { close() } } }
        }
    }

    /// Closes it, as a sheet on a phone or as the overlay on a Mac.
    private func close() {
        dismiss()
        model.openEntry = nil
    }

    @ViewBuilder
    private func content(_ card: Card) -> some View {
        let edit = model.canEdit(card)
        // Its pages, and a blank one being added: kept only once something is written on it.
        let stored = [card.content] + card.morePages
        let pages = stored + Array(repeating: Doc.empty, count: max(0, page + 1 - stored.count))
        let behind = max(stored.count - 1, page)
        let isTodo = card.type == .todo
        let showTitle = isTodo || !card.title.trimmingCharacters(in: .whitespaces).isEmpty || titled || card.isStack
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if card.viewOnly || !model.canWrite(card) {
                        Label(card.viewOnly ? "View only. Turn it off in the entry's menu to change it." : "You can view this entry.", systemImage: "eye")
                            .font(.callout).foregroundStyle(Theme.muted)
                    }
                    if card.template { TemplateNote(card: card) }
                    if showTitle {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if isTodo { TodoCheck(card: card).scaleEffect(1.25) }
                            TextField(isTodo ? "Todo" : card.isStack ? "Stack" : "Title", text: $title, axis: .vertical)
                                .font(.title3.weight(isTodo ? .regular : .semibold))
                                .textFieldStyle(.plain)
                                .disabled(!edit)
                                .onSubmit { saveTitle(card) }
                        }
                    }
                    if behind > 0 {
                        PageTabs(page: $page, count: behind + 1, canAdd: edit && page <= stored.count - 1 + 1 && page < stored.count, canRemove: edit && page > 0) {
                            removePage(card, stored: stored.count)
                        }
                    }
                    DocEditor(content: pages[page], editable: edit, titleOf: model.index.titleOf, tools: tools, placeholder: page > 0 ? "Page \(page + 1)" : isTodo ? "Details" : "Note") { doc in
                        savePage(card.id, page, doc)
                    }
                    .frame(minHeight: 80)
                    .id("\(card.id):\(page)")
                    SheetTags(card: card, edit: edit)
                    FlowLayout(spacing: 6) { Reactions(card: card, large: true) }
                    if card.isStack && page == 0 { StackPreview(stack: card) }
                    CommentsSection(card: card)
                    Backlinks(card: card)
                }
                .padding(20)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            #if os(macOS)
            .frame(height: min(max(contentHeight, 140), 640))
            #endif
            #if os(iOS)
            // As tall as what's in it, as the web's sheet on a phone, up to most of the screen.
            .presentationDetents([.height(min(max(contentHeight, 140) + barHeight + 12, 720))])
            #endif
            Divider()
            SheetBar(card: card, edit: edit, tools: $tools, titled: $titled, showTitle: showTitle, addPage: { page = stored.count }, behind: behind, original: original) {
                saveTitle(card)
                close()
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
        }
        .pageBackground()
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        #endif
        .onAppear {
            title = card.title
            opened = card.title
            if original == nil { original = card.payload }
        }
        // Renamed elsewhere while open: the field follows, unless something was typed in it.
        .onChange(of: card.title) { _, renamed in
            if title == opened { title = renamed }
            opened = renamed
        }
        .onDisappear { saveTitle(card) }
        #if os(macOS)
        .onExitCommand { close() }
        #endif
    }

    private func removePage(_ card: Card, stored: Int) {
        let at = page
        page -= 1
        guard at < stored else { return }
        let id = card.id
        model.update(id) { c in
            var more = c.morePages
            if at - 1 < more.count { more.remove(at: at - 1) }
            c.morePages = more
        }
        model.say("Took out page \(at + 1)", undoable: true)
    }

    private func saveTitle(_ card: Card) {
        // Only what was typed here: a title it opened with mustn't undo a rename made elsewhere since.
        guard model.canEdit(card), title != opened, title != card.title else { return }
        let t = title
        model.update(card.id, typed: true) { $0.title = t }
    }

    private func savePage(_ id: String, _ page: Int, _ doc: JSONValue) {
        model.perform { repo in
            try await repo.update(id, typed: true) { card in
                if page == 0 {
                    card.content = doc
                } else {
                    var more = card.morePages
                    while more.count < page { more.append(Doc.empty) }
                    more[page - 1] = doc
                    card.morePages = more
                }
            }
        }
    }
}

/// What links here, as the web's: "Linked from (2)", each entry named with a line of its text, opening it.
struct Backlinks: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @State private var open = true

    var body: some View {
        let links = (model.index.backlinks[card.id] ?? []).filter { $0.kind != .tag || card.type == .tag }
        if !links.isEmpty {
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(links.prefix(30), id: \.from.id) { link in
                        Button { model.openEntry = link.from.id } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.from.displayTitle).fontWeight(.semibold).foregroundStyle(Theme.text).lineLimit(1)
                                let preview = Doc.previewLines(link.from.content, hidden: .mask).joined(separator: " ")
                                if !preview.isEmpty { Text(preview).font(.footnote).foregroundStyle(Theme.muted).lineLimit(2) }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.surface))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 6)
            } label: {
                Text("\(card.type == .tag ? "Tagged" : "Linked from") (\(links.count))").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.muted)
            }
            .padding(.top, 4)
        }
    }
}

/// Over a template's text: that it is one, and a button that starts an entry from it.
struct TemplateNote: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "doc.on.doc").foregroundStyle(Theme.accent)
            Text("Template: entries started from it get a copy, its checklists unticked and {date} filled in.").font(.callout).foregroundStyle(Theme.muted)
            Spacer(minLength: 8)
            if !model.viewOnly { Button("Use it") { model.startFrom(card) }.buttonStyle(.borderedProminent) }
        }
    }
}

/// The sheet's pages, as the web's tabs: numbered, + for another after them, and a way to take the one shown out.
struct PageTabs: View {
    @Binding var page: Int
    let count: Int
    let canAdd: Bool
    let canRemove: Bool
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "book.pages").font(.caption).foregroundStyle(Theme.muted)
            ForEach(0..<count, id: \.self) { i in
                Button { withAnimation(.easeOut(duration: 0.2)) { page = i } } label: {
                    Text("\(i + 1)").font(.footnote.weight(.semibold)).monospacedDigit()
                        .frame(minWidth: 26, minHeight: 26)
                        .background(Circle().fill(page == i ? Theme.accentSoft : .clear))
                        .overlay(Circle().stroke(page == i ? Theme.accent : Theme.line))
                        .foregroundStyle(page == i ? Theme.text : Theme.muted)
                }
                .buttonStyle(.plain)
            }
            if canAdd {
                Button { page = count } label: {
                    Image(systemName: "plus").font(.caption.weight(.semibold)).frame(width: 26, height: 26).overlay(Circle().stroke(Theme.line))
                }
                .buttonStyle(.plain).foregroundStyle(Theme.muted)
                .help("Add a page after the others")
                .accessibilityLabel("Add a page")
            }
            if canRemove {
                Button("Take out page \(page + 1)", action: remove).buttonStyle(.plain).font(.footnote).foregroundStyle(Theme.muted).padding(.leading, 6)
            }
        }
    }
}

/// An entry's tags in its sheet, as the web's `TagChips` there: a grouped tag opens its group, to switch it in place
/// (or, in a group of any number, add or take off one), each one-choice group the entry has none from offers itself as
/// "+ Priority" to set one, and any other tag is only a label (tags are added and taken off from the bar's Tags).
struct SheetTags: View {
    @Environment(AppModel.self) private var model
    let card: Card
    let edit: Bool

    var body: some View {
        let groups = model.index.tagGroups
        let tags = model.index.resolveTags(groups.order(card.tags))
        let unset = edit ? groups.groups.filter { $0.choosesOne && !$0.members.isEmpty && !$0.members.contains { card.tags.contains($0.id) } } : []
        if !tags.isEmpty || !unset.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(tags) { tag in
                    if edit, let group = groups.groupOf[tag.id] {
                        GroupChipMenu(card: card, group: group) { TagChip(tag: tag, large: true) }
                            .help("\(group.title): \(tag.displayTitle). Click to change")
                    } else {
                        TagChip(tag: tag, large: true)
                    }
                }
                ForEach(unset, id: \.id) { group in
                    GroupChipMenu(card: card, group: group) {
                        Text("+ \(group.title)").font(.system(size: 13)).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 10).frame(minHeight: 28)
                            .overlay(Capsule().strokeBorder(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                    }
                    .help("No \(group.title.lowercased())")
                }
            }
        }
    }
}

/// A group's tags in a menu, as the web's `GroupChip`: in a group of one choice, picking one swaps it in, and "No
/// priority" takes it off; in a group of any number, each is added or taken off.
struct GroupChipMenu<ChipLabel: View>: View {
    @Environment(AppModel.self) private var model
    let card: Card
    let group: TagGroup
    @ViewBuilder let label: () -> ChipLabel

    var body: some View {
        Menu {
            Section(group.title) {
                ForEach(group.members) { m in
                    Button { pick(m.id) } label: {
                        if card.tags.contains(m.id) { Label(m.displayTitle, systemImage: "checkmark") } else { Text(m.displayTitle) }
                    }
                }
                if group.choosesOne { Button("No \(group.title.lowercased())") { pick(nil) } }
            }
        } label: {
            label()
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private func pick(_ id: String?) {
        let inGroup = Set(group.members.map(\.id))
        let tags = card.tags
        let next: [String]
        if let id {
            next = group.choosesOne ? tags.filter { !inGroup.contains($0) } + [id] : tags.contains(id) ? tags.filter { $0 != id } : tags + [id]
        } else {
            next = tags.filter { !inGroup.contains($0) }
        }
        if next != tags { model.update(card.id) { $0.tags = next } }
    }
}

/// The sheet's bar, as the web's: note or todo, the due date, Aa for formatting, tags, a page, a title, the color and
/// previews, view only, save as template, take out of the stack, copy, share, archive, trash and the vault; then when
/// it was edited (its history), Undo and Redo, and Discard, which puts it back as it was when opened, and closes.
struct SheetBar: View {
    @Environment(AppModel.self) private var model
    let card: Card
    let edit: Bool
    @Binding var tools: Bool
    @Binding var titled: Bool
    let showTitle: Bool
    let addPage: () -> Void
    let behind: Int
    let original: [String: JSONValue]?
    let close: () -> Void

    var body: some View {
        // As the web's: the tools, wrapping, with when it was edited on the right; under them Undo and Redo, and Discard.
        VStack(alignment: .leading, spacing: 4) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 2) { buttons; Spacer(minLength: 8); edited }
                FlowLayout(spacing: 2) { buttons; edited }
            }
            HStack(spacing: 6) { history; Spacer(minLength: 0); discard }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.surface)
    }

    @ViewBuilder
    private var buttons: some View {
        let isStack = card.isStack
        if edit && !isStack {
            icon(card.type == .todo ? "doc.text" : "checkmark.circle", card.type == .todo ? "Make it a note" : "Make it a todo") {
                let id = card.id
                let to: CardType = card.type == .todo ? .note : .todo
                model.perform { try await $0.retype(id, to: to) }
            }
        }
        if card.type == .todo && edit {
            Button { model.panel = .due(card.id) } label: {
                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                    let text = DueLabel.text(card, today: model.today, short: true)
                    Text(text.isEmpty ? "Due date" : text).font(.footnote)
                        .foregroundStyle(card.isOverdue(today: model.today) ? Theme.alert : Theme.muted)
                }
                .padding(.horizontal, 8).frame(height: 32).contentShape(Rectangle())
            }
            .help("Due date, start date, time, repeat and waiting")
        }
        if edit {
            Button { tools.toggle() } label: {
                Text("Aa").font(.system(size: 15, weight: .semibold)).frame(minWidth: 34, minHeight: 32)
                    .background(RoundedRectangle(cornerRadius: 7).fill(tools ? Theme.accentSoft : .clear))
            }
            .help("Formatting")
            icon("tag", "Tags") { model.panel = .tags(card.id) }
            if behind == 0 { icon("book.pages", "Add a second page", action: addPage) }
            if !showTitle {
                Button { titled = true } label: { Text("T").font(.system(size: 15, weight: .semibold)).frame(minWidth: 34, minHeight: 32) }.help("Add title")
            }
            StyleMenu(card: card)
        }
        if model.canWrite(card) && !model.viewOnly {
            icon("eye", card.viewOnly ? "Turn off view only" : "View only", on: card.viewOnly) {
                let on = !card.viewOnly
                model.update(card.id) { $0.viewOnly = on }
            }
        }
        if edit && !isStack && !card.template {
            icon("doc.on.doc", "Save a copy as a template, to start new entries from") { model.saveAsTemplate(card) }
        }
        if let stack = model.index.stackOf[card.id], edit {
            icon("square.stack", "Take out of the stack, back into the journal") {
                let id = card.id
                model.update(stack) { $0.stack = ($0.stack ?? []).filter { $0 != id } }
            }
        }
        icon("square.on.square", "Copy") { Clipboard.copyEntry(card, model: model) }
        if model.canManage(card) {
            icon("square.and.arrow.up", "Share") { model.panel = .share(card.id) }
            icon("archivebox", card.archived ? "Unarchive: back to the journal" : "Archive: out of the journal, still in search") {
                model.archive([card.id], !card.archived)
                close()
            }
            icon("trash", "Move to Trash") {
                model.trash([card.id])
                close()
            }
            Button { model.panel = .vaults(card.id) } label: {
                HStack(spacing: 3) {
                    Text(model.vaultNames(card).joined(separator: ", ")).font(.footnote).lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .padding(.horizontal, 8).frame(height: 28)
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Theme.line))
            }
            .help("Vaults")
            .padding(.leading, 4)
        }
    }

    private var edited: some View {
        Button { model.panel = .history(card.id) } label: { Text(Self.edited(card)).font(.footnote).frame(height: 32) }.help("See every version")
    }

    @ViewBuilder
    private var history: some View {
        icon("arrow.uturn.backward", "Undo") { model.undo() }
        icon("arrow.uturn.forward", "Redo") { model.redo() }
    }

    @ViewBuilder
    private var discard: some View {
        HStack(spacing: 6) {
            if edit {
                Button("Discard") {
                    if let original {
                        let back = original
                        model.update(card.id) { $0.payload = back }
                        model.say("Discarded changes", undoable: true)
                    }
                    close()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(original == card.payload ? Theme.muted.opacity(0.5) : Theme.text)
                .disabled(original == card.payload)
                .help("Put back how it was when opened, and close")
                .padding(.horizontal, 6)
            }
        }
    }

    private func icon(_ name: String, _ label: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).font(.system(size: 15))
                .frame(width: 34, height: 32)
                .background(RoundedRectangle(cornerRadius: 7).fill(on ? Theme.accentSoft : .clear))
                .contentShape(Rectangle())
        }
        .help(label)
        .accessibilityLabel(label)
    }

    /// "Edited 3:55 AM" today, "Edited Nov 18" before, as the web's.
    static func edited(_ card: Card) -> String {
        let at = Date(ms: card.updatedAt)
        return "Edited " + (Calendar.current.isDateInToday(at) ? at.formatted(date: .omitted, time: .shortened) : at.formatted(.dateTime.month(.abbreviated).day()))
    }
}

/// An entry's color and how its links and photos show, from a dot in its color, as the web's style menu.
struct StyleMenu: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        Menu {
            Section("Color") {
                Picker("Color", selection: Binding(get: { card.color.map { $0.rawValue } ?? "" }, set: { v in model.update(card.id) { $0.color = CardColor(rawValue: v) } })) {
                    Image(platform: Swatch.image(nil)).tag("")
                    ForEach(CardColor.allCases, id: \.self) { c in Image(platform: Swatch.image(c)).tag(c.rawValue) }
                }
                .pickerStyle(.palette)
            }
            Picker("Link previews", selection: Binding(get: { card.payload["preview"]?["links"]?.stringValue ?? "" }, set: { setPreview("links", $0) })) {
                Text("As set on this device").tag("")
                Text("Cards").tag("card")
                Text("One line").tag("compact")
                Text("Off").tag("off")
            }
            Picker("Photos", selection: Binding(get: { card.payload["preview"]?["photos"]?.stringValue ?? "" }, set: { setPreview("photos", $0) })) {
                Text("As set on this device").tag("")
                Text("Large").tag("large")
                Text("Thumbnails").tag("thumbs")
                Text("Off").tag("off")
            }
        } label: {
            Circle().fill(card.color.map(Theme.tint) ?? .clear)
                .overlay(Circle().stroke(card.color.map { Theme.tint($0) } ?? Theme.muted, lineWidth: 1.5))
                .frame(width: 18, height: 18)
                .frame(width: 34, height: 32)
        }
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Color and previews")
    }

    private func setPreview(_ key: String, _ value: String) {
        let id = card.id
        model.perform {
            try await $0.update(id) { c in
                var preview = c.payload["preview"]?.objectValue ?? [:]
                if value.isEmpty { preview.removeValue(forKey: key) } else { preview[key] = .string(value) }
                if preview.isEmpty { c.payload.removeValue(forKey: "preview") } else { c.payload["preview"] = .object(preview) }
            }
        }
    }
}

/// The panels an entry's menu opens: its tags, due date, vaults and sharing.
struct EntryPanelView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let panel: EntryPanel

    var body: some View {
        NavigationStack {
            Group {
                switch panel {
                case .tags(let id): TagPicker(id: id)
                case .due(let id): DuePicker(id: id)
                case .vaults(let id): VaultPicker(id: id)
                case .share(let id): SharePanel(id: id)
                case .history(let id): EntryHistory(id: id)
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 380, minHeight: 420)
        #endif
    }
}

/// Picks an entry's tags: those offered in its vault, a group's tags by its rule, and a new one typed in.
struct TagPicker: View {
    @Environment(AppModel.self) private var model
    let id: String
    @State private var query = ""

    var body: some View {
        if let card = model.card(id) {
            let offered = tagsFor(model.index.tags, vaultId: card.vaultId, model.sharedInto)
            let groups = model.index.tagGroups
            let shown = offered.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
            List {
                Section {
                    TextField("Find or make a tag", text: $query)
                        .onSubmit { make(card) }
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty, tagNamed(query, in: offered, vaultId: card.vaultId, model.sharedInto) == nil, !groups.isGroupName(query) {
                        Button("Make “\(query.trimmingCharacters(in: .whitespaces))”") { make(card) }
                    }
                }
                ForEach(groups.groups) { group in
                    let members = group.members.filter { m in shown.contains { $0.id == m.id } }
                    if !members.isEmpty {
                        Section(group.title + (group.choosesOne ? " (one)" : "")) {
                            ForEach(members) { tag in row(tag, card) { tags in group.pick(tags, card.tags.contains(tag.id) && group.choosesOne ? nil : tag.id) } }
                        }
                    }
                }
                Section("Tags") {
                    ForEach(shown.filter { groups.groupOf[$0.id] == nil }) { tag in
                        row(tag, card) { tags in tags.contains(tag.id) ? tags.filter { $0 != tag.id } : tags + [tag.id] }
                    }
                }
            }
            .navigationTitle("Tags")
        }
    }

    private func row(_ tag: Card, _ card: Card, change: @escaping ([String]) -> [String]) -> some View {
        Button {
            let next = change(card.tags)
            model.update(card.id) { $0.tags = next }
        } label: {
            HStack {
                Text(tag.displayTitle)
                Spacer()
                if card.tags.contains(tag.id) { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func make(_ card: Card) {
        let name = query.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard !name.isEmpty else { return }
        if let existing = tagNamed(name, in: model.index.tags, vaultId: card.vaultId, model.sharedInto) {
            let id = card.id
            let groups = model.index.tagGroups
            model.update(id) { $0.tags = groups.with($0.tags, existing.id) }
        } else {
            let id = card.id
            let vault = card.vaultId
            model.perform { repo in
                let group = repo.action()
                let tag = try await repo.createTag(title: name, vaultId: vault, group: group)
                try await repo.update(id, group: group) { $0.tags = $0.tags + [tag.id] }
            }
        }
        query = ""
    }
}

/// A todo's due date, time, start, repeat and Waiting.
struct DuePicker: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        if let card = model.card(id) {
            Form {
                Section {
                    Toggle("Due date", isOn: Binding(get: { card.due != nil }, set: { on in
                        set { c in
                            if on {
                                c.due = model.today
                            } else {
                                // Taking the date off takes the time and repeat with it.
                                c.due = nil
                                c.payload.removeValue(forKey: "dueTime")
                                c.payload.removeValue(forKey: "repeat")
                            }
                        }
                    }))
                    if let due = card.due {
                        DatePicker("Due", selection: Binding(get: { DateKey.date(due) ?? Date() }, set: { d in set { $0.due = DateKey.of(d) } }), displayedComponents: .date)
                        HStack {
                            ForEach([("Today", 0), ("Tomorrow", 1), ("Next week", 7)], id: \.0) { label, days in
                                Button(label) { set { $0.due = DateKey.adding(days, to: model.today) } }.buttonStyle(.bordered)
                            }
                        }
                        Toggle("At a time", isOn: Binding(get: { card.dueTime != nil }, set: { on in set { $0.dueTime = on ? "09:00" : nil } }))
                        if let time = card.dueTime {
                            DatePicker("Time", selection: Binding(get: { Self.date(time) }, set: { d in set { $0.dueTime = TimeKey.of(d) } }), displayedComponents: .hourAndMinute)
                        }
                        Picker("Repeat", selection: Binding(get: { card.repeat }, set: { r in set { $0.repeat = r } })) {
                            Text("Never").tag(Repeat?.none)
                            ForEach(Repeat.choices, id: \.self) { Text($0.label).tag(Optional($0)) }
                            if let r = card.repeat, !Repeat.choices.contains(r) { Text(r.label).tag(Optional(r)) }
                        }
                        Toggle("Starts on a day", isOn: Binding(get: { card.start != nil }, set: { on in set { $0.start = on ? (card.due.map { min($0, model.today) } ?? model.today) : nil } }))
                        if let start = card.start {
                            DatePicker("Start", selection: Binding(get: { DateKey.date(start) ?? Date() }, set: { d in set { $0.start = DateKey.of(d) } }), in: ...(DateKey.date(due) ?? .distantFuture), displayedComponents: .date)
                        }
                    }
                }
                Section {
                    Toggle("Waiting on someone or something", isOn: Binding(get: { card.waiting }, set: { on in set { $0.waiting = on } }))
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Due date")
        }
    }

    static func date(_ time: String) -> Date {
        let p = time.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: p.first ?? 9, minute: p.last ?? 0, second: 0, of: Date()) ?? Date()
    }

    private func set(_ change: @escaping @Sendable (inout Card) -> Void) {
        model.update(id, change)
    }
}

/// Which vaults an entry is in: it lives in one, and can be shared into others.
struct VaultPicker: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        if let card = model.card(id) {
            List {
                Section("Lives in") {
                    ForEach(model.vaults.filter { $0.role != .viewer && !$0.isWithheld }) { vault in
                        Button {
                            let id = card.id
                            let target = vault.id
                            model.perform { try await $0.move(id, toVault: target) }
                        } label: {
                            HStack {
                                Text(vault.name)
                                Spacer()
                                if card.vaultId == vault.id { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(model.lockedVaults.contains(vault.id))
                    }
                }
                if let shared = model.sharedInto[card.id], !shared.isEmpty {
                    Section("Also in") {
                        ForEach(shared, id: \.self) { v in Text(model.vault(v)?.name ?? v) }
                    }
                }
            }
            .navigationTitle("Vaults")
        }
    }
}
