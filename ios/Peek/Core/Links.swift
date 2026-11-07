import Foundation

/// Instagram and peek:// links to places in the app.
enum Links {
    /// instagram.com/<first path part> values that aren't usernames.
    private static let reserved: Set<String> = [
        "explore", "accounts", "direct", "about", "developer", "legal", "challenge", "web", "emails",
    ]

    static func route(_ url: URL) -> Route? {
        if url.scheme == "peek" {
            switch url.host {
            case "open":  // from the share extension: peek://open?url=<instagram link>
                let inner = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first { $0.name == "url" }?.value
                return inner.flatMap { URL(string: $0) }.flatMap { route($0) }
            case "u": return .profile(url.lastPathComponent)
            case "p": return .post(url.lastPathComponent)
            default: return nil
            }
        }
        guard let host = url.host?.lowercased(), host == "instagram.com" || host.hasSuffix(".instagram.com") else {
            return nil
        }
        let parts = url.path.split(separator: "/").map(String.init)
        guard let first = parts.first?.lowercased() else { return nil }
        let postKinds: Set<String> = ["p", "reel", "reels", "tv"]
        if postKinds.contains(first) {
            return parts.count > 1 ? .post(parts[1]) : nil  // shortcodes are case-sensitive
        }
        if first == "stories" {
            return parts.count > 1 ? Fmt.handle(parts[1]).map { Route.profile($0) } : nil
        }
        if parts.count > 2, postKinds.contains(parts[1].lowercased()) {  // instagram.com/<user>/p/<code>
            return .post(parts[2])
        }
        guard !reserved.contains(first), let user = Fmt.handle(first) else { return nil }
        return .profile(user)
    }

    /// A link typed or pasted as text; the scheme is optional.
    static func route(text: String) -> Route? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.lowercased().contains("instagram.com/") else { return nil }
        return URL(string: t.hasPrefix("http") ? t : "https://" + t).flatMap { route($0) }
    }
}
