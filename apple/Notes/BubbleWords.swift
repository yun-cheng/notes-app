import Foundation
import NotesKit
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Google, for words picked out of an entry, as the web's `googleSearchUrl` and `googleTranslateUrl`: both send the
/// words there.
enum GoogleLinks {
    static func search(_ words: String) -> URL? {
        let text = String(words.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        return URL(string: "https://www.google.com/search?q=" + escape(text))
    }

    /// Into the device's language (Traditional Chinese as zh-TW); long text cut to what an address can carry.
    static func translate(_ words: String, to language: String = deviceLanguage) -> URL? {
        URL(string: "https://translate.google.com/?sl=auto&tl=\(escape(language))&op=translate&text=" + escape(String(words.prefix(4000))))
    }

    static var deviceLanguage: String {
        let lower = (Locale.preferredLanguages.first ?? "en").lowercased()
        if lower.wholeMatch(of: /zh-(tw|hk|mo|hant).*/) != nil { return "zh-TW" }
        return lower.split(separator: "-").first.map(String.init) ?? "en"
    }

    /// As `encodeURIComponent`.
    private static func escape(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")) ?? ""
    }

    /// Words shown in a menu item, as the web's `quoted`: the start of them, in quotes.
    static func quoted(_ words: String) -> String {
        let line = words.replacing(/\s+/, with: " ")
        return "“" + (line.count > 24 ? String(line.prefix(23)).trimmingCharacters(in: .whitespaces) + "…" : line) + "”"
    }
}

#if os(macOS)
/// What a bubble's words need to know of it: its entry, for their menu, and whether entries are being picked, when a
/// click on them picks rather than selects.
struct BubbleClicks {
    let card: Card
    var picking: Bool
}

extension EnvironmentValues {
    @Entry var bubbleClicks: BubbleClicks? = nil
    /// Gives the keys back to the journal, after a click in a bubble's words took them.
    @Entry var refocusJournal: (() -> Void)? = nil
}

/// A bubble's words on a Mac, as on the web: a drag selects them, a double-click opens the entry, and a right-click on
/// selected words offers Copy, New note from selection, Search Google and Translate with Google (Shift with it gives
/// the Mac's own text menu); a right-click with none selected is the entry's menu. A click picks while picking, as do
/// Cmd-click and Shift-click at any time.
struct BubbleWords: NSViewRepresentable {
    @Environment(AppModel.self) private var model
    @Environment(\.bubbleClicks) private var clicks
    @Environment(\.refocusJournal) private var refocus
    let text: AttributedString
    let toggleHidden: (Int) -> Void

    func makeNSView(context: Context) -> WordsView {
        let view = WordsView(usingTextLayoutManager: false)
        view.isEditable = false
        view.isSelectable = true
        view.isRichText = true
        view.drawsBackground = false
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isVerticallyResizable = false
        view.isHorizontallyResizable = false
        view.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        view.delegate = view
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateNSView(_ view: WordsView, context: Context) {
        let words = Self.appKit(text)
        if view.textStorage?.isEqual(to: words) == false { view.textStorage?.setAttributedString(words) }
        view.model = model
        view.clicks = clicks
        view.refocus = refocus
        view.toggleHidden = toggleHidden
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: WordsView, context: Context) -> CGSize? {
        let limit = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? .greatestFiniteMagnitude
        // From the text as it is now, which the view may not have been given yet.
        let words = Self.appKit(text)
        let used = words.boundingRect(with: NSSize(width: limit, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading])
        let line = NSLayoutManager().defaultLineHeight(for: Self.body)
        return CGSize(width: min(limit, ceil(used.width) + 1), height: max(line, ceil(used.height)))
    }

    static let body = NSFont.systemFont(ofSize: 14)
    static let code = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)

    /// `BubbleText.attributed`'s text in AppKit's terms: its code font, colors, links and underlines.
    static func appKit(_ text: AttributedString) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for run in text.runs {
            var attributes: [NSAttributedString.Key: Any] = [
                .font: run[AttributeScopes.SwiftUIAttributes.FontAttribute.self] == nil ? body : code,
                .foregroundColor: NSColor(run[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] ?? Theme.text),
            ]
            if let background = run[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] { attributes[.backgroundColor] = NSColor(background) }
            if let link = run.link { attributes[.link] = link }
            if run[AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute.self] != nil { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
            out.append(NSAttributedString(string: String(text[run.range].characters), attributes: attributes))
        }
        return out
    }
}

final class WordsView: NSTextView, NSTextViewDelegate {
    var model: AppModel?
    var clicks: BubbleClicks?
    var refocus: (() -> Void)?
    var toggleHidden: (Int) -> Void = { _ in }

    private var selected: String {
        let range = selectedRange()
        return range.length > 0 ? (string as NSString).substring(with: range) : ""
    }

    override func mouseDown(with event: NSEvent) {
        let keys = event.modifierFlags.intersection([.command, .shift, .option, .control])
        // Left to the bubble's own clicks, which see the mouse too: the second press of a double-click opens it, as on
        // the web (the first has left the words to select), and a click picks while picking, as do Cmd and Shift.
        if let clicks, clicks.picking || !keys.isDisjoint(with: [.command, .shift]) || (event.clickCount >= 2 && keys.isEmpty) { return }
        super.mouseDown(with: event)
        // Selecting took the mouse until the button came up, so the journal's gestures (a box to pick with, a click on
        // empty space) never saw it come up, and would go on as if it were still down: they're shown it now.
        if let window, let up = NSEvent.mouseEvent(
            with: .leftMouseUp, location: window.mouseLocationOutsideOfEventStream, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: event.clickCount, pressure: 0)
        { window.sendEvent(up) }
    }

    override func rightMouseDown(with event: NSEvent) {
        if selectedRange().length > 0 || clicks == nil { super.rightMouseDown(with: event) }
        // No words selected: the entry's own menu, from the bubble around them.
        else { nextResponder?.rightMouseDown(with: event) }
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let words = selected
        guard !words.isEmpty, let model, let card = clicks?.card else { return super.menu(for: event) }
        if event.modifierFlags.contains(.shift) { return super.menu(for: event) }
        let menu = NSMenu(title: "Selected text")
        menu.allowsContextMenuPlugIns = false
        menu.addItem(ActionItem("Copy", "doc.on.doc") { Clipboard.copyWords(words) })
        if !model.viewOnly {
            menu.addItem(.separator())
            // In the entry's vault where this account may write there, else its own.
            let vault = model.canWrite(card) ? card.vaultId : nil
            menu.addItem(ActionItem("New note from selection", "plus") {
                model.perform { repo in
                    let note = try await repo.createNote(content: Doc.fromText(words), vaultId: vault)
                    await MainActor.run { model.toast = Toast(message: "Made a new note from the selection", undo: true, open: note.id) }
                }
            })
        }
        menu.addItem(.separator())
        menu.addItem(ActionItem("Search Google for \(GoogleLinks.quoted(words))", "magnifyingglass") {
            if let url = GoogleLinks.search(words) { NSWorkspace.shared.open(url) }
        })
        menu.addItem(ActionItem("Translate with Google", "translate") {
            if let url = GoogleLinks.translate(words) { NSWorkspace.shared.open(url) }
        })
        menu.addItem(.separator())
        let note = NSMenuItem(title: "Shift-right-click for the Mac's menu", action: nil, keyEquivalent: "")
        note.isEnabled = false
        menu.addItem(note)
        return menu
    }

    /// One selection at a time, as on a web page: words selected here let go when others take the keys.
    override func resignFirstResponder() -> Bool {
        setSelectedRange(NSRange(location: selectedRange().location, length: 0))
        return super.resignFirstResponder()
    }

    /// Keys other than the Cmd ones (Copy, Select All) go to the journal, as on the web, where selecting words
    /// doesn't take them.
    override func keyDown(with event: NSEvent) {
        guard !event.modifierFlags.contains(.command), let window else { return super.keyDown(with: event) }
        window.makeFirstResponder(nil)
        refocus?()
        DispatchQueue.main.async { NSApp.postEvent(event, atStart: true) }
    }

    func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
        guard let url = link as? URL, url.scheme == "notes-hidden", let n = Int(url.absoluteString.dropFirst("notes-hidden:".count)) else { return false }
        toggleHidden(n)
        return true
    }
}

/// A menu item that runs a closure.
private final class ActionItem: NSMenuItem {
    private let run: () -> Void

    init(_ title: String, _ symbol: String, _ run: @escaping () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
        image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    }

    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func fire() { run() }
}
#endif
