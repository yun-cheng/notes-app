import CryptoKit
import Foundation
import LocalAuthentication
import NotesKit
import Security

/// Opening a private vault with Face ID or Touch ID, as the web app's "Unlock with fingerprint". A Keychain item that
/// only the device's biometrics open holds the vault's key (an encrypted vault) or a mark (one locked by a PIN alone),
/// for one account's vault on this device. Adding a face or finger to the device turns it off, as the system does.
/// On a Mac, a Keychain item locked to Touch ID needs the app signed with a provisioning profile, which builds made
/// here aren't, so there it's kept in the ordinary Keychain and Touch ID is asked before it's read, as on the web.
enum DeviceUnlock {
    private static let service = AppBuild.id + ".vault"
    private static let mark = Data("open".utf8)

    private static func query(_ userId: String, _ vaultId: String) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "\(userId):\(vaultId)"]
        #if os(iOS)
        q[kSecUseDataProtectionKeychain as String] = true
        #endif
        return q
    }

    /// Whether this device can check a face or finger at all.
    static var available: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) }

    /// "Face ID", "Touch ID" or "Optic ID", for the switch and the button.
    static var name: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .opticID: return "Optic ID"
        default: return "Touch ID"
        }
    }

    /// Whether it's on for this vault, without asking for a face or finger.
    static func isOn(_ userId: String, _ vaultId: String) -> Bool {
        var q = query(userId, vaultId)
        q[kSecReturnAttributes as String] = true
        let context = LAContext()
        context.interactionNotAllowed = true
        q[kSecUseAuthenticationContext as String] = context
        let status = SecItemCopyMatching(q as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    enum Problem: LocalizedError {
        case cancelled, failed, needsPin
        var errorDescription: String? {
            switch self {
            case .cancelled: nil
            case .failed: "\(DeviceUnlock.name) couldn't be set up on this device."
            case .needsPin: "Open the vault first."
            }
        }
    }

    /// Turns it on: checks the face or finger once, then keeps the open vault's key (or the mark) behind it.
    static func turnOn(_ vault: Vault, userId: String, keyring: Keyring) async throws {
        var secret = mark
        if vault.isEncrypted {
            guard let key = keyring.key(vault.id) else { throw Problem.needsPin }
            secret = key.withUnsafeBytes { Data($0) }
        }
        do {
            _ = try await LAContext().evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Open \(vault.name) with \(name) on this device")
        } catch let error as LAError where [.userCancel, .appCancel, .systemCancel].contains(error.code) {
            throw Problem.cancelled
        } catch {
            throw Problem.failed
        }
        SecItemDelete(query(userId, vault.id) as CFDictionary)
        var q = query(userId, vault.id)
        q[kSecValueData as String] = secret
        #if os(iOS)
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil) else { throw Problem.failed }
        q[kSecAttrAccessControl as String] = access
        #else
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        #endif
        guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw Problem.failed }
    }

    static func turnOff(_ userId: String, _ vaultId: String) {
        SecItemDelete(query(userId, vaultId) as CFDictionary)
    }

    /// Asks for the face or finger, and gives what's kept: the vault's key, or the mark. Nil if it wasn't given.
    static func read(_ vault: Vault, userId: String) async -> Data? {
        var q = query(userId, vault.id)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        // The face or finger is checked here, and the Keychain takes that check rather than asking again: on a device
        // the item's own lock needs it too, and the simulator's Keychain, which doesn't, still has to ask.
        let context = LAContext()
        guard (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Open \(vault.name)")) == true else { return nil }
        q[kSecUseAuthenticationContext as String] = context
        let found = q
        return await Task.detached {
            var item: CFTypeRef?
            guard SecItemCopyMatching(found as CFDictionary, &item) == errSecSuccess else { return nil }
            return item as? Data
        }.value
    }
}

extension AppModel {
    /// Opens a private vault with Face ID or Touch ID. An encrypted one gets its key back from the Keychain.
    func unlockWithDevice(_ vault: Vault) async -> Bool {
        guard let userId = account?.id, let secret = await DeviceUnlock.read(vault, userId: userId) else { return false }
        if vault.isEncrypted {
            // A mark kept before the vault was encrypted holds no key: the PIN has to open it now.
            guard secret.count == 32 else {
                DeviceUnlock.turnOff(userId, vault.id)
                return false
            }
            repo.keyring.set(vault.id, key: SymmetricKey(data: secret))
        }
        await open(vault.id)
        return true
    }
}
