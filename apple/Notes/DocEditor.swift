import NotesKit
import SwiftUI

/// Edits a card body as rich text. Lists continue when Return is pressed, and end on an empty item.
struct DocEditor: View {
    let editable: Bool
    let onSave: (JSONValue) -> Void
    @State private var doc: DocText
    @State private var selection = AttributedTextSelection()
    @State private var pendingSave: Task<Void, Never>?
    @Environment(\.fontResolutionContext) private var fontContext

    init(content: JSONValue, editable: Bool, titleOf: @escaping (String, String) -> String, onSave: @escaping (JSONValue) -> Void) {
        self.editable = editable
        self.onSave = onSave
        _doc = State(initialValue: DocText(doc: content, titleOf: titleOf))
    }

    var body: some View {
        Group {
            if editable {
                TextEditor(text: $doc.text, selection: $selection)
                    .scrollContentBackground(.hidden)
                    .onChange(of: doc.text) { old, new in
                        continueList(old: old, new: new)
                        scheduleSave()
                    }
                    .toolbar {
                        ToolbarItemGroup(placement: .secondaryAction) {
                            Button { toggleMarker("• ") } label: { Label("Bulleted list", systemImage: "list.bullet") }
                            Button { toggleMarker("1. ") } label: { Label("Numbered list", systemImage: "list.number") }
                            Button { toggleMarker("## ") } label: { Label("Heading", systemImage: "textformat.size") }
                            Button { toggleMarker("> ") } label: { Label("Quote", systemImage: "text.quote") }
                        }
                    }
            } else {
                ScrollView {
                    Text(doc.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .font(DocText.bodyFont)
        .onDisappear { saveNow() }
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
        onSave(doc.doc(in: fontContext))
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

    /// Adds a block marker to the cursor's line, or removes it if the line already has it.
    private func toggleMarker(_ marker: String) {
        guard let start = lineStart(doc.text) else { return }
        let rest = String(doc.text.characters[start...].prefix { $0 != "\n" })
        let existing = DocText.listMarker(rest).map { rest.prefix($0.length) }
            ?? ["## ", "# ", "### ", "> "].first { rest.hasPrefix($0) }.map { rest.prefix($0.count) }
        doc.text.transform(updating: &selection) { text in
            if let existing {
                let end = text.characters.index(start, offsetBy: existing.count)
                text.removeSubrange(start..<end)
                if existing == marker || (DocText.listMarker(String(existing)) != nil && DocText.listMarker(marker) != nil && DocText.listMarker(String(existing))!.ordered == DocText.listMarker(marker)!.ordered) { return }
            }
            text.insert(Self.marker(marker), at: start)
        }
    }
}
