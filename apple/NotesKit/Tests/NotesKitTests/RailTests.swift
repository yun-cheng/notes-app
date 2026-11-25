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

    @Test func yearsWithDotsForMonths() {
        let keys = ["2024-12-30", "2025-01-02", "2025-01-03", "2025-03-01", "2026-11-19"]
        let marks = Rail.marks(keys, height: 1000, name: Self.name, locale: Self.us)
        #expect(marks.filter { $0.label != nil } == [Rail.Mark(at: 0, label: "2024"), Rail.Mark(at: 0.2, label: "2025"), Rail.Mark(at: 0.8, label: "2026")])
        #expect(marks.filter { $0.label == nil }.map(\.at) == [0.6])
        #expect(Self.labels(keys.reversed()) == ["2026", "2025", "2024"])
    }

    @Test func monthsAndStretchesWithNoDay() {
        let marks = Rail.marks(["2026-10-30", "2026-11-01", "", ""], height: 1000, name: Self.name, locale: Self.us).filter { $0.label != nil }
        #expect(marks == [Rail.Mark(at: 0, label: "Oct"), Rail.Mark(at: 0.25, label: "Nov"), Rail.Mark(at: 0.5, label: "None")])
        #expect(Self.labels(["2026-10-30", "", "2026-10-31", "2026-11-02"]) == ["Oct", "None", "Nov"])
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
}
