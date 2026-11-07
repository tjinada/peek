import AVKit
import SwiftUI

/// One post as in the feed: header, media, save, caption.
struct PostCard: View {
    @State private var post: Post
    @State private var page: Int
    @State private var saved: Bool

    init(post: Post) {
        _post = State(initialValue: post)
        _saved = State(initialValue: post.saved)
        _page = State(initialValue: post.slide.flatMap { s in post.media.firstIndex { $0.idx == s } } ?? 0)
    }

    private var current: MediaItem? { post.media.indices.contains(page) ? post.media[page] : nil }
    private var fileName: String { "\(post.username)_\(post.shortcode)_\(current?.idx ?? 0)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header.padding(.horizontal, 12)
            MediaCarousel(media: post.media, fallback: post.thumb, page: $page) {
                if !saved { setSaved(true) }  // like Instagram's double-tap: never undoes
            }
            actions.padding(.horizontal, 12)
            if let caption = post.caption, !caption.isEmpty {
                CaptionText(text: caption, username: post.username)
                    .font(.subheadline)
                    .padding(.horizontal, 12)
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: saved)
        .task(id: post.shortcode) {
            guard post.needsDetail, let full = try? await API.shared.post(post.shortcode) else { return }
            post = full
            saved = full.saved
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            NavigationLink(value: Route.profile(post.username)) {
                HStack(spacing: 10) {
                    Avatar(path: post.avatar, size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(post.username).font(.subheadline.weight(.semibold))
                        if let name = post.fullName, !name.isEmpty {
                            Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer()
            Text(Fmt.ago(post.takenAt)).font(.caption).foregroundStyle(.secondary)
            Menu {
                if let item = current {
                    Button { MediaActions.saveToPhotos(item, name: fileName) } label: {
                        Label("Save to Photos", systemImage: "square.and.arrow.down")
                    }
                    Button { MediaActions.share(item, name: fileName) } label: {
                        Label("Share…", systemImage: "square.and.arrow.up")
                    }
                }
                if post.media.count > 1 {
                    Button { MediaActions.saveAllToPhotos(post.media, name: "\(post.username)_\(post.shortcode)") } label: {
                        Label("Save all \(post.media.count) to Photos", systemImage: "square.and.arrow.down.on.square")
                    }
                }
                if post.media.count > 1, let item = current {
                    let on = post.savedSlides.contains(item.idx)
                    Button { toggleSlide(item.idx, on: !on) } label: {
                        Label(on ? "Unsave this photo" : "Save just this photo", systemImage: "photo.badge.checkmark")
                    }
                }
                if let url = post.instagramURL {
                    Link(destination: url) { Label("Open in Instagram", systemImage: "arrow.up.right.square") }
                    Button { UIPasteboard.general.url = url } label: { Label("Copy link", systemImage: "link") }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(.primary)
        }
    }

    private var actions: some View {
        HStack(spacing: 14) {
            Button { setSaved(!saved) } label: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark").font(.title3)
            }
            .buttonStyle(.plain)
            if post.media.count > 1 {
                Text("\(page + 1)/\(post.media.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Spacer()
            if let likes = post.likes, likes > 0 {
                Label(Fmt.count(likes), systemImage: "heart").font(.caption).foregroundStyle(.secondary)
            }
            if let comments = post.comments, comments > 0 {
                Label(Fmt.count(comments), systemImage: "bubble.right").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func setSaved(_ on: Bool) {
        saved = on
        attempt {
            do { try await API.shared.setSaved(post.shortcode, on) } catch { saved = !on; throw error }
        }
    }

    private func toggleSlide(_ idx: Int, on: Bool) {
        attempt {
            try await API.shared.setSaved(post.shortcode, on, slide: idx)
            AppModel.shared.show(on ? "Photo saved" : "Photo unsaved")
            if let full = try? await API.shared.post(post.shortcode) { post = full }
        }
    }
}

/// Swipeable media in the first item's shape (clamped to Instagram's 4:5…1.91:1).
/// The shape is measured before the pager is built: resizing a page-style TabView after it
/// exists, or swapping its items in place, can leave the first page blank.
/// Tap opens full screen; double-tap calls `onDoubleTap` with a bookmark pop.
struct MediaCarousel: View {
    let media: [MediaItem]
    let fallback: String?
    @Binding var page: Int
    var onDoubleTap: (() -> Void)? = nil

    @State private var aspect: CGFloat?
    @State private var zoom: ZoomStart?
    @State private var burst = false

    private var firstPath: String? {
        guard let first = media.first else { return fallback }
        return first.video ? first.poster : first.src
    }

    var body: some View {
        Group {
            if aspect == nil {
                Color(.secondarySystemBackground).overlay { ProgressView() }
            } else if media.isEmpty {
                RemoteImage(path: fallback, maxPixel: 1400)
            } else {
                TabView(selection: $page) {
                    ForEach(Array(media.enumerated()), id: \.offset) { i, item in
                        Group {
                            if item.video {
                                InlineVideo(item: item, suspended: zoom != nil)
                            } else {
                                RemoteImage(path: item.src, maxPixel: 1400)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { doubleTap() }
                        .onTapGesture { zoom = ZoomStart(index: i) }
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: media.count > 1 ? .always : .never))
                .indexViewStyle(.page(backgroundDisplayMode: .interactive))
                .id(media.map(\.src))  // new items (a stub filled in) get a fresh pager
            }
        }
        .aspectRatio(aspect ?? 0.8, contentMode: .fit)
        .background(Color(.secondarySystemBackground))
        .overlay {
            if burst {
                Image(systemName: "bookmark.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.35), radius: 12)
                    .transition(.scale(scale: 0.3).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
        .task(id: firstPath) { await measure() }
        .fullScreenCover(item: $zoom) { z in
            ZoomViewer(media: media, start: z.index)
        }
    }

    private func doubleTap() {
        guard let onDoubleTap else { return }
        onDoubleTap()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.55)) { burst = true }
        Task {
            try? await Task.sleep(for: .milliseconds(650))
            withAnimation(.easeOut(duration: 0.2)) { burst = false }
        }
    }

    /// Loads the first image (it's needed anyway, and lands in the cache) to get the shape.
    private func measure() async {
        guard let path = firstPath else {
            aspect = 0.8
            return
        }
        if let hit = ImageLoader.cached(path, 1400) {  // scrolling back: no placeholder flash
            aspect = Self.clamp(hit.size)
            return
        }
        aspect = nil
        let size = (try? await ImageLoader.load(path, maxPixel: 1400))?.size
        if Task.isCancelled { return }
        aspect = size.map(Self.clamp) ?? 0.8  // on failure the page shows its own error
    }

    private static func clamp(_ size: CGSize) -> CGFloat {
        size.height > 0 ? min(max(size.width / size.height, 0.8), 1.91) : 0.8
    }
}

struct ZoomStart: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Feed video: plays muted and looping while it's mostly on screen, like Instagram.
/// Taps go to the carousel (full screen with controls); the corner button toggles sound.
struct InlineVideo: View {
    let item: MediaItem
    var suspended = false  // e.g. the same video is open full screen
    @State private var player: LoopPlayer?
    @State private var visible = false
    @AppStorage("muted") private var muted = true

    var body: some View {
        let screen = Screen.bounds
        ZStack(alignment: .bottomTrailing) {
            RemoteImage(path: item.poster, maxPixel: 1400)  // shows until the first frame
            if let player {
                PlayerLayerView(player: player.player, gravity: .resizeAspectFill)
            }
            Button { muted.toggle() } label: {
                Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .padding(10)
        }
        .onGeometryChange(for: Bool.self) { proxy in
            let frame = proxy.frame(in: .global)
            let shown = frame.intersection(screen)
            return frame.width > 0 && shown.width * shown.height >= 0.6 * frame.width * frame.height
        } action: { visible = $0 }
        .onChange(of: visible) { sync() }
        .onChange(of: suspended) { sync() }
        .onChange(of: muted) { player?.player.isMuted = muted }
        .onDisappear {
            player?.player.pause()
            player = nil
        }
    }

    private func sync() {
        if visible && !suspended {
            if player == nil { player = LoopPlayer(path: item.src, muted: muted) }
            player?.player.play()
        } else {
            player?.player.pause()
        }
    }
}

/// Full screen, pinch/double-tap to zoom, swipe between items. Pull down or pinch in to close.
struct ZoomViewer: View {
    let media: [MediaItem]
    @State private var index: Int
    @State private var pull: CGFloat = 0  // 0…1 while dragging down
    @Environment(\.dismiss) private var dismiss

    init(media: [MediaItem], start: Int) {
        self.media = media
        _index = State(initialValue: start)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(1 - pull).ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(media.enumerated()), id: \.offset) { i, item in
                    ZoomPage(item: item, onPull: { pull = $0 }, onClose: { dismiss() }).tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: media.count > 1 ? .always : .never))
            .ignoresSafeArea()
            HStack(spacing: 18) {
                Button { dismiss() } label: { Image(systemName: "xmark") }
                Spacer()
                if media.indices.contains(index) {
                    let item = media[index]
                    Button { MediaActions.share(item, name: "peek_\(item.idx)") } label: { Image(systemName: "square.and.arrow.up") }
                    Button { MediaActions.saveToPhotos(item, name: "peek_\(item.idx)") } label: { Image(systemName: "square.and.arrow.down") }
                }
            }
            .font(.title3.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .shadow(radius: 4)
            .opacity(1 - pull)
        }
        .presentationBackground(.clear)  // the feed shows through while pulling down
        .statusBarHidden()
    }
}

private struct ZoomPage: View {
    let item: MediaItem
    let onPull: (CGFloat) -> Void
    let onClose: () -> Void
    @State private var image: UIImage?
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if item.video {
                if let player { PlayerController(player: player) } else { ProgressView().tint(.white) }
            } else if let image {
                ZoomableImage(image: image, onPull: onPull, onClose: onClose)
            } else {
                ProgressView().tint(.white)
            }
        }
        .task {
            if item.video {
                player = Video.player(item.src, muted: false)
                player?.play()
            } else {
                image = try? await ImageLoader.load(item.src, maxPixel: 3000)
            }
        }
        .onDisappear { player?.pause() }
    }
}

/// UIScrollView zooming: pinch and double-tap behave like Photos. At normal size, a downward
/// drag moves the photo and closes past a threshold; pinching in past the fitted size closes.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    var onPull: (CGFloat) -> Void = { _ in }
    var onClose: () -> Void = {}

    func makeUIView(context: Context) -> UIScrollView {
        let sv = UIScrollView()
        sv.delegate = context.coordinator
        sv.minimumZoomScale = 1
        sv.maximumZoomScale = 6
        sv.showsHorizontalScrollIndicator = false
        sv.showsVerticalScrollIndicator = false
        sv.contentInsetAdjustmentBehavior = .never
        sv.backgroundColor = .clear
        let iv = UIImageView(image: image)
        iv.contentMode = .scaleAspectFit
        iv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        iv.frame = sv.bounds
        sv.addSubview(iv)
        context.coordinator.imageView = iv
        let double = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:)))
        double.numberOfTapsRequired = 2
        sv.addGestureRecognizer(double)
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        pan.delegate = context.coordinator
        sv.addGestureRecognizer(pan)
        return sv
    }

    func updateUIView(_ sv: UIScrollView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.imageView?.image = image
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        var parent: ZoomableImage
        weak var imageView: UIImageView?
        private var smallest: CGFloat = 1

        init(_ parent: ZoomableImage) { self.parent = parent }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
            smallest = scrollView.zoomScale
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            if scrollView.isZooming { smallest = min(smallest, scrollView.zoomScale) }
        }

        func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) {
            if smallest < 0.85 { parent.onClose() }  // pinched in past the fitted size
            smallest = 1
        }

        @objc func doubleTap(_ g: UITapGestureRecognizer) {
            guard let sv = g.view as? UIScrollView, let iv = imageView else { return }
            if sv.zoomScale > 1 {
                sv.setZoomScale(1, animated: true)
            } else {
                let p = g.location(in: iv)
                let size = CGSize(width: sv.bounds.width / 3, height: sv.bounds.height / 3)
                sv.zoom(to: CGRect(x: p.x - size.width / 2, y: p.y - size.height / 2, width: size.width, height: size.height), animated: true)
            }
        }

        /// Only a mostly-downward drag at normal size; sideways drags go to the pager.
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer, let sv = pan.view as? UIScrollView else { return true }
            let v = pan.velocity(in: sv)
            return sv.zoomScale <= 1.01 && v.y > 0 && v.y > abs(v.x)
        }

        /// Alongside the scroll view's own pan, which has nothing to scroll at normal size.
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            other === (g.view as? UIScrollView)?.panGestureRecognizer
        }

        @objc func pan(_ g: UIPanGestureRecognizer) {
            guard let sv = g.view else { return }
            let t = g.translation(in: sv)
            let progress = min(max(t.y / 400, 0), 1)
            switch g.state {
            case .changed:
                let s = 1 - progress * 0.25
                sv.transform = CGAffineTransform(translationX: t.x * 0.4, y: max(t.y, 0)).scaledBy(x: s, y: s)
                parent.onPull(progress)
            case .ended, .cancelled:
                if t.y > 120 || g.velocity(in: sv).y > 900 {
                    parent.onClose()
                } else {
                    UIView.animate(withDuration: 0.25) { sv.transform = .identity }
                    parent.onPull(0)
                }
            default:
                break
            }
        }
    }
}

/// Square tiles, three across. Tapping one opens the list at that post; long-press previews it.
struct PostGrid: View {
    let posts: [Post]
    let title: String
    var showsProfile = true  // off on a profile's own grid
    var onReachEnd: (() -> Void)? = nil

    @Environment(\.openURL) private var openURL
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 2) {
            ForEach(posts) { p in
                NavigationLink(value: Route.posts(PostList(posts: posts, start: p.id, title: title))) {
                    PostThumb(post: p)
                }
                .buttonStyle(.plain)
                .contextMenu { menu(p) } preview: { PostPreview(post: p) }
                .onAppear { if p.id == posts.last?.id { onReachEnd?() } }
            }
        }
    }

    @ViewBuilder private func menu(_ p: Post) -> some View {
        let saved = p.slide != nil || p.saved  // Saved-tab single photos count as saved
        Button {
            attempt {
                try await API.shared.setSaved(p.shortcode, !saved, slide: p.slide)
                AppModel.shared.show(saved ? "Unsaved" : "Saved")
            }
        } label: {
            Label(saved ? "Unsave" : "Save", systemImage: saved ? "bookmark.slash" : "bookmark")
        }
        Button { saveToPhotos(p) } label: { Label("Save to Photos", systemImage: "square.and.arrow.down") }
        if p.kind == "carousel" && p.slide == nil {
            Button { saveToPhotos(p, all: true) } label: {
                Label("Save all to Photos", systemImage: "square.and.arrow.down.on.square")
            }
        }
        if showsProfile, let url = URL(string: "peek://u/\(p.username)") {
            Button { openURL(url) } label: { Label("Open \(p.username)", systemImage: "person.crop.circle") }
        }
    }

    private func saveToPhotos(_ p: Post, all: Bool = false) {
        attempt {
            let full = p.needsDetail ? try await API.shared.post(p.shortcode) : p
            if all {
                MediaActions.saveAllToPhotos(full.media, name: "\(p.username)_\(p.shortcode)")
                return
            }
            guard let item = p.slide.flatMap({ s in full.media.first { $0.idx == s } }) ?? full.media.first else {
                AppModel.shared.show("Nothing to save yet")
                return
            }
            MediaActions.saveToPhotos(item, name: "\(p.username)_\(p.shortcode)_\(item.idx)")
        }
    }
}

/// The long-press preview: the thumbnail straight away, then the full image in its own shape.
private struct PostPreview: View {
    let post: Post
    @State private var image: UIImage?

    private var path: String? {
        let item = post.slide.flatMap { s in post.media.first { $0.idx == s } } ?? post.media.first
        guard let item else { return post.thumb }
        return item.video ? item.poster : item.src
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                ProgressView().frame(width: 300, height: 300)
            }
        }
        .frame(width: 340)
        .task {
            if let thumb = post.thumb { image = ImageLoader.cached(thumb, 420) }
            if let path, let full = try? await ImageLoader.load(path, maxPixel: 1200) { image = full }
        }
    }
}

struct PostThumb: View {
    let post: Post

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { RemoteImage(path: post.thumb, maxPixel: 420) }
            .clipped()
            .overlay(alignment: .topTrailing) {
                if let icon {
                    Image(systemName: icon)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .shadow(radius: 3)
                        .padding(6)
                }
            }
            .contentShape(Rectangle())
    }

    private var icon: String? {
        if post.slide != nil { return nil }
        if post.isVideo { return "play.fill" }
        if post.kind == "carousel" { return "square.on.square.fill" }
        return nil
    }
}

/// Posts as a scrolling list, opened at the one that was tapped.
struct PostListView: View {
    let list: PostList

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 22) {
                    ForEach(list.posts) { p in
                        PostCard(post: p).id(p.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .task {
                proxy.scrollTo(list.start, anchor: .top)
                try? await Task.sleep(for: .milliseconds(120))  // lazy rows may not be laid out on the first pass
                proxy.scrollTo(list.start, anchor: .top)
            }
        }
        .navigationTitle(list.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
