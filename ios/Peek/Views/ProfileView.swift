import SwiftUI

struct ProfileView: View {
    let username: String

    enum Tab: String { case posts, reels }

    @State private var account: Account?
    @State private var posts: [Post] = []
    @State private var next: Double?
    @State private var tab = Tab.posts
    @State private var highlights: [Highlight] = []
    @State private var story: StoryGroup?
    @State private var exhausted = false
    @State private var olderBusy = false
    @State private var olderNote: String?
    @State private var loadingMore = false
    @State private var error: String?
    @State private var editingGroups = false

    private var kind: String? { tab == .reels ? "reels" : nil }
    private var followed: Bool { account?.followed == true }
    private var historyDone: Bool {
        exhausted || (tab == .posts ? account?.historyDone == true : (account?.reelsDone ?? 0) == 1)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header.padding(.horizontal, 14)
                if !highlights.isEmpty { highlightsRow }
                if account?.reelsTab == true {
                    Picker("Show", selection: $tab) {
                        Text("Posts").tag(Tab.posts)
                        Text("Reels").tag(Tab.reels)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 14)
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red).padding(.horizontal, 14)
                }
                PostGrid(posts: posts, title: username) { Task { await loadMore() } }
                footer
            }
            .padding(.top, 8)
        }
        .navigationTitle(username)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { menu }
        }
        .refreshable { await forceRefresh() }
        .task(id: tab) {
            exhausted = false
            olderNote = nil
            await load()
            await pollWhileBusy()
        }
        .task { await loadHighlights() }
        .fullScreenCover(item: $story) { g in StoryViewer(groups: [g], start: 0) }
        .sheet(isPresented: $editingGroups) { GroupPicker(username: username) }
    }

    // MARK: pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 18) {
                Avatar(path: account?.avatar, size: 84)
                HStack {
                    stat(account?.postCount, "posts")
                    stat(account?.followers, "followers")
                    stat(account?.following, "following")
                }
                .frame(maxWidth: .infinity)
            }
            if let name = account?.fullName, !name.isEmpty {
                Text(name).font(.subheadline.weight(.semibold))
            }
            if let bio = account?.bio, !bio.isEmpty {
                CaptionText(text: bio).font(.subheadline)
            }
            if account?.isPrivate == true {
                Label("Private account", systemImage: "lock.fill").font(.footnote).foregroundStyle(.secondary)
            }
            if let e = account?.lastError, !e.isEmpty {
                Label(e, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
            }
            if account?.busy == true {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Fetching from Instagram…").font(.footnote).foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 8) {
                if followed {
                    Menu {
                        Button { setMuted(!(account?.muted ?? false)) } label: {
                            Label(account?.muted == true ? "Unmute" : "Mute",
                                  systemImage: account?.muted == true ? "speaker.wave.2" : "speaker.slash")
                        }
                        Button { editingGroups = true } label: { Label("Groups…", systemImage: "folder") }
                        Button(role: .destructive) { setFollowed(false) } label: {
                            Label("Unfollow", systemImage: "person.badge.minus")
                        }
                    } label: {
                        Label(account?.muted == true ? "Following · muted" : "Following", systemImage: "chevron.down")
                            .labelStyle(.titleOnly)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button { setFollowed(true) } label: { Text("Follow").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                }
                Button { Task { await forceRefresh() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(account?.busy == true)
            }
            .font(.subheadline.weight(.semibold))
        }
    }

    private func stat(_ n: Int?, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(Fmt.count(n)).font(.headline)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var highlightsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(highlights) { h in
                    Button { openHighlight(h) } label: {
                        VStack(spacing: 5) {
                            RemoteImage(path: h.cover, maxPixel: 200)
                                .frame(width: 62, height: 62)
                                .clipShape(Circle())
                                .padding(3)
                                .overlay { Circle().strokeBorder(Color.secondary.opacity(0.35), lineWidth: 1) }
                            Text(h.title ?? "").font(.caption2).lineLimit(1).frame(width: 70)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
        }
    }

    @ViewBuilder private var footer: some View {
        VStack(spacing: 8) {
            if loadingMore || olderBusy {
                ProgressView()
            } else if next == nil && !historyDone && !posts.isEmpty {
                Button { Task { await loadOlder() } } label: {
                    Label("Load older from Instagram", systemImage: "clock.arrow.circlepath")
                }
                .buttonStyle(.bordered)
            } else if posts.isEmpty && account != nil && account?.busy != true {
                Text(tab == .reels ? "No reels saved yet" : "No posts saved yet").foregroundStyle(.secondary)
            }
            if let olderNote { Text(olderNote).font(.footnote).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }

    private var menu: some View {
        Menu {
            Button { Task { await forceRefresh() } } label: { Label("Refresh from Instagram", systemImage: "arrow.clockwise") }
            if followed {
                Button { editingGroups = true } label: { Label("Groups…", systemImage: "folder") }
            }
            if let url = URL(string: "https://www.instagram.com/\(username)/") {
                Link(destination: url) { Label("Open in Instagram", systemImage: "arrow.up.right.square") }
                Button { UIPasteboard.general.url = url } label: { Label("Copy link", systemImage: "link") }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    // MARK: data

    private func load() async {
        do {
            let r: ProfileResponse = try await API.shared.get("/api/u/\(username)", ["kind": kind])
            account = r.account
            posts = r.posts
            next = r.next
            error = nil
        } catch {
            if (error as? CancellationError) == nil { self.error = error.localizedDescription }
        }
    }

    /// The server fetches in the background and says busy; poll until it's done.
    private func pollWhileBusy() async {
        while account?.busy == true && !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            if Task.isCancelled { return }
            await load()
        }
    }

    private func forceRefresh() async {
        do {
            try await API.shared.fire("POST", "/api/u/\(username)/refresh")
            try? await Task.sleep(for: .milliseconds(400))
            await load()
            await pollWhileBusy()
        } catch {
            AppModel.shared.show(error)
        }
    }

    private func loadMore() async {
        guard let before = next, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let r: ProfileResponse = try await API.shared.get("/api/u/\(username)", ["kind": kind, "before": String(before)])
            merge(r.posts)
            next = r.next
        } catch {
            AppModel.shared.show(error)
        }
    }

    private func loadOlder() async {
        olderBusy = true
        defer { olderBusy = false }
        do {
            let r: OlderResponse = try await API.shared.send("POST", "/api/u/\(username)/older", query: ["kind": kind])
            merge(r.posts)
            olderNote = r.note ?? ((r.added ?? 0) == 0 ? "Nothing older found" : nil)
            if r.done == true { exhausted = true }
        } catch {
            olderNote = error.localizedDescription
        }
    }

    private func merge(_ more: [Post]) {
        let have = Set(posts.map(\.id))
        posts = (posts + more.filter { !have.contains($0.id) }).sorted { $0.takenAt > $1.takenAt }
    }

    private func loadHighlights() async {
        if let r: HighlightsResponse = try? await API.shared.get("/api/u/\(username)/highlights") {
            highlights = r.highlights
        }
    }

    private func openHighlight(_ h: Highlight) {
        attempt {
            let r: HighlightItems = try await API.shared.get("/api/highlights/\(h.id)")
            guard !r.items.isEmpty else {
                AppModel.shared.show("This highlight is empty")
                return
            }
            story = StoryGroup(username: username, avatar: account?.avatar, items: r.items, allSeen: true)
        }
    }

    private func setFollowed(_ on: Bool) {
        attempt {
            if on { try await API.shared.follow(username) } else { try await API.shared.unfollow(username) }
            AppModel.shared.show(on ? "Following \(username)" : "Unfollowed \(username)")
            await load()
            await pollWhileBusy()
        }
    }

    private func setMuted(_ on: Bool) {
        attempt {
            try await API.shared.mute(username, on)
            AppModel.shared.show(on ? "Muted — still refreshed, hidden from Feed and Reels" : "Unmuted")
            await load()
        }
    }
}

/// Which groups an account is in.
struct GroupPicker: View {
    let username: String
    @State private var selected: Set<Int> = []
    @State private var loaded = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if AppModel.shared.groups.isEmpty {
                    Text("No groups yet. Make some from Following → ⋯ → Manage groups.")
                        .foregroundStyle(.secondary)
                }
                ForEach(AppModel.shared.groups) { g in
                    Button {
                        if selected.contains(g.id) { selected.remove(g.id) } else { selected.insert(g.id) }
                    } label: {
                        HStack {
                            Text(g.name).foregroundStyle(.primary)
                            Spacer()
                            if selected.contains(g.id) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                    }
                }
            }
            .navigationTitle("Groups for \(username)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        attempt {
                            try await API.shared.fire("PUT", "/api/accounts/\(username)/groups",
                                                      body: ["ids": Array(selected)])
                            await AppModel.shared.loadGroups()
                            dismiss()
                        }
                    }
                    .disabled(!loaded)
                }
            }
            .task {
                if let r: AccountsResponse = try? await API.shared.get("/api/accounts"),
                   let a = r.accounts.first(where: { $0.username == username }) {
                    selected = Set(a.groups ?? [])
                }
                loaded = true
            }
        }
    }
}
