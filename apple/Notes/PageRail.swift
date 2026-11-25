import NotesKit
import SwiftUI

/// Where a long page is scrolled to, for the rail beside it (`RailView`), as the web's `ScrollRail` measures it: kept
/// apart from the page's own state, so scrolling redraws the rail alone. Items say where they are (`railRow`), in the
/// scroll view's content (`space`); a page that lays them out itself (Photos) sets `rows` directly.
@Observable @MainActor final class RailPlace {
    static let space = "railContent"

    struct Geometry: Equatable {
        var offset: CGFloat
        var scrollable: CGFloat
        var height: CGFloat

        init(_ g: ScrollGeometry) {
            offset = g.contentOffset.y + g.contentInsets.top
            scrollable = g.contentSize.height + g.contentInsets.top + g.contentInsets.bottom - g.containerSize.height
            height = g.containerSize.height
        }
    }

    /// Where the page is, 0 at the top and 1 at the end.
    var at: Double = 0
    /// Whether there's a rail: on a page more than half a screen longer than the screen, as the web's.
    var shown = false
    /// Where each item is in the content, by ID, as last drawn.
    @ObservationIgnored var rows: [String: CGRect] = [:]
    @ObservationIgnored private var geometry: Geometry?

    /// The row the item at `index` of `ids` is in (items side by side share one), and the stretch of the page it
    /// covers: from its top to the next row's, or its own foot when that isn't known.
    private func row(_ index: Int, _ ids: [String], _ rows: [String: CGRect]) -> (first: Int, count: Int, top: CGFloat, extent: CGFloat)? {
        guard let r = rows[ids[index]] else { return nil }
        let same = { (i: Int) in i >= 0 && i < ids.count && rows[ids[i]].map { abs($0.minY - r.minY) < 1 } == true }
        var first = index
        while same(first - 1) { first -= 1 }
        var last = index
        var foot = r.maxY
        while same(last + 1) {
            last += 1
            foot = max(foot, rows[ids[last]]!.maxY)
        }
        let next = last + 1 < ids.count ? rows[ids[last + 1]]?.minY : nil
        let extent = next.map { $0 > r.minY ? $0 - r.minY : foot - r.minY } ?? foot - r.minY
        return (first, last - first + 1, r.minY, extent)
    }

    /// Measures the page again: `ids` are the items drawn, in order, the first of them `first` among `count` in all.
    func update(_ g: Geometry, ids: [String], first: Int = 0, count n: Int, rows: [String: CGRect]? = nil) {
        geometry = g
        let show = n > 1 && g.scrollable > g.height / 2
        if show != shown { shown = show }
        guard show else { return }
        let rows = rows ?? self.rows
        var next = Double(min(1, max(0, g.offset / g.scrollable)))
        // The line it reads at, in the content, and the last item starting above it.
        let line = Rail.readingLine(scrolled: g.offset, scrollable: g.scrollable, top: g.offset, height: g.height)
        var found: Int?
        for (i, id) in ids.enumerated() {
            guard let r = rows[id] else { continue }
            if r.minY <= line { found = i } else { break }
        }
        if let found, let row = row(found, ids, rows) {
            let down = row.extent > 0 ? Double((line - row.top) / row.extent) : 0
            next = Rail.rowRailAt(first: first + row.first, count: row.count, down: down, n: n)
        }
        if abs(next - at) > 1e-4 { at = next }
    }

    /// How far to scroll for a place on the rail, when the item there has been drawn: through it, and down a row of
    /// items side by side, as the web's; nil when it hasn't, to go by its ID instead.
    func offset(for to: Double, ids: [String]) -> CGFloat? {
        guard let g = geometry, !ids.isEmpty else { return nil }
        let (index, into) = Rail.item(at: to, count: ids.count)
        guard let row = row(index, ids, rows) else { return nil }
        let y = row.top + Rail.intoRow(index, into: into, first: row.first, count: row.count) * row.extent
        return Rail.scrollFor(y, scrollable: g.scrollable, top: 0, height: g.height)
    }
}

extension View {
    /// Says where this item is, for the page's rail.
    func railRow(_ id: String, _ place: RailPlace) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .named(RailPlace.space)) } action: { place.rows[id] = $0 }
    }

    /// The rail beside a scroll view of items under days, as the web's Trash, Photos, Links and Files have: `keys` is
    /// each item's day, `ids` each one's ID, in the order shown; a place on it goes through what's drawn and, past
    /// that, to the item by its ID. The scroll view's content is `RailPlace.space`.
    func pageRail(keys: [String], ids: [String], name: @escaping (String) -> String, place: RailPlace, position: Binding<ScrollPosition>, proxy: ScrollViewProxy) -> some View {
        overlay(alignment: .trailing) {
            if place.shown {
                RailView(keys: keys, name: name, place: place) { to in
                    if let y = place.offset(for: to, ids: ids) {
                        position.wrappedValue.scrollTo(y: y)
                    } else if !ids.isEmpty {
                        withAnimation(nil) { proxy.scrollTo(ids[Rail.item(at: to, count: ids.count).index], anchor: UnitPoint(x: 0, y: to)) }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .scrollPosition(position)
        // Room for it, so nothing lies under its marks.
        .contentMargins(.trailing, place.shown ? 28 : 0, for: .scrollContent)
        .onScrollGeometryChange(for: RailPlace.Geometry.self) { RailPlace.Geometry($0) } action: { _, g in
            place.update(g, ids: ids, count: ids.count)
        }
        #if os(macOS)
        // With a mouse the rail stands in for the scroll bar, as on the web.
        .scrollIndicators(place.shown ? .never : .automatic)
        #endif
    }
}

/// A rail down the right of a long page, as a photo library has, as the web's `ScrollRail`: the years down it (or the
/// months, or the groups), each item an equal share of it, a thumb at where the page is, and, pointed at or dragged,
/// the month or day there. A press goes there, a drag goes through the page, and the thumb held moves from where it was.
struct RailView: View {
    /// Each item's key, top to bottom: the day it's under, or the tag that groups it.
    let keys: [String]
    let name: (String) -> String
    let place: RailPlace
    let go: (Double) -> Void
    @State private var drag: Double?
    @State private var point: Double?
    /// Held at the thumb: where it was, to move from.
    @State private var heldFrom: Double?

    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let marks = Rail.marks(keys, height: height, name: name)
            let thumb = drag ?? place.at
            let told = drag ?? point
            ZStack(alignment: .topLeading) {
                Color.clear
                ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in
                    if let label = mark.label {
                        Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted).lineLimit(1).fixedSize()
                            .frame(width: 0, alignment: .trailing)
                            .position(x: 34, y: mark.at * height + 6)
                    } else {
                        Circle().fill(Theme.line).frame(width: 4, height: 4).position(x: 24, y: mark.at * height)
                    }
                }
                if let point, drag == nil {
                    Rectangle().fill(Theme.muted).frame(width: 32, height: 1).position(x: 24, y: point * height)
                }
                Capsule().fill(Theme.accent).frame(width: 32, height: 3).position(x: 24, y: thumb * height)
                if let told, !keys.isEmpty {
                    Text(Rail.label(keys[Rail.item(at: told, count: keys.count).index], scale: Rail.scale(keys), name: name))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.bg).lineLimit(1).fixedSize()
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.text).shadow(color: .black.opacity(0.18), radius: 4, y: 2))
                        .frame(width: 0, alignment: .trailing)
                        .position(x: -2, y: min(height - 14, max(14, told * height)))
                }
            }
            .frame(width: 44, height: height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                guard height > 0 else { return }
                if drag == nil {
                    // Pressed on the thumb, it moves with the pointer from where it was; elsewhere, it goes there.
                    heldFrom = abs(v.startLocation.y - place.at * height) <= 8 ? place.at : nil
                }
                let to = min(1, max(0, heldFrom.map { $0 + v.translation.height / height } ?? v.location.y / height))
                drag = to
                go(to)
            }.onEnded { _ in drag = nil; heldFrom = nil })
            #if os(macOS)
            .onContinuousHover { phase in
                switch phase {
                case .active(let p): point = height > 0 ? min(1, max(0, p.y / height)) : nil
                case .ended: point = nil
                }
            }
            #endif
        }
        .frame(width: 44)
        .accessibilityHidden(true)
    }
}
