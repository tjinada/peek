import os
from pathlib import Path

DATA_DIR = Path(os.getenv("PEEK_DATA", "./data")).resolve()
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "peek.db"

# How often followed accounts are refreshed in the background, and how stale an
# ad-hoc profile can be before opening it triggers a fetch.
REFRESH_HOURS = float(os.getenv("PEEK_REFRESH_HOURS", "4"))
PROFILE_TTL_HOURS = float(os.getenv("PEEK_PROFILE_TTL_HOURS", "6"))

# Posts pulled per account per refresh. Logged out, Instagram usually only hands
# out the first ~12 anyway.
MAX_POSTS = int(os.getenv("PEEK_MAX_POSTS", "24"))

# Pause between accounts during a background refresh (seconds, randomised).
ACCOUNT_DELAY = (float(os.getenv("PEEK_DELAY_MIN", "20")), float(os.getenv("PEEK_DELAY_MAX", "60")))

# Optional burner session — enables stories, private-follow and deeper history.
IG_USER = os.getenv("IG_USER", "").strip()
IG_SESSIONID = os.getenv("IG_SESSIONID", "").strip()

# Optional shared password for the web UI (handy if it's reachable beyond your LAN).
PEEK_PASSWORD = os.getenv("PEEK_PASSWORD", "")

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
