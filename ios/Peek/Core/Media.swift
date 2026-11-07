import AVFoundation
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

/// A video that repeats, for reels and the feed.
final class LoopPlayer {
    let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?

    init?(path: String, muted: Bool) {
        guard let asset = Video.asset(path) else { return nil }
        looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(asset: asset))
        player.isMuted = muted
        player.preventsDisplaySleepDuringVideoPlayback = true
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
            let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard status == .authorized || status == .limited else {
                AppModel.shared.show("Allow Peek to add photos in Settings")
                return
            }
            var url = try await download(item, name: name)
            // Photos is happiest with JPEG; Instagram often serves WebP.
            if !item.video, url.pathExtension == "webp",
               let img = UIImage(contentsOfFile: url.path), let jpg = img.jpegData(compressionQuality: 0.95) {
                let jpgURL = url.deletingPathExtension().appendingPathExtension("jpg")
                try jpg.write(to: jpgURL, options: .atomic)
                url = jpgURL
            }
            let fileURL = url
            let isVideo = item.video
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.forAsset().addResource(with: isVideo ? .video : .photo, fileURL: fileURL, options: nil)
            }
            AppModel.shared.show(isVideo ? "Video saved to Photos" : "Photo saved to Photos")
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
