import AuthenticationServices
import NotesKit
import SwiftUI

/// Signs in with Google in Apple's sign-in sheet, straight to Google's page for the app's own client, and trades the
/// answer for this device's session (`GoogleSignIn`). Where that can't work, it signs in through the web app instead:
/// the sheet opens the site, where the user confirms the code shown here.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var pairing: ServerAPI.Pairing?
    @State private var problem: String?
    @State private var attempt: Task<Void, Never>?
    @State private var busy = false
    /// Shown once Google's sheet is closed or fails, so the web app is still a way in.
    @State private var offerBrowser = false

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
                    startGoogle()
                } label: {
                    Group { if busy { ProgressView().controlSize(.small) } else { Text("Sign in with Google") } }.frame(maxWidth: 260)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(busy)
                .padding(.top, 8)
                if offerBrowser { Button("Sign in with the browser") { start() }.buttonStyle(.borderless) }
                // A dev build on a server on this computer goes straight into the demo, as the web's /demo does.
                if AppBuild.isDev && model.api.isLocal {
                    HStack(spacing: 16) {
                        Button("Use the demo account") { useDemo() }
                        Button("Sam's") { useDemo(sam: true) }
                    }
                    .buttonStyle(.borderless)
                    .disabled(busy)
                }
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

    private func startGoogle() {
        attempt?.cancel()
        problem = nil
        attempt = Task { await signInWithGoogle() }
    }

    private func signInWithGoogle() async {
        let api = model.api
        busy = true
        defer { busy = false }
        let clientId: String?
        do { clientId = try await api.googleAppleClientId() } catch {
            problem = "Connect to the internet to sign in."
            return
        }
        // A server without the Apple client signs in through the web app.
        guard let clientId else { return start() }
        let google = GoogleSignIn(clientId: clientId)
        do {
            let answer = try await webAuth.authenticate(using: google.page, callback: .customScheme(google.callbackScheme), additionalHeaderFields: [:])
            let idToken = try await google.idToken(code: google.code(from: answer))
            let (info, token) = try await api.signInWithGoogle(idToken: idToken)
            await model.signedIn(info, token: token)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // Closed the sheet: nothing to say, but the web app is another way in.
            offerBrowser = true
        } catch GoogleSignIn.Problem.cancelled {
            offerBrowser = true
        } catch APIError.offline {
            problem = "Connect to the internet to sign in."
        } catch {
            problem = "Google sign-in didn't work. Try again, or sign in with the browser."
            offerBrowser = true
        }
    }

    private func useDemo(sam: Bool = false) {
        attempt?.cancel()
        problem = nil
        attempt = Task {
            busy = true
            defer { busy = false }
            do {
                let (info, token) = try await model.api.demoSession(sam: sam)
                await model.signedIn(info, token: token)
            } catch {
                problem = "No demo here. Run npm run dev and npm run dev:api, then npm run demo."
            }
        }
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
        // The sheet closes itself when the page sends the browser to notesapp://paired (notesapp-dev:// for a dev build).
        let sheet = Task {
            _ = try? await webAuth.authenticate(using: api.pairingPage(next, dev: AppBuild.isDev), callback: .customScheme(AppBuild.scheme), additionalHeaderFields: [:])
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
