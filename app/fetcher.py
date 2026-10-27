"""Everything that talks to Instagram lives here. Instaloader does the protocol work;
this module maps its objects into the cache and downloads media to disk (Instagram's
CDN URLs are signed and expire, so a local copy is the only thing that lasts).
Metadata is stored first; files download in a parallel pool afterwards."""
import itertools
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import instaloader
from instaloader.exceptions import (
    ConnectionException,
    LoginRequiredException,
    ProfileNotExistsException,
    QueryReturnedNotFoundException,
)

from . import db
from .config import IG_SESSIONID, IG_USER, MAX_POSTS, MEDIA_DIR

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
    )
    if IG_USER and IG_SESSIONID:
        L.load_session(IG_USER, {"sessionid": IG_SESSIONID, "ds_user_id": IG_SESSIONID.split("%3A")[0]})
        log.info("using session for %s", IG_USER)
    elif IG_USER:
        try:
            L.load_session_from_file(IG_USER)
            log.info("loaded session file for %s", IG_USER)
        except FileNotFoundError:
            log.warning("IG_USER set but no session file found; running logged out")
    return L


L = _make_loader()


def logged_in() -> bool:
    return L.context.is_logged_in


def is_busy(username: str) -> bool:
    return username in _busy


# ---------------------------------------------------------------- media download


def _save(url: str | None, rel: str, force: bool = False) -> str | None:
    """Download url to MEDIA_DIR/rel unless it's already there. Returns rel or None."""
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
        return rel
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


def _store_post(username: str, post: instaloader.Post) -> bool:
    """Cache one post's metadata and its media *source URLs*. No downloading here, so a
    profile's whole grid lands in the DB in one go; files are pulled by the download
    pool (or on demand when the browser asks first). Returns False if already cached."""
    sc = post.shortcode
    if db.one("SELECT shortcode FROM posts WHERE shortcode=?", (sc,)):
        # refresh counters only; media is immutable
        db.execute("UPDATE posts SET likes=?, comments=? WHERE shortcode=?", (post.likes, post.comments, sc))
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
            "INSERT OR REPLACE INTO posts VALUES (?,?,?,?,?,?,?,NULL)",
            (sc, username, post.date_utc.timestamp(), _kind(post), post.caption or "", post.likes, post.comments),
        )
    return True


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
        return row[col]
    rel = media_rel(row["username"], sc, idx, video, poster)
    with _file_lock(rel):
        if not (MEDIA_DIR / rel).exists():
            if not _save(row["poster_url"] if col == "poster" else row["url"], rel):
                return None
        if video:
            db.execute(f"UPDATE media SET {col}=? WHERE shortcode=? AND idx=?", (rel, sc, idx))
        else:  # an image is its own poster
            db.execute("UPDATE media SET path=?, poster=? WHERE shortcode=? AND idx=?", (rel, rel, sc, idx))
    if idx == 0 and (poster or not video):
        db.execute("UPDATE posts SET thumb=? WHERE shortcode=?", (rel, sc))
    return rel


def queue_downloads(username: str):
    """Queue every not-yet-downloaded file for an account: thumbnails first, then the
    rest of the images, then videos."""
    rows = db.rows(
        "SELECT m.shortcode, m.idx, m.is_video, m.path, m.poster FROM media m "
        "JOIN posts p ON p.shortcode = m.shortcode WHERE p.username=? ORDER BY p.taken_at DESC", (username,))
    first, images, videos = [], [], []
    for r in rows:
        if r["is_video"]:
            if not r["poster"]:
                first.append((r["shortcode"], r["idx"], True))
            if not r["path"]:
                videos.append((r["shortcode"], r["idx"], False))
        elif not r["path"]:
            (first if r["idx"] == 0 else images).append((r["shortcode"], r["idx"], False))
    for job in first + images + videos:
        _pool.submit(_safe_ensure, *job)
    return len(first) + len(images) + len(videos)


def _safe_ensure(sc, idx, poster):
    try:
        ensure_local(sc, idx, poster)
    except Exception as e:
        log.warning("download job %s/%s failed: %s", sc, idx, e)


def refresh_profile(username: str, with_stories: bool = True) -> dict:
    """Fetch profile + recent posts (+ stories when logged in). Raises FetchError.
    Returns once metadata is cached; media keeps downloading in the background."""
    username = username.lower().lstrip("@").strip()
    with _lock:
        _busy.add(username)
        try:
            res = _refresh_locked(username, with_stories)
        finally:
            _busy.discard(username)
    res["queued"] = queue_downloads(username)
    return res


def _refresh_locked(username: str, with_stories: bool) -> dict:
    try:
        p = instaloader.Profile.from_username(L.context, username)
    except ProfileNotExistsException:
        _record_error(username, "Profile doesn't exist")
        raise FetchError("Profile doesn't exist")
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
        try:
            for post in itertools.islice(p.get_posts(), MAX_POSTS):
                if _store_post(username, post):
                    new += 1
        except (LoginRequiredException, ConnectionException, QueryReturnedNotFoundException) as e:
            # Logged out, pagination past the first page often hits a login wall.
            # Whatever we got before that is still good.
            note = _friendly(e)
            log.info("%s: stopped early: %s", username, note)

    stories = 0
    if with_stories and logged_in():
        try:
            stories = _refresh_stories(username, p.userid)
        except Exception as e:
            log.warning("%s: stories failed: %s", username, e)

    if note:
        db.execute("UPDATE accounts SET last_error=? WHERE username=?", (note, username))
    return {"username": username, "new_posts": new, "stories": stories, "note": note}


def _refresh_stories(username: str, userid: int) -> int:
    count = 0
    for story in L.get_stories(userids=[userid]):
        for item in story.get_items():
            sid = str(item.mediaid)
            if db.one("SELECT id FROM stories WHERE id=?", (sid,)):
                continue
            base = f"{username}/stories/{sid}"
            path = _save(item.video_url if item.is_video else item.url, f"{base}.{'mp4' if item.is_video else 'jpg'}")
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
    if "429" in s or "Please wait" in s:
        return "Rate limited by Instagram — will retry on the next refresh"
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
    """Used when unfollowing with purge=true."""
    import shutil

    shutil.rmtree(MEDIA_DIR / username, ignore_errors=True)
    (MEDIA_DIR / "_avatars" / f"{username}.jpg").unlink(missing_ok=True)
    with db.conn() as c:
        c.execute("DELETE FROM media WHERE shortcode IN (SELECT shortcode FROM posts WHERE username=?)", (username,))
        c.execute("DELETE FROM posts WHERE username=?", (username,))
        c.execute("DELETE FROM stories WHERE username=?", (username,))
        c.execute("DELETE FROM accounts WHERE username=?", (username,))


def media_exists(rel: str | None) -> bool:
    return bool(rel) and (MEDIA_DIR / rel).exists()

