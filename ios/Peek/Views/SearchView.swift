import SwiftUI

/// Look up anyone by username, search saved accounts and captions, plus Instagram's own
/// suggestions when the burner session allows.
struct SearchView: View {
    @State private var query = ""
    @State private var accounts: [Account] = []
    @State private var posts: [Post] = []
    @State private var igUsers: [IGUser] = []
    @State private var igNote: String?

    private var link: Route? { Links.route(text: query) }  // a pasted instagram.com link
    private var handle: String? { link == nil ? Fmt.handle(query) : nil }

    var body: some View {
        List {
            if let link {
                Section {
                    NavigationLink(value: link) {
                        switch link {
                        case .profile(let u): Label("Open @\(u)", systemImage: "person.crop.circle")
                        default: Label("Open this post", systemImage: "photo")
                        }
                    }
                }
            }
            if let handle {
                Section {
                    NavigationLink(value: Route.profile(handle)) {
                        Label("Open @\(handle)", systemImage: "person.crop.circle.badge.magnifyingglass")
                    }
                }
            }
            if !accounts.isEmpty {
                Section("In Peek") {
                    ForEach(accounts) { a in
                        NavigationLink(value: Route.profile(a.username)) {
                            PersonRow(avatar: a.avatar, username: a.username, name: a.fullName,
                                      detail: a.followed == true ? "Following" : nil)
                        }
                    }
                }
            }
            if !igUsers.isEmpty {
                Section("On Instagram") {
                    ForEach(igUsers) { u in
                        NavigationLink(value: Route.profile(u.username)) {
                            PersonRow(avatar: u.avatar, username: u.username, name: u.fullName,
                                      detail: u.followed == true ? "Following" : u.followers.map { "\(Fmt.count($0)) followers" },
                                      verified: u.verified == true)
                        }
                    }
                }
            } else if let igNote, query.count >= 3 {
                Section { Text(igNote).font(.footnote).foregroundStyle(.secondary) }
            }
            if !posts.isEmpty {
                Section("Captions") {
                    NavigationLink(value: Route.search(query.trimmingCharacters(in: .whitespacesAndNewlines))) {
                        Label("\(posts.count == 60 ? "60+" : String(posts.count)) saved posts mention “\(query)”",
                              systemImage: "text.magnifyingglass")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if query.isEmpty {
                ContentUnavailableView("Search", systemImage: "magnifyingglass",
                                       description: Text("A username or link opens that profile. Words search saved captions."))
            }
        }
        .navigationTitle("Search")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Username, link or caption")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await search()
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2, link == nil else {
            accounts = []; posts = []; igUsers = []; igNote = nil
            return
        }
        if let r: SearchResponse = try? await API.shared.get("/api/search", ["q": q]) {
            accounts = r.accounts
            posts = r.posts
        }
        if q.count >= 3, !q.contains(" "), !q.hasPrefix("#"),
           let r: IGSearchResponse = try? await API.shared.get("/api/search/instagram", ["q": q]) {
            let local = Set(accounts.map(\.username))
            igUsers = r.users.filter { !local.contains($0.username) }
            igNote = r.status == "ok" ? nil : r.message
        } else {
            igUsers = []
        }
    }
}

/// Posts whose captions match, e.g. a tapped #hashtag.
struct CaptionSearchView: View {
    let query: String
    @State private var posts: [Post] = []
    @State private var loaded = false

    var body: some View {
        ScrollView {
            PostGrid(posts: posts, title: query)
            if loaded && posts.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .navigationTitle(query)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let r: SearchResponse = try? await API.shared.get("/api/search", ["q": query]) { posts = r.posts }
            loaded = true
        }
    }
}

struct PersonRow: View {
    let avatar: String?
    let username: String
    let name: String?
    var detail: String? = nil
    var verified = false

    var body: some View {
        HStack(spacing: 12) {
            Avatar(path: avatar, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(username).font(.subheadline.weight(.semibold))
                    if verified { Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(.blue) }
                }
                if let name, !name.isEmpty {
                    Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
        }
    }
}
