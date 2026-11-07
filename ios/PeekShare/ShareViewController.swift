import UIKit
import UniformTypeIdentifiers

/// Share sheet → Peek: takes the shared Instagram link and opens it in the app.
final class ShareViewController: UIViewController {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        label.text = "Opening in Peek…"
        label.font = .preferredFont(forTextStyle: .headline)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handle() }
    }

    private func handle() async {
        guard let link = await sharedURL(), link.host?.lowercased().contains("instagram.com") == true else {
            return finish("That isn't an Instagram link.")
        }
        var comps = URLComponents()
        comps.scheme = "peek"
        comps.host = "open"
        comps.queryItems = [URLQueryItem(name: "url", value: link.absoluteString)]
        guard let url = comps.url, openApp(url) else { return finish("Couldn't open Peek.") }
        extensionContext?.completeRequest(returningItems: nil)
    }

    /// The first URL shared, or the first link inside shared text (Instagram's app shares both ways).
    private func sharedURL() async -> URL? {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL { return url }
        }
        for p in providers where p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
               let url = Self.firstLink(in: text) {
                return url
            }
        }
        return nil
    }

    private static func firstLink(in text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        return detector?.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))?.url
    }

    /// Extensions can't call UIApplication.open, but the app object is on the responder chain,
    /// so call its openURL:options:completionHandler: through the runtime. Not App Store safe;
    /// fine for a personal app.
    private func openApp(_ url: URL) -> Bool {
        typealias OpenURL = @convention(c) (NSObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
        let selector = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication, app.responds(to: selector) {
                let open = unsafeBitCast(app.method(for: selector), to: OpenURL.self)
                open(app, selector, url as NSURL, NSDictionary(), nil)
                return true
            }
            responder = r.next
        }
        return false
    }

    private func finish(_ message: String) {
        label.text = message
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
