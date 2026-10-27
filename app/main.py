import asyncio
import logging
import random
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Configure logging before importing the fetcher, so its startup messages (session loaded
# or not) actually show up.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs every media download with its full (very long) CDN URL; keep only problems.
logging.getLogger("httpx").setLevel(logging.WARNING)

from . import db, fetcher  # noqa: E402
from .config import ACCOUNT_DELAY, MEDIA_DIR, PEEK_PASSWORD, PROFILE_TTL_HOURS, REFRESH_HOURS  # noqa: E402

log = logging.getLogger("peek")
STATIC = Path(__file__).resolve().parent.parent / "static"

state = {"last_cycle": None, "next_cycle": None, "cycle_running": False}


# ---------------------------------------------------------------- background refresh


async def refresh_cycle(group: int | None = None):
    """Refresh every followed account (or just one group's), one at a time, with human-ish
    gaps between them. Only a full cycle counts for the schedule."""
    if state["cycle_running"]:
        return
    state["cycle_running"] = True
    try:
        sql = "SELECT username FROM accounts WHERE followed=1"
        args: tuple = ()
        if group:
            sql += " AND username IN (SELECT username FROM account_groups WHERE group_id=?)"
            args = (group,)
        names = [r["username"] for r in db.rows(sql + " ORDER BY fetched_at", args)]
        random.shuffle(names)
        for i, name in enumerate(names):
            try:
                res = await asyncio.to_thread(fetcher.refresh_profile, name)
                log.info("refreshed %s: %s", name, res)
            except fetcher.FetchError as e:
                log.warning("refresh %s failed: %s", name, e)
                if "Rate limited" in str(e) or "rate-limiting" in str(e):
                    log.warning("backing off for the rest of this cycle")
                    break
            except Exception:  # one bad account must never stop the scheduler for good
                log.exception("refresh %s failed unexpectedly", name)
            if i < len(names) - 1:
                await asyncio.sleep(random.uniform(*ACCOUNT_DELAY))
        if not group:
            await asyncio.to_thread(fetcher.prune_expired_stories)
            state["last_cycle"] = time.time()
            db.set_meta("last_cycle", state["last_cycle"])
    finally:
        state["cycle_running"] = False


def _next_wait() -> float:
    # ±20% jitter so requests don't land on a fixed rhythm
    return REFRESH_HOURS * 3600 * random.uniform(0.8, 1.2)


async def scheduler():
    # A restart (e.g. a rebuild) shouldn't trigger a full refresh: carry on from the last one.
    last = db.get_meta("last_cycle")
    state["last_cycle"] = last
    first_wait = max(10.0, last + _next_wait() - time.time()) if last else 10.0
    state["next_cycle"] = time.time() + first_wait
    log.info("next background refresh at %s", time.strftime("%H:%M", time.localtime(state["next_cycle"])))
    await asyncio.sleep(first_wait)
    while True:
        await refresh_cycle()
        wait = _next_wait()
        state["next_cycle"] = time.time() + wait
        await asyncio.sleep(wait)


SESSION_CHECK_HOURS = 6


async def session_watch():
    """Check the burner session every few hours, so an expired one shows up in the UI
    instead of stories and highlights quietly stopping."""
    await asyncio.sleep(30)
    while True:
        try:
            s = fetcher.session_info()
            due = (s["configured"] and s["state"] != "dead" and not fetcher.cooldown_until()
                   and (not s["checked_at"] or time.time() - s["checked_at"] > SESSION_CHECK_HOURS * 3600))
            if due:
                s = await asyncio.to_thread(fetcher.test_login)
                log.info("session check: %s", s["state"])
        except Exception:
            log.exception("session check failed")
        await asyncio.sleep(30 * 60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    fetcher.init_session()
    threading.Thread(target=fetcher.hydrator_loop, name="peek-hydrator", daemon=True).start()
    tasks = [asyncio.create_task(scheduler()), asyncio.create_task(session_watch())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Peek", lifespan=lifespan)


# ---------------------------------------------------------------- optional password gate


@app.middleware("http")
async def auth(request: Request, call_next):
    if not PEEK_PASSWORD or request.url.path in ("/api/login", "/manifest.webmanifest", "/sw.js") \
            or request.url.path.startswith("/icons/"):
        return await call_next(request)
    token = request.cookies.get("peek_auth", "")
    if secrets.compare_digest(token, _token()):
        return await call_next(request)
    if request.url.path.startswith(("/api/", "/media/", "/m/", "/hl/", "/sa/")):
        return JSONResponse({"detail": "auth"}, status_code=401)
    return await call_next(request)  # the shell loads, then shows the login screen


def _token() -> str:
    import hashlib

    return hashlib.sha256(f"peek:{PEEK_PASSWORD}".encode()).hexdigest()


class Login(BaseModel):
    password: str


@app.post("/api/login")
def login(body: Login):
    if not PEEK_PASSWORD or not secrets.compare_digest(body.password, PEEK_PASSWORD):
        raise HTTPException(401, "Wrong password")
    resp = JSONResponse({"ok": True})
    resp.set_cookie("peek_auth", _token(), max_age=180 * 86400, httponly=True, samesite="lax")
    return resp


# ---------------------------------------------------------------- helpers


def _media_url(rel):
    return f"/media/{rel}" if rel else None


def _account_out(a: dict) -> dict:
    a = dict(a)
    a["avatar"] = _media_url(a.get("avatar"))
    a["busy"] = fetcher.is_busy(a["username"])
    a["followed"] = bool(a.get("followed"))
    a["is_private"] = bool(a.get("is_private"))
    a["history_done"] = bool(a.get("history_done"))
    a.pop("cursor", None)  # internal; can be large
    return a


def _m(sc: str, idx: int, video: bool, poster: bool) -> str:
    """Media is served through /m/, which downloads on demand if the pool hasn't got
    to that file yet. The extension is there for the service worker and for downloads."""
    if poster:
        return f"/m/{sc}/{idx}_poster.jpg"
    return f"/m/{sc}/{idx}.{'mp4' if video else 'jpg'}"


def _posts_out(posts: list[dict]) -> list[dict]:
    if not posts:
        return []
    codes = [p["shortcode"] for p in posts]
    marks = ",".join("?" * len(codes))
    media = db.rows(f"SELECT shortcode, idx, is_video FROM media WHERE shortcode IN ({marks}) ORDER BY shortcode, idx", codes)
    by_code: dict[str, list] = {}
    for m in media:
        v = bool(m["is_video"])
        by_code.setdefault(m["shortcode"], []).append(
            {"idx": m["idx"], "video": v, "src": _m(m["shortcode"], m["idx"], v, False),
             "poster": _m(m["shortcode"], m["idx"], v, v)}
        )
    saved = {r["shortcode"] for r in db.rows(f"SELECT shortcode FROM saved WHERE shortcode IN ({marks})", codes)}
    saved_slides: dict[str, list[int]] = {}
    for r in db.rows(f"SELECT shortcode, idx FROM saved_slides WHERE shortcode IN ({marks}) ORDER BY idx", codes):
        saved_slides.setdefault(r["shortcode"], []).append(r["idx"])
    out = []
    for p in posts:
        p = dict(p)
        p["saved"] = p["shortcode"] in saved
        p["saved_slides"] = saved_slides.get(p["shortcode"], [])
        items = by_code.get(p["shortcode"], [])
        p["media"] = items
        p["thumb"] = f"/m/{p['shortcode']}/0_thumb.jpg" if items or p.get("thumb_url") else _media_url(p["thumb"])
        p.pop("thumb_url", None)
        p["detailed"] = p.get("detailed", 1) == 1
        if "avatar" in p:
            p["avatar"] = _media_url(p["avatar"])
        out.append(p)
    return out


RETRY_AFTER = 15 * 60  # after a failed fetch, don't auto-retry for this long


def _stale(a: dict | None) -> bool:
    """Should opening this profile kick off a fetch? Not if one was tried recently: a
    profile that failed (not found, rate limited) would otherwise be re-fetched on every
    poll. The Refresh button still forces one."""
    if a and a.get("tried_at") and time.time() - a["tried_at"] < RETRY_AFTER:
        return False
    if fetcher.cooldown_until():  # paused: don't queue a fetch that would just fail
        return False
    return not a or not a.get("fetched_at") or time.time() - a["fetched_at"] > PROFILE_TTL_HOURS * 3600


def _clean(username: str) -> str:
    u = username.lower().strip().lstrip("@")
    if "instagram.com/" in u:
        u = u.split("instagram.com/")[1].split("/")[0].split("?")[0]
    if not u or len(u) > 30 or not all(ch.isalnum() or ch in "._" for ch in u):
        raise HTTPException(400, "That doesn't look like an Instagram username")
    return u


def _bg_refresh(username: str):
    try:
        fetcher.refresh_profile(username)
    except fetcher.FetchError as e:
        log.warning("refresh %s failed: %s", username, e)


# ---------------------------------------------------------------- API


@app.get("/api/status")
def status():
    counts = db.one(
        "SELECT (SELECT COUNT(*) FROM accounts WHERE followed=1) AS following,"
        "       (SELECT COUNT(*) FROM posts) AS posts,"
        "       (SELECT COUNT(*) FROM stories) AS stories"
    )
    return {
        "logged_in": fetcher.logged_in(),
        "session": fetcher.session_info(),
        "paused_until": fetcher.cooldown_until(),
        "password": bool(PEEK_PASSWORD),
        "refresh_hours": REFRESH_HOURS,
        **state,
        **counts,
    }


class SessionIn(BaseModel):
    sessionid: str
    csrftoken: str | None = None
    mid: str | None = None
    ig_did: str | None = None
    rur: str | None = None


@app.get("/api/session")
def get_session():
    return fetcher.session_info()


@app.post("/api/session")
async def put_session(body: SessionIn):
    """Replace the burner session. Saved only if Instagram accepts it."""
    try:
        return await asyncio.to_thread(fetcher.set_session, body.model_dump())
    except fetcher.SessionError as e:
        raise HTTPException(400 if e.state == "dead" else 503, str(e))


@app.post("/api/session/check")
async def check_session():
    return await asyncio.to_thread(fetcher.test_login)


@app.delete("/api/session")
async def delete_session():
    await asyncio.to_thread(fetcher.clear_session)
    return fetcher.session_info()


@app.get("/api/feed")
def feed(before: float | None = None, limit: int = 18, kind: str | None = None, group: int | None = None):
    limit = max(1, min(limit, 60))
    sql = """SELECT p.*, a.avatar, a.full_name FROM posts p
             JOIN accounts a ON a.username = p.username
             WHERE a.followed = 1"""
    args: list = []
    if group:
        sql += " AND p.username IN (SELECT username FROM account_groups WHERE group_id = ?)"
        args.append(group)
    if before:
        sql += " AND p.taken_at < ?"
        args.append(before)
    if kind == "reels":
        sql += " AND p.kind IN ('reel','video')"
    sql += " ORDER BY p.taken_at DESC LIMIT ?"
    args.append(limit)
    posts = _posts_out(db.rows(sql, args))
    out = {"posts": posts, "next": posts[-1]["taken_at"] if len(posts) == limit else None}
    if before is None:
        out["seen_at"] = db.get_meta("feed_seen_at")  # newest post shown last time
    return out


@app.get("/api/feed/new")
def feed_new(since: float, kind: str | None = None, group: int | None = None):
    """How many feed posts are newer than the newest one on screen. Local only, so the feed
    can poll it cheaply and offer a 'new posts' pill. Also says if a refresh is running."""
    sql = """SELECT COUNT(*) AS n FROM posts p JOIN accounts a ON a.username = p.username
             WHERE a.followed = 1 AND p.taken_at > ?"""
    args: list = [since]
    if group:
        sql += " AND p.username IN (SELECT username FROM account_groups WHERE group_id = ?)"
        args.append(group)
    if kind == "reels":
        sql += " AND p.kind IN ('reel','video')"
    return {"count": db.one(sql, args)["n"], "refreshing": state["cycle_running"]}


class FeedSeen(BaseModel):
    ts: float


@app.post("/api/feed/seen")
def feed_seen(body: FeedSeen):
    """Remember the newest feed post shown, for the 'You're caught up' marker. Never goes back."""
    if body.ts > (db.get_meta("feed_seen_at") or 0):
        db.set_meta("feed_seen_at", body.ts)
    return {"ok": True}


@app.get("/api/stories")
def stories(group: int | None = None):
    """Unexpired stories grouped by account, unseen groups first. ?group= limits it to a group."""
    now = time.time()
    items = db.rows(
        """SELECT s.*, a.avatar, (ss.id IS NOT NULL) AS seen FROM stories s
           JOIN accounts a ON a.username = s.username
           LEFT JOIN seen_stories ss ON ss.id = s.id
           WHERE a.followed = 1 AND s.expires_at > ? AND s.path IS NOT NULL"""
        + (" AND s.username IN (SELECT username FROM account_groups WHERE group_id = ?)" if group else "")
        + " ORDER BY s.taken_at",
        (now, group) if group else (now,),
    )
    groups: dict[str, dict] = {}
    for it in items:
        g = groups.setdefault(it["username"], {"username": it["username"], "avatar": _media_url(it["avatar"]),
                                                "items": [], "latest": 0})
        g["items"].append({"id": it["id"], "video": bool(it["is_video"]), "src": _media_url(it["path"]),
                           "poster": _media_url(it["poster"]), "taken_at": it["taken_at"], "seen": bool(it["seen"])})
        g["latest"] = max(g["latest"], it["taken_at"])
    out = list(groups.values())
    for g in out:
        g["all_seen"] = all(i["seen"] for i in g["items"])
    out.sort(key=lambda g: (g["all_seen"], -g["latest"]))
    return {"groups": out, "enabled": fetcher.logged_in()}


class Seen(BaseModel):
    ids: list[str]


@app.post("/api/stories/seen")
def stories_seen(body: Seen):
    with db.conn() as c:
        c.executemany("INSERT OR IGNORE INTO seen_stories VALUES (?)", [(i,) for i in body.ids[:500]])
    return {"ok": True}


@app.get("/api/accounts")
def accounts():
    rows = db.rows(
        """SELECT a.*, (SELECT MAX(taken_at) FROM posts p WHERE p.username=a.username) AS latest_post
           FROM accounts a WHERE followed=1 ORDER BY username"""
    )
    member: dict[str, list[int]] = {}
    for r in db.rows("SELECT username, group_id FROM account_groups"):
        member.setdefault(r["username"], []).append(r["group_id"])
    out = []
    for a in rows:
        a = _account_out(a)
        a["groups"] = member.get(a["username"], [])
        out.append(a)
    return {"accounts": out}


# ---------------------------------------------------------------- groups


@app.get("/api/groups")
def groups():
    return {"groups": db.rows(
        """SELECT g.id, g.name, COUNT(a.username) AS count FROM groups g
           LEFT JOIN account_groups ag ON ag.group_id = g.id
           LEFT JOIN accounts a ON a.username = ag.username AND a.followed = 1
           GROUP BY g.id ORDER BY g.name COLLATE NOCASE""")}


class GroupIn(BaseModel):
    name: str


@app.post("/api/groups")
def create_group(body: GroupIn):
    name = " ".join(body.name.split())[:30]
    if not name:
        raise HTTPException(400, "Give the group a name")
    if db.one("SELECT 1 AS x FROM groups WHERE name = ? COLLATE NOCASE", (name,)):
        raise HTTPException(409, f"There's already a group called {name}")
    with db.conn() as c:
        gid = c.execute("INSERT INTO groups (name) VALUES (?)", (name,)).lastrowid
    return {"id": gid, "name": name, "count": 0}


@app.delete("/api/groups/{gid}")
def delete_group(gid: int):
    with db.conn() as c:
        c.execute("DELETE FROM account_groups WHERE group_id=?", (gid,))
        c.execute("DELETE FROM groups WHERE id=?", (gid,))
    return {"ok": True}


class Membership(BaseModel):
    ids: list[int]


@app.put("/api/accounts/{username}/groups")
def set_groups(username: str, body: Membership):
    u = _clean(username)
    valid = {r["id"] for r in db.rows("SELECT id FROM groups")}
    with db.conn() as c:
        c.execute("DELETE FROM account_groups WHERE username=?", (u,))
        c.executemany("INSERT INTO account_groups VALUES (?,?)", [(u, g) for g in set(body.ids) & valid])
    return {"ok": True}


class Follow(BaseModel):
    username: str


@app.post("/api/accounts")
def follow(body: Follow, bg: BackgroundTasks):
    u = _clean(body.username)
    db.execute(
        "INSERT INTO accounts (username, followed) VALUES (?,1) ON CONFLICT(username) DO UPDATE SET followed=1", (u,)
    )
    a = db.one("SELECT * FROM accounts WHERE username=?", (u,))
    if _stale(a) and not fetcher.is_busy(u):
        bg.add_task(_bg_refresh, u)
    return {"username": u}


@app.delete("/api/accounts/{username}")
def unfollow(username: str, purge: bool = False):
    u = _clean(username)
    if purge:
        fetcher.delete_account_media(u)
    else:
        db.execute("UPDATE accounts SET followed=0 WHERE username=?", (u,))
    return {"ok": True}


class Bulk(BaseModel):
    usernames: list[str]
    action: str                 # unfollow | add_group | remove_group
    group_id: int | None = None
    purge: bool = False         # unfollow: also delete what Peek saved for them


@app.post("/api/accounts/bulk")
def bulk(body: Bulk):
    users = sorted({_clean(u) for u in body.usernames})
    if not users:
        raise HTTPException(400, "Pick at least one account")
    if body.action in ("add_group", "remove_group"):
        if not db.one("SELECT id FROM groups WHERE id=?", (body.group_id,)):
            raise HTTPException(404, "That group no longer exists")
        with db.conn() as c:
            if body.action == "add_group":
                c.executemany("INSERT OR IGNORE INTO account_groups VALUES (?,?)", [(u, body.group_id) for u in users])
            else:
                c.executemany("DELETE FROM account_groups WHERE username=? AND group_id=?",
                              [(u, body.group_id) for u in users])
    elif body.action == "unfollow":
        for u in users:
            if body.purge:
                fetcher.delete_account_media(u)
            else:
                db.execute("UPDATE accounts SET followed=0 WHERE username=?", (u,))
    else:
        raise HTTPException(400, "Unknown action")
    return {"ok": True, "count": len(users)}


@app.get("/api/zip")
def zip_download(user: str | None = None, group: int | None = None, videos: bool = True):
    """Everything Peek has for a profile or a group, as one zip, streamed as it's built."""
    if user:
        users, name = [_clean(user)], _clean(user)
    elif group is not None:
        g = db.one("SELECT name FROM groups WHERE id=?", (group,))
        if not g:
            raise HTTPException(404, "That group no longer exists")
        users = [r["username"] for r in db.rows("SELECT username FROM account_groups WHERE group_id=? ORDER BY username",
                                                 (group,))]
        name = "group-" + "".join(ch if ch.isalnum() else "-" for ch in g["name"].lower()).strip("-")
    else:
        raise HTTPException(400, "Say which profile or group")
    if not users or not db.one(f"SELECT 1 AS x FROM posts WHERE username IN ({','.join('?' * len(users))}) LIMIT 1",
                               users):
        raise HTTPException(404, "Peek hasn't saved any posts for that yet")
    fname = f"peek_{name}_{time.strftime('%Y-%m-%d')}.zip"
    return StreamingResponse(fetcher.zip_stream(users, videos), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.get("/api/u/{username}")
def profile(username: str, bg: BackgroundTasks, before: float | None = None, kind: str | None = None):
    """Cached profile + posts. If missing or stale, kicks off a background fetch and
    tells the client to poll (busy=true) instead of blocking the request."""
    u = _clean(username)
    a = db.one("SELECT * FROM accounts WHERE username=?", (u,))
    if before is None and _stale(a) and not fetcher.is_busy(u):
        bg.add_task(_bg_refresh, u)
        busy = True
    else:
        busy = fetcher.is_busy(u)
    sql = "SELECT * FROM posts WHERE username=?"
    args: list = [u]
    if before:
        sql += " AND taken_at < ?"
        args.append(before)
    if kind == "reels":
        sql += " AND kind IN ('reel','video')"
    else:  # the posts grid, as on Instagram: reels shared to the Reels tab only stay off it
        sql += " AND reels_only=0"
    sql += " ORDER BY taken_at DESC LIMIT 60"
    posts = _posts_out(db.rows(sql, args))
    acct = _account_out(a) if a else {"username": u, "followed": False}
    acct["busy"] = busy
    acct["cached"] = db.one("SELECT COUNT(*) AS n FROM posts WHERE username=? AND reels_only=0", (u,))["n"]
    acct["reels_tab"] = fetcher.logged_in()  # the Reels tab listing needs the burner session
    sess = fetcher.session_info()
    acct["session"] = {"state": sess["state"], "error": sess["error"]}  # for the expired-session banner
    return {"account": acct, "posts": posts, "next": posts[-1]["taken_at"] if len(posts) == 60 else None}


@app.post("/api/u/{username}/older")
async def load_older(username: str, kind: str | None = None):
    """Pull the next page of history (of the posts grid, or with kind=reels the Reels tab)
    from Instagram. Blocks until done (a few seconds)."""
    u = _clean(username)
    if fetcher.is_busy(u):
        raise HTTPException(409, "Already fetching this account, try again in a moment")
    try:
        res = await asyncio.to_thread(fetcher.load_older_reels if kind == "reels" else fetcher.load_older, u)
    except fetcher.FetchError as e:
        raise HTTPException(502, str(e))
    res["cached"] = db.one("SELECT COUNT(*) AS n FROM posts WHERE username=? AND reels_only=0", (u,))["n"]
    # Hand back the new posts themselves: they aren't always older than what's on screen
    # (pinned posts sit among the newest yet can be years old), so paging by date misses them.
    codes = res.pop("codes", [])
    marks = ",".join("?" * len(codes))
    res["posts"] = _posts_out(db.rows(
        f"SELECT * FROM posts WHERE shortcode IN ({marks}) ORDER BY taken_at DESC", codes)) if codes else []
    return res


@app.get("/api/u/{username}/highlights")
async def highlights(username: str):
    """Highlight list for a profile. Refreshed from Instagram at most once a day."""
    u = _clean(username)
    note = None
    if fetcher.highlights_due(u) and not fetcher.is_busy(u):
        try:
            await asyncio.to_thread(fetcher.refresh_highlights, u)
        except fetcher.FetchError as e:
            note = str(e)
            log.warning("highlights %s failed: %s", u, e)
    rows = db.rows("SELECT id, title FROM highlights WHERE username=? ORDER BY position", (u,))
    return {"enabled": fetcher.logged_in(), "note": note,
            "highlights": [{"id": r["id"], "title": r["title"], "cover": f"/hl/c/{r['id']}"} for r in rows]}


@app.get("/api/highlights/{hid}")
async def highlight(hid: str):
    try:
        items = await asyncio.to_thread(fetcher.highlight_items, hid)
    except fetcher.FetchError as e:
        raise HTTPException(502, str(e))
    return {"items": [{"id": i["id"], "video": bool(i["is_video"]), "taken_at": i["taken_at"] or 0,
                       "src": f"/hl/i/{i['id']}", "poster": f"/hl/p/{i['id']}"} for i in items]}


@app.get("/hl/{kind}/{key}")
async def highlight_file(kind: str, key: str, dl: str | None = None):
    if kind not in ("c", "i", "p"):
        raise HTTPException(404)
    rel = await asyncio.to_thread(fetcher.ensure_highlight_file, kind, key)
    if not rel:
        raise HTTPException(404, "Not available")
    return _media_response(rel, dl)


@app.post("/api/u/{username}/refresh")
def force_refresh(username: str, bg: BackgroundTasks):
    u = _clean(username)
    if not fetcher.is_busy(u):
        bg.add_task(_bg_refresh, u)
    return {"ok": True}


@app.get("/api/search")
def search(q: str = ""):
    """Search what's already saved: account names and post captions. Never touches Instagram."""
    q = q.strip().lstrip("@")
    if len(q) < 2:
        return {"accounts": [], "posts": []}
    like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    accounts = db.rows(
        """SELECT a.*, (SELECT MAX(taken_at) FROM posts p WHERE p.username=a.username) AS latest_post
           FROM accounts a WHERE (a.username LIKE ? ESCAPE '\\' OR a.full_name LIKE ? ESCAPE '\\')
             AND (a.followed=1 OR a.fetched_at IS NOT NULL)
           ORDER BY a.followed DESC, a.username LIMIT 10""", (like, like))
    posts = db.rows(
        """SELECT p.*, a.avatar, a.full_name FROM posts p LEFT JOIN accounts a ON a.username=p.username
           WHERE p.caption LIKE ? ESCAPE '\\' ORDER BY p.taken_at DESC LIMIT 60""", (like,))
    return {"accounts": [_account_out(a) for a in accounts], "posts": _posts_out(posts)}


@app.get("/api/search/instagram")
async def search_instagram(q: str = ""):
    """Account suggestions from Instagram for Look up (burner session only)."""
    q = q.strip().lstrip("@")
    if len(q) < 3:
        return {"status": "ok", "users": []}
    try:
        users = await asyncio.to_thread(fetcher.search_instagram, q)
    except fetcher.SearchUnavailable as e:
        return {"status": e.status, "message": str(e), "users": []}
    names = [u["username"] for u in users]
    marks = ",".join("?" * len(names)) or "''"
    known = {r["username"]: r for r in db.rows(
        f"SELECT username, avatar, followed FROM accounts WHERE username IN ({marks})", names)}
    for u in users:
        k = known.get(u["username"])
        u["followed"] = bool(k and k["followed"])
        u["avatar"] = _media_url(k["avatar"]) if k and k["avatar"] else f"/sa/{u['username']}"
    return {"status": "ok", "users": users}


@app.get("/sa/{username}")
async def search_avatar(username: str):
    rel = await asyncio.to_thread(fetcher.search_avatar, _clean(username))
    if not rel:
        raise HTTPException(404)
    return _media_response(rel)


@app.get("/api/saved")
def saved_list(before: float | None = None, limit: int = 60):
    """Saved posts and saved single photos together, most recently saved first.
    A single photo comes back as its post with `slide` set. `before` pages by saved_at."""
    limit = max(1, min(limit, 120))
    entries = db.rows(
        """SELECT shortcode, NULL AS slide, saved_at FROM saved WHERE (? IS NULL OR saved_at < ?)
           UNION ALL
           SELECT ss.shortcode, ss.idx, ss.saved_at FROM saved_slides ss
           WHERE (? IS NULL OR ss.saved_at < ?) AND ss.shortcode NOT IN (SELECT shortcode FROM saved)
           ORDER BY saved_at DESC LIMIT ?""", (before, before, before, before, limit))
    codes = list({e["shortcode"] for e in entries})
    marks = ",".join("?" * len(codes)) or "''"
    posts = {p["shortcode"]: p for p in _posts_out(db.rows(
        f"""SELECT p.*, a.avatar, a.full_name FROM posts p LEFT JOIN accounts a ON a.username = p.username
            WHERE p.shortcode IN ({marks})""", codes))}
    out = []
    for e in entries:
        p = posts.get(e["shortcode"])
        if not p:
            continue
        p = dict(p, slide=e["slide"], saved_at=e["saved_at"])
        if e["slide"] is not None:
            p["thumb"] = f"/m/{p['shortcode']}/{e['slide']}_thumb.jpg"
        out.append(p)
    count = db.one("""SELECT (SELECT COUNT(*) FROM saved) +
                             (SELECT COUNT(*) FROM saved_slides WHERE shortcode NOT IN (SELECT shortcode FROM saved)) AS n""")["n"]
    return {"posts": out, "next": entries[-1]["saved_at"] if len(entries) == limit else None, "count": count}


@app.post("/api/saved/{shortcode}")
def save_post(shortcode: str, bg: BackgroundTasks, slide: int | None = None):
    """Save a whole post, or just one photo of a carousel (?slide=<idx>)."""
    if not db.one("SELECT 1 AS x FROM posts WHERE shortcode=?", (shortcode,)):
        raise HTTPException(404, "Post not cached")
    with db.conn() as c:
        if slide is None:
            c.execute("INSERT OR IGNORE INTO saved VALUES (?,?)", (shortcode, time.time()))
            c.execute("DELETE FROM saved_slides WHERE shortcode=?", (shortcode,))  # the whole post covers them
        else:
            if not c.execute("SELECT 1 FROM media WHERE shortcode=? AND idx=?", (shortcode, slide)).fetchone():
                raise HTTPException(404, "No such photo in this post")
            c.execute("INSERT OR IGNORE INTO saved_slides VALUES (?,?,?)", (shortcode, slide, time.time()))
    bg.add_task(fetcher.keep_post, shortcode, slide)
    return {"saved": True}


@app.delete("/api/saved/{shortcode}")
def unsave_post(shortcode: str, slide: int | None = None):
    if slide is None:
        db.execute("DELETE FROM saved WHERE shortcode=?", (shortcode,))
    else:
        db.execute("DELETE FROM saved_slides WHERE shortcode=? AND idx=?", (shortcode, slide))
    return {"saved": False}


@app.get("/api/p/{shortcode}")
async def post(shortcode: str):
    p = db.one(
        "SELECT p.*, a.avatar, a.full_name FROM posts p LEFT JOIN accounts a ON a.username=p.username WHERE shortcode=?",
        (shortcode,),
    )
    if not p:
        raise HTTPException(404, "Not cached")
    if p.get("detailed") == 0:
        # a stub from a logged-out page: fetch its full details now (one request)
        try:
            await asyncio.to_thread(fetcher.hydrate, shortcode)
        except Exception as e:
            log.warning("hydrate %s on open failed: %s", shortcode, e)
        p = db.one(
            "SELECT p.*, a.avatar, a.full_name FROM posts p LEFT JOIN accounts a ON a.username=p.username "
            "WHERE shortcode=?", (shortcode,))
    return _posts_out([p])[0]


@app.post("/api/refresh-all")
async def refresh_all(group: int | None = None):
    """Refresh everyone followed, or with ?group= only that group's accounts."""
    if state["cycle_running"]:
        return {"ok": True, "already": True}
    count = db.one("SELECT COUNT(*) AS n FROM accounts WHERE followed=1"
                   + (" AND username IN (SELECT username FROM account_groups WHERE group_id=?)" if group else ""),
                   (group,) if group else ())["n"]
    if not count:
        return {"ok": True, "count": 0}
    asyncio.create_task(refresh_cycle(group))
    return {"ok": True, "count": count}


# ---------------------------------------------------------------- static


def _media_response(rel: str, dl: str | None = None) -> FileResponse:
    """Serve with the real content type (Instagram mixes JPEG and WebP behind .jpg URLs).
    ?dl=<name> makes it a download named <name>.<real extension>."""
    path = MEDIA_DIR / rel
    kind = fetcher.sniff(path) or rel.rsplit(".", 1)[-1]
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    if dl:
        safe = "".join(ch for ch in dl if ch.isalnum() or ch in "._-")[:120] or "peek"
        headers["Content-Disposition"] = f'attachment; filename="{safe}.{kind}"'
    return FileResponse(path, media_type=fetcher.MIME.get(kind), headers=headers)


@app.get("/m/{shortcode}/{name}")
async def media_file(shortcode: str, name: str, dl: str | None = None):
    """<idx>.jpg|mp4 = full media, <idx>_poster.jpg = video poster, <idx>_thumb.jpg = small
    grid tile (Instagram's originals are 1-3 MB, far too heavy for a 60-tile grid)."""
    stem = name.rsplit(".", 1)[0]
    kind = "thumb" if stem.endswith("_thumb") else "poster" if stem.endswith("_poster") else "full"
    try:
        idx = int(stem.removesuffix("_thumb").removesuffix("_poster"))
    except ValueError:
        raise HTTPException(404)
    if kind == "thumb":
        rel = await asyncio.to_thread(fetcher.ensure_thumb, shortcode, idx)
    else:
        rel = await asyncio.to_thread(fetcher.ensure_local, shortcode, idx, kind == "poster")
    if not rel:
        raise HTTPException(404, "Media unavailable (Instagram link may have expired; refresh the profile)")
    return _media_response(rel, dl)


app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/sw.js")
def sw():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
