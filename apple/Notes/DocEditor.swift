import NotesKit
import SwiftUI

/// Edits a card body as rich text. Lists continue when Return is pressed, and end on an empty item.
struct DocEditor: View {
    let editable: Bool
    /// The formatting buttons, under the text, as the web sheet's Aa shows them.
    var tools = false
    var placeholder = ""
    let onSave: (JSONValue) -> Void
    @State private var doc: DocText
    @State private var selection = AttributedTextSelection()
    @State private var pendingSave: Task<Void, Never>?
    /// The text as opened, and the body it reads back as: what was last saved, so a close with no edits saves nothing.
    @State private var loaded: AttributedString
    @State private var saved: JSONValue?
    @Environment(\.fontResolutionContext) private var fontContext

    @State private var showHidden = false

    init(content: JSONValue, editable: Bool, titleOf: @escaping (String, String) -> String, tools: Bool = false, placeholder: String = "", onSave: @escaping (JSONValue) -> Void) {
        self.editable = editable
        self.tools = tools
        self.placeholder = placeholder
        self.onSave = onSave
        var doc = DocText(doc: content, titleOf: titleOf)
        Self.dress(&doc.text, showHidden: false)
        _doc = State(initialValue: doc)
        _loaded = State(initialValue: doc.text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if editable {
                TextEditor(text: $doc.text, selection: $selection)
                    .scrollContentBackground(.hidden)
                    .scrollDisabled(true)
                    .overlay(alignment: .topLeading) {
                        if doc.text.characters.isEmpty && !placeholder.isEmpty {
                            Text(placeholder).foregroundStyle(Theme.muted.opacity(0.7)).padding(.leading, 5).padding(.top, 1).allowsHitTesting(false)
                        }
                    }
                    .onChange(of: doc.text) { old, new in
                        continueList(old: old, new: new)
                        scheduleSave()
                    }
                if tools {
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
                                Self.dress(&doc.text, showHidden: showHidden)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.muted)
                }
            } else {
                Text(doc.text).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .font(DocText.bodyFont)
        .onDisappear { saveNow() }
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
        guard editable, doc.text != loaded || saved != nil else { return }
        let before = saved ?? DocText(text: loaded, stash: doc.stash).doc(in: fontContext)
        let out = doc.doc(in: fontContext)
        saved = out
        if out != before { onSave(out) }
    }

    private static func marker(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        a.font = DocText.bodyFont
        return a
    }

    /// The start of the line holding the cursor.
    private func lineStart(_ text: AttributedString) -> AttributedString.Index? {
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
    private func continueList(old: AttributedString, new: AttributedString) {
        // Found by comparing the texts rather than from the cursor, which can lag behind fast typing.
        let before = Array(old.characters)
        let after = Array(new.characters)
        guard after.count == before.count + 1, doc.text == new else { return }
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
                doc.text.transform(updating: &selection) { text in text.removeSubrange(start..<text.characters.index(after: newline)) }
            } else {
                let next = String(repeating: "  ", count: task.indent) + "☐ "
                doc.text.transform(updating: &selection) { text in text.insert(Self.marker(next), at: cursor) }
            }
            return
        }
        guard let marker = DocText.listMarker(line) else { return }
        let rest = line.dropFirst(marker.length)
        if rest.trimmingCharacters(in: .whitespaces).isEmpty {
            // An empty item: end the list.
            doc.text.transform(updating: &selection) { text in
                text.removeSubrange(start..<text.characters.index(after: newline))
            }
            return
        }
        let indent = String(repeating: "  ", count: marker.indent)
        let next = indent + (marker.ordered ? "\(marker.number + 1). " : "• ")
        doc.text.transform(updating: &selection) { text in
            text.insert(Self.marker(next), at: cursor)
        }
    }

    /// Ticks the checklist item on the cursor's line, or unticks it.
    private func tick() {
        guard let start = lineStart(doc.text) else { return }
        let rest = String(doc.text.characters[start...].prefix { $0 != "\n" })
        guard let task = DocText.taskMarker(rest) else { return }
        let at = doc.text.characters.index(start, offsetBy: task.indent * 2)
        doc.text.transform(updating: &selection) { text in
            let end = text.characters.index(at, offsetBy: 1)
            text.replaceSubrange(at..<end, with: Self.marker(task.checked ? "☐" : "☑"))
        }
    }

    /// Hides the selected words under dots in the bubble, as the web's Hide, or shows them again.
    private func hide() {
        guard case .ranges(let ranges) = selection.indices(in: doc.text) else { return }
        doc.text.transform(updating: &selection) { text in
            for range in ranges.ranges {
                let hidden = text[range].runs.allSatisfy { $0.backgroundColor != nil }
                text[range].backgroundColor = hidden ? nil : DocText.hiddenTint
                if hidden { text[range].foregroundColor = nil }
            }
        }
        Self.dress(&doc.text, showHidden: showHidden)
    }

    /// Adds a block marker to the cursor's line, or removes it if the line already has it.
    private func toggleMarker(_ marker: String) {
        guard let start = lineStart(doc.text) else { return }
        let rest = String(doc.text.characters[start...].prefix { $0 != "\n" })
        let existing = DocText.taskMarker(rest).map { rest.prefix($0.length) } ?? DocText.listMarker(rest).map { rest.prefix($0.length) }
            ?? ["## ", "# ", "### ", "> "].first { rest.hasPrefix($0) }.map { rest.prefix($0.count) }
        doc.text.transform(updating: &selection) { text in
            if let existing {
                let end = text.characters.index(start, offsetBy: existing.count)
                text.removeSubrange(start..<end)
                if existing == marker || (DocText.listMarker(String(existing)) != nil && DocText.listMarker(marker) != nil && DocText.listMarker(String(existing))!.ordered == DocText.listMarker(marker)!.ordered) { return }
            }
            text.insert(Self.marker(marker), at: start)
        }
        Self.dress(&doc.text, showHidden: showHidden)
    }
}
