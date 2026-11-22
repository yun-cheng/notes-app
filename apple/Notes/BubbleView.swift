import NotesKit
import SwiftUI

/// One entry in the journal, as the web app's bubble: a note's text or a todo's checkbox and title, its tags, its dates
/// and where it lives, its reactions, and its pages to turn through. A double-click (a tap on a phone) opens it; a
/// right-click opens its menu.
struct BubbleView: View {
    @Environment(AppModel.self) private var model
    let card: Card
    var picked = false
    var onPick: () -> Void = {}
    var picking = false
    @State private var page = 0
    @State private var unfolded = false
    @State private var revealed = false

    var body: some View {
        let pages = BubbleMemo.value(model, card, "pages") { [card.content] + card.turnPages }
        let shown = min(page, pages.count - 1)
        let doc = pages[shown]
        MaxWidth(fraction: 0.85, limit: 560) {
        VStack(alignment: .leading, spacing: 2) {
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
            if page == 0 {
                BubbleAttachments(card: card)
                BubbleLinks(card: card)
                BubbleTranslation(card: card)
            }
            if BubbleMemo.value(model, card, "long\(shown)", { Doc.previewLines(doc).count > 6 }) {
                Button(unfolded ? "Less" : "More") { unfolded.toggle() }
                    .buttonStyle(.plain).font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
            }
            BubbleTags(card: card)
            BubbleMeta(card: card, page: $page, pages: pages.count)
        }
        .padding(.horizontal, 12)
        .padding(.top, 7)
        .padding(.bottom, 5)
        .background(shape.fill(background))
        .overlay(shape.stroke(picked ? Theme.accent : card.color.map { Theme.tint($0).opacity(0.5) } ?? Theme.line, lineWidth: picked ? 2 : 1))
        .contentShape(shape)
        #if os(macOS)
        // A double-click opens it on a computer, as on the web; a click picks it while picking.
        .onTapGesture(count: 2) { model.openEntry = card.id }
        .onTapGesture { if picking { onPick() } }
        #else
        // A tap opens it on a phone, with no wait for a second tap.
        .onTapGesture { if picking { onPick() } else { model.openEntry = card.id } }
        #endif
        .modifier(PickOnCommandClick(onPick: onPick))
        .contextMenu { EntryMenu(card: card, revealHidden: { revealed.toggle() }) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
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
                        .textSelection(.enabled)
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

/// An entry's tags, grouped ones first.
struct BubbleTags: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        let tags = model.index.resolveTags(model.index.tagGroups.order(card.tags))
        if !tags.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(tags) { tag in
                    Button { model.page = .journal(StreamFilter(tagId: tag.id)) } label: { Chip(text: tag.displayTitle, tint: Theme.accent) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 2)
        }
    }
}

/// The bubble's bottom row: reactions, comments, checklist progress, pages, then a todo's due date, where it lives and
/// when it was written.
struct BubbleMeta: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @Binding var page: Int
    let pages: Int

    var body: some View {
        FlowLayout(spacing: 6) {
            Reactions(card: card)
            if let comments = model.commentCounts[card.id], comments > 0 {
                Label("\(comments)", systemImage: "bubble.left").labelStyle(.titleAndIcon)
            }
            if let progress = BubbleMemo.value(model, card, "checklist", { Doc.checklistProgress(card.content) }) {
                Label("\(progress.done)/\(progress.total)", systemImage: "checklist")
                    .padding(.horizontal, progress.done == progress.total ? 5 : 0)
                    .background(RoundedRectangle(cornerRadius: 6).fill(progress.done == progress.total ? Theme.tint(.green).opacity(0.22) : .clear))
            }
            if pages > 1 {
                HStack(spacing: 2) {
                    Button { page = max(0, page - 1) } label: { Image(systemName: "chevron.left") }.disabled(page == 0)
                    Text("\(page + 1)/\(pages)").foregroundStyle(Theme.accent).fontWeight(.semibold).monospacedDigit()
                    Button { page = min(pages - 1, page + 1) } label: { Image(systemName: "chevron.right") }.disabled(page == pages - 1)
                }
                .buttonStyle(.plain)
            }
            if card.template { Label("Template", systemImage: "doc.on.doc").foregroundStyle(Theme.accent) }
            Spacer(minLength: 8).layoutPriority(-1)
            if card.type == .todo { DueLabel(card: card) }
            if card.viewOnly { Image(systemName: "lock.doc").foregroundStyle(Theme.accent).help("View only") }
            Text(model.vaultNames(card).joined(separator: ", "))
            Text(Date(ms: card.createdAt), format: .dateTime.hour().minute())
        }
        .font(.caption)
        .foregroundStyle(Theme.muted)
        .frame(minHeight: 20)
    }
}

/// A todo's due date, time and repeat, red once overdue, or Waiting.
struct DueLabel: View {
    @Environment(AppModel.self) private var model
    let card: Card

    var body: some View {
        if card.waiting && !card.isDone {
            Label("Waiting", systemImage: "hourglass")
        } else if let due = card.due {
            HStack(spacing: 3) {
                if card.repeat != nil { Image(systemName: "repeat") }
                Text(DateKey.relativeDay(due, today: model.today) + (card.dueTime.map { " " + TimeKey.format($0) } ?? ""))
            }
            .fontWeight(.semibold)
            .foregroundStyle(card.isOverdue(today: model.today) ? Theme.alert : Theme.muted)
        }
    }
}

/// An entry's reactions, each with its count, pressed to put yours on or take it off; a smiley adds one.
struct Reactions: View {
    @Environment(AppModel.self) private var model
    let card: Card
    @State private var picking = false

    var body: some View {
        let reactions = card.reactions.sorted { $0.key < $1.key }
        ForEach(reactions, id: \.key) { emoji, by in
            let mine = by.contains(model.accountId)
            Button { toggle(emoji) } label: {
                Text("\(emoji) \(by.count)")
                    .padding(.horizontal, 6)
                    .background(Capsule().fill(mine ? Theme.accentSoft : Theme.sunken))
            }
            .buttonStyle(.plain)
            .help(reactedBy(count: by.count, mine: mine))
        }
        if model.canEdit(card) || model.commentCounts[card.id] != nil {
            Button { picking = true } label: { Image(systemName: "face.smiling") }
                .buttonStyle(.plain)
                .popover(isPresented: $picking) { EmojiPicker { emoji in toggle(emoji); picking = false } }
                .accessibilityLabel("Add a reaction")
        }
    }

    private func toggle(_ emoji: String) {
        let me = model.accountId
        model.update(card.id) { $0.toggleReaction(emoji, me: me) }
    }
}

/// The common reactions first, then any emoji typed in.
struct EmojiPicker: View {
    let pick: (String) -> Void
    @State private var typed = ""

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                ForEach(commonReactions, id: \.self) { e in Button(e) { pick(e) }.buttonStyle(.plain).font(.title2) }
            }
            TextField("Any emoji", text: $typed)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    if let e = typed.first(where: { $0.unicodeScalars.first?.properties.isEmojiPresentation ?? false || $0.unicodeScalars.count > 1 }) { pick(String(e)) }
                }
        }
        .padding(12)
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
