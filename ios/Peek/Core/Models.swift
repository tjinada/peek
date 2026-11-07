import Foundation

// Shapes of the Peek server's JSON (app/main.py). Decoded with convertFromSnakeCase, so
// `taken_at` arrives as `takenAt`. Only the fields the app uses are declared.

struct MediaItem: Decodable, Hashable, Identifiable {
    let idx: Int
    let video: Bool
    let src: String
    let poster: String
    var id: Int { idx }
}

struct Post: Decodable, Hashable, Identifiable {
    let shortcode: String
    let username: String
    let takenAt: Double
    let kind: String            // image | video | carousel | reel
    let caption: String?
    let likes: Int?
    let comments: Int?
    let thumb: String?
    let detailed: Bool?
    let saved: Bool
    let savedSlides: [Int]
    let media: [MediaItem]
    let avatar: String?
    let fullName: String?
    let slide: Int?             // Saved: a single photo of a carousel

    var id: String { slide.map { "\(shortcode)#\($0)" } ?? shortcode }
    var isVideo: Bool { kind == "reel" || kind == "video" }
    var firstVideo: MediaItem? { media.first(where: \.video) }
    var needsDetail: Bool { detailed == false || media.isEmpty }
    var instagramURL: URL? { URL(string: "https://www.instagram.com/p/\(shortcode)/") }
}

struct Account: Decodable, Hashable, Identifiable {
    let username: String
    let fullName: String?
    let bio: String?
    let avatar: String?
    let followers: Int?
    let following: Int?
    let postCount: Int?
    let isPrivate: Bool?
    let followed: Bool?
    let muted: Bool?
    let busy: Bool?
    let restricted: Bool?
    let historyDone: Bool?
    let reelsDone: Int?
    let lastError: String?
    let fetchedAt: Double?
    let cached: Int?
    let reelsTab: Bool?
    let groups: [Int]?
    let unread: Int?
    let latestPost: Double?
    let followedAt: Double?
    var id: String { username }
}

struct StoryItem: Decodable, Hashable, Identifiable {
    let id: String
    let video: Bool
    let src: String?
    let poster: String?
    let takenAt: Double
    let seen: Bool?
}

struct StoryGroup: Decodable, Hashable, Identifiable {
    let username: String
    let avatar: String?
    let items: [StoryItem]
    let allSeen: Bool
    var id: String { username }
}

struct Highlight: Decodable, Hashable, Identifiable {
    let id: String
    let title: String?
    let cover: String
}

struct PeekGroup: Decodable, Hashable, Identifiable {
    let id: Int
    let name: String
    let count: Int?
}

struct SessionInfo: Decodable, Hashable {
    let configured: Bool
    let state: String           // ok | unchecked | dead | none
    let username: String?
    let error: String?
    let policy: String?
    let budgetLeft: Double?
    let budgetTotal: Double?
}

struct Status: Decodable {
    let loggedIn: Bool
    let session: SessionInfo
    let password: Bool
    let refreshHours: Double
    let lastFetch: Double?
    let lastCycle: Double?
    let nextCycle: Double?
    let cycleRunning: Bool
    let scheduler: String?      // ok | overdue | stopped
    let pausedUntil: Double?
    let following: Int
    let posts: Int
    let stories: Int
}

struct IGUser: Decodable, Hashable, Identifiable {
    let username: String
    let fullName: String?
    let verified: Bool?
    let followers: Int?
    let followed: Bool?
    let avatar: String?
    var id: String { username }
}

// MARK: responses

struct FeedResponse: Decodable { let posts: [Post]; let next: Double?; let seenAt: Double? }
struct FeedNew: Decodable { let count: Int; let refreshing: Bool }
struct StoriesResponse: Decodable { let groups: [StoryGroup]; let enabled: Bool }
struct ProfileResponse: Decodable { let account: Account; let posts: [Post]; let next: Double? }
struct OlderResponse: Decodable { let added: Int?; let done: Bool?; let note: String?; let posts: [Post] }
struct HighlightsResponse: Decodable { let enabled: Bool; let note: String?; let highlights: [Highlight] }
struct HighlightItems: Decodable { let items: [StoryItem] }
struct AccountsResponse: Decodable { let accounts: [Account] }
struct GroupsResponse: Decodable { let groups: [PeekGroup] }
struct SearchResponse: Decodable { let accounts: [Account]; let posts: [Post] }
struct IGSearchResponse: Decodable { let status: String; let message: String?; let users: [IGUser] }
struct SavedResponse: Decodable { let posts: [Post]; let next: Double?; let count: Int }
struct RefreshAllResponse: Decodable { let count: Int?; let already: Bool? }

/// Navigation targets shared by every tab.
enum Route: Hashable {
    case profile(String)
    case posts(PostList)
    case search(String)
}

/// A list of posts opened at one of them (tapping a grid tile).
struct PostList: Hashable {
    let posts: [Post]
    let start: String
    let title: String
}
