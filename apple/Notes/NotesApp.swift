import NotesKit
import SwiftUI

@main
struct NotesApp: App {
    /// `-server http://localhost:8788` at launch points the app at a local server, for testing.
    @State private var model = AppModel(site: UserDefaults.standard.string(forKey: "server").flatMap(URL.init(string:)) ?? ServerAPI.production)
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .onOpenURL { _ in Task { await model.sync?.sync() } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.sync?.sync() } }
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 740)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Note") { model.requestNewNote() }.keyboardShortcut("n")
            }
        }
        #endif
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        switch model.phase {
        case .loading: ProgressView()
        case .signedOut: SignInView()
        case .signedIn: MainView().task { await model.syncPeriodically() }
        }
    }
}

extension AppModel {
    /// Once a minute while the app is open.
    func syncPeriodically() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            await sync?.sync()
        }
    }
}
