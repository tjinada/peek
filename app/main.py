import asyncio
import logging
import random
import secrets
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, fetcher
from .config import ACCOUNT_DELAY, MEDIA_DIR, PEEK_PASSWORD, PROFILE_TTL_HOURS, REFRESH_HOURS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("peek")
STATIC = Path(__file__).resolve().parent.parent / "static"

state = {"last_cycle": None, "next_cycle": None, "cycle_running": False}


# ---------------------------------------------------------------- background refresh


async def refresh_cycle():
    """Refresh every followed account, one at a time, with human-ish gaps between them."""
    if state["cycle_running"]:
        return
    state["cycle_running"] = True
    try:
        names = [r["username"] for r in db.rows("SELECT username FROM accounts WHERE followed=1 ORDER BY fetched_at")]
        random.shuffle(names)
        for i, name in enumerate(names):
            try:
                res = await asyncio.to_thread(fetcher.refresh_profile, name)
                log.info("refreshed %s: %s", name, res)
            except fetcher.FetchError as e:
                log.warning("refresh %s failed: %s", name, e)
                if "Rate limited" in str(e):
                    log.warning("backing off for the rest of this cycle")
                    break
            if i < len(names) - 1:
                await asyncio.sleep(random.uniform(*ACCOUNT_DELAY))
        await asyncio.to_thread(fetcher.prune_expired_stories)
        state["last_cycle"] = time.time()
    finally:
        state["cycle_running"] = False


async def scheduler():
    await asyncio.sleep(10)
    while True:
        await refresh_cycle()
        # ±20% jitter so requests don't land on a fixed rhythm
        wait = REFRESH_HOURS * 3600 * random.uniform(0.8, 1.2)
        state["next_cycle"] = time.time() + wait
        await asyncio.sleep(wait)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    threading.Thread(target=fetcher.hydrator_loop, name="peek-hydrator", daemon=True).start()
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()


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
    if request.url.path.startswith(("/api/", "/media/", "/m/")):
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
            {"video": v, "src": _m(m["shortcode"], m["idx"], v, False), "poster": _m(m["shortcode"], m["idx"], v, v)}
        )
    out = []
    for p in posts:
        p = dict(p)
        items = by_code.get(p["shortcode"], [])
        p["media"] = items
        p["thumb"] = f"/m/{p['shortcode']}/0_thumb.jpg" if items or p.get("thumb_url") else _media_url(p["thumb"])
        p.pop("thumb_url", None)
        p["detailed"] = p.get("detailed", 1) == 1
        if "avatar" in p:
            p["avatar"] = _media_url(p["avatar"])
        out.append(p)
    return out


def _stale(a: dict | None) -> bool:
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
        "password": bool(PEEK_PASSWORD),
        "refresh_hours": REFRESH_HOURS,
        **state,
        **counts,
    }


@app.get("/api/feed")
def feed(before: float | None = None, limit: int = 18, kind: str | None = None):
    limit = max(1, min(limit, 60))
    sql = """SELECT p.*, a.avatar, a.full_name FROM posts p
             JOIN accounts a ON a.username = p.username
             WHERE a.followed = 1"""
    args: list = []
    if before:
        sql += " AND p.taken_at < ?"
        args.append(before)
    if kind == "reels":
        sql += " AND p.kind IN ('reel','video')"
    sql += " ORDER BY p.taken_at DESC LIMIT ?"
    args.append(limit)
    posts = _posts_out(db.rows(sql, args))
    return {"posts": posts, "next": posts[-1]["taken_at"] if len(posts) == limit else None}


@app.get("/api/stories")
def stories():
    """Unexpired stories grouped by account, unseen groups first."""
    now = time.time()
    items = db.rows(
        """SELECT s.*, a.avatar, (ss.id IS NOT NULL) AS seen FROM stories s
           JOIN accounts a ON a.username = s.username
           LEFT JOIN seen_stories ss ON ss.id = s.id
           WHERE a.followed = 1 AND s.expires_at > ? AND s.path IS NOT NULL
           ORDER BY s.taken_at""",
        (now,),
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
    return {"accounts": [_account_out(a) for a in rows]}


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
    sql += " ORDER BY taken_at DESC LIMIT 60"
    posts = _posts_out(db.rows(sql, args))
    acct = _account_out(a) if a else {"username": u, "followed": False}
    acct["busy"] = busy
    acct["cached"] = db.one("SELECT COUNT(*) AS n FROM posts WHERE username=?", (u,))["n"]
    return {"account": acct, "posts": posts, "next": posts[-1]["taken_at"] if len(posts) == 60 else None}


@app.post("/api/u/{username}/older")
async def load_older(username: str):
    """Pull the next page of history from Instagram. Blocks until done (a few seconds)."""
    u = _clean(username)
    if fetcher.is_busy(u):
        raise HTTPException(409, "Already fetching this account, try again in a moment")
    try:
        res = await asyncio.to_thread(fetcher.load_older, u)
    except fetcher.FetchError as e:
        raise HTTPException(502, str(e))
    res["cached"] = db.one("SELECT COUNT(*) AS n FROM posts WHERE username=?", (u,))["n"]
    return res


@app.post("/api/u/{username}/refresh")
def force_refresh(username: str, bg: BackgroundTasks):
    u = _clean(username)
    if not fetcher.is_busy(u):
        bg.add_task(_bg_refresh, u)
    return {"ok": True}


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
async def refresh_all():
    if state["cycle_running"]:
        return {"ok": True, "already": True}
    asyncio.create_task(refresh_cycle())
    return {"ok": True}


# ---------------------------------------------------------------- static


@app.get("/m/{shortcode}/{name}")
async def media_file(shortcode: str, name: str):
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
    return FileResponse(MEDIA_DIR / rel, headers={"Cache-Control": "public, max-age=31536000, immutable"})


app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/sw.js")
def sw():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
