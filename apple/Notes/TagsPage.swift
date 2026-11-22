import NotesKit
import SwiftUI

/// Every tag, as the web app's Tags page: groups first, like Priority (one per entry, in order) or Topics (any
/// number), each renamed, set to one or any number, ordered, its tags moved up and down; then tags in no group. A tag
/// is renamed in place, pinned to the sidebar, kept to one or more vaults or offered in all, and moved to the Trash.
struct TagsPage: View {
    @Environment(AppModel.self) private var model
    @State private var newGroup = ""
    @State private var newTag = ""
    /// The vault a new tag is kept to; nil until picked, meaning the account's own. "" is all vaults.
    @State private var pickedVault: String?
    private var newTagVault: String { pickedVault ?? model.mainVault?.id ?? "" }

    var body: some View {
        let groups = model.index.tagGroups
        Form {
            Section("New") {
                HStack {
                    TextField("New group, like Topics or Area", text: $newGroup).onSubmit(makeGroup)
                    Button("Add group", action: makeGroup).disabled(newGroup.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                HStack {
                    TextField("New tag", text: $newTag).onSubmit(makeTag)
                    Picker("Kept to", selection: Binding(get: { newTagVault }, set: { pickedVault = $0 })) {
                        ForEach(TagEdits.homes(model)) { Text($0.name).tag($0.id) }
                        Text("All vaults").tag("")
                    }
                    .labelsHidden().fixedSize()
                    Button("Add tag", action: makeTag).disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            ForEach(groups.groups) { group in GroupBlock(group: group) }
            Section("Tags") {
                ForEach(groups.loose) { TagRow(tag: $0) }
                if groups.loose.isEmpty { Text("No tags outside the groups.").foregroundStyle(Theme.muted) }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Tags")
    }

    private func makeGroup() {
        let title = newGroup.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty else { return }
        if model.index.tagGroups.isGroupName(title) || model.index.tags.contains(where: { $0.title.lowercased() == title.lowercased() }) {
            model.say("There's a \(title) already.")
            return
        }
        newGroup = ""
        model.perform { try await $0.createTag(title: title, members: [], choosesOne: false, ordered: false) }
    }

    private func makeTag() {
        let title = newTag.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard !title.isEmpty else { return }
        let vault = newTagVault.isEmpty ? nil : newTagVault
        if tagNamed(title, in: model.index.tags, vaultId: vault ?? model.mainVault?.id, model.sharedInto) != nil {
            model.say("There's a \(title) tag already.")
            return
        }
        newTag = ""
        model.perform { try await $0.createTag(title: title, vaultId: vault) }
    }
}

enum TagEdits {
    /// The vaults a tag can be kept to: open here, not withheld, and changeable.
    @MainActor static func homes(_ model: AppModel) -> [Vault] {
        model.vaults.filter { !model.lockedVaults.contains($0.id) && !$0.isWithheld && $0.role != .viewer }
    }

    /// Sets the vaults a tag is offered in (nil: every vault): it lives in one of them and is in the others besides,
    /// as an entry can be, so their members see it. Being in another vault needs a connection.
    @MainActor static func setVaults(_ tag: Card, _ next: [String]?, model: AppModel) {
        let shared = model.sharedInto[tag.id] ?? []
        let home = next.map { $0.contains(tag.vaultId) ? tag.vaultId : $0[0] }
        let besides = next.map { n in n.filter { $0 != home } } ?? []
        let api = model.api
        Task {
            do {
                for v in shared where !besides.contains(v) { _ = try await api.unshare(tag.id, type: "vault", target: v) }
                try await model.repo.setTagScope(tag.id, vaultId: home)
                if besides.contains(where: { !shared.contains($0) }) {
                    // The server must have it where it now lives before it can be in other vaults besides.
                    await model.sync?.sync()
                    for v in besides where !shared.contains(v) { _ = try await api.share(tag.id, vaultId: v, role: .edit) }
                }
                await model.sync?.sync()
                let names = next.map { $0.compactMap { model.vault($0)?.name }.joined(separator: ", ") } ?? "all vaults"
                model.say("\(tag.title) is offered in \(names)")
            } catch {
                model.say(error as? APIError == .offline ? "Offering a tag in more than one vault needs a connection." : "That didn't work. A new tag can go in more vaults once it has synced.")
            }
        }
    }
}

/// A tag's row: its name, leading to its entries, with a rename in place, its vaults, pinning and the Trash.
struct TagRow: View {
    @Environment(AppModel.self) private var model
    let tag: Card
    var group: TagGroup? = nil
    var rank: Int? = nil
    @State private var editing: String?

    var body: some View {
        let count = model.index.backlinks[tag.id]?.filter { $0.kind == .tag }.count ?? 0
        let vaults = tag.tagVaults(model.sharedInto)
        HStack(spacing: 8) {
            if let rank { Text("\(rank)").font(.caption.monospacedDigit()).foregroundStyle(Theme.muted) }
            if let editing {
                TextField("Name", text: Binding(get: { editing }, set: { self.editing = $0 }))
                    .onSubmit { rename(editing) }
                    .onKeyPress(.escape) {
                        self.editing = nil
                        return .handled
                    }
            } else {
                Button { model.page = .journal(StreamFilter(tagId: tag.id)) } label: {
                    HStack {
                        Label(tag.displayTitle, systemImage: tag.pinned ? "pin" : "tag")
                        Text("\(count)").foregroundStyle(Theme.muted).monospacedDigit()
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer()
            Menu {
                if !tag.keptToVault || vaults == nil {
                    Button("All vaults ✓") {}
                } else {
                    Button("All vaults") { TagEdits.setVaults(tag, nil, model: model) }
                }
                Divider()
                ForEach(TagEdits.homes(model)) { v in
                    let on = vaults?.contains(v.id) ?? false
                    Button((on ? "✓ " : "") + v.name) {
                        var next = vaults ?? []
                        if on { next.removeAll { $0 == v.id } } else if v.isPrivate && !(next.isEmpty) {
                            model.say("\(v.name) keeps its tags to itself: it's locked by a PIN.")
                            return
                        } else {
                            next.append(v.id)
                        }
                        TagEdits.setVaults(tag, next.isEmpty ? nil : next, model: model)
                    }
                }
            } label: {
                Text(vaults?.compactMap { model.vault($0)?.name }.joined(separator: ", ") ?? "All vaults").font(.caption)
            }
            .menuStyle(.button).fixedSize()
            if let group {
                Button { move(group, -1) } label: { Image(systemName: "chevron.up") }.disabled(group.members.first?.id == tag.id)
                Button { move(group, 1) } label: { Image(systemName: "chevron.down") }.disabled(group.members.last?.id == tag.id)
                Button { takeOut(group) } label: { Image(systemName: "minus.circle") }.help("Take out of the group (the tag stays)")
            }
            Button { editing = tag.title } label: { Image(systemName: "pencil") }.help("Rename")
            Button {
                let id = tag.id
                let on = !tag.pinned
                model.perform { try await $0.update(id) { $0.payload["pinned"] = .bool(on) } }
            } label: { Image(systemName: tag.pinned ? "pin.slash" : "pin") }.help(tag.pinned ? "Unpin from the sidebar" : "Pin to the sidebar")
            if model.canManage(tag) {
                Button(role: .destructive) { trash(count) } label: { Image(systemName: "trash") }.help("Move to Trash")
            }
        }
        .buttonStyle(.borderless)
    }

    /// Entries hold the tag itself, not its name, so they all follow. A name another tag has where this one can go,
    /// or a group's, is refused.
    private func rename(_ text: String) {
        editing = nil
        let name = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard !name.isEmpty, name != tag.title else { return }
        let places = tag.tagVaults(model.sharedInto) ?? model.vaults.map(\.id)
        if let other = model.index.tags.first(where: { t in t.id != tag.id && t.title.lowercased() == name.lowercased() && places.contains { v in t.offered(in: v, model.sharedInto) } }) {
            model.say("There's a \(other.title) tag already.")
            return
        }
        if model.index.tagGroups.isGroupName(name) {
            model.say("\(name) is a group's name.")
            return
        }
        let id = tag.id
        let old = tag.title
        model.perform { try await $0.update(id) { $0.title = name } }
        model.say("Renamed \(old) to \(name)", undoable: true)
    }

    private func trash(_ count: Int) {
        let id = tag.id
        model.perform { try await $0.setDeleted(id, true) }
        model.say("Moved \(tag.title) to Trash" + (count > 0 ? ", off \(count) \(count == 1 ? "entry" : "entries")" : ""), undoable: true)
    }

    private func move(_ group: TagGroup, _ by: Int) {
        let next = moveMember(group.members.map(\.id), tag.id, by: by)
        model.perform { try await $0.update(group.id) { $0.payload["members"] = .array(next.map(JSONValue.string)) } }
    }

    private func takeOut(_ group: TagGroup) {
        let next = group.members.map(\.id).filter { $0 != tag.id }
        model.perform { try await $0.update(group.id) { $0.payload["members"] = .array(next.map(JSONValue.string)) } }
    }
}

/// A tag group: its name, its rule (one per entry or any number), whether it's ordered, its tags, and adding one.
struct GroupBlock: View {
    @Environment(AppModel.self) private var model
    let group: TagGroup
    @State private var name = ""
    @State private var adding = ""

    var body: some View {
        Section {
            HStack {
                TextField("Group name", text: $name).font(.headline).onSubmit(rename)
                Button(role: .destructive) {
                    let id = group.id
                    model.perform { try await $0.setDeleted(id, true) }
                    model.say("Removed the \(group.title) group. Its tags stay on entries.", undoable: true)
                } label: { Image(systemName: "trash") }
                .buttonStyle(.borderless).help("Remove group (its tags stay)")
            }
            Picker("Per entry", selection: Binding(get: { group.choosesOne }, set: { one in set("choice", one ? "one" : "many") })) {
                Text("One per entry").tag(true)
                Text("Any number").tag(false)
            }
            .pickerStyle(.segmented)
            Toggle("Ordered, to sort the journal by it", isOn: Binding(get: { group.ordered }, set: { set("ordered", .bool($0)) }))
            ForEach(Array(group.members.enumerated()), id: \.element.id) { i, tag in
                TagRow(tag: tag, group: group, rank: group.ordered ? i + 1 : nil)
            }
            HStack {
                TextField("Add a tag to \(group.title)", text: $adding).onSubmit(add)
                let q = adding.trimmingCharacters(in: .whitespaces).lowercased()
                if !q.isEmpty {
                    Menu("Pick") {
                        ForEach(model.index.tags.filter { t in t.title.lowercased().contains(q) && !group.members.contains(where: { m in m.id == t.id }) }.prefix(8)) { t in
                            Button(t.title + (model.index.tagGroups.groupOf[t.id].map { " (from \($0.title))" } ?? "")) { addTag(t.id) }
                        }
                    }
                    .fixedSize()
                }
            }
        }
        .onAppear { name = group.title }
    }

    private func set(_ key: String, _ value: JSONValue) {
        let id = group.id
        model.perform { try await $0.update(id) { $0.payload[key] = value } }
    }

    private func rename() {
        let text = name.trimmingCharacters(in: .whitespaces)
        if text.isEmpty || text == group.title { name = group.title } else { set("title", .string(text)) }
    }

    private func add() {
        let q = adding.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard !q.isEmpty else { return }
        if let found = model.index.tags.first(where: { $0.title.lowercased() == q.lowercased() }) {
            addTag(found.id)
        } else {
            let group = group
            model.perform { repo in
                let action = repo.action()
                let tag = try await repo.createTag(title: q, group: action)
                try await repo.update(group.id, group: action) { $0.payload["members"] = .array((group.members.map(\.id) + [tag.id]).map(JSONValue.string)) }
            }
        }
        adding = ""
    }

    /// Adds a tag to this group; it leaves any other group it was in.
    private func addTag(_ tagId: String) {
        let groupCards = model.index.live.filter(\.isGroup)
        let group = group
        model.perform { repo in
            let action = repo.action()
            for other in groupCards where other.id != group.id && (other.members ?? []).contains(tagId) {
                try await repo.update(other.id, group: action) { $0.payload["members"] = .array((other.members ?? []).filter { $0 != tagId }.map(JSONValue.string)) }
            }
            try await repo.update(group.id, group: action) { $0.payload["members"] = .array((group.members.map(\.id).filter { $0 != tagId } + [tagId]).map(JSONValue.string)) }
        }
        adding = ""
    }
}
