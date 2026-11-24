import Foundation

/// Which build this is. A build from Xcode (the Debug configuration) is its own app, "Notes Dev" on an amber icon, with
/// its own bundle ID (`dev.notesapp.notes.dev`), data, sign-in and link scheme (`notesapp-dev`), so it's installed beside
/// the released app rather than over it. project.yml sets these, and Info.plist carries the scheme as `AppScheme`.
enum AppBuild {
    static let id = Bundle.main.bundleIdentifier ?? "dev.notesapp.notes"
    static let scheme = Bundle.main.object(forInfoDictionaryKey: "AppScheme") as? String ?? "notesapp"
    static var isDev: Bool { scheme == "notesapp-dev" }
}
