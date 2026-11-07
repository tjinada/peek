# Peek for iPhone

A native SwiftUI client for the Peek server. It reads the same API as the web app, so the
server stays the source of truth: refreshes, the burner session and storage all live there.

## Build and install

1. On the Mac: `git pull`, then open `ios/Peek.xcodeproj` (Xcode 16 or newer).
2. Signing lives in `ios/Local.xcconfig`, which git ignores, so pulls never clash with it.
   Create it once:
   ```
   DEVELOPMENT_TEAM = ABCDE12345
   // PEEK_BUNDLE_ID = com.yourname.peek   (only if com.tjinada.peek is taken for your team)
   ```
   Your team ID is in Xcode → Settings → Accounts → your team, or developer.apple.com →
   Membership. Don't pick the team in *Signing & Capabilities*: that writes it into the
   project file instead. The share extension's id follows automatically (`<id>.share`).
3. Plug in the iPhone (or pick it over Wi-Fi), choose it as the run destination, press ⌘R.
   The first time, iOS asks you to trust the developer: *Settings → General → VPN & Device
   Management*.

With a free Apple ID the install expires after 7 days (just run it again from Xcode). A paid
developer account gives a year, or TestFlight.

No packages, no build scripts: every `.swift` file under `ios/Peek/` is picked up automatically
(the project uses a synchronized folder), so new files don't need adding in Xcode.

## Pointing it at the server

On first launch, enter the address you'd use in a browser:

- **Tailscale (recommended away from home):** `tailscale serve --bg --https=443 http://localhost:8642`
  on the Unraid box gives `https://<machine>.<tailnet>.ts.net`.
- **Home network:** `http://192.168.x.x:8642`. iOS asks for Local Network access the first time.

If the server has `PEEK_PASSWORD` set, the app asks for it once and keeps the server's cookie.

## What's in it

| Tab | Server endpoints |
| --- | --- |
| Feed — stories bar, posts, group filter, "new posts" pill, caught-up marker | `/api/feed`, `/api/feed/new`, `/api/feed/seen`, `/api/stories` |
| Reels — vertical pager, next reel preloads | `/api/feed?kind=reels` |
| Search — open any @username, saved accounts and captions, Instagram suggestions | `/api/search`, `/api/search/instagram` |
| Saved | `/api/saved` |
| Following — sort, group filter, swipe to mute/unfollow, groups, settings | `/api/accounts`, `/api/groups`, `/api/status`, `/api/settings/refresh` |

Profiles (`/api/u/...`) cover posts/reels grids, "load older", highlights, follow, mute and
groups. Also: pinch/double-tap zoom, save to Photos, and the share sheet.

**Share sheet:** in Instagram (or Safari, Messages…) tap Share → **Peek** to open that
profile or post in the app. If Peek is missing from the row, scroll it to the end → More →
add it. Posts Peek hasn't seen are fetched by the server the first time (needs the server
from this branch).

**Face ID lock:** Settings → This phone → Lock with Face ID. Also hides the app switcher
snapshot.

Burner session management (pasting cookies, policy) stays in the web app; the app links to it
from Settings and shows when the session has expired.

## CI

`.github/workflows/ios.yml` builds the app for the simulator (unsigned) on every push that
touches `ios/`, so compile errors show up without a Mac.
