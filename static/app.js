"use strict";

/* ================================================================ basics */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $("#view");
const overlay = $("#overlay");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K" : n.toLocaleString();
const AVATAR_FALLBACK = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#3b3546"/><circle cx="20" cy="16" r="7" fill="#5a5266"/><path d="M6 38c2-8 8-12 14-12s12 4 14 12" fill="#5a5266"/></svg>');

function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 86400 * 7) return Math.floor(s / 86400) + "d";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const I = {
  carousel: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="13" height="13" rx="2.5"/><path d="M4 16V6.5A2.5 2.5 0 0 1 6.5 4H16"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevL: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4.5L5.5 20V5a1 1 0 0 1 1-1z"/></svg>',
  marked: '<svg viewBox="0 0 24 24"><path d="M6.5 4h11a1 1 0 0 1 1 1v15l-6.5-4.5L5.5 20V5a1 1 0 0 1 1-1z" fill="currentColor"/></svg>',
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("auth"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

/* ================================================================ video handling
   One observer drives every inline video: play when mostly on screen, pause otherwise.
   Sound is a single app-wide toggle, like any feed. */

let muted = true;
const vidObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6) { v.muted = muted; v.play().catch(() => {}); }
    else v.pause();
  }
}, { threshold: [0, 0.6] });

function wireVideos(root) {
  $$("video[data-auto]", root).forEach((v) => vidObserver.observe(v));
  $$(".mute", root).forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    muted = !muted;
    $$("video").forEach((v) => (v.muted = muted));
    $$(".mute").forEach((m) => (m.innerHTML = muted ? I.muted : I.sound));
  }));
}

function stepSlides(frame, dir) {
  const slides = frame && $(".slides", frame);
  if (!slides) return;
  const n = slides.children.length;
  const i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth));
  const next = Math.max(0, Math.min(n - 1, i + dir));
  slides.scrollTo({ left: next * slides.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function slidePos(frame) {
  const slides = frame && $(".slides", frame);
  if (!slides) return { i: 0, n: 1 };
  return { i: Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)), n: slides.children.length };
}

function wireSlides(root) {
  $$(".frame", root).forEach((frame) => {
    const slides = $(".slides", frame), dots = $$(".dots i", frame);
    if (!slides || dots.length < 2) return;
    const prev = $(".nav.prev", frame), next = $(".nav.next", frame);
    const update = () => {
      const i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth));
      dots.forEach((d, j) => d.classList.toggle("on", i === j));
      if (prev) prev.hidden = i === 0;
      if (next) next.hidden = i === dots.length - 1;
    };
    slides.addEventListener("scroll", update, { passive: true });
    prev?.addEventListener("click", (e) => { e.preventDefault(); stepSlides(frame, -1); });
    next?.addEventListener("click", (e) => { e.preventDefault(); stepSlides(frame, 1); });
    update();
  });
}

function onSentinel(el, fn) {
  const io = new IntersectionObserver(async ([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    if (await fn()) io.observe(el);
  }, { rootMargin: "800px" });
  io.observe(el);
}

/* ================================================================ fragments */

function slideHTML(m) {
  return `<div class="slide">${m.video
    ? `<video src="${esc(m.src)}" poster="${esc(m.poster || "")}" playsinline loop muted preload="metadata" data-auto></video>`
    : `<img src="${esc(m.src)}" alt="" loading="lazy" decoding="async">`}</div>`;
}

function frameHTML(p) {
  const media = p.media.filter((m) => m.src);
  if (!media.length) return `<div class="frame"><div class="slide"><img src="${esc(p.thumb || "")}" alt=""></div></div>`;
  const hasVideo = media.some((m) => m.video);
  return `<div class="frame">
    <div class="slides">${media.map(slideHTML).join("")}</div>
    ${media.length > 1 ? `<div class="dots">${media.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>
      <button class="nav prev" aria-label="Previous photo">${I.chevL}</button>
      <button class="nav next" aria-label="Next photo">${I.chevR}</button>` : ""}
    ${hasVideo ? `<button class="mute" aria-label="Toggle sound">${muted ? I.muted : I.sound}</button>` : ""}
  </div>`;
}

function actionsHTML(p) {
  const first = p.media.find((m) => m.src);
  return `<div class="actions">
    <span title="Likes">${I.heart}${num(p.likes)}</span>
    <span title="Comments">${I.chat}${num(p.comments)}</span>
    <span class="spacer"></span>
    <button class="save${p.saved ? " on" : ""}" data-sc="${esc(p.shortcode)}" aria-pressed="${!!p.saved}" title="${p.saved ? "Remove from Saved" : "Save"}" aria-label="Save">${p.saved ? I.marked : I.mark}</button>
    ${first ? `<a class="dl" href="${esc(dlHref(p, 0))}" download title="Download this photo or video" aria-label="Download">${I.down}</a>` : ""}
    <a href="https://www.instagram.com/p/${esc(p.shortcode)}/" target="_blank" rel="noopener noreferrer" title="Open on Instagram">${I.out}</a>
  </div>`;
}

// e.g. marisol.frames_C0aB12xYz_2.jpg, so carousel slides don't overwrite each other
// The server names the file and picks the real extension (some "jpg"s are really WebP).
function dlHref(p, i) {
  const m = p.media[i] || p.media[0];
  const name = `${p.username}_${p.shortcode}${p.media.length > 1 ? `_${i + 1}` : ""}`;
  return `${m.src}?dl=${encodeURIComponent(name)}`;
}

// Point the download link at whichever carousel slide is showing, right before the click goes through.
function wireDownloads(root, posts) {
  $$("a.dl", root).forEach((a) => a.addEventListener("click", () => {
    const holder = a.closest(".card, .post-view");
    const p = posts[holder?.dataset.sc];
    if (!p) return;
    const slides = $(".slides", holder);
    const i = slides ? Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)) : 0;
    a.href = dlHref(p, i);
  }));
}
const postIndex = {};

function cardHTML(p) {
  postIndex[p.shortcode] = p;
  return `<article class="card" data-sc="${esc(p.shortcode)}">
    <div class="card-head">
      <a href="#/u/${esc(p.username)}"><img class="avatar" src="${esc(p.avatar || AVATAR_FALLBACK)}" alt="" loading="lazy"></a>
      <div class="who"><a href="#/u/${esc(p.username)}">${esc(p.username)}</a><time>${ago(p.taken_at)}</time></div>
    </div>
    ${frameHTML(p)}
    <div class="card-foot">
      ${actionsHTML(p)}
      ${p.caption ? `<p class="caption clamp"><b>${esc(p.username)}</b>${esc(p.caption)}</p>` : ""}
    </div>
  </article>`;
}

// One saved state per post, mirrored on every button showing it (feed card + open post).
function paintSave(sc, on) {
  $$(`button.save[data-sc="${CSS.escape(sc)}"]`).forEach((b) => {
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    b.title = on ? "Remove from Saved" : "Save";
    b.innerHTML = on ? I.marked : I.mark;
  });
}

function wireSaves(root) {
  $$("button.save", root).forEach((b) => b.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    const sc = b.dataset.sc, on = b.getAttribute("aria-pressed") !== "true";
    paintSave(sc, on);
    if (postIndex[sc]) postIndex[sc].saved = on;
    try {
      await api(`/api/saved/${encodeURIComponent(sc)}`, { method: on ? "POST" : "DELETE" });
      toast(on ? "Saved" : "Removed from Saved");
    } catch (err) {
      paintSave(sc, !on);
      toast(err.message);
    }
  }));
}

function wireCards(root) {
  wireVideos(root); wireSlides(root); wireDownloads(root, postIndex); wireSaves(root);
  $$(".caption.clamp", root).forEach((c) => c.addEventListener("click", () => c.classList.remove("clamp"), { once: true }));
}

function gridHTML(posts) {
  return posts.map((p) => `<a href="#/p/${esc(p.shortcode)}" aria-label="Post from ${ago(p.taken_at)}">
      <img src="${esc(p.thumb || "")}" alt="" loading="lazy" decoding="async">
      ${p.kind === "carousel" ? `<span class="badge">${I.carousel}</span>` : p.kind === "reel" || p.kind === "video" ? `<span class="badge">${I.play}</span>` : ""}
    </a>`).join("");
}

function empty(title, body, action = "") {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${body}</p>${action}</div>`;
}

/* ================================================================ views */

// Group filter for Feed and Reels. The choice is remembered per device.
async function groupBar() {
  const { groups } = await api("/api/groups").catch(() => ({ groups: [] }));
  let gid = +localStorageGet("peek.group") || 0;
  if (gid && !groups.some((g) => g.id === gid)) gid = 0;
  const html = groups.length ? `<div class="chips" role="tablist" aria-label="Filter by group">
      <button role="tab" data-g="0" aria-selected="${!gid}">All</button>
      ${groups.map((g) => `<button role="tab" data-g="${g.id}" aria-selected="${g.id === gid}">${esc(g.name)}</button>`).join("")}
    </div>` : "";
  return { gid, html };
}

function wireGroupBar(root) {
  $$(".chips button", root).forEach((b) => b.addEventListener("click", () => {
    localStorageSet("peek.group", b.dataset.g);
    render();
  }));
}

let stopPolling = () => {};

async function feedView() {
  const { gid, html } = await groupBar();
  const gq = gid ? `&group=${gid}` : "";
  view.innerHTML = `<div class="strip" id="strip" hidden></div>${html}<div id="cards"><div class="loading"></div></div><div id="more"></div>`;
  wireGroupBar(view);
  loadStrip();
  const cards = $("#cards");
  const first = await api(`/api/feed?_=1${gq}`);
  if (!first.posts.length) {
    const s = await api("/api/status");
    cards.innerHTML = gid ? empty("Nothing in this group yet", "Posts from accounts in this group show up here. Add accounts to it on the Following page.")
      : s.following
      ? empty("Nothing cached yet", "Posts from the accounts you follow show up here after their first refresh. That usually takes a minute or two.")
      : empty("Your feed is empty", "Follow a few public accounts and their posts will collect here.", `<a class="btn primary" href="#/search">${I.plus}Look someone up</a>`);
    return;
  }
  cards.innerHTML = first.posts.map(cardHTML).join("");
  wireCards(cards);

  // "You're caught up": a divider above the first post that was already in the feed last time.
  const seenAt = first.seen_at, newest = first.posts[0].taken_at;
  let marked = !seenAt || newest <= seenAt;  // nothing new: no marker
  const placeMarker = () => {
    if (marked) return;
    const card = $$(".card", cards).find((c) => (postIndex[c.dataset.sc]?.taken_at ?? 0) <= seenAt);
    if (!card) return;
    marked = true;
    card.insertAdjacentHTML("beforebegin",
      `<div class="caught-up" role="separator"><span>You're caught up</span><small>Posts below were here last time</small></div>`);
  };
  placeMarker();
  if (!gid && (!seenAt || newest > seenAt)) {  // a filtered view hasn't seen the other groups
    setTimeout(() => api("/api/feed/seen", { method: "POST", body: { ts: newest } }).catch(() => {}), 2000);
  }

  let next = first.next;
  if (next) onSentinel($("#more"), async () => {
    const page = await api(`/api/feed?before=${next}${gq}`);
    const frag = document.createElement("div");
    frag.innerHTML = page.posts.map(cardHTML).join("");
    wireCards(frag);
    cards.append(...frag.children);
    placeMarker();
    next = page.next;
    return !!next;
  });
}

let storyGroups = [];
async function loadStrip() {
  const strip = $("#strip");
  try {
    const { groups } = await api("/api/stories");
    storyGroups = groups;
    if (!groups.length || !strip) return;
    strip.hidden = false;
    strip.innerHTML = groups.map((g, i) => `<button data-i="${i}" aria-label="Stories from ${esc(g.username)}">
        <span class="ring ${g.all_seen ? "seen" : ""}"><img src="${esc(g.avatar || AVATAR_FALLBACK)}" alt=""></span>
        <span>${esc(g.username)}</span></button>`).join("");
    $$("button", strip).forEach((b) => b.addEventListener("click", () => openStories(+b.dataset.i)));
  } catch { /* stories are a bonus; never break the feed */ }
}

async function reelsView() {
  view.innerHTML = `<div class="loading"></div>`;
  const { gid, html } = await groupBar();
  const gq = gid ? `&group=${gid}` : "";
  let { posts, next } = await api(`/api/feed?kind=reels&limit=8${gq}`);
  if (!posts.length) {
    view.innerHTML = html + empty("No reels yet", gid ? "Reels from accounts in this group land here once they're cached."
      : "Reels and videos from the accounts you follow land here once they're cached.");
    wireGroupBar(view);
    return;
  }
  view.innerHTML = `${html}<div class="reels${html ? " with-chips" : ""}" id="reels"></div>`;
  wireGroupBar(view);
  const box = $("#reels");
  const reelHTML = (p) => {
    const v = p.media.find((m) => m.video && m.src) || p.media[0];
    return `<section class="reel">
      <video src="${esc(v?.src || "")}" poster="${esc(v?.poster || p.thumb || "")}" playsinline loop muted preload="metadata" data-auto></video>
      <button class="mute" aria-label="Toggle sound">${muted ? I.muted : I.sound}</button>
      <div class="reel-meta">
        <a href="#/u/${esc(p.username)}"><img class="avatar" src="${esc(p.avatar || AVATAR_FALLBACK)}" alt="">${esc(p.username)}</a>
        <span style="opacity:.7;font-size:13px;margin-left:6px">${ago(p.taken_at)}</span>
        ${p.caption ? `<p>${esc(p.caption)}</p>` : ""}
      </div>
    </section>`;
  };
  const add = (list) => {
    const frag = document.createElement("div");
    frag.innerHTML = list.map(reelHTML).join("");
    $$("video", frag).forEach((v) => v.addEventListener("click", () => (v.paused ? v.play() : v.pause())));
    wireVideos(frag);
    box.append(...frag.children);
  };
  add(posts);
  const tail = document.createElement("div");
  box.append(tail);
  if (next) onSentinel(tail, async () => {
    const page = await api(`/api/feed?kind=reels&limit=8&before=${next}${gq}`);
    tail.remove(); add(page.posts); box.append(tail);
    next = page.next;
    return !!next;
  });
}

async function savedView() {
  view.innerHTML = `<div class="page-pad page-head"><h1 class="page-title">Saved</h1><p class="hint" id="saved-count"></p></div>
    <div id="saved-body"><div class="loading"></div></div><div id="saved-more"></div>`;
  const first = await api("/api/saved");
  const body = $("#saved-body");
  if (!first.posts.length) {
    body.innerHTML = empty("Nothing saved yet", `Tap the bookmark on any post to keep it here. Saved posts stay on disk even if you unfollow the account.`);
    return;
  }
  $("#saved-count").textContent = `${first.count.toLocaleString()} saved ${first.count === 1 ? "post" : "posts"}`;
  body.innerHTML = `<div class="grid" id="grid">${gridHTML(first.posts)}</div>`;
  let next = first.next;
  if (next) onSentinel($("#saved-more"), async () => {
    const page = await api(`/api/saved?before=${next}`);
    $("#grid").insertAdjacentHTML("beforeend", gridHTML(page.posts));
    next = page.next;
    return !!next;
  });
}

function searchView() {
  view.innerHTML = `<div class="page-pad">
    <h1 class="page-title">Look up</h1>
    <form class="lookup" id="lookup">
      <input name="u" type="search" placeholder="Username, profile link, or words from a caption" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Search">
      <button class="btn primary">Open</button>
    </form>
    <p class="hint">Typing searches everything Peek has saved. Open looks up any public account on Instagram.</p>
    <div id="results"></div>
  </div>`;
  const input = $("#lookup input"), results = $("#results");
  input.focus();
  $("#lookup").addEventListener("submit", (e) => {
    e.preventDefault();
    let u = input.value.trim().replace(/^@/, "");
    const m = u.match(/instagram\.com\/([^/?#]+)/i);
    if (m) u = m[1];
    if (u) location.hash = `#/u/${encodeURIComponent(u.toLowerCase())}`;
  });

  const showRecent = () => {
    const recent = JSON.parse(localStorageGet("peek.recent") || "[]");
    results.innerHTML = recent.length ? `<h2 class="sub">Recently viewed</h2><ul class="people">${
      recent.map((u) => `<li><div class="who"><a href="#/u/${esc(u)}">@${esc(u)}</a></div></li>`).join("")}</ul>` : "";
  };
  let timer, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return showRecent();
    timer = setTimeout(async () => {
      const mine = ++seq;
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null);
      if (!r || mine !== seq) return;  // a newer search already started
      const people = r.accounts.map((a) => `<li>
          <a href="#/u/${esc(a.username)}"><img class="avatar" src="${esc(a.avatar || AVATAR_FALLBACK)}" alt=""></a>
          <div class="who"><a href="#/u/${esc(a.username)}">${esc(a.username)}</a>
            <small>${esc(a.full_name || "")}${a.followed ? `${a.full_name ? ", " : ""}following` : ""}</small></div></li>`).join("");
      results.innerHTML = (people ? `<h2 class="sub">Accounts</h2><ul class="people">${people}</ul>` : "")
        + (r.posts.length ? `<h2 class="sub">Posts mentioning “${esc(q)}”</h2>` : "")
        + (!people && !r.posts.length ? `<p class="hint">Nothing saved matches “${esc(q)}”. Press Open to look the account up on Instagram.</p>` : "");
      if (r.posts.length) {
        results.insertAdjacentHTML("beforeend", `<div class="grid search-grid" id="grid">${gridHTML(r.posts)}</div>`);
      }
    }, 250);
  });
  showRecent();
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function rememberRecent(u) {
  const list = JSON.parse(localStorageGet("peek.recent") || "[]").filter((x) => x !== u);
  list.unshift(u);
  localStorageSet("peek.recent", JSON.stringify(list.slice(0, 8)));
}

async function followingView() {
  view.innerHTML = `<div class="page-pad"><h1 class="page-title">Following</h1>
    <form class="lookup" id="add"><input name="u" placeholder="Add a username" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Username to follow"><button class="btn primary">${I.plus}Follow</button></form>
    <section class="groups-box">
      <h2 class="sub">Groups</h2>
      <div class="group-list" id="group-list"></div>
      <form class="new-group" id="new-group"><input name="g" placeholder="New group, e.g. Friends" maxlength="30" autocomplete="off" required aria-label="New group name"><button class="btn">${I.plus}Add</button></form>
    </section>
    <ul class="people" id="people"><li class="loading"></li></ul>
    <div class="status-box" id="status"></div></div>`;

  $("#new-group").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/groups", { method: "POST", body: { name: e.target.g.value } });
      render();
    } catch (err) { toast(err.message); }
  });

  $("#add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.target.u;
    try {
      const r = await api("/api/accounts", { method: "POST", body: { username: input.value } });
      input.value = "";
      toast(`Following @${r.username}. Fetching their posts now.`);
      render();
    } catch (err) { toast(err.message); }
  });

  const [{ accounts }, s, { groups }] = await Promise.all([api("/api/accounts"), api("/api/status"), api("/api/groups")]);
  $("#group-list").innerHTML = groups.length
    ? groups.map((g) => `<span class="chip-static">${esc(g.name)} <small>${g.count}</small>
        <button data-del-group="${g.id}" data-name="${esc(g.name)}" aria-label="Delete group ${esc(g.name)}">${I.close}</button></span>`).join("")
    : `<p class="hint">Group accounts (friends, photographers…) to filter the feed and reels by group.</p>`;
  $$("[data-del-group]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Delete the group "${b.dataset.name}"? The accounts stay followed.`)) return;
    await api(`/api/groups/${b.dataset.delGroup}`, { method: "DELETE" });
    render();
  }));
  const ul = $("#people");
  ul.innerHTML = accounts.length ? accounts.map((a) => `<li>
      <a href="#/u/${esc(a.username)}"><img class="avatar" src="${esc(a.avatar || AVATAR_FALLBACK)}" alt=""></a>
      <div class="who">
        <a href="#/u/${esc(a.username)}">${esc(a.username)}</a>${a.busy ? '<span class="dot-busy" title="Refreshing"></span>' : ""}
        ${a.last_error ? `<small class="err">${esc(a.last_error)}</small>`
          : `<small>${a.fetched_at ? `Checked ${ago(a.fetched_at)} ago` : "Waiting for first fetch"}${a.latest_post ? `, latest post ${ago(a.latest_post)}` : ""}</small>`}
        ${groups.length ? `<div class="member" data-user="${esc(a.username)}">${groups.map((g) =>
          `<button aria-pressed="${a.groups.includes(g.id)}" data-g="${g.id}">${esc(g.name)}</button>`).join("")}</div>` : ""}
      </div>
      <button class="btn" data-unfollow="${esc(a.username)}">Unfollow</button>
    </li>`).join("") : `<li>${empty("Not following anyone", "Add a public account above. Peek checks everyone you follow every few hours in the background.")}</li>`;

  $$(".member", ul).forEach((box) => $$("button", box).forEach((b) => b.addEventListener("click", async () => {
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    const ids = $$("button[aria-pressed='true']", box).map((x) => +x.dataset.g);
    try { await api(`/api/accounts/${encodeURIComponent(box.dataset.user)}/groups`, { method: "PUT", body: { ids } }); }
    catch (err) { toast(err.message); render(); }
  })));

  $$("[data-unfollow]", ul).forEach((b) => b.addEventListener("click", async () => {
    const u = b.dataset.unfollow;
    const purge = confirm(`Unfollow @${u}.\n\nAlso delete the posts and media Peek saved for them?\nOK deletes them, Cancel keeps them.`);
    await api(`/api/accounts/${encodeURIComponent(u)}?purge=${purge}`, { method: "DELETE" });
    toast(`Unfollowed @${u}`);
    render();
  }));

  const nxt = s.next_cycle ? new Date(s.next_cycle * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon";
  const cycle = s.cycle_running ? "A refresh is running now."
    : s.last_cycle ? `Last full refresh ${ago(s.last_cycle)} ago, next around ${nxt}.` : `First full refresh starts ${nxt}.`;
  $("#status").innerHTML = `<b>${s.posts.toLocaleString()}</b> posts saved from <b>${s.following}</b> accounts. ${cycle}<br>
    ${s.logged_in ? "Stories are on, using your burner session." : "Running logged out, so stories are off. Add a burner session in the server config to turn them on."}
    ${s.paused_until ? `<br><b>Instagram is rate-limiting.</b> Fetching is paused until ${new Date(s.paused_until * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}; saved posts still work.` : ""}`;
}

async function profileView(username) {
  stopPolling();
  view.innerHTML = `<div class="loading"></div>`;
  let tab = "posts";
  let data = null;
  let a = null;
  const shown = new Set();
  const kindQ = () => (tab === "reels" ? "&kind=reels" : "");
  const url = (extra = "") => `/api/u/${encodeURIComponent(username)}?_=1${kindQ()}${extra}`;

  // While a fetch runs we poll, but only the header and any *new* tiles change. Re-rendering
  // the grid every poll would abort every image mid-download, which is why it looked empty.
  const poll = async () => {
    stopPolling();
    const fresh = await api(url());
    const wasBusy = a.busy;
    a = fresh.account;
    paintHead();
    const top = data.posts[0]?.taken_at || 0;
    const newer = fresh.posts.filter((p) => !shown.has(p.shortcode) && p.taken_at > top);
    if (!data.posts.length && fresh.posts.length) { data = fresh; paintBody(); }
    else if (newer.length) {
      data.posts.unshift(...newer);
      newer.forEach((p) => shown.add(p.shortcode));
      $("#grid")?.insertAdjacentHTML("afterbegin", gridHTML(newer));
    }
    if (a.busy) {
      const t = setTimeout(poll, 2000);
      stopPolling = () => clearTimeout(t);
    } else if (wasBusy) {
      if (!data.posts.length) paintBody(); else wireGridFoot();
    }
  };

  const open = async () => {
    stopPolling();
    data = await api(url());
    a = data.account;
    rememberRecent(a.username);
    view.innerHTML = `<section class="profile-head" id="phead"></section>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected="${tab === "posts"}" data-tab="posts">Posts</button>
        <button role="tab" aria-selected="${tab === "reels"}" data-tab="reels">Reels</button>
      </div>
      <div id="pbody"></div>`;
    $$(".seg button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab !== tab) { tab = b.dataset.tab; open(); } }));
    paintHead();
    paintBody();
    if (a.busy) { const t = setTimeout(poll, 2000); stopPolling = () => clearTimeout(t); }
  };

  const paintHead = () => {
    const fetched = !!a.fetched_at;
    $("#phead").innerHTML = `
      <img class="big-avatar" src="${esc(a.avatar || AVATAR_FALLBACK)}" alt="">
      <div><h1>${esc(a.full_name || a.username)}</h1><div class="handle">@${esc(a.username)}${a.busy ? '<span class="dot-busy" title="Fetching"></span>' : ""}</div></div>
      <div class="stats">${fetched ? `<span><b>${num(a.post_count)}</b> posts</span><span><b>${num(a.followers)}</b> followers</span><span><b>${num(a.following)}</b> following</span>` : ""}</div>
      ${a.bio ? `<p class="bio">${esc(a.bio)}</p>` : ""}
      <div class="profile-actions">
        <button class="btn ${a.followed ? "" : "primary"}" id="follow">${a.followed ? `${I.check}Following` : `${I.plus}Follow`}</button>
        <button class="btn" id="refresh" ${a.busy ? "disabled" : ""}>${I.refresh}${a.busy ? "Fetching" : "Refresh"}</button>
        <a class="btn" href="https://www.instagram.com/${esc(a.username)}/" target="_blank" rel="noopener noreferrer">${I.out}Instagram</a>
      </div>
      ${a.last_error ? `<p class="notice">${esc(a.last_error)}</p>` : ""}
      ${a.is_private ? `<p class="notice">This account is private, so only its profile details are visible.</p>` : ""}`;
    $("#follow").addEventListener("click", async () => {
      if (a.followed) await api(`/api/accounts/${encodeURIComponent(a.username)}`, { method: "DELETE" });
      else await api("/api/accounts", { method: "POST", body: { username: a.username } });
      toast(a.followed ? `Unfollowed @${a.username}` : `Following @${a.username}`);
      a.followed = !a.followed; paintHead();
    });
    $("#refresh").addEventListener("click", async () => {
      await api(`/api/u/${encodeURIComponent(a.username)}/refresh`, { method: "POST" });
      a.busy = true; paintHead();
      const t = setTimeout(poll, 1500); stopPolling = () => clearTimeout(t);
    });
  };

  const paintBody = () => {
    shown.clear();
    data.posts.forEach((p) => shown.add(p.shortcode));
    $("#pbody").innerHTML = data.posts.length
      ? `<div class="grid" id="grid">${gridHTML(data.posts)}</div><div class="grid-foot" id="grid-foot"></div>`
      : a.busy ? `<div class="loading"></div>`
      : `${empty(tab === "reels" ? "No reels saved" : "No posts saved", a.last_error ? "Peek couldn't get posts this time. Try Refresh in a while." : "Nothing here yet.")}<div class="grid-foot" id="grid-foot"></div>`;
    if (!a.busy) wireGridFoot();
  };

  // Older posts come in two layers: pages already cached on the server (free, loaded as
  // you scroll), then Instagram itself (costs requests, so only on an explicit tap).
  const appendPage = async () => {
    const before = data.next || data.posts.at(-1)?.taken_at;
    const page = await api(url(before ? `&before=${before}` : ""));
    const fresh = page.posts.filter((p) => !shown.has(p.shortcode));
    fresh.forEach((p) => shown.add(p.shortcode));
    data.posts.push(...fresh);
    data.next = page.next;
    if (!$("#grid") && fresh.length) $("#grid-foot").insertAdjacentHTML("beforebegin", `<div class="grid" id="grid"></div>`);
    $("#grid")?.insertAdjacentHTML("beforeend", gridHTML(fresh));
    return fresh.length;
  };

  // Put posts into the grid at their date position. New "older" posts can still be newer
  // than the bottom tile (e.g. an old pinned post), so appending isn't enough.
  const insertSorted = (posts) => {
    posts = posts.filter((p) => !shown.has(p.shortcode));
    if (!posts.length) return;
    if (!$("#grid")) {
      $("#pbody").querySelector(".empty")?.remove();
      $("#grid-foot").insertAdjacentHTML("beforebegin", `<div class="grid" id="grid"></div>`);
    }
    const grid = $("#grid");
    for (const p of posts) {
      shown.add(p.shortcode);
      let i = data.posts.findIndex((q) => q.taken_at < p.taken_at);
      if (i < 0) i = data.posts.length;
      data.posts.splice(i, 0, p);
      const tmp = document.createElement("div");
      tmp.innerHTML = gridHTML([p]);
      grid.insertBefore(tmp.firstElementChild, grid.children[i] || null);
    }
  };

  const wireGridFoot = () => {
    const foot = $("#grid-foot");
    if (!foot) return;
    const showButton = (msg = "") => {
      const saved = a.post_count ? `${num(a.cached)} of ${num(a.post_count)} posts saved` : `${num(a.cached)} posts saved`;
      if (a.is_private) { foot.innerHTML = ""; return; }
      if (a.history_done) {
        foot.innerHTML = `<p>That's every post from @${esc(a.username)}. ${num(a.cached)} saved.</p>`;
        return;
      }
      foot.innerHTML = `${msg ? `<p class="foot-note">${esc(msg)}</p>` : ""}
        <button class="btn" id="older">Load older posts</button><p>${saved}</p>`;
      $("#older").addEventListener("click", loadOlder);
    };
    const loadOlder = async () => {
      const btn = $("#older");
      btn.disabled = true; btn.textContent = "Fetching from Instagram";
      try {
        const r = await api(`/api/u/${encodeURIComponent(a.username)}/older`, { method: "POST" });
        a.cached = r.cached; a.history_done = r.done;
        insertSorted(r.posts.filter((p) => tab !== "reels" || p.kind === "reel" || p.kind === "video"));
        showButton(r.note || (r.added || r.done ? "" : "Instagram didn't return any more posts this time."));
      } catch (e) {
        showButton(e.message);
      }
    };
    if (data.next) {
      foot.innerHTML = `<div class="loading"></div>`;
      onSentinel(foot, async () => {
        await appendPage();
        if (data.next) return true;
        showButton();
        return false;
      });
    } else showButton();
  };

  try { await open(); }
  catch (e) { if (e.message !== "auth") view.innerHTML = empty("Couldn't open that profile", esc(e.message)); }
}

/* ================================================================ post overlay */

async function openPost(shortcode) {
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button><div class="loading" style="margin:auto"></div>`;
  $(".ov-close", overlay).addEventListener("click", closeOverlay);
  try {
    const p = await api(`/api/p/${encodeURIComponent(shortcode)}`);
    postIndex[p.shortcode] = p;
    overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button>
      <div class="post-view" data-sc="${esc(p.shortcode)}">
        ${frameHTML(p)}
        <aside>
          <div class="card-head">
            <a href="#/u/${esc(p.username)}"><img class="avatar" src="${esc(p.avatar || AVATAR_FALLBACK)}" alt=""></a>
            <div class="who"><a href="#/u/${esc(p.username)}">${esc(p.username)}</a><time>${new Date(p.taken_at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time></div>
          </div>
          ${actionsHTML(p)}
          ${p.caption ? `<p class="caption">${esc(p.caption)}</p>` : ""}
        </aside>
      </div>`;
    $(".ov-close", overlay).addEventListener("click", closeOverlay);
    $$(".post-view a[href^='#/u/']", overlay).forEach((a) => a.addEventListener("click", () => hideOverlay()));
    wireCards(overlay);
    wirePostSteps(p.shortcode);
  } catch (e) {
    overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button>${empty("Post not available", esc(e.message))}`;
    $(".ov-close", overlay).addEventListener("click", closeOverlay);
  }
}

/* Next/previous post: the list is whatever grid the post was opened from (a profile,
   Saved, search results), read straight from the page underneath the overlay. */
function postNeighbours(sc) {
  const codes = $$('#view a[href^="#/p/"]').map((a) => decodeURIComponent(a.getAttribute("href").slice(4)));
  const i = codes.indexOf(sc);
  return i < 0 ? {} : { prev: codes[i - 1], next: codes[i + 1] };
}

function goPost(dir) {
  const sc = $(".post-view", overlay)?.dataset.sc;
  const target = sc && postNeighbours(sc)[dir > 0 ? "next" : "prev"];
  if (!target) return false;
  // Keep the grid underneath in step, which also loads the next page when near the end.
  $(`#view a[href="#/p/${CSS.escape(encodeURIComponent(target))}"], #view a[href="#/p/${CSS.escape(target)}"]`)
    ?.scrollIntoView({ block: "center" });
  location.replace(`#/p/${encodeURIComponent(target)}`);
  return true;
}

function wirePostSteps(sc) {
  const nb = postNeighbours(sc);
  overlay.insertAdjacentHTML("beforeend", `
    <button class="post-step prev" aria-label="Previous post" ${nb.prev ? "" : "hidden"}>${I.chevL}</button>
    <button class="post-step next" aria-label="Next post" ${nb.next ? "" : "hidden"}>${I.chevR}</button>`);
  $(".post-step.prev", overlay).addEventListener("click", () => goPost(-1));
  $(".post-step.next", overlay).addEventListener("click", () => goPost(1));

  // Swipe past the first/last photo (or on a single photo) to move to the neighbouring post.
  const frame = $(".post-view .frame", overlay);
  let x0 = null, y0 = null, startPos = null;
  frame?.addEventListener("touchstart", (e) => {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; startPos = slidePos(frame);
  }, { passive: true });
  frame?.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && startPos.i === startPos.n - 1) goPost(1);
    else if (dx > 0 && startPos.i === 0) goPost(-1);
  });
}

function hideOverlay() {
  $$("video", overlay).forEach((v) => v.pause());
  overlay.hidden = true;
  overlay.innerHTML = "";
  document.body.style.overflow = "";
}

let cameFromApp = false;
function closeOverlay() {
  if (location.hash.startsWith("#/p/")) {
    if (cameFromApp) history.back();
    else location.hash = "#/";
  } else hideOverlay();
}

/* ================================================================ stories viewer */

const IMAGE_SECONDS = 5;
let storyState = null;

function openStories(groupIndex) {
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  storyState = { gi: groupIndex, ii: firstUnseen(storyGroups[groupIndex]), seen: new Set(), raf: 0, paused: false };
  showStory();
  document.addEventListener("keydown", storyKeys);
}

function firstUnseen(g) {
  const i = g.items.findIndex((it) => !it.seen);
  return i < 0 ? 0 : i;
}

function showStory() {
  const st = storyState, g = storyGroups[st.gi], it = g.items[st.ii];
  cancelAnimationFrame(st.raf);
  st.seen.add(it.id); it.seen = true;
  overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close stories">${I.close}</button>
    <div class="story">
      <div class="story-media">${it.video
        ? `<video src="${esc(it.src)}" poster="${esc(it.poster || "")}" playsinline autoplay></video>`
        : `<img src="${esc(it.src)}" alt="">`}</div>
      <div class="story-top">
        <div class="bars">${g.items.map((_, i) => `<i class="${i < st.ii ? "done" : ""}"><b></b></i>`).join("")}</div>
        <div class="story-who">
          <img class="avatar" src="${esc(g.avatar || AVATAR_FALLBACK)}" alt="">
          <a href="#/u/${esc(g.username)}">${esc(g.username)}</a><time>${ago(it.taken_at)}</time>
        </div>
      </div>
      <div class="story-tools">
        ${it.video ? `<button class="icon-btn" id="s-mute" aria-label="Toggle sound">${muted ? I.muted : I.sound}</button>` : ""}
        <a class="icon-btn" href="${esc(it.src)}" download="${esc(`${g.username}_story_${it.id}.${it.src.split(".").pop()}`)}" aria-label="Download">${I.down}</a>
      </div>
      <button class="tap prev" aria-label="Previous"></button>
      <button class="tap next" aria-label="Next"></button>
    </div>`;

  const bar = $$(".bars i b", overlay)[st.ii];
  const video = $("video", overlay);
  $(".ov-close", overlay).addEventListener("click", closeStories);
  $(".tap.prev", overlay).addEventListener("click", () => stepStory(-1));
  $(".tap.next", overlay).addEventListener("click", () => stepStory(1));
  $(".story-who a", overlay).addEventListener("click", () => closeStories(false));
  $("#s-mute", overlay)?.addEventListener("click", () => {
    muted = !muted; video.muted = muted; $("#s-mute", overlay).innerHTML = muted ? I.muted : I.sound;
  });

  // hold to pause
  const story = $(".story", overlay);
  const hold = (on) => { st.paused = on; if (video) on ? video.pause() : video.play().catch(() => {}); };
  let holdTimer;
  story.addEventListener("pointerdown", () => { holdTimer = setTimeout(() => hold(true), 220); });
  story.addEventListener("pointerup", () => { clearTimeout(holdTimer); if (st.paused) { hold(false); story.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true }); } });

  // swipe down to close
  let y0 = null;
  story.addEventListener("touchstart", (e) => (y0 = e.touches[0].clientY), { passive: true });
  story.addEventListener("touchend", (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) closeStories(); y0 = null; });

  let elapsed = 0, last = performance.now();
  if (video) {
    video.muted = muted;
    video.play().catch(() => { video.muted = true; muted = true; video.play().catch(() => {}); });
    video.addEventListener("ended", () => stepStory(1));
  }
  const tick = (now) => {
    if (!st.paused) elapsed += (now - last) / 1000;
    last = now;
    const dur = video ? (video.duration || 15) : IMAGE_SECONDS;
    const pct = video ? (video.currentTime / dur) * 100 : (elapsed / dur) * 100;
    bar.style.width = Math.min(100, pct) + "%";
    if (!video && elapsed >= dur) return stepStory(1);
    st.raf = requestAnimationFrame(tick);
  };
  st.raf = requestAnimationFrame(tick);
}

function stepStory(dir) {
  const st = storyState;
  if (!st) return;
  const g = storyGroups[st.gi];
  st.ii += dir;
  if (st.ii >= g.items.length) {
    st.gi += 1;
    if (st.gi >= storyGroups.length) return closeStories();
    st.ii = firstUnseen(storyGroups[st.gi]);
  } else if (st.ii < 0) {
    if (st.gi === 0) { st.ii = 0; }
    else { st.gi -= 1; st.ii = storyGroups[st.gi].items.length - 1; }
  }
  showStory();
}

function storyKeys(e) {
  if (e.key === "ArrowRight") stepStory(1);
  else if (e.key === "ArrowLeft") stepStory(-1);
  else if (e.key === "Escape") closeStories();
}

function closeStories(repaint = true) {
  const st = storyState;
  if (!st) return;
  cancelAnimationFrame(st.raf);
  document.removeEventListener("keydown", storyKeys);
  if (st.seen.size) api("/api/stories/seen", { method: "POST", body: { ids: [...st.seen] } }).catch(() => {});
  storyState = null;
  hideOverlay();
  if (repaint) loadStrip();
}

/* ================================================================ login */

function showLogin() {
  document.body.classList.add("locked");
  $(".tabs").hidden = true; $(".top").hidden = true;
  view.innerHTML = `<div class="login"><span class="wordmark">peek</span>
    <form id="login"><input type="password" name="pw" placeholder="Password" autocomplete="current-password" required aria-label="Password"><button class="btn primary">Unlock</button></form></div>`;
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: e.target.pw.value }) });
    if (!res.ok) return toast("That password didn't work");
    $(".tabs").hidden = false; $(".top").hidden = false;
    render();
  });
}

/* ================================================================ router */

let baseRendered = false;
let baseHash = null;
async function render() {
  const hash = location.hash || "#/";
  const [, route, arg] = hash.split("/");

  if (route === "p") {
    if (!baseRendered) { baseRendered = true; baseHash = "#/"; feedView().catch(() => {}); }
    return openPost(decodeURIComponent(arg));
  }
  if (!overlay.hidden && !storyState) hideOverlay();
  if (storyState) closeStories(false);

  stopPolling();
  baseRendered = true;
  baseHash = hash;
  const tab = route === "u" ? "" : route || "feed";
  $$(".tabs a").forEach((a) => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  view.classList.toggle("wide", route === "u" || route === "saved");
  window.scrollTo(0, 0);

  try {
    if (route === "u" && arg) await profileView(decodeURIComponent(arg));
    else if (route === "reels") await reelsView();
    else if (route === "search") searchView();
    else if (route === "saved") await savedView();
    else if (route === "following") await followingView();
    else await feedView();
  } catch (e) {
    if (e.message !== "auth") view.innerHTML = empty("Something went wrong", esc(e.message), `<button class="btn" onclick="location.reload()">Reload</button>`);
  }
}

window.addEventListener("hashchange", (e) => {
  cameFromApp = true;
  const h = location.hash || "#/";
  // A post opens over whatever page is showing; closing it returns to that page untouched.
  if (h.startsWith("#/p/")) return openPost(decodeURIComponent(h.split("/")[2]));
  if (!overlay.hidden && !storyState && h === baseHash) return hideOverlay();
  render();
});

document.addEventListener("keydown", (e) => {
  if (overlay.hidden || storyState) return;
  if (e.key === "Escape") return closeOverlay();
  const frame = $(".post-view .frame", overlay);
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    // Left/Right page the open post's photos, then roll over to the next/previous post.
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1, { i, n } = slidePos(frame);
    if ((dir > 0 && i < n - 1) || (dir < 0 && i > 0)) stepSlides(frame, dir);
    else goPost(dir);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    goPost(e.key === "ArrowDown" ? 1 : -1);
  }
});

$("#refresh-all").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.classList.add("spinning");
  try {
    const r = await api("/api/refresh-all", { method: "POST" });
    toast(r.already ? "A refresh is already running" : "Refreshing everyone you follow. New posts will trickle in over the next few minutes.");
  } catch (err) { toast(err.message); }
  setTimeout(() => btn.classList.remove("spinning"), 1500);
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
