import SwiftUI

struct FollowingView: View {
    @State private var accounts: [Account] = []
    @State private var query = ""
    @State private var loaded = false
    @State private var managingGroups = false
    @AppStorage("followSort") private var sort = "name"     // name | posted | followed
    @AppStorage("followGroup") private var group = 0

    private var shown: [Account] {
        var list = accounts
        if group != 0 { list = list.filter { $0.groups?.contains(group) == true } }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            list = list.filter { $0.username.contains(q) || ($0.fullName ?? "").lowercased().contains(q) }
        }
        switch sort {
        case "posted": list.sort { ($0.latestPost ?? 0) > ($1.latestPost ?? 0) }
        case "followed":
            // Like the web app: newest follow date first; follows from before dates were kept
            // have none and go after, in the order they were added.
            list.sort { ($0.followedAt ?? 0, $0.addedOrder ?? 0) > ($1.followedAt ?? 0, $1.addedOrder ?? 0) }
        default: break  // the server sorts by name
        }
        return list
    }

    var body: some View {
        List {
            ForEach(shown) { a in
                NavigationLink(value: Route.profile(a.username)) { AccountRow(account: a) }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) { unfollow(a) } label: {
                            Label("Unfollow", systemImage: "person.badge.minus")
                        }
                        Button { mute(a) } label: {
                            Label(a.muted == true ? "Unmute" : "Mute",
                                  systemImage: a.muted == true ? "speaker.wave.2" : "speaker.slash")
                        }
                        .tint(.indigo)
                    }
            }
        }
        .listStyle(.plain)
        .overlay {
            if loaded && accounts.isEmpty {
                ContentUnavailableView("Not following anyone", systemImage: "person.2",
                                       description: Text("Find accounts on the Search tab and tap Follow."))
            }
        }
        .searchable(text: $query, prompt: "Filter")
        .navigationTitle(accounts.isEmpty ? "Following" : "Following (\(accounts.count))")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink { SettingsView() } label: { Image(systemName: "gearshape") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort", selection: $sort) {
                        Label("Name", systemImage: "textformat").tag("name")
                        Label("Latest post", systemImage: "clock").tag("posted")
                        Label("Recently followed", systemImage: "person.badge.plus").tag("followed")
                    }
                    Picker("Group", selection: $group) {
                        Text("Everyone").tag(0)
                        ForEach(AppModel.shared.groups) { g in Text("\(g.name) (\(g.count ?? 0))").tag(g.id) }
                    }
                    Button { managingGroups = true } label: { Label("Manage groups…", systemImage: "folder.badge.gearshape") }
                } label: {
                    Image(systemName: group == 0 ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $managingGroups, onDismiss: { Task { await load() } }) { GroupsManager() }
    }

    private func load() async {
        if let r: AccountsResponse = try? await API.shared.get("/api/accounts") { accounts = r.accounts }
        loaded = true
    }

    private func unfollow(_ a: Account) {
        accounts.removeAll { $0.username == a.username }
        attempt {
            do { try await API.shared.unfollow(a.username) } catch { await load(); throw error }
            AppModel.shared.show("Unfollowed \(a.username)")
        }
    }

    private func mute(_ a: Account) {
        attempt {
            try await API.shared.mute(a.username, a.muted != true)
            await load()
        }
    }
}

private struct AccountRow: View {
    let account: Account

    var body: some View {
        HStack(spacing: 12) {
            Avatar(path: account.avatar, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(account.username).font(.subheadline.weight(.semibold))
                    if account.muted == true {
                        Image(systemName: "speaker.slash.fill").font(.caption2).foregroundStyle(.secondary)
                    }
                    if account.isPrivate == true {
                        Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if let name = account.fullName, !name.isEmpty {
                    Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if let n = account.unread, n > 0 {
                Text("\(n)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(.tint, in: Capsule())
            }
            if let t = account.latestPost {
                Text(Fmt.ago(t)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

struct GroupsManager: View {
    @State private var adding = false
    @State private var name = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(AppModel.shared.groups) { g in
                    HStack {
                        Text(g.name)
                        Spacer()
                        Text("\(g.count ?? 0)").foregroundStyle(.secondary)
                    }
                }
                .onDelete { offsets in
                    let ids = offsets.map { AppModel.shared.groups[$0].id }
                    attempt {
                        for id in ids { try await API.shared.fire("DELETE", "/api/groups/\(id)") }
                        await AppModel.shared.loadGroups()
                    }
                }
                if AppModel.shared.groups.isEmpty {
                    Text("Groups let you filter the feed and the Following list.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Groups")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .topBarLeading) {
                    Button { name = ""; adding = true } label: { Image(systemName: "plus") }
                }
            }
            .alert("New group", isPresented: $adding) {
                TextField("Name", text: $name)
                Button("Create") {
                    let n = name
                    attempt {
                        try await API.shared.fire("POST", "/api/groups", body: ["name": n])
                        await AppModel.shared.loadGroups()
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}
