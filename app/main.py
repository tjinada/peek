import asyncio
import logging
import random
import secrets
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
    if request.url.path.startswith(("/api/", "/media/")):
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
    return a


def _posts_out(posts: list[dict]) -> list[dict]:
    if not posts:
        return []
    codes = [p["shortcode"] for p in posts]
    marks = ",".join("?" * len(codes))
    media = db.rows(f"SELECT * FROM media WHERE shortcode IN ({marks}) ORDER BY shortcode, idx", codes)
    by_code: dict[str, list] = {}
    for m in media:
        by_code.setdefault(m["shortcode"], []).append(
            {"video": bool(m["is_video"]), "src": _media_url(m["path"]), "poster": _media_url(m["poster"])}
        )
    out = []
    for p in posts:
        p = dict(p)
        p["thumb"] = _media_url(p["thumb"])
        p["media"] = by_code.get(p["shortcode"], [])
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
    return {"account": acct, "posts": posts, "next": posts[-1]["taken_at"] if len(posts) == 60 else None}


@app.post("/api/u/{username}/refresh")
def force_refresh(username: str, bg: BackgroundTasks):
    u = _clean(username)
    if not fetcher.is_busy(u):
        bg.add_task(_bg_refresh, u)
    return {"ok": True}


@app.get("/api/p/{shortcode}")
def post(shortcode: str):
    p = db.one(
        "SELECT p.*, a.avatar, a.full_name FROM posts p LEFT JOIN accounts a ON a.username=p.username WHERE shortcode=?",
        (shortcode,),
    )
    if not p:
        raise HTTPException(404, "Not cached")
    return _posts_out([p])[0]


@app.post("/api/refresh-all")
async def refresh_all():
    if state["cycle_running"]:
        return {"ok": True, "already": True}
    asyncio.create_task(refresh_cycle())
    return {"ok": True}


# ---------------------------------------------------------------- static


app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get("/sw.js")
def sw():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
