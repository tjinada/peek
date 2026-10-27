"""Everything that talks to Instagram lives here. Instaloader does the protocol work;
this module maps its objects into the cache and downloads media to disk (Instagram's
CDN URLs are signed and expire, so a local copy is the only thing that lasts).
Metadata is stored first; files download in a parallel pool afterwards."""
import json
from pathlib import Path
import logging
import random
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import instaloader
from PIL import Image
from instaloader.exceptions import (
    ConnectionException,
    LoginRequiredException,
    ProfileNotExistsException,
    QueryReturnedNotFoundException,
    TooManyRequestsException,
)
from instaloader.nodeiterator import FrozenNodeIterator

from . import db
from .config import IG_CSRFTOKEN, IG_SESSIONID, IG_USER, MAX_POSTS, MEDIA_DIR

log = logging.getLogger("peek.fetcher")

# Instaloader isn't thread-safe and Instagram notices parallel requests, so every
# call goes through one lock. Throughput doesn't matter for a single user.
_lock = threading.Lock()
_busy: set[str] = set()

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
_http = httpx.Client(headers={"User-Agent": UA}, timeout=60, follow_redirects=True)


class FetchError(Exception):
    pass


# ---------------------------------------------------------------- rate limits
# Instaloader's own reaction to a 429 is to sleep 10+ minutes inside the request. Here that
# would hold the global lock, freezing every refresh, hydration and "load older" while the
# UI spins. Instead: fail fast, and pause all Instagram API calls until the window passes.

COOLDOWN_MIN = 15 * 60
_cooldown_until = 0.0


MAX_INLINE_WAIT = 5  # seconds Instaloader may pause between requests while we hold the lock


class _PauseOn429(instaloader.RateController):
    """Instaloader's limiter sleeps silently (we run it quiet) whenever it thinks we're near
    Instagram's limits, for up to ~11 minutes, and it does so inside the request while Peek
    holds its one Instagram lock. Short waits are fine; anything longer becomes a visible
    pause instead, and a real 429 pauses everything for COOLDOWN_MIN."""

    def wait_before_query(self, query_type: str) -> None:
        try:
            wait = self.query_waittime(query_type, time.monotonic(), False)
        except Exception:
            wait = 0.0
        if wait > MAX_INLINE_WAIT:
            _start_cooldown(wait, f"staying under Instagram's request limits ({query_type})")
            raise TooManyRequestsException("Paused to stay under Instagram's limits")
        super().wait_before_query(query_type)

    def handle_429(self, query_type: str) -> None:
        # Don't use query_waittime here: with untracked=True it also arms Instaloader's own
        # "earliest next request" timer, which is what caused the silent 11-minute sleeps.
        if getattr(_probe, "on", False):
            # A one-off lookup endpoint refused us. Instagram answers some endpoints with 429
            # as a flat "no" even when we're nowhere near a limit, so this doesn't pause the rest.
            raise TooManyRequestsException("429 Too Many Requests (lookup refused)")
        _start_cooldown(COOLDOWN_MIN, f"Instagram returned 429 ({query_type})")
        raise TooManyRequestsException("429 Too Many Requests")


_probe = threading.local()


def _start_cooldown(seconds: float, why: str):
    global _cooldown_until
    _cooldown_until = max(_cooldown_until, time.time() + seconds)
    log.warning("pausing Instagram requests until %s: %s",
                time.strftime("%H:%M", time.localtime(_cooldown_until)), why)


def cooldown_until() -> float | None:
    return _cooldown_until if _cooldown_until > time.time() else None


def _check_cooldown():
    if _cooldown_until > time.time():
        raise FetchError("Instagram is rate-limiting requests; paused until "
                         + time.strftime("%H:%M", time.localtime(_cooldown_until)))


def _make_loader() -> instaloader.Instaloader:
    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
        max_connection_attempts=2,
        request_timeout=30,
        user_agent=UA,
        rate_controller=_PauseOn429,
    )
    # A bad session must never stop the app from starting: fall back to logged out.
    try:
        if IG_USER and IG_SESSIONID:
            L.load_session(IG_USER, {
                "sessionid": IG_SESSIONID,
                "ds_user_id": IG_SESSIONID.split("%3A")[0],
                # Instaloader sends this back as the X-CSRFToken header. Instagram only checks
                # that cookie and header match, so a random one works if none was copied.
                "csrftoken": IG_CSRFTOKEN or secrets.token_hex(16),
            })
            log.info("using session for %s", IG_USER)
        elif IG_USER:
            L.load_session_from_file(IG_USER)
            log.info("loaded session file for %s", IG_USER)
    except FileNotFoundError:
        log.warning("IG_USER set but no IG_SESSIONID or session file; running logged out")
    except Exception as e:
        log.error("couldn't load the Instagram session (%s); running logged out", e)
        return _make_loader_plain()
    return L


def _make_loader_plain() -> instaloader.Instaloader:
    return instaloader.Instaloader(
        download_pictures=False, download_videos=False, download_video_thumbnails=False,
        save_metadata=False, compress_json=False, quiet=True, max_connection_attempts=2,
        request_timeout=30, user_agent=UA, rate_controller=_PauseOn429,
    )


L = _make_loader()

# Instaloader pauses a random 0-15s (about 1.7s on average) before every Instagram request.
# Peek already makes one request at a time, spaces out background work, and pauses on 429s,
# so a short pause is enough and makes lookups and "Load older" much quicker.
REQUEST_PAUSE = (0.3, 1.0)
L.context.do_sleep = lambda: time.sleep(random.uniform(*REQUEST_PAUSE))


class LookupRefused(Exception):
    pass


def _get_profile(username: str) -> instaloader.Profile:
    """Instaloader looks a profile up via its public web page, which shows what a logged-out
    visitor sees. Age- and region-restricted profiles aren't on that page at all, so with a
    burner session we look them up the way the Instagram app does, as that session."""
    try:
        return instaloader.Profile.from_username(L.context, username)
    except ProfileNotExistsException:
        if not logged_in():
            raise
    log.info("%s: not on the public page; looking it up as the burner via the app API", username)
    refused = []
    _probe.on = True
    try:
        for name, fetch in (
            ("app API", lambda: L.context.get_iphone_json("api/v1/users/web_profile_info/", {"username": username})),
            ("web API", lambda: L.context.get_json("api/v1/users/web_profile_info/", params={"username": username})),
        ):
            try:
                data = fetch()
            except Exception as e:
                why = "refused (429)" if "429" in str(e) else str(e)[:120]
                log.warning("%s: %s lookup %s", username, name, why)
                refused.append(name)
                continue
            user = (data.get("data") or {}).get("user") if isinstance(data, dict) else None
            if user:
                log.info("%s: found via the %s", username, name)
                p = instaloader.Profile(L.context, user)
                p._has_full_metadata = True  # this response is the full profile
                return p
            log.warning("%s: %s returned no profile", username, name)
    finally:
        _probe.on = False
    if refused:
        raise LookupRefused("Instagram wouldn't return this profile to the burner's session right now")
    raise ProfileNotExistsException(f"Profile {username} does not exist.")


def logged_in() -> bool:
    return L.context.is_logged_in


def is_busy(username: str) -> bool:
    return username in _busy


# ---------------------------------------------------------------- media download


_MAGIC = ((b"\xff\xd8\xff", "jpg"), (b"\x89PNG", "png"), (b"GIF8", "gif"))
MIME = {"jpg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp",
        "heic": "image/heic", "mp4": "video/mp4"}


def sniff(path: Path) -> str | None:
    """Real file type from the first bytes. Instagram serves some images as WebP (or HEIC)
    whatever the URL suggests, so the extension can't be trusted."""
    try:
        with open(path, "rb") as f:
            head = f.read(16)
    except OSError:
        return None
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[4:8] == b"ftyp":
        return "heic" if head[8:12] in (b"heic", b"heix", b"mif1", b"msf1") else "mp4"
    for magic, ext in _MAGIC:
        if head.startswith(magic):
            return ext
    return None


def fix_ext(rel: str) -> str:
    """Rename an image whose extension doesn't match its content. Returns the (new) rel."""
    path = MEDIA_DIR / rel
    real = sniff(path)
    stem, _, ext = rel.rpartition(".")
    if not real or real == ext or real == "mp4" or ext == "mp4":
        return rel
    new = f"{stem}.{real}"
    try:
        path.replace(MEDIA_DIR / new)
    except OSError as e:
        log.warning("couldn't rename %s: %s", rel, e)
        return rel
    return new


def _save(url: str | None, rel: str, force: bool = False, fix: bool = False) -> str | None:
    """Download url to MEDIA_DIR/rel unless it's already there. Returns the saved rel or None.
    fix=True renames the file to its real extension (rel may come back changed)."""
    if not url:
        return None
    dest = MEDIA_DIR / rel
    if not force and dest.exists() and dest.stat().st_size > 0:
        return rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with _http.stream("GET", url) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 16):
                    f.write(chunk)
        tmp.replace(dest)
        return fix_ext(rel) if fix else rel
    except Exception as e:  # a missing image shouldn't sink the whole refresh
        log.warning("download failed %s: %s", rel, e)
        tmp.unlink(missing_ok=True)
        return None


# ---------------------------------------------------------------- profile + posts


def _kind(post: instaloader.Post) -> str:
    if post.typename == "GraphSidecar":
        return "carousel"
    if post.is_video:
        return "reel" if getattr(post, "product_type", "") == "clips" else "video"
    return "image"


def _store_post(username: str, post: instaloader.Post, replace: bool = False) -> bool:
    """Cache one post's metadata and its media *source URLs*. No downloading here, so a
    profile's whole grid lands in the DB in one go; files are pulled by the download
    pool (or on demand when the browser asks first). Returns False if already cached."""
    sc = post.shortcode
    if not replace and db.one("SELECT shortcode FROM posts WHERE shortcode=?", (sc,)):
        # refresh counters only; media is immutable
        db.execute("UPDATE posts SET likes=?, comments=? WHERE shortcode=?", (post.likes, _comments(post), sc))
        return False

    items = []
    if post.typename == "GraphSidecar":
        for i, node in enumerate(post.get_sidecar_nodes()):
            items.append((i, node.is_video, node.video_url if node.is_video else node.display_url, node.display_url))
    else:
        items.append((0, post.is_video, post.video_url if post.is_video else post.url, post.url))

    with db.conn() as c:
        c.executemany(
            "INSERT OR REPLACE INTO media (shortcode, idx, is_video, path, poster, url, poster_url) "
            "VALUES (?,?,?,NULL,NULL,?,?)",
            [(sc, i, int(v), src, poster) for i, v, src, poster in items],
        )
        c.execute(
            """INSERT INTO posts (shortcode, username, taken_at, kind, caption, likes, comments, detailed)
               VALUES (?,?,?,?,?,?,?,1)
               ON CONFLICT(shortcode) DO UPDATE SET taken_at=excluded.taken_at, kind=excluded.kind,
                 caption=excluded.caption, likes=excluded.likes, comments=excluded.comments, detailed=1""",
            (sc, username, post.date_utc.timestamp(), _kind(post), post.caption or "", post.likes, _comments(post)),
        )
    return True


# ---------------------------------------------------------------- stubs (logged out)
# Logged out, a page of 12 posts arrives with shortcode, type, caption and a 360px cover,
# but no carousel items, video file, likes or date. Turning each into a full Post costs one
# request per post, so we store a stub straight away (the grid shows instantly) and the
# hydrator fills in details in the background, or immediately when a post is opened.

_STUB_KIND = {1: "image", 8: "carousel"}
IG_EPOCH_MS = 1314220021721  # media IDs carry their creation time in the top bits


def _store_stub(username: str, node: dict) -> bool:
    sc = node["code"]
    mt = node.get("media_type")
    kind = _STUB_KIND.get(mt) or ("reel" if node.get("product_type") == "clips" else "video")
    try:
        taken = ((int(node["pk"]) >> 23) + IG_EPOCH_MS) / 1000
    except (KeyError, ValueError, TypeError):
        taken = time.time()
    caption = (node.get("caption") or {}).get("text") or ""
    with db.conn() as c:
        cur = c.execute(
            """INSERT OR IGNORE INTO posts (shortcode, username, taken_at, kind, caption, thumb_url, detailed)
               VALUES (?,?,?,?,?,?,0)""",
            (sc, username, taken, kind, caption, node.get("display_uri")),
        )
    _hydrate_wake.set()
    return cur.rowcount > 0


def _store_node(username: str, node: dict, post, wrap) -> None:
    """Store a post from a walk using the cheapest complete-enough source."""
    if post is not None:
        _store_post(username, post)
    elif "taken_at" in node and ("image_versions2" in node or "carousel_media" in node):
        _store_iphone(username, node)  # logged-in page data is complete: no extra request
    elif logged_in():
        _store_post(username, wrap(node))
    else:
        _store_stub(username, node)


def _best(cands: list | None) -> str | None:
    """Largest image/video version."""
    cands = [c for c in (cands or []) if c.get("url")]
    return max(cands, key=lambda c: c.get("width") or 0)["url"] if cands else None


def _small(cands: list | None, want: int = 320) -> str | None:
    """Smallest version at least `want` px wide (or the largest if none is that big)."""
    cands = [c for c in (cands or []) if c.get("url")]
    big_enough = [c for c in cands if (c.get("width") or 0) >= want]
    pool = big_enough or cands
    if not pool:
        return None
    return (min if big_enough else max)(pool, key=lambda c: c.get("width") or 0)["url"]


def _store_iphone(username: str, node: dict) -> bool:
    """Store a post straight from the logged-in timeline's data. Going through Instaloader's
    Post here costs a hidden extra request per post (its comment count isn't in this data,
    so it fetches the full post just for that)."""
    sc = node["code"]
    if _cached(sc):
        return False
    items = node.get("carousel_media") or [node]
    rows = []
    for i, m in enumerate(items):
        imgs = (m.get("image_versions2") or {}).get("candidates")
        is_video = m.get("media_type") == 2 or bool(m.get("video_versions"))
        src = _best(m.get("video_versions")) if is_video else _best(imgs)
        rows.append((sc, i, int(is_video), src, _best(imgs)))
    mt = node.get("media_type")
    kind = "carousel" if mt == 8 else ("reel" if node.get("product_type") == "clips" else "video") if mt == 2 else "image"
    cover = _small((items[0].get("image_versions2") or {}).get("candidates"))
    with db.conn() as c:
        c.executemany(
            "INSERT OR REPLACE INTO media (shortcode, idx, is_video, path, poster, url, poster_url) "
            "VALUES (?,?,?,NULL,NULL,?,?)", rows)
        c.execute(
            """INSERT OR IGNORE INTO posts (shortcode, username, taken_at, kind, caption, likes, comments,
                                            thumb_url, detailed) VALUES (?,?,?,?,?,?,?,?,1)""",
            (sc, username, float(node["taken_at"]), kind, (node.get("caption") or {}).get("text") or "",
             node.get("like_count"), node.get("comment_count"), cover))
    return True


def _comments(post: instaloader.Post):
    """Comment count without letting Instaloader fetch the whole post to find it."""
    n = post._node
    if isinstance(n.get("comments"), int):
        return n["comments"]
    for key in ("edge_media_to_comment", "edge_media_to_parent_comment"):
        if isinstance(n.get(key), dict) and "count" in n[key]:
            return n[key]["count"]
    return None


def hydrate(sc: str) -> bool:
    """Fetch full details for a stub post (one Instagram request). Returns True if done."""
    row = db.one("SELECT username, detailed FROM posts WHERE shortcode=?", (sc,))
    if not row or row["detailed"] == 1:
        return bool(row)
    _check_cooldown()
    with _lock:
        if db.one("SELECT detailed FROM posts WHERE shortcode=?", (sc,))["detailed"] == 1:
            return True
        try:
            post = instaloader.Post.from_shortcode(L.context, sc)
        except (QueryReturnedNotFoundException, instaloader.exceptions.BadResponseException):
            db.execute("UPDATE posts SET detailed=-1 WHERE shortcode=?", (sc,))  # deleted or unavailable
            return False
        _store_post(row["username"], post, replace=True)
    queue_downloads(row["username"], only=sc)
    return True


_hydrate_wake = threading.Event()


def hydrator_loop():
    """Background thread: fill in stubs one at a time, followed accounts and newest first."""
    while True:
        row = db.one(
            """SELECT p.shortcode FROM posts p LEFT JOIN accounts a ON a.username = p.username
               WHERE p.detailed = 0 ORDER BY COALESCE(a.followed, 0) DESC, p.taken_at DESC LIMIT 1""")
        if not row:
            _hydrate_wake.clear()
            _hydrate_wake.wait(300)
            continue
        if cooldown_until():
            time.sleep(max(5, _cooldown_until - time.time()))
            continue
        try:
            hydrate(row["shortcode"])
            time.sleep(random.uniform(15, 30))  # background work: stay well under the limits
        except Exception as e:
            log.warning("hydrate %s failed: %s; pausing", row["shortcode"], e)
            time.sleep(60)


# ---------------------------------------------------------------- media pool
# Downloads hit Instagram's CDN, not its API, so they can run in parallel and outside
# the Instaloader lock. Posters/images are queued before videos so grids fill first.

_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="peek-dl")
_file_locks: dict[str, threading.Lock] = {}
_file_locks_guard = threading.Lock()


def _file_lock(key: str) -> threading.Lock:
    with _file_locks_guard:
        return _file_locks.setdefault(key, threading.Lock())


def media_rel(username: str, sc: str, idx: int, is_video: bool, poster: bool) -> str:
    if poster and is_video:
        return f"{username}/{sc}_{idx}_poster.jpg"
    return f"{username}/{sc}_{idx}.{'mp4' if is_video else 'jpg'}"


def ensure_local(sc: str, idx: int, poster: bool) -> str | None:
    """Return the local path for one media file, downloading it now if needed.
    Safe to call from the pool and from request handlers at the same time."""
    row = db.one(
        "SELECT m.*, p.username FROM media m JOIN posts p ON p.shortcode = m.shortcode "
        "WHERE m.shortcode=? AND m.idx=?", (sc, idx))
    if not row:
        return None
    video = bool(row["is_video"])
    col = "poster" if (poster and video) else "path"
    if row[col] and (MEDIA_DIR / row[col]).exists():
        if video or not row[col].endswith(".jpg"):
            return row[col]
        rel = row[col]  # saved before extensions were checked: fix it once below
        with _file_lock(rel):
            rel = fix_ext(rel)
    else:
        rel = media_rel(row["username"], sc, idx, video, poster)
        with _file_lock(rel):
            if not (MEDIA_DIR / rel).exists():
                rel = _save(row["poster_url"] if col == "poster" else row["url"], rel, fix=not video)
                if not rel:
                    return None
    if rel != row[col]:
        if video:
            db.execute(f"UPDATE media SET {col}=? WHERE shortcode=? AND idx=?", (rel, sc, idx))
        else:  # an image is its own poster
            db.execute("UPDATE media SET path=?, poster=? WHERE shortcode=? AND idx=?", (rel, rel, sc, idx))
    if idx == 0 and (poster or not video):
        db.execute("UPDATE posts SET thumb=? WHERE shortcode=?", (rel, sc))
    return rel


THUMB_SIZE = (480, 600)


def ensure_thumb(sc: str, idx: int) -> str | None:
    """A small JPEG for grid tiles. Uses the profile page's 360px cover when we have it
    (one ~20 KB download), otherwise shrinks the poster/image once. Kept on disk."""
    if idx == 0:
        row = db.one("SELECT username, thumb_url FROM posts WHERE shortcode=?", (sc,))
        if row and row["thumb_url"]:
            rel = f"{row['username']}/{sc}_0_thumb.jpg"
            if (MEDIA_DIR / rel).exists():
                return rel
            with _file_lock(rel):
                if (MEDIA_DIR / rel).exists() or _save(row["thumb_url"], rel):
                    return rel
    src = ensure_local(sc, idx, poster=True)
    if not src:
        return None
    rel = src.rsplit(".", 1)[0].removesuffix("_poster") + "_thumb.jpg"
    dest = MEDIA_DIR / rel
    if dest.exists():
        return rel
    with _file_lock(rel):
        if not dest.exists():
            try:
                with Image.open(MEDIA_DIR / src) as im:
                    im = im.convert("RGB")
                    im.thumbnail(THUMB_SIZE)
                    tmp = dest.with_suffix(".part")
                    im.save(tmp, "JPEG", quality=80, optimize=True)
                    tmp.replace(dest)
            except Exception as e:
                log.warning("thumbnail failed %s: %s", rel, e)
                return src  # fall back to the full image
    return rel


def queue_downloads(username: str, only: str | None = None):
    """Queue every not-yet-downloaded file for an account (or just one post): thumbnails
    first, then the rest of the images, then videos."""
    rows = db.rows(
        "SELECT m.shortcode, m.idx, m.is_video, m.path, m.poster FROM media m "
        "JOIN posts p ON p.shortcode = m.shortcode WHERE p.username=? AND (? IS NULL OR p.shortcode=?) "
        "ORDER BY p.taken_at DESC", (username, only, only))
    first, images, videos = [], [], []
    for r in rows:
        if r["is_video"]:
            if not r["poster"]:
                first.append((r["shortcode"], r["idx"], True))
            if not r["path"]:
                videos.append((r["shortcode"], r["idx"], False))
        elif not r["path"]:
            (first if r["idx"] == 0 else images).append((r["shortcode"], r["idx"], False))
    # stubs have no media rows yet, only a cover: fetch those covers first
    for r in db.rows("SELECT shortcode FROM posts WHERE username=? AND thumb_url IS NOT NULL "
                     "AND (? IS NULL OR shortcode=?) ORDER BY taken_at DESC", (username, only, only)):
        if not (MEDIA_DIR / f"{username}/{r['shortcode']}_0_thumb.jpg").exists():
            _pool.submit(_safe_thumb, r["shortcode"], 0)
    for sc, idx, poster in first:
        _pool.submit(_safe_thumb, sc, idx)
    for job in images + videos:
        _pool.submit(_safe_ensure, *job)
    return len(first) + len(images) + len(videos)


def _safe_thumb(sc, idx):
    try:
        ensure_thumb(sc, idx)
    except Exception as e:
        log.warning("thumbnail job %s/%s failed: %s", sc, idx, e)


def _safe_ensure(sc, idx, poster):
    try:
        ensure_local(sc, idx, poster)
    except Exception as e:
        log.warning("download job %s/%s failed: %s", sc, idx, e)


def refresh_profile(username: str, with_stories: bool = True) -> dict:
    """Fetch profile + recent posts (+ stories when logged in). Raises FetchError.
    Returns once metadata is cached; media keeps downloading in the background."""
    username = username.lower().lstrip("@").strip()
    _check_cooldown()
    with _lock:
        _busy.add(username)
        db.execute("INSERT INTO accounts (username, tried_at) VALUES (?,?) "
                   "ON CONFLICT(username) DO UPDATE SET tried_at=excluded.tried_at", (username, time.time()))
        try:
            res = _refresh_locked(username, with_stories)
        finally:
            _busy.discard(username)
    res["queued"] = queue_downloads(username)
    return res


def _refresh_locked(username: str, with_stories: bool) -> dict:
    try:
        p = _get_profile(username)
    except ProfileNotExistsException:
        msg = ("Not found, or restricted and hidden from the burner" if logged_in()
               else "Not found, or restricted (age/region) and hidden without a login")
        _record_error(username, msg)
        raise FetchError(msg)
    except LookupRefused as e:
        _record_error(username, str(e))
        raise FetchError(str(e))
    except (LoginRequiredException, ConnectionException) as e:
        msg = _friendly(e)
        _record_error(username, msg)
        raise FetchError(msg)

    # avatars are tiny; always re-pull so profile-pic changes show up
    avatar = _save(p.profile_pic_url, f"_avatars/{username}.jpg", force=True)
    with db.conn() as c:
        c.execute(
            """INSERT INTO accounts (username, userid, full_name, bio, avatar, followers, following,
                                     post_count, is_private, fetched_at, last_error)
               VALUES (?,?,?,?,?,?,?,?,?,?,NULL)
               ON CONFLICT(username) DO UPDATE SET
                 userid=excluded.userid, full_name=excluded.full_name, bio=excluded.bio,
                 avatar=COALESCE(excluded.avatar, accounts.avatar), followers=excluded.followers,
                 following=excluded.following, post_count=excluded.post_count,
                 is_private=excluded.is_private, fetched_at=excluded.fetched_at, last_error=NULL""",
            (username, p.userid, p.full_name, p.biography, avatar, p.followers, p.followees,
             p.mediacount, int(p.is_private), time.time()),
        )

    new = 0
    note = None
    if not p.is_private or p.followed_by_viewer:
        acct = db.one("SELECT cursor, history_done FROM accounts WHERE username=?", (username,))
        first_time = not acct["cursor"] and not acct["history_done"]
        it, wrap = _walk(p)
        cached_run = 0
        reached_end = False
        try:
            while True:
                try:
                    node = next(it)
                except StopIteration:
                    reached_end = True
                    break
                code, post = _code(node, wrap)
                if _cached(code):
                    # Posts come newest-first, but up to 3 pinned posts sit on top out of
                    # order, so only a run of already-cached posts means we're caught up.
                    cached_run += 1
                    if cached_run >= 4:
                        break
                    continue
                cached_run = 0
                _store_node(username, node, post, wrap)
                new += 1
                if new >= MAX_POSTS:
                    break
        except (LoginRequiredException, ConnectionException, QueryReturnedNotFoundException) as e:
            # Logged out, pagination sometimes hits a login wall. What we got is still good.
            note = _friendly(e)
            log.info("%s: stopped early: %s", username, note)
        if first_time:
            # remember where the first fetch stopped, so "load older" carries on from there
            _save_cursor(username, it, reached_end)

    stories = 0
    if with_stories and logged_in():
        try:
            stories = _refresh_stories(username, p.userid)
        except Exception as e:
            log.warning("%s: stories failed: %s", username, e)

    if note:
        db.execute("UPDATE accounts SET last_error=? WHERE username=?", (note, username))
    return {"username": username, "new_posts": new, "stories": stories, "note": note}


# ---------------------------------------------------------------- walking a profile's posts
# Instaloader turns every node into a Post as it iterates; logged out that costs one extra
# request per post (Post.from_shortcode). Swapping in a pass-through wrapper lets us read
# the shortcode first and only pay for posts we don't already have.


def _walk(p: instaloader.Profile):
    it = p.get_posts()
    wrap = it._node_wrapper
    it._node_wrapper = lambda n: n
    # The "newest post" checker expects Post objects; with raw nodes it would crash.
    # It only feeds Instaloader's own fast-update bookkeeping, which Peek doesn't use.
    it._is_first = None
    return it, wrap


def _code(node: dict, wrap):
    code = node.get("code") or node.get("shortcode")
    if code:
        return code, None
    post = wrap(node)
    return post.shortcode, post


def _cached(code: str) -> bool:
    return db.one("SELECT 1 AS x FROM posts WHERE shortcode=?", (code,)) is not None


def _save_cursor(username: str, it, done: bool):
    try:
        frozen = None if done else json.dumps(it.freeze()._asdict())
    except Exception as e:  # never let bookkeeping break a fetch
        log.warning("%s: couldn't save position: %s", username, e)
        return
    db.execute("UPDATE accounts SET cursor=?, history_done=? WHERE username=?", (frozen, int(done), username))


def load_older(username: str, count: int = 12) -> dict:
    """Fetch the next `count` uncached posts further back in an account's history,
    resuming from the saved position. Raises FetchError."""
    username = username.lower().lstrip("@").strip()
    _check_cooldown()
    with _lock:
        _busy.add(username)
        try:
            res = _load_older_locked(username, count)
        finally:
            _busy.discard(username)
    queue_downloads(username)
    return res


def _load_older_locked(username: str, count: int) -> dict:
    acct = db.one("SELECT cursor, history_done FROM accounts WHERE username=?", (username,))
    if acct and acct["history_done"]:
        return {"added": 0, "done": True, "note": None, "codes": []}
    try:
        p = _get_profile(username)
    except ProfileNotExistsException:
        raise FetchError("Not found, or restricted and hidden from this session")
    except LookupRefused as e:
        raise FetchError(str(e))
    except (LoginRequiredException, ConnectionException) as e:
        raise FetchError(_friendly(e))
    if p.is_private and not p.followed_by_viewer:
        raise FetchError("This account is private")

    it, wrap = _walk(p)
    if acct and acct["cursor"]:
        try:
            it.thaw(FrozenNodeIterator(**json.loads(acct["cursor"])))
        except Exception as e:
            # Stale or from a different login state: walk from the top instead. Cached
            # posts are skipped by shortcode, so that only costs page requests.
            log.info("%s: saved position unusable (%s); walking from the newest post", username, e)
            it, wrap = _walk(p)

    added, done, note, codes = 0, False, None, []
    try:
        while added < count:
            try:
                node = next(it)
            except StopIteration:
                done = True
                break
            code, post = _code(node, wrap)
            if _cached(code):
                continue
            _store_node(username, node, post, wrap)
            codes.append(code)
            added += 1
    except (LoginRequiredException, ConnectionException, QueryReturnedNotFoundException) as e:
        note = _friendly(e)
        log.info("%s: load older stopped: %s", username, note)
    _save_cursor(username, it, done)
    return {"added": added, "done": done, "note": note, "codes": codes}


# ---------------------------------------------------------------- highlights (burner only)
HIGHLIGHTS_TTL = 24 * 3600


def highlights_due(username: str) -> bool:
    a = db.one("SELECT userid, highlights_at FROM accounts WHERE username=?", (username,))
    return bool(logged_in() and a and a["userid"] and not cooldown_until()
                and (not a["highlights_at"] or time.time() - a["highlights_at"] > HIGHLIGHTS_TTL))


def refresh_highlights(username: str) -> int:
    """Fetch an account's highlight list (one request). Items are fetched per highlight
    when first opened. Raises FetchError."""
    a = db.one("SELECT userid FROM accounts WHERE username=?", (username,))
    if not (logged_in() and a and a["userid"]):
        return 0
    _check_cooldown()
    with _lock:
        try:
            found = list(L.get_highlights(int(a["userid"])))
        except Exception as e:
            raise FetchError(_friendly(e))
        rows = []
        for pos, h in enumerate(found):
            try:
                cover = h._node.get("cover_media_cropped_thumbnail", {}).get("url") or h.cover_url
            except Exception:
                cover = None
            rows.append((str(h.unique_id), username, h.title, cover, pos))
        ids = [r[0] for r in rows]
        with db.conn() as c:
            c.executemany(
                """INSERT INTO highlights (id, username, title, cover_url, position) VALUES (?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title, cover_url=excluded.cover_url,
                     position=excluded.position""", rows)
            gone = c.execute(f"SELECT id FROM highlights WHERE username=? AND id NOT IN ({','.join('?' * len(ids)) or "''"})",
                             (username, *ids)).fetchall()
            for (hid,) in gone:
                c.execute("DELETE FROM highlight_items WHERE highlight_id=?", (hid,))
                c.execute("DELETE FROM highlights WHERE id=?", (hid,))
            c.execute("UPDATE accounts SET highlights_at=? WHERE username=?", (time.time(), username))
    return len(rows)


def highlight_items(hid: str) -> list[dict]:
    """Items of one highlight, fetched on first open and re-checked at most once a day
    (two requests: the item list and the high-quality versions)."""
    h = db.one("SELECT h.*, a.userid FROM highlights h JOIN accounts a ON a.username = h.username WHERE h.id=?", (hid,))
    if not h:
        return []
    fresh = h["items_at"] and time.time() - h["items_at"] < HIGHLIGHTS_TTL
    if not fresh and logged_in():
        _check_cooldown()
        with _lock:
            try:
                owner = instaloader.Profile(L.context, {"id": h["userid"], "username": h["username"]})
                hl = instaloader.Highlight(L.context, {"id": hid, "title": h["title"]}, owner)
                hl._fetch_items()
                hl._fetch_iphone_struct()
            except Exception as e:
                if not db.one("SELECT 1 AS x FROM highlight_items WHERE highlight_id=?", (hid,)):
                    raise FetchError(_friendly(e))
                hl = None  # keep showing what we already have
            if hl is not None:
                iph = {str(it.get("pk")): it for it in (hl._iphone_struct_ or {}).get("items", [])}
                rows = []
                for pos, it in enumerate(hl._items or []):
                    full = iph.get(str(it["id"]), {})
                    video = bool(it.get("is_video"))
                    imgs = (full.get("image_versions2") or {}).get("candidates")
                    img = _best(imgs) or ((it.get("display_resources") or [{}])[-1].get("src")) or it.get("display_url")
                    vid = (_best(full.get("video_versions")) or ((it.get("video_resources") or [{}])[-1].get("src"))) if video else None
                    rows.append((str(it["id"]), hid, pos, it.get("taken_at_timestamp"), int(video), vid or img, img))
                with db.conn() as c:
                    c.executemany(
                        """INSERT INTO highlight_items (id, highlight_id, position, taken_at, is_video, url, poster_url)
                           VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,
                             url=excluded.url, poster_url=excluded.poster_url""", rows)
                    c.execute("UPDATE highlights SET items_at=? WHERE id=?", (time.time(), hid))
    return db.rows("SELECT * FROM highlight_items WHERE highlight_id=? ORDER BY position", (hid,))


def ensure_highlight_file(kind: str, key: str) -> str | None:
    """kind: 'c' cover, 'i' item, 'p' item poster. Downloads on first request and keeps it."""
    if kind == "c":
        h = db.one("SELECT username, cover, cover_url FROM highlights WHERE id=?", (key,))
        if not h:
            return None
        if h["cover"] and (MEDIA_DIR / h["cover"]).exists():
            return h["cover"]
        rel = _save(h["cover_url"], f"{h['username']}/highlights/cover_{key}.jpg")
        if rel:
            db.execute("UPDATE highlights SET cover=? WHERE id=?", (rel, key))
        return rel
    it = db.one("SELECT i.*, h.username FROM highlight_items i JOIN highlights h ON h.id = i.highlight_id "
                "WHERE i.id=?", (key,))
    if not it:
        return None
    col, video = ("poster", False) if kind == "p" else ("path", bool(it["is_video"]))
    if it[col] and (MEDIA_DIR / it[col]).exists():
        return it[col]
    base = f"{it['username']}/highlights/{key}"
    rel = f"{base}_poster.jpg" if kind == "p" else f"{base}.{'mp4' if video else 'jpg'}"
    with _file_lock(rel):
        rel = _save(it["poster_url"] if kind == "p" else it["url"], rel, fix=not video)
    if rel:
        db.execute(f"UPDATE highlight_items SET {col}=? WHERE id=?", (rel, key))
    return rel


def _refresh_stories(username: str, userid: int) -> int:
    count = 0
    for story in L.get_stories(userids=[userid]):
        for item in story.get_items():
            sid = str(item.mediaid)
            if db.one("SELECT id FROM stories WHERE id=?", (sid,)):
                continue
            base = f"{username}/stories/{sid}"
            path = _save(item.video_url if item.is_video else item.url,
                         f"{base}.{'mp4' if item.is_video else 'jpg'}", fix=not item.is_video)
            poster = _save(item.url, f"{base}_poster.jpg") if item.is_video else path
            db.execute(
                "INSERT OR REPLACE INTO stories VALUES (?,?,?,?,?,?,?)",
                (sid, username, item.date_utc.timestamp(), item.expiring_utc.timestamp(),
                 int(item.is_video), path, poster),
            )
            count += 1
    return count


def _record_error(username: str, msg: str):
    db.execute(
        "INSERT INTO accounts (username, last_error, fetched_at) VALUES (?,?,?) "
        "ON CONFLICT(username) DO UPDATE SET last_error=excluded.last_error",
        (username, msg, None),
    )


def _friendly(e: Exception) -> str:
    s = str(e)
    if "401" in s or "login" in s.lower():
        return "Instagram wants a login for more (add a burner session for full history)"
    if isinstance(e, TooManyRequestsException) or "429" in s or "Please wait" in s:
        until = cooldown_until()
        return ("Rate limited by Instagram; paused until " + time.strftime("%H:%M", time.localtime(until))
                if until else "Rate limited by Instagram; try again later")
    if "Redirected to login" in s:
        return "Instagram showed a login wall — try again later"
    return s[:200]


def prune_expired_stories(keep_days: int = 7):
    """Stories expire after 24h on Instagram; we keep the files a week, then clean up."""
    cutoff = time.time() - keep_days * 86400
    old = db.rows("SELECT id, path, poster FROM stories WHERE expires_at < ?", (cutoff,))
    for s in old:
        for rel in {s["path"], s["poster"]} - {None}:
            (MEDIA_DIR / rel).unlink(missing_ok=True)
    with db.conn() as c:
        c.executemany("DELETE FROM stories WHERE id=?", [(s["id"],) for s in old])
        c.executemany("DELETE FROM seen_stories WHERE id=?", [(s["id"],) for s in old])
    return len(old)


def delete_account_media(username: str):
    """Used when unfollowing with purge=true. Saved posts (and the account row they need
    for the avatar) are kept."""
    keep = {r["shortcode"] for r in db.rows(
        "SELECT p.shortcode FROM posts p JOIN saved s ON s.shortcode = p.shortcode WHERE p.username=?", (username,))}
    folder = MEDIA_DIR / username
    if folder.exists():
        for f in folder.rglob("*"):
            # shortcodes can contain "_", so match on the "<shortcode>_" prefix
            if f.is_file() and not any(f.name.startswith(sc + "_") for sc in keep):
                f.unlink(missing_ok=True)
    with db.conn() as c:
        c.execute("DELETE FROM media WHERE shortcode IN (SELECT shortcode FROM posts WHERE username=?) "
                  "AND shortcode NOT IN (SELECT shortcode FROM saved)", (username,))
        c.execute("DELETE FROM posts WHERE username=? AND shortcode NOT IN (SELECT shortcode FROM saved)", (username,))
        c.execute("DELETE FROM stories WHERE username=?", (username,))
        if keep:
            c.execute("UPDATE accounts SET followed=0, cursor=NULL, history_done=0 WHERE username=?", (username,))
        else:
            c.execute("DELETE FROM accounts WHERE username=?", (username,))
    if not keep:
        (MEDIA_DIR / "_avatars" / f"{username}.jpg").unlink(missing_ok=True)


def keep_post(sc: str):
    """A saved post: make sure its details are in and every full-size file is on disk now,
    before Instagram's links expire."""
    row = db.one("SELECT username, detailed FROM posts WHERE shortcode=?", (sc,))
    if not row:
        return
    if row["detailed"] == 0:
        try:
            hydrate(sc)
        except Exception as e:
            log.warning("save %s: couldn't fetch details yet: %s", sc, e)
    for m in db.rows("SELECT idx, is_video FROM media WHERE shortcode=?", (sc,)):
        _pool.submit(_safe_ensure, sc, m["idx"], False)
        if m["is_video"]:
            _pool.submit(_safe_ensure, sc, m["idx"], True)


def media_exists(rel: str | None) -> bool:
    return bool(rel) and (MEDIA_DIR / rel).exists()

