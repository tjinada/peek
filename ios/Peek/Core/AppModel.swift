import Foundation
import Observation

/// App-wide state: which server, whether to show the sign-in screen, groups, toasts.
@MainActor
@Observable
final class AppModel {
    static let shared = AppModel()

    /// Empty until the first successful connect; the root shows setup while it is.
    private(set) var server: String = UserDefaults.standard.string(forKey: API.serverKey) ?? ""
    var needsLogin = false
    var toast: String?
    var groups: [PeekGroup] = []
    /// Bumped after (re)connecting, so every tab rebuilds and reloads.
    private(set) var epoch = 0

    func connected(to server: String) {
        UserDefaults.standard.set(server, forKey: API.serverKey)
        self.server = server
        needsLogin = false
        epoch += 1
    }

    func disconnect() {
        server = ""
    }

    func loadGroups() async {
        if let g = try? await API.shared.groups() { groups = g }
    }

    func show(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(for: .seconds(2.6))
            if toast == message { toast = nil }
        }
    }

    func show(_ error: Error) {
        if case APIError.auth = error { return }  // the sign-in screen says it
        if (error as? CancellationError) != nil { return }
        show(error.localizedDescription)
    }
}

/// Runs an action and toasts its error, for buttons.
@MainActor
func attempt(_ action: @escaping @MainActor () async throws -> Void) {
    Task {
        do { try await action() } catch { AppModel.shared.show(error) }
    }
}
