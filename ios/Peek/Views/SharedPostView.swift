import SwiftUI

/// One post by shortcode, e.g. from a shared link. The server fetches it if it's new to Peek.
struct SharedPostView: View {
    let shortcode: String
    @State private var post: Post?
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let post {
                PostCard(post: post).padding(.vertical, 8)
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't open the post", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    if let url = URL(string: "https://www.instagram.com/p/\(shortcode)/") {
                        Link("Open in Instagram", destination: url)
                    }
                }
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .navigationTitle(post?.username ?? "Post")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { post = try await API.shared.post(shortcode) } catch { self.error = error.localizedDescription }
        }
    }
}
