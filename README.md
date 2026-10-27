# Peek

A private, self-hosted way to scroll public Instagram accounts without an account.
You keep a follow list; Peek checks those accounts every few hours, saves their posts,
reels and (optionally) stories to disk, and serves them as an installable web app.

## Run it

```bash
cp .env.example .env
docker compose up -d --build
# open http://<server>:8642 and add a few usernames under Following
```

Without Docker:

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8642
```

Everything lives in `./data`: `peek.db` (SQLite) and `media/<username>/…`.
On a phone, open the page and use "Add to Home Screen" to install it.

## How it behaves

- **Following** accounts refresh in the background every `PEEK_REFRESH_HOURS` (±20% jitter),
  one at a time with a 20–60s gap. If Instagram rate-limits, the rest of that cycle is skipped.
- **Older posts:** each refresh only checks for new posts. To go further back, scroll to the
  bottom of a profile and tap **Load older posts**; each tap pulls the next 12 from Instagram
  and remembers where it stopped, so repeated taps walk back through the whole history.
- **Look up** opens any public profile. A cached profile shows instantly; a stale one is
  re-fetched in the background while you look at the old copy.
- Media is downloaded when fetched, because Instagram's CDN links expire. Videos are
  usually 2–20 MB each, so budget disk accordingly. Unfollow offers to delete saved media.
- Stories are kept for 7 days after they expire, then cleaned up.

## Logged out vs burner session

| | Logged out | Burner session |
|---|---|---|
| Public posts & reels | Grid in 1 request per 12 posts; details fill in over time | Full posts, 12 per request |
| Stories | No | Yes |
| Risk | Occasional login walls | Burner may get flagged or banned |

To add a burner session: sign in to a throwaway account in a browser, open dev tools →
Application → Cookies → `instagram.com`, copy the `sessionid` value, then set in `.env`:

```
IG_USER=your_burner_username
IG_SESSIONID=<paste>
```

Restart the container. The Following page will say "Stories are on" once it's working.
If the session expires, Peek falls back to logged-out behaviour; paste a fresh cookie.

## Notes

- Set `PEEK_PASSWORD` if you expose it beyond your LAN.
- Keep the follow list modest (tens, not hundreds) and the refresh interval at a few
  hours. That's what keeps a home IP off Instagram's radar.
- Instagram changes its internal API now and then. When fetches start failing across the
  board, `pip install -U instaloader` (or rebuild the image) is usually the fix.
