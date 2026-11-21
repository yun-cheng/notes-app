import CryptoKit
import Foundation
import Testing

@testable import NotesKit

@Suite struct VaultKeyTests {
    // Made by the web app's crypto/vaultKeys.ts: a member's key pair under PIN 1357, let in to vault v-shared, whose
    // key is EncryptionTests.rawKey.
    static let member: JSONValue = [
        "kdf": ["name": "argon2id", "salt": "lZzrYH35XzG7gPtLZCQsMg==", "memory": 64, "iterations": 1, "parallelism": 1],
        "wrapped": "HesSL2rbAghnlq5FbqMLjoj0FXlW5SkCIxbWp92kz0PQtD/Bd6i4+PFcJVTzAROg4I3FYyas/LEu5IayeMZvTMk8+CnaE5UNHqEvT5FzG0rvjr2YHtyAV4liSJCkl6tthLY1cvVN/ZXSPi2UhaaDA8kzlDsXxNHr/l9JN/NkSotuJ4gZmlB/00W0a+DR6N324T//SZ7gB3RTPlJ1b9v5hdZL8Utg+A==",
        "public": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4D4PtP3c4xGMv7jqLZS2lyco78mR2nAGjDiUh8hCqB18etZ9Or2Ov99g1ElIM7MyZaKu3NiJT8ePBefkOmeBCA==",
        "grant": "BG+WET4OYMhPWAJrZTpLyUrSIe7iFgB0a576stpESlOHlQpFb/RApnFvTPr1Gd/VO0c15utm/Ju0KK3XlWsztG0McY5JWA1edWOeMN3KM+2wLQJcWaFEiTdgXvXZ+jX0bP1IE2SHu5hfJa8L7td5uHgKIwXMXdotpgvxPTc=",
    ]
    static let fast = VaultKeys.Kdf(memory: 64, iterations: 1, parallelism: 1)
    static var vaultKey: SymmetricKey { SymmetricKey(data: Data(base64Encoded: EncryptionTests.rawKey)!) }

    @Test func aMemberOpensTheKeyTheWebAppGranted() throws {
        let encryption: JSONValue = ["version": 1, "member": Self.member]
        let key = try #require(VaultKeys.unlock(encryption, pin: "1357", vaultId: "v-shared"))
        #expect(VaultKeys.raw(key).base64EncodedString() == EncryptionTests.rawKey)
        #expect(VaultKeys.unlock(encryption, pin: "1358", vaultId: "v-shared") == nil)
        #expect(VaultKeys.unlock(encryption, pin: "1357", vaultId: "v-other") == nil)
        // Before the owner lets them in, there's nothing to open.
        #expect(VaultKeys.unlock(["version": 1, "member": nil], pin: "1357", vaultId: "v-shared") == nil)
    }

    @Test func codesMatchTheWebApp() {
        #expect(VaultKeys.keyCode(Self.member["public"]!.stringValue!) == "8554 4710 2605 6903")
        #expect(VaultKeys.vaultKeyCode(Self.vaultKey, vaultId: "v-shared") == "9938 2600 6745 6795")
    }

    @Test func commentsOpenAsTheWebAppSealedThem() throws {
        #expect(VaultKeys.decryptComment(Self.vaultKey, "e1:+ZQlq41cEpZTRBnGlliNIcnovvBlqWNHxTTefpZQqTQltBBVqqI=", cardId: "c1", vaultId: "v-shared") == "Looks good")
        let sealed = try VaultKeys.encryptComment(Self.vaultKey, "Agreed", cardId: "c1", vaultId: "v-shared")
        #expect(VaultKeys.decryptComment(Self.vaultKey, sealed, cardId: "c1", vaultId: "v-shared") == "Agreed")
        #expect(VaultKeys.decryptComment(Self.vaultKey, sealed, cardId: "c2", vaultId: "v-shared") == nil)
    }

    @Test func anOwnerLetsAMemberIn() throws {
        let asked = try VaultKeys.request(pin: "2580", kdf: Self.fast)
        var member = asked
        member["grant"] = .string(try VaultKeys.grant(Self.vaultKey, to: asked["public"]!.stringValue!, vaultId: "v-shared"))
        let key = try #require(VaultKeys.unlock(["version": 1, "member": member], pin: "2580", vaultId: "v-shared"))
        #expect(VaultKeys.raw(key) == VaultKeys.raw(Self.vaultKey))
        let changed = try VaultKeys.changeMemberPin(key, newPin: "0000", vaultId: "v-shared", kdf: Self.fast)
        #expect(VaultKeys.unlock(["version": 1, "member": changed], pin: "0000", vaultId: "v-shared").map(VaultKeys.raw) == VaultKeys.raw(Self.vaultKey))
    }

    @Test func aNewVaultKeyOpensWithItsPinAndRecoveryKey() throws {
        let made = try VaultKeys.create(pin: "4821", kdf: Self.fast)
        #expect(made.recoveryKey.count == 39 && made.recoveryKey.split(separator: "-").count == 8)
        #expect(VaultKeys.unlock(made.encryption, pin: "4821", vaultId: "v").map(VaultKeys.raw) == VaultKeys.raw(made.key))
        #expect(VaultCrypto.unlock(encryption: made.encryption, recoveryKey: made.recoveryKey.lowercased()).map(VaultKeys.raw) == VaultKeys.raw(made.key))
        let changed = try VaultKeys.changePin(made.encryption, key: made.key, newPin: "1111", kdf: Self.fast)
        #expect(VaultKeys.unlock(changed, pin: "4821", vaultId: "v") == nil)
        #expect(VaultKeys.unlock(changed, pin: "1111", vaultId: "v").map(VaultKeys.raw) == VaultKeys.raw(made.key))
        #expect(VaultCrypto.unlock(encryption: changed, recoveryKey: made.recoveryKey).map(VaultKeys.raw) == VaultKeys.raw(made.key))
    }
}
