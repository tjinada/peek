import AVFoundation
import SwiftUI

@main
struct PeekApp: App {
    init() {
        // Videos start muted and mix with whatever's playing; unmuted they ignore the silent switch.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [.mixWithOthers])
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    private var app: AppModel { AppModel.shared }
    @AppStorage("appearance") private var appearance = "system"   // system | light | dark

    var body: some View {
        Group {
            if app.server.isEmpty {
                NavigationStack { SetupView() }
            } else {
                MainTabs()
                    .id(app.epoch)
                    .fullScreenCover(isPresented: Binding(get: { app.needsLogin }, set: { app.needsLogin = $0 })) {
                        NavigationStack { SetupView(signInOnly: true) }
                    }
            }
        }
        .overlay(alignment: .top) {
            if let toast = app.toast {
                Text(toast)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(radius: 8, y: 2)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { app.toast = nil }
            }
        }
        .animation(.snappy, value: app.toast)
        .onAppear { applyAppearance() }
        .onChange(of: appearance) { applyAppearance() }
    }

    /// Set on the window rather than with preferredColorScheme, so sheets and full-screen
    /// covers follow it and going back to System takes effect straight away.
    private func applyAppearance() {
        let style: UIUserInterfaceStyle = appearance == "light" ? .light : appearance == "dark" ? .dark : .unspecified
        for scene in UIApplication.shared.connectedScenes {
            (scene as? UIWindowScene)?.windows.forEach { $0.overrideUserInterfaceStyle = style }
        }
    }
}

struct MainTabs: View {
    private var app: AppModel { AppModel.shared }

    var body: some View {
        TabView {
            TabStack { FeedView() }
                .tabItem { Label("Feed", systemImage: "house") }
                .badge(app.newPosts)
            TabStack { ReelsView() }
                .tabItem { Label("Reels", systemImage: "play.rectangle") }
            TabStack { SearchView() }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
            TabStack { SavedView() }
                .tabItem { Label("Saved", systemImage: "bookmark") }
            TabStack { FollowingView() }
                .tabItem { Label("Following", systemImage: "person.2") }
        }
        .task { await AppModel.shared.loadGroups() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(app.refreshing ? 8 : 30))
                await app.pollFeed()
            }
        }
    }
}

/// A tab's navigation stack: shared destinations, and peek:// links from captions.
struct TabStack<Root: View>: View {
    private let root: Root
    @State private var path = NavigationPath()

    init(@ViewBuilder root: () -> Root) {
        self.root = root()
    }

    var body: some View {
        NavigationStack(path: $path) {
            root.navigationDestination(for: Route.self) { route in
                switch route {
                case .profile(let username): ProfileView(username: username)
                case .posts(let list): PostListView(list: list)
                case .search(let query): CaptionSearchView(query: query)
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "peek" else { return .systemAction }
            let value = url.lastPathComponent
            switch url.host {
            case "u": path.append(Route.profile(value))
            case "tag": path.append(Route.search("#" + value))
            default: return .discarded
            }
            return .handled
        })
    }
}
