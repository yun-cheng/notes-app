import NotesKit
import SwiftUI

/// Opens a private vault with its PIN, or with its recovery key if the PIN is forgotten.
struct UnlockView: View {
    @Environment(AppModel.self) private var model
    let vault: Vault
    @State private var pin = ""
    @State private var useRecoveryKey = false
    @State private var working = false
    /// What went wrong with the last try, in the web's words.
    @State private var problem: String?
    /// Face ID or Touch ID is on for this vault here; it's asked for as the vault shows.
    @State private var deviceOn = false
    @State private var deviceFailed = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("\(vault.name) is private").font(.title2.bold())
            Text(useRecoveryKey ? "Enter the recovery key you saved when the vault was encrypted." : "Enter its PIN to open it on this device.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            PinField(useRecoveryKey ? "Recovery key" : "PIN", text: $pin, onSubmit: unlock)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 260)
            if let problem { Text(problem).foregroundStyle(.red) }
            Button(action: unlock) {
                if working { ProgressView() } else { Text("Unlock") }
            }
            .buttonStyle(.borderedProminent)
            .disabled(pin.isEmpty || working)
            if deviceOn && !useRecoveryKey {
                Button("Use \(DeviceUnlock.name)", systemImage: DeviceUnlock.name == "Face ID" ? "faceid" : "touchid") { useDevice() }
                    .buttonStyle(.borderless)
            }
            if deviceFailed { Text("\(DeviceUnlock.name) didn't work. Use your PIN.").foregroundStyle(.red) }
            if vault.isEncrypted {
                Button(useRecoveryKey ? "Use the PIN instead" : "Forgot PIN?") {
                    useRecoveryKey.toggle()
                    pin = ""
                    problem = nil
                }
                .buttonStyle(.borderless)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: vault.id) {
            deviceOn = model.account.map { DeviceUnlock.isOn($0.id, vault.id) } ?? false
            if deviceOn { useDevice() }
        }
    }

    private func useDevice() {
        guard !working else { return }
        working = true
        deviceFailed = false
        Task {
            let opened = await model.unlockWithDevice(vault)
            working = false
            deviceFailed = !opened
            if !opened { deviceOn = model.account.map { DeviceUnlock.isOn($0.id, vault.id) } ?? false }
        }
    }

    private func unlock() {
        guard !pin.isEmpty, !working else { return }
        working = true
        problem = nil
        let entered = pin
        let recovery = useRecoveryKey
        Task {
            // A PIN counts toward the wait after five wrong ones; a recovery key doesn't, as on the web.
            let result = recovery
                ? (await model.unlock(vault, pin: entered, recoveryKey: true) ? PinResult.ok : .wrong)
                : await model.unlock(vault, pin: entered)
            working = false
            problem = recovery && result == .wrong ? "That recovery key isn't right." : result.problem
            if result == .ok { pin = "" }
        }
    }
}

extension AppModel {
    /// Opens a private vault. An encrypted one gets its key, so its cards can be read and written.
    func unlock(_ vault: Vault, pin: String, recoveryKey: Bool) async -> Bool {
        let encryption = vault.encryption
        let stored = vault.pin
        let keyring = repo.keyring
        let vaultId = vault.id
        // Argon2id takes a moment, so it runs off the main thread.
        let opened: Bool = await Task.detached {
            if let encryption, !encryption.isNull {
                let key = recoveryKey ? VaultCrypto.unlock(encryption: encryption, recoveryKey: pin) : VaultPin.unlock(encryption: encryption, pin: pin, vaultId: vaultId)
                guard let key else { return false }
                keyring.set(vaultId, key: key)
                return true
            }
            return stored.map { VaultPin.verify(pin, against: $0) } ?? false
        }.value
        if opened { await open(vault.id) }
        return opened
    }
}
