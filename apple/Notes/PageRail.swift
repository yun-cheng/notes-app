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

    /// Where the page is, in items: how many are above its reading line, part way into one. The rail puts it in place,
    /// spaced as it is (`Rail.railAt`).
    var x: Double = 0
    /// Whether there's a rail: on a page more than half a screen longer than the screen, as the web's.
    var shown = false
    /// Where each item is in the content, by ID, as last drawn.
    @ObservationIgnored var rows: [String: CGRect] = [:]
    /// Until when the thumb stays put: while the page draws more above and scrolls back to where it was, it shows
    /// the first of them for a moment, which isn't where the reader is.
    @ObservationIgnored private var heldUntil: Date?

    /// Keeps the thumb where it is a moment (`heldUntil`).
    func hold(for seconds: Double = 0.3) { heldUntil = Date().addingTimeInterval(seconds) }
    @ObservationIgnored private var geometry: Geometry?
    /// How tall the screen's view of the page is, as last measured.
    var height: CGFloat { geometry?.height ?? 0 }

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
        if let heldUntil, Date() < heldUntil { return }
        let rows = rows ?? self.rows
        var next = Double(min(1, max(0, g.offset / g.scrollable))) * Double(n)
        // The line it reads at, in the content, and the last item starting above it.
        let line = Rail.readingLine(scrolled: g.offset, scrollable: g.scrollable, top: g.offset, height: g.height)
        // Only items on screen count: their places are as just laid out. One off screen may still be where it was
        // before items above it were measured or drawn in, and going by it, the thumb jumped about while scrolling fast.
        let top = g.offset, bottom = g.offset + g.height
        var found: Int?
        var firstShown: Int?
        for (i, id) in ids.enumerated() {
            guard let r = rows[id], r.maxY >= top, r.minY <= bottom else { continue }
            if firstShown == nil { firstShown = i }
            if r.minY <= line { found = i } else { break }
        }
        if let found, let row = row(found, ids, rows) {
            let down = row.extent > 0 ? Double((line - row.top) / row.extent) : 0
            next = Double(first + row.first) + min(1, max(0, down)) * Double(row.count)
        } else if firstShown == 0 {
            // Above the first drawn (the button for earlier ones, at the top of a long journal drawn only in part):
            // where that first one is, not the top of the rail, where how far it's scrolled would put it.
            next = Double(first)
        } else if !rows.isEmpty {
            // What's on screen hasn't said where it is yet, a moment after a long jump: stay until it has.
            return
        }
        // As little as a ten-thousandth of the rail, spaced evenly: less isn't worth drawing it again.
        if abs(next - x) > 1e-4 * Double(n) { x = next }
    }

    /// How far to scroll for a place among the items (`x`), when the item there has been drawn: through it, and down a
    /// row of items side by side, as the web's; nil when it hasn't, to go by its ID instead.
    func offset(for x: Double, ids: [String]) -> CGFloat? {
        guard let g = geometry, !ids.isEmpty else { return nil }
        let index = min(ids.count - 1, max(0, Int(x)))
        let into = min(1, max(0, x - Double(index)))
        guard let row = row(index, ids, rows) else { return nil }
        let y = row.top + Rail.intoRow(index, into: into, first: row.first, count: row.count) * row.extent
        return Rail.scrollFor(y, scrollable: g.scrollable, top: 0, height: g.height)
    }
}

/// Where each page was scrolled to, kept while the app runs, so going back to a page (or a view of the journal, a tag
/// or a vault) finds it where it was left, as the web's `scrollPlace`: the item at the top of the screen and how far
/// down it was. At the end a page opens at (the newest, at the foot of a chat), nothing is kept, so it opens there
/// again with whatever was written meanwhile. Keys start with the account's ID.
@MainActor enum KeptPlaces {
    struct Place {
        let id: String
        /// How far below the top of the screen the item's top was, and how tall it was.
        let top: CGFloat
        let height: CGFloat
    }

    private static var places: [String: Place] = [:]
    /// How far each page was scrolled when its place was last kept, and when last heard from while scrolling.
    private static var offsets: [String: CGFloat] = [:]
    private static var seen: [String: CGFloat] = [:]

    static func place(_ key: String) -> Place? { places[key] }

    /// Keeps the first of `ids` whose top is on screen, by where each is in the content (`rows`); none at the end it
    /// opens at (`chat`: the foot). Only once it's been scrolled: as a page goes, what's in it changes under the same
    /// offset, and the place found then was another entry. While it scrolls fast, the rows coming in haven't said where
    /// they are yet: none found on screen leaves what was, to be kept again when it comes to rest.
    static func keep(_ key: String, ids: [String], rows: [String: CGRect], offset: CGFloat, height: CGFloat, scrollable: CGFloat, chat: Bool, atRest: Bool = false) {
        if atRest {
            // Come to rest far from where it last was, with no scrolling between: the page going, not the reader.
            if let was = seen[key], abs(was - offset) > height { return }
        } else {
            if let was = offsets[key], abs(was - offset) < 0.5 { return }
            seen[key] = offset
        }
        if chat ? scrollable - offset < 40 : offset < 4 {
            places[key] = nil
            offsets[key] = offset
            return
        }
        // Come to rest: measured again, whatever was kept while it moved.
        for id in ids {
            guard let r = rows[id], r.minY >= offset - 0.5 else { continue }
            guard r.minY < offset + height else { return }
            places[key] = Place(id: id, top: r.minY - offset, height: r.height)
            offsets[key] = offset
            return
        }
    }

    /// The anchor that puts the item back as far down a screen `height` tall: its point at a fraction of it lines up
    /// with the screen's at the same fraction. Its top, where it wouldn't fit.
    static func anchor(_ p: Place, height: CGFloat) -> UnitPoint {
        let room = height - p.height
        guard room > 1 else { return .top }
        let y = p.top / room
        return y >= 0 && y <= 1 ? UnitPoint(x: 0, y: y) : .top
    }
}

/// Keeps a page's place as it's scrolled, and goes back to it when the page opens again (`KeptPlaces`), for the pages
/// with a rail: its items are `ids`, where they are `place.rows`. Going by where it is when that's known (Photos lays
/// out every tile), else by the item's ID.
private struct KeepsPlace: ViewModifier {
    let key: String
    let ids: [String]
    let place: RailPlace
    let position: Binding<ScrollPosition>
    let proxy: ScrollViewProxy
    /// Opened where it was: from then on, where it is is kept.
    @State private var settled = false

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: RailPlace.Geometry.self) { RailPlace.Geometry($0) } action: { _, g in
                guard settled else { return }
                KeptPlaces.keep(key, ids: ids, rows: place.rows, offset: g.offset, height: g.height, scrollable: g.scrollable, chat: false)
            }
            .onScrollPhaseChange { _, phase, context in
                guard settled, phase == .idle else { return }
                let g = RailPlace.Geometry(context.geometry)
                KeptPlaces.keep(key, ids: ids, rows: place.rows, offset: g.offset, height: g.height, scrollable: g.scrollable, chat: false, atRest: true)
            }
            .task {
                if let kept = KeptPlaces.place(key), ids.contains(kept.id) {
                    // Once laid out, and again as the items around it are measured.
                    for wait in [60, 150] {
                        try? await Task.sleep(for: .milliseconds(wait))
                        if let r = place.rows[kept.id] {
                            position.wrappedValue.scrollTo(y: max(0, r.minY - kept.top))
                        } else {
                            withAnimation(nil) { proxy.scrollTo(kept.id, anchor: KeptPlaces.anchor(kept, height: place.height)) }
                        }
                    }
                }
                if !Task.isCancelled { settled = true }
            }
    }
}

extension View {
    /// Says where this item is, for the page's rail.
    func railRow(_ id: String, _ place: RailPlace) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .named(RailPlace.space)) } action: { place.rows[id] = $0 }
            // Let go of by the list (well off screen): its place goes stale as items above it change.
            .onDisappear { place.rows[id] = nil }
    }

    /// The rail beside a scroll view of items under days, as the web's Trash, Photos, Links and Files have: `keys` is
    /// each item's day, `ids` each one's ID, in the order shown; a place on it goes through what's drawn and, past
    /// that, to the item by its ID. The scroll view's content is `RailPlace.space`.
    /// `keep` names the page, to open it where it was left (`KeptPlaces`).
    func pageRail(keys: [String], ids: [String], name: @escaping (String) -> String, place: RailPlace, position: Binding<ScrollPosition>, proxy: ScrollViewProxy, keep: String) -> some View {
        modifier(KeepsPlace(key: keep, ids: ids, place: place, position: position, proxy: proxy))
        .overlay(alignment: .trailing) {
            if place.shown {
                RailView(keys: keys, name: name, place: place) { to, x in
                    if let y = place.offset(for: x, ids: ids) {
                        position.wrappedValue.scrollTo(y: y)
                    } else if !ids.isEmpty {
                        withAnimation(nil) { proxy.scrollTo(ids[min(ids.count - 1, Int(x))], anchor: UnitPoint(x: 0, y: to)) }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .scrollPosition(position)
        #if os(macOS)
        // Room for it, so nothing lies under its marks; on a phone only its handle shows, over the page, as the web's.
        .contentMargins(.trailing, place.shown ? 28 : 0, for: .scrollContent)
        #endif
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
/// months, or the groups), each item an equal share of it or spaced by nearness (`RailYears`), a thumb at where the
/// page is, and, pointed at or dragged, the month or day there. On a Mac a press goes there, a drag goes through the page, and the thumb held moves from
/// where it was. On a phone, as the web's on a touch screen, only a handle shows, at the edge while the page scrolls,
/// held and dragged, with the marks and the month or day showing while it's dragged; the rest of it takes no touches.
/**
 * The rail's marks, its spacing and how it tells its items apart, worked out again only when its items, its height or
 * the year it's spaced around change. The rail is drawn again on every frame of scrolling, as its thumb moves; working
 * them out from thousands of days each time was nearly all a scroll's work, and made it stutter. The same list of days
 * passed again compares at once.
 */
private final class RailMarks {
    private var keys: [String] = []
    private var height = -1.0
    private var marksSpacing: [Double]?
    private var marks: [Rail.Mark] = []
    private var scaleKeys: [String]?
    private var scale: Rail.Scale = .day
    private var spacingKeys: [String]?
    private var spacingYear: Int?
    private var spacing: [Double]?

    func marks(_ keys: [String], height: Double, name: (String) -> String, spacing: [Double]?) -> [Rail.Mark] {
        if keys != self.keys || height != self.height || spacing != marksSpacing {
            self.keys = keys
            self.height = height
            marksSpacing = spacing
            marks = Rail.marks(keys, height: height, name: name, spacing: spacing)
        }
        return marks
    }

    /// Spaced by nearness around `year`, or evenly (nil) when that's off.
    func spacing(_ keys: [String], year: Int?, near: Bool) -> [Double]? {
        guard near else { return nil }
        if keys != spacingKeys || year != spacingYear {
            spacingKeys = keys
            spacingYear = year
            spacing = Rail.spacing(keys, year: year)
        }
        return spacing
    }

    func scale(_ keys: [String]) -> Rail.Scale {
        if keys != scaleKeys {
            scaleKeys = keys
            scale = Rail.scale(keys)
        }
        return scale
    }
}

/// How the rail spaces its years, kept on this device as the web's display settings are: an equal share for each item,
/// or more for the years nearer the one being read (`Rail.spacing`).
enum RailYears {
    static let key = "railYears"
    static let choices = [("entries", "By entries"), ("near", "Nearer years larger")]
}

struct RailView: View {
    /// Each item's key, top to bottom: the day it's under, or the tag that groups it.
    let keys: [String]
    let name: (String) -> String
    let place: RailPlace
    /// Goes to a place on the rail (0 at the top, 1 at the foot) and the place among the items it falls at.
    let go: (Double, Double) -> Void
    @State private var drag: Double?
    @State private var point: Double?
    @AppStorage(RailYears.key) private var spacedBy = "entries"
    /// Spaced by nearness, the year it's spaced around: the one being read, but kept while the rail is pointed at or
    /// dragged, so nothing on it moves under the pointer, and taken up again once it's let go.
    @State private var year: Int?

    private var reading: Int? { keys.isEmpty ? nil : Rail.year(keys, at: min(keys.count - 1, Int(place.x))) }
    private var free: Bool { drag == nil && point == nil }
    private var spacing: [Double]? { cached.spacing(keys, year: year ?? reading, near: spacedBy == "near") }
    /// Where the thumb is, 0 at the top and 1 at the foot.
    private func thumbAt(_ spacing: [Double]?) -> Double { Rail.railAt(item: place.x, n: keys.count, spacing: spacing) }
    /// Goes to a place on the rail.
    private func goTo(_ to: Double, _ spacing: [Double]?) {
        let (index, into) = Rail.item(at: to, count: keys.count, spacing: spacing)
        go(to, Double(index) + into)
    }
    /// Held at the thumb: where it was, to move from.
    @State private var heldFrom: Double?
    @State private var cached = RailMarks()
    #if os(iOS)
    /// Scrolled lately: the handle shows, for a second and a half after.
    @State private var awake = false
    @State private var wakes = 0
    #endif

    #if os(iOS)
    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let spaced = spacing
            let marks = drag == nil ? [] : cached.marks(keys, height: height, name: name, spacing: spaced)
            let at = thumbAt(spaced)
            let thumb = drag ?? at
            ZStack(alignment: .topLeading) {
                Color.clear.allowsHitTesting(false)
                ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in
                    if let label = mark.label {
                        Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted).lineLimit(1).fixedSize()
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Capsule().fill(Theme.surface).shadow(color: .black.opacity(0.12), radius: 2, y: 1))
                            .opacity(0.85)
                            .frame(width: 0, alignment: .trailing)
                            .position(x: 4, y: mark.at * height + 8)
                            .allowsHitTesting(false)
                    } else {
                        Circle().fill(Theme.line).frame(width: 4, height: 4).position(x: 8, y: mark.at * height).allowsHitTesting(false)
                    }
                }
                if awake || drag != nil {
                    VStack(spacing: 0) {
                        Image(systemName: "chevron.up")
                        Image(systemName: "chevron.down")
                    }
                    .font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted)
                    .frame(width: 32, height: 44)
                    .background(UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22).fill(Theme.surface).shadow(color: .black.opacity(0.14), radius: 5, y: 2))
                    .overlay(UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 22).stroke(Theme.line))
                    .contentShape(Rectangle())
                    .position(x: 28, y: min(max(22, thumb * height), height - 22))
                    // In the rail's own space: the handle moves as it's dragged.
                    .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("rail")).onChanged { v in
                        guard height > 0 else { return }
                        if drag == nil { heldFrom = at }
                        let to = min(1, max(0, (heldFrom ?? at) + v.translation.height / height))
                        drag = to
                        goTo(to, spaced)
                    }.onEnded { _ in drag = nil; heldFrom = nil; wakes += 1 })
                }
                if let told = drag, !keys.isEmpty {
                    Text(Rail.label(keys[Rail.item(at: told, count: keys.count, spacing: spaced).index], scale: cached.scale(keys), name: name))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.bg).lineLimit(1).fixedSize()
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.text).shadow(color: .black.opacity(0.18), radius: 4, y: 2))
                        .frame(width: 0, alignment: .trailing)
                        .position(x: 4, y: min(height - 14, max(14, told * height)))
                        .allowsHitTesting(false)
                }
            }
            .frame(width: 44, height: height)
            .coordinateSpace(.named("rail"))
        }
        .frame(width: 44)
        .accessibilityHidden(true)
        .onChange(of: place.x) {
            awake = true
            wakes += 1
        }
        .onChange(of: free ? reading : year, initial: true) { _, now in year = now }
        .task(id: wakes) {
            try? await Task.sleep(for: .seconds(1.5))
            if !Task.isCancelled && drag == nil { awake = false }
        }
    }
    #else
    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let spaced = spacing
            let marks = cached.marks(keys, height: height, name: name, spacing: spaced)
            let at = thumbAt(spaced)
            let thumb = drag ?? at
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
                    Text(Rail.label(keys[Rail.item(at: told, count: keys.count, spacing: spaced).index], scale: cached.scale(keys), name: name))
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
                    heldFrom = abs(v.startLocation.y - at * height) <= 8 ? at : nil
                }
                let to = min(1, max(0, heldFrom.map { $0 + v.translation.height / height } ?? v.location.y / height))
                drag = to
                goTo(to, spaced)
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
        .onChange(of: free ? reading : year, initial: true) { _, now in year = now }
    }
    #endif
}
