import CryptoKit
import Foundation

/// Signing in to Google from the Mac and iPhone apps themselves, as Google's own sign-in for iOS does: Apple's sign-in
/// sheet opens Google's page for the app's own client (type iOS, which Google uses for Mac apps too), Google sends the
/// sheet back to the client's reversed ID with a code, and the code, with this attempt's PKCE verifier, becomes an ID
/// token, which the server trades for this device's session. The client has no secret, so nothing here is one.
public struct GoogleSignIn: Sendable {
    public let clientId: String
    let verifier: String
    let state: String

    public init(clientId: String) {
        self.init(clientId: clientId, verifier: Self.random(), state: Self.random())
    }

    init(clientId: String, verifier: String, state: String) {
        self.clientId = clientId
        self.verifier = verifier
        self.state = state
    }

    static func random() -> String {
        base64url(Data((0..<32).map { _ in UInt8.random(in: .min ... .max) }))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// The client's ID turned around, the scheme Google sends an iOS client's answer to.
    public var callbackScheme: String {
        "com.googleusercontent.apps." + clientId.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
    }

    var redirect: String { callbackScheme + ":/oauth2redirect" }

    /// PKCE's S256 challenge: the verifier's SHA-256, in base64url.
    var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

    /// Google's sign-in page for this attempt, which asks which account each time.
    public var page: URL {
        var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        c.queryItems = [
            URLQueryItem(name: "client_id", value: clientId), URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge), URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state), URLQueryItem(name: "prompt", value: "select_account"),
        ]
        return c.url!
    }

    public enum Problem: Error, Equatable {
        /// The account wasn't chosen, or access wasn't given.
        case cancelled
        /// The answer wasn't Google's to this attempt, or Google refused.
        case failed
    }

    /// The code in Google's answer, once it's checked to be this attempt's.
    public func code(from answer: URL) throws -> String {
        let items = URLComponents(url: answer, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func item(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard item("state") == state else { throw Problem.failed }
        if item("error") == "access_denied" { throw Problem.cancelled }
        guard let code = item("code"), !code.isEmpty else { throw Problem.failed }
        return code
    }

    /// The request that turns the code into tokens, as an app without a secret makes it.
    func tokenRequest(code: String) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "code", value: code), URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect), URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code_verifier", value: verifier),
        ]
        // `+` would read as a space in a form, so it's written out.
        request.httpBody = Data((form.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        return request
    }

    /// Turns the code into Google's ID token for this account.
    public func idToken(code: String, session: URLSession = .shared) async throws -> String {
        struct Tokens: Decodable { let id_token: String? }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: tokenRequest(code: code)) } catch { throw APIError.offline }
        guard (response as? HTTPURLResponse)?.statusCode == 200, let token = try? JSONDecoder().decode(Tokens.self, from: data).id_token else {
            throw Problem.failed
        }
        return token
    }
}

extension ServerAPI {
    /// The Google client the Mac and iPhone apps sign in with, from the server; nil where it has none.
    public func googleAppleClientId() async throws -> String? {
        struct Config: Decodable { let googleAppleClientId: String? }
        let id = try await json(Config.self, "/config").googleAppleClientId ?? ""
        return id.isEmpty ? nil : id
    }

    /// Trades Google's ID token for this device's own session.
    public func signInWithGoogle(idToken: String) async throws -> (SessionInfo, token: String) {
        struct Body: Encodable {
            let credential: String
            let token = true
        }
        let (data, status) = try await send("/auth/google", method: "POST", body: Body(credential: idToken))
        guard status == 200 else { throw GoogleSignIn.Problem.failed }
        let info = try JSONDecoder().decode(SessionInfo.self, from: data)
        guard let token = info.token else { throw GoogleSignIn.Problem.failed }
        return (info, token)
    }
}
