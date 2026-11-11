import CryptoKit
import Foundation
import Synchronization

/// End-to-end encryption for private vaults, compatible with the web app's `crypto/vaultKeys.ts`.
/// A card payload in an encrypted vault is `e1:` + base64(iv + ciphertext + tag), AES-256-GCM,
/// with the card's ID and vault as associated data.
public enum VaultCrypto {
    static let prefix = "e1:"
    static let wrapAAD = Data("notes-app vault key v1".utf8)
    static let recoveryAlphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    public static func isEncrypted(_ payload: String) -> Bool { payload.hasPrefix(prefix) }

    static func aad(cardId: String, vaultId: String) -> Data { Data("\(cardId)|\(vaultId)".utf8) }

    static func seal(_ key: SymmetricKey, _ plain: Data, aad: Data) throws -> String {
        let box = try AES.GCM.seal(plain, using: key, authenticating: aad)
        return box.combined!.base64EncodedString()
    }

    static func open(_ key: SymmetricKey, _ sealed: String, aad: Data) -> Data? {
        guard let bytes = Data(base64Encoded: sealed), let box = try? AES.GCM.SealedBox(combined: bytes) else { return nil }
        return try? AES.GCM.open(box, using: key, authenticating: aad)
    }

    public static func encryptPayload(_ key: SymmetricKey, _ text: String, cardId: String, vaultId: String) throws -> String {
        prefix + (try seal(key, Data(text.utf8), aad: aad(cardId: cardId, vaultId: vaultId)))
    }

    public static func decryptPayload(_ key: SymmetricKey, _ data: String, cardId: String, vaultId: String) -> String? {
        guard isEncrypted(data), let plain = open(key, String(data.dropFirst(prefix.count)), aad: aad(cardId: cardId, vaultId: vaultId)) else { return nil }
        return String(data: plain, encoding: .utf8)
    }

    /// The recovery key as typed: case, spaces and dashes don't matter, and look-alike letters are forgiven.
    public static func normalizeRecoveryKey(_ text: String) -> String? {
        let clean = text.uppercased().filter { !$0.isWhitespace && $0 != "-" }
            .replacingOccurrences(of: "O", with: "0").replacingOccurrences(of: "I", with: "1").replacingOccurrences(of: "L", with: "1")
        return clean.count == 32 && clean.allSatisfy(recoveryAlphabet.contains) ? clean : nil
    }

    /// The vault key, or nil if the recovery key is wrong.
    public static func unlock(encryption: JSONValue, recoveryKey: String) -> SymmetricKey? {
        guard let clean = normalizeRecoveryKey(recoveryKey), let wrapped = encryption["recovery"]?.stringValue else { return nil }
        let kek = SymmetricKey(data: SHA256.hash(data: Data("notes-app recovery v1:\(clean)".utf8)))
        return open(kek, wrapped, aad: wrapAAD).map(SymmetricKey.init(data:))
    }
}

public struct VaultLocked: Error {}

/// The open vault keys on this device, in memory only, and the encoding of card payloads with them.
public final class Keyring: Sendable {
    private struct State {
        var keys: [String: SymmetricKey] = [:]
        var encrypted: Set<String> = []
    }

    private let state = Mutex(State())

    public init() {}

    public func setVaults(_ vaults: [Vault]) {
        state.withLock { $0.encrypted = Set(vaults.filter(\.isEncrypted).map(\.id)) }
    }

    public func isEncrypted(_ vaultId: String) -> Bool { state.withLock { $0.encrypted.contains(vaultId) } }
    public func hasKey(_ vaultId: String) -> Bool { state.withLock { $0.keys[vaultId] != nil } }
    public func set(_ vaultId: String, key: SymmetricKey) { state.withLock { $0.keys[vaultId] = key } }
    public func forget(_ vaultId: String) { state.withLock { _ = $0.keys.removeValue(forKey: vaultId) } }
    public func forgetAll() { state.withLock { $0.keys.removeAll() } }

    func encode(_ payload: [String: JSONValue], id: String, vaultId: String) throws -> String {
        let text = try JSON.string(payload)
        let (encrypted, key) = state.withLock { ($0.encrypted.contains(vaultId), $0.keys[vaultId]) }
        guard encrypted else { return text }
        guard let key else { throw VaultLocked() }
        return try VaultCrypto.encryptPayload(key, text, cardId: id, vaultId: vaultId)
    }

    /// The payload, or nil when it's encrypted and this device doesn't have the key.
    func decode(_ data: String, id: String, vaultId: String) -> [String: JSONValue]? {
        if !VaultCrypto.isEncrypted(data) { return try? JSON.decode([String: JSONValue].self, from: data) }
        guard let key = state.withLock({ $0.keys[vaultId] }),
            let text = VaultCrypto.decryptPayload(key, data, cardId: id, vaultId: vaultId)
        else { return nil }
        return try? JSON.decode([String: JSONValue].self, from: text)
    }
}
