import SwiftUI

/// The keyboard shortcuts, as the web app's `?` list.
struct ShortcutsSheet: View {
    @Environment(\.dismiss) private var dismiss

    static let groups: [(String, [(String, String)])] = [
        ("Anywhere", [("⌘K", "Commands and search"), ("⌘N", "Write a new note"), ("⌘Z  ⇧⌘Z", "Undo or redo the last change"), ("/", "Search the journal in place"), ("?", "These shortcuts")]),
        ("Journal", [
            ("Double-click", "Open an entry to edit it"), ("⌘-click", "Pick or unpick it"), ("↑ ↓", "Move between entries"), ("Home End", "First or last entry"),
            ("⇧↑ ⇧↓", "Pick while moving"), ("Space", "Pick or unpick the entry the keys are on"), ("Return", "Edit it"), ("⌘A", "Pick every entry shown"),
            ("⌘C ⌘X", "Copy or cut the picked entries"), ("Delete", "Move the picked entries to the Trash"), ("Esc", "Stop picking, then leave the entry"),
        ]),
        ("Writing box", [
            ("Return", "Save"), ("⇧Return", "New line"), ("[] or TODO", "Start a todo"), ("#", "Tag"), ("@", "Due date, time (@3pm) or repeat (@weekly)"),
            ("#diary", "File it in the Diary"),
        ]),
        ("An open entry", [("⇧⌘H", "Hide the picked words"), ("Esc", "Close it")]),
        ("Photos full screen", [("← →", "Previous or next photo"), ("Esc", "Close it")]),
    ]

    var body: some View {
        NavigationStack {
            List {
                ForEach(Self.groups, id: \.0) { title, keys in
                    Section(title) {
                        ForEach(keys, id: \.0) { key, what in
                            HStack {
                                Text(key).font(.callout.monospaced()).frame(minWidth: 110, alignment: .leading)
                                Text(what).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Keyboard shortcuts")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 480, minHeight: 520)
        #endif
    }
}
