import CryptoKit
import Foundation
import Testing

@testable import NotesKit

@Suite struct AttachmentSealTests {
    /// 3,000 bytes (i % 251) sealed by the web app's attachmentSeal.ts as att-1 in v-enc, under EncryptionTests.rawKey.
    static let web = "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"

    @Test func opensWhatTheWebAppSealed() throws {
        let sealed = try #require(Data(base64Encoded: Self.web))
        #expect(AttachmentSeal.sealedVault(sealed) == "v-enc")
        let opened = try #require(AttachmentSeal.open(sealed, id: "att-1", key: VaultKeyTests.vaultKey))
        #expect(opened.data == Data((0..<3000).map { UInt8($0 % 251) }))
        #expect(opened.facts.mime == "image/jpeg" && opened.facts.name == "cat.jpg" && opened.facts.width == 40)
        // Bound to its ID.
        #expect(AttachmentSeal.open(sealed, id: "att-2", key: VaultKeyTests.vaultKey) == nil)
    }

    @Test func sealsAndOpensBigFilesInPieces() throws {
        let body = Data((0..<(2 * AttachmentSeal.pieceBytes + 5)).map { UInt8($0 % 199) })
        let facts = AttachmentSeal.Facts(mime: "video/mp4", size: body.count, name: "clip.mp4", duration: 3)
        let sealed = try AttachmentSeal.seal(body, id: "v1", vaultId: "v-enc", key: VaultKeyTests.vaultKey, facts: facts)
        #expect(sealed.count > AttachmentSeal.padded(body.count))
        let opened = try #require(AttachmentSeal.open(sealed, id: "v1", key: VaultKeyTests.vaultKey))
        #expect(opened.data == body && opened.facts.duration == 3)
        #expect(AttachmentSeal.padded(1000) == 1024 && AttachmentSeal.padded(25 * 1024 * 1024) == 25 * 1024 * 1024)
    }
}
