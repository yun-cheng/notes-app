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
    func shared() async throws -> SharedResponse
}

/// The notes server over HTTPS, signed in with a bearer token.
public struct ServerAPI: SyncAPI {
    public static let production = URL(string: "https://notes-app.yuncheng-dev.workers.dev")!

    public let site: URL
    public let token: String?
    /// Which device this is, sent with each push, so history can tell this device's changes from the others'.
    public var device: (id: String, name: String)?
    private let session: URLSession

    public init(site: URL = ServerAPI.production, token: String?, device: (id: String, name: String)? = nil, session: URLSession = .shared) {
        self.site = site
        self.token = token
        self.device = device
        self.session = session
    }

    func send(_ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> (Data, Int) {
        try await send(path, method: method, raw: body.map { try JSON.encoder.encode($0) }, type: "application/json")
    }

    /// A request with a body of bytes as they are, like a photo's.
    func send(_ path: String, method: String, raw: Data?, type: String, headers: [String: String] = [:]) async throws -> (Data, Int) {
        guard let url = URL(string: site.absoluteString.trimmingCharacters(in: ["/"]) + "/api" + path) else { throw APIError.status(0) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(type, forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let device {
            request.setValue(device.id, forHTTPHeaderField: "X-Device-Id")
            request.setValue(device.name, forHTTPHeaderField: "X-Device-Name")
        }
        if let raw { request.httpBody = raw }
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

    public func json<T: Decodable>(_ type: T.Type, _ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> T {
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

    public func shared() async throws -> SharedResponse { try await json(SharedResponse.self, "/shared") }

    // MARK: Photos and files

    /// A photo's or file's bytes, as stored (sealed, in an encrypted vault). Nil when the server has none.
    public func attachment(_ id: String) async throws -> Data? {
        let path = "/attachments/" + Self.part(id)
        let (data, status) = try await send(path)
        if [404, 409, 503].contains(status) { return nil }
        guard (200..<300).contains(status) else { throw APIError.status(status) }
        return data
    }

    public enum UploadResult: Sendable, Equatable { case ok, needsDrive, notConfigured, rejected }

    /// A file bigger than this goes up in pieces, which can pick up where they left off.
    static let wholeBytes = 5 * 1024 * 1024
    static let uploadPiece = 8 * 1024 * 1024

    /// Uploads a photo or file as the web app's `photoTransport.upload`. A sealed one says nothing of what it is.
    public func upload(
        _ id: String, data: Data, mime: String, vaultId: String, sealed: Bool, fileName: String? = nil, width: Double? = nil, height: Double? = nil,
        duration: Double? = nil
    ) async throws -> UploadResult {
        var query = [URLQueryItem(name: "vault", value: vaultId)]
        if sealed {
            query.append(URLQueryItem(name: "sealed", value: "1"))
        } else {
            if let fileName {
                query.append(URLQueryItem(name: "kind", value: "file"))
                query.append(URLQueryItem(name: "name", value: fileName))
            }
            if let width { query.append(URLQueryItem(name: "w", value: String(Int(width)))) }
            if let height { query.append(URLQueryItem(name: "h", value: String(Int(height)))) }
            if let duration { query.append(URLQueryItem(name: "d", value: String(duration))) }
        }
        let path = "/attachments/" + Self.part(id)
        func q(_ items: [URLQueryItem]) -> String {
            var c = URLComponents()
            c.queryItems = items
            return c.percentEncodedQuery.map { "?" + $0.replacingOccurrences(of: "+", with: "%2B") } ?? ""
        }
        func refused(_ data: Data, _ status: Int) throws -> UploadResult {
            let error = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            if error == "drive_not_connected" { return .needsDrive }
            if error == "photos_not_configured" { return .notConfigured }
            if status >= 500 { throw APIError.status(status) }
            return .rejected
        }
        if (fileName != nil || sealed) && data.count > Self.wholeBytes {
            query.append(URLQueryItem(name: "size", value: String(data.count)))
            for _ in 0..<2 {
                var (body, status) = try await send(path + "/upload" + q(query), method: "POST", raw: nil, type: mime)
                guard (200..<300).contains(status) else { return try refused(body, status) }
                struct Next: Decodable { let next: Int?; let id: String?; let error: String? }
                var at = (try? JSONDecoder().decode(Next.self, from: body))?.next
                var expired = false
                while let start = at {
                    let end = min(data.count, start + Self.uploadPiece)
                    (body, status) = try await send(
                        path + "/upload", method: "PUT", raw: data.subdata(in: start..<end), type: "application/octet-stream",
                        headers: ["Content-Range": "bytes \(start)-\(end - 1)/\(data.count)"])
                    let next = try? JSONDecoder().decode(Next.self, from: body)
                    if status == 409 && next?.error == "upload_expired" {
                        expired = true
                        break
                    }
                    guard (200..<300).contains(status) else { return try refused(body, status) }
                    if next?.id != nil { return .ok }
                    at = next?.next
                }
                if !expired { return .ok }
            }
            throw APIError.status(409)
        }
        let (body, status) = try await send(path + q(query), method: "PUT", raw: data, type: mime)
        return (200..<300).contains(status) ? .ok : try refused(body, status)
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
