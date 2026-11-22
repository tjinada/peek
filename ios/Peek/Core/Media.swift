import AVFoundation
import AVKit
import Photos
import SwiftUI
import UIKit

enum Video {
    /// A server video as an asset that sends the auth cookie (AVPlayer doesn't use URLSession).
    static func asset(_ path: String) -> AVURLAsset? {
        guard let url = API.shared.url(path) else { return nil }
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        return AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
    }

    static func player(_ path: String, muted: Bool) -> AVPlayer? {
        guard let asset = asset(path) else { return nil }
        let p = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        p.isMuted = muted
        return p
    }
}

enum Screen {
    @MainActor static var bounds: CGRect {
        (UIApplication.shared.connectedScenes.first { $0 is UIWindowScene } as? UIWindowScene)?.screen.bounds
            ?? CGRect(x: 0, y: 0, width: 430, height: 932)
    }
}

/// A video that repeats, for reels and the feed. One item, rewound when it ends:
/// AVPlayerLooper keeps several copies of the item loading at once, which is heavy over a
/// network. `phase` says why nothing is moving, so a failure doesn't look like a frozen poster.
@Observable
final class LoopPlayer {
    enum Phase: Equatable {
        case ok
        case buffering
        case failed(String)
    }

    let player = AVPlayer()
    private(set) var phase: Phase = .ok

    private let path: String
    @ObservationIgnored private var itemStatus: NSKeyValueObservation?
    @ObservationIgnored private var control: NSKeyValueObservation?
    @ObservationIgnored private var ended: NSObjectProtocol?

    init?(path: String, muted: Bool) {
        self.path = path
        guard Video.asset(path) != nil else { return nil }
        player.isMuted = muted
        player.actionAtItemEnd = .none  // stay on the item; `ended` rewinds it
        player.preventsDisplaySleepDuringVideoPlayback = true
        control = player.observe(\.timeControlStatus) { [weak self] _, _ in
            DispatchQueue.main.async { self?.update() }
        }
        load()
    }

    deinit {
        if let ended { NotificationCenter.default.removeObserver(ended) }
    }

    /// Starts again from the server after a failure.
    func retry() {
        load()
        player.play()
    }

    private func load() {
        guard let asset = Video.asset(path) else { return }
        let item = AVPlayerItem(asset: asset)
        if let ended { NotificationCenter.default.removeObserver(ended) }
        ended = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            self?.player.seek(to: .zero)
            self?.player.play()
        }
        itemStatus = item.observe(\.status) { [weak self] _, _ in
            DispatchQueue.main.async { self?.update() }
        }
        player.replaceCurrentItem(with: item)
        phase = .ok
    }

    private func update() {
        if let item = player.currentItem, item.status == .failed {
            if case .failed = phase { return }
            phase = .failed(item.error?.localizedDescription ?? "Couldn't play this video")
            explain()
        } else {
            let next: Phase = player.timeControlStatus == .waitingToPlayAtSpecifiedRate ? .buffering : .ok
            if phase != next { phase = next }
        }
    }

    /// AVPlayer's own errors are vague; the server's answer for the same file says more
    /// (e.g. Instagram's link expired before the video was downloaded).
    private func explain() {
        let path = self.path
        Task { @MainActor [weak self] in
            guard let reason = await API.shared.mediaError(path), let self else { return }
            if case .failed = self.phase { self.phase = .failed(reason) }
        }
    }
}

/// What a LoopPlayer is doing, drawn over its poster: a spinner while it buffers, and the
/// reason with a retry when it fails.
struct PlayerStatus: View {
    let player: LoopPlayer

    var body: some View {
        Group {
            switch player.phase {
            case .ok:
                EmptyView()
            case .buffering:
                ProgressView().tint(.white)
            case .failed(let why):
                Button { player.retry() } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise").font(.title2)
                        Text(why).font(.caption).multilineTextAlignment(.center).lineLimit(4)
                    }
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .padding(24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Bare video surface: no controls, fills its frame.
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect

    final class PlayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> PlayerUIView {
        let v = PlayerUIView()
        v.backgroundColor = .clear  // a poster underneath shows until the first frame
        v.playerLayer.player = player
        v.playerLayer.videoGravity = gravity
        return v
    }

    func updateUIView(_ v: PlayerUIView, context: Context) {
        if v.playerLayer.player !== player { v.playerLayer.player = player }
        v.playerLayer.videoGravity = gravity
    }
}

/// The system player screen: scrubbing, speed menu, AirPlay. For full-screen videos.
struct PlayerController: UIViewControllerRepresentable {
    let player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = false  // needs a background-audio capability the app doesn't have
        return vc
    }

    func updateUIViewController(_ vc: AVPlayerViewController, context: Context) {
        if vc.player !== player { vc.player = player }
    }
}

/// Save to Photos and the share sheet. Both need the file itself, so they download it first.
@MainActor
enum MediaActions {
    static func download(_ item: MediaItem, name: String) async throws -> URL {
        let (data, resp) = try await API.shared.raw("GET", item.src)
        let mime = resp?.mimeType ?? ""
        let ext = item.video || mime.contains("mp4") ? "mp4"
            : mime.contains("webp") ? "webp"
            : mime.contains("png") ? "png"
            : mime.contains("heic") ? "heic" : "jpg"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).\(ext)")
        try data.write(to: url, options: .atomic)
        return url
    }

    static func saveToPhotos(_ item: MediaItem, name: String) {
        attempt {
            guard await photosAllowed() else { return }
            let file = try await photoFile(item, name: name)
            try await addToPhotos([(file, item.video)])
            AppModel.shared.show(item.video ? "Video saved to Photos" : "Photo saved to Photos")
        }
    }

    /// Every item of a carousel, in order, in one go.
    static func saveAllToPhotos(_ items: [MediaItem], name: String) {
        attempt {
            guard !items.isEmpty, await photosAllowed() else { return }
            AppModel.shared.show("Saving \(items.count)…")
            var files: [(URL, Bool)] = []
            for item in items { files.append((try await photoFile(item, name: "\(name)_\(item.idx)"), item.video)) }
            try await addToPhotos(files)
            AppModel.shared.show("Saved \(items.count) to Photos")
        }
    }

    private static func photosAllowed() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        if status == .authorized || status == .limited { return true }
        AppModel.shared.show("Allow Peek to add photos in Settings")
        return false
    }

    /// The downloaded file, as JPEG if it was WebP: Photos is happiest with JPEG.
    private static func photoFile(_ item: MediaItem, name: String) async throws -> URL {
        let url = try await download(item, name: name)
        guard !item.video, url.pathExtension == "webp",
              let img = UIImage(contentsOfFile: url.path), let jpg = img.jpegData(compressionQuality: 0.95) else { return url }
        let jpgURL = url.deletingPathExtension().appendingPathExtension("jpg")
        try jpg.write(to: jpgURL, options: .atomic)
        return jpgURL
    }

    private static func addToPhotos(_ files: [(URL, Bool)]) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            for (url, isVideo) in files {
                PHAssetCreationRequest.forAsset().addResource(with: isVideo ? .video : .photo, fileURL: url, options: nil)
            }
        }
    }

    static func share(_ item: MediaItem, name: String) {
        attempt {
            let url = try await download(item, name: name)
            present(UIActivityViewController(activityItems: [url], applicationActivities: nil))
        }
    }

    static func share(_ url: URL) {
        present(UIActivityViewController(activityItems: [url], applicationActivities: nil))
    }

    private static func present(_ vc: UIViewController) {
        let root = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?.rootViewController
        var top = root
        while let next = top?.presentedViewController { top = next }
        top?.present(vc, animated: true)
    }
}
