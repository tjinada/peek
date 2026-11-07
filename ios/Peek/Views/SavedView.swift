import SwiftUI

struct SavedView: View {
    @State private var posts: [Post] = []
    @State private var next: Double?
    @State private var count = 0
    @State private var loaded = false
    @State private var loadingMore = false

    var body: some View {
        ScrollView {
            PostGrid(posts: posts, title: "Saved") { Task { await loadMore() } }
            if loadingMore { ProgressView().padding() }
        }
        .overlay {
            if loaded && posts.isEmpty {
                ContentUnavailableView("Nothing saved", systemImage: "bookmark",
                                       description: Text("Tap the bookmark on a post to keep it here for good."))
            } else if !loaded {
                ProgressView()
            }
        }
        .navigationTitle(count > 0 ? "Saved (\(count))" : "Saved")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .onAppear { Task { await load() } }  // saves happen on other tabs
    }

    private func load() async {
        if let r: SavedResponse = try? await API.shared.get("/api/saved") {
            posts = r.posts
            next = r.next
            count = r.count
        }
        loaded = true
    }

    private func loadMore() async {
        guard let before = next, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let r: SavedResponse = try? await API.shared.get("/api/saved", ["before": String(before)]) {
            let have = Set(posts.map(\.id))
            posts += r.posts.filter { !have.contains($0.id) }
            next = r.next
        }
    }
}
