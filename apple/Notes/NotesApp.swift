import NotesKit
import SwiftUI
import UserNotifications
#if os(macOS)
import AppKit
#endif

@main
struct NotesApp: App {
    /// `-server http://localhost:8788` at launch points the app at a local server, for testing.
    @State private var model = AppModel(site: UserDefaults.standard.string(forKey: "server").flatMap(URL.init(string:)) ?? ServerAPI.production)
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task {
                    UNUserNotificationCenter.current().delegate = ReminderDelegate.shared
                    ReminderDelegate.shared.open = { id in model.openEntry = id }
                }
                .onOpenURL { _ in Task { await model.sync?.sync() } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.sync?.sync() } }
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 740)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Note") {
                    model.page = .journal(StreamFilter())
                    model.focusBox += 1
                }
                .keyboardShortcut("n")
            }
            // Cmd+Z undoes the last change anywhere in the app, as on the web, except while typing in a text field,
            // which keeps its own undo.
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") {
                    if let text = NSApp.keyWindow?.firstResponder as? NSTextView, text.isEditable { text.undoManager?.undo() } else { model.undo() }
                }
                .keyboardShortcut("z")
                Button("Redo") {
                    if let text = NSApp.keyWindow?.firstResponder as? NSTextView, text.isEditable { text.undoManager?.redo() } else { model.redo() }
                }
                .keyboardShortcut("z", modifiers: [.command, .shift])
            }
            CommandGroup(after: .textEditing) {
                Button("Search…") { model.showPalette = true }.keyboardShortcut("k")
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
