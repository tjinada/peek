import LocalAuthentication
import SwiftUI
import UIKit

/// Optional Face ID / passcode lock. The cover is its own window above everything, so it also
/// hides sheets and full-screen viewers, and the app switcher snapshot.
@MainActor
final class AppLock {
    static let shared = AppLock()
    static let key = "lockEnabled"

    private var window: UIWindow?
    private var locked = UserDefaults.standard.bool(forKey: key)
    private var promptOnActive = UserDefaults.standard.bool(forKey: key)  // launch, or back from background
    private var authenticating = false

    private var enabled: Bool { UserDefaults.standard.bool(forKey: Self.key) }

    /// Face ID, Touch ID or at least a passcode is set up.
    static var available: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    func phaseChanged(_ phase: ScenePhase) {
        guard enabled else {
            locked = false
            hide()
            return
        }
        switch phase {
        case .background:
            locked = true
            promptOnActive = true
            show()
        case .inactive:
            show()  // app switcher
        case .active:
            if !locked {
                hide()
            } else {
                show()
                if promptOnActive {  // not after a cancelled prompt: that waits for the button
                    promptOnActive = false
                    unlock()
                }
            }
        @unknown default:
            break
        }
    }

    func unlock() {
        guard !authenticating else { return }
        authenticating = true
        Task {
            let ok = (try? await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Peek")) ?? false
            authenticating = false
            if ok {
                locked = false
                hide()
            }
        }
    }

    private func show() {
        if window == nil {
            guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
            let w = UIWindow(windowScene: scene)
            w.windowLevel = .alert + 1
            w.rootViewController = UIHostingController(rootView: LockScreen())
            window = w
        }
        window?.isHidden = false
    }

    private func hide() {
        window?.isHidden = true
    }
}

private struct LockScreen: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(.secondary)
            Text("Peek is locked").font(.headline)
            Button("Unlock") { AppLock.shared.unlock() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
