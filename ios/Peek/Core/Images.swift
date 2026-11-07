import ImageIO
import SwiftUI
import UIKit

/// Decoded images in memory, keyed by path and size. Bytes live in API's URLCache on disk.
final class ImageCache {
    static let shared = ImageCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() { cache.totalCostLimit = 200 << 20 }

    func get(_ key: String) -> UIImage? { cache.object(forKey: key as NSString) }

    func set(_ image: UIImage, _ key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    func clear() {
        cache.removeAllObjects()
        API.shared.session.configuration.urlCache?.removeAllCachedResponses()
    }
}

enum ImageLoader {
    static func key(_ path: String, _ maxPixel: CGFloat) -> String { "\(path)@\(Int(maxPixel))" }

    static func cached(_ path: String, _ maxPixel: CGFloat) -> UIImage? {
        ImageCache.shared.get(key(path, maxPixel))
    }

    /// Downloads (or reads from the URL cache) and decodes at no more than `maxPixel` on the
    /// long side: Instagram originals are 1-3 MB, far bigger than a phone needs.
    static func load(_ path: String, maxPixel: CGFloat) async throws -> UIImage {
        let k = key(path, maxPixel)
        if let hit = ImageCache.shared.get(k) { return hit }
        let (data, _) = try await API.shared.raw("GET", path)
        let image = try await Task.detached(priority: .userInitiated) {
            try downsample(data, maxPixel: maxPixel)
        }.value
        ImageCache.shared.set(image, k)
        return image
    }

    static func downsample(_ data: Data, maxPixel: CGFloat) throws -> UIImage {
        let srcOpts = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let src = CGImageSourceCreateWithData(data as CFData, srcOpts) else {
            throw APIError.http(0, "Not an image")
        }
        let opts = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts) else {
            throw APIError.http(0, "Couldn't decode the image")
        }
        return UIImage(cgImage: cg)
    }
}

/// An image from the Peek server. Always takes the size it's offered and crops (fill) or
/// letterboxes (fit) inside it, so give it a frame.
struct RemoteImage: View {
    let path: String?
    var maxPixel: CGFloat = 1400
    var contentMode: ContentMode = .fill
    var onLoad: ((CGSize) -> Void)? = nil

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                } else {
                    Rectangle().fill(Color(.secondarySystemBackground))
                        .overlay {
                            if failed {
                                Image(systemName: "photo").foregroundStyle(.tertiary)
                            }
                        }
                }
            }
            .clipped()
            .task(id: path) { await load() }
    }

    private func load() async {
        guard let path else { return }
        if let hit = ImageLoader.cached(path, maxPixel) {
            image = hit
            onLoad?(hit.size)
            return
        }
        image = nil
        failed = false
        do {
            let img = try await ImageLoader.load(path, maxPixel: maxPixel)
            image = img
            onLoad?(img.size)
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

struct Avatar: View {
    let path: String?
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let path {
                RemoteImage(path: path, maxPixel: size * 3)
            } else {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}
