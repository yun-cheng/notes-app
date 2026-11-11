import NotesKit
import SwiftUI

/// Opens a private vault with its PIN, or with its recovery key if the PIN is forgotten.
struct UnlockView: View {
    @Environment(AppModel.self) private var model
    let vault: Vault
    @State private var pin = ""
    @State private var useRecoveryKey = false
    @State private var working = false
    @State private var wrong = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("\(vault.name) is private").font(.title2.bold())
            Text(useRecoveryKey ? "Enter the recovery key you saved when the vault was encrypted." : "Enter its PIN to open it on this device.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            SecureField(useRecoveryKey ? "Recovery key" : "PIN", text: $pin)
                .textContentType(.password)
                #if os(iOS)
                .keyboardType(useRecoveryKey ? .asciiCapable : .numberPad)
                #endif
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 260)
                .onSubmit(unlock)
            if wrong {
                Text(useRecoveryKey ? "That recovery key doesn't open this vault." : "Wrong PIN.").foregroundStyle(.red)
            }
            Button(action: unlock) {
                if working { ProgressView() } else { Text("Unlock") }
            }
            .buttonStyle(.borderedProminent)
            .disabled(pin.isEmpty || working)
            if vault.isEncrypted {
                Button(useRecoveryKey ? "Use the PIN instead" : "Forgot PIN?") {
                    useRecoveryKey.toggle()
                    pin = ""
                    wrong = false
                }
                .buttonStyle(.borderless)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func unlock() {
        guard !pin.isEmpty, !working else { return }
        working = true
        wrong = false
        let entered = pin
        let recovery = useRecoveryKey
        Task {
            let opened = await model.unlock(vault, pin: entered, recoveryKey: recovery)
            working = false
            wrong = !opened
            if opened { pin = "" }
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
                let key = recoveryKey ? VaultCrypto.unlock(encryption: encryption, recoveryKey: pin) : VaultPin.unlock(encryption: encryption, pin: pin)
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
