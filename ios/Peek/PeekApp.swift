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
    @Environment(\.scenePhase) private var scenePhase

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
        .onChange(of: scenePhase, initial: true) { _, phase in AppLock.shared.phaseChanged(phase) }
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
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            TabStack { FeedView() }
                .tabItem { Label("Feed", systemImage: "house") }
                .badge(app.newPosts)
                .tag(0)
            TabStack { ReelsView() }
                .tabItem { Label("Reels", systemImage: "play.rectangle") }
                .tag(1)
            TabStack(receivesLinks: true) { SearchView() }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(2)
            TabStack { SavedView() }
                .tabItem { Label("Saved", systemImage: "bookmark") }
                .tag(3)
            TabStack { FollowingView() }
                .tabItem { Label("Following", systemImage: "person.2") }
                .tag(4)
        }
        .onOpenURL { url in  // peek://open?url=… from the share extension
            guard let route = Links.route(url) else {
                app.show("Peek can't open that link")
                return
            }
            tab = 2
            app.openRoute = route
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
    private let receivesLinks: Bool
    @State private var path = NavigationPath()

    init(receivesLinks: Bool = false, @ViewBuilder root: () -> Root) {
        self.receivesLinks = receivesLinks
        self.root = root()
    }

    var body: some View {
        NavigationStack(path: $path) {
            root.navigationDestination(for: Route.self) { route in
                switch route {
                case .profile(let username): ProfileView(username: username)
                case .post(let shortcode): SharedPostView(shortcode: shortcode)
                case .posts(let list): PostListView(list: list)
                case .search(let query): CaptionSearchView(query: query)
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "peek" else { return .systemAction }  // e.g. "Open in Instagram"
            if url.host == "tag" {
                path.append(Route.search("#" + url.lastPathComponent))
            } else if let route = Links.route(url) {
                path.append(route)
            } else {
                return .discarded
            }
            return .handled
        })
        .onChange(of: AppModel.shared.openRoute, initial: true) { _, route in
            guard receivesLinks, let route else { return }
            path = NavigationPath()
            path.append(route)
            AppModel.shared.openRoute = nil
        }
    }
}
