import NotesKit
import SwiftUI

extension Card {
    /// A todo on the calendar and the timeline: from its start date to its due date, or on the one day it has.
    var span: (from: String, to: String)? {
        guard let from = start ?? due, let to = due ?? start else { return nil }
        return from <= to ? (from, to) : (to, from)
    }
}

extension AppModel {
    /// Moves a todo by some days: its due date and start date both, so a span keeps its length.
    func shift(_ id: String, by days: Int) {
        guard days != 0 else { return }
        update(id) { c in
            if let d = c.due { c.due = DateKey.adding(days, to: d) }
            if let s = c.start { c.start = DateKey.adding(days, to: s) }
        }
    }

    /// Moves one end of a todo's span: its start (a start on its due date is none) or its due date. An end can't pass
    /// the other.
    func stretch(_ id: String, end: Bool, by days: Int) {
        guard days != 0, let card = card(id), let span = card.span else { return }
        update(id) { c in
            if end {
                let to = max(span.from, DateKey.adding(days, to: span.to))
                c.due = to
                if c.start == nil && span.from != to { c.start = span.from }
            } else {
                let from = min(span.to, DateKey.adding(days, to: span.from))
                c.start = from == span.to ? nil : from
                if c.due == nil { c.due = span.to }
            }
        }
    }

    /// Todos the calendar and the timeline show: the journal's filter for them, if it has one.
    func datedTodos(_ filter: StreamFilter?) -> [Card] {
        let f = filter ?? StreamFilter()
        let match = Stream.matcher(f.with { $0.type = .todo }, today: today, sharedInto: sharedInto)
        return index.todos.filter { $0.span != nil && match($0, nil) }
    }
}

/// A todo on the calendar and the timeline, from its start to its due date, as the web's `Span`.
struct Span: Identifiable {
    let card: Card
    let from: String
    let to: String
    var id: String { card.id }

    /// The todos' spans, the earliest first, a longer one before a shorter from the same day, then by time and title.
    static func of(_ todos: [Card]) -> [Span] {
        todos.compactMap { c in c.span.map { Span(card: c, from: $0.from, to: $0.to) } }
            .sorted { a, b in
                if a.from != b.from { return a.from < b.from }
                if a.to != b.to { return a.to > b.to }
                let ta = a.card.dueTime ?? "99", tb = b.card.dueTime ?? "99"
                if ta != tb { return ta < tb }
                if a.card.title != b.card.title { return a.card.title < b.card.title }
                return a.card.id < b.card.id
            }
    }

    /// The spans in a run of days in rows, each holding spans that don't overlap, so a span keeps one row.
    static func lanes(_ days: [String], _ all: [Span]) -> [[Span]] {
        guard let first = days.first, let last = days.last else { return [] }
        var rows: [[Span]] = []
        for span in all where span.to >= first && span.from <= last {
            if let i = rows.firstIndex(where: { $0.last!.to < span.from }) { rows[i].append(span) } else { rows.append([span]) }
        }
        return rows
    }

    /// The days it covers within a run of days: the index of its first, and how many.
    func place(in days: [String]) -> (at: Int, length: Int)? {
        guard let first = days.first, let last = days.last, to >= first, from <= last else { return nil }
        let a = max(from, first), b = min(to, last)
        return (DateKey.daysBetween(first, a), DateKey.daysBetween(a, b) + 1)
    }

    /// Its tint, as the web's chips and bars: the todo's color, waiting striped, done faint.
    var fill: AnyShapeStyle {
        if card.waiting && !card.isDone { return AnyShapeStyle(Theme.sunken) }
        if let c = card.color { return AnyShapeStyle(Theme.tint(c).opacity(0.35)) }
        return AnyShapeStyle(Theme.accentSoft)
    }
}

/// Paging through months or weeks, with Today, as the web's: in the title bar on a computer; on a phone a row of its
/// own under it, naming what's shown.
struct DateNav: View {
    let label: String
    let earlier: String
    let later: String
    let onEarlier: () -> Void
    let onLater: () -> Void
    let onToday: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onEarlier) { Image(systemName: "chevron.left").frame(width: 32, height: 32).contentShape(Rectangle()) }
                .help(earlier).accessibilityLabel(earlier)
            Text(label).font(.headline).frame(maxWidth: .infinity)
            Button(action: onLater) { Image(systemName: "chevron.right").frame(width: 32, height: 32).contentShape(Rectangle()) }
                .help(later).accessibilityLabel(later)
            Button("Today", action: onToday).buttonStyle(.bordered)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }
}

/// The toolbar's Today and arrows on a computer, as the web's title bar.
struct DateNavButtons: ToolbarContent {
    let earlier: String
    let later: String
    let onEarlier: () -> Void
    let onLater: () -> Void
    let onToday: () -> Void
    let other: (String, String, Page)

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button("Today", action: onToday)
            Button(action: onEarlier) { Label(earlier, systemImage: "chevron.left") }.help(earlier)
            Button(action: onLater) { Label(later, systemImage: "chevron.right") }.help(later)
            OtherDatedPage(title: other.0, icon: other.1, page: other.2)
        }
    }
}

struct OtherDatedPage: View {
    @Environment(AppModel.self) private var model
    let title: String
    let icon: String
    let page: Page
    var body: some View { Button { model.page = page } label: { Label(title, systemImage: icon) }.help(title) }
}

/// The month as a calendar with the todos on it, as the web app's: each from its start to its due date in rows that
/// keep a span on one line through its week, named on its first day and at the start of each week, dragged to another
/// day to move it. A day is picked by pressing it: its todos, and a box to add one due that day, show under the month.
/// On a phone, where a day is too narrow for names, a day shows how many it has.
struct CalendarPage: View {
    @Environment(AppModel.self) private var model
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var month = DateKey.monthKey(DateKey.today())
    @State private var picked: String?
    @State private var filter = StreamFilter(type: .todo)
    static let shownLanes = 3

    private var narrow: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    var body: some View {
        let all = Span.of(model.datedTodos(filter))
        let weekStart = Calendar.current.firstWeekday
        let grid = DateKey.monthGrid(month, weekStart: weekStart)
        let weeks = (0..<6).map { Array(grid[($0 * 7)..<($0 * 7 + 7)]) }
        let day = picked ?? (DateKey.monthKey(model.today) == month ? model.today : month + "-01")
        let diaryDays = Set(model.index.live.filter { $0.isEntry && $0.vaultId == model.diaryVault?.id }.map(Stream.entryDay))
        VStack(spacing: 0) {
            FilterChipsForDated(filter: $filter)
            if narrow { nav }
            ScrollView {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 3) {
                        ForEach(grid.prefix(7), id: \.self) { d in
                            Text(DateKey.date(d).map { $0.formatted(.dateTime.weekday(.abbreviated)) } ?? "").font(.caption).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
                        }
                    }
                    ForEach(weeks, id: \.first) { week in
                        MonthWeek(week: week, month: month, all: all, picked: day, diaryDays: diaryDays, narrow: narrow) { picked = $0; if DateKey.monthKey($0) != month { month = DateKey.monthKey($0) } }
                    }
                    DayAgenda(day: day, all: all).padding(.top, 18)
                }
                .padding(16)
            }
        }
        .pageBackground()
        .navigationTitle(narrow ? "Calendar" : DateKey.formatMonth(month))
        .toolbar {
            if !narrow {
                DateNavButtons(earlier: "Previous month", later: "Next month", onEarlier: { month = DateKey.addMonths(month, -1); picked = nil },
                    onLater: { month = DateKey.addMonths(month, 1); picked = nil }, onToday: { month = DateKey.monthKey(model.today); picked = model.today },
                    other: ("Timeline: todos as bars from start to due", "align.horizontal.left", .timeline))
            }
        }
    }

    private var nav: some View {
        DateNav(label: DateKey.formatMonth(month), earlier: "Previous month", later: "Next month",
            onEarlier: { month = DateKey.addMonths(month, -1); picked = nil }, onLater: { month = DateKey.addMonths(month, 1); picked = nil },
            onToday: { month = DateKey.monthKey(model.today); picked = model.today })
    }
}

/// One week of the month: its days, and its todos' bars laid across them in rows.
struct MonthWeek: View {
    @Environment(AppModel.self) private var model
    let week: [String]
    let month: String
    let all: [Span]
    let picked: String
    let diaryDays: Set<String>
    let narrow: Bool
    let pick: (String) -> Void
    @State private var over: String?

    static let head: CGFloat = 28
    static let lane: CGFloat = 22

    var body: some View {
        let rows = Span.lanes(week, all)
        let shown = Array(rows.prefix(CalendarPage.shownLanes))
        GeometryReader { geo in
            let col = (geo.size.width - 18) / 7
            ZStack(alignment: .topLeading) {
                HStack(spacing: 3) {
                    ForEach(week, id: \.self) { d in
                        let items = rows.compactMap { lane in lane.first { $0.from <= d && d <= $0.to } }
                        let more = items.count - shown.filter { lane in lane.contains { $0.from <= d && d <= $0.to } }.count
                        dayCell(d, count: items.count, more: narrow ? 0 : more)
                    }
                }
                if !narrow {
                    ForEach(Array(shown.enumerated()), id: \.offset) { n, lane in
                        ForEach(lane) { span in
                            if let place = span.place(in: week) {
                                bar(span, at: place.at, length: place.length, col: col)
                                    .offset(x: CGFloat(place.at) * (col + 3) + (span.from >= week[0] ? 4 : 0), y: Self.head + CGFloat(n) * Self.lane)
                            }
                        }
                    }
                }
            }
        }
        .frame(height: narrow ? 52 : max(96, Self.head + CGFloat(shown.count) * Self.lane + (rows.count > shown.count ? 18 : 0) + 8))
    }

    private func dayCell(_ d: String, count: Int, more: Int) -> some View {
        let today = d == model.today
        return VStack(alignment: narrow ? .center : .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text(String(Int(d.suffix(2)) ?? 0))
                    .font(.system(size: 13, weight: today ? .semibold : .regular))
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Circle().fill(today ? Theme.accent : .clear))
                    .foregroundStyle(today ? Theme.onAccent : DateKey.monthKey(d) == month ? Theme.text : Theme.muted)
                if diaryDays.contains(d) { Circle().fill(Theme.accent).frame(width: 5, height: 5).help("Written in the diary") }
            }
            .padding(.horizontal, narrow ? 0 : 6)
            .frame(maxWidth: .infinity, alignment: narrow ? .center : .leading)
            if narrow && count > 0 { Text("\(count)").font(.caption.weight(.semibold)).foregroundStyle(Theme.accent) }
            Spacer(minLength: 0)
            if more > 0 { Text("+\(more) more").font(.system(size: 11)).foregroundStyle(Theme.muted).padding(.horizontal, 6).padding(.bottom, 4) }
        }
        .padding(.top, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 9).fill(over == d ? Theme.accentSoft : DateKey.monthKey(d) == month ? Theme.surface : Theme.surface.opacity(0.45)))
        .overlay { if d == picked { RoundedRectangle(cornerRadius: 9).strokeBorder(Theme.accent, lineWidth: 2) } }
        .contentShape(Rectangle())
        .onTapGesture { pick(d) }
        .contextMenu {
            Button("Written this day") { model.page = .journal(StreamFilter(when: d)) }
            if let diary = model.diaryVault { Button("Diary for this day") { model.page = .journal(StreamFilter(when: d, vaultId: diary.id)) } }
        }
        .dropDestination(for: String.self) { items, _ in
            guard let parts = items.first?.split(separator: "|"), parts.count == 2 else { return false }
            model.shift(String(parts[0]), by: DateKey.daysBetween(String(parts[1]), d))
            return true
        } isTargeted: { over = $0 ? d : (over == d ? nil : over) }
    }

    private func bar(_ span: Span, at: Int, length: Int, col: CGFloat) -> some View {
        let starts = span.from >= week[0]
        let ends = span.to <= week[6]
        let width = CGFloat(length) * (col + 3) - 3 - (starts ? 4 : 0) - (ends ? 4 : 0)
        // Its time, on the day it's due, where its name is: a todo on one day of this week.
        let time = span.card.dueTime.flatMap { max(span.from, week[0]) == span.to ? $0 : nil }
        return HStack(spacing: 4) {
            if let time { Text(time).foregroundStyle(Theme.muted).monospacedDigit() }
            Text(span.card.displayTitle).foregroundStyle(span.card.isDone ? Theme.muted : Theme.text)
        }
        .font(.system(size: 12))
        .lineLimit(1)
        .padding(.horizontal, 6)
        .frame(width: max(8, width), height: 20, alignment: .leading)
        .background(UnevenRoundedRectangle(topLeadingRadius: starts ? 6 : 0, bottomLeadingRadius: starts ? 6 : 0, bottomTrailingRadius: ends ? 6 : 0, topTrailingRadius: ends ? 6 : 0).fill(span.fill))
        .opacity(span.card.isDone ? 0.7 : 1)
        .contentShape(Rectangle())
        .onTapGesture { model.openEntry = span.card.id }
        .draggable("\(span.card.id)|\(max(span.from, week[0]))")
        .help(span.card.displayTitle + (span.from != span.to ? " (\(DateKey.formatDay(span.from)) – \(DateKey.formatDay(span.to)))" : ""))
    }
}

/// The picked day under the month: its todos, ticked or opened from here, and a box to add one due that day.
struct DayAgenda: View {
    @Environment(AppModel.self) private var model
    let day: String
    let all: [Span]
    @State private var text = ""

    var body: some View {
        let items = all.filter { $0.from <= day && day <= $0.to }
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(DateKey.relativeDay(day, today: model.today)).font(.system(size: 18, weight: .semibold, design: .serif))
                Spacer()
                Button("Written this day") { model.page = .journal(StreamFilter(when: day)) }.buttonStyle(.plain).font(.footnote.weight(.medium)).foregroundStyle(Theme.accent)
            }
            .padding(.bottom, 6)
            if items.isEmpty { Text("Nothing due or under way.").foregroundStyle(Theme.muted).padding(.vertical, 4) }
            ForEach(items) { span in
                HStack(spacing: 8) {
                    TodoCheck(card: span.card)
                    Button { model.openEntry = span.card.id } label: {
                        Text(span.card.displayTitle).foregroundStyle(span.card.isDone ? Theme.muted : Theme.text).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    Text(span.from != span.to ? "\(DateKey.relativeDay(span.from, today: model.today)) – \(DateKey.relativeDay(span.to, today: model.today))" : span.card.dueTime ?? "")
                        .font(.footnote).foregroundStyle(Theme.muted)
                }
                .padding(.vertical, 6)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
            }
            if !model.viewOnly {
                HStack(spacing: 8) {
                    Image(systemName: "plus").foregroundStyle(Theme.muted)
                    TextField("Add a todo due \(DateKey.relativeDayInSentence(day, today: model.today))", text: $text)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.surface))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.line))
                        .onSubmit(add)
                }
                .padding(.top, 8)
            }
        }
    }

    private func add() {
        let typed = text
        guard !typed.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let entries = EntryParser.parseEntries(typed, today: model.today, allTodos: true)
        Task {
            switch await model.save(entries, SaveOptions(due: day)) {
            case .saved: if text == typed { text = "" }
            case .unlock: model.say("Unlock the vault first.")
            case .nothing: break
            }
        }
    }
}

/// The calendar's and timeline's filter: a todo status, and the sidebar's tag and vault.
struct FilterChipsForDated: View {
    @Binding var filter: StreamFilter

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                FilterChip(label: filter.status.flatMap { StreamLabels.status[$0] } ?? "Todos", set: filter.status != nil, clear: { filter.status = nil }) {
                    ForEach([StreamFilter.TodoStatus.open, .done, .today, .upcoming, .waiting], id: \.self) { s in Button(StreamLabels.status[s]!) { filter.status = s } }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }
}

/// Todos as bars on a run of weeks, as the web app's Timeline: one row each, its name in a column on the left, from
/// its start date to its due date, or a short bar on the day it has. A bar is dragged to move both dates, or by an
/// end to change one. The arrows move two weeks at a time.
struct TimelinePage: View {
    @Environment(AppModel.self) private var model
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var from: String?
    @State private var filter = StreamFilter(type: .todo)
    static let day: CGFloat = 34
    static let length = 56
    static let step = 14

    private var narrow: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    private var names: CGFloat { narrow ? 110 : 180 }

    static func weekOf(_ day: String) -> String {
        guard let date = DateKey.date(day) else { return day }
        let offset = (Calendar.current.component(.weekday, from: date) - Calendar.current.firstWeekday + 7) % 7
        return DateKey.adding(-offset, to: day)
    }

    var body: some View {
        let start = from ?? DateKey.adding(-7, to: Self.weekOf(model.today))
        let days = (0..<Self.length).map { DateKey.adding($0, to: start) }
        let rows = Span.of(model.datedTodos(filter)).compactMap { s in s.place(in: days).map { (span: s, at: $0.at, length: $0.length) } }
        let label = "\(DateKey.formatDay(days[0])) – \(DateKey.formatDay(days[days.count - 1]))"
        VStack(spacing: 0) {
            FilterChipsForDated(filter: $filter)
            if narrow { DateNav(label: label, earlier: "Two weeks earlier", later: "Two weeks later", onEarlier: { from = DateKey.adding(-Self.step, to: start) }, onLater: { from = DateKey.adding(Self.step, to: start) }, onToday: { from = nil }) }
            if rows.isEmpty {
                ContentUnavailableView("No todos with dates in these weeks", systemImage: "align.horizontal.left", description: Text("Give a todo a due date, and a start date for one that takes days."))
            } else {
                ScrollView(.vertical) {
                    HStack(alignment: .top, spacing: 0) {
                        VStack(alignment: .leading, spacing: 0) {
                            Color.clear.frame(height: 46)
                            ForEach(rows, id: \.span.id) { row in
                                Button { model.openEntry = row.span.card.id } label: {
                                    Text(row.span.card.displayTitle).font(.system(size: 14)).lineLimit(1)
                                        .foregroundStyle(row.span.card.isDone ? Theme.muted : Theme.text)
                                        .padding(.horizontal, 10)
                                        .frame(width: names, height: 32, alignment: .leading)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .overlay(alignment: .trailing) { Rectangle().fill(Theme.line).frame(width: 1) }
                        ScrollView(.horizontal) {
                            VStack(alignment: .leading, spacing: 0) {
                                TimelineHead(days: days)
                                ZStack(alignment: .topLeading) {
                                    HStack(spacing: 0) {
                                        ForEach(days, id: \.self) { d in
                                            Rectangle().fill(TimelineHead.weekend(d) ? Theme.sunken.opacity(0.6) : .clear).frame(width: Self.day)
                                        }
                                    }
                                    if let at = days.firstIndex(of: model.today) {
                                        Rectangle().fill(Theme.accent.opacity(0.5)).frame(width: 2).offset(x: (CGFloat(at) + 0.5) * Self.day - 1)
                                    }
                                    VStack(alignment: .leading, spacing: 0) {
                                        ForEach(rows, id: \.span.id) { row in
                                            TimelineBar(span: row.span, at: row.at, length: row.length, days: days).frame(height: 32, alignment: .topLeading)
                                        }
                                    }
                                }
                                .frame(height: CGFloat(rows.count) * 32 + 8)
                            }
                            .frame(width: CGFloat(Self.length) * Self.day)
                        }
                        .defaultScrollAnchor(.leading)
                    }
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.surface))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(16)
                }
            }
        }
        .pageBackground()
        .navigationTitle("Timeline")
        .toolbar {
            if !narrow {
                DateNavButtons(earlier: "Two weeks earlier", later: "Two weeks later", onEarlier: { from = DateKey.adding(-Self.step, to: start) },
                    onLater: { from = DateKey.adding(Self.step, to: start) }, onToday: { from = nil },
                    other: ("Month calendar", "calendar", .calendar))
            }
        }
    }
}

/// The timeline's days: the month's name on its first and on the first shown, a weekday's letter, the date; weekends
/// shaded and today in the accent.
struct TimelineHead: View {
    @Environment(AppModel.self) private var model
    let days: [String]

    static func weekend(_ d: String) -> Bool {
        guard let date = DateKey.date(d) else { return false }
        return Calendar.current.isDateInWeekend(date)
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.element) { i, d in
                let date = DateKey.date(d) ?? Date()
                let today = d == model.today
                VStack(spacing: 0) {
                    Text(date.formatted(.dateTime.weekday(.narrow))).font(.system(size: 10))
                    Text(String(Int(d.suffix(2)) ?? 0)).font(.system(size: 12, weight: today ? .bold : .regular)).monospacedDigit()
                }
                .foregroundStyle(today ? Theme.accent : Theme.muted)
                .padding(.top, 18).padding(.bottom, 4)
                .frame(width: TimelinePage.day)
                .background(Self.weekend(d) ? Theme.sunken.opacity(0.6) : .clear)
                .overlay(alignment: .topLeading) {
                    if i == 0 || d.hasSuffix("-01") {
                        Text(date.formatted(.dateTime.month(.abbreviated))).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.text)
                            .fixedSize().padding(.leading, 4).padding(.top, 2)
                    }
                }
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}

struct TimelineBar: View {
    @Environment(AppModel.self) private var model
    let span: Span
    let at: Int
    let length: Int
    let days: [String]
    @State private var drag: CGFloat = 0
    @State private var stretchEnd: CGFloat = 0
    @State private var stretchStart: CGFloat = 0

    var body: some View {
        let w = TimelinePage.day
        let movable = model.canEdit(span.card)
        let cutStart = span.from < days[0]
        let cutEnd = span.to > days[days.count - 1]
        let shownLength = CGFloat(length) * w
        let width = max(8, shownLength - 4 - stretchStart + stretchEnd)
        HStack(spacing: 0) {
            if movable { handle { stretchStart = $0 } end: { model.stretch(span.card.id, end: false, by: Self.days($0)); stretchStart = 0 } }
            Text(width > 2 * w ? span.card.displayTitle : "").font(.system(size: 12)).lineLimit(1).padding(.horizontal, 8).frame(maxWidth: .infinity, alignment: .leading)
            if movable { handle { stretchEnd = $0 } end: { model.stretch(span.card.id, end: true, by: Self.days($0)); stretchEnd = 0 } }
        }
        .frame(width: width, height: 22)
        .background(UnevenRoundedRectangle(topLeadingRadius: cutStart ? 0 : 7, bottomLeadingRadius: cutStart ? 0 : 7, bottomTrailingRadius: cutEnd ? 0 : 7, topTrailingRadius: cutEnd ? 0 : 7).fill(span.fill))
        .opacity(span.card.isDone ? 0.55 : 1)
        .offset(x: CGFloat(at) * w + 2 + drag + stretchStart, y: 5)
        .gesture(movable ? DragGesture(minimumDistance: 4).onChanged { drag = $0.translation.width }.onEnded { v in
            model.shift(span.card.id, by: Self.days(v.translation.width))
            drag = 0
        } : nil)
        .onTapGesture { model.openEntry = span.card.id }
        .help(span.from == span.to ? DateKey.formatDay(span.to) : "\(DateKey.formatDay(span.from)) – \(DateKey.formatDay(span.to))")
    }

    static func days(_ x: CGFloat) -> Int { Int((x / TimelinePage.day).rounded()) }

    private func handle(change: @escaping (CGFloat) -> Void, end: @escaping (CGFloat) -> Void) -> some View {
        Rectangle().fill(Color.clear).frame(width: 7).contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 2).onChanged { change($0.translation.width) }.onEnded { end($0.translation.width) })
            #if os(macOS)
            .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            #endif
    }
}
