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

# Optional burner session — enables stories, private-follow and restricted profiles.
IG_USER = os.getenv("IG_USER", "").strip()
IG_SESSIONID = os.getenv("IG_SESSIONID", "").strip()
IG_CSRFTOKEN = os.getenv("IG_CSRFTOKEN", "").strip()  # optional; a random one is used if blank

# Optional device cookies, copied from the same browser session as IG_SESSIONID.
# Instaloader maps these onto the app-style headers (mid -> x-mid, ig_did ->
# x-ig-device-id, rur -> ig-u-rur); without them app-side requests look device-less
# and Instagram refuses them more often.
IG_MID = os.getenv("IG_MID", "").strip()
IG_DID = os.getenv("IG_DID", "").strip()
IG_RUR = os.getenv("IG_RUR", "").strip()

# How the burner is spent. "restricted" (default): only accounts flagged age/region
# restricted or private, plus features that cannot work without a login. "off": never,
# restricted profiles simply fail. "always": every request uses it.
SESSION_POLICY = os.getenv("PEEK_SESSION_POLICY", "restricted")

# Ceiling on session-attributed operations per hour. Public work carries on past it;
# restricted accounts wait for the hour to roll.
SESSION_BUDGET_HOUR = int(os.getenv("PEEK_SESSION_BUDGET_HOUR", "300"))

# Fetch the whole followed-stories tray in one request per cycle, instead of one
# request per account per refresh.
STORIES_BATCHED = os.getenv("PEEK_STORIES_BATCHED", "1") != "0"

# These two need a login and are the most disposable features. Turn off to spend nothing.
REELS_TAB = os.getenv("PEEK_REELS_TAB", "1") != "0"
IG_SEARCH = os.getenv("PEEK_IG_SEARCH", "1") != "0"

# Optional shared password for the web UI (handy if it's reachable beyond your LAN).
PEEK_PASSWORD = os.getenv("PEEK_PASSWORD", "")

MEDIA_DIR.mkdir(parents=True, exist_ok=True)