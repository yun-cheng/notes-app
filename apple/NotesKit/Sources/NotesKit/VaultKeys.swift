import CryptoKit
import Foundation

/// Making and sharing encrypted vaults' keys, as the web app's `crypto/vaultKeys.ts` does, byte for byte.
///
/// An owner's copy of the key is wrapped under their PIN (Argon2id) and under a recovery key. A member's device makes
/// a P-256 key pair and keeps the private half wrapped under the member's own PIN; the owner's device, once the owner
/// lets them in, seals the vault key to the public half (ECDH, HKDF-SHA256, AES-GCM, bound to the vault).
public enum VaultKeys {
    static let memberAAD = Data("notes-app member key v1".utf8)
    static let grantInfo = Data("notes-app vault grant v1".utf8)

    /// OWASP's recommended Argon2id settings: about a quarter second on a phone.
    public struct Kdf: Sendable, Equatable {
        public var memory = 19_456
        public var iterations = 2
        public var parallelism = 1

        public init(memory: Int = 19_456, iterations: Int = 2, parallelism: Int = 1) {
            self.memory = memory
            self.iterations = iterations
            self.parallelism = parallelism
        }
    }

    static func random(_ count: Int) -> Data {
        var g = SystemRandomNumberGenerator()
        return Data((0..<count).map { _ in UInt8.random(in: 0...255, using: &g) })
    }

    /// The key a PIN makes with these Argon2id settings, or nil for settings out of bounds.
    static func pinKey(_ pin: String, kdf: JSONValue?) -> SymmetricKey? {
        guard kdf?["name"]?.stringValue == "argon2id",
            let salt = kdf?["salt"]?.stringValue.flatMap({ Data(base64Encoded: $0) }),
            let memory = kdf?["memory"]?.intValue, let iterations = kdf?["iterations"]?.intValue,
            let parallelism = kdf?["parallelism"]?.intValue,
            memory >= 8, memory <= 1_048_576, iterations >= 1, iterations <= 64, parallelism >= 1, parallelism <= 16
        else { return nil }
        let raw = Argon2id.hash(
            password: Data(pin.precomposedStringWithCanonicalMapping.utf8), salt: salt,
            memoryKiB: Int(memory), iterations: Int(iterations), parallelism: Int(parallelism), length: 32)
        return SymmetricKey(data: raw)
    }

    static func newKdf(_ params: Kdf) -> JSONValue {
        [
            "name": "argon2id", "salt": .string(random(16).base64EncodedString()), "memory": .int(Int64(params.memory)),
            "iterations": .int(Int64(params.iterations)), "parallelism": .int(Int64(params.parallelism)),
        ]
    }

    static func raw(_ key: SymmetricKey) -> Data { key.withUnsafeBytes { Data($0) } }

    // MARK: The owner's copy

    /// Recovery keys: 160 random bits in Crockford base32, grouped in fours for writing down.
    static func base32(_ bytes: Data) -> String {
        var bits = 0
        var value = 0
        var out = ""
        for byte in bytes {
            value = (value << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                out.append(VaultCrypto.recoveryAlphabet[(value >> (bits - 5)) & 31])
                bits -= 5
            }
            value &= (1 << bits) - 1
        }
        return stride(from: 0, to: out.count, by: 4).map { i in
            String(out.dropFirst(i).prefix(4))
        }.joined(separator: "-")
    }

    static func recoveryKek(_ text: String) -> SymmetricKey? {
        guard let clean = VaultCrypto.normalizeRecoveryKey(text) else { return nil }
        return SymmetricKey(data: SHA256.hash(data: Data("notes-app recovery v1:\(clean)".utf8)))
    }

    public struct NewKey: Sendable {
        public let key: SymmetricKey
        public let encryption: JSONValue
        /// Shown to the owner once, never stored.
        public let recoveryKey: String
    }

    /// A new vault key, wrapped under `pin` and a new recovery key.
    public static func create(pin: String, kdf: Kdf = Kdf()) throws -> NewKey {
        let raw = random(32)
        let recoveryKey = base32(random(20))
        let params = newKdf(kdf)
        let recovery = try VaultCrypto.seal(recoveryKek(recoveryKey)!, raw, aad: VaultCrypto.wrapAAD)
        let wrapped = try VaultCrypto.seal(pinKey(pin, kdf: params)!, raw, aad: VaultCrypto.wrapAAD)
        return NewKey(
            key: SymmetricKey(data: raw), encryption: ["version": 1, "kdf": params, "wrapped": .string(wrapped), "recovery": .string(recovery)],
            recoveryKey: recoveryKey)
    }

    /// The same vault key wrapped under a new PIN. Cards need nothing done, and the recovery key still works.
    public static func changePin(_ encryption: JSONValue, key: SymmetricKey, newPin: String, kdf: Kdf = Kdf()) throws -> JSONValue {
        let params = newKdf(kdf)
        var out = encryption
        out["kdf"] = params
        out["wrapped"] = .string(try VaultCrypto.seal(pinKey(newPin, kdf: params)!, raw(key), aad: VaultCrypto.wrapAAD))
        return out
    }

    /// Whether this copy of a vault's encryption is a member's.
    public static func isMemberCopy(_ encryption: JSONValue) -> Bool { encryption.objectValue?.keys.contains("member") ?? false }

    /// The vault key, or nil if the PIN is wrong or, for a member, if they haven't been let in yet.
    public static func unlock(_ encryption: JSONValue, pin: String, vaultId: String) -> SymmetricKey? {
        if isMemberCopy(encryption) {
            guard let member = encryption["member"], !member.isNull else { return nil }
            return openMemberKey(member, pin: pin, vaultId: vaultId)
        }
        guard let kek = pinKey(pin, kdf: encryption["kdf"]), let wrapped = encryption["wrapped"]?.stringValue else { return nil }
        return VaultCrypto.open(kek, wrapped, aad: VaultCrypto.wrapAAD).map(SymmetricKey.init(data:))
    }

    // MARK: A member's copy

    static func grantAAD(_ vaultId: String) -> Data { Data("grant|\(vaultId)".utf8) }

    static func grantKey(_ privateKey: P256.KeyAgreement.PrivateKey, _ publicKey: P256.KeyAgreement.PublicKey, ephemeral: Data, member: Data) throws
        -> SymmetricKey
    {
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
        return shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: ephemeral, sharedInfo: grantInfo + member, outputByteCount: 32)
    }

    /// A new key pair for asking a vault's owner for its key, the private half wrapped under the member's PIN.
    public static func request(pin: String, kdf: Kdf = Kdf()) throws -> JSONValue {
        let pair = P256.KeyAgreement.PrivateKey()
        let params = newKdf(kdf)
        let wrapped = try VaultCrypto.seal(pinKey(pin, kdf: params)!, pair.derRepresentation, aad: memberAAD)
        return ["kdf": params, "wrapped": .string(wrapped), "public": .string(pair.publicKey.derRepresentation.base64EncodedString()), "grant": nil]
    }

    /// Seals a vault key for a member's public key: an ephemeral key pair's public half, then the vault key sealed under
    /// what ECDH gives with theirs, bound to the vault.
    public static func grant(_ vaultKey: SymmetricKey, to memberPublic: String, vaultId: String) throws -> String {
        guard let member = Data(base64Encoded: memberPublic) else { throw CryptoKitError.incorrectParameterSize }
        let theirs = try P256.KeyAgreement.PublicKey(derRepresentation: member)
        let pair = P256.KeyAgreement.PrivateKey()
        let ephemeral = pair.publicKey.x963Representation
        let key = try grantKey(pair, theirs, ephemeral: ephemeral, member: member)
        let sealed = try VaultCrypto.seal(key, raw(vaultKey), aad: grantAAD(vaultId))
        return (ephemeral + Data(base64Encoded: sealed)!).base64EncodedString()
    }

    static func openMemberKey(_ member: JSONValue, pin: String, vaultId: String) -> SymmetricKey? {
        guard let grantText = member["grant"]?.stringValue, let grant = Data(base64Encoded: grantText), grant.count > 65,
            let publicText = member["public"]?.stringValue, let publicBytes = Data(base64Encoded: publicText),
            let kek = pinKey(pin, kdf: member["kdf"]), let wrapped = member["wrapped"]?.stringValue,
            let privateBytes = VaultCrypto.open(kek, wrapped, aad: memberAAD),
            let privateKey = try? P256.KeyAgreement.PrivateKey(derRepresentation: privateBytes)
        else { return nil }
        let ephemeral = grant.prefix(65)
        guard let theirs = try? P256.KeyAgreement.PublicKey(x963Representation: ephemeral),
            let key = try? grantKey(privateKey, theirs, ephemeral: Data(ephemeral), member: publicBytes),
            let raw = VaultCrypto.open(key, Data(grant.dropFirst(65)).base64EncodedString(), aad: grantAAD(vaultId))
        else { return nil }
        return SymmetricKey(data: raw)
    }

    /// A member's new PIN: a new key pair, with the vault key they have open sealed to it themselves.
    public static func changeMemberPin(_ vaultKey: SymmetricKey, newPin: String, vaultId: String, kdf: Kdf = Kdf()) throws -> JSONValue {
        var next = try request(pin: newPin, kdf: kdf)
        next["grant"] = .string(try grant(vaultKey, to: next["public"]!.stringValue!, vaultId: vaultId))
        return next
    }

    // MARK: Codes to compare

    /// Four groups of four digits from the first eight bytes.
    static func code(_ bytes: Data) -> String {
        let b = [UInt8](bytes)
        return stride(from: 0, to: 8, by: 2).map { i in String(format: "%04d", ((Int(b[i]) << 8) | Int(b[i + 1])) % 10_000) }.joined(separator: " ")
    }

    /// A short code for a public key, for the owner and the member to compare before the owner lets them in.
    public static func keyCode(_ publicKey: String) -> String {
        code(Data(SHA256.hash(data: Data(base64Encoded: publicKey) ?? Data())))
    }

    /// A short code for a vault key itself, for everyone in a shared encrypted vault to compare once they're in: the
    /// tag of nothing sealed under a nonce of zeros, bound to the vault.
    public static func vaultKeyCode(_ key: SymmetricKey, vaultId: String) -> String {
        let box = try! AES.GCM.seal(Data(), using: key, nonce: try! AES.GCM.Nonce(data: Data(count: 12)), authenticating: Data("key check|\(vaultId)".utf8))
        return code(box.tag)
    }

    // MARK: Comments

    static func commentAAD(_ cardId: String, _ vaultId: String) -> Data { Data("comment|\(cardId)|\(vaultId)".utf8) }

    /// A comment in an encrypted vault, sealed with its key and bound to its card, as the card itself is.
    public static func encryptComment(_ key: SymmetricKey, _ body: String, cardId: String, vaultId: String) throws -> String {
        VaultCrypto.prefix + (try VaultCrypto.seal(key, Data(body.utf8), aad: commentAAD(cardId, vaultId)))
    }

    public static func decryptComment(_ key: SymmetricKey, _ body: String, cardId: String, vaultId: String) -> String? {
        guard VaultCrypto.isEncrypted(body),
            let plain = VaultCrypto.open(key, String(body.dropFirst(VaultCrypto.prefix.count)), aad: commentAAD(cardId, vaultId))
        else { return nil }
        return String(data: plain, encoding: .utf8)
    }
}
