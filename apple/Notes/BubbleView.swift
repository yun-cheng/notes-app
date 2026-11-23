import NotesKit
import SwiftUI

/// One entry in the journal, as the web app's bubble: a note's title and text or a todo's checkbox and title, its tags
/// with a todo's dates on their right, and a bottom row of its reactions on the left and its badges, page, More or
/// Less, vault and time on the right. Its pages turn with the arrows along its sides. A double-click (a tap on a phone)
/// opens it; a right-click (a long press) opens its menu. Its photos, files and links show under it
/// (`EntryAttachments`).
struct BubbleView: View {
    @Environment(AppModel.self) private var model
    let card: Card
    var picked = false
    var onPick: () -> Void = {}
    var picking = false
    @State private var page = 0
    @State private var unfolded = false
    @State private var revealed = false
    @State private var hovering = false

    var body: some View {
        let pages = BubbleMemo.value(model, card, "pages") { [card.content] + card.turnPages }
        let shown = min(page, pages.count - 1)
        let doc = pages[shown]
        let long = BubbleMemo.value(model, card, "long\(shown)") { Doc.previewLines(doc).count > 6 }
        let fold = BubbleFold(long: long, unfolded: $unfolded)
        MaxWidth(fraction: 0.85, limit: 560) {
        VStack(alignment: .leading, spacing: 2) {
            if page == 0 { BubbleTranslation(card: card) }
            if card.type == .todo {
                HStack(alignment: .top, spacing: 6) {
                    TodoCheck(card: card)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(card.title)
                            .foregroundStyle(card.isDone ? Theme.muted : Theme.text)
                            .strikethrough(card.isDone, color: Theme.muted)
                        if !BubbleMemo.value(model, card, "blank\(shown)", { Doc.isBlank(doc) }) || page > 0 {
                            BubbleText(doc: doc, folded: !unfolded, revealed: revealed, memo: (card, shown))
                        }
                    }
                }
            } else {
                if !card.title.trimmingCharacters(in: .whitespaces).isEmpty, page == 0 {
                    Text(card.title).fontWeight(.semibold)
                }
                if card.isStack {
                    StackPreview(stack: card)
                }
                BubbleText(doc: doc, folded: !unfolded, revealed: revealed, memo: (card, shown))
            }
            BubbleTags(card: card)
            BubbleMeta(card: card, page: page, pages: pages.count, fold: fold)
        }
        .font(Theme.bodyFont)
        .padding(.leading, pages.count > 1 ? (card.type == .todo ? 22 : 24) : 12)
        .padding(.trailing, pages.count > 1 ? 24 : 12)
        .padding(.top, 7)
        .padding(.bottom, 5)
        .background(shape.fill(background))
        .overlay(shape.stroke(picked ? Theme.accent : card.color.map { Theme.tint($0).opacity(0.5) } ?? (hovering ? Theme.muted : Theme.line), lineWidth: picked ? 2 : 1))
        .overlay { if pages.count > 1 { PageEdges(page: $page, count: pages.count, shown: hovering) } }
        .overlay(alignment: .topTrailing) {
            #if os(macOS)
            if hovering { CopyCorner(card: card) }
            #endif
        }
        .contentShape(shape)
        #if os(macOS)
        // A double-click opens it on a computer, as on the web; a click picks it while picking.
        .onTapGesture(count: 2) { model.openEntry = card.id }
        .onTapGesture { if picking { onPick() } }
        .onHover { hovering = $0 }
        #else
        // A tap opens it on a phone, with no wait for a second tap.
        .onTapGesture { if picking { onPick() } else { model.openEntry = card.id } }
        #endif
        .modifier(PickOnCommandClick(onPick: onPick))
        .contextMenu { EntryMenu(card: card, revealHidden: { revealed.toggle() }) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        // Opening is what pressing it does, as on the web; ticking a todo is one of its named actions.
        .accessibilityAction { model.openEntry = card.id }
        .accessibilityAction(named: card.isDone ? "Mark not done" : "Mark done") { if card.type == .todo, model.canEdit(card) { model.setDone(card, !card.isDone) } }
    }

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 16)
    }

    private var background: Color {
        if picked { return Theme.accentSoft }
        if let c = card.color { return Theme.tint(c).opacity(0.16) }
        return Theme.surface
    }
}

/// Whether a bubble's text is long enough to fold, and whether it's open.
struct BubbleFold {
    var long: Bool
    @Binding var unfolded: Bool
}

/// A bubble's previous and next page, each the full height of a side, going round past the last or the first; shown
/// while pointed at on a computer, and always, faint, on a phone, as on the web.
struct PageEdges: View {
    @Binding var page: Int
    let count: Int
    var shown: Bool

    var body: some View {
        HStack(spacing: 0) {
            edge("chevron.left", "Previous page") { page = (page - 1 + count) % count }
            Spacer(minLength: 0)
            edge("chevron.right", "Next page") { page = (page + 1) % count }
        }
    }

    private func edge(_ icon: String, _ label: String, _ go: @escaping () -> Void) -> some View {
        Button { withAnimation(.easeOut(duration: 0.2)) { go() } } label: {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                .frame(width: 20).frame(maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.accent)
        #if os(macOS)
        .opacity(shown ? 1 : 0)
        #else
        .opacity(0.6)
        #endif
        .help(label)
        .accessibilityLabel(label)
    }
}

#if os(macOS)
/// The copy button in a bubble's corner while it's pointed at, as the web's.
struct CopyCorner: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        Button { Clipboard.copyEntry(card, model: model) } label: {
            Image(systemName: "doc.on.doc").font(.system(size: 11))
                .frame(width: 24, height: 24)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.line))
                .shadow(color: .black.opacity(0.12), radius: 1.5, y: 1)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.muted)
        .padding(4)
        .help("Copy")
        .accessibilityLabel("Copy")
    }
}
#endif

/// What a bubble works out from its card's document, kept until the cards change, so a redraw that changes nothing
/// about it (the keyboard's focus moving, picking, scrolling back) doesn't walk the document again.
@MainActor
enum BubbleMemo {
    private struct Box<T> { let value: T }
    private static var version = -1
    private static var store: [String: Any] = [:]

    static func value<T>(_ model: AppModel, _ card: Card, _ what: String, _ make: () -> T) -> T {
        if version != model.cardsVersion {
            store = [:]
            version = model.cardsVersion
        }
        let key = "\(card.id)|\(card.updatedAt)|\(what)"
        if let hit = store[key] as? Box<T> { return hit.value }
        let made = make()
        store[key] = Box(value: made)
        return made
    }
}

/// Cmd-click picks an entry, as in the web app's journal.
struct PickOnCommandClick: ViewModifier {
    let onPick: () -> Void
    func body(content: Content) -> some View {
        #if os(macOS)
        content.simultaneousGesture(TapGesture().modifiers(.command).onEnded { onPick() })
        #else
        content.onLongPressGesture(minimumDuration: 0.5) { onPick() }
        #endif
    }
}

/// A todo's checkbox: ticking it finishes it, or moves a repeating one on.
struct TodoCheck: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        Button { model.setDone(card, !card.isDone) } label: {
            Image(systemName: card.isDone ? "checkmark.square.fill" : card.waiting ? "square.dashed" : "square")
                .font(.system(size: 17))
                .foregroundStyle(card.isDone ? Theme.accent : Theme.muted)
                .frame(height: 22)
        }
        .buttonStyle(.plain)
        .disabled(!model.canEdit(card))
        .accessibilityLabel(card.isDone ? "Done" : "Not done")
    }
}

/// A document's text as a bubble shows it: lines with list markers, code blocks apart, links pressable, hidden words
/// under dots until shown, folded to six lines.
struct BubbleText: View {
    @Environment(AppModel.self) private var model
    let doc: JSONValue
    var folded = true
    var revealed = false
    /// The card and page it shows, to keep its parts between redraws.
    var memo: (card: Card, page: Int)? = nil

    var body: some View {
        let make = { Doc.previewParts(doc, titleOf: model.index.titleOf, markCode: true, hidden: .mark) }
        let parts = memo.map { m in BubbleMemo.value(model, m.card, "parts\(m.page)", make) } ?? make()
        let limited = folded ? Self.fold(parts, lines: 6) : parts
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(limited.enumerated()), id: \.offset) { _, part in
                switch part {
                case .text(let lines):
                    Text(Self.attributed(lines.joined(separator: "\n"), revealed: revealed))
                        .fixedSize(horizontal: false, vertical: true)
                        #if os(iOS)
                        .textSelection(.enabled)
                        #endif
                case .code(let text, let language, _):
                    CodeSnippet(text: text, language: language)
                }
            }
        }
    }

    /// The first `lines` lines of a preview.
    static func fold(_ parts: [Doc.PreviewPart], lines: Int) -> [Doc.PreviewPart] {
        var left = lines
        var out: [Doc.PreviewPart] = []
        for part in parts where left > 0 {
            switch part {
            case .text(let l):
                out.append(.text(Array(l.prefix(left))))
                left -= min(left, l.count)
            case .code(let text, let language, let prefix):
                let l = text.components(separatedBy: "\n")
                out.append(.code(text: l.prefix(left).joined(separator: "\n"), language: language, prefix: prefix))
                left -= min(left, l.count)
            }
        }
        return out
    }

    /// Text with inline code in a code font, hidden words as dots, and web addresses as links.
    static func attributed(_ text: String, revealed: Bool) -> AttributedString {
        var out = AttributedString()
        var rest = Substring(text)
        var inCode = false
        var inHidden = false
        var run = ""
        func flush() {
            guard !run.isEmpty else { return }
            if inHidden && !revealed {
                var a = AttributedString(String(repeating: "•", count: min(12, max(3, run.count / 2))))
                a.foregroundColor = Theme.muted
                a.backgroundColor = Theme.sunken
                out += a
            } else if inCode {
                var a = AttributedString(run)
                a.font = .system(.callout, design: .monospaced)
                a.backgroundColor = Theme.sunken
                out += a
            } else {
                for piece in Doc.splitLinks(run) {
                    var a = AttributedString(piece.text)
                    if let href = piece.href, let url = URL(string: href) {
                        a.link = url
                        a.foregroundColor = Theme.accent
                        a.underlineStyle = .single
                    }
                    if inHidden { a.backgroundColor = Theme.sunken }
                    out += a
                }
            }
            run = ""
        }
        while let ch = rest.first {
            rest.removeFirst()
            switch String(ch) {
            case Doc.codeOpen: flush(); inCode = true
            case Doc.codeClose: flush(); inCode = false
            case Doc.hideOpen: flush(); inHidden = true
            case Doc.hideClose: flush(); inHidden = false
            default: run.append(ch)
            }
        }
        flush()
        return out
    }
}

/// A code block in a bubble: in a code font, kept as typed, its language named over it, with a copy button.
struct CodeSnippet: View {
    let text: String
    let language: String?
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let language { Text(language).font(.caption2).foregroundStyle(Theme.muted) }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(size: 13, design: .monospaced)).textSelection(.enabled).fixedSize()
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.sunken))
        .overlay(alignment: .topTrailing) {
            Button { Clipboard.copy(text) } label: { Image(systemName: "doc.on.doc").imageScale(.small) }
                .buttonStyle(.plain).foregroundStyle(Theme.muted).padding(6)
                .accessibilityLabel("Copy code")
        }
    }
}

/// The entries in a stack, named, under its own words.
struct StackPreview: View {
    @Environment(AppModel.self) private var model
    let stack: Card

    var body: some View {
        let entries = model.index.stackEntries(stack)
        VStack(alignment: .leading, spacing: 3) {
            ForEach(entries.prefix(5)) { entry in
                Button { model.openEntry = entry.id } label: {
                    HStack(spacing: 6) {
                        Image(systemName: entry.type == .todo ? (entry.isDone ? "checkmark.square" : "square") : "doc.text").imageScale(.small).foregroundStyle(Theme.muted)
                        Text(entry.displayTitle).lineLimit(1)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Theme.sunken))
                }
                .buttonStyle(.plain)
            }
            if entries.count > 5 { Text("and \(entries.count - 5) more").font(.caption).foregroundStyle(Theme.muted) }
        }
        .padding(.vertical, 2)
    }
}

/// An entry's tags, grouped ones first, in their tags' colors, with a todo's dates kept to the right on the same row,
/// as the web's `bubble__tags`.
struct BubbleTags: View {
    @Environment(AppModel.self) private var model
    let card: Card
    /// In the entry's sheet, the dates show in its bar instead.
    var dates = true

    var body: some View {
        let tags = model.index.resolveTags(model.index.tagGroups.order(card.tags))
        let dated = dates && card.type == .todo && (card.due != nil || card.start != nil)
        if !tags.isEmpty || dated {
            FlowLayout(spacing: 6) {
                ForEach(tags) { tag in
                    Button { model.page = .journal(StreamFilter(tagId: tag.id)) } label: { TagChip(tag: tag) }
                        .buttonStyle(.plain)
                }
                if dated {
                    Spacer(minLength: 12).layoutPriority(-1)
                    if card.waiting && !card.isDone { WaitingMark() }
                    DueLabel(card: card)
                }
            }
            .font(.system(size: 11))
            .foregroundStyle(Theme.muted)
            .padding(.top, 4)
            .padding(.bottom, 2)
        }
    }
}

/// A tag as a small chip: in its color, if it has one; a grouped one bolder, as the web's `chip--small`.
struct TagChip: View {
    @Environment(AppModel.self) private var model
    let tag: Card
    var large = false

    var body: some View {
        let grouped = model.index.tagGroups.groupOf[tag.id] != nil
        Text(tag.displayTitle)
            .font(.system(size: large ? 13 : 12, weight: grouped ? .semibold : .regular))
            .lineLimit(1)
            .padding(.horizontal, large ? 10 : 8)
            .frame(minHeight: large ? 28 : 18)
            .background(Capsule().fill(tag.color.map { Theme.tint($0).opacity(0.24) } ?? Theme.sunken))
            .overlay { if grouped { Capsule().stroke(Theme.accent.opacity(0.45)) } }
            .foregroundStyle(tag.color == nil ? Theme.muted : Theme.text)
    }
}

/// On a template's bottom row: Use, which starts an entry from it, or Template where nothing can be changed.
struct UseTemplateButton: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        if model.viewOnly || card.deleted {
            Label("Template", systemImage: "doc.on.doc").labelStyle(.titleAndIcon).foregroundStyle(Theme.accent).help("A template")
        } else {
            Button { model.startFrom(card) } label: { Label("Use", systemImage: "doc.on.doc").labelStyle(.titleAndIcon) }
                .buttonStyle(.plain).foregroundStyle(Theme.accent).fontWeight(.semibold)
                .help("Start a new entry from this template")
        }
    }
}

/// Waiting on someone else, as the web's mark beside a todo's dates.
struct WaitingMark: View {
    var body: some View {
        Label("Waiting", systemImage: "hourglass").labelStyle(.titleAndIcon).fontWeight(.semibold)
    }
}

/// The bubble's bottom row, as the web's: on the left, whether it's view only, its reactions and a way to comment; on
/// the right, Use template, its checklist and comment counts, the page shown, More or Less, its vaults and the time it
/// was written.
struct BubbleMeta: View {
    @Environment(AppModel.self) private var model
    let card: Card
    let page: Int
    let pages: Int
    let fold: BubbleFold

    var body: some View {
        FlowLayout(spacing: 6) {
            if card.viewOnly { Image(systemName: "eye").foregroundStyle(Theme.accent).help("View only").accessibilityLabel("View only") }
            Reactions(card: card)
            Spacer(minLength: 8).layoutPriority(-1)
            if card.template { UseTemplateButton(card: card) }
            if let progress = BubbleMemo.value(model, card, "checklist", { Doc.checklistProgress(card.content) }) {
                let all = progress.done == progress.total
                Label("\(progress.done)/\(progress.total)", systemImage: "checklist").labelStyle(.titleAndIcon).monospacedDigit()
                    .padding(.horizontal, all ? 5 : 0)
                    .background(RoundedRectangle(cornerRadius: 6).fill(all ? Theme.tint(.green).opacity(0.22) : .clear))
                    .foregroundStyle(all ? Theme.text : Theme.muted)
                    .help("\(progress.done) of \(progress.total) checklist items done")
            }
            if let comments = model.commentCounts[card.id], comments > 0 {
                Button { model.openEntry = card.id } label: { Label("\(comments)", systemImage: "bubble.left").labelStyle(.titleAndIcon) }
                    .buttonStyle(.plain)
                    .help(comments == 1 ? "1 open comment: show" : "\(comments) open comments: show")
            }
            if pages > 1 {
                Text("\(page + 1)/\(pages)").font(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.accent)
                    .help("Page \(page + 1) of \(pages)")
            }
            if fold.long {
                Button { fold.unfolded.toggle() } label: {
                    Label(fold.unfolded ? "Less" : "More", systemImage: fold.unfolded ? "chevron.up" : "chevron.down").labelStyle(.titleAndIcon)
                }
                .buttonStyle(.plain).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
            }
            if card.type != .todo || (card.due == nil && card.start == nil), card.waiting && !card.isDone { WaitingMark() }
            VaultLabel(card: card)
            Text(Date(ms: card.createdAt), format: .dateTime.hour().minute()).padding(.leading, 4)
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.muted)
        .frame(minHeight: 20)
    }
}

/// The vaults an entry is in, as the web's: its own, then any it's also in; left out with only one vault, or when the
/// journal already shows its one vault. An entry shared with this account alone says so.
struct VaultLabel: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        let ids = [card.vaultId] + (model.sharedInto[card.id] ?? [])
        let vaults = ids.compactMap { model.vault($0) }
        if vaults.isEmpty {
            if model.vault(card.vaultId) == nil { Label("Shared with you", systemImage: "square.and.arrow.up").labelStyle(.titleAndIcon).help("Shared with you from someone else's vault") }
        } else if model.vaults.count > 1, !(model.page.filter?.vaultId != nil && vaults.count < 2) {
            HStack(spacing: 3) {
                ForEach(Array(vaults.enumerated()), id: \.element.id) { i, v in
                    if v.isPrivate { Image(systemName: "lock").imageScale(.small) }
                    Text(v.name + (i < vaults.count - 1 ? "," : ""))
                }
            }
            .help("In \(vaults.map(\.name).joined(separator: ", "))")
        }
    }
}

/// A todo's dates as a sentence, red once overdue, and how it repeats, named, as the web's `DueLabel`: "Due tomorrow at
/// 6:00 PM", "Starts Mon, Nov 30, due Fri, Dec 4", "↻ Every 3 days".
struct DueLabel: View {
    @Environment(AppModel.self) private var model
    let card: Card
    var short = false

    var body: some View {
        let text = Self.text(card, today: model.today, short: short)
        if !text.isEmpty {
            HStack(spacing: 6) {
                Text(text).fontWeight(.semibold)
                    .foregroundStyle(card.isOverdue(today: model.today) ? Theme.alert : Theme.muted)
                if let r = card.repeat {
                    HStack(spacing: 2) {
                        Image(systemName: "repeat").imageScale(.small)
                        if !short { Text(r.label) }
                    }
                    .help("Repeats: \(r.label.lowercased())")
                }
            }
        }
    }

    /// The web's `dueText`.
    static func text(_ card: Card, today: String, short: Bool = false) -> String {
        let starts = !card.isDone ? card.start.flatMap { $0 > today ? $0 : nil } : nil
        guard let due = card.due else {
            guard let starts else { return "" }
            return short ? "From \(DateKey.relativeDay(starts, today: today))" : "Starts \(DateKey.relativeDayInSentence(starts, today: today))"
        }
        let time = card.dueTime.map { TimeKey.format($0) } ?? ""
        if short {
            return (starts.map { DateKey.relativeDay($0, today: today) + " – " } ?? "") + DateKey.relativeDay(due, today: today) + (time.isEmpty ? "" : ", \(time)")
        }
        let when = DateKey.relativeDayInSentence(due, today: today) + (time.isEmpty ? "" : " at \(time)")
        return starts.map { "Starts \(DateKey.relativeDayInSentence($0, today: today)), due \(when)" } ?? "Due \(when)"
    }
}

/// An entry's reactions as the web's chips, each emoji with how many put it on, filled where this account did, a press
/// toggling it; then the faint smiley that opens the picker.
struct Reactions: View {
    @Environment(AppModel.self) private var model
    let card: Card
    var large = false
    @State private var picking = false

    var body: some View {
        // The payload's object keeps no order, so they go by emoji, the same on every redraw.
        let reactions = card.reactions.filter { !$0.value.isEmpty }.keys.sorted()
        ForEach(reactions, id: \.self) { emoji in
            let by = card.reactions[emoji] ?? []
            let mine = by.contains(model.accountId)
            Button { toggle(emoji) } label: {
                HStack(spacing: 3) {
                    Text(emoji).font(.system(size: large ? 16 : 13))
                    Text("\(by.count)").font(.system(size: large ? 13 : 11, weight: .medium)).monospacedDigit()
                }
                .padding(.leading, large ? 8 : 5).padding(.trailing, large ? 10 : 7)
                .frame(height: large ? 28 : 20)
                .background(Capsule().fill(mine ? Theme.accentSoft : Theme.surface))
                .overlay(Capsule().stroke(mine ? Theme.accent.opacity(0.55) : Theme.line))
                .foregroundStyle(mine ? Theme.text : Theme.muted)
            }
            .buttonStyle(.plain)
            .disabled(!canReact)
            .help("\(reactedBy(count: by.count, mine: mine))\(canReact ? (mine ? ". Press to take yours off" : ". Press to add yours") : "")")
            .accessibilityLabel("\(emoji) \(by.count): \(reactedBy(count: by.count, mine: mine))")
        }
        if canReact {
            Button { picking = true } label: {
                SmileyIcon(size: large ? 16 : 13)
                    .frame(width: large ? 28 : 20, height: large ? 28 : 20)
                    .contentShape(Circle())
                    .opacity(picking ? 1 : 0.55)
            }
            .buttonStyle(.plain)
            .help("Add a reaction")
            .accessibilityLabel("Add a reaction")
            .popover(isPresented: $picking) {
                ReactionPicker(mine: { card.reactions[$0]?.contains(model.accountId) == true }) { emoji in
                    toggle(emoji)
                    picking = false
                }
                .presentationCompactAdaptation(.popover)
            }
        }
    }

    /// Anyone who could change the entry can react, even while it's set to view only; not in the Trash.
    private var canReact: Bool { !card.deleted && model.canWrite(card) }

    private func toggle(_ emoji: String) {
        let me = model.accountId
        model.update(card.id) { $0.toggleReaction(emoji, me: me) }
    }
}

/// An outline smiley, as the web's icon: drawn here, since the system's symbol fills in on a dark background.
struct SmileyIcon: View {
    let size: CGFloat

    var body: some View {
        Canvas { ctx, sz in
            let r = min(sz.width, sz.height) / 2 - 0.75
            let c = CGPoint(x: sz.width / 2, y: sz.height / 2)
            let line = max(1, size / 11)
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .foreground, lineWidth: line)
            let eye = r * 0.13
            for dx in [-0.33, 0.33] {
                ctx.fill(Path(ellipseIn: CGRect(x: c.x + r * dx - eye, y: c.y - r * 0.28 - eye, width: eye * 2, height: eye * 2)), with: .foreground)
            }
            var mouth = Path()
            mouth.addArc(center: CGPoint(x: c.x, y: c.y + r * 0.05), radius: r * 0.5, startAngle: .degrees(25), endAngle: .degrees(155), clockwise: false)
            ctx.stroke(mouth, with: .foreground, style: StrokeStyle(lineWidth: line, lineCap: .round))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The emoji picker, as the web's: the common reactions in a row, then + for any emoji, by group with the ones used
/// lately first, or found by name, or typed or pasted in from the system's emoji keyboard.
struct ReactionPicker: View {
    let mine: (String) -> Bool
    let pick: (String) -> Void
    @State private var more = false
    @State private var query = ""
    @FocusState private var searching: Bool
    @AppStorage("recentReactions") private var recentRaw = ""

    static let recentLimit = 16

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 0) {
                ForEach(commonReactions, id: \.self) { cell($0, size: 22, height: 36) }
                Spacer(minLength: 0)
                Button { more.toggle(); if more { searching = true } } label: {
                    Image(systemName: more ? "chevron.up" : "plus").font(.system(size: 14, weight: .medium))
                        .frame(width: 36, height: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain).foregroundStyle(Theme.muted)
                .help("Any emoji")
                .accessibilityLabel("More emoji")
            }
            if more {
                TextField("Search, or type any emoji", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .focused($searching)
                    .onSubmit { if let first = found.first { choose(first) } }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                            if found.isEmpty {
                                Text("No emoji called that. Type or paste one, from the emoji keyboard.")
                                    .font(.footnote).foregroundStyle(Theme.muted).padding(4)
                            } else {
                                grid(found)
                            }
                        } else {
                            if !recent.isEmpty { section("Recent", recent) }
                            ForEach(EmojiData.groups, id: \.name) { g in section(g.name, g.emoji.map(\.char)) }
                        }
                    }
                }
                .frame(height: 232)
            }
        }
        .padding(6)
        .frame(width: 296)
    }

    private var found: [String] {
        var seen = Set<String>()
        return (Self.emojisIn(query) + EmojiData.search(query)).filter { seen.insert($0).inserted }
    }

    private var recent: [String] { recentRaw.split(separator: " ").map(String.init) }

    private func section(_ name: String, _ emoji: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted).padding(.horizontal, 4).padding(.top, 6)
            grid(emoji)
        }
    }

    private func grid(_ emoji: [String]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 8), spacing: 0) {
            ForEach(Self.once(emoji), id: \.self) { cell($0, size: 20, height: 34) }
        }
    }

    private func cell(_ emoji: String, size: CGFloat, height: CGFloat) -> some View {
        Button { choose(emoji) } label: {
            Text(emoji).font(.system(size: size))
                .frame(maxWidth: .infinity).frame(minWidth: 34, minHeight: height)
                .background(RoundedRectangle(cornerRadius: 8).fill(mine(emoji) ? Theme.accentSoft : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(emoji)
    }

    private func choose(_ emoji: String) {
        recentRaw = ([emoji] + recent.filter { $0 != emoji }).prefix(Self.recentLimit).joined(separator: " ")
        pick(emoji)
    }

    /// Each once, in order.
    static func once(_ list: [String]) -> [String] {
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }

    /// The emoji in what was typed or pasted, one per character as seen, in order and without repeats.
    static func emojisIn(_ text: String) -> [String] {
        var seen = Set<String>()
        return text.filter { ch in
            guard let first = ch.unicodeScalars.first else { return false }
            return first.properties.isEmojiPresentation || (first.properties.isEmoji && ch.unicodeScalars.count > 1)
        }
        .map(String.init)
        .filter { seen.insert($0).inserted }
    }
}

/// Offers its child at most a share of the width, and is as wide as the child then is: a bubble fits its words, up to
/// 85% of the column, as the web's `max-width: min(85%, 560px)`.
struct MaxWidth: Layout {
    var fraction: CGFloat
    var limit: CGFloat

    private func offer(_ proposal: ProposedViewSize) -> ProposedViewSize {
        guard let w = proposal.width, w.isFinite else { return ProposedViewSize(width: limit, height: proposal.height) }
        return ProposedViewSize(width: min(limit, w * fraction), height: proposal.height)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        subviews.first?.sizeThatFits(offer(proposal)) ?? .zero
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}

/// Lays its children out in rows, wrapping, as the web's flex-wrap.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        // As wide as what's in it, so a bubble fits its words, as the web's.
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: min(proposal.width ?? width, width), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews) {
            var x = bounds.minX
            // A Spacer pushes what follows it to the right edge.
            let flexible = row.items.filter { subviews[$0].priority < 0 }.count
            let extra = flexible > 0 ? (bounds.width - row.width) / CGFloat(flexible) : 0
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                if subviews[i].priority < 0 {
                    x += extra + size.width + spacing
                    continue
                }
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            let add = (rows[rows.count - 1].items.isEmpty ? 0 : spacing) + size.width
            if rows[rows.count - 1].width + add > width && !rows[rows.count - 1].items.isEmpty {
                rows.append(Row())
            }
            let gap = rows[rows.count - 1].items.isEmpty ? 0 : spacing
            rows[rows.count - 1].items.append(i)
            rows[rows.count - 1].width += gap + size.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
        }
        return rows
    }
}
