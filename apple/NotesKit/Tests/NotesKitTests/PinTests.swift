import Foundation
import Testing

@testable import NotesKit

@Suite struct PinTests {
    @Test func blake2bMatchesItsSpec() {
        // RFC 7693 appendix A: BLAKE2b-512("abc").
        let hex = Blake2b.hash(Array("abc".utf8), length: 64).map { String(format: "%02x", $0) }.joined()
        #expect(hex == "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923")
    }

    @Test func argon2idMatchesTheRFC() {
        // RFC 9106 section 5.3.
        let tag = Argon2id.hash(
            password: Data(repeating: 1, count: 32), salt: Data(repeating: 2, count: 16),
            secret: Data(repeating: 3, count: 8), associated: Data(repeating: 4, count: 12),
            memoryKiB: 32, iterations: 3, parallelism: 4, length: 32)
        #expect(tag.map { String(format: "%02x", $0) }.joined() == "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659")
    }

    @Test func unlocksAVaultTheWebAppEncrypted() throws {
        let key = try #require(VaultPin.unlock(encryption: EncryptionTests.encryption, pin: "2468"))
        #expect(key.withUnsafeBytes { Data($0).base64EncodedString() } == EncryptionTests.rawKey)
        #expect(VaultPin.unlock(encryption: EncryptionTests.encryption, pin: "1357") == nil)
    }

    @Test func checksAPinFromBeforeEncryption() {
        let salt = Data(repeating: 7, count: 16)
        // As WebCrypto's PBKDF2-SHA256 computes it.
        let hash = "c1Gl7KFFAESaww/JAnmMf2hIA+g+cyYUK9+LPoRe+tg="
        let stored: JSONValue = ["salt": .string(salt.base64EncodedString()), "hash": .string(hash), "iterations": 1000]
        #expect(VaultPin.verify("4321", against: stored))
        #expect(!VaultPin.verify("4322", against: stored))
    }
}
