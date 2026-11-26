import Foundation

/// The rail beside a long page of entries, as a photo library has, as the web's `rail.ts`: marks for the years (or
/// months, or groups) down its length, a thumb at where the page is, and a label for the place pointed at or dragged
/// to. Each item has a key, the day it's under (or what else groups it, a tag), and a share of the rail, in the order
/// the page shows them, top to bottom: an equal share, or, spaced by nearness (`spacing`), a share that's larger the
/// nearer its year is to the one being read.
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
    /// How far down from where it's placed a label reaches (it starts at its top), and the room a dot keeps from it, as the web's.
    static let labelHeight = 16.0
    static let dotRoom = 3.0

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
    public static func marks(_ keys: [String], height: Double, name: (String) -> String, locale: Locale = .current, spacing: [Double]? = nil) -> [Mark] {
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
            let at = railAt(item: Double(i), n: n, spacing: spacing)
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
            // A rail of months or days names the year where it starts ("Mar 2026"), as the web's.
            case .month:
                if before == nil {
                    labels.append(Mark(at: at, label: formatted(key, Date.FormatStyle(locale: locale).month(.abbreviated).year())))
                } else if before!.prefix(7) != key.prefix(7) {
                    labels.append(Mark(at: at, label: formatted(key, Date.FormatStyle(locale: locale).month(.abbreviated))))
                } else { dots.append(at) }
            default:
                if before == nil {
                    labels.append(Mark(at: at, label: formatted(key, Date.FormatStyle(locale: locale).month(.abbreviated).year())))
                } else { dots.append(at) }
            }
        }
        var kept: [Mark] = []
        for mark in labels where kept.last.map({ (mark.at - $0.at) * height >= labelGap }) ?? true { kept.append(mark) }
        let labelled = kept.map { $0.at * height }
        var taken: [Double] = []
        var shown = kept
        for at in dots {
            let y = at * height
            let clear = labelled.allSatisfy { y < $0 - dotRoom || y > $0 + labelHeight + dotRoom }
            if clear && taken.allSatisfy({ abs($0 - y) >= dotGap }) {
                taken.append(y)
                shown.append(Mark(at: at, label: nil))
            }
        }
        return shown.sorted { $0.at < $1.at }
    }

    /// The rail spaced by nearness: where each item starts, from 0, and 1 after the last (`n + 1` in all). Each item
    /// counts by how many years it is from `year`, the one being read (1 in it, ½ in the year either side, ⅓ the next,
    /// and so on), so a year with few items still takes little of it; an item with no day goes with the year above it.
    /// Nil, an equal share each, on a rail that isn't of years or with no year to go by. As the web's `railSpacing`.
    public static func spacing(_ keys: [String], year: Int?) -> [Double]? {
        let n = keys.count
        guard let year, n > 1, scale(keys) == .year else { return nil }
        var years = [Int?](repeating: nil, count: n)
        var last: Int?
        for (i, key) in keys.enumerated() {
            if !key.isEmpty { last = Int(key.prefix(4)) }
            years[i] = last
        }
        // Items with no day above any with one go with the first year after them.
        let first = years.first(where: { $0 != nil }).flatMap { $0 } ?? year
        let resolved = years.map { $0 ?? first }
        let weight = { (y: Int) in 1 / Double(1 + abs(y - year)) }
        let total = resolved.reduce(0.0) { $0 + weight($1) }
        var starts = [Double](repeating: 0, count: n + 1)
        for i in 0..<n {
            starts[i + 1] = starts[i] + weight(resolved[i]) / total
        }
        starts[n] = 1
        return starts
    }

    /// The year of the item at `index`, the year a rail spaced by nearness is spaced around; nil when it has no day.
    public static func year(_ keys: [String], at index: Int) -> Int? {
        if !keys.isEmpty {
            for i in stride(from: min(index, keys.count - 1), through: 0, by: -1) where DateKey.isKey(keys[i]) { return Int(keys[i].prefix(4)) }
        }
        return keys.first(where: { DateKey.isKey($0) }).flatMap { Int($0.prefix(4)) }
    }

    /// The place on the rail of a place among the items: `item` items down, part way into one when it isn't whole.
    public static func railAt(item x: Double, n: Int, spacing: [Double]? = nil) -> Double {
        guard n > 0 else { return 0 }
        let at = min(Double(n), max(0, x))
        guard let spacing else { return at / Double(n) }
        let index = min(n - 1, Int(at.rounded(.down)))
        return spacing[index] + (at - Double(index)) * (spacing[index + 1] - spacing[index])
    }

    /// The item a place on the rail (0 at the top, 1 at the foot) falls in, and how far into it.
    public static func item(at: Double, count n: Int, spacing: [Double]? = nil) -> (index: Int, into: Double) {
        if let spacing, n > 0 {
            let to = min(1, max(0, at))
            // The last item starting at or above it.
            var lo = 0, hi = n - 1
            while lo < hi {
                let mid = (lo + hi + 1) / 2
                if spacing[mid] <= to { lo = mid } else { hi = mid - 1 }
            }
            let size = spacing[lo + 1] - spacing[lo]
            return (lo, size > 0 ? min(1, max(0, (to - spacing[lo]) / size)) : 0)
        }
        let exact = min(1, max(0, at)) * Double(n)
        let index = min(n - 1, Int(exact.rounded(.down)))
        return (index, min(1, exact - Double(index)))
    }

    /// Items side by side (photos in a row) share one stretch of the page, from the row's top to the next row's:
    /// `first` is the row's first item and `count` how many it holds. How far down that stretch the place `into` the
    /// item at `index` is, so a slow drag goes smoothly down a row and the gap and heading under it, never back to its top.
    public static func intoRow(_ index: Int, into: Double, first: Int, count: Int) -> Double {
        count > 0 ? min(1, max(0, (Double(index - first) + into) / Double(count))) : 0
    }

    /// `intoRow`, turned round: the place on a rail of `n` items that's `down` the stretch of a row.
    public static func rowRailAt(first: Int, count: Int, down: Double, n: Int, spacing: [Double]? = nil) -> Double {
        n > 0 ? min(1, railAt(item: Double(first) + min(1, max(0, down)) * Double(count), n: n, spacing: spacing)) : 0
    }

    /// Where the page is, as the rail tells it: the line it reads at runs from the top of what's in view, scrolled to
    /// the top, to its foot, scrolled to the end, so the thumb is at either end exactly when the page is.
    public static func readingLine(scrolled: Double, scrollable: Double, top: Double, height: Double) -> Double {
        top + (scrollable > 0 ? height * min(1, max(0, scrolled / scrollable)) : 0)
    }

    /// How far to scroll so the reading line meets `y`, a place on the page (from its top): `readingLine`, turned round.
    public static func scrollFor(_ y: Double, scrollable: Double, top: Double, height: Double) -> Double {
        guard scrollable > 0 else { return 0 }
        return min(scrollable, max(0, (y - top) / (1 + height / scrollable)))
    }
}
