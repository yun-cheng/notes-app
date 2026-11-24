import SwiftUI

/// Where each entry sits in the journal's stream, for picking with a box on a Mac, as the web's `useBoxSelect`: a
/// drag from empty space picks every entry the box touches, but one that starts on a bubble, its photos and files, or
/// its pick circle isn't a box. Places are in the stream's own space (`space`), so scrolling doesn't move them.
@MainActor final class StreamPlaces {
    static let space = "journalStream"
    /// Each entry's row, the width of the stream, by entry ID.
    var rows: [String: CGRect] = [:]
    /// What a drag can't start on, by entry ID and part: its bubble and what's under it.
    var solid: [String: [String: CGRect]] = [:]

    /// Whether a drag from here would start on something of one of `ids` (the entries shown) rather than empty space.
    /// Entries no longer shown keep their last places, so only those shown count.
    func isSolid(_ point: CGPoint, among ids: [String]) -> Bool {
        ids.contains { id in
            if solid[id]?.values.contains(where: { $0.contains(point) }) == true { return true }
            // The row's pick circle, on its left (`PickRow`).
            guard let r = rows[id] else { return false }
            return CGRect(x: r.minX - 30, y: r.minY + 6, width: 24, height: 24).contains(point)
        }
    }

    /// The entry across the middle of what's shown, or else the nearest to it, among `ids`, as the web's `focusStream`.
    func middle(of ids: [String], shown: ClosedRange<CGFloat>) -> String? {
        let mid = (shown.lowerBound + shown.upperBound) / 2
        var best: (id: String, off: CGFloat)?
        for id in ids {
            guard let r = rows[id], r.maxY >= shown.lowerBound, r.minY <= shown.upperBound else { continue }
            let off = r.minY > mid ? r.minY - mid : r.maxY < mid ? mid - r.maxY : 0
            if off < best?.off ?? .infinity { best = (id, off) }
        }
        return best?.id
    }
}

extension EnvironmentValues {
    /// Set by the journal's stream on a Mac, for its entries to say where they are.
    @Entry var streamPlaces: StreamPlaces? = nil
}

extension View {
    /// Notes where this is in the journal's stream: an entry's row, or (`part`) something of it a box can't start on.
    func streamPlace(_ id: String, part: String? = nil) -> some View {
        modifier(StreamPlace(id: id, part: part))
    }
}

private struct StreamPlace: ViewModifier {
    @Environment(\.streamPlaces) private var places
    let id: String
    let part: String?

    func body(content: Content) -> some View {
        if let places {
            content.onGeometryChange(for: CGRect.self) { $0.frame(in: .named(StreamPlaces.space)) } action: { frame in
                if let part { places.solid[id, default: [:]][part] = frame } else { places.rows[id] = frame }
            }
        } else {
            content
        }
    }
}

/// A box being dragged out over the stream, in the stream's space.
struct PickBox {
    var start: CGPoint
    var end: CGPoint
    /// What was picked before it, kept when Shift or Cmd was held as it started.
    var before: Set<String>

    var rect: CGRect {
        CGRect(x: min(start.x, end.x), y: min(start.y, end.y), width: abs(end.x - start.x), height: abs(end.y - start.y))
    }
}

/// The box as it's dragged, as the web's: the accent's edge over a light wash of it.
struct PickBoxShape: View {
    let rect: CGRect

    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Theme.accent.opacity(0.14))
            .stroke(Theme.accent, lineWidth: 1)
            .frame(width: rect.width, height: rect.height)
            .offset(x: rect.minX, y: rect.minY)
            .allowsHitTesting(false)
    }
}
