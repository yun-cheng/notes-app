import CommonCrypto
import CryptoKit
import Foundation

/// Opening private vaults with their PIN, as the web app's `domain/pin.ts` and `crypto/vaultKeys.ts` do.
public enum VaultPin {
    /// Checks a PIN against a vault made before encryption, whose PIN only gates the app.
    public static func verify(_ pin: String, against stored: JSONValue) -> Bool {
        guard let salt = stored["salt"]?.stringValue.flatMap({ Data(base64Encoded: $0) }),
            let hash = stored["hash"]?.stringValue,
            let iterations = stored["iterations"]?.intValue, iterations > 0, iterations <= 10_000_000
        else { return false }
        return pbkdf2(pin, salt: salt, iterations: UInt32(iterations)).base64EncodedString() == hash
    }

    static func pbkdf2(_ pin: String, salt: Data, iterations: UInt32) -> Data {
        var out = Data(count: 32)
        let password = Array(pin.utf8)
        _ = out.withUnsafeMutableBytes { outBytes in
            salt.withUnsafeBytes { saltBytes in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2), password.map { CChar(bitPattern: $0) }, password.count,
                    saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations,
                    outBytes.bindMemory(to: UInt8.self).baseAddress, 32)
            }
        }
        return out
    }

    /// The key of an encrypted vault, or nil if the PIN is wrong.
    public static func unlock(encryption: JSONValue, pin: String) -> SymmetricKey? {
        let kdf = encryption["kdf"]
        guard kdf?["name"]?.stringValue == "argon2id",
            let salt = kdf?["salt"]?.stringValue.flatMap({ Data(base64Encoded: $0) }),
            let memory = kdf?["memory"]?.intValue, let iterations = kdf?["iterations"]?.intValue,
            let parallelism = kdf?["parallelism"]?.intValue,
            let wrapped = encryption["wrapped"]?.stringValue,
            memory >= 8, memory <= 1_048_576, iterations >= 1, iterations <= 64, parallelism >= 1, parallelism <= 16
        else { return nil }
        let raw = Argon2id.hash(
            password: Data(pin.precomposedStringWithCanonicalMapping.utf8), salt: salt,
            memoryKiB: Int(memory), iterations: Int(iterations), parallelism: Int(parallelism), length: 32)
        return VaultCrypto.open(SymmetricKey(data: raw), wrapped, aad: VaultCrypto.wrapAAD).map(SymmetricKey.init(data:))
    }
}
