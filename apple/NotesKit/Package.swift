// swift-tools-version: 6.2
import PackageDescription

/// The app's core, shared by the Mac and iPhone apps: card models, local storage, and sync with the server.
let package = Package(
    name: "NotesKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [.library(name: "NotesKit", targets: ["NotesKit"])],
    targets: [
        .target(name: "NotesKit", linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "NotesKitTests", dependencies: ["NotesKit"]),
    ]
)
