import Foundation
import SwiftUI

enum Fmt {
    /// "now", "5m", "3h", "2d", "4w", then a date.
    static func ago(_ ts: Double?) -> String {
        guard let ts, ts > 0 else { return "" }
        let s = Date().timeIntervalSince1970 - ts
        if s < 60 { return "now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86400 { return "\(Int(s / 3600))h" }
        if s < 7 * 86400 { return "\(Int(s / 86400))d" }
        if s < 30 * 86400 { return "\(Int(s / (7 * 86400)))w" }
        let d = Date(timeIntervalSince1970: ts)
        let thisYear = Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year)
        let style: Date.FormatStyle = thisYear
            ? .dateTime.month(.abbreviated).day()
            : .dateTime.month(.abbreviated).day().year()
        return d.formatted(style)
    }

    /// "in 2h 10m" / "in 5m" / "now".
    static func until(_ ts: Double?) -> String {
        guard let ts else { return "–" }
        let s = ts - Date().timeIntervalSince1970
        if s < 60 { return "now" }
        let h = Int(s / 3600), m = Int(s.truncatingRemainder(dividingBy: 3600) / 60)
        return h > 0 ? "in \(h)h \(m)m" : "in \(m)m"
    }

    static func count(_ n: Int?) -> String {
        guard let n else { return "–" }
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 10_000 { return String(format: "%.0fK", Double(n) / 1000) }
        if n >= 1000 { return String(format: "%.1fK", Double(n) / 1000) }
        return "\(n)"
    }

    private static let handleChars = Set("abcdefghijklmnopqrstuvwxyz0123456789._")

    /// A username out of "@name", "name" or an instagram.com link; nil if it can't be one.
    static func handle(_ text: String) -> String? {
        var u = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let r = u.range(of: "instagram.com/") {
            u = String(u[r.upperBound...].prefix { $0 != "/" && $0 != "?" })
        }
        if u.hasPrefix("@") { u.removeFirst() }
        let ok = !u.isEmpty && u.count <= 30 && u.allSatisfy { handleChars.contains($0) }
        return ok ? u : nil
    }
}

/// Caption text with tappable @mentions (open the profile) and #hashtags (search captions).
/// Links use the peek:// scheme, handled by TabStack.
struct CaptionText: View {
    let text: String
    var username: String? = nil
    @State private var expanded = false

    private var long: Bool { text.count > 160 || text.filter { $0 == "\n" }.count > 2 }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(Self.attributed(text, username: username))
                .lineLimit(expanded ? nil : 3)
                .fixedSize(horizontal: false, vertical: true)
            if long && !expanded {
                Button("more") { expanded = true }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private static let pattern = try! NSRegularExpression(pattern: "@[A-Za-z0-9._]{1,30}|#[\\p{L}\\p{N}_]+")

    static func attributed(_ text: String, username: String?) -> AttributedString {
        var out = AttributedString()
        if let username {
            var u = AttributedString(username)
            u.inlinePresentationIntent = .stronglyEmphasized
            u.link = URL(string: "peek://u/\(username)")
            out += u
            out += AttributedString(" ")
        }
        let ns = text as NSString
        var last = 0
        for m in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > last {
                out += AttributedString(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            }
            let token = ns.substring(with: m.range)
            var a = AttributedString(token)
            let name = String(token.dropFirst())
            let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
            a.link = URL(string: token.hasPrefix("@") ? "peek://u/\(encoded.lowercased())" : "peek://tag/\(encoded)")
            out += a
            last = m.range.location + m.range.length
        }
        if last < ns.length { out += AttributedString(ns.substring(from: last)) }
        return out
    }
}
