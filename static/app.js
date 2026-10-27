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
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
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

function wireSlides(root) {
  $$(".frame", root).forEach((frame) => {
    const slides = $(".slides", frame), dots = $$(".dots i", frame);
    if (!slides || dots.length < 2) return;
    slides.addEventListener("scroll", () => {
      const i = Math.round(slides.scrollLeft / slides.clientWidth);
      dots.forEach((d, j) => d.classList.toggle("on", i === j));
    }, { passive: true });
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
    ${media.length > 1 ? `<div class="dots">${media.map((_, i) => `<i class="${i ? "" : "on"}"></i>`).join("")}</div>` : ""}
    ${hasVideo ? `<button class="mute" aria-label="Toggle sound">${muted ? I.muted : I.sound}</button>` : ""}
  </div>`;
}

function actionsHTML(p) {
  const first = p.media.find((m) => m.src);
  return `<div class="actions">
    <span title="Likes">${I.heart}${num(p.likes)}</span>
    <span title="Comments">${I.chat}${num(p.comments)}</span>
    <span class="spacer"></span>
    ${first ? `<a class="dl" href="${esc(first.src)}" download="${esc(dlName(p, 0))}" title="Download this photo or video" aria-label="Download">${I.down}</a>` : ""}
    <a href="https://www.instagram.com/p/${esc(p.shortcode)}/" target="_blank" rel="noopener noreferrer" title="Open on Instagram">${I.out}</a>
  </div>`;
}

// e.g. marisol.frames_C0aB12xYz_2.jpg, so carousel slides don't overwrite each other
function dlName(p, i) {
  const m = p.media[i] || p.media[0];
  return `${p.username}_${p.shortcode}${p.media.length > 1 ? `_${i + 1}` : ""}.${m?.video ? "mp4" : "jpg"}`;
}

// Point the download link at whichever carousel slide is showing, right before the click goes through.
function wireDownloads(root, posts) {
  $$("a.dl", root).forEach((a) => a.addEventListener("click", () => {
    const holder = a.closest(".card, .post-view");
    const p = posts[holder?.dataset.sc];
    if (!p) return;
    const slides = $(".slides", holder);
    const i = slides ? Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)) : 0;
    const m = p.media[i] || p.media[0];
    a.href = m.src;
    a.download = dlName(p, i);
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

function wireCards(root) {
  wireVideos(root); wireSlides(root); wireDownloads(root, postIndex);
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

let stopPolling = () => {};

async function feedView() {
  view.innerHTML = `<div class="strip" id="strip" hidden></div><div id="cards"><div class="loading"></div></div><div id="more"></div>`;
  loadStrip();
  const cards = $("#cards");
  const first = await api("/api/feed");
  if (!first.posts.length) {
    const s = await api("/api/status");
    cards.innerHTML = s.following
      ? empty("Nothing cached yet", "Posts from the accounts you follow show up here after their first refresh. That usually takes a minute or two.")
      : empty("Your feed is empty", "Follow a few public accounts and their posts will collect here.", `<a class="btn primary" href="#/search">${I.plus}Look someone up</a>`);
    return;
  }
  cards.innerHTML = first.posts.map(cardHTML).join("");
  wireCards(cards);
  let next = first.next;
  if (next) onSentinel($("#more"), async () => {
    const page = await api(`/api/feed?before=${next}`);
    const frag = document.createElement("div");
    frag.innerHTML = page.posts.map(cardHTML).join("");
    wireCards(frag);
    cards.append(...frag.children);
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
  let { posts, next } = await api("/api/feed?kind=reels&limit=8");
  if (!posts.length) {
    view.innerHTML = empty("No reels yet", "Reels and videos from the accounts you follow land here once they're cached.");
    return;
  }
  view.innerHTML = `<div class="reels" id="reels"></div>`;
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
    const page = await api(`/api/feed?kind=reels&limit=8&before=${next}`);
    tail.remove(); add(page.posts); box.append(tail);
    next = page.next;
    return !!next;
  });
}

function searchView() {
  view.innerHTML = `<div class="page-pad">
    <h1 class="page-title">Look up</h1>
    <form class="lookup" id="lookup">
      <input name="u" placeholder="Username or profile link" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-label="Username or profile link">
      <button class="btn primary">Open</button>
    </form>
    <p class="hint">Works for public accounts. A first visit takes a few seconds while Peek fetches and saves their recent posts.</p>
    <ul class="people" id="recent"></ul>
  </div>`;
  const input = $("#lookup input");
  input.focus();
  $("#lookup").addEventListener("submit", (e) => {
    e.preventDefault();
    let u = input.value.trim().replace(/^@/, "");
    const m = u.match(/instagram\.com\/([^/?#]+)/i);
    if (m) u = m[1];
    if (u) location.hash = `#/u/${encodeURIComponent(u.toLowerCase())}`;
  });
  const recent = JSON.parse(localStorageGet("peek.recent") || "[]");
  $("#recent").innerHTML = recent.map((u) => `<li><div class="who"><a href="#/u/${esc(u)}">@${esc(u)}</a><small>Recently viewed</small></div></li>`).join("");
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
    <ul class="people" id="people"><li class="loading"></li></ul>
    <div class="status-box" id="status"></div></div>`;

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

  const [{ accounts }, s] = await Promise.all([api("/api/accounts"), api("/api/status")]);
  const ul = $("#people");
  ul.innerHTML = accounts.length ? accounts.map((a) => `<li>
      <a href="#/u/${esc(a.username)}"><img class="avatar" src="${esc(a.avatar || AVATAR_FALLBACK)}" alt=""></a>
      <div class="who">
        <a href="#/u/${esc(a.username)}">${esc(a.username)}</a>${a.busy ? '<span class="dot-busy" title="Refreshing"></span>' : ""}
        ${a.last_error ? `<small class="err">${esc(a.last_error)}</small>`
          : `<small>${a.fetched_at ? `Checked ${ago(a.fetched_at)} ago` : "Waiting for first fetch"}${a.latest_post ? `, latest post ${ago(a.latest_post)}` : ""}</small>`}
      </div>
      <button class="btn" data-unfollow="${esc(a.username)}">Unfollow</button>
    </li>`).join("") : `<li>${empty("Not following anyone", "Add a public account above. Peek checks everyone you follow every few hours in the background.")}</li>`;

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
    ${s.logged_in ? "Stories are on, using your burner session." : "Running logged out, so stories are off. Add a burner session in the server config to turn them on."}`;
}

async function profileView(username) {
  stopPolling();
  view.innerHTML = `<div class="loading"></div>`;
  let tab = "posts";
  let data;

  const load = async () => {
    data = await api(`/api/u/${encodeURIComponent(username)}${tab === "reels" ? "?kind=reels" : ""}`);
    paint();
    if (data.account.busy) {
      const t = setTimeout(load, 1500);
      stopPolling = () => clearTimeout(t);
    }
  };

  const paint = () => {
    const a = data.account, posts = data.posts;
    rememberRecent(a.username);
    const fetched = !!a.fetched_at;
    view.innerHTML = `
      <section class="profile-head">
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
        ${a.is_private ? `<p class="notice">This account is private, so only its profile details are visible.</p>` : ""}
      </section>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected="${tab === "posts"}" data-tab="posts">Posts</button>
        <button role="tab" aria-selected="${tab === "reels"}" data-tab="reels">Reels</button>
      </div>
      ${posts.length ? `<div class="grid">${gridHTML(posts)}</div>`
        : a.busy ? `<div class="loading"></div>`
        : empty(tab === "reels" ? "No reels saved" : "No posts saved", a.last_error ? "Peek couldn't get posts this time. Try Refresh in a while." : "Nothing here yet.")}`;

    $("#follow").addEventListener("click", async () => {
      if (a.followed) await api(`/api/accounts/${encodeURIComponent(a.username)}`, { method: "DELETE" });
      else await api("/api/accounts", { method: "POST", body: { username: a.username } });
      toast(a.followed ? `Unfollowed @${a.username}` : `Following @${a.username}`);
      a.followed = !a.followed; paint();
    });
    $("#refresh").addEventListener("click", async () => {
      await api(`/api/u/${encodeURIComponent(a.username)}/refresh`, { method: "POST" });
      a.busy = true; paint();
      setTimeout(load, 2500);
    });
    $$(".seg button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; load(); }));
  };

  try { await load(); }
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
  } catch (e) {
    overlay.innerHTML = `<button class="icon-btn ov-close" aria-label="Close">${I.close}</button>${empty("Post not available", esc(e.message))}`;
    $(".ov-close", overlay).addEventListener("click", closeOverlay);
  }
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
        <a class="icon-btn" href="${esc(it.src)}" download="${esc(`${g.username}_story_${it.id}.${it.video ? "mp4" : "jpg"}`)}" aria-label="Download">${I.down}</a>
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
  view.classList.toggle("wide", route === "u");
  window.scrollTo(0, 0);

  try {
    if (route === "u" && arg) await profileView(decodeURIComponent(arg));
    else if (route === "reels") await reelsView();
    else if (route === "search") searchView();
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
  if (e.key === "Escape" && !overlay.hidden && !storyState) closeOverlay();
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
