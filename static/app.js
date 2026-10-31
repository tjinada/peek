"use strict";

/* ================================================================ basics */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $("#view");
const overlay = $("#overlay");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K" : n.toLocaleString();
const AVATAR_FALLBACK = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#3b3546"/><circle cx="20" cy="16" r="7" fill="#5a5266"/><path d="M6 38c2-8 8-12 14-12s12 4 14 12" fill="#5a5266"/></svg>');

// Caption text with @mentions linked to the profile in Peek and #hashtags to a search of
// saved posts. Works on the raw text and escapes the rest, so entities like &#39; never
// look like hashtags. Usernames: letters, digits, _ and ., not ending in a dot.
const CAPTION_LINKS = /(?<![\w.@])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)|(?<![\w&#])#(?=[\p{N}_]*\p{L})([\p{L}\p{N}_]+)/gu;
function linkify(text) {
  let out = "", last = 0;
  for (const m of String(text ?? "").matchAll(CAPTION_LINKS)) {
    out += esc(text.slice(last, m.index));
    out += m[1] != null
      ? `<a class="tag" href="#/u/${esc(m[1].toLowerCase())}">@${esc(m[1])}</a>`
      : `<a class="tag" href="#/search/${encodeURIComponent("#" + m[2])}">#${esc(m[2])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(String(text ?? "").slice(last));
}

// "5m ago", "3h ago", "just now" (never "just now ago")
const agoText = (ts) => { const a = ago(ts); return /^\d+[mhd]$/.test(a) ? `${a} ago` : a === "just now" ? a : `on ${a}`; };

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
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V6m0 0l-5 5m5-5l5 5"/></svg>',
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

/* ================================================================ display settings
   Theme follows the system unless picked; text size scales every rem-based font size.
   Stored per device. index.html applies them before first paint. */

const THEME_COLORS = { dark: "#1c1922", light: "#e9ebee" };
function applyDisplay() {
  const d = document.documentElement;
  const theme = localStorageGet("peek.theme"), text = localStorageGet("peek.text");
  theme ? (d.dataset.theme = theme) : delete d.dataset.theme;
  text ? (d.dataset.text = text) : delete d.dataset.text;
  // the browser/OS bar colour: both metas get the picked theme, or go back to per-scheme
  $$('meta[name="theme-color"]').forEach((m) => {
    m.dataset.scheme ??= m.media.includes("dark") ? "dark" : "light";
    m.content = THEME_COLORS[theme || m.dataset.scheme];
  });
}

function displayHTML() {
  const theme = localStorageGet("peek.theme") || "", text = localStorageGet("peek.text") || "";
  const seg = (key, cur, opts) => `<div class="seg small" role="radiogroup" data-key="${key}">${opts.map(([v, label]) =>
    `<button role="radio" aria-checked="${v === cur}" data-v="${v}">${label}</button>`).join("")}</div>`;
  return `<h2 class="sub">Display</h2>
    <div class="display-row"><span>Theme</span>${seg("peek.theme", theme, [["", "Auto"], ["light", "Light"], ["dark", "Dark"]])}</div>
    <div class="display-row"><span>Text size</span>${seg("peek.text", text, [["s", "Small"], ["", "Default"], ["l", "Large"], ["xl", "Larger"]])}</div>
    <p class="hint">Saved on this device. Press <kbd>?</kbd> anywhere for keyboard shortcuts.</p>`;
}

function wireDisplay(box) {
  $$(".seg[data-key] button", box).forEach((b) => b.addEventListener("click", () => {
    const seg = b.parentElement;
    b.dataset.v ? localStorageSet(seg.dataset.key, b.dataset.v) : localStorageRemove(seg.dataset.key);
    $$("button", seg).forEach((x) => x.setAttribute("aria-checked", x === b));
    applyDisplay();
  }));
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

function toggleMute() {
  muted = !muted;
  $$("video").forEach((v) => (v.muted = muted));
  $$(".mute, #s-mute").forEach((m) => (m.innerHTML = muted ? I.muted : I.sound));
}

function wireVideos(root) {
  $$("video[data-auto]", root).forEach((v) => vidObserver.observe(v));
  $$(".mute", root).forEach((b) => {
    b.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); toggleMute(); });
    b.addEventListener("mousedown", (e) => e.preventDefault());
  });
}

/* Playback speed and seeking for the reel and story viewers. Speed is one setting for
   both, remembered per device. */
const RATES = [1, 1.5, 2, 0.5];
let rate = RATES.includes(+localStorageGet("peek.rate")) ? +localStorageGet("peek.rate") : 1;

function applyRate(v) { v.defaultPlaybackRate = rate; v.playbackRate = rate; }
function speedHTML(cls = "speed") { return `<button class="${cls}" aria-label="Playback speed">${rate}×</button>`; }
function cycleRate() {
  rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
  localStorageSet("peek.rate", rate);
  $$("video[data-rated]").forEach(applyRate);
  $$(".speed").forEach((b) => (b.textContent = `${rate}×`));
}
function wireSpeed(root) {
  $$(".speed", root).forEach((b) => {
    b.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); cycleRate(); });
    // a mouse click shouldn't leave focus here, or Space (play/pause) would press it again
    b.addEventListener("mousedown", (e) => e.preventDefault());
  });
}

const seekHTML = () => `<div class="seek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100"><i><b></b></i></div>`;
function paintSeek(bar, video) {
  const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
  $("b", bar).style.width = pct + "%";
  bar.setAttribute("aria-valuenow", Math.round(pct));
}
// Tap or drag along the bar to jump. Pointer capture keeps the drag going off the bar.
function wireSeek(bar, video) {
  const go = (e) => {
    const r = bar.getBoundingClientRect();
    if (video.duration) video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * video.duration;
    paintSeek(bar, video);
  };
  bar.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); e.preventDefault();
    bar.setPointerCapture(e.pointerId); bar.classList.add("drag"); go(e);
  });
  bar.addEventListener("pointermove", (e) => { if (bar.hasPointerCapture(e.pointerId)) go(e); });
  const end = (e) => { bar.classList.remove("drag"); if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId); };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("click", (e) => e.stopPropagation());
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
    <button class="save" data-sc="${esc(p.shortcode)}" aria-label="Save">${I.mark}</button>
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
      ${p.caption ? `<p class="caption clamp"><b>${esc(p.username)}</b>${linkify(p.caption)}</p>` : ""}
    </div>
  </article>`;
}

// Saved state lives on the post (whole post, plus any single saved photos) and is mirrored
// on every bookmark showing it (feed card + open post).
function paintSave(sc) {
  const p = postIndex[sc];
  const whole = !!p?.saved, photos = p?.saved_slides?.length || 0;
  $$(`button.save[data-sc="${CSS.escape(sc)}"]`).forEach((b) => {
    const on = whole || photos > 0;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    b.title = whole ? "Saved" : photos ? `${photos} photo${photos > 1 ? "s" : ""} saved` : "Save";
    b.innerHTML = on ? I.marked : I.mark;
  });
}

// Which photo of the post is showing in the card or viewer that holds this button.
function currentIdx(btn, p) {
  const holder = btn.closest(".card, .post-view");
  const slides = holder && $(".slides", holder);
  const pos = slides ? Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)) : 0;
  const m = p.media.filter((x) => x.src)[pos] || p.media[0];
  return { idx: m?.idx ?? 0, pos, n: p.media.filter((x) => x.src).length };
}

async function setSaved(sc, on, slide = null) {
  const p = postIndex[sc];
  const before = { saved: p.saved, saved_slides: [...(p.saved_slides || [])] };
  if (slide == null) { p.saved = on; if (on) p.saved_slides = []; }
  else p.saved_slides = on ? [...new Set([...(p.saved_slides || []), slide])] : (p.saved_slides || []).filter((i) => i !== slide);
  paintSave(sc);
  try {
    await api(`/api/saved/${encodeURIComponent(sc)}${slide == null ? "" : `?slide=${slide}`}`, { method: on ? "POST" : "DELETE" });
    toast(on ? (slide == null ? "Post saved" : "Photo saved") : (slide == null ? "Post removed from Saved" : "Photo removed from Saved"));
  } catch (err) {
    Object.assign(p, before);
    paintSave(sc);
    toast(err.message);
  }
}

function closeSaveMenu() { $(".save-menu")?.remove(); }

function openSaveMenu(btn, p) {
  closeSaveMenu();
  const { idx, pos, n } = currentIdx(btn, p);
  const photoSaved = (p.saved_slides || []).includes(idx);
  const items = p.saved
    ? [["unsave-post", "Remove post from Saved"]]
    : [[photoSaved ? "unsave-photo" : "save-photo", photoSaved ? `Remove photo ${pos + 1} of ${n}` : `Save this photo (${pos + 1} of ${n})`],
       ["save-post", "Save whole post"]];
  const menu = document.createElement("div");
  menu.className = "save-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items.map(([act, label]) => `<button role="menuitem" data-act="${act}">${esc(label)}</button>`).join("");
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
  menu.style.top = (r.top - h - 6 > 8 ? r.top - h - 6 : r.bottom + 6) + "px";
  $("button", menu).focus();
  menu.addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (!act) return;
    closeSaveMenu();
    if (act === "save-post") setSaved(p.shortcode, true);
    else if (act === "unsave-post") setSaved(p.shortcode, false);
    else setSaved(p.shortcode, act === "save-photo", idx);
  });
  setTimeout(() => document.addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) closeSaveMenu(); }, { once: true }));
}

function wireSaves(root) {
  $$("button.save", root).forEach((b) => {
    paintSave(b.dataset.sc);
    b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const p = postIndex[b.dataset.sc];
      if (!p) return;
      if (p.media.filter((m) => m.src).length > 1) openSaveMenu(b, p);
      else setSaved(p.shortcode, !p.saved);
    });
  });
}

function wireCards(root) {
  wireVideos(root); wireSlides(root); wireDownloads(root, postIndex); wireSaves(root);
  $$(".caption.clamp", root).forEach((c) => c.addEventListener("click", () => c.classList.remove("clamp"), { once: true }));
}

function gridHTML(posts) {
  return posts.map((p) => {
    postIndex[p.shortcode] ??= p;
    if (p.slide != null) {  // one saved photo of a carousel
      const media = p.media.filter((m) => m.src);
      const pos = Math.max(0, media.findIndex((m) => m.idx === p.slide));
      return `<a href="#/p/${esc(p.shortcode)}/${p.slide}" aria-label="Photo ${pos + 1} of ${media.length}, from ${ago(p.taken_at)}">
        <img src="${esc(p.thumb || "")}" alt="" loading="lazy" decoding="async">
        <span class="badge count">${pos + 1}/${media.length}</span></a>`;
    }
    return `<a href="#/p/${esc(p.shortcode)}" aria-label="Post from ${ago(p.taken_at)}">
      <img src="${esc(p.thumb || "")}" alt="" loading="lazy" decoding="async">
      ${p.kind === "carousel" ? `<span class="badge">${I.carousel}</span>` : p.kind === "reel" || p.kind === "video" ? `<span class="badge">${I.play}</span>` : ""}
    </a>`;
  }).join("");
}

function empty(title, body, action = "") {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${body}</p>${action}</div>`;
}

/* ================================================================ views */

// Group filter for Feed and Reels. The choice is remembered per device.
const currentGroup = () => +localStorageGet("peek.group") || 0;
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

async function feedView(seq = renderSeq) {
  const { gid, html } = await groupBar();
  if (moved(seq)) return;
  const gq = gid ? `&group=${gid}` : "";
  view.innerHTML = `<div class="strip-wrap" id="strip-wrap" hidden>
      <div class="strip" id="strip"></div>
      <button class="strip-nav prev" aria-label="Scroll stories left" hidden>${I.chevL}</button>
      <button class="strip-nav next" aria-label="Scroll stories right" hidden>${I.chevR}</button>
    </div>${html}<div id="cards"><div class="loading"></div></div><div id="more"></div>`;
  wireGroupBar(view);
  loadStrip(gid);
  const cards = $("#cards");
  const first = await api(`/api/feed?_=1${gq}`);
  if (moved(seq)) return;
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

  watchNewPosts(cards, newest, gq, seq);

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

// "New posts" pill: polls the local DB (no Instagram requests) for posts newer than the top
// of the feed. Faster while a refresh is running. Stops when the feed is left.
function watchNewPosts(cards, newest, gq, seq) {
  const pill = document.createElement("button");
  pill.className = "new-pill";
  pill.hidden = true;
  pill.addEventListener("click", () => { window.scrollTo(0, 0); render(); });
  document.body.append(pill);
  const tick = async () => {
    if (!cards.isConnected || moved(seq)) return pill.remove();
    const r = await api(`/api/feed/new?since=${newest}${gq}`).catch(() => null);
    if (!cards.isConnected || moved(seq)) return pill.remove();
    if (r?.count) {
      pill.innerHTML = `${I.up}${r.count} new post${r.count === 1 ? "" : "s"}`;
      pill.hidden = false;
    }
    setTimeout(tick, r?.refreshing ? 8000 : 30000);
  };
  setTimeout(tick, 4000);
}

let storyGroups = [];
async function loadStrip(gid = 0) {
  const wrap = $("#strip-wrap"), strip = $("#strip");
  try {
    const { groups } = await api(`/api/stories${gid ? `?group=${gid}` : ""}`);
    storyGroups = groups;
    if (!groups.length || !strip?.isConnected) return;
    wrap.hidden = false;
    strip.innerHTML = groups.map((g, i) => `<button data-i="${i}" aria-label="Stories from ${esc(g.username)}">
        <span class="ring ${g.all_seen ? "seen" : ""}"><img src="${esc(g.avatar || AVATAR_FALLBACK)}" alt=""></span>
        <span>${esc(g.username)}</span></button>`).join("");
    $$("button", strip).forEach((b) => b.addEventListener("click", () => openStories(+b.dataset.i)));
    wireStrip(wrap, strip);
  } catch { /* stories are a bonus; never break the feed */ }
}

// A long row of stories: arrows on wide screens (only while there's more to scroll that way),
// and a plain mouse wheel scrolls it sideways.
function wireStrip(wrap, strip) {
  const prev = $(".strip-nav.prev", wrap), next = $(".strip-nav.next", wrap);
  const update = () => {
    prev.hidden = strip.scrollLeft < 4;
    next.hidden = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4;
  };
  const page = (dir) => strip.scrollBy({ left: dir * strip.clientWidth * 0.8,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  prev.addEventListener("click", () => page(-1));
  next.addEventListener("click", () => page(1));
  strip.addEventListener("scroll", update, { passive: true });
  strip.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || strip.scrollWidth <= strip.clientWidth) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  addEventListener("resize", update);
  update();
}

async function reelsView(seq = renderSeq) {
  view.innerHTML = `<div class="loading"></div>`;
  const { gid, html } = await groupBar();
  const gq = gid ? `&group=${gid}` : "";
  let { posts, next } = await api(`/api/feed?kind=reels&limit=8${gq}`);
  if (moved(seq)) return;
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
    postIndex[p.shortcode] ??= p;
    const v = p.media.find((m) => m.video && m.src) || p.media[0];
    return `<section class="reel" data-sc="${esc(p.shortcode)}">
      <video src="${esc(v?.src || "")}" poster="${esc(v?.poster || p.thumb || "")}" playsinline loop muted preload="metadata" data-auto data-rated></video>
      <button class="mute" aria-label="Toggle sound">${muted ? I.muted : I.sound}</button>
      ${speedHTML("speed reel-speed")}
      ${seekHTML()}
      <div class="reel-meta">
        <a href="#/u/${esc(p.username)}"><img class="avatar" src="${esc(p.avatar || AVATAR_FALLBACK)}" alt="">${esc(p.username)}</a>
        <span style="opacity:.7;font-size:13px;margin-left:6px">${ago(p.taken_at)}</span>
        ${p.caption ? `<p>${linkify(p.caption)}</p>` : ""}
      </div>
    </section>`;
  };
  const add = (list) => {
    const frag = document.createElement("div");
    frag.innerHTML = list.map(reelHTML).join("");
    $$("video", frag).forEach((v) => {
      applyRate(v);
      v.addEventListener("click", () => (v.paused ? v.play() : v.pause()));
      wireSeek($(".seek", v.parentElement), v);
    });
    wireVideos(frag); wireSpeed(frag);
    box.append(...frag.children);
  };
  // Fill exactly the space between whatever sits above (header, group chips) and the tab
  // bar. A fixed calc() guessed the chip row's height and ran under the tabs.
  const fit = () => {
    if (!box.isConnected) return removeEventListener("resize", fit);
    box.style.height = Math.max(240, innerHeight - box.getBoundingClientRect().top - $(".tabs").offsetHeight) + "px";
  };
  fit();
  addEventListener("resize", fit);
  // keep the playing reel's seek bar moving (timeupdate alone is too coarse)
  const loop = () => {
    if (!box.isConnected) return;
    $$(".reel video", box).forEach((v) => { if (!v.paused) paintSeek($(".seek", v.parentElement), v); });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
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

async function savedView(seq = renderSeq) {
  view.innerHTML = `<div class="page-pad page-head"><h1 class="page-title">Saved</h1><p class="hint" id="saved-count"></p></div>
    <div id="saved-body"><div class="loading"></div></div><div id="saved-more"></div>`;
  const first = await api("/api/saved");
  if (moved(seq)) return;
  const body = $("#saved-body");
  if (!first.posts.length) {
    body.innerHTML = empty("Nothing saved yet", `Tap the bookmark on any post to keep it here. In a carousel you can save just one photo. Saved items stay on disk even if you unfollow the account.`);
    return;
  }
  $("#saved-count").textContent = `${first.count.toLocaleString()} saved`;
  body.innerHTML = `<div class="grid" id="grid">${gridHTML(first.posts)}</div>`;
  let next = first.next;
  if (next) onSentinel($("#saved-more"), async () => {
    const page = await api(`/api/saved?before=${next}`);
    $("#grid").insertAdjacentHTML("beforeend", gridHTML(page.posts));
    next = page.next;
    return !!next;
  });
}

function searchView(initial = "") {
  view.innerHTML = `<div class="page-pad">
    <h1 class="page-title">Look up</h1>
    <form class="lookup" id="lookup">
      <input name="u" type="search" placeholder="Username, profile link, or words from a caption" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Search">
      <button class="btn primary">Open</button>
    </form>
    <p class="hint">Typing searches what Peek has saved, plus Instagram once you pause. Open goes straight to a username.</p>
    <div id="results"></div>
    <div id="ig"></div>
  </div>`;
  const input = $("#lookup input"), results = $("#results"), ig = $("#ig");
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
  // Instagram suggestions: only after a pause in typing, one request per pause.
  let igTimer, igSeq = 0;
  const suggest = (q) => {
    clearTimeout(igTimer);
    const mine = ++igSeq;
    if (q.replace(/^@/, "").length < 3 || q.startsWith("#")) { ig.innerHTML = ""; return; }  // #tags: saved posts only
    igTimer = setTimeout(async () => {
      ig.innerHTML = `<h2 class="sub">On Instagram</h2><div class="loading small"></div>`;
      const r = await api(`/api/search/instagram?q=${encodeURIComponent(q)}`).catch((e) => ({ status: "error", message: e.message, users: [] }));
      if (mine !== igSeq) return;
      if (r.status === "off") { ig.innerHTML = ""; return; }
      if (r.status !== "ok") { ig.innerHTML = `<h2 class="sub">On Instagram</h2><p class="hint">${esc(r.message)}</p>`; return; }
      ig.innerHTML = `<h2 class="sub">On Instagram</h2>` + (r.users.length ? `<ul class="people">${r.users.map((u) => `<li>
          <a href="#/u/${esc(u.username)}"><img class="avatar" src="${esc(u.avatar)}" alt="" loading="lazy" onerror="this.src='${AVATAR_FALLBACK}'"></a>
          <div class="who"><a href="#/u/${esc(u.username)}">${esc(u.username)}${u.verified ? ` <span class="tick" title="Verified">${I.check}</span>` : ""}</a>
            <small>${[u.full_name && esc(u.full_name), u.followers != null && `${num(u.followers)} followers`,
              u.private && "private", u.followed && "following"].filter(Boolean).join(" · ")}</small></div></li>`).join("")}</ul>`
        : `<p class="hint">No accounts found for “${esc(q)}”.</p>`);
    }, 700);
  };

  let timer, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    suggest(q);
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
        + (!people && !r.posts.length ? `<p class="hint">Nothing saved matches “${esc(q)}”.</p>` : "");
      if (r.posts.length) {
        results.insertAdjacentHTML("beforeend", `<div class="grid search-grid" id="grid">${gridHTML(r.posts)}</div>`);
      }
    }, 250);
  });
  if (initial) {  // e.g. a #hashtag tapped in a caption
    input.value = initial;
    input.dispatchEvent(new Event("input"));
  } else showRecent();
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function localStorageRemove(k) { try { localStorage.removeItem(k); } catch {} }
function rememberRecent(u) {
  const list = JSON.parse(localStorageGet("peek.recent") || "[]").filter((x) => x !== u);
  list.unshift(u);
  localStorageSet("peek.recent", JSON.stringify(list.slice(0, 8)));
}

/* ================================================================ burner session */

// Shown wherever a dead session matters, so stories and highlights don't just quietly vanish.
function sessionBanner(s) {
  if (s?.state !== "dead") return "";
  return `<div class="banner" role="alert"><b>Burner session expired.</b> Stories, highlights, the Reels tab and restricted profiles are off until you replace it.
    <a href="#/following/session">Update session</a></div>`;
}

/* How the burner is spent. "restricted" is the default: only accounts that need it, plus the
   features that cannot work without a login. "off" means restricted profiles simply fail. */
const POLICIES = {
  off: ["Off", "Never. Restricted profiles fail, stories and highlights stay off."],
  restricted: ["Restricted only", "Only accounts flagged restricted or private, plus stories, highlights, the Reels tab and search."],
  always: ["Always", "Every request uses the burner. The most exposure, the least stealth."],
};

function policyHTML(s) {
  const cur = POLICIES[s.policy] ? s.policy : "restricted";
  const budget = s.budget_left ?? null;
  return `<h3 class="sub">Where the burner is used</h3>
    <div class="seg small" role="radiogroup" data-policy aria-label="Burner use">${Object.entries(POLICIES).map(([k, [label]]) =>
      `<button role="radio" aria-checked="${k === cur}" data-p="${k}">${esc(label)}</button>`).join("")}</div>
    <p class="hint">${esc(POLICIES[cur][1])}</p>
    ${budget != null ? `<p class="hint">${budget > 0 ? `<b>${budget}</b> burner operations left this hour.` : "<b>Hourly burner budget spent</b> — restricted accounts wait for the hour to roll."}</p>` : ""}`;
}

function sessionCardHTML(s) {
  const when = s.checked_at ? `checked ${agoText(s.checked_at)}` : "not checked yet";
  const line = s.state === "ok" ? `<span class="pill ok">Working</span> Logged in${s.username ? ` as <b>@${esc(s.username)}</b>` : ""}, ${when}.`
    : s.state === "unchecked" ? `<span class="pill">Not checked</span> Session ${esc(s.hint)} from ${s.source === "env" ? "the server config" : "here"}, ${when}.`
    : s.state === "dead" ? `<span class="pill bad">Expired</span> ${esc(s.error || "Instagram no longer accepts this session.")}`
    : `<span class="pill">Off</span> No burner session. Peek runs logged out: no stories, highlights, Reels tab or restricted profiles.`;
  const open = s.state === "dead" || s.state === "none";
  return `<h2 class="sub">Burner session</h2>
    <p class="session-line">${line}</p>
    ${s.error && s.state !== "dead" ? `<p class="hint">Last check: ${esc(s.error)}</p>` : ""}
    ${s.configured ? `<div class="row-btns"><button class="btn" id="s-check">${I.refresh}Check now</button><button class="btn" id="s-out">Sign out</button></div>` : ""}
    ${policyHTML(s)}
    <details class="session-form" ${open ? "open" : ""}>
      <summary>${s.configured ? "Replace session" : "Add a session"}</summary>
      <form id="s-form">
        <label>sessionid<input name="sessionid" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="1234567890%3AAbCd…%3A12%3A…"></label>
        <details><summary>More cookies (optional, from the same browser)</summary>
          <div class="cookie-grid">
            <label>csrftoken<input name="csrftoken" autocomplete="off" spellcheck="false"></label>
            <label>mid<input name="mid" autocomplete="off" spellcheck="false"></label>
            <label>ig_did<input name="ig_did" autocomplete="off" spellcheck="false"></label>
            <label>rur<input name="rur" autocomplete="off" spellcheck="false"></label>
          </div>
        </details>
        <p class="hint">In a browser signed in to the burner: dev tools → Application → Cookies → instagram.com, copy <b>sessionid</b>. Peek checks it with Instagram before saving.</p>
        <p class="form-err" id="s-err" hidden></p>
        <button class="btn primary" id="s-save">Check and save</button>
      </form>
    </details>`;
}

function wireSessionCard(box, s) {
  const repaint = (next) => { box.innerHTML = sessionCardHTML(next); wireSessionCard(box, next); };
  $("#s-check", box)?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.lastChild.textContent = "Checking";
    try { const next = await api("/api/session/check", { method: "POST" }); repaint(next);
      toast(next.state === "ok" ? "Session is working" : next.state === "dead" ? "Session has expired" : "Couldn't check right now"); }
    catch (err) { toast(err.message); repaint(s); }
  });
  $("#s-out", box)?.addEventListener("click", async () => {
    repaint(await api("/api/session", { method: "DELETE" }));
    toast("Signed out. Peek is running logged out.");
  });
  $$("[data-policy] button", box).forEach((b) => b.addEventListener("click", async () => {
    if (b.getAttribute("aria-checked") === "true") return;
    try {
      await api("/api/session/policy", { method: "PUT", body: { policy: b.dataset.p } });
      repaint({ ...s, policy: b.dataset.p });
      toast(b.dataset.p === "off" ? "Burner switched off: restricted profiles will fail"
        : b.dataset.p === "always" ? "Every request now uses the burner"
        : "Burner only for restricted accounts and login-only features");
    } catch (err) { toast(err.message); }
  }));
  $("#s-form", box).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = $("#s-save", box), err = $("#s-err", box);
    const body = Object.fromEntries(["sessionid", "csrftoken", "mid", "ig_did", "rur"].map((k) => [k, f[k].value.trim() || null]));
    btn.disabled = true; btn.textContent = "Checking with Instagram"; err.hidden = true;
    try {
      const next = await api("/api/session", { method: "POST", body });
      repaint(next);
      toast(next.username ? `Logged in as @${next.username}` : "Session saved and working");
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = "Check and save";
    }
  });
}

/* ================================================================ burner tab
   What the burner is actually being spent on. Read-only apart from the session card above,
   which is the same one Following uses. Nothing here polls. Counters are live on every
   load; only the account's own counts are cached server-side (six hours, one request). */

const fmtDuration = (secs) => {
  const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : "under a minute";
};

function statsTable(rows) {
  return `<table class="stats-table">${rows.map(([label, value, cls]) =>
    `<tr><th scope="row">${esc(label)}</th><td class="${cls || ""}">${esc(value)}</td></tr>`).join("")}</table>`;
}

async function burnerView(seq = renderSeq) {
  view.innerHTML = `<div class="loading"></div>`;
  const d = await api("/api/burner");
  if (moved(seq)) return;
  const s = d.session;
  const total = s.budget_total || 0;
  const left = s.budget_left ?? 0;
  const pct = total ? Math.round((left / total) * 100) : 0;
  const kinds = Object.entries(d.kinds || {}).sort((a, b) => b[1] - a[1]);
  const c = d.counters || {};
  const sw = d.switches || {};
  const acc = d.accounts || {};
  const own = d.own;

  view.innerHTML = `<div class="page-pad">
    <h1 class="page-title">Burner</h1>
    <p class="hint">Where the burner session is going, and how the account itself looks. Counters cover this run only and reset when Peek restarts.</p>
    ${sessionBanner(s)}
    <section class="session-box" id="b-session"></section>

    <section class="panel">
      <h2 class="sub">Hourly budget</h2>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${left}"><i style="width:${pct}%"></i></div>
      <p class="hint">${left} of ${total} burner operations left this hour. Public accounts keep working anonymously past this; restricted ones queue.</p>
      <button class="btn" id="b-force">${I.refresh}Re-read the account</button>
    </section>

    <section class="panel">
      <h2 class="sub">Traffic since Peek started (${esc(fmtDuration(d.uptime || 0))})</h2>
      ${statsTable([
        ["Anonymous requests", num(c.anon ?? 0)],
        ["Session requests", num(c.session ?? 0)],
        ["Anonymous failures", num(c.anon_fail ?? 0), (c.anon_fail ?? 0) ? "warn" : ""],
        ["Session failures", num(c.session_fail ?? 0), (c.session_fail ?? 0) ? "warn" : ""],
      ])}
      ${kinds.length ? `<h3 class="sub">Session spend by kind</h3>${statsTable(kinds.map(([k, v]) => [k, num(v)]))}`
        : `<p class="hint">Nothing spent yet.</p>`}
      <p class="hint">"profile" is a lookup, "stories" is the whole tray in one request, "reels", "highlights", "search" and "stats" are what they say. If "profile" dominates, most of your follows are restricted.</p>
    </section>

    <section class="panel">
      <h2 class="sub">The account itself</h2>
      ${own ? statsTable([
        ["Followers", num(own.followers)],
        ["Following", num(own.following)],
        ["Posts", num(own.posts)],
        ["Last read", own.fetched_at ? agoText(own.fetched_at) : "–"],
      ]) : `<p class="hint">No own-account data yet. It's read once the session is working and kept for six hours.</p>`}
      ${d.own_error ? `<p class="warn">${esc(d.own_error)}</p>` : ""}
      ${(d.warnings || []).map((w) => `<p class="warn">${esc(w)}</p>`).join("")}
    </section>

    <section class="panel">
      <h2 class="sub">What's switched on</h2>
      ${statsTable([
        ["Reels tab", sw.reels_tab ? "on" : "off"],
        ["Instagram search", sw.search ? "on" : "off"],
        ["Batched stories", sw.stories_batched ? "on" : "off"],
        ["Accounts followed", num(acc.followed ?? 0)],
        ["Flagged restricted", num(acc.restricted ?? 0)],
        ["Private", num(acc.private ?? 0)],
      ])}
      <p class="hint">These come from the environment, so changing them needs a restart. Flagged accounts always use the burner regardless of the policy.</p>
    </section>
  </div>`;

  const sbox = $("#b-session");
  sbox.innerHTML = sessionCardHTML(s);
  wireSessionCard(sbox, s);
  $("#b-force").addEventListener("click", async () => {
    const btn = $("#b-force");
    btn.disabled = true; btn.lastChild.textContent = "Reading";
    try { await api("/api/burner?force=1"); await burnerView(); }
    catch (err) { toast(err.message); btn.disabled = false; btn.lastChild.textContent = "Re-read the account"; }
  });
}

// Following list order, remembered per device.
const SORTS = { latest: "Latest post", unread: "New posts", name: "Name", problems: "Problems first" };
function sortAccounts(list) {
  const by = SORTS[localStorageGet("peek.sort")] ? localStorageGet("peek.sort") : "latest";
  const name = (a, b) => a.username.localeCompare(b.username);
  const latest = (a, b) => (b.latest_post || 0) - (a.latest_post || 0) || name(a, b);
  list.sort(by === "name" ? name
    : by === "unread" ? (a, b) => (b.unread || 0) - (a.unread || 0) || latest(a, b)
    : by === "problems" ? (a, b) => (!!b.last_error - !!a.last_error) || name(a, b)
    : latest);
  return by;
}

/* Bulk actions on Following: Select shows checkboxes and an action bar. The selection
   survives the re-render after a group change, so several groups can be applied in a row. */
const followSel = { on: false, picked: new Set() };

function wireBulk(accounts, groups) {
  const head = $("#list-head"), ul = $("#people");
  const names = new Set(accounts.map((a) => a.username));
  for (const u of followSel.picked) if (!names.has(u)) followSel.picked.delete(u);
  head.hidden = false;
  const sort = SORTS[localStorageGet("peek.sort")] ? localStorageGet("peek.sort") : "latest";
  head.innerHTML = `<span>${accounts.length} account${accounts.length === 1 ? "" : "s"}</span>
    <label class="sort">Sort <select id="sort" aria-label="Sort accounts">${Object.entries(SORTS).map(([k, label]) =>
      `<option value="${k}" ${k === sort ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <button class="btn small" id="sel-toggle" aria-pressed="${followSel.on}">${followSel.on ? "Done" : "Select"}</button>`;
  $("#sort").addEventListener("change", (e) => { localStorageSet("peek.sort", e.target.value); render(); });
  $("#sel-toggle").addEventListener("click", () => {
    followSel.on = !followSel.on;
    if (!followSel.on) followSel.picked.clear();
    render();
  });
  $("#bulk-bar")?.remove();
  $(".new-pill")?.remove();
  if (!followSel.on) return;

  const bar = document.createElement("div");
  bar.id = "bulk-bar";
  bar.className = "bulk-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Selected accounts");
  document.body.append(bar);
  const opts = groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  const paint = () => {
    const n = followSel.picked.size;
    bar.innerHTML = `<span class="bulk-n">${n} selected</span>
      <button class="btn small" id="b-all">${n === accounts.length ? "None" : "All"}</button>
      ${groups.length ? `<select id="b-add" ${n ? "" : "disabled"} aria-label="Add selected to a group"><option value="">Add to group…</option>${opts}</select>
        <select id="b-rm" ${n ? "" : "disabled"} aria-label="Remove selected from a group"><option value="">Remove from group…</option>${opts}</select>` : ""}
      <button class="btn small" id="b-mute" ${n ? "" : "disabled"}>Mute</button>
      <button class="btn small" id="b-unmute" ${n ? "" : "disabled"}>Unmute</button>
      <button class="btn small danger" id="b-unfollow" ${n ? "" : "disabled"}>Unfollow</button>`;
    $("#b-all", bar).addEventListener("click", () => {
      if (followSel.picked.size === accounts.length) followSel.picked.clear();
      else accounts.forEach((a) => followSel.picked.add(a.username));
      $$(".pick", ul).forEach((c) => (c.checked = followSel.picked.has(c.closest("li").dataset.user)));
      paint();
    });
    for (const [id, action] of [["#b-add", "add_group"], ["#b-rm", "remove_group"]]) {
      $(id, bar)?.addEventListener("change", async (e) => {
        const gid = +e.target.value;
        if (!gid) return;
        const gname = groups.find((g) => g.id === gid)?.name;
        try {
          await api("/api/accounts/bulk", { method: "POST", body: { usernames: [...followSel.picked], action, group_id: gid } });
          toast(`${action === "add_group" ? "Added" : "Removed"} ${followSel.picked.size} ${action === "add_group" ? "to" : "from"} ${gname}`);
        } catch (err) { toast(err.message); }
        render();
      });
    }
    for (const action of ["mute", "unmute"]) {
      $(`#b-${action}`, bar).addEventListener("click", async () => {
        const n = followSel.picked.size;
        try {
          await api("/api/accounts/bulk", { method: "POST", body: { usernames: [...followSel.picked], action } });
          toast(action === "mute" ? `Muted ${n}: they're out of Feed, Reels and stories but still refreshed` : `Unmuted ${n}`);
        } catch (err) { toast(err.message); }
        render();
      });
    }
    $("#b-unfollow", bar).addEventListener("click", () => {
      const n = followSel.picked.size;
      bar.innerHTML = `<span class="bulk-n">Unfollow ${n} account${n === 1 ? "" : "s"}?</span>
        <button class="btn small" id="b-keep">Keep their posts</button>
        <button class="btn small danger" id="b-purge">Delete their posts too</button>
        <button class="btn small" id="b-cancel">Cancel</button>`;
      $("#b-cancel", bar).addEventListener("click", paint);
      const go = async (purge) => {
        try {
          await api("/api/accounts/bulk", { method: "POST", body: { usernames: [...followSel.picked], action: "unfollow", purge } });
          toast(`Unfollowed ${n} account${n === 1 ? "" : "s"}${purge ? " and deleted their posts (saved items kept)" : ""}`);
          followSel.picked.clear(); followSel.on = false;
        } catch (err) { toast(err.message); }
        render();
      };
      $("#b-keep", bar).addEventListener("click", () => go(false));
      $("#b-purge", bar).addEventListener("click", () => go(true));
      $("#b-keep", bar).focus();
    });
  };
  paint();

  // tick a row by its checkbox, or by tapping anywhere on it that isn't a link or button
  ul.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-user]");
    if (!li || (e.target.closest("a, button") && !e.target.classList.contains("pick"))) return;
    const box = $(".pick", li);
    if (e.target !== box) { e.preventDefault(); box.checked = !box.checked; }
    box.checked ? followSel.picked.add(li.dataset.user) : followSel.picked.delete(li.dataset.user);
    paint();
  });
}

async function followingView(seq = renderSeq) {
  view.innerHTML = `<div class="page-pad"><h1 class="page-title">Following</h1>
    <form class="lookup" id="add"><input name="u" placeholder="Add a username" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Username to follow"><button class="btn primary">${I.plus}Follow</button></form>
    <section class="groups-box">
      <h2 class="sub">Groups</h2>
      <div class="group-list" id="group-list"></div>
      <form class="new-group" id="new-group"><input name="g" placeholder="New group, e.g. Friends" maxlength="30" autocomplete="off" required aria-label="New group name"><button class="btn">${I.plus}Add</button></form>
    </section>
    <div id="s-banner"></div>
    <div class="list-head" id="list-head" hidden></div>
    <ul class="people" id="people"><li class="loading"></li></ul>
    <section class="session-box" id="session"></section>
    <section class="session-box" id="display">${displayHTML()}</section>
    <div class="status-box" id="status"></div></div>`;

  wireDisplay($("#display"));
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
  if (moved(seq)) return;
  $("#s-banner").innerHTML = sessionBanner(s.session);
  const sbox = $("#session");
  sbox.innerHTML = sessionCardHTML(s.session);
  wireSessionCard(sbox, s.session);
  if (location.hash === "#/following/session") {
    sbox.scrollIntoView({ block: "start" });
    $("input[name=sessionid]", sbox)?.focus({ preventScroll: true });
  }
  $("#group-list").innerHTML = groups.length
    ? groups.map((g) => `<span class="chip-static">${esc(g.name)} <small>${g.count}</small>
        ${g.count ? `<a href="/api/zip?group=${g.id}" download title="Download everything saved for this group as a zip" aria-label="Download group ${esc(g.name)} as zip">${I.down}</a>` : ""}
        <button data-del-group="${g.id}" data-name="${esc(g.name)}" aria-label="Delete group ${esc(g.name)}">${I.close}</button></span>`).join("")
    : `<p class="hint">Group accounts (friends, photographers…) to filter the feed and reels by group.</p>`;
  $$("[data-del-group]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Delete the group "${b.dataset.name}"? The accounts stay followed.`)) return;
    await api(`/api/groups/${b.dataset.delGroup}`, { method: "DELETE" });
    render();
  }));
  const ul = $("#people");
  ul.classList.toggle("selecting", followSel.on);
  sortAccounts(accounts);
  ul.innerHTML = accounts.length ? accounts.map((a) => `<li data-user="${esc(a.username)}" class="${a.muted ? "is-muted" : ""}">
      <input type="checkbox" class="pick" aria-label="Select @${esc(a.username)}" ${followSel.picked.has(a.username) ? "checked" : ""}>
      <a href="#/u/${esc(a.username)}"><img class="avatar" src="${esc(a.avatar || AVATAR_FALLBACK)}" alt=""></a>
      <div class="who">
        <a href="#/u/${esc(a.username)}">${esc(a.username)}</a>${a.busy ? '<span class="dot-busy" title="Refreshing"></span>' : ""}${
          a.unread ? `<span class="unread" title="Posts since you last opened this profile">${a.unread > 99 ? "99+" : a.unread} new</span>` : ""}${
          a.muted ? `<span class="tag-muted" title="Hidden from Feed, Reels and stories">Muted</span>` : ""}${
          a.restricted ? `<span class="tag-restricted" title="Age or region restricted: only fetched with the burner session">Restricted</span>` : ""}
        ${a.last_error ? `<small class="err">${esc(a.last_error)}</small>`
          : `<small>${a.fetched_at ? `Checked ${agoText(a.fetched_at)}` : "Waiting for first fetch"}${a.latest_post ? `, latest post ${ago(a.latest_post)}` : ""}</small>`}
        ${groups.length ? `<div class="member" data-user="${esc(a.username)}">${groups.map((g) =>
          `<button aria-pressed="${a.groups.includes(g.id)}" data-g="${g.id}">${esc(g.name)}</button>`).join("")}</div>` : ""}
      </div>
      <button class="btn" data-unfollow="${esc(a.username)}">Unfollow</button>
    </li>`).join("") : `<li>${empty("Not following anyone", "Add a public account above. Peek checks everyone you follow every few hours in the background.")}</li>`;

  if (accounts.length) wireBulk(accounts, groups);

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
    : s.scheduler === "stopped" ? `<b>Automatic refresh has stopped.</b> Restart Peek to bring it back; ↻ still works.`
    : s.scheduler === "overdue" ? `Automatic refresh is overdue (was due ${nxt})${s.last_cycle ? `; last one ${agoText(s.last_cycle)}` : ""}.`
    : s.last_cycle ? `Last full refresh ${agoText(s.last_cycle)}, next around ${nxt}.` : `First full refresh starts ${nxt}.`;
  const paused = (ts, what) => `<br><b>${what} is rate-limiting.</b> Paused until ${hhmm(ts)}; saved posts still work.`;
  $("#status").innerHTML = `<b>${s.posts.toLocaleString()}</b> posts saved from <b>${s.following}</b> accounts. ${cycle}<br>
    ${s.logged_in ? "The burner session is in use." : "Running logged out, so stories, highlights and restricted profiles are off."}
    ${s.restricted ? `<br>${s.restricted} account${s.restricted === 1 ? "" : "s"} can only be fetched with the burner.` : ""}
    ${s.anon_paused_until ? paused(s.anon_paused_until, "Instagram") : ""}
    ${s.paused_until && !s.anon_paused_until ? paused(s.paused_until, "The burner") : ""}`;
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
      <div class="strip hl-strip" id="hl" hidden></div>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected="${tab === "posts"}" data-tab="posts">Posts</button>
        <button role="tab" aria-selected="${tab === "reels"}" data-tab="reels">Reels</button>
      </div>
      <div id="pbody"></div>`;
    $$(".seg button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab !== tab) { tab = b.dataset.tab; open(); } }));
    paintHead();
    paintBody();
    if (a.busy) { const t = setTimeout(poll, 2000); stopPolling = () => clearTimeout(t); }
    if (!a.is_private && a.fetched_at) loadHighlights(a);
  };

  const paintHead = () => {
    const fetched = !!a.fetched_at;
    $("#phead").innerHTML = `
      <img class="big-avatar" src="${esc(a.avatar || AVATAR_FALLBACK)}" alt="">
      <div><h1>${esc(a.full_name || a.username)}</h1><div class="handle">@${esc(a.username)}${a.busy ? '<span class="dot-busy" title="Fetching"></span>' : ""}${a.restricted ? '<span class="tag-restricted" title="Age or region restricted">Restricted</span>' : ""}</div></div>
      <div class="stats">${fetched ? `<span><b>${num(a.post_count)}</b> posts</span><span><b>${num(a.followers)}</b> followers</span><span><b>${num(a.following)}</b> following</span>` : ""}</div>
      ${a.bio ? `<p class="bio">${esc(a.bio)}</p>` : ""}
      <div class="profile-actions">
        <button class="btn ${a.followed ? "" : "primary"}" id="follow">${a.followed ? `${I.check}Following` : `${I.plus}Follow`}</button>
        ${a.followed ? `<button class="btn" id="mute" aria-pressed="${a.muted}" title="${a.muted ? "Show this account in Feed, Reels and stories again" : "Keep refreshing, but leave out of Feed, Reels and stories"}">${a.muted ? `${I.muted}Muted` : "Mute"}</button>` : ""}
        <button class="btn" id="refresh" ${a.busy ? "disabled" : ""}>${I.refresh}${a.busy ? "Fetching" : "Refresh"}</button>
        <a class="btn" href="https://www.instagram.com/${esc(a.username)}/" target="_blank" rel="noopener noreferrer">${I.out}Instagram</a>
        ${a.cached ? `<a class="btn" href="/api/zip?user=${encodeURIComponent(a.username)}" download title="Every post Peek has saved for this account, plus stories, as one zip">${I.down}Zip</a>` : ""}
      </div>
      ${sessionBanner(a.session)}
      ${a.last_error ? `<p class="notice">${esc(a.last_error)}</p>` : ""}
      ${a.is_private ? `<p class="notice">This account is private, so only its profile details are visible.</p>` : ""}`;
    $("#follow").addEventListener("click", async () => {
      if (a.followed) await api(`/api/accounts/${encodeURIComponent(a.username)}`, { method: "DELETE" });
      else await api("/api/accounts", { method: "POST", body: { username: a.username } });
      toast(a.followed ? `Unfollowed @${a.username}` : `Following @${a.username}`);
      a.followed = !a.followed; paintHead();
    });
    $("#mute")?.addEventListener("click", async () => {
      try {
        await api(`/api/accounts/${encodeURIComponent(a.username)}/mute`, { method: "PUT", body: { muted: !a.muted } });
        a.muted = !a.muted; paintHead();
        toast(a.muted ? `Muted @${a.username}: out of Feed, Reels and stories, still refreshed` : `Unmuted @${a.username}`);
      } catch (err) { toast(err.message); }
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
    // With the burner session the Reels tab pages through Instagram's own Reels tab, which
    // also has reels that were never put on the posts grid. Logged out it's grid reels only.
    const reelsTab = tab === "reels" && a.reels_tab;
    const showButton = (msg = "") => {
      const saved = a.post_count ? `${num(a.cached)} of ${num(a.post_count)} posts saved` : `${num(a.cached)} posts saved`;
      if (a.is_private) { foot.innerHTML = ""; return; }
      if (reelsTab) {
        foot.innerHTML = a.reels_done
          ? `<p>That's every reel from @${esc(a.username)}.</p>`
          : `${msg ? `<p class="foot-note">${esc(msg)}</p>` : ""}<button class="btn" id="older">Load older reels</button>`;
        $("#older")?.addEventListener("click", loadOlder);
        return;
      }
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
        const r = await api(`/api/u/${encodeURIComponent(a.username)}/older${reelsTab ? "?kind=reels" : ""}`, { method: "POST" });
        a.cached = r.cached;
        if (reelsTab) a.reels_done = r.done; else a.history_done = r.done;
        insertSorted(r.posts.filter((p) => tab === "reels" ? p.kind === "reel" || p.kind === "video" : !p.reels_only));
        showButton(r.note || (r.added || r.done ? "" : `Instagram didn't return any more ${reelsTab ? "reels" : "posts"} this time.`));
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

// Highlights row on a profile (burner session only). Items load when a highlight is opened.
async function loadHighlights(a) {
  const box = $("#hl");
  const r = await api(`/api/u/${encodeURIComponent(a.username)}/highlights`).catch(() => null);
  if (!box || !r?.highlights.length) return;
  box.hidden = false;
  box.innerHTML = r.highlights.map((h) => `<button data-id="${esc(h.id)}" aria-label="Highlight: ${esc(h.title)}">
      <span class="ring seen"><img src="${esc(h.cover)}" alt="" loading="lazy"></span><span>${esc(h.title)}</span></button>`).join("");
  $$("button", box).forEach((b, i) => b.addEventListener("click", async () => {
    b.classList.add("loading-hl");
    try {
      const h = r.highlights[i];
      const { items } = await api(`/api/highlights/${encodeURIComponent(h.id)}`);
      if (!items.length) return toast("This highlight is empty");
      openStories(0, [{ username: a.username, avatar: a.avatar, title: h.title, items }], "highlight");
    } catch (e) { toast(e.message); }
    finally { b.classList.remove("loading-hl"); }
  }));
}

/* ================================================================ post overlay */

async function openPost(key) {
  const [shortcode, slideArg] = key.split("/");
  const slide = slideArg == null || slideArg === "" ? null : +slideArg;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button><div class="loading" style="margin:auto"></div>`;
  $(".ov-close", overlay).addEventListener("click", closeOverlay);
  try {
    const p = await api(`/api/p/${encodeURIComponent(shortcode)}`);
    postIndex[p.shortcode] = p;
    overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button>
      <div class="post-view" data-sc="${esc(p.shortcode)}" data-key="${esc(key)}">
        ${frameHTML(p)}
        <aside>
          <div class="card-head">
            <a href="#/u/${esc(p.username)}"><img class="avatar" src="${esc(p.avatar || AVATAR_FALLBACK)}" alt=""></a>
            <div class="who"><a href="#/u/${esc(p.username)}">${esc(p.username)}</a><time>${new Date(p.taken_at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time></div>
          </div>
          ${actionsHTML(p)}
          ${p.caption ? `<p class="caption">${linkify(p.caption)}</p>` : ""}
        </aside>
      </div>`;
    $(".ov-close", overlay).addEventListener("click", closeOverlay);
    $$(".post-view a[href^='#/u/']", overlay).forEach((a) => a.addEventListener("click", () => hideOverlay()));
    wireCards(overlay);
    wireLightbox($(".post-view", overlay));
    if (slide != null) {  // opened from a saved photo: start on that photo
      const pos = p.media.filter((m) => m.src).findIndex((m) => m.idx === slide);
      const slides = $(".post-view .slides", overlay);
      if (slides && pos > 0) slides.scrollLeft = pos * slides.clientWidth;
    }
    wirePostSteps(key);
  } catch (e) {
    overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button>${empty("Post not available", esc(e.message))}`;
    $(".ov-close", overlay).addEventListener("click", closeOverlay);
  }
}

/* Next/previous post: the list is whatever grid the post was opened from (a profile,
   Saved, search results), read straight from the page underneath the overlay. */
// Keys are the grid links' targets: "SC" for a post, "SC/idx" for one saved photo.
function postNeighbours(key) {
  const keys = $$('#view a[href^="#/p/"]').map((a) => a.getAttribute("href").slice(4));
  const i = keys.indexOf(key);
  return i < 0 ? {} : { prev: keys[i - 1], next: keys[i + 1] };
}

function goPost(dir) {
  const key = $(".post-view", overlay)?.dataset.key;
  const target = key && postNeighbours(key)[dir > 0 ? "next" : "prev"];
  if (!target) return false;
  // Keep the grid underneath in step, which also loads the next page when near the end.
  $(`#view a[href="#/p/${CSS.escape(target)}"]`)?.scrollIntoView({ block: "center" });
  location.replace(`#/p/${target}`);
  return true;
}

function wirePostSteps(key) {
  const nb = postNeighbours(key);
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
  closeLightbox();
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

/* ================================================================ lightbox
   Full-screen photo viewer over the post overlay. Pinch, wheel or double-tap to zoom (up to
   6x), drag to pan when zoomed, swipe or arrow keys between photos at 1x. Pointer Events
   only, no library. Transform origin is the image centre, so for a fixed screen point P
   (relative to the stage centre) zooming s -> s2 moves the offset t to P - (P - t) * s2/s. */

let lightbox = null;

function openLightbox(srcs, start) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Photo viewer");
  box.innerHTML = `<div class="lb-stage"><img alt="" draggable="false"></div>
    <button class="icon-btn lb-close" aria-label="Close">${I.close}</button>
    ${srcs.length > 1 ? `<button class="icon-btn lb-nav prev" aria-label="Previous photo">${I.chevL}</button>
      <button class="icon-btn lb-nav next" aria-label="Next photo">${I.chevR}</button><span class="lb-count"></span>` : ""}
    <span class="lb-zoom" aria-live="polite"></span>`;
  document.body.append(box);
  const stage = $(".lb-stage", box), img = $("img", box);
  const lb = lightbox = { box, i: start, s: 1, tx: 0, ty: 0 };
  const MAX = 6;

  const clamp = () => {
    const W = stage.clientWidth, H = stage.clientHeight;
    const mx = Math.max(0, (img.offsetWidth * lb.s - W) / 2), my = Math.max(0, (img.offsetHeight * lb.s - H) / 2);
    lb.tx = Math.max(-mx, Math.min(mx, lb.tx)); lb.ty = Math.max(-my, Math.min(my, lb.ty));
  };
  let zoomNote;
  const paint = (animate = false) => {
    clamp();
    img.style.transition = animate ? "transform .18s ease-out" : "none";
    img.style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.s})`;
    stage.classList.toggle("zoomed", lb.s > 1.01);
    const z = $(".lb-zoom", box);
    z.textContent = lb.s > 1.01 ? `${lb.s.toFixed(1)}×` : "";
    clearTimeout(zoomNote); zoomNote = setTimeout(() => (z.textContent = ""), 900);
  };
  // zoom to s2 keeping the screen point (cx, cy) fixed
  const zoomAt = (s2, cx, cy, animate = false) => {
    s2 = Math.max(1, Math.min(MAX, s2));
    const r = stage.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    lb.tx = px - (px - lb.tx) * (s2 / lb.s); lb.ty = py - (py - lb.ty) * (s2 / lb.s);
    lb.s = s2;
    if (s2 === 1) { lb.tx = 0; lb.ty = 0; }
    paint(animate);
  };
  const show = (i) => {
    lb.i = (i + srcs.length) % srcs.length;
    lb.s = 1; lb.tx = 0; lb.ty = 0;
    img.src = srcs[lb.i];
    paint();
    const c = $(".lb-count", box);
    if (c) c.textContent = `${lb.i + 1} / ${srcs.length}`;
  };
  lb.step = (d) => srcs.length > 1 && show(lb.i + d);
  lb.zoomBy = (f) => { const r = stage.getBoundingClientRect(); zoomAt(lb.s * f, r.left + r.width / 2, r.top + r.height / 2, true); };
  lb.reset = () => { lb.s = 1; lb.tx = 0; lb.ty = 0; paint(true); };
  show(start);

  // pointers: one = pan (zoomed) or swipe (not zoomed); two = pinch
  const pts = new Map();
  let pinch = null, swipe = null, lastTap = 0;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: lb.s };
      swipe = null;
    } else if (pts.size === 1) {
      swipe = { x: e.clientX, y: e.clientY, tx: lb.tx, ty: lb.ty, moved: false };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (swipe) {
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) swipe.moved = true;
      if (lb.s > 1.01) { lb.tx = swipe.tx + dx; lb.ty = swipe.ty + dy; paint(); }
      else img.style.transform = `translate(${dx}px, 0)`;  // follow the finger while swiping
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; if (!pts.size) swipe = null; return; }
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (lb.s <= 1.01 && swipe.moved) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) lb.step(dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeLightbox();  // swipe down closes
      else paint(true);
    } else if (!swipe.moved) {
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(lb.s > 1.01 ? 1 : 2.5, e.clientX, e.clientY, true); lastTap = 0; }
      else lastTap = now;
    }
    swipe = null;
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(lb.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX, e.clientY);
  }, { passive: false });
  img.addEventListener("load", () => paint());
  $(".lb-close", box).addEventListener("click", closeLightbox);
  $(".lb-nav.prev", box)?.addEventListener("click", () => lb.step(-1));
  $(".lb-nav.next", box)?.addEventListener("click", () => lb.step(1));
  $(".lb-close", box).focus();
}

function closeLightbox() {
  lightbox?.box.remove();
  lightbox = null;
}

function lightboxKeys(e) {
  const lb = lightbox;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowRight") lb.step(1);
  else if (e.key === "ArrowLeft") lb.step(-1);
  else if (e.key === "+" || e.key === "=") lb.zoomBy(1.5);
  else if (e.key === "-") lb.zoomBy(1 / 1.5);
  else if (e.key === "0") lb.reset();
  else return;
  e.preventDefault();
}

// Tap a photo in the open post to view it full screen (videos keep their own controls).
function wireLightbox(view) {
  $$(".slide img", view).forEach((im) => im.addEventListener("click", () => {
    const photos = $$(".slide img", view).map((x) => x.src);
    openLightbox(photos, Math.max(0, photos.indexOf(im.src)));
  }));
}

/* ================================================================ stories viewer */

const IMAGE_SECONDS = 5;
let storyState = null;

// kind "stories" marks items seen and repaints the strip; "highlight" does neither.
function openStories(groupIndex, groups = storyGroups, kind = "stories") {
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  storyState = { groups, kind, gi: groupIndex, ii: kind === "stories" ? firstUnseen(groups[groupIndex]) : 0,
    seen: new Set(), raf: 0, paused: false };
  showStory();
  document.addEventListener("keydown", storyKeys);
}

function firstUnseen(g) {
  const i = g.items.findIndex((it) => !it.seen);
  return i < 0 ? 0 : i;
}

function showStory() {
  const st = storyState, g = st.groups[st.gi], it = g.items[st.ii];
  cancelAnimationFrame(st.raf);
  st.seen.add(it.id); it.seen = true;
  overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close stories">${I.close}</button>
    <div class="story">
      <div class="story-media">${it.video
        ? `<video src="${esc(it.src)}" poster="${esc(it.poster || "")}" playsinline autoplay data-rated></video>`
        : `<img src="${esc(it.src)}" alt="">`}</div>
      <div class="story-top">
        <div class="bars">${g.items.map((_, i) => `<i class="${i < st.ii ? "done" : ""}"><b></b></i>`).join("")}</div>
        <div class="story-who">
          <img class="avatar" src="${esc(g.avatar || AVATAR_FALLBACK)}" alt="">
          <a href="#/u/${esc(g.username)}">${esc(g.username)}</a><time>${g.title ? `${esc(g.title)}, ` : ""}${ago(it.taken_at)}</time>
        </div>
      </div>
      <div class="story-tools">
        ${it.video ? speedHTML("icon-btn speed story-speed") : ""}
        ${it.video ? `<button class="icon-btn" id="s-mute" aria-label="Toggle sound">${muted ? I.muted : I.sound}</button>` : ""}
        ${st.kind === "highlight"
          ? `<a class="icon-btn" href="${esc(`${it.src}?dl=${encodeURIComponent(`${g.username}_highlight_${it.id}`)}`)}" download aria-label="Download">${I.down}</a>`
          : `<a class="icon-btn" href="${esc(it.src)}" download="${esc(`${g.username}_story_${it.id}.${it.src.split(".").pop()}`)}" aria-label="Download">${I.down}</a>`}
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
  $("#s-mute", overlay)?.addEventListener("click", toggleMute);
  wireSpeed(overlay);

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
  // Seek on the progress bars: tap or drag on the current one to jump within it, or tap
  // another to go to that item. The bars area is taller than it looks, for fingers.
  const bars = $(".bars", overlay);
  const seekTo = (e, drag) => {
    const segs = $$("i", bars), x = e.clientX;
    let j = segs.findIndex((el) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right + 4; });
    if (j < 0) j = x < segs[0].getBoundingClientRect().left ? 0 : segs.length - 1;
    if (j !== st.ii) { if (!drag) { st.ii = j; showStory(); } return; }
    const r = segs[j].getBoundingClientRect(), f = Math.max(0, Math.min(1, (x - r.left) / r.width));
    if (video) { if (video.duration) video.currentTime = f * video.duration; }
    else elapsed = f * IMAGE_SECONDS;
  };
  bars.addEventListener("pointerdown", (e) => { e.stopPropagation(); bars.setPointerCapture(e.pointerId); seekTo(e, false); });
  bars.addEventListener("pointermove", (e) => { if (bars.hasPointerCapture(e.pointerId)) seekTo(e, true); });
  bars.addEventListener("click", (e) => e.stopPropagation());
  if (video) {
    applyRate(video);
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
  const g = st.groups[st.gi];
  st.ii += dir;
  if (st.ii >= g.items.length) {
    st.gi += 1;
    if (st.gi >= st.groups.length) return closeStories();
    st.ii = st.kind === "stories" ? firstUnseen(st.groups[st.gi]) : 0;
  } else if (st.ii < 0) {
    if (st.gi === 0) { st.ii = 0; }
    else { st.gi -= 1; st.ii = st.groups[st.gi].items.length - 1; }
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
  const isStories = st.kind === "stories";
  if (isStories && st.seen.size) api("/api/stories/seen", { method: "POST", body: { ids: [...st.seen] } }).catch(() => {});
  storyState = null;
  hideOverlay();
  if (repaint && isStories) loadStrip(currentGroup());
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
let renderSeq = 0;
const moved = (seq) => seq !== renderSeq;  // the user switched views while this one was loading
async function render() {
  const seq = ++renderSeq;
  const hash = location.hash || "#/";
  const [, route, arg] = hash.split("/");

  if (route === "p") {
    if (!baseRendered) { baseRendered = true; baseHash = "#/"; feedView().catch(() => {}); }
    return openPost(hash.slice(4));
  }
  if (!overlay.hidden && !storyState) hideOverlay();
  if (storyState) closeStories(false);

  stopPolling();
  $("#bulk-bar")?.remove();
  $(".new-pill")?.remove();
  if (route !== "following") { followSel.on = false; followSel.picked.clear(); }
  baseRendered = true;
  baseHash = hash;
  const tab = route === "u" ? "" : route || "feed";
  $$(".tabs a").forEach((a) => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  view.classList.toggle("wide", route === "u" || route === "saved");
  window.scrollTo(0, 0);

  try {
    if (route === "u" && arg) await profileView(decodeURIComponent(arg));
    else if (route === "reels") await reelsView(seq);
    else if (route === "search") searchView(arg ? decodeURIComponent(arg) : "");
    else if (route === "saved") await savedView(seq);
    else if (route === "following") await followingView(seq);
    else if (route === "burner") await burnerView(seq);
    else await feedView(seq);
  } catch (e) {
    if (e.message !== "auth") view.innerHTML = empty("Something went wrong", esc(e.message), `<button class="btn" onclick="location.reload()">Reload</button>`);
  }
}

window.addEventListener("hashchange", (e) => {
  cameFromApp = true;
  const h = location.hash || "#/";
  // A post opens over whatever page is showing; closing it returns to that page untouched.
  if (h.startsWith("#/p/")) return openPost(h.slice(4));
  if (!overlay.hidden && !storyState && h === baseHash) return hideOverlay();
  render();
});

/* ================================================================ keyboard
   One handler, routed to whatever is on top: lightbox, cheatsheet, stories (own handler),
   the post overlay, then the page. Letters are ignored while typing in a field. */

const KEYS = [
  ["Anywhere", [["?", "Show or hide these shortcuts"], ["/", "Look up"], ["m", "Sound on or off"]]],
  ["Feed and Reels", [["j / k", "Next / previous post or reel"], ["o or Enter", "Open it"], ["s", "Save it"], ["Space", "Play or pause (Reels)"]]],
  ["Open post", [["← / →", "Previous / next photo, then post"], ["↑ / ↓", "Previous / next post"], ["f or Enter", "View photo full screen"], ["s", "Save"], ["Esc", "Close"]]],
  ["Full-screen photo", [["+ / −", "Zoom in / out"], ["0", "Reset zoom"], ["← / →", "Previous / next photo"], ["Esc", "Close"]]],
  ["Stories", [["← / →", "Previous / next"], ["Esc", "Close"]]],
];

function toggleKeys() {
  const open = $(".keys-sheet");
  if (open) return open.remove();
  const box = document.createElement("div");
  box.className = "keys-sheet";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Keyboard shortcuts");
  box.innerHTML = `<div class="keys-card"><div class="keys-head"><h2>Keyboard shortcuts</h2>
      <button class="icon-btn" aria-label="Close">${I.close}</button></div>
    ${KEYS.map(([title, rows]) => `<section><h3>${title}</h3><dl>${rows.map(([k, what]) =>
      `<dt>${k.split(" ").map((p) => (["/", "or"].includes(p) && k !== "/" ? ` ${p} ` : `<kbd>${p}</kbd>`)).join("")}</dt><dd>${what}</dd>`).join("")}</dl></section>`).join("")}</div>`;
  box.addEventListener("click", (e) => { if (e.target === box || e.target.closest(".icon-btn")) box.remove(); });
  document.body.append(box);
  $(".icon-btn", box).focus();
}

// The post or reel at the top of the screen, and stepping between them.
function pageItems() {
  const reels = $("#reels");
  if (reels) return { reels, items: $$(".reel", reels) };
  return { items: $$("#cards .card") };
}
function currentItem() {
  const { reels, items } = pageItems();
  if (reels) return items[Math.round(reels.scrollTop / Math.max(1, reels.clientHeight))];
  const top = $(".top").offsetHeight;
  return items.find((el) => el.getBoundingClientRect().bottom > top + 60);
}
function stepItem(dir) {
  const { reels, items } = pageItems();
  if (!items.length) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (reels) {
    const i = Math.round(reels.scrollTop / Math.max(1, reels.clientHeight)) + dir;
    reels.scrollTo({ top: Math.max(0, Math.min(items.length - 1, i)) * reels.clientHeight, behavior: reduce });
    return;
  }
  const top = $(".top").offsetHeight;
  // cards land 8px below the header (scroll-margin-top), so "this one" sits at top + 8
  const target = dir > 0
    ? items.find((el) => el.getBoundingClientRect().top > top + 20)
    : items.findLast((el) => el.getBoundingClientRect().top < top - 4);
  if (target) target.scrollIntoView({ block: "start", behavior: reduce });
  else if (dir < 0) window.scrollTo({ top: 0, behavior: reduce });
}

function pageKeys(e) {
  const k = e.key;
  if ((k === "Enter" || k === " ") && e.target.closest?.("a, button, summary")) return;  // let it activate
  if (k === "/") { e.preventDefault(); location.hash = "#/search"; return; }
  if (k === "m") return toggleMute();
  if (k === "j" || k === "k") { e.preventDefault(); return stepItem(k === "j" ? 1 : -1); }
  const item = (k === "o" || k === "Enter" || k === "s" || k === " ") && currentItem();
  if (!item) return;
  if (k === "o" || k === "Enter") { e.preventDefault(); location.hash = `#/p/${item.dataset.sc}`; }
  else if (k === "s") {
    const btn = $("button.save", item);
    if (btn) btn.click();
    else { const p = postIndex[item.dataset.sc]; if (p) setSaved(p.shortcode, !p.saved); }
  } else if (k === " " && item.classList.contains("reel")) {
    e.preventDefault();
    const v = $("video", item); v.paused ? v.play().catch(() => {}) : v.pause();
  }
}

function postKeys(e) {
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
  } else if (e.key === "f" || (e.key === "Enter" && !e.target.closest?.("a, button"))) {
    const img = frame && $$(".slide", frame)[slidePos(frame).i]?.querySelector("img");
    if (img) { e.preventDefault(); img.click(); }
  } else if (e.key === "s") $(".post-view button.save", overlay)?.click();
  else if (e.key === "m") toggleMute();
}

document.addEventListener("keydown", (e) => {
  if (lightbox) return lightboxKeys(e);
  if (e.key === "Escape" && $(".save-menu")) return closeSaveMenu();
  if (e.key === "Escape" && $(".keys-sheet")) return toggleKeys();
  if (storyState) return;  // storyKeys has these
  const typing = e.target.closest?.("input, textarea, select, [contenteditable='true']");
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "?") { e.preventDefault(); return toggleKeys(); }
  if ($(".keys-sheet")) return;
  if (!overlay.hidden) return postKeys(e);
  if (!$(".login")) pageKeys(e);
});

/* ================================================================ refreshing
   ↻ fetches new posts from Instagram: for the group picked on Feed/Reels, else everyone.
   It keeps spinning while that runs. Re-tapping the current tab, or pulling down at the
   top of the feed on a phone, redraws from what's saved (no Instagram requests). */

// Rate-limit pause, shown on every page: Instagram said "slow down" and Peek is waiting.
// Anonymous fetching and the burner cool separately, so this tracks the anonymous path —
// a rate-limited burner must not look like the whole app has stopped.
let pauseTimer = 0;
const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function paintPause(until) {
  const chip = $("#pause-chip");
  clearTimeout(pauseTimer);
  const left = until ? until - Date.now() / 1000 : 0;
  chip.hidden = left <= 0;
  if (left <= 0) return;
  chip.innerHTML = `<i></i>Paused until ${hhmm(until)}`;
  chip.title = "Instagram is rate-limiting, so Peek has paused fetching. Everything already saved still works.";
  pauseTimer = setTimeout(() => paintPause(null), left * 1000 + 1000);
}
$("#pause-chip").addEventListener("click", () =>
  toast("Instagram asked Peek to slow down, so fetching is paused. Saved posts, stories and downloads still work."));
const pollStatus = async () => {
  const r = await fetch("/api/status").catch(() => null);
  if (r?.ok) { const st = await r.json(); paintPause(st.anon_paused_until); return st; }
  return null;
};
setInterval(pollStatus, 60000);

let refreshWatch = 0;
function watchRefresh() {
  const btn = $("#refresh-all");
  btn.classList.add("spinning");
  clearTimeout(refreshWatch);
  const check = async () => {
    const st = await pollStatus();
    if (st?.cycle_running) refreshWatch = setTimeout(check, 5000);
    else btn.classList.remove("spinning");
  };
  refreshWatch = setTimeout(check, 3000);
}

$("#refresh-all").addEventListener("click", async () => {
  const route = (location.hash || "#/").split("/")[1] || "feed";
  const gid = ["feed", "reels"].includes(route) ? currentGroup() : 0;
  const gname = gid && $(`.chips button[data-g="${gid}"]`)?.textContent;
  try {
    const r = await api(`/api/refresh-all${gid ? `?group=${gid}` : ""}`, { method: "POST" });
    if (r.already) toast("A refresh is already running");
    else if (!r.count) return toast(gid ? "Nobody in this group to refresh" : "You're not following anyone yet");
    else toast(`Checking ${r.count} account${r.count === 1 ? "" : "s"}${gname ? ` in ${gname}` : ""}. New posts appear as they come in.`);
    watchRefresh();
  } catch (err) { toast(err.message); }
});

// Re-tap the tab you're on: redraw it from scratch, back at the top.
$$(".tabs a").forEach((a) => a.addEventListener("click", (e) => {
  if (a.getAttribute("href") !== (location.hash || "#/") || !overlay.hidden) return;
  e.preventDefault();
  window.scrollTo(0, 0);
  render();
}));

// Pull to refresh at the top of the feed (touch only).
(() => {
  const ptr = document.createElement("div");
  ptr.className = "ptr";
  ptr.innerHTML = I.refresh;
  document.body.append(ptr);
  let y0 = null, x0 = 0, pull = 0;
  const onFeed = () => ["", "#/"].includes(location.hash) && overlay.hidden && !storyState;
  addEventListener("touchstart", (e) => {
    y0 = onFeed() && window.scrollY <= 0 && !e.target.closest(".strip, .chips") ? e.touches[0].clientY : null;
    x0 = e.touches[0].clientX; pull = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
    if (dy <= 0 || dx > dy || window.scrollY > 0) { pull = 0; ptr.style.cssText = ""; return; }
    pull = Math.min(dy * 0.5, 90);
    ptr.style.transform = `translate(-50%, ${pull}px) rotate(${pull * 4}deg)`;
    ptr.style.opacity = Math.min(1, pull / 60);
    ptr.classList.toggle("armed", pull >= 60);
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 != null && pull >= 60) { ptr.classList.add("spinning"); render().finally(() => { ptr.classList.remove("spinning", "armed"); ptr.style.cssText = ""; }); }
    else { ptr.classList.remove("armed"); ptr.style.cssText = ""; }
    y0 = null; pull = 0;
  });
})();

// If a refresh is already running when the app opens, show it.
pollStatus().then((st) => st?.cycle_running && watchRefresh());

applyDisplay();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();