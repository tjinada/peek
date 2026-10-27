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
    last_error   TEXT
);
CREATE TABLE IF NOT EXISTS posts (
    shortcode  TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    taken_at   REAL NOT NULL,
    kind       TEXT NOT NULL,          -- image | video | carousel | reel
    caption    TEXT,
    likes      INTEGER,
    comments   INTEGER,
    thumb      TEXT
);
CREATE INDEX IF NOT EXISTS posts_user_time ON posts(username, taken_at DESC);
CREATE INDEX IF NOT EXISTS posts_time ON posts(taken_at DESC);
CREATE TABLE IF NOT EXISTS media (
    shortcode  TEXT NOT NULL,
    idx        INTEGER NOT NULL,
    is_video   INTEGER NOT NULL,
    path       TEXT,
    poster     TEXT,
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
"""


def init():
    with conn() as c:
        c.executescript(SCHEMA)


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
