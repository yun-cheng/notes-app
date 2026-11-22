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

    public static let minLength = 4

    /// A verifier for a PIN, as the web app's `hashPin`: PBKDF2-SHA256, 300,000 rounds, a random salt.
    public static func hash(_ pin: String) -> JSONValue {
        let salt = VaultKeys.random(16)
        let iterations: UInt32 = 300_000
        return ["salt": .string(salt.base64EncodedString()), "hash": .string(pbkdf2(pin, salt: salt, iterations: iterations).base64EncodedString()), "iterations": .int(Int64(iterations))]
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

    /// The key of an encrypted vault, or nil if the PIN is wrong (or a member hasn't been let in yet).
    public static func unlock(encryption: JSONValue, pin: String, vaultId: String = "") -> SymmetricKey? {
        VaultKeys.unlock(encryption, pin: pin, vaultId: vaultId)
    }
}
