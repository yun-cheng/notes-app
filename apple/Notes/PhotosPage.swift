import NotesKit
import SwiftUI

/// Every photo and video in the journal, as a photo library shows them, as the web app's Photos page: under the day
/// each entry was written, opening full screen to page through them all, picked to share, with a menu to open their
/// entry, copy or share by a public link. A switch shows them all, the photos alone or the videos alone.
struct PhotosPage: View {
    @Environment(AppModel.self) private var model
    enum Kind: String, CaseIterable { case all = "All", photos = "Photos", videos = "Videos" }
    @State private var kind = Kind.all
    @State private var viewing: String?
    @State private var picked: Set<String> = []
    @State private var sharing: [URL] = []

    struct Item: Identifiable, Hashable {
        var media: Doc.Media
        var card: Card
        var id: String { media.id }
    }

    var body: some View {
        let items = Stream.items(model.index, StreamFilter(sort: .newest, has: .photo), today: model.today, sharedInto: model.sharedInto)
            + Stream.items(model.index, StreamFilter(sort: .newest, has: .file), today: model.today, sharedInto: model.sharedInto)
        var seen = Set<String>()
        let all: [Item] = items.sorted { $0.at > $1.at }.flatMap { item in
            Doc.media(item.card.content).filter { m in
                switch (kind, m) {
                case (.photos, .video), (.videos, .photo): return false
                default: return seen.insert(m.id).inserted
                }
            }.map { Item(media: $0, card: item.card) }
        }
        let days = Dictionary(grouping: all) { Stream.entryDay($0.card) }.sorted { $0.key > $1.key }
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14, pinnedViews: .sectionHeaders) {
                ForEach(days, id: \.key) { day, dayItems in
                    Section {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 4)], spacing: 4) {
                            ForEach(dayItems) { item in
                                PhotoThumb(media: item.media, vaultId: item.card.vaultId)
                                    .overlay(alignment: .topTrailing) {
                                        if !picked.isEmpty || picked.contains(item.id) {
                                            Image(systemName: picked.contains(item.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(.white, Theme.accent).padding(5)
                                        }
                                    }
                                    .onTapGesture { if picked.isEmpty { viewing = item.id } else { toggle(item.id) } }
                                    .modifier(PickOnCommandClick { toggle(item.id) })
                                    .contextMenu { PhotoItemMenu(item: item) }
                            }
                        }
                    } header: {
                        HStack {
                            Text(DateKey.relativeDay(day, today: model.today)).font(.subheadline.weight(.semibold))
                            Spacer()
                            Button(dayItems.allSatisfy { picked.contains($0.id) } ? "Unpick" : "Pick") {
                                let ids = dayItems.map(\.id)
                                if ids.allSatisfy(picked.contains) { picked.subtract(ids) } else { picked.formUnion(ids) }
                            }
                            .font(.caption).buttonStyle(.borderless)
                        }
                        .padding(.vertical, 4)
                        .background(Theme.bg)
                    }
                }
                if all.isEmpty { ContentUnavailableView("No photos yet", systemImage: "photo").padding(.top, 60) }
            }
            .padding(16)
        }
        .pageBackground()
        .navigationTitle("Photos")
        .toolbar {
            ToolbarItem {
                Picker("Show", selection: $kind) { ForEach(Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
            }
            if !picked.isEmpty {
                ToolbarItemGroup {
                    Text("\(picked.count) picked")
                    Button("Share…") { Task { await prepareShare(all) } }
                    Button("Done") { picked = [] }
                }
            }
        }
        .sheet(item: Binding(get: { viewing.map(OpenEntry.init) }, set: { viewing = $0?.id })) { start in
            // Full screen, paging through every photo on the page.
            MediaViewer(media: all.map(\.media), start: start.id, vaultId: all.first { $0.id == start.id }?.card.vaultId ?? "")
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
