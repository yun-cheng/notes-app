import Foundation

public enum APIError: Error, Equatable {
    /// The server couldn't be reached.
    case offline
    /// The session is gone; sign in again.
    case signedOut
    case status(Int)
}

/// What sync needs from the server. Replaced by a fake in tests.
public protocol SyncAPI: Sendable {
    func push(_ records: [CardRecord]) async throws -> [PushResult]
    func pull(since: Int64) async throws -> PullResponse
    func vaults() async throws -> [Vault]
    func shared() async throws -> [SharedCard]
}

/// The notes server over HTTPS, signed in with a bearer token.
public struct ServerAPI: SyncAPI {
    public static let production = URL(string: "https://notes-app-afc.pages.dev")!

    public let site: URL
    public let token: String?
    private let session: URLSession

    public init(site: URL = ServerAPI.production, token: String?, session: URLSession = .shared) {
        self.site = site
        self.token = token
        self.session = session
    }

    func send(_ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> (Data, Int) {
        guard let url = URL(string: site.absoluteString.trimmingCharacters(in: ["/"]) + "/api" + path) else { throw APIError.status(0) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSON.encoder.encode(body) }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.offline
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.signedOut }
        return (data, status)
    }

    func json<T: Decodable>(_ type: T.Type, _ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> T {
        let (data, status) = try await send(path, method: method, body: body)
        guard (200..<300).contains(status) else { throw APIError.status(status) }
        return try JSONDecoder().decode(type, from: data)
    }

    public func push(_ records: [CardRecord]) async throws -> [PushResult] {
        struct Body: Encodable { let records: [CardRecord] }
        struct Response: Decodable { let results: [PushResult] }
        return try await json(Response.self, "/sync/push", method: "POST", body: Body(records: records)).results
    }

    public func pull(since: Int64) async throws -> PullResponse {
        try await json(PullResponse.self, "/sync/pull?since=\(since)")
    }

    public func me() async throws -> SessionInfo { try await json(SessionInfo.self, "/me") }

    public func vaults() async throws -> [Vault] { try await me().vaults }

    public func shared() async throws -> [SharedCard] {
        struct Response: Decodable { let cards: [SharedCard] }
        return try await json(Response.self, "/shared").cards
    }

    // MARK: Signing in through the browser

    public struct Pairing: Decodable, Sendable {
        public let pair: String
        public let code: String
    }

    public enum Claim: Sendable {
        case pending
        case expired
        case signedIn(SessionInfo, token: String)
    }

    public func startPairing() async throws -> Pairing {
        try await json(Pairing.self, "/auth/pair/start", method: "POST", body: [String: String]())
    }

    /// The page the browser opens to approve this device.
    public func pairingPage(_ pairing: Pairing) -> URL {
        var c = URLComponents(url: site.appending(path: "pair"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "p", value: pairing.pair), URLQueryItem(name: "return", value: "app")]
        return c.url!
    }

    public func claim(_ pairing: Pairing) async throws -> Claim {
        struct Body: Encodable {
            let pair: String
            let token = true
        }
        let (data, status) = try await send("/auth/pair/claim", method: "POST", body: Body(pair: pairing.pair))
        switch status {
        case 202: return .pending
        case 200:
            let info = try JSONDecoder().decode(SessionInfo.self, from: data)
            guard let token = info.token else { throw APIError.status(status) }
            return .signedIn(info, token: token)
        default: return .expired
        }
    }

    public func signOut() async {
        _ = try? await send("/auth/logout", method: "POST", body: [String: String]())
    }
}
