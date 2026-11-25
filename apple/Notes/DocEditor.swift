import NotesKit
import SwiftUI

/// Edits a card body as rich text. Lists continue when Return is pressed, and end on an empty item. With the entry
/// it's in (`card`), its photos, videos, voice messages and files show where they are in the text, as the web's editor
/// shows them, each with its menu (and Remove, where it can be changed), the text around them edited as before;
/// without it they're named in the text ([Photo], [File: name]).
struct DocEditor: View {
    let editable: Bool
    /// The formatting buttons, under the text, as the web sheet's Aa shows them.
    var tools = false
    var placeholder = ""
    var card: Card? = nil
    let content: JSONValue
    let titleOf: (String, String) -> String
    let onSave: (JSONValue) -> Void
    /// The page, as stretches of text and the attachments between them.
    @State private var parts: [DocPart]
    @State private var pendingSave: Task<Void, Never>?
    /// What the page reads back as when last saved (or as opened), so a close with no edits saves nothing.
    @State private var saved: JSONValue?
    @FocusState private var focus: UUID?
    /// The stretch of text the formatting buttons act on: the one last typed in.
    @State private var current: UUID?
    @Environment(\.fontResolutionContext) private var fontContext
    @Environment(AppModel.self) private var model

    @State private var showHidden = false

    init(content: JSONValue, editable: Bool, titleOf: @escaping (String, String) -> String, tools: Bool = false, placeholder: String = "", card: Card? = nil, onSave: @escaping (JSONValue) -> Void) {
        self.editable = editable
        self.tools = tools
        self.placeholder = placeholder
        self.card = card
        self.content = content
        self.titleOf = titleOf
        self.onSave = onSave
        _parts = State(initialValue: DocPart.split(content, inline: card != nil, titleOf: titleOf, showHidden: false))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach($parts) { $part in
                if let node = part.node, let card {
                    InlineAttachment(node: node, card: card, media: Doc.media(content), remove: editable ? { remove(part.id) } : nil)
                } else if editable {
                    TextEditor(text: $part.doc.text, selection: $part.selection)
                        .scrollContentBackground(.hidden)
                        .scrollDisabled(true)
                        .focused($focus, equals: part.id)
                        .overlay(alignment: .topLeading) {
                            if parts.count == 1 && part.doc.text.characters.isEmpty && !placeholder.isEmpty {
                                Text(placeholder).foregroundStyle(Theme.muted.opacity(0.7)).padding(.leading, 5).padding(.top, 1).allowsHitTesting(false)
                            }
                        }
                        .onChange(of: part.doc.text) { old, new in
                            current = part.id
                            continueList(part.id, old: old, new: new)
                            scheduleSave()
                        }
                } else if !(parts.count > 1 && part.doc.text.characters.isEmpty) {
                    Text(part.doc.text).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if editable && tools {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        tool("checklist", "Checklist") { toggleMarker("☐ ") }
                        tool("checkmark.square", "Tick") { tick() }
                        tool("list.bullet", "Bulleted list") { toggleMarker("• ") }
                        tool("list.number", "Numbered list") { toggleMarker("1. ") }
                        tool("textformat.size", "Heading") { toggleMarker("## ") }
                        tool("text.quote", "Quote") { toggleMarker("> ") }
                        tool("eye.slash", "Hide the selected words") { hide() }
                            .keyboardShortcut("h", modifiers: [.command, .shift])
                        tool(showHidden ? "eye" : "eye.circle", showHidden ? "Cover hidden words" : "Show hidden words") {
                            showHidden.toggle()
                            for i in parts.indices where parts[i].node == nil { Self.dress(&parts[i].doc.text, showHidden: showHidden) }
                        }
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.muted)
            }
        }
        .font(DocText.bodyFont)
        .onChange(of: focus) { _, id in if let id { current = id } }
        // Changed elsewhere while open, as a voice message's transcript is written in: the attachments take it.
        .onChange(of: content) { _, new in refresh(from: new) }
        .onAppear { if saved == nil { saved = output() } }
        .onDisappear { saveNow() }
    }

    /// The page as it reads back: each stretch of text, and the attachments between them. A stretch left empty beside
    /// an attachment adds nothing.
    private func output() -> JSONValue {
        guard parts.count > 1 else { return parts.first?.doc.doc(in: fontContext) ?? Doc.empty }
        var out: [JSONValue] = []
        for part in parts {
            if let node = part.node { out.append(node); continue }
            let blocks = part.doc.doc(in: fontContext)["content"]?.arrayValue ?? []
            if blocks != [["type": "paragraph"]] { out += blocks }
        }
        return ["type": "doc", "content": .array(out.isEmpty ? [["type": "paragraph"]] : out)]
    }

    /// Takes an attachment out of the page, joining the text around it.
    private func remove(_ id: UUID) {
        guard let i = parts.firstIndex(where: { $0.id == id }) else { return }
        parts.remove(at: i)
        let joined = output()
        parts = DocPart.split(joined, inline: card != nil, titleOf: titleOf, showHidden: showHidden)
        saveNow()
    }

    /// Takes in attachments changed elsewhere, by their IDs, leaving the text as it is.
    private func refresh(from content: JSONValue) {
        var latest: [String: JSONValue] = [:]
        for node in content["content"]?.arrayValue ?? [] {
            if let id = node["attrs"]?["id"]?.stringValue { latest[id] = node }
        }
        let unchanged = saved == output()
        for i in parts.indices {
            guard let node = parts[i].node, let id = node["attrs"]?["id"]?.stringValue, let now = latest[id], now != node else { continue }
            parts[i].node = now
        }
        if unchanged { saved = output() }
    }

    /// Edits the stretch of text with this ID, keeping its selection with the change.
    private func edit(_ id: UUID?, _ change: (inout AttributedString, inout AttributedTextSelection) -> Void) {
        guard let i = parts.firstIndex(where: { $0.id == id }) ?? parts.lastIndex(where: { $0.node == nil }) else { return }
        var text = parts[i].doc.text
        var selection = parts[i].selection
        change(&text, &selection)
        parts[i].doc.text = text
        parts[i].selection = selection
    }

    private func tool(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).frame(width: 34, height: 30).background(RoundedRectangle(cornerRadius: 7).fill(Theme.sunken)).contentShape(Rectangle())
        }
        .help(label)
        .accessibilityLabel(label)
    }

    /// How the text looks, as the web editor shows it, without changing what it reads back as: a heading's # marks
    /// drawn as nothing (the space after them keeps the heading's size for what's typed there), a ticked box in the
    /// accent, and hidden words covered unless shown.
    static func dress(_ text: inout AttributedString, showHidden: Bool) {
        var start = text.startIndex
        while start < text.endIndex {
            var end = start
            while end < text.endIndex, text.characters[end] != "\n" { end = text.characters.index(after: end) }
            let line = String(text.characters[start..<end])
            let hashes = line.prefix { $0 == "#" }.count
            if (1...3).contains(hashes), line.dropFirst(hashes).hasPrefix(" ") {
                let marks = start..<text.characters.index(start, offsetBy: hashes)
                text[marks].font = .system(size: 1)
                text[marks].foregroundColor = .clear
            }
            if let task = DocText.taskMarker(line), task.checked {
                let box = text.characters.index(start, offsetBy: task.indent * 2)
                text[box..<text.characters.index(after: box)].foregroundColor = Theme.accent
            }
            start = end < text.endIndex ? text.characters.index(after: end) : end
        }
        for run in text.runs where run.backgroundColor != nil {
            text[run.range].foregroundColor = showHidden ? nil : .clear
            text[run.range].backgroundColor = showHidden ? DocText.hiddenTint : Theme.muted.opacity(0.55)
        }
    }

    private func scheduleSave() {
        pendingSave?.cancel()
        pendingSave = Task {
            try? await Task.sleep(for: .milliseconds(400))
            if !Task.isCancelled { saveNow() }
        }
    }

    private func saveNow() {
        pendingSave?.cancel()
        pendingSave = nil
        guard editable else { return }
        let out = output()
        guard out != saved else { return }
        saved = out
        onSave(out)
    }

    private static func marker(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        a.font = DocText.bodyFont
        return a
    }

    /// The start of the line holding the cursor.
    private static func lineStart(_ text: AttributedString, _ selection: AttributedTextSelection) -> AttributedString.Index? {
        let cursor: AttributedString.Index
        switch selection.indices(in: text) {
        case .insertionPoint(let i): cursor = i
        case .ranges(let ranges): guard let first = ranges.ranges.first else { return nil }; cursor = first.lowerBound
        }
        var i = cursor
        while i > text.startIndex {
            let before = text.characters.index(before: i)
            if text.characters[before] == "\n" { break }
            i = before
        }
        return i
    }

    /// After Return on a list item, starts the next item, or ends the list if the item was empty.
    private func continueList(_ id: UUID, old: AttributedString, new: AttributedString) {
        // Found by comparing the texts rather than from the cursor, which can lag behind fast typing.
        let before = Array(old.characters)
        let after = Array(new.characters)
        guard after.count == before.count + 1, parts.first(where: { $0.id == id })?.doc.text == new else { return }
        var offset = 0
        while offset < before.count && before[offset] == after[offset] { offset += 1 }
        guard after[offset] == "\n" else { return }
        let newline = new.characters.index(new.startIndex, offsetBy: offset)
        let cursor = new.characters.index(after: newline)
        // The line that Return was pressed on.
        var start = newline
        while start > new.startIndex, new.characters[new.characters.index(before: start)] != "\n" {
            start = new.characters.index(before: start)
        }
        let line = String(new.characters[start..<newline])
        if let task = DocText.taskMarker(line) {
            // A checklist goes on with a new box, or ends on an empty one.
            if line.dropFirst(task.length).trimmingCharacters(in: .whitespaces).isEmpty {
                edit(id) { t, sel in t.transform(updating: &sel) { text in text.removeSubrange(start..<text.characters.index(after: newline)) } }
            } else {
                let next = String(repeating: "  ", count: task.indent) + "☐ "
                edit(id) { t, sel in t.transform(updating: &sel) { text in text.insert(Self.marker(next), at: cursor) } }
            }
            return
        }
        guard let marker = DocText.listMarker(line) else { return }
        let rest = line.dropFirst(marker.length)
        if rest.trimmingCharacters(in: .whitespaces).isEmpty {
            // An empty item: end the list.
            edit(id) { t, sel in t.transform(updating: &sel) { text in text.removeSubrange(start..<text.characters.index(after: newline)) } }
            return
        }
        let indent = String(repeating: "  ", count: marker.indent)
        let next = indent + (marker.ordered ? "\(marker.number + 1). " : "• ")
        edit(id) { t, sel in t.transform(updating: &sel) { text in text.insert(Self.marker(next), at: cursor) } }
    }

    /// Ticks the checklist item on the cursor's line, or unticks it.
    private func tick() {
        edit(current) { t, sel in
            guard let start = Self.lineStart(t, sel) else { return }
            let rest = String(t.characters[start...].prefix { $0 != "\n" })
            guard let task = DocText.taskMarker(rest) else { return }
            let at = t.characters.index(start, offsetBy: task.indent * 2)
            t.transform(updating: &sel) { text in
                let end = text.characters.index(at, offsetBy: 1)
                text.replaceSubrange(at..<end, with: Self.marker(task.checked ? "☐" : "☑"))
            }
        }
    }

    /// Hides the selected words under dots in the bubble, as the web's Hide, or shows them again.
    private func hide() {
        let shown = showHidden
        edit(current) { t, sel in
            guard case .ranges(let ranges) = sel.indices(in: t) else { return }
            t.transform(updating: &sel) { text in
                for range in ranges.ranges {
                    let hidden = text[range].runs.allSatisfy { $0.backgroundColor != nil }
                    text[range].backgroundColor = hidden ? nil : DocText.hiddenTint
                    if hidden { text[range].foregroundColor = nil }
                }
            }
            Self.dress(&t, showHidden: shown)
        }
    }

    /// Adds a block marker to the cursor's line, or removes it if the line already has it.
    private func toggleMarker(_ marker: String) {
        let shown = showHidden
        edit(current) { t, sel in
            guard let start = Self.lineStart(t, sel) else { return }
            let rest = String(t.characters[start...].prefix { $0 != "\n" })
            let existing = DocText.taskMarker(rest).map { rest.prefix($0.length) } ?? DocText.listMarker(rest).map { rest.prefix($0.length) }
                ?? ["## ", "# ", "### ", "> "].first { rest.hasPrefix($0) }.map { rest.prefix($0.count) }
            t.transform(updating: &sel) { text in
                if let existing {
                    let end = text.characters.index(start, offsetBy: existing.count)
                    text.removeSubrange(start..<end)
                    if existing == marker || (DocText.listMarker(String(existing)) != nil && DocText.listMarker(marker) != nil && DocText.listMarker(String(existing))!.ordered == DocText.listMarker(marker)!.ordered) { return }
                }
                text.insert(Self.marker(marker), at: start)
            }
            Self.dress(&t, showHidden: shown)
        }
    }
}

/// A stretch of a page's text, or an attachment between two (a photo or a file).
struct DocPart: Identifiable {
    let id = UUID()
    var node: JSONValue?
    var doc = DocText(text: AttributedString(), stash: [:])
    var selection = AttributedTextSelection()

    /// Whether a page's block shows as itself rather than in the text: a photo, a video, a voice message or a file.
    static func isAttachment(_ node: JSONValue) -> Bool { ["photo", "file"].contains(node["type"]?.stringValue ?? "") }

    /// A page as stretches of text and the attachments between them, with text last, to write after them; with
    /// `inline` off, all of it as text.
    static func split(_ content: JSONValue, inline: Bool, titleOf: @escaping (String, String) -> String, showHidden: Bool) -> [DocPart] {
        func text(_ blocks: [JSONValue]) -> DocPart {
            var doc = DocText(doc: ["type": "doc", "content": .array(blocks)], titleOf: titleOf)
            DocEditor.dress(&doc.text, showHidden: showHidden)
            return DocPart(doc: doc)
        }
        let blocks = content["content"]?.arrayValue ?? []
        guard inline, blocks.contains(where: isAttachment) else {
            var doc = DocText(doc: content, titleOf: titleOf)
            DocEditor.dress(&doc.text, showHidden: showHidden)
            return [DocPart(doc: doc)]
        }
        var parts: [DocPart] = []
        var run: [JSONValue] = []
        for block in blocks {
            if isAttachment(block) {
                if !run.isEmpty { parts.append(text(run)); run = [] }
                parts.append(DocPart(node: block))
            } else {
                run.append(block)
            }
        }
        parts.append(text(run))
        return parts
    }
}

/// A photo, a video, a voice message or a file where it is in an open entry's text, as the web's editor shows it: a
/// photo or a video whole, opening full screen; a voice message's player; a file's chip. Its menu has Remove where the
/// entry can be changed.
struct InlineAttachment: View {
    @Environment(AppModel.self) private var model
    let node: JSONValue
    let card: Card
    /// Every photo and video on the page, to page through full screen.
    let media: [Doc.Media]
    let remove: (() -> Void)?

    var body: some View {
        let one: JSONValue = ["type": "doc", "content": [node]]
        Group {
            if let m = Doc.media(one).first {
                ShapedThumb(media: m, vaultId: card.vaultId, alone: true)
                    .onTapGesture { model.viewer = ViewerRequest(media: media, start: m.id, vaultId: card.vaultId) }
                    .contextMenu {
                        PhotoMenu(id: m.id, card: card)
                        PublicLinkMenu(id: m.id, vaultId: card.vaultId)
                        removeItem
                    }
            } else if let file = Doc.files(one).first {
                Group {
                    if file.isAudio { VoicePlayer(file: file, vaultId: card.vaultId, card: card) } else { FileChip(file: file, vaultId: card.vaultId) }
                }
                .contextMenu {
                    PublicLinkMenu(id: file.id, vaultId: card.vaultId)
                    removeItem
                }
            }
        }
        .frame(maxWidth: 560, alignment: .leading)
    }

    @ViewBuilder private var removeItem: some View {
        if let remove {
            Divider()
            Button("Remove from the entry", role: .destructive, action: remove)
        }
    }
}
