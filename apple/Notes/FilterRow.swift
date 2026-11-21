import NotesKit
import SwiftUI

/// The row under the title bar that narrows the journal, as the web app's `FilterPanel`: a switch between All, Notes,
/// Todos and Stacks, then chips for todo status, when written and what an entry holds, and Templates. A chip in use
/// names its choice and has an × to take it off; the sidebar's tag and vault show as chips too.
struct FilterRow: View {
    @Environment(AppModel.self) private var model
    @Binding var filter: StreamFilter
    @Binding var pickDates: Bool

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                TypeSwitch(type: Binding(get: { filter.effectiveType }, set: { t in
                    filter.type = t
                    if t != .todo { filter.status = nil }
                }))
                FilterChip(label: filter.status.flatMap { StreamLabels.status[$0] } ?? "Todos", set: filter.status != nil, clear: { filter.status = nil }) {
                    ForEach(StreamFilter.TodoStatus.allCases, id: \.self) { s in
                        Button(StreamLabels.status[s]!) { filter.status = s }
                    }
                }
                FilterChip(label: filter.when.map { StreamLabels.when($0, today: model.today) } ?? "Written", set: filter.when != nil, clear: { filter.when = nil }) {
                    Button("Written today") { filter.when = "today" }
                    Button("Past 7 days") { filter.when = "week" }
                    Button("Past 30 days") { filter.when = "month" }
                    Divider()
                    Button("Pick dates…") { pickDates = true }
                }
                FilterChip(label: filter.has.flatMap { StreamLabels.contains[$0] } ?? "Contains", set: filter.has != nil, clear: { filter.has = nil }) {
                    ForEach(StreamFilter.Contains.allCases, id: \.self) { c in Button(StreamLabels.contains[c]!) { filter.has = c } }
                }
                ToggleChip(label: "Templates", on: filter.template) { filter.template.toggle() }
                if let tag = filter.tagId {
                    SetChip(label: model.card(tag)?.displayTitle ?? "Tag", icon: "tag") { filter.tagId = nil }
                }
                if let vault = filter.vaultId {
                    SetChip(label: model.vault(vault)?.name ?? "Vault", icon: "tray") { filter.vaultId = nil }
                }
                if filter.archived { SetChip(label: "Archived", icon: "archivebox") { filter.archived = false } }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Theme.line.frame(height: 1) }
    }
}

/// All, Notes, Todos, Stacks.
struct TypeSwitch: View {
    @Binding var type: StreamFilter.EntryType?

    var body: some View {
        HStack(spacing: 2) {
            option("All", nil)
            option("Notes", .note)
            option("Todos", .todo)
            option("Stacks", .stack)
        }
        .padding(2)
        .background(Capsule().fill(Theme.sunken))
    }

    private func option(_ label: String, _ value: StreamFilter.EntryType?) -> some View {
        Button { type = value } label: {
            Text(label)
                .font(.subheadline.weight(type == value ? .semibold : .regular))
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(Capsule().fill(type == value ? Theme.raised : .clear))
                .foregroundStyle(type == value ? Theme.text : Theme.muted)
        }
        .buttonStyle(.plain)
    }
}

/// A chip that opens a menu of choices; once one is picked it's tinted, names it, and has an × to take it off.
struct FilterChip<Items: View>: View {
    let label: String
    let set: Bool
    let clear: () -> Void
    @ViewBuilder let items: () -> Items

    var body: some View {
        HStack(spacing: 2) {
            Menu {
                items()
            } label: {
                HStack(spacing: 4) {
                    Text(label)
                    Image(systemName: "chevron.down").imageScale(.small)
                }
                .padding(.leading, 10)
                .padding(.trailing, set ? 2 : 8)
                .frame(minHeight: 26)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .buttonStyle(.plain)
            .fixedSize()
            if set {
                Button(action: clear) { Image(systemName: "xmark").imageScale(.small).padding(.trailing, 8) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
            }
        }
        .font(.subheadline.weight(set ? .medium : .regular))
        .foregroundStyle(set ? Theme.text : Theme.muted)
        .background(Capsule().fill(set ? Theme.accentSoft : Theme.sunken))
    }
}

struct ToggleChip: View {
    let label: String
    let on: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            Text(label)
                .font(.subheadline.weight(on ? .medium : .regular))
                .padding(.horizontal, 10)
                .frame(minHeight: 26)
                .background(Capsule().fill(on ? Theme.accentSoft : Theme.sunken))
                .foregroundStyle(on ? Theme.text : Theme.muted)
        }
        .buttonStyle(.plain)
    }
}

/// A chip for a part of the filter set elsewhere (the sidebar's tag or vault), with an × to take it off.
struct SetChip: View {
    let label: String
    let icon: String
    let clear: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).imageScale(.small)
            Text(label)
            Button(action: clear) { Image(systemName: "xmark").imageScale(.small) }.buttonStyle(.plain)
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 10)
        .frame(minHeight: 26)
        .background(Capsule().fill(Theme.accentSoft))
    }
}

/// Picks a day or a range of days, as the web app's `DatesDialog`: a first press picks a day, the next the other end.
struct DatesDialog: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding var filter: StreamFilter
    @State private var month = DateKey.monthKey(DateKey.today())
    @State private var from: String?
    @State private var to: String?

    var body: some View {
        let days = Set(model.index.live.filter(\.isEntry).map(Stream.entryDay))
        VStack(spacing: 12) {
            HStack {
                Button { month = DateKey.addMonths(month, -1) } label: { Image(systemName: "chevron.left") }
                Spacer()
                Text(DateKey.formatMonth(month)).font(.headline)
                Spacer()
                Button { month = DateKey.addMonths(month, 1) } label: { Image(systemName: "chevron.right") }
            }
            .buttonStyle(.borderless)
            MonthGrid(month: month, marked: days, selected: range) { day in
                if from == nil || to != nil {
                    from = day
                    to = nil
                } else {
                    to = day
                }
            }
            Text(summary).font(.subheadline).foregroundStyle(Theme.muted)
            HStack {
                Button("Cancel") { dismiss() }
                Spacer()
                Button("Show") {
                    if let from { filter.when = Stream.daysWhen(from, to ?? from) }
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(from == nil)
            }
        }
        .padding(20)
        .frame(minWidth: 320)
        .onAppear {
            if let when = filter.when, DateKey.isKey(when) || Stream.dayRange(when) != nil {
                let (a, b) = Stream.whenRange(when, today: model.today)
                from = a
                to = b == a ? nil : b
                month = DateKey.monthKey(a)
            }
        }
    }

    private var range: ClosedRange<String>? {
        guard let from else { return nil }
        let end = to ?? from
        return min(from, end)...max(from, end)
    }

    private var summary: String {
        guard let from else { return "Pick a day, then another for a range." }
        return StreamLabels.when(Stream.daysWhen(from, to ?? from), today: model.today)
    }
}

/// Six weeks of a month, each day a button, days with something marked by a dot.
struct MonthGrid: View {
    let month: String
    let marked: Set<String>
    let selected: ClosedRange<String>?
    let pick: (String) -> Void

    var body: some View {
        let weekStart = Calendar.current.firstWeekday
        let days = DateKey.monthGrid(month, weekStart: weekStart)
        let symbols = Calendar.current.veryShortWeekdaySymbols
        let names = (0..<7).map { symbols[(weekStart - 1 + $0) % 7] }
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            GridRow { ForEach(names.indices, id: \.self) { Text(names[$0]).font(.caption).foregroundStyle(Theme.muted) } }
            ForEach(0..<6, id: \.self) { row in
                GridRow {
                    ForEach(days[(row * 7)..<(row * 7 + 7)], id: \.self) { day in
                        let inMonth = DateKey.monthKey(day) == month
                        let isSelected = selected?.contains(day) ?? false
                        Button { pick(day) } label: {
                            VStack(spacing: 1) {
                                Text(String(Int(day.suffix(2)) ?? 0))
                                Circle().fill(marked.contains(day) ? Theme.accent : .clear).frame(width: 4, height: 4)
                            }
                            .frame(width: 34, height: 34)
                            .background(RoundedRectangle(cornerRadius: 8).fill(isSelected ? Theme.accentSoft : .clear))
                            .foregroundStyle(inMonth ? Theme.text : Theme.muted.opacity(0.6))
                            .fontWeight(day == DateKey.today() ? .bold : .regular)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}
