"""SQLite cache. One connection per call; WAL so the refresher and API don't block each other."""
import sqlite3
from contextlib import contextmanager

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    username     TEXT PRIMARY KEY,
    userid       INTEGER,
    full_name    TEXT,
    bio          TEXT,
    avatar       TEXT,
    followers    INTEGER,
    following    INTEGER,
    post_count   INTEGER,
    is_private   INTEGER DEFAULT 0,
    followed     INTEGER DEFAULT 0,
    fetched_at   REAL,
    last_error   TEXT,
    cursor       TEXT,             -- frozen Instaloader iterator: where "load older" resumes
    history_done INTEGER DEFAULT 0, -- reached the account's oldest post
    tried_at     REAL,             -- last fetch attempt, successful or not
    reels_cursor TEXT,             -- same as cursor, for the account's Reels tab
    reels_done   INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS posts (
    shortcode  TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    taken_at   REAL NOT NULL,
    kind       TEXT NOT NULL,          -- image | video | carousel | reel
    caption    TEXT,
    likes      INTEGER,
    comments   INTEGER,
    thumb      TEXT,
    thumb_url  TEXT,                   -- small cover from the profile page (logged out)
    detailed   INTEGER DEFAULT 1,      -- 0 = stub from the profile page, details not fetched yet
    reels_only INTEGER DEFAULT 0       -- 1 = only on the account's Reels tab, not its posts grid
);
CREATE INDEX IF NOT EXISTS posts_user_time ON posts(username, taken_at DESC);
CREATE INDEX IF NOT EXISTS posts_time ON posts(taken_at DESC);
CREATE TABLE IF NOT EXISTS media (
    shortcode  TEXT NOT NULL,
    idx        INTEGER NOT NULL,
    is_video   INTEGER NOT NULL,
    path       TEXT,               -- local file, NULL until downloaded
    poster     TEXT,
    url        TEXT,               -- Instagram CDN source (expires after a few days)
    poster_url TEXT,
    PRIMARY KEY (shortcode, idx)
);
CREATE TABLE IF NOT EXISTS stories (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    taken_at    REAL NOT NULL,
    expires_at  REAL NOT NULL,
    is_video    INTEGER NOT NULL,
    path        TEXT,
    poster      TEXT
);
CREATE TABLE IF NOT EXISTS seen_stories (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value REAL);
CREATE TABLE IF NOT EXISTS saved (shortcode TEXT PRIMARY KEY, saved_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS saved_slides (
    shortcode TEXT NOT NULL,
    idx       INTEGER NOT NULL,    -- one photo/video of a carousel
    saved_at  REAL NOT NULL,
    PRIMARY KEY (shortcode, idx)
);
CREATE TABLE IF NOT EXISTS highlights (
    id          TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    title       TEXT,
    cover_url   TEXT,
    cover       TEXT,
    position    INTEGER,
    items_at    REAL               -- when its items were last fetched
);
CREATE TABLE IF NOT EXISTS highlight_items (
    id           TEXT PRIMARY KEY,
    highlight_id TEXT NOT NULL,
    position     INTEGER,
    taken_at     REAL,
    is_video     INTEGER NOT NULL,
    url          TEXT,
    poster_url   TEXT,
    path         TEXT,
    poster       TEXT
);
CREATE TABLE IF NOT EXISTS session (
    id          INTEGER PRIMARY KEY CHECK (id = 1),   -- one burner session
    username    TEXT,
    sessionid   TEXT,
    csrftoken   TEXT,
    mid         TEXT,
    ig_did      TEXT,
    rur         TEXT,
    state       TEXT DEFAULT 'unchecked',             -- ok | unchecked | dead | none
    checked_at  REAL,
    last_error  TEXT,
    source      TEXT,                                 -- env | ui
    env_hash    TEXT,                                 -- which IG_SESSIONID was seeded last
    saved_at    REAL
);
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS account_groups (
    username TEXT NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (username, group_id)
);
"""


def init():
    with conn() as c:
        c.executescript(SCHEMA)
        # bring databases from earlier versions up to date
        for table, col, decl in (("media", "url", "TEXT"), ("media", "poster_url", "TEXT"),
                                 ("accounts", "cursor", "TEXT"), ("accounts", "history_done", "INTEGER DEFAULT 0"),
                                 ("posts", "thumb_url", "TEXT"), ("posts", "detailed", "INTEGER DEFAULT 1"),
                                 ("accounts", "tried_at", "REAL"), ("accounts", "highlights_at", "REAL"),
                                 ("posts", "reels_only", "INTEGER DEFAULT 0"),
                                 ("accounts", "reels_cursor", "TEXT"), ("accounts", "reels_done", "INTEGER DEFAULT 0")):
            if col not in {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def rows(sql, args=()):
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args)]


def one(sql, args=()):
    r = rows(sql, args)
    return r[0] if r else None


def execute(sql, args=()):
    with conn() as c:
        c.execute(sql, args)


def get_meta(key: str) -> float | None:
    r = one("SELECT value FROM meta WHERE key=?", (key,))
    return r["value"] if r else None


def set_meta(key: str, value: float):
    execute("INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value))
