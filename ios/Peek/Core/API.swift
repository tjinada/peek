import Foundation

enum APIError: LocalizedError {
    case noServer
    case auth
    case offline(String)
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .noServer: return "No server set"
        case .auth: return "Sign in again"
        case .offline(let message): return message
        case .http(let code, let message): return message.isEmpty ? "Server error \(code)" : message
        }
    }
}

/// Decodes any JSON object; for calls whose answer doesn't matter.
struct Ignored: Decodable {}

/// Talks to the Peek server. Auth is the server's own `peek_auth` cookie, kept in the
/// shared cookie store like a browser would, so images and videos carry it too.
final class API {
    static let shared = API()
    static let serverKey = "server"

    let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = .shared
        cfg.httpCookieAcceptPolicy = .always
        cfg.httpShouldSetCookies = true
        // Media is served with immutable cache headers, so a big disk cache makes revisits instant.
        cfg.urlCache = URLCache(memoryCapacity: 64 << 20, diskCapacity: 1 << 30)
        cfg.requestCachePolicy = .useProtocolCachePolicy
        cfg.timeoutIntervalForRequest = 60
        cfg.httpMaximumConnectionsPerHost = 8
        session = URLSession(configuration: cfg)
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    /// e.g. "https://peek.tailnet.ts.net" — no trailing slash.
    var base: String {
        (UserDefaults.standard.string(forKey: Self.serverKey) ?? "")
            .trimmingCharacters(in: .whitespaces)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// Server paths ("/m/abc/0.jpg") to absolute URLs.
    func url(_ path: String, _ query: [String: String?] = [:]) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        guard !base.isEmpty, var comps = URLComponents(string: base + path) else { return nil }
        let items = query.compactMap { pair in pair.value.map { URLQueryItem(name: pair.key, value: $0) } }
        if !items.isEmpty { comps.queryItems = (comps.queryItems ?? []) + items }
        return comps.url
    }

    // MARK: transport

    func raw(_ method: String, _ path: String, query: [String: String?] = [:],
             body: [String: Any]? = nil) async throws -> (Data, HTTPURLResponse?) {
        guard let url = url(path, query) else { throw APIError.noServer }
        var req = URLRequest(url: url)
        req.httpMethod = method
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await session.data(for: req)
        } catch let e as URLError where e.code != .cancelled {
            throw APIError.offline(e.localizedDescription)
        }
        let http = resp as? HTTPURLResponse
        try check(http, data, path: path)
        return (data, http)
    }

    private struct Detail: Decodable { let detail: String }

    private func check(_ http: HTTPURLResponse?, _ data: Data, path: String) throws {
        guard let http, !(200..<300).contains(http.statusCode) else { return }
        let detail = (try? JSONDecoder().decode(Detail.self, from: data))?.detail ?? ""
        if http.statusCode == 401 && path != "/api/login" {
            Task { @MainActor in AppModel.shared.needsLogin = true }
            throw APIError.auth
        }
        throw APIError.http(http.statusCode, detail)
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.http(0, "Unexpected answer from the server (\(error))")
        }
    }

    func get<T: Decodable>(_ path: String, _ query: [String: String?] = [:]) async throws -> T {
        let (data, _) = try await raw("GET", path, query: query)
        return try decode(data)
    }

    func send<T: Decodable>(_ method: String, _ path: String, query: [String: String?] = [:],
                            body: [String: Any]? = nil) async throws -> T {
        let (data, _) = try await raw(method, path, query: query, body: body)
        return try decode(data)
    }

    /// A call whose answer is ignored.
    func fire(_ method: String, _ path: String, query: [String: String?] = [:], body: [String: Any]? = nil) async throws {
        _ = try await raw(method, path, query: query, body: body)
    }

    // MARK: endpoints used from several screens

    func login(_ password: String) async throws {
        try await fire("POST", "/api/login", body: ["password": password])
    }

    func signOut() {
        guard let url = url("/") else { return }
        HTTPCookieStorage.shared.cookies(for: url)?.forEach(HTTPCookieStorage.shared.deleteCookie)
    }

    func post(_ shortcode: String) async throws -> Post {
        try await get("/api/p/\(shortcode)")
    }

    func setSaved(_ shortcode: String, _ saved: Bool, slide: Int? = nil) async throws {
        try await fire(saved ? "POST" : "DELETE", "/api/saved/\(shortcode)", query: ["slide": slide.map(String.init)])
    }

    func follow(_ username: String) async throws {
        try await fire("POST", "/api/accounts", body: ["username": username])
    }

    func unfollow(_ username: String) async throws {
        try await fire("DELETE", "/api/accounts/\(username)")
    }

    func mute(_ username: String, _ muted: Bool) async throws {
        try await fire("PUT", "/api/accounts/\(username)/mute", body: ["muted": muted])
    }

    func markStoriesSeen(_ ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        try await fire("POST", "/api/stories/seen", body: ["ids": ids])
    }

    func groups() async throws -> [PeekGroup] {
        let r: GroupsResponse = try await get("/api/groups")
        return r.groups
    }
}
