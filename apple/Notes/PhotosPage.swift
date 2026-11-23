import NotesKit
import SwiftUI

/// What entries hold, for the Photos, Links and Files pages, as the web's `entryDays`: the journal's entries the filter
/// leaves, newest first, by the day each was written; each thing in an entry's pages once, and with `once`, a thing in
/// two entries (a template's copy) once, with the newer.
struct HeldDay<T: Identifiable>: Identifiable where T.ID == String {
    let day: String
    var items: [(item: T, card: Card)]
    var id: String { day }

    @MainActor
    static func of(_ model: AppModel, _ filter: StreamFilter, once: Bool, take: (Card) -> [T]) -> [HeldDay<T>] {
        var f = filter
        f.sort = .newest
        let cards = Stream.items(model.index, f, today: model.today, sharedInto: model.sharedInto).map(\.card)
            .sorted { $0.createdAt != $1.createdAt ? $0.createdAt > $1.createdAt : $0.id < $1.id }
        var seen = Set<String>()
        var days: [HeldDay<T>] = []
        for card in cards {
            var mine = Set<String>()
            let found = take(card).filter { !seen.contains($0.id) && mine.insert($0.id).inserted }
            guard !found.isEmpty else { continue }
            let day = Stream.entryDay(card)
            if days.last?.day != day { days.append(HeldDay(day: day, items: [])) }
            for t in found {
                if once { seen.insert(t.id) }
                days[days.count - 1].items.append((t, card))
            }
        }
        return days
    }
}

/// The library pages' filter row, as the web's: a switch of their own first (Photos' kinds, Files' kinds), then when
/// the entries were written, and the sidebar's tag and vault.
struct LibraryFilterRow<Lead: View>: View {
    @Environment(AppModel.self) private var model
    @Binding var filter: StreamFilter
    @ViewBuilder var lead: Lead
    @State private var pickDates = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                lead
                FilterChip(label: filter.when.map { StreamLabels.when($0, today: model.today) } ?? "Written", set: filter.when != nil, clear: { filter.when = nil }) {
                    Button("Written today") { filter.when = "today" }
                    Button("Past 7 days") { filter.when = "week" }
                    Button("Past 30 days") { filter.when = "month" }
                    Divider()
                    Button("Pick dates…") { pickDates = true }
                }
                if let tag = filter.tagId { SetChip(label: model.card(tag)?.displayTitle ?? "Tag", icon: "tag") { filter.tagId = nil } }
                if let vault = filter.vaultId { SetChip(label: model.vault(vault)?.name ?? "Vault", icon: "tray") { filter.vaultId = nil } }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(Theme.bg)
        .overlay(alignment: .bottom) { Theme.line.frame(height: 1) }
        .sheet(isPresented: $pickDates) { DatesDialog(filter: $filter) }
    }
}

/// A switch of a few choices, as the web's `segmented` row in the filter bar.
struct Segmented<V: Hashable>: View {
    let options: [(V, String)]
    @Binding var value: V

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.0) { v, label in
                Button { value = v } label: {
                    Text(label).font(.subheadline).padding(.horizontal, 12).frame(minHeight: 30)
                        .background(Capsule().fill(value == v ? Theme.surface : .clear))
                        .foregroundStyle(value == v ? Theme.text : Theme.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Capsule().fill(Theme.sunken))
    }
}

/// "17 photos and 2 videos, in 12 entries", "3 links, in 2 entries".
func countLine(_ what: String, entries: Int) -> String {
    "\(what), in \(entries == 1 ? "1 entry" : "\(entries) entries")"
}

/// Each photo's width over its height, once it's been shown, kept on this device, so the Photos page lays out at once
/// next time, as the web keeps them.
@MainActor
@Observable
final class PhotoShapes {
    static let shared = PhotoShapes()
    private(set) var ratios: [String: Double] = (UserDefaults.standard.dictionary(forKey: "photoShapes") as? [String: Double]) ?? [:]

    func keep(_ id: String, _ ratio: Double) {
        guard ratio.isFinite, ratio > 0, abs((ratios[id] ?? 1) - ratio) >= 0.01 else { return }
        ratios[id] = ratio
        if ratios.count > 3000 { ratios = Dictionary(uniqueKeysWithValues: ratios.prefix(2000).map { ($0.key, $0.value) }) }
        UserDefaults.standard.set(ratios, forKey: "photoShapes")
    }
}

/// Days of photos, each as its width over its height, laid out as the web's `layoutPhotos`: whole photos in rows of
/// about one height that fill the width; a day that fits in what's left of a row goes on beside the one before, under
/// its own heading.
enum PhotoLayout {
    struct Box { var x: CGFloat = 0, y: CGFloat = 0, w: CGFloat = 0, h: CGFloat = 0 }
    struct Options { var width: CGFloat, row: CGFloat, gap: CGFloat, dayGap: CGFloat, head: CGFloat }

    static func options(_ width: CGFloat) -> Options {
        width < 600 ? Options(width: width, row: 120, gap: 3, dayGap: 12, head: 40) : Options(width: width, row: 200, gap: 4, dayGap: 16, head: 44)
    }

    static func layout(_ days: [[Double]], _ o: Options) -> (tiles: [[Box]], heads: [Box], height: CGFloat) {
        struct Item { let d: Int, i: Int, r: CGFloat }
        let W = max(1, o.width), H = o.row
        func gaps(_ line: [Item]) -> CGFloat { line.indices.dropFirst().reduce(0) { $0 + (line[$1].d == line[$1 - 1].d ? o.gap : o.dayGap) } }
        func sumR(_ line: [Item]) -> CGFloat { line.reduce(0) { $0 + $1.r } }
        func widthAt(_ line: [Item], _ h: CGFloat) -> CGFloat { sumR(line) * h + gaps(line) }
        func fitted(_ line: [Item]) -> CGFloat { (W - gaps(line)) / sumR(line) }
        var lines: [(items: [Item], h: CGFloat)] = []
        var line: [Item] = []
        func close(_ h: CGFloat) { if !line.isEmpty { lines.append((line, h)) }; line = [] }
        func closeShort() { if !line.isEmpty { close(widthAt(line, H) >= W * 0.8 ? fitted(line) : H) } }
        for (d, ratios) in days.enumerated() {
            let items = ratios.enumerated().map { Item(d: d, i: $0.offset, r: $0.element > 0 && $0.element.isFinite ? CGFloat($0.element) : 1) }
            guard !items.isEmpty else { continue }
            if !line.isEmpty {
                if widthAt(line + items, H) <= W { line += items; continue }
                closeShort()
            }
            for item in items {
                let next = line + [item]
                if !line.isEmpty && widthAt(next, H) > W {
                    let shrunk = fitted(next), grown = fitted(line)
                    if abs(shrunk - H) <= abs(grown - H) { line = next; close(shrunk); continue }
                    close(grown)
                    line = [item]
                } else {
                    line = next
                }
                if line.count == 1 && widthAt(line, H) > W { close(fitted(line)) }
            }
        }
        if !line.isEmpty { close(widthAt(line, H) > W ? fitted(line) : H) }
        var tiles: [[Box]] = days.map { Array(repeating: Box(), count: $0.count) }
        var heads: [Box] = days.map { _ in Box() }
        var y: CGFloat = 0
        for (n, l) in lines.enumerated() {
            if n > 0 { y += o.gap }
            let top = l.items.contains { $0.i == 0 } ? y + o.head : y
            var x: CGFloat = 0
            for (k, it) in l.items.enumerated() {
                if k > 0 { x += it.d == l.items[k - 1].d ? o.gap : o.dayGap }
                let w = it.r * l.h
                tiles[it.d][it.i] = Box(x: x, y: top, w: w, h: l.h)
                if it.i == 0 { heads[it.d] = Box(x: x, y: y, w: 0, h: o.head) }
                if l.items.contains(where: { $0.d == it.d && $0.i == 0 }) { heads[it.d].w = x + w - heads[it.d].x }
                x += w
            }
            y = top + l.h
        }
        return (tiles, heads, y)
    }
}

/// Every photo and video in the journal's entries, as the web app's Photos page: whole, in rows that fill the width
/// under the day each entry was written, a day beside the one before when it fits; a count of them over it; opening
/// full screen to page through them all; picked to share, with a menu to open their entry or share it by a public link.
/// A switch shows them all, the photos alone or the videos alone, and the journal's filters narrow it.
struct PhotosPage: View {
    @Environment(AppModel.self) private var model
    enum Kind: String, CaseIterable { case all = "All", photos = "Photos", videos = "Videos" }
    @State private var kind = Kind.all
    @State private var filter = StreamFilter()
    @State private var viewing: String?
    @State private var picked: Set<String> = []
    @State private var sharing: [URL] = []

    struct Item: Identifiable, Hashable {
        var media: Doc.Media
        var card: Card
        var id: String { media.id }
    }

    var body: some View {
        let days = HeldDay<Doc.Media>.of(model, filter, once: true) { card in
            ([card.content] + card.morePages).flatMap(Doc.media).filter { m in
                switch (kind, m) {
                case (.photos, .video), (.videos, .photo): false
                default: true
                }
            }
        }
        let all = days.flatMap { $0.items.map { Item(media: $0.item, card: $0.card) } }
        let shapes = PhotoShapes.shared.ratios
        let ratios = days.map { $0.items.map { pair -> Double in
            if let r = shapes[pair.item.id] { return r }
            if case .video(let f) = pair.item, let w = f.width, let h = f.height, h > 0 { return w / h }
            return 1
        } }
        VStack(spacing: 0) {
            LibraryFilterRow(filter: $filter) {
                Segmented(options: Kind.allCases.map { ($0, $0.rawValue) }, value: $kind)
            }
            if all.isEmpty {
                ContentUnavailableView(filter.isFiltered || kind != .all ? "No photos here match" : "No photos yet", systemImage: "photo",
                    description: Text(filter.isFiltered || kind != .all ? "Take a filter off above, or pick another." : "Add one to an entry with the photo button, or paste or drop it in."))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(countLine(EntryAttachments.mediaCount(all.map(\.media)), entries: Set(all.map(\.card.id)).count))
                            .font(.subheadline).foregroundStyle(Theme.muted)
                        GeometryReader { geo in
                            let laid = PhotoLayout.layout(ratios, PhotoLayout.options(geo.size.width))
                            ZStack(alignment: .topLeading) {
                                ForEach(Array(days.enumerated()), id: \.element.day) { d, day in
                                    let head = laid.heads[d]
                                    dayHead(day).frame(width: max(head.w, 120), height: head.h, alignment: .bottomLeading).offset(x: head.x, y: head.y)
                                    ForEach(Array(day.items.enumerated()), id: \.element.item.id) { i, pair in
                                        let box = laid.tiles[d][i]
                                        tile(Item(media: pair.item, card: pair.card)).frame(width: box.w, height: box.h).offset(x: box.x, y: box.y)
                                    }
                                }
                            }
                            .preference(key: HeightKey.self, value: laid.height)
                        }
                        .modifier(FitHeight())
                    }
                    .padding(16)
                }
            }
        }
        .pageBackground()
        .navigationTitle("Photos")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if !picked.isEmpty {
                    Text("\(picked.count) picked")
                    Button("Share…") { Task { await prepareShare(all) } }
                    Button("Done") { picked = [] }
                }
                PhoneTail()
            }
        }
        .placesPhoneTail()
        .onChange(of: viewing) { _, start in
            guard let start else { return }
            var entries: [String: (card: String, day: String)] = [:]
            for item in all { entries[item.id] = (item.card.id, Stream.entryDay(item.card)) }
            model.viewer = ViewerRequest(media: all.map(\.media), start: start, vaultId: all.first { $0.id == start }?.card.vaultId ?? "", entries: entries)
            viewing = nil
        }
        .sheet(isPresented: Binding(get: { !sharing.isEmpty }, set: { if !$0 { sharing = [] } })) {
            VStack(spacing: 16) {
                Text("\(sharing.count) ready to share").font(.headline)
                ShareLink(items: sharing) { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent)
                Button("Done") { sharing = [] }
            }
            .padding(24)
        }
    }

    private func dayHead(_ day: HeldDay<Doc.Media>) -> some View {
        let ids = day.items.map(\.item.id)
        let all = ids.allSatisfy(picked.contains)
        return HStack(spacing: 6) {
            if !picked.isEmpty {
                Button { if all { picked.subtract(ids) } else { picked.formUnion(ids) } } label: {
                    Image(systemName: all ? "checkmark.circle.fill" : "circle").foregroundStyle(all ? Theme.accent : Theme.muted)
                }
                .buttonStyle(.plain)
            }
            Text(DateKey.relativeDay(day.day, today: model.today)).font(.system(size: 15, weight: .semibold)).lineLimit(1)
        }
        .padding(.bottom, 8)
        .contextMenu { Button(all ? "Unpick this day" : "Pick this day") { if all { picked.subtract(ids) } else { picked.formUnion(ids) } } }
    }

    private func tile(_ item: Item) -> some View {
        ShapedFill(media: item.media, vaultId: item.card.vaultId)
            .overlay(alignment: .topLeading) {
                if !picked.isEmpty {
                    Image(systemName: picked.contains(item.id) ? "checkmark.circle.fill" : "circle")
                        .font(.title3).foregroundStyle(.white, Theme.accent).shadow(radius: 2).padding(6)
                }
            }
            .overlay { if picked.contains(item.id) { RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.accent, lineWidth: 3) } }
            .contentShape(Rectangle())
            .onTapGesture { if picked.isEmpty { viewing = item.id } else { toggle(item.id) } }
            .modifier(PickOnCommandClick { toggle(item.id) })
            .contextMenu { PhotoItemMenu(item: item) }
    }

    private func toggle(_ id: String) {
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
    }

    /// The picked photos in files of their own, to share or save.
    private func prepareShare(_ all: [Item]) async {
        var urls: [URL] = []
        for item in all where picked.contains(item.id) {
            let name: String =
                switch item.media {
                case .photo(let id): "Photo \(id.prefix(8)).jpg"
                case .video(let f): f.name
                }
            if let url = await Attachments.shared.fileURL(item.id, name: name, model: model) { urls.append(url) }
        }
        sharing = urls
    }
}

/// A photo or a video's still filling its tile, which is cut to its shape; its shape kept once it's seen.
struct ShapedFill: View {
    @Environment(AppModel.self) private var model
    let media: Doc.Media
    let vaultId: String
    @State private var image: PlatformImage?

    var body: some View {
        ZStack {
            Theme.sunken
            if let image { Image(platform: image).resizable().scaledToFill() } else { Image(systemName: "photo").foregroundStyle(Theme.muted) }
        }
        .overlay(alignment: .topTrailing) { if case .video(let f) = media { VideoMark(duration: f.duration) } }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: media.id) {
            let id: String =
                switch media {
                case .photo(let id): id
                case .video(let file): file.poster ?? Doc.posterId(file.id)
                }
            image = await Attachments.shared.thumbnail(id, pixels: 800, model: model)
            if let image, image.size.height > 0 { PhotoShapes.shared.keep(media.id, Double(image.size.width / image.size.height)) }
        }
    }
}

struct HeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Gives a GeometryReader the height its content reports, so a laid-out canvas scrolls.
struct FitHeight: ViewModifier {
    @State private var height: CGFloat = 200
    func body(content: Content) -> some View {
        content.frame(height: height).onPreferenceChange(HeightKey.self) { height = max(1, $0) }
    }
}

/// A photo's or video's menu on the Photos page: open its entry, show it in the journal, copy it, share it by link.
struct PhotoItemMenu: View {
    let item: PhotosPage.Item

    var body: some View {
        PhotoMenu(id: item.id, card: item.card)
        PublicLinkMenu(id: item.id, vaultId: item.card.vaultId)
    }
}

/// Share via public link: shares the photo, video or file from Google Drive so anyone with the link can open it,
/// and copies the link; once shared, Copy public link and Stop sharing link.
struct PublicLinkMenu: View {
    @Environment(AppModel.self) private var model
    let id: String
    let vaultId: String

    var body: some View {
        if model.vault(vaultId).map({ $0.role != .viewer && !$0.isEncrypted }) ?? false {
            Button("Share via public link") {
                Task {
                    switch await model.api.shareDriveLink(id) {
                    case .success(let url):
                        Clipboard.copy(url)
                        model.say("Public link copied")
                    case .failure(let error):
                        model.say(error.localizedDescription)
                    }
                }
            }
            Button("Stop sharing link") {
                Task { model.say(await model.api.stopDriveLink(id) ? "No longer shared by link" : "That didn't work. Try again.") }
            }
        }
    }
}
