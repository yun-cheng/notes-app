import Foundation
import Testing

@testable import NotesKit

/// A dev build is installed beside the released app, so the pages it opens send it back to its own scheme.
@Suite struct AppReturnTests {
    let api = ServerAPI(site: URL(string: "https://notes.test")!, token: nil)

    @Test func pairingComesBackToTheBuildThatAsked() throws {
        let pairing = try JSONDecoder().decode(ServerAPI.Pairing.self, from: Data(#"{"pair":"p1","code":"ABCD"}"#.utf8))
        #expect(api.pairingPage(pairing).absoluteString == "https://notes.test/pair?p=p1&return=app")
        #expect(api.pairingPage(pairing, dev: true).absoluteString == "https://notes.test/pair?p=p1&return=app-dev")
    }

    @Test func driveAsksForTheBuildsOwnReturn() throws {
        #expect(String(decoding: try JSONEncoder().encode(DriveConnectBody(dev: false)), as: UTF8.self) == #"{"app":true}"#)
        #expect(String(decoding: try JSONEncoder().encode(DriveConnectBody(dev: true)), as: UTF8.self) == #"{"app":"dev"}"#)
    }
}
