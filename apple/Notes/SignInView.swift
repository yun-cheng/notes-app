import AuthenticationServices
import NotesKit
import SwiftUI

/// Signs in through the web app: a sign-in sheet opens the site, where the user confirms the code shown here.
/// Google doesn't allow its sign-in inside apps, so the browser does that part.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var pairing: ServerAPI.Pairing?
    @State private var problem: String?
    @State private var attempt: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "note.text")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Notes").font(.largeTitle.bold())
            Text("Your notes, todos and diary, on every device.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if let pairing {
                VStack(spacing: 8) {
                    Text("Confirm this code in the browser:").foregroundStyle(.secondary)
                    Text(pairing.code)
                        .font(.system(size: 40, weight: .semibold, design: .monospaced))
                        .kerning(6)
                        .accessibilityLabel("Code \(pairing.code.map(String.init).joined(separator: " "))")
                    ProgressView().padding(.top, 4)
                }
                .padding(.top, 8)
                Button("Start again") { start() }.buttonStyle(.borderless)
            } else {
                Button {
                    start()
                } label: {
                    Text("Sign in").frame(maxWidth: 260)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.top, 8)
            }
            if let problem {
                Text(problem).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onDisappear { attempt?.cancel() }
    }

    private func start() {
        attempt?.cancel()
        problem = nil
        attempt = Task { await signIn() }
    }

    private func signIn() async {
        let api = model.api
        let next: ServerAPI.Pairing
        do {
            next = try await api.startPairing()
        } catch {
            problem = "Connect to the internet to sign in."
            return
        }
        pairing = next
        // The sheet closes itself when the page sends the browser to notesapp://paired.
        let sheet = Task {
            _ = try? await webAuth.authenticate(using: api.pairingPage(next), callback: .customScheme("notesapp"), additionalHeaderFields: [:])
        }
        defer { sheet.cancel() }
        while !Task.isCancelled {
            switch try? await api.claim(next) {
            case .signedIn(let info, let token):
                await model.signedIn(info, token: token)
                return
            case .expired:
                pairing = nil
                problem = "That took too long. Try again."
                return
            case .pending, nil:
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }
}
