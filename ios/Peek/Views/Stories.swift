import AVFoundation
import SwiftUI

struct StoriesBar: View {
    let groups: [StoryGroup]
    let open: (Int) -> Void

    private let ring = LinearGradient(colors: [.yellow, .orange, .pink, .purple],
                                      startPoint: .bottomLeading, endPoint: .topTrailing)

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(Array(groups.enumerated()), id: \.element.id) { i, g in
                    Button { open(i) } label: {
                        VStack(spacing: 5) {
                            Avatar(path: g.avatar, size: 62)
                                .padding(3)
                                .overlay {
                                    Circle().strokeBorder(g.allSeen ? AnyShapeStyle(Color.secondary.opacity(0.35)) : AnyShapeStyle(ring),
                                                          lineWidth: 2.5)
                                }
                            Text(g.username)
                                .font(.caption2)
                                .foregroundStyle(g.allSeen ? .secondary : .primary)
                                .lineLimit(1)
                                .frame(width: 72)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
        }
    }
}

struct StoryStart: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Instagram-style story player. Tap right/left for next/previous, hold to pause, pull down to close.
/// Also plays highlights (one group, `seen` unset).
struct StoryViewer: View {
    let groups: [StoryGroup]
    private let onSeen: ([String]) -> Void

    @State private var gi: Int
    @State private var ii: Int
    @State private var progress = 0.0
    @State private var paused = false
    @State private var player: AVPlayer?
    @State private var seen: [String] = []
    @State private var pressStart: Date?
    @State private var holdTask: Task<Void, Never>?
    @State private var dragY: CGFloat = 0
    @AppStorage("muted") private var muted = true
    @Environment(\.dismiss) private var dismiss

    private static let imageSeconds = 5.0
    private let tick = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    init(groups: [StoryGroup], start: Int, onSeen: @escaping ([String]) -> Void = { _ in }) {
        self.groups = groups
        self.onSeen = onSeen
        _gi = State(initialValue: start)
        _ii = State(initialValue: Self.firstUnseen(groups.indices.contains(start) ? groups[start] : nil))
    }

    private static func firstUnseen(_ g: StoryGroup?) -> Int {
        g?.items.firstIndex { $0.seen == false } ?? 0
    }

    private var group: StoryGroup? { groups.indices.contains(gi) ? groups[gi] : nil }
    private var item: StoryItem? {
        guard let g = group, g.items.indices.contains(ii) else { return nil }
        return g.items[ii]
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                Color.black
                media
                    .frame(width: geo.size.width, height: geo.size.height)
                    .contentShape(Rectangle())
                    .gesture(press(width: geo.size.width))
                VStack(spacing: 10) {
                    bars
                    header
                }
                .padding(.horizontal, 10)
                .padding(.top, geo.safeAreaInsets.top + 6)
            }
            .ignoresSafeArea()
        }
        .background(Color.black.ignoresSafeArea())
        .offset(y: dragY)
        .opacity(1 - Double(min(dragY, 300)) / 600)
        .statusBarHidden()
        .onAppear { start() }
        .onChange(of: "\(gi):\(ii)") { start() }
        .onChange(of: paused) { _, p in if p { player?.pause() } else { player?.play() } }
        .onChange(of: muted) { _, m in player?.isMuted = m }
        .onReceive(tick) { _ in advance() }
        .onDisappear {
            player?.pause()
            onSeen(seen)
        }
    }

    @ViewBuilder private var media: some View {
        if let item {
            if item.video, let player {
                PlayerLayerView(player: player)
            } else {
                RemoteImage(path: item.video ? item.poster : item.src, maxPixel: 1800, contentMode: .fit)
            }
        }
    }

    private var bars: some View {
        HStack(spacing: 3) {
            ForEach(Array((group?.items ?? []).indices), id: \.self) { i in
                Capsule()
                    .fill(.white.opacity(0.35))
                    .overlay(alignment: .leading) {
                        GeometryReader { g in
                            Capsule().fill(.white).frame(width: g.size.width * fill(i))
                        }
                    }
                    .frame(height: 2.5)
            }
        }
    }

    private func fill(_ i: Int) -> CGFloat {
        i < ii ? 1 : i == ii ? CGFloat(min(max(progress, 0), 1)) : 0
    }

    private var header: some View {
        HStack(spacing: 8) {
            Avatar(path: group?.avatar, size: 30)
            Text(group?.username ?? "").font(.subheadline.weight(.semibold))
            Text(Fmt.ago(item?.takenAt)).font(.subheadline).opacity(0.7)
            Spacer()
            if item?.video == true {
                Button { muted.toggle() } label: {
                    Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .frame(width: 36, height: 36)
                }
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark").frame(width: 36, height: 36)
            }
        }
        .foregroundStyle(.white)
        .shadow(radius: 3)
    }

    private func press(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                if pressStart == nil {
                    pressStart = Date()
                    holdTask = Task {
                        try? await Task.sleep(for: .milliseconds(220))
                        if !Task.isCancelled { paused = true }
                    }
                }
                dragY = max(0, v.translation.height)
            }
            .onEnded { v in
                holdTask?.cancel()
                let held = Date().timeIntervalSince(pressStart ?? Date())
                pressStart = nil
                paused = false
                if v.translation.height > 110 {
                    dismiss()
                    return
                }
                withAnimation(.snappy) { dragY = 0 }
                let tap = held < 0.25 && abs(v.translation.width) < 20 && abs(v.translation.height) < 20
                if tap { v.location.x < width / 3 ? previous() : next() }
            }
    }

    private func start() {
        player?.pause()
        player = nil
        progress = 0
        guard let item else { return }
        if !seen.contains(item.id) { seen.append(item.id) }
        if item.video, let src = item.src, let p = Video.player(src, muted: muted) {
            player = p
            if !paused { p.play() }
        }
    }

    private func advance() {
        guard !paused, let item else { return }
        if item.video {
            guard let p = player, let current = p.currentItem else { return }
            if current.status == .failed { next(); return }
            let d = current.duration.seconds
            guard d.isFinite, d > 0 else { return }
            progress = p.currentTime().seconds / d
            if progress >= 0.99 { next() }
        } else {
            progress += 0.05 / Self.imageSeconds
            if progress >= 1 { next() }
        }
    }

    private func next() {
        if let g = group, ii + 1 < g.items.count {
            ii += 1
        } else if gi + 1 < groups.count {
            ii = Self.firstUnseen(groups[gi + 1])
            gi += 1
        } else {
            dismiss()
        }
    }

    private func previous() {
        if ii > 0 {
            ii -= 1
        } else if gi > 0 {
            gi -= 1
            ii = 0
        } else {
            start()
        }
    }
}
