import NotesKit
import SwiftUI
import UserNotifications
#if os(macOS)
import AppKit
#else
import BackgroundTasks
#endif

@main
struct NotesApp: App {
    /// `-server http://localhost:5191` at launch points the app at the local dev server, for testing (through Vite,
    /// which serves the demo's photos and files as well as passing `/api` on).
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
            if phase == .active {
                model.newDay()
                Task { await model.sync?.sync() }
            }
            #if os(iOS)
            if phase == .background { BackgroundSync.plan() }
            #endif
        }
        #if os(iOS)
        .backgroundTask(.appRefresh(BackgroundSync.id)) { [model] in
            BackgroundSync.plan()
            await model.syncInBackground()
        }
        #endif
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
            // Cmd+V in a text field pastes there; elsewhere in the journal what's pasted goes to the writing box to look
            // over before saving, as on the web (entries copied from the journal come back whole there).
            CommandGroup(replacing: .pasteboard) {
                Button("Cut") { NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: nil) }.keyboardShortcut("x")
                Button("Copy") { NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: nil) }.keyboardShortcut("c")
                Button("Paste") {
                    if NSApp.keyWindow?.firstResponder is NSTextView { NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil) }
                    else if case .journal = model.page, model.openEntry == nil, let text = NSPasteboard.general.string(forType: .string), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        model.pastedToBox = text
                    } else { NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: nil) }
                }
                .keyboardShortcut("v")
                Button("Select All") { NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil) }.keyboardShortcut("a")
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
