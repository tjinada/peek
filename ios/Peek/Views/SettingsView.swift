import SwiftUI

struct SettingsView: View {
    @State private var status: Status?
    @State private var hours = 4.0
    @State private var cleared = false
    @AppStorage("muted") private var muted = true
    @AppStorage("appearance") private var appearance = "system"

    private static let choices: [Double] = [1, 2, 3, 4, 6, 8, 12, 24]

    var body: some View {
        Form {
            Section("Server") {
                LabeledContent("Address", value: API.shared.base)
                if let web = URL(string: API.shared.base) {
                    Link(destination: web) { Label("Open the web app", systemImage: "safari") }
                }
                Button("Use a different server") { AppModel.shared.disconnect() }
                if status?.password == true {
                    Button("Sign out", role: .destructive) {
                        API.shared.signOut()
                        AppModel.shared.needsLogin = true
                    }
                }
            }

            if let status {
                Section {
                    Picker("Refresh everyone every", selection: $hours) {
                        ForEach(Self.choices, id: \.self) { h in Text("\(Int(h)) h").tag(h) }
                    }
                    .onChange(of: hours) { _, h in setHours(h) }
                    LabeledContent("Last refresh", value: status.lastCycle.map { Fmt.ago($0) + " ago" } ?? "–")
                    LabeledContent("Next refresh", value: status.cycleRunning ? "running now" : Fmt.until(status.nextCycle))
                    if let s = status.scheduler, s != "ok" {
                        LabeledContent("Scheduler", value: s).foregroundStyle(.orange)
                    }
                    if let p = status.pausedUntil, p > Date().timeIntervalSince1970 {
                        LabeledContent("Paused by Instagram", value: Fmt.until(p))
                    }
                    Button("Refresh everyone now") {
                        attempt {
                            let r: RefreshAllResponse = try await API.shared.send("POST", "/api/refresh-all")
                            AppModel.shared.show(r.already == true ? "Already running" : "Refreshing \(r.count ?? 0) accounts…")
                            await load()
                        }
                    }
                    .disabled(status.cycleRunning)
                } header: {
                    Text("Background refresh")
                }

                Section {
                    LabeledContent("State", value: sessionLabel(status.session))
                    if let u = status.session.username { LabeledContent("Account", value: u) }
                    if let left = status.session.budgetLeft, let total = status.session.budgetTotal {
                        LabeledContent("Requests left this hour", value: "\(Int(left)) of \(Int(total))")
                    }
                    if let e = status.session.error, !e.isEmpty {
                        Text(e).font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Burner session")
                } footer: {
                    Text("Stories, highlights and Instagram search need it. Paste or replace it on the web app's Burner tab.")
                }

                Section("Library") {
                    LabeledContent("Following", value: "\(status.following)")
                    LabeledContent("Posts saved", value: "\(status.posts)")
                    LabeledContent("Live stories", value: "\(status.stories)")
                }
            }

            Section("This phone") {
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                Toggle("Start videos muted", isOn: $muted)
                Button(cleared ? "Image cache cleared" : "Clear image cache") {
                    ImageCache.shared.clear()
                    cleared = true
                }
                .disabled(cleared)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        if let s: Status = try? await API.shared.get("/api/status") {
            status = s
            hours = s.refreshHours
        }
    }

    private func setHours(_ h: Double) {
        guard let status, h != status.refreshHours else { return }
        attempt {
            try await API.shared.fire("PUT", "/api/settings/refresh", body: ["hours": h])
            await load()
        }
    }

    private func sessionLabel(_ s: SessionInfo) -> String {
        switch s.state {
        case "ok": return "Working"
        case "unchecked": return "Not checked yet"
        case "dead": return "Expired"
        default: return "None"
        }
    }
}
