import SwiftUI

/// First run: which server. Later: sign in again when the password cookie is gone.
struct SetupView: View {
    var signInOnly = false

    @State private var server = UserDefaults.standard.string(forKey: API.serverKey) ?? ""
    @State private var password = ""
    @State private var needsPassword = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var passwordFocused: Bool

    var body: some View {
        Form {
            if !signInOnly {
                Section {
                    TextField("https://peek.your-tailnet.ts.net", text: $server)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { connect() }
                } header: {
                    Text("Peek server")
                } footer: {
                    Text("The address you open Peek at in a browser, e.g. a Tailscale name or http://192.168.1.20:8642.")
                }
            }
            if needsPassword || signInOnly {
                Section("Password") {
                    SecureField("PEEK_PASSWORD", text: $password)
                        .focused($passwordFocused)
                        .submitLabel(.go)
                        .onSubmit { connect() }
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            Section {
                Button(action: connect) {
                    HStack {
                        Text(needsPassword || signInOnly ? "Sign in" : "Connect")
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(busy || (signInOnly && password.isEmpty))
            }
            if signInOnly {
                Section {
                    Button("Use a different server", role: .destructive) {
                        AppModel.shared.needsLogin = false
                        AppModel.shared.disconnect()
                    }
                }
            }
        }
        .navigationTitle(signInOnly ? "Sign in" : "Peek")
        .onAppear { if signInOnly { passwordFocused = true } }
    }

    private func normalized() -> String {
        var s = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.isEmpty && !s.contains("://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    private func connect() {
        let s = normalized()
        guard URL(string: s)?.host != nil else {
            error = "That doesn't look like an address"
            return
        }
        server = s
        busy = true
        error = nil
        Task {
            defer { busy = false }
            UserDefaults.standard.set(s, forKey: API.serverKey)  // API reads it from here
            do {
                if !password.isEmpty { try await API.shared.login(password) }
                let _: Status = try await API.shared.get("/api/status")
                AppModel.shared.connected(to: s)
            } catch APIError.auth {
                if needsPassword || signInOnly { error = "Wrong password" }
                needsPassword = true
                passwordFocused = true
            } catch APIError.http(401, _) {
                error = "Wrong password"
                needsPassword = true
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
