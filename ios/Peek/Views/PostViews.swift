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
            MediaCarousel(media: post.media, fallback: post.thumb, page: $page)
            actions.padding(.horizontal, 12)
            if let caption = post.caption, !caption.isEmpty {
                CaptionText(text: caption, username: post.username)
                    .font(.subheadline)
                    .padding(.horizontal, 12)
            }
        }
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
            Button {
                let next = !saved
                saved = next
                attempt {
                    do { try await API.shared.setSaved(post.shortcode, next) } catch { saved = !next; throw error }
                }
            } label: {
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

    private func toggleSlide(_ idx: Int, on: Bool) {
        attempt {
            try await API.shared.setSaved(post.shortcode, on, slide: idx)
            AppModel.shared.show(on ? "Photo saved" : "Photo unsaved")
            if let full = try? await API.shared.post(post.shortcode) { post = full }
        }
    }
}

/// Swipeable media. Takes the first item's shape (clamped to Instagram's 4:5…1.91:1).
struct MediaCarousel: View {
    let media: [MediaItem]
    let fallback: String?
    @Binding var page: Int

    @State private var aspect: CGFloat?
    @State private var zoom: ZoomStart?

    var body: some View {
        Group {
            if media.isEmpty {
                RemoteImage(path: fallback, maxPixel: 1400, onLoad: setAspect)
            } else {
                TabView(selection: $page) {
                    ForEach(Array(media.enumerated()), id: \.offset) { i, item in
                        Group {
                            if item.video {
                                InlineVideo(item: item, onLoad: i == 0 ? setAspect : nil)
                            } else {
                                RemoteImage(path: item.src, maxPixel: 1400, onLoad: i == 0 ? setAspect : nil)
                                    .contentShape(Rectangle())
                                    .onTapGesture { zoom = ZoomStart(index: i) }
                            }
                        }
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: media.count > 1 ? .always : .never))
                .indexViewStyle(.page(backgroundDisplayMode: .interactive))
            }
        }
        .aspectRatio(aspect ?? 0.8, contentMode: .fit)
        .background(Color(.secondarySystemBackground))
        .fullScreenCover(item: $zoom) { z in
            ZoomViewer(media: media, start: z.index)
        }
    }

    private func setAspect(_ size: CGSize) {
        guard aspect == nil, size.height > 0 else { return }
        aspect = min(max(size.width / size.height, 0.8), 1.91)
    }
}

struct ZoomStart: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Poster with a play button; tap to play in place with the system controls.
struct InlineVideo: View {
    let item: MediaItem
    var onLoad: ((CGSize) -> Void)? = nil
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
            } else {
                RemoteImage(path: item.poster, maxPixel: 1400, onLoad: onLoad)
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 58))
                    .foregroundStyle(.white.opacity(0.92))
                    .shadow(radius: 8)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard player == nil, let p = Video.player(item.src, muted: false) else { return }
            player = p
            p.play()
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }
}

/// Full screen, pinch/double-tap to zoom, swipe between items.
struct ZoomViewer: View {
    let media: [MediaItem]
    @State private var index: Int
    @Environment(\.dismiss) private var dismiss

    init(media: [MediaItem], start: Int) {
        self.media = media
        _index = State(initialValue: start)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(media.enumerated()), id: \.offset) { i, item in
                    ZoomPage(item: item).tag(i)
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
        }
        .statusBarHidden()
    }
}

private struct ZoomPage: View {
    let item: MediaItem
    @State private var image: UIImage?
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if item.video {
                if let player { VideoPlayer(player: player) } else { ProgressView().tint(.white) }
            } else if let image {
                ZoomableImage(image: image)
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

/// UIScrollView zooming: pinch and double-tap behave like Photos.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage

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
        return sv
    }

    func updateUIView(_ sv: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

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
    }
}

/// Square tiles, three across. Tapping one opens the list at that post.
struct PostGrid: View {
    let posts: [Post]
    let title: String
    var onReachEnd: (() -> Void)? = nil

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 2) {
            ForEach(posts) { p in
                NavigationLink(value: Route.posts(PostList(posts: posts, start: p.id, title: title))) {
                    PostThumb(post: p)
                }
                .buttonStyle(.plain)
                .onAppear { if p.id == posts.last?.id { onReachEnd?() } }
            }
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
