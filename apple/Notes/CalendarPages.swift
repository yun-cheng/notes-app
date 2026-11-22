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

/// A month of todos on their days, each from its start to its due date, dragged to another day to move it, as the
/// web app's Calendar. A double-click on a day opens the journal for that day.
struct CalendarPage: View {
    @Environment(AppModel.self) private var model
    @State private var month = DateKey.monthKey(DateKey.today())
    @State private var filter = StreamFilter(type: .todo)

    var body: some View {
        let todos = model.datedTodos(filter)
        let weekStart = Calendar.current.firstWeekday
        let days = DateKey.monthGrid(month, weekStart: weekStart)
        let symbols = Calendar.current.shortWeekdaySymbols
        let diaryDays = Set(model.index.live.filter { $0.isEntry && $0.vaultId == model.diaryVault?.id }.map(Stream.entryDay))
        VStack(spacing: 0) {
            FilterChipsForDated(filter: $filter)
            ScrollView {
                VStack(spacing: 8) {
                    HStack {
                        Button { month = DateKey.addMonths(month, -1) } label: { Image(systemName: "chevron.left") }
                        Text(DateKey.formatMonth(month)).font(.title3.weight(.semibold)).frame(maxWidth: .infinity)
                        Button { month = DateKey.addMonths(month, 1) } label: { Image(systemName: "chevron.right") }
                        Button("Today") { month = DateKey.monthKey(model.today) }
                    }
                    .buttonStyle(.borderless)
                    Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                        GridRow { ForEach(0..<7, id: \.self) { Text(symbols[(weekStart - 1 + $0) % 7]).font(.caption).foregroundStyle(Theme.muted) } }
                        ForEach(0..<6, id: \.self) { row in
                            GridRow {
                                ForEach(days[(row * 7)..<(row * 7 + 7)], id: \.self) { day in
                                    DayCell(
                                        day: day, inMonth: DateKey.monthKey(day) == month,
                                        todos: todos.filter { $0.span.map { $0.from <= day && day <= $0.to } ?? false }, diary: diaryDays.contains(day))
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
        }
        .pageBackground()
        .navigationTitle("Calendar")
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

struct DayCell: View {
    @Environment(AppModel.self) private var model
    let day: String
    let inMonth: Bool
    let todos: [Card]
    var diary = false
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                Text(String(Int(day.suffix(2)) ?? 0))
                    .font(.caption.weight(day == model.today ? .bold : .regular))
                    .foregroundStyle(day == model.today ? Theme.accent : inMonth ? Theme.text : Theme.muted)
                if diary { Circle().fill(Theme.accent).frame(width: 4, height: 4).help("Something in the diary") }
            }
            ForEach(todos.prefix(3)) { todo in
                Text(todo.title).font(.caption2).lineLimit(1).strikethrough(todo.isDone)
                    .padding(.horizontal, 3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 3).fill(todo.isOverdue(today: model.today) ? Theme.alert.opacity(0.2) : Theme.accentSoft))
                    .onTapGesture { model.openEntry = todo.id }
                    .draggable("\(todo.id)|\(day)")
            }
            if todos.count > 3 { Text("+\(todos.count - 3)").font(.caption2).foregroundStyle(Theme.muted) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 6).fill(targeted ? Theme.accentSoft : inMonth ? Theme.surface : Theme.bg))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { model.page = .journal(StreamFilter(when: day)) }
        .contextMenu {
            Button("Open this day in the journal") { model.page = .journal(StreamFilter(when: day)) }
            if let diary = model.diaryVault { Button("Diary for this day") { model.page = .journal(StreamFilter(when: day, vaultId: diary.id)) } }
        }
        .dropDestination(for: String.self) { items, _ in
            // A todo dragged here moves by as many days as it was dragged, start and all.
            guard let parts = items.first?.split(separator: "|"), parts.count == 2 else { return false }
            model.shift(String(parts[0]), by: DateKey.daysBetween(String(parts[1]), day))
            return true
        } isTargeted: { targeted = $0 }
    }
}

/// Todos with dates as bars from their start to their due date, dragged to move them and stretched at either end,
/// as the web app's Timeline.
struct TimelinePage: View {
    @Environment(AppModel.self) private var model
    @State private var first = DateKey.adding(-7, to: DateKey.today())
    @State private var filter = StreamFilter(type: .todo, status: .open)
    static let dayWidth: CGFloat = 30
    static let days = 70

    var body: some View {
        let todos = model.datedTodos(filter).sorted { ($0.span!.from, $0.span!.to) < ($1.span!.from, $1.span!.to) }
        let last = DateKey.adding(Self.days - 1, to: first)
        VStack(spacing: 0) {
            HStack {
                FilterChipsForDated(filter: $filter)
                Spacer()
                Button { first = DateKey.adding(-28, to: first) } label: { Image(systemName: "chevron.left") }
                Button("Today") { first = DateKey.adding(-7, to: model.today) }
                Button { first = DateKey.adding(28, to: first) } label: { Image(systemName: "chevron.right") }
            }
            .buttonStyle(.borderless)
            .padding(.trailing, 16)
            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 0) {
                        ForEach(0..<Self.days, id: \.self) { i in
                            let day = DateKey.adding(i, to: first)
                            VStack(spacing: 0) {
                                if day.hasSuffix("-01") || i == 0 { Text(DateKey.formatMonth(DateKey.monthKey(day))).font(.caption2).fixedSize() } else { Text(" ").font(.caption2) }
                                Text(String(Int(day.suffix(2)) ?? 0)).font(.caption2)
                            }
                            .foregroundStyle(day == model.today ? Theme.accent : Theme.muted)
                            .frame(width: Self.dayWidth, alignment: .leading)
                        }
                    }
                    ForEach(todos.filter { $0.span!.to >= first && $0.span!.from <= last }) { todo in
                        TimelineBar(todo: todo, first: first)
                    }
                }
                .padding(16)
            }
        }
        .pageBackground()
        .navigationTitle("Timeline")
    }
}

struct TimelineBar: View {
    @Environment(AppModel.self) private var model
    let todo: Card
    let first: String
    @State private var drag: CGFloat = 0
    @State private var stretchEnd: CGFloat = 0
    @State private var stretchStart: CGFloat = 0

    var body: some View {
        let w = TimelinePage.dayWidth
        let span = todo.span!
        let offset = CGFloat(DateKey.daysBetween(first, span.from)) * w
        let length = CGFloat(DateKey.daysBetween(span.from, span.to) + 1) * w
        HStack(spacing: 0) {
            handle { stretchStart = $0 } end: { model.stretch(todo.id, end: false, by: Self.days($0)); stretchStart = 0 }
            Text(todo.title).font(.caption).lineLimit(1).padding(.horizontal, 4).frame(maxWidth: .infinity, alignment: .leading)
            handle { stretchEnd = $0 } end: { model.stretch(todo.id, end: true, by: Self.days($0)); stretchEnd = 0 }
        }
        .frame(width: max(w, length - 2 - stretchStart + stretchEnd), height: 24)
        .background(RoundedRectangle(cornerRadius: 6).fill(todo.isOverdue(today: model.today) ? Theme.alert.opacity(0.3) : todo.isDone ? Theme.sunken : Theme.accentSoft))
        .offset(x: offset + drag + stretchStart)
        .gesture(DragGesture(minimumDistance: 4).onChanged { drag = $0.translation.width }.onEnded { v in
            model.shift(todo.id, by: Self.days(v.translation.width))
            drag = 0
        })
        .onTapGesture { model.openEntry = todo.id }
        .help(todo.title)
    }

    static func days(_ x: CGFloat) -> Int { Int((x / TimelinePage.dayWidth).rounded()) }

    private func handle(change: @escaping (CGFloat) -> Void, end: @escaping (CGFloat) -> Void) -> some View {
        Rectangle().fill(Color.clear).frame(width: 8).contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 2).onChanged { change($0.translation.width) }.onEnded { end($0.translation.width) })
            #if os(macOS)
            .onHover { inside in if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() } }
            #endif
    }
}
