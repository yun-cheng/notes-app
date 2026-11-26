import Foundation
import Testing

@testable import NotesKit

/// The web app's own test cases for the rail beside a long page (`rail.test.ts`), run against the Swift port.
@Suite struct RailTests {
    static let us = Locale(identifier: "en_US")
    static func name(_ key: String) -> String { key.isEmpty ? "None" : "#\(key)" }
    static func labels(_ keys: [String], _ height: Double = 1000) -> [String] {
        Rail.marks(keys, height: height, name: name, locale: us).compactMap(\.label)
    }

    @Test func scale() {
        #expect(Rail.scale(["2024-03-01", "2026-11-19"]) == .year)
        #expect(Rail.scale(["2026-10-30", "", "2026-11-19"]) == .month)
        #expect(Rail.scale(["2026-11-18", "2026-11-19"]) == .day)
        #expect(Rail.scale(["2026-11-19", "tag-1"]) == .name)
    }

    @Test func dotsKeepOffLabels() {
        // As the web's: a hundred items on a 1000-point rail; months begin at 10, 50, 490, 510 and 520, years at 0 and 500.
        let at = [0: "2025-01-01", 1: "2025-02-01", 5: "2025-03-01", 49: "2025-12-01", 50: "2026-01-01", 51: "2026-02-01", 52: "2026-03-01"]
        var last = ""
        let keys: [String] = (0..<100).map { i in
            if let k = at[i] { last = k }
            return last
        }
        let dots = Rail.marks(keys, height: 1000, name: Self.name, locale: Self.us).filter { $0.label == nil }.map { Int(($0.at * 1000).rounded()) }
        #expect(dots == [50, 490, 520])
    }

    @Test func yearsWithDotsForMonths() {
        let keys = ["2024-12-30", "2025-01-02", "2025-01-03", "2025-03-01", "2026-11-19"]
        let marks = Rail.marks(keys, height: 1000, name: Self.name, locale: Self.us)
        #expect(marks.filter { $0.label != nil } == [Rail.Mark(at: 0, label: "2024"), Rail.Mark(at: 0.2, label: "2025"), Rail.Mark(at: 0.8, label: "2026")])
        #expect(marks.filter { $0.label == nil }.map(\.at) == [0.6])
        #expect(Self.labels(keys.reversed()) == ["2026", "2025", "2024"])
    }

    @Test func monthsAndStretchesWithNoDay() {
        let marks = Rail.marks(["2026-10-30", "2026-11-01", "", ""], height: 1000, name: Self.name, locale: Self.us).filter { $0.label != nil }
        #expect(marks == [Rail.Mark(at: 0, label: "Oct 2026"), Rail.Mark(at: 0.25, label: "Nov"), Rail.Mark(at: 0.5, label: "None")])
        #expect(Self.labels(["2026-10-30", "", "2026-10-31", "2026-11-02"]) == ["Oct 2026", "None", "Nov"])
        // Days within one month: the year shows too, where they start.
        #expect(Self.labels(["2026-11-18", "2026-11-19", "2026-11-20"]) == ["Nov 2026"])
    }

    @Test func crowdedLabelsLeftOut() {
        let keys = ["2020-01-01", "2021-01-01"] + Array(repeating: "2025-06-01", count: 8) + Array(repeating: "2026-01-01", count: 90)
        #expect(Self.labels(keys) == ["2020", "2026"])
        #expect(Self.labels(keys, 5000) == ["2020", "2021", "2025", "2026"])
        #expect(Rail.marks([], height: 1000, name: Self.name).isEmpty)
    }

    @Test func label() {
        #expect(Rail.label("2025-03-04", scale: .year, name: Self.name, locale: Self.us) == "Mar 2025")
        #expect(Rail.label("2025-03-04", scale: .month, name: Self.name) == "#2025-03-04")
        #expect(Rail.label("", scale: .year, name: Self.name) == "None")
    }

    @Test func item() {
        #expect(Rail.item(at: 0, count: 4) == (0, 0))
        let mid = Rail.item(at: 0.6, count: 4)
        #expect(mid.index == 2 && abs(mid.into - 0.4) < 1e-9)
        #expect(Rail.item(at: 1, count: 4) == (3, 1))
        #expect(Rail.item(at: -1, count: 4).index == 0)
    }

    @Test func readingLine() {
        #expect(Rail.readingLine(scrolled: 0, scrollable: 1000, top: 60, height: 500) == 60)
        #expect(Rail.readingLine(scrolled: 1000, scrollable: 1000, top: 60, height: 500) == 560)
        #expect(Rail.readingLine(scrolled: 500, scrollable: 1000, top: 60, height: 500) == 310)
        #expect(Rail.readingLine(scrolled: 0, scrollable: 0, top: 60, height: 500) == 60)
    }

    @Test func scrollForTurnsReadingLineRound() {
        let s = Rail.scrollFor(2000, scrollable: 3000, top: 60, height: 500)
        #expect(abs(s + Rail.readingLine(scrolled: s, scrollable: 3000, top: 60, height: 500) - 2000) < 1e-9)
        #expect(Rail.scrollFor(10, scrollable: 3000, top: 60, height: 500) == 0)
        #expect(Rail.scrollFor(99_999, scrollable: 3000, top: 60, height: 500) == 3000)
    }

    @Test func rowsOfItemsSideBySide() {
        let downs: [Double] = [4, 5, 6].map { Rail.intoRow($0, into: 0.25, first: 4, count: 3) }
        let expected: [Double] = [0.25 / 3, 1.25 / 3, 2.25 / 3]
        #expect(downs == expected)
        #expect(Rail.intoRow(6, into: 1, first: 4, count: 3) == 1)
        #expect(Rail.intoRow(9, into: 0.5, first: 9, count: 1) == 0.5)
        for (index, into) in [(4, 0.25), (5, 0.9), (6, 0.0)] {
            let down = Rail.intoRow(index, into: into, first: 4, count: 3)
            let at = Rail.rowRailAt(first: 4, count: 3, down: down, n: 20)
            #expect(abs(at - (Double(index) + into) / 20) < 1e-9)
        }
        #expect(abs(Rail.rowRailAt(first: 4, count: 3, down: 2, n: 20) - 7.0 / 20) < 1e-9)
    }

    @Test func spacedByNearness() {
        // As the web's: 2024 has one item, 2025 two, 2026 seven.
        let keys = ["2024-05-01", "2025-01-01", "2025-02-01"] + Array(repeating: "2026-03-01", count: 7)
        let near = Rail.spacing(keys, year: 2024)!
        #expect(abs(near[1] - 3.0 / 13) < 1e-9)
        #expect(abs(near[3] - 6.0 / 13) < 1e-9)
        #expect(near[10] == 1)
        let at = Rail.marks(keys, height: 1000, name: Self.name, locale: Self.us, spacing: near).filter { $0.label != nil }.map(\.at)
        #expect(at.count == 3 && abs(at[1] - 3.0 / 13) < 1e-9)
        let later = Rail.spacing(keys, year: 2026)!
        #expect(abs((1 - later[3]) - 21.0 / 25) < 1e-9)
        #expect(abs(Rail.spacing(keys, year: 2025)![1] - 1.0 / 12) < 1e-9)
        #expect(Rail.spacing(["2026-01-01", "2026-02-01"], year: 2026) == nil)
        #expect(Rail.spacing(keys, year: nil) == nil)
        for x in [0, 0.5, 1, 2.25, 6.5, 9.99] {
            let (index, into) = Rail.item(at: Rail.railAt(item: x, n: keys.count, spacing: near), count: keys.count, spacing: near)
            #expect(abs(Double(index) + into - x) < 1e-9)
        }
        #expect(Rail.railAt(item: 2.5, n: 10) == 0.25)
        #expect(Rail.year(["", "2024-05-01", "", "2026-03-01"], at: 0) == 2024)
        #expect(Rail.year(["", "2024-05-01", "", "2026-03-01"], at: 2) == 2024)
        #expect(Rail.year(["", ""], at: 1) == nil)
    }
}
