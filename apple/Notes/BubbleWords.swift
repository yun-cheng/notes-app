import Foundation
import NotesKit
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

extension NSAttributedString.Key {
    static let notesHiddenCovered = NSAttributedString.Key("notesHiddenCovered")
    static let notesHiddenIndex = NSAttributedString.Key("notesHiddenIndex")
}

/// Two-layer drifting dust dots drawn over covered hidden words, matching the web app's `.hidden-text`
/// (`styles.css`: a 30×24 tile drifting (+30, -24) and a 21×18 tile drifting (-21, +18) every 7 seconds).
enum HiddenDust {
    private struct Dot {
        let x: CGFloat
        let y: CGFloat
        let r: CGFloat
        let a: CGFloat
    }

    static let period: Double = 7.0

    private static let layer1Size = CGSize(width: 30, height: 24)
    private static let layer1: [Dot] = [
        .init(x: 1.2, y: 3.1, r: 0.8, a: 0.7), .init(x: 7.8, y: 2.4, r: 0.65, a: 0.9), .init(x: 12.4, y: 2.4, r: 0.8, a: 0.8),
        .init(x: 17.2, y: 1.1, r: 0.7, a: 0.8), .init(x: 21.1, y: 0.8, r: 0.8, a: 0.7), .init(x: 26.7, y: 3.6, r: 0.65, a: 0.7),
        .init(x: 4.1, y: 8.6, r: 0.7, a: 0.6), .init(x: 10.9, y: 5.8, r: 0.9, a: 0.7), .init(x: 16.8, y: 8.5, r: 0.55, a: 0.6),
        .init(x: 22.2, y: 10.8, r: 0.8, a: 0.6), .init(x: 28.5, y: 8.7, r: 0.7, a: 0.55), .init(x: 1.8, y: 13.5, r: 0.7, a: 0.7),
        .init(x: 9.0, y: 14.5, r: 0.8, a: 0.55), .init(x: 13.1, y: 11.1, r: 0.9, a: 0.8), .init(x: 17.5, y: 17.5, r: 0.9, a: 0.9),
        .init(x: 25.1, y: 14.2, r: 0.65, a: 0.6), .init(x: 4.0, y: 19.1, r: 0.7, a: 0.9), .init(x: 11.9, y: 22.1, r: 0.6, a: 0.9),
        .init(x: 19.2, y: 19.0, r: 0.65, a: 0.7), .init(x: 22.7, y: 21.5, r: 0.8, a: 0.8), .init(x: 28.2, y: 19.8, r: 0.6, a: 0.95),
    ]

    private static let layer2Size = CGSize(width: 21, height: 18)
    private static let layer2: [Dot] = [
        .init(x: 3.8, y: 5.2, r: 0.9, a: 0.5), .init(x: 9.9, y: 0.8, r: 0.7, a: 0.7), .init(x: 16.6, y: 5.7, r: 0.7, a: 0.5),
        .init(x: 20.1, y: 1.4, r: 0.8, a: 0.7), .init(x: 3.4, y: 9.0, r: 0.8, a: 0.6), .init(x: 10.5, y: 6.2, r: 0.65, a: 0.7),
        .init(x: 13.2, y: 10.3, r: 0.65, a: 0.5), .init(x: 1.2, y: 13.2, r: 0.6, a: 0.85), .init(x: 6.9, y: 16.2, r: 0.85, a: 0.8),
        .init(x: 11.8, y: 12.2, r: 0.8, a: 0.8), .init(x: 16.3, y: 16.8, r: 0.6, a: 0.55), .init(x: 18.5, y: 12.6, r: 0.55, a: 0.45),
    ]

    static func draw(in ctx: CGContext, rects: [CGRect], color: CGColor, phase: Double) {
        let p = CGFloat(phase - floor(phase))
        for raw in rects where raw.width > 0 && raw.height > 0 {
            let rect = raw.insetBy(dx: -1, dy: 0)
            ctx.saveGState()
            let clip = CGPath(roundedRect: rect, cornerWidth: 3, cornerHeight: 3, transform: nil)
            ctx.addPath(clip)
            ctx.clip()
            drawLayer(in: ctx, rect: rect, tile: layer1Size, dots: layer1, dx: p * layer1Size.width, dy: -p * layer1Size.height, color: color)
            drawLayer(in: ctx, rect: rect, tile: layer2Size, dots: layer2, dx: -p * layer2Size.width, dy: p * layer2Size.height, color: color)
            ctx.restoreGState()
        }
    }

    private static func drawLayer(in ctx: CGContext, rect: CGRect, tile: CGSize, dots: [Dot], dx: CGFloat, dy: CGFloat, color: CGColor) {
        let ox = dx.truncatingRemainder(dividingBy: tile.width)
        let oy = dy.truncatingRemainder(dividingBy: tile.height)
        let startX = floor((rect.minX - ox) / tile.width) * tile.width + ox - tile.width
        let startY = floor((rect.minY - oy) / tile.height) * tile.height + oy - tile.height
        var ty = startY
        while ty < rect.maxY + tile.height {
            var tx = startX
            while tx < rect.maxX + tile.width {
                for d in dots {
                    let cx = tx + d.x
                    let cy = ty + d.y
                    if cx + d.r < rect.minX || cx - d.r > rect.maxX || cy + d.r < rect.minY || cy - d.r > rect.maxY { continue }
                    ctx.setFillColor(color.copy(alpha: d.a) ?? color)
                    ctx.fillEllipse(in: CGRect(x: cx - d.r, y: cy - d.r, width: d.r * 2, height: d.r * 2))
                }
                tx += tile.width
            }
            ty += tile.height
        }
    }
}

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
        if view.textStorage?.isEqual(to: words) == false {
            view.textStorage?.setAttributedString(words)
            view.refreshCoveredRanges()
        }
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

    /// `BubbleText.attributed`'s text in AppKit's terms: its code font, colors, links, covered dust ranges and underlines.
    static func appKit(_ text: AttributedString) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for run in text.runs {
            let isCovered = run.link?.scheme == "notes-hidden-covered"
            var attributes: [NSAttributedString.Key: Any] = [
                .font: run[AttributeScopes.SwiftUIAttributes.FontAttribute.self] == nil ? body : code,
                .foregroundColor: isCovered ? NSColor.clear : NSColor(run[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] ?? Theme.text),
            ]
            if isCovered {
                attributes[.notesHiddenCovered] = true
            } else if let background = run[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] {
                attributes[.backgroundColor] = NSColor(background)
            }
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
    private var coveredRanges: [NSRange] = []
    private var dustTimer: Timer?

    func refreshCoveredRanges() {
        var ranges: [NSRange] = []
        if let storage = textStorage, storage.length > 0 {
            storage.enumerateAttribute(.notesHiddenCovered, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
                if value != nil { ranges.append(range) }
            }
        }
        coveredRanges = ranges
        syncDustTimer()
        needsDisplay = true
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        syncDustTimer()
    }

    private func syncDustTimer() {
        let shouldAnimate = !coveredRanges.isEmpty && window != nil && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if shouldAnimate {
            guard dustTimer == nil else { return }
            let timer = Timer(timeInterval: 1.0 / 24.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.needsDisplay = true }
            }
            RunLoop.main.add(timer, forMode: .common)
            dustTimer = timer
        } else {
            dustTimer?.invalidate()
            dustTimer = nil
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard !coveredRanges.isEmpty,
            let lm = layoutManager,
            let tc = textContainer,
            let ctx = NSGraphicsContext.current?.cgContext
        else { return }
        let origin = textContainerOrigin
        var rects: [CGRect] = []
        for range in coveredRanges {
            let glyphRange = lm.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            lm.enumerateEnclosingRects(forGlyphRange: glyphRange, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0), in: tc) { rect, _ in
                rects.append(rect.offsetBy(dx: origin.x, dy: origin.y))
            }
        }
        guard !rects.isEmpty else { return }
        let phase = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : CACurrentMediaTime() / HiddenDust.period
        HiddenDust.draw(in: ctx, rects: rects, color: NSColor(Theme.text).cgColor, phase: phase)
    }

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
        guard let url = link as? URL else { return false }
        if url.scheme == "notes-hidden", let n = Int(url.absoluteString.dropFirst("notes-hidden:".count)) {
            toggleHidden(n)
            return true
        }
        if url.scheme == "notes-hidden-covered", let n = Int(url.absoluteString.dropFirst("notes-hidden-covered:".count)) {
            toggleHidden(n)
            return true
        }
        return false
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
#else
/// A bubble's words on iPhone/iPad when hidden text is present: covered words sit under drifting dust dots, shown
/// words keep the regular text color (not link accent), and tapping any hidden stretch toggles it.
struct IOSBubbleWords: UIViewRepresentable {
    let text: AttributedString
    let toggleHidden: (Int) -> Void

    func makeUIView(context: Context) -> IOSWordsView {
        let view = IOSWordsView(usingTextLayoutManager: false)
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.linkTextAttributes = [
            .foregroundColor: UIColor(Theme.accent),
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.required, for: .vertical)
        return view
    }

    func updateUIView(_ view: IOSWordsView, context: Context) {
        let words = Self.uiKit(text)
        if !view.attributedText.isEqual(to: words) {
            view.attributedText = words
            view.refreshCoveredRanges()
        }
        view.toggleHidden = toggleHidden
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: IOSWordsView, context: Context) -> CGSize? {
        let limit = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? .greatestFiniteMagnitude
        let fitted = uiView.sizeThatFits(CGSize(width: limit, height: .greatestFiniteMagnitude))
        return CGSize(width: min(limit, ceil(fitted.width)), height: ceil(fitted.height))
    }

    static let body = UIFont.systemFont(ofSize: 16)
    static let code = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)

    /// Converts `BubbleText.attributed` into `NSAttributedString` without attaching `.link` to hidden stretches, so
    /// shown hidden words keep `Theme.text` instead of taking the link color.
    static func uiKit(_ text: AttributedString) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for run in text.runs {
            let link = run.link
            let isCovered = link?.scheme == "notes-hidden-covered"
            let isShownHidden = link?.scheme == "notes-hidden"
            var attributes: [NSAttributedString.Key: Any] = [
                .font: run[AttributeScopes.SwiftUIAttributes.FontAttribute.self] == nil ? body : code,
                .foregroundColor: isCovered ? UIColor.clear : UIColor(run[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] ?? Theme.text),
            ]
            if isCovered {
                attributes[.notesHiddenCovered] = true
                if let n = Int(link!.absoluteString.dropFirst("notes-hidden-covered:".count)) {
                    attributes[.notesHiddenIndex] = n
                }
            } else if isShownHidden {
                attributes[.foregroundColor] = UIColor(Theme.text)
                attributes[.backgroundColor] = UIColor(Theme.sunken)
                if let n = Int(link!.absoluteString.dropFirst("notes-hidden:".count)) {
                    attributes[.notesHiddenIndex] = n
                }
            } else {
                if let background = run[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] {
                    attributes[.backgroundColor] = UIColor(background)
                }
                if let link { attributes[.link] = link }
                if run[AttributeScopes.SwiftUIAttributes.UnderlineStyleAttribute.self] != nil {
                    attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
                }
            }
            out.append(NSAttributedString(string: String(text[run.range].characters), attributes: attributes))
        }
        return out
    }
}

final class IOSWordsView: UITextView, UIGestureRecognizerDelegate {
    var toggleHidden: (Int) -> Void = { _ in }
    private var coveredRanges: [NSRange] = []
    private var dustLink: CADisplayLink?

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        addGestureRecognizer(tap)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard gesture.state == .ended, textStorage.length > 0 else { return }
        var point = gesture.location(in: self)
        point.x -= textContainerInset.left
        point.y -= textContainerInset.top
        let idx = layoutManager.characterIndex(for: point, in: textContainer, fractionOfDistanceBetweenInsertionPoints: nil)
        guard idx < textStorage.length else { return }
        let glyphIdx = layoutManager.glyphIndexForCharacter(at: idx)
        let rect = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyphIdx, length: 1), in: textContainer)
        guard rect.insetBy(dx: -4, dy: -4).contains(point) else { return }
        if let n = textStorage.attribute(.notesHiddenIndex, at: idx, effectiveRange: nil) as? Int {
            toggleHidden(n)
        }
    }

    func refreshCoveredRanges() {
        var ranges: [NSRange] = []
        if textStorage.length > 0 {
            textStorage.enumerateAttribute(.notesHiddenCovered, in: NSRange(location: 0, length: textStorage.length)) { value, range, _ in
                if value != nil { ranges.append(range) }
            }
        }
        coveredRanges = ranges
        syncDustLink()
        setNeedsDisplay()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        syncDustLink()
    }

    private func syncDustLink() {
        let shouldAnimate = !coveredRanges.isEmpty && window != nil && !UIAccessibility.isReduceMotionEnabled
        if shouldAnimate {
            guard dustLink == nil else { return }
            let link = CADisplayLink(target: self, selector: #selector(tickDust))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 24, preferred: 20)
            link.add(to: .main, forMode: .common)
            dustLink = link
        } else {
            dustLink?.invalidate()
            dustLink = nil
        }
    }

    @objc private func tickDust() { setNeedsDisplay() }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        guard !coveredRanges.isEmpty, let ctx = UIGraphicsGetCurrentContext() else { return }
        var rects: [CGRect] = []
        for range in coveredRanges {
            let glyphRange = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            layoutManager.enumerateEnclosingRects(forGlyphRange: glyphRange, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0), in: textContainer) { r, _ in
                rects.append(r.offsetBy(dx: self.textContainerInset.left, dy: self.textContainerInset.top))
            }
        }
        guard !rects.isEmpty else { return }
        let phase = UIAccessibility.isReduceMotionEnabled ? 0 : CACurrentMediaTime() / HiddenDust.period
        HiddenDust.draw(in: ctx, rects: rects, color: UIColor(Theme.text).cgColor, phase: phase)
    }
}
#endif
