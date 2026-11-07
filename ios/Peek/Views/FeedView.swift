import SwiftUI

struct FeedView: View {
    @AppStorage("feedGroup") private var group = 0
    @State private var posts: [Post] = []
    @State private var next: Double?
    @State private var seenAt: Double?
    @State private var stories: [StoryGroup] = []
    @State private var storyStart: StoryStart?
    @State private var status: Status?
    @State private var newCount = 0
    @State private var refreshing = false
    @State private var refreshStarts = 0  // haptic when you start one, not when a scheduled one runs
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var error: String?

    private var groupParam: String? { group == 0 ? nil : String(group) }
    private var groupName: String {
        AppModel.shared.groups.first { $0.id == group }?.name ?? "Everyone"
    }

    /// Where "You're caught up" goes: before the first post already seen last time.
    private var caughtUpIndex: Int? {
        guard let seenAt, let i = posts.firstIndex(where: { $0.takenAt <= seenAt }), i > 0 else { return nil }
        return i
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 22) {
                    Color.clear.frame(height: 0).id("top")
                    if !stories.isEmpty {
                        StoriesBar(groups: stories) { storyStart = StoryStart(index: $0) }
                    }
                    statusLine
                    if posts.isEmpty && loaded {
                        if let error {
                            ContentUnavailableView("Couldn't load the feed", systemImage: "wifi.exclamationmark",
                                                   description: Text(error))
                        } else {
                            ContentUnavailableView("Nothing here yet", systemImage: "photo.on.rectangle",
                                                   description: Text("Follow some accounts, or wait for the next refresh."))
                        }
                    }
                    ForEach(Array(posts.enumerated()), id: \.element.id) { i, p in
                        if i == caughtUpIndex { CaughtUp() }
                        PostCard(post: p)
                            .onAppear { if p.id == posts.last?.id { Task { await loadMore() } } }
                    }
                    if loadingMore || !loaded { ProgressView().padding() }
                }
                .padding(.bottom, 12)
            }
            .refreshable { await reload() }
            .overlay(alignment: .top) {
                if newCount > 0 {
                    Button {
                        Task {
                            await reload()
                            withAnimation { proxy.scrollTo("top", anchor: .top) }
                        }
                    } label: {
                        Label("\(newCount) new post\(newCount == 1 ? "" : "s")", systemImage: "arrow.up")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(.tint, in: Capsule())
                            .foregroundStyle(.white)
                            .shadow(radius: 6, y: 2)
                    }
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: newCount)
        }
        .navigationTitle("Peek")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker("Show", selection: $group) {
                        Text("Everyone").tag(0)
                        ForEach(AppModel.shared.groups) { g in Text(g.name).tag(g.id) }
                    }
                } label: {
                    Label(groupName, systemImage: group == 0 ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                        .labelStyle(.titleAndIcon)
                        .font(.subheadline)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { refreshAll() } label: {
                    if refreshing { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
                .disabled(refreshing)
            }
        }
        .sensoryFeedback(.success, trigger: refreshStarts)
        .task { if !loaded { await reload() } }
        .onChange(of: group) { Task { await reload() } }
        .task(id: group) { await poll() }
        .fullScreenCover(item: $storyStart) { s in
            StoryViewer(groups: stories, start: s.index) { ids in
                Task {
                    try? await API.shared.markStoriesSeen(ids)
                    await loadStories()
                }
            }
        }
    }

    @ViewBuilder private var statusLine: some View {
        if let status {
            VStack(spacing: 4) {
                if status.session.state == "dead" {
                    Label("Burner session expired — stories are off. Fix it in the web UI.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
                if refreshing {
                    Text("Refreshing…")
                } else if let t = status.lastFetch {
                    Text("Updated \(Fmt.ago(t)) ago")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: loading

    private func reload() async {
        do {
            let r: FeedResponse = try await API.shared.get("/api/feed", ["group": groupParam])
            posts = r.posts
            next = r.next
            seenAt = r.seenAt
            newCount = 0
            error = nil
            if let newest = r.posts.first?.takenAt {
                Task {
                    try? await Task.sleep(for: .seconds(2))
                    try? await API.shared.fire("POST", "/api/feed/seen", body: ["ts": newest])
                }
            }
        } catch {
            if (error as? CancellationError) == nil { self.error = error.localizedDescription }
        }
        loaded = true
        await loadStories()
        if let s: Status = try? await API.shared.get("/api/status") {
            status = s
            refreshing = s.cycleRunning
        }
    }

    private func loadStories() async {
        if let r: StoriesResponse = try? await API.shared.get("/api/stories", ["group": groupParam]) {
            stories = r.groups
        }
    }

    private func loadMore() async {
        guard let before = next, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let r: FeedResponse = try await API.shared.get("/api/feed", ["group": groupParam, "before": String(before)])
            let have = Set(posts.map(\.id))
            posts += r.posts.filter { !have.contains($0.id) }
            next = r.next
        } catch {
            AppModel.shared.show(error)
        }
    }

    /// Cheap local check for posts newer than the top one; quicker while a refresh runs.
    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(refreshing ? 8 : 30))
            guard !Task.isCancelled, let newest = posts.first?.takenAt else { continue }
            guard let r: FeedNew = try? await API.shared.get("/api/feed/new", ["since": String(newest), "group": groupParam])
            else { continue }
            let finished = refreshing && !r.refreshing
            refreshing = r.refreshing
            newCount = r.count
            if finished, let s: Status = try? await API.shared.get("/api/status") { status = s }
        }
    }

    private func refreshAll() {
        attempt {
            let r: RefreshAllResponse = try await API.shared.send("POST", "/api/refresh-all", query: ["group": groupParam])
            if r.count == 0 {
                AppModel.shared.show("Nobody to refresh")
                return
            }
            refreshing = true
            refreshStarts += 1
            AppModel.shared.show(r.already == true ? "A refresh is already running" : "Refreshing \(r.count ?? 0) accounts…")
        }
    }
}

private struct CaughtUp: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle").font(.largeTitle).foregroundStyle(.green)
            Text("You're caught up").font(.headline)
            Text("Older posts below").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
    }
}
