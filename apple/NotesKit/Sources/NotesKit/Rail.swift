import Foundation

/// The rail beside a long page of entries, as a photo library has, as the web's `rail.ts`: marks for the years (or
/// months, or groups) down its length, a thumb at where the page is, and a label for the place pointed at or dragged
/// to. Each item has a key, the day it's under (or what else groups it, a tag), and an equal share of the rail, in the
/// order the page shows them, top to bottom.
public enum Rail {
    /// A mark on the rail, a fraction of the way down: a label, or a dot where there's no room or need for one.
    public struct Mark: Equatable, Sendable {
        public var at: Double
        public var label: String?
    }

    /// How the items are told apart: by year, by month or by day, when they're all under days; else by what groups them.
    public enum Scale: Sendable { case year, month, day, name }

    /// The labels' least room between them, and the dots', in points.
    static let labelGap = 22.0
    static let dotGap = 9.0

    public static func scale(_ keys: [String]) -> Scale {
        var years = Set<Substring>()
        var months = Set<Substring>()
        for key in keys {
            // A day, or none (a todo with no due date), sorted among days.
            if key.isEmpty { continue }
            if !DateKey.isKey(key) { return .name }
            years.insert(key.prefix(4))
            months.insert(key.prefix(7))
        }
        return years.count > 1 ? .year : months.count > 1 ? .month : .day
    }

    private static func formatted(_ key: String, _ style: Date.FormatStyle) -> String {
        DateKey.date(key)?.formatted(style) ?? key
    }

    /// What the place an item is at is called, pointed at or dragged to: its month on a rail of years, else its own name.
    public static func label(_ key: String, scale: Scale, name: (String) -> String, locale: Locale = .current) -> String {
        scale == .year && DateKey.isKey(key) ? formatted(key, Date.FormatStyle(locale: locale).month(.abbreviated).year()) : name(key)
    }

    /// The marks for a rail `height` points tall: a label where each year starts (on a rail of years), each month (of
    /// months) or each group, with a dot for each month among years and each day among a month's; `name` names a key
    /// that isn't a day. Labels too near the one above are left out, then dots too near anything kept.
    public static func marks(_ keys: [String], height: Double, name: (String) -> String, locale: Locale = .current) -> [Mark] {
        let n = keys.count
        guard n > 0, height > 0 else { return [] }
        let scale = scale(keys)
        var labels: [Mark] = []
        var dots: [Double] = []
        var last: String?
        // The last day passed, past any stretch with none.
        var day: String?
        for (i, key) in keys.enumerated() {
            if key == last { continue }
            last = key
            let at = Double(i) / Double(n)
            if scale == .name || !DateKey.isKey(key) {
                labels.append(Mark(at: at, label: name(key)))
                continue
            }
            let before = day
            day = key
            switch scale {
            case .year:
                if before == nil || before!.prefix(4) != key.prefix(4) { labels.append(Mark(at: at, label: String(key.prefix(4)))) }
                else if before!.prefix(7) != key.prefix(7) { dots.append(at) }
            case .month:
                if before == nil || before!.prefix(7) != key.prefix(7) {
                    labels.append(Mark(at: at, label: formatted(key, Date.FormatStyle(locale: locale).month(.abbreviated))))
                } else { dots.append(at) }
            default:
                dots.append(at)
            }
        }
        var kept: [Mark] = []
        for mark in labels where kept.last.map({ (mark.at - $0.at) * height >= labelGap }) ?? true { kept.append(mark) }
        var taken = kept.map { $0.at * height }
        var shown = kept
        for at in dots {
            let y = at * height
            if taken.allSatisfy({ abs($0 - y) >= dotGap }) {
                taken.append(y)
                shown.append(Mark(at: at, label: nil))
            }
        }
        return shown.sorted { $0.at < $1.at }
    }

    /// The item a place on the rail (0 at the top, 1 at the foot) falls in, and how far into it.
    public static func item(at: Double, count n: Int) -> (index: Int, into: Double) {
        let exact = min(1, max(0, at)) * Double(n)
        let index = min(n - 1, Int(exact.rounded(.down)))
        return (index, min(1, exact - Double(index)))
    }

    /// Where the page is, as the rail tells it: the line it reads at runs from the top of what's in view, scrolled to
    /// the top, to its foot, scrolled to the end, so the thumb is at either end exactly when the page is.
    public static func readingLine(scrolled: Double, scrollable: Double, top: Double, height: Double) -> Double {
        top + (scrollable > 0 ? height * min(1, max(0, scrolled / scrollable)) : 0)
    }
}
