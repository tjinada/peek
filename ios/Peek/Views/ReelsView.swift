import AVFoundation
import SwiftUI

/// Full-height vertical pager over the feed's videos. Keeps a player for the current reel and
/// its neighbours, so the next one is already buffering when you swipe.
struct ReelsView: View {
    @State private var posts: [Post] = []
    @State private var next: Double?
    @State private var current: String?
    @State private var players: [String: LoopPlayer] = [:]
    @State private var onScreen = false
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var error: String?
    @AppStorage("muted") private var muted = true
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(spacing: 0) {
                ForEach(posts) { p in
                    ReelPage(post: p, player: players[p.id]?.player, active: current == p.id, muted: $muted)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(p.id)
                        .onAppear { if p.id == posts.last?.id { Task { await loadMore() } } }
                        .task(id: p.id) { await hydrate(p) }
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $current)
        .scrollIndicators(.hidden)
        .background(Color.black)
        .overlay {
            if posts.isEmpty {
                if !loaded {
                    ProgressView().tint(.white)
                } else {
                    ContentUnavailableView("No reels yet", systemImage: "play.rectangle",
                                           description: Text(error ?? "Videos from accounts you follow show up here."))
                        .foregroundStyle(.white)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { if !loaded { await reload() } }
        .refreshable { await reload() }
        .onAppear { onScreen = true; sync() }
        .onDisappear { onScreen = false; sync() }
        .onChange(of: current) { sync() }
        .onChange(of: muted) { sync() }
        .onChange(of: scenePhase) { sync() }
    }

    private var visible: Bool { onScreen && scenePhase == .active }

    private func reload() async {
        do {
            let r: FeedResponse = try await API.shared.get("/api/feed", ["kind": "reels", "limit": "12"])
            players.values.forEach { $0.player.pause() }
            players = [:]
            posts = r.posts
            next = r.next
            current = r.posts.first?.id
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        sync()
    }

    private func loadMore() async {
        guard let before = next, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let r: FeedResponse = try? await API.shared.get(
            "/api/feed", ["kind": "reels", "limit": "12", "before": String(before)]) else { return }
        let have = Set(posts.map(\.id))
        posts += r.posts.filter { !have.contains($0.id) }
        next = r.next
    }

    /// Stubs from a logged-out profile page have no media yet; fetch them when they come up.
    private func hydrate(_ p: Post) async {
        guard p.firstVideo == nil, p.needsDetail, let full = try? await API.shared.post(p.shortcode),
              let i = posts.firstIndex(where: { $0.id == p.id }) else { return }
        posts[i] = full
        sync()
    }

    /// Players for current ±1, playing only the current one while the tab is on screen.
    private func sync() {
        let cur = current ?? posts.first?.id
        guard let cur, let i = posts.firstIndex(where: { $0.id == cur }) else { return }
        let window = posts[max(0, i - 1)...min(posts.count - 1, i + 1)]
        let keep = Set(window.map(\.id))
        for (id, lp) in players where !keep.contains(id) {
            lp.player.pause()
            players[id] = nil
        }
        for p in window where players[p.id] == nil {
            if let v = p.firstVideo, let lp = LoopPlayer(path: v.src, muted: muted) { players[p.id] = lp }
        }
        for (id, lp) in players {
            lp.player.isMuted = muted
            if id == cur && visible { lp.player.play() } else { lp.player.pause() }
        }
    }
}

private struct ReelPage: View {
    let post: Post
    let player: AVPlayer?
    let active: Bool
    @Binding var muted: Bool

    @State private var paused = false
    @State private var saved: Bool?

    private var isSaved: Bool { saved ?? post.saved }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black
            if let player {
                PlayerLayerView(player: player)
            } else {
                RemoteImage(path: post.firstVideo?.poster ?? post.thumb, maxPixel: 1400, contentMode: .fit)
            }
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                .allowsHitTesting(false)
            if paused {
                Image(systemName: "play.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(false)
            }
            HStack(alignment: .bottom, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    NavigationLink(value: Route.profile(post.username)) {
                        HStack(spacing: 8) {
                            Avatar(path: post.avatar, size: 32)
                            Text(post.username).font(.subheadline.weight(.semibold))
                            Text(Fmt.ago(post.takenAt)).font(.caption).opacity(0.7)
                        }
                    }
                    .buttonStyle(.plain)
                    if let caption = post.caption, !caption.isEmpty {
                        Text(caption).font(.subheadline).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                VStack(spacing: 22) {
                    Button { muted.toggle() } label: {
                        Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    }
                    Button(action: toggleSave) {
                        Image(systemName: isSaved ? "bookmark.fill" : "bookmark")
                    }
                    if let v = post.firstVideo {
                        Menu {
                            Button { MediaActions.saveToPhotos(v, name: "\(post.username)_\(post.shortcode)") } label: {
                                Label("Save to Photos", systemImage: "square.and.arrow.down")
                            }
                            Button { MediaActions.share(v, name: "\(post.username)_\(post.shortcode)") } label: {
                                Label("Share…", systemImage: "square.and.arrow.up")
                            }
                            if let url = post.instagramURL {
                                Link(destination: url) { Label("Open in Instagram", systemImage: "arrow.up.right.square") }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .frame(width: 30, height: 30)
                                .contentShape(Rectangle())
                        }
                    }
                }
                .font(.title2)
            }
            .foregroundStyle(.white)
            .shadow(radius: 3)
            .padding(.horizontal, 16)
            .padding(.bottom, 20)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard let player else { return }
            paused.toggle()
            if paused { player.pause() } else { player.play() }
        }
        .onChange(of: active) { paused = false }
        .sensoryFeedback(.impact(weight: .light), trigger: isSaved)
    }

    private func toggleSave() {
        let next = !isSaved
        saved = next
        attempt {
            do { try await API.shared.setSaved(post.shortcode, next) } catch { saved = !next; throw error }
        }
    }
}
