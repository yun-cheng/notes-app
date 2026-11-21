import Foundation

/// The rest of the web app's `dates.ts`: local calendar days as `YYYY-MM-DD` keys, and times of day as `HH:MM`.
extension DateKey {
    public static func isKey(_ s: String?) -> Bool {
        guard let s, s.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil, let d = date(s) else { return false }
        return of(d) == s
    }

    /// How many days from one date key to another: 1 from today to tomorrow.
    public static func daysBetween(_ from: String, _ to: String, calendar: Calendar = .current) -> Int {
        guard let a = date(from, calendar: calendar), let b = date(to, calendar: calendar) else { return 0 }
        return calendar.dateComponents([.day], from: a, to: b).day ?? 0
    }

    public static func monthKey(_ key: String) -> String { String(key.prefix(7)) }

    public static func addMonths(_ month: String, _ delta: Int, calendar: Calendar = .current) -> String {
        guard let first = date("\(month)-01", calendar: calendar), let d = calendar.date(byAdding: .month, value: delta, to: first) else { return month }
        return monthKey(of(d, calendar: calendar))
    }

    /// Six rows of seven date keys covering the month. `weekStart`: 1 = Sunday, 2 = Monday (Calendar's numbering).
    public static func monthGrid(_ month: String, weekStart: Int, calendar: Calendar = .current) -> [String] {
        guard let first = date("\(month)-01", calendar: calendar) else { return [] }
        let offset = (calendar.component(.weekday, from: first) - weekStart + 7) % 7
        let start = adding(-offset, to: of(first, calendar: calendar), calendar: calendar)
        return (0..<42).map { adding($0, to: start, calendar: calendar) }
    }

    /// Whole months later, on the same day of the month, or the month's last day when it's shorter (Jan 31 → Feb 28).
    public static func addMonthsClamped(_ key: String, _ months: Int, calendar: Calendar = .current) -> String {
        guard let d = date(key, calendar: calendar), let moved = calendar.date(byAdding: .month, value: months, to: d) else { return key }
        // Calendar already clamps to the month's last day.
        return of(moved, calendar: calendar)
    }

    public static func weekday(_ key: String, calendar: Calendar = .current) -> Int {
        date(key, calendar: calendar).map { calendar.component(.weekday, from: $0) } ?? 1
    }

    /// "Today", "Tomorrow", "Yesterday", or a short date, with the year when it isn't this one.
    public static func relativeDay(_ key: String, today: String, locale: Locale = .current) -> String {
        if key == today { return "Today" }
        if key == adding(1, to: today) { return "Tomorrow" }
        if key == adding(-1, to: today) { return "Yesterday" }
        guard let d = date(key) else { return key }
        var style = Date.FormatStyle(locale: locale).weekday(.abbreviated).month(.abbreviated).day()
        if key.prefix(4) != today.prefix(4) { style = style.year() }
        return d.formatted(style)
    }

    /// `relativeDay` for the middle of a sentence: "due today", but "due Tue, Nov 10".
    public static func relativeDayInSentence(_ key: String, today: String) -> String {
        let day = relativeDay(key, today: today)
        return ["Today", "Tomorrow", "Yesterday"].contains(day) ? day.lowercased() : day
    }

    /// "Sunday, November 22, 2026".
    public static func formatDay(_ key: String, locale: Locale = .current) -> String {
        date(key)?.formatted(Date.FormatStyle(locale: locale).weekday(.wide).month(.wide).day().year()) ?? key
    }

    public static func formatMonth(_ month: String, locale: Locale = .current) -> String {
        date("\(month)-01")?.formatted(Date.FormatStyle(locale: locale).month(.wide).year()) ?? month
    }
}

/// Times of day as stored: `HH:MM`, 24-hour, local.
public enum TimeKey {
    public static func isKey(_ s: String?) -> Bool { s?.wholeMatch(of: /([01]\d|2[0-3]):[0-5]\d/) != nil }

    /// `15:00`, `9:30`, `3pm`, `3:30pm`, `9am` or `9a` as a time key. A bare number isn't a time.
    public static func parse(_ word: String) -> String? {
        guard let m = word.wholeMatch(of: /(?i)(\d{1,2})(?::(\d{2}))?([ap]m?)?/) else { return nil }
        if m.2 == nil && m.3 == nil { return nil }
        guard var hour = Int(m.1) else { return nil }
        let minute = m.2.flatMap { Int($0) } ?? 0
        if minute > 59 { return nil }
        if let suffix = m.3 {
            if hour < 1 || hour > 12 { return nil }
            hour = hour % 12 + (suffix.lowercased().hasPrefix("p") ? 12 : 0)
        } else if hour > 23 {
            return nil
        }
        return String(format: "%02d:%02d", hour, minute)
    }

    public static func of(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour!, c.minute!)
    }

    /// "3:00 PM" or "15:00", as the locale writes times.
    public static func format(_ key: String, locale: Locale = .current) -> String {
        let parts = key.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, let d = Calendar.current.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: parts[0], minute: parts[1])) else { return key }
        return d.formatted(Date.FormatStyle(locale: locale).hour().minute())
    }
}

/// Repeating todos. A repeating todo is one card that stays open: ticking it moves its due date to the next time.
extension Repeat {
    public static let maxEvery = 999

    public var isValid: Bool { every >= 1 && every <= Self.maxEvery && (unit != .weekday || every == 1) }

    static func isWeekend(_ key: String) -> Bool {
        let d = DateKey.weekday(key)
        return d == 1 || d == 7
    }

    func step(_ from: String, _ times: Int) -> String {
        switch unit {
        case .day: return DateKey.adding(every * times, to: from)
        case .week: return DateKey.adding(7 * every * times, to: from)
        case .month: return DateKey.addMonthsClamped(from, every * times)
        case .year: return DateKey.addMonthsClamped(from, 12 * every * times)
        case .weekday:
            var day = from
            for _ in 0..<times {
                repeat { day = DateKey.adding(1, to: day) } while Self.isWeekend(day)
            }
            return day
        }
    }

    /// The first due date for a new repeating todo with no date of its own: today, or for weekdays the next weekday.
    public func firstDue(today: String) -> String {
        unit == .weekday && Self.isWeekend(today) ? step(today, 1) : today
    }

    /// The due date after `due` (today when it has none). One that fell behind skips ahead to the first time after
    /// today, keeping its rhythm.
    public func nextDue(after due: String?, today: String) -> String {
        let from = due ?? today
        if unit == .weekday { return step(from > today ? from : today, 1) }
        var times = 1
        var next = step(from, 1)
        // Counted from `from` each time, so a month's day isn't worn down by short months on the way.
        while next <= today {
            times += 1
            next = step(from, times)
        }
        return next
    }

    private var names: (single: String, plural: String) {
        switch unit {
        case .day: ("Daily", "days")
        case .week: ("Weekly", "weeks")
        case .month: ("Monthly", "months")
        case .year: ("Yearly", "years")
        case .weekday: ("Every weekday", "weekdays")
        }
    }

    /// "Weekly", "Every 2 weeks", "Every weekday".
    public var label: String {
        if unit == .weekday { return "Every weekday" }
        return every == 1 ? names.single : "Every \(every) \(names.plural)"
    }

    /// The word `parse` reads back: `weekly`, `every-2-weeks`, `weekdays`.
    public var word: String {
        if unit == .weekday { return "weekdays" }
        return every == 1 ? names.single.lowercased() : "every-\(every)-\(unit.rawValue)s"
    }

    /// `@daily`, `@weekly`, `@monthly`, `@yearly`, `@weekdays`, or `@every-2-weeks`, `@every-day` and the like.
    public static func parse(_ word: String) -> Repeat? {
        let w = word.lowercased()
        let words: [String: Unit] = ["daily": .day, "weekly": .week, "monthly": .month, "yearly": .year, "annually": .year, "weekdays": .weekday]
        if let unit = words[w] { return Repeat(unit: unit, every: 1) }
        guard let m = w.wholeMatch(of: /every-(?:(\d{1,3})-)?(day|week|month|year|weekday)s?/), let unit = Unit(rawValue: String(m.2)) else { return nil }
        let every = m.1.flatMap { Int($0) } ?? 1
        guard every >= 1 else { return nil }
        let r = Repeat(unit: unit, every: every)
        return r.isValid ? r : nil
    }

    /// The choices offered in a todo's Repeat menu.
    public static let choices: [Repeat] = [
        Repeat(unit: .day, every: 1), Repeat(unit: .weekday, every: 1), Repeat(unit: .week, every: 1),
        Repeat(unit: .week, every: 2), Repeat(unit: .month, every: 1), Repeat(unit: .year, every: 1),
    ]
}

extension Card {
    /// Open and past its due date, or due today at a time already gone. A waiting todo never is.
    public func isOverdue(today: String, now: String = TimeKey.of(Date())) -> Bool {
        guard type == .todo, !isDone, !waiting, let due else { return false }
        return due < today || (due == today && dueTime.map { $0 <= now } ?? false)
    }

    /// Ticks an open todo. A repeating one stays open and moves on to its next due date, its start date moving as far.
    /// Either way it's no longer waiting. Returns when it's due next, for a repeating one.
    @discardableResult
    public mutating func complete(today: String, at: Int64) -> String? {
        waiting = false
        guard let rule = self.repeat else {
            payload["status"] = "done"
            payload["completedAt"] = .int(at)
            return nil
        }
        let next = rule.nextDue(after: due, today: today)
        if let start, let due { self.start = DateKey.adding(DateKey.daysBetween(due, next), to: start) }
        due = next
        return next
    }

    public mutating func reopen() {
        payload["status"] = "open"
        payload["completedAt"] = .null
    }
}
