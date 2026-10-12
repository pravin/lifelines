/* GitHub Lifelines — page logic: fetch, cache, render, interact, export, share. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const API = "https://api.github.com";
  const SITE = "https://pravin.github.io/lifelines/";
  const CACHE_PREFIX = "ll:v1:";
  const MAX_PAGES = 3;
  const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
  const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  const state = { data: null, model: null, login: null, sample: false, req: 0 };

  /* ---------- local-only debug token (file is gitignored, never deployed) ---------- */
  const devToken = DEV ? new Promise(res => {
    const s = document.createElement("script");
    s.src = "debug-token.js"; s.onload = () => res(window.LL_DEBUG_TOKEN || null); s.onerror = () => res(null);
    document.head.appendChild(s);
  }) : Promise.resolve(null);

  /* ---------- data ---------- */

  class ApiError extends Error { constructor(kind, msg, extra) { super(msg); this.kind = kind; Object.assign(this, extra); } }

  async function gh(path) {
    const headers = { Accept: "application/vnd.github+json" };
    const tok = await devToken;
    if (tok) headers.Authorization = `Bearer ${tok}`;
    let res;
    try { res = await fetch(API + path, { headers }); }
    catch (e) { throw new ApiError("network", "Couldn't reach GitHub. Check your connection and try again."); }
    if (res.ok) return res.json();
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = +res.headers.get("x-ratelimit-reset");
    if ((res.status === 403 || res.status === 429) && (remaining === "0" || res.headers.get("retry-after"))) {
      const at = reset ? new Date(reset * 1000) : new Date(Date.now() + (+res.headers.get("retry-after") || 60) * 1000);
      throw new ApiError("rate", "rate limited", { resetAt: at });
    }
    if (res.status === 404) throw new ApiError("notfound", "not found");
    throw new ApiError("http", `GitHub answered ${res.status}.`);
  }

  const slim = r => ({
    name: r.name, html_url: r.html_url, description: r.description, language: r.language,
    created_at: r.created_at, pushed_at: r.pushed_at, stargazers_count: r.stargazers_count,
    size: r.size, fork: r.fork, archived: r.archived,
  });

  function cacheGet(login) {
    try { const v = sessionStorage.getItem(CACHE_PREFIX + login.toLowerCase()); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function cacheSet(login, data) {
    try { sessionStorage.setItem(CACHE_PREFIX + login.toLowerCase(), JSON.stringify(data)); } catch (e) { /* full or blocked: fine */ }
  }

  async function load(login) {
    const hit = cacheGet(login);
    if (hit) return hit;
    const u = await gh(`/users/${encodeURIComponent(login)}`);
    const user = { login: u.login, name: u.name, avatar_url: u.avatar_url, html_url: u.html_url, created_at: u.created_at, public_repos: u.public_repos, type: u.type };
    const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil((u.public_repos || 0) / 100)));
    let repos = [];
    if (u.public_repos > 0) {
      const all = await Promise.all(Array.from({ length: pages }, (_, i) =>
        gh(`/users/${encodeURIComponent(u.login)}/repos?per_page=100&type=owner&sort=pushed&page=${i + 1}`)));
      repos = all.flat().map(slim);
    }
    const data = { fetchedAt: new Date().toISOString(), user, repos };
    cacheSet(login, data);
    if (u.login.toLowerCase() !== login.toLowerCase()) cacheSet(u.login, data);
    return data;
  }

  /* ---------- status ---------- */

  function status(html, kind) {
    const el = $("status");
    if (!html) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false; el.className = "status" + (kind ? " " + kind : ""); el.innerHTML = html;
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function errorMessage(e, login) {
    if (e.kind === "notfound") return `There's no GitHub user or organisation called <b>@${esc(login)}</b>. Check the spelling?`;
    if (e.kind === "rate") {
      const at = e.resetAt;
      const mins = Math.max(1, Math.round((at - Date.now()) / 60000));
      const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `GitHub lets each network make 60 API requests an hour without signing in, and this one has used them up. ` +
        `It resets at <b>${esc(time)}</b> (about ${mins} minute${mins === 1 ? "" : "s"}). Posters you've already drawn in this tab still work.`;
    }
    return esc(e.message || "Something went wrong.");
  }

  /* ---------- render ---------- */

  function draw(animate) {
    const { data } = state;
    const includeForks = $("forks").checked;
    const opts = { includeForks, sample: state.sample };
    if (state.sample && data.fetchedAt) opts.now = Date.parse(data.fetchedAt);
    const m = Lifelines.build(data, opts);
    state.model = m;
    const { svg } = Lifelines.render(m, { id: "llp", interactive: true });
    const poster = $("poster");
    poster.innerHTML = svg;
    poster.classList.remove("loading");
    const el = poster.querySelector("svg");
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) el.classList.add("animate");
    hideTip();
    renderList(m);
    state.png = null;
    updateShare();
    // Pre-render the PNG on share-capable devices so the share sheet opens within the tap's user activation.
    if (!state.sample && navigator.canShare) setTimeout(() => getPNG().catch(() => {}), 1200);
  }

  function renderList(m) {
    const list = $("list");
    const rows = m.rows.slice().reverse();
    list.innerHTML = `<table><caption>${esc(Lifelines.summary(m))}</caption>
      <thead><tr><th scope="col">Project</th><th scope="col">Language</th><th scope="col">Created</th><th scope="col">Last push</th><th scope="col" class="num hide-sm">Lifespan</th><th scope="col" class="num hide-sm">Stars</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>${r.fork ? " <span class=\"k\">(fork)</span>" : ""}${r.archived ? " <span class=\"k\">(archived)</span>" : ""}</td>
        <td><span class="sw" style="background:${r.color}"></span>${esc(r.language || "—")}</td>
        <td>${Lifelines.fmtDate(r.created)}</td><td>${Lifelines.fmtDate(r.pushed)}</td>
        <td class="num hide-sm">${Lifelines.fmtSpan(r.life)}</td><td class="num hide-sm">${r.stars || ""}</td></tr>`).join("")}</tbody></table>`;
  }

  async function show(login, { push = true } = {}) {
    login = (login || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?github\.com\//i, "").split(/[/?#]/)[0];
    if (!LOGIN_RE.test(login)) { status(`That doesn't look like a GitHub username.`, "error"); return; }
    $("u").value = login;
    if (push) setUrl(login);
    const req = ++state.req;
    const btn = $("form").querySelector("button");
    btn.disabled = true;
    $("poster").classList.add("loading");
    status(`Fetching @${esc(login)}'s public repos…`);
    try {
      const data = await load(login);
      if (req !== state.req) return;
      state.data = data; state.login = data.user.login; state.sample = false;
      if (data.user.login !== login) setUrl(data.user.login, true);
      $("sampleTag").hidden = true;
      $("toolbar").hidden = !data.repos.length;
      const n = data.repos.filter(r => !r.fork).length;
      if (!data.repos.length) status(`<b>@${esc(data.user.login)}</b> has no public repositories yet, so there's nothing to draw. Yet.`);
      else if (!n && !$("forks").checked) { $("forks").checked = true; status(`@${esc(data.user.login)} only has forks, so forks are switched on.`); }
      else status("");
      document.title = `@${data.user.login} — GitHub Lifelines`;
      draw(true);
    } catch (e) {
      if (req !== state.req) return;
      $("poster").classList.remove("loading");
      status(errorMessage(e, login), "error");
      if (!state.data) loadSample();
    } finally {
      if (req === state.req) btn.disabled = false;
    }
  }

  async function loadSample() {
    try {
      const data = await (await fetch("sample.json")).json();
      if (state.data && !state.sample) return;
      state.data = data; state.sample = true; state.login = data.user.login;
      $("sampleTag").hidden = false;
      $("toolbar").hidden = true;
      draw(true);
    } catch (e) { /* sample is decoration only */ }
  }

  function setUrl(login, replace) {
    const url = new URL(location.href);
    url.search = "";
    if (login) url.searchParams.set("u", login);
    if (login && $("forks").checked) url.searchParams.set("forks", "1");
    if (url.href === location.href) return;
    history[replace ? "replaceState" : "pushState"]({ u: login }, "", url);
  }

  /* ---------- tooltip / interaction ---------- */

  let pinned = null;
  function rowOf(target) { return target && target.closest ? target.closest(".ll-row") : null; }
  function showTip(g, pin, clientX) {
    const r = state.model.rows[+g.dataset.i];
    if (!r) return;
    const tip = $("tip"), frame = $("frame");
    tip.innerHTML = `<b>${esc(r.name)}</b>${r.description ? `<div class="desc">${esc(r.description)}</div>` : ""}
      <div class="row"><span class="sw" style="background:${r.color}"></span>${esc(r.language || "No language")}${r.fork ? " · fork" : ""}${r.archived ? " · archived" : ""}</div>
      <div><span class="k">created</span> ${Lifelines.fmtDate(r.created)} <span class="k">→ last push</span> ${Lifelines.fmtDate(r.pushed)}</div>
      <div><span class="k">alive for</span> ${Lifelines.fmtSpan(r.life)}${r.stars ? ` · ★ ${r.stars.toLocaleString()}` : ""}</div>
      ${pin ? `<a class="open" href="${esc(r.url)}" target="_blank" rel="noopener">Open on GitHub →</a>` : ""}`;
    tip.hidden = false;
    tip.classList.toggle("pinned", !!pin);
    const fr = frame.getBoundingClientRect(), hr = g.querySelector(".ll-hit").getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const ax = clientX != null ? clientX - fr.left : hr.left - fr.left + Math.min(hr.width, 200) / 2;
    let x = Math.min(Math.max(ax - tw / 2, 8), fr.width - tw - 8);
    let y = hr.bottom - fr.top + 8;
    if (y + th > fr.height - 8) y = hr.top - fr.top - th - 8;
    tip.style.left = x + "px"; tip.style.top = y + "px";
    document.querySelectorAll(".ll-row.on").forEach(n => n !== g && n.classList.remove("on"));
    g.classList.add("on");
    g.ownerSVGElement && g.ownerSVGElement.classList.add("dim");
  }
  function hideTip() {
    $("tip").hidden = true; pinned = null;
    document.querySelectorAll(".ll-row.on").forEach(n => n.classList.remove("on"));
    const svg = $("poster").querySelector("svg"); if (svg) svg.classList.remove("dim");
  }
  function openRepo(g) { const r = state.model.rows[+g.dataset.i]; if (r) window.open(r.url, "_blank", "noopener"); }

  let lastPointer = "mouse";
  const poster = $("poster");
  poster.addEventListener("pointerdown", e => { lastPointer = e.pointerType; });
  poster.addEventListener("pointerover", e => { if (e.pointerType === "mouse" && !pinned) { const g = rowOf(e.target); if (g) showTip(g, false, e.clientX); } });
  poster.addEventListener("pointerout", e => { if (e.pointerType === "mouse" && !pinned && rowOf(e.target) && !rowOf(e.relatedTarget)) hideTip(); });
  poster.addEventListener("click", e => {
    const g = rowOf(e.target);
    if (!g) { hideTip(); return; }
    if (lastPointer === "touch" || lastPointer === "pen") { // tap: show details first, with an explicit link
      if (pinned === g) { hideTip(); return; }
      showTip(g, true, e.clientX); pinned = g; return;
    }
    openRepo(g);
  });
  poster.addEventListener("focusin", e => { const g = rowOf(e.target); if (g) showTip(g); });
  poster.addEventListener("focusout", e => { if (!rowOf(e.relatedTarget) && !pinned) hideTip(); });
  poster.addEventListener("keydown", e => {
    const g = rowOf(e.target); if (!g) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRepo(g); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = [...poster.querySelectorAll(".ll-row")];
      const n = rows[rows.indexOf(g) + (e.key === "ArrowDown" ? 1 : -1)];
      if (n) n.focus();
    } else if (e.key === "Escape") { hideTip(); g.blur(); }
  });
  document.addEventListener("click", e => { if (pinned && !e.target.closest("#frame")) hideTip(); });
  $("scroll").addEventListener("scroll", () => { if (!$("tip").hidden) hideTip(); }, { passive: true });

  /* ---------- export ---------- */

  const toDataURL = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  let fontCSS = null;
  async function embeddedFonts() {
    if (fontCSS) return fontCSS;
    const faces = await Promise.all([400, 500, 600].map(async w => {
      const blob = await (await fetch(`fonts/plex-mono-${w}.woff2`)).blob();
      const url = await toDataURL(new Blob([blob], { type: "font/woff2" }));
      return `@font-face{font-family:"IBM Plex Mono";font-weight:${w};src:url(${url}) format("woff2");}`;
    }));
    return (fontCSS = faces.join(""));
  }
  async function avatarData(u) {
    if (!u.avatar_url) return "";
    try {
      const res = await fetch(u.avatar_url + (u.avatar_url.includes("?") ? "&" : "?") + "s=160", { mode: "cors" });
      if (!res.ok) throw 0;
      return await toDataURL(await res.blob());
    } catch (e) { return ""; } // falls back to an initial
  }

  async function exportPNG(scale = 2) {
    const m = state.model;
    const [css, av] = await Promise.all([embeddedFonts(), avatarData(m.user)]);
    const { svg, width, height } = Lifelines.render(m, { id: "llx", fontCSS: css, avatar: av, scale });
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      img.decoding = "sync";
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width * scale; canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Safari sometimes paints SVG-embedded fonts only on a second draw.
      await new Promise(r => setTimeout(r, 60));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
    } finally { URL.revokeObjectURL(url); }
  }
  function getPNG() {
    if (!state.png) { state.png = exportPNG(2); state.png.catch(() => { state.png = null; }); }
    return state.png;
  }
  const fileName = () => `lifelines-${state.login}.png`;

  async function download() {
    const btn = $("download"); const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Rendering…";
    try {
      const blob = await getPNG();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast("Couldn't render the PNG in this browser."); console.error(e); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  /* ---------- share ---------- */

  function shareUrl() {
    const u = new URL(SITE);
    u.searchParams.set("u", state.login);
    if ($("forks").checked) u.searchParams.set("forks", "1");
    return u.href;
  }
  function shareText() {
    const m = state.model, s = m.stats;
    const span = m.firstYear === m.lastYear ? `${m.firstYear}` : `${m.firstYear}–${m.lastYear}`;
    let t = `GitHub lifelines for @${m.user.login}: ${m.total} project${m.total === 1 ? "" : "s"}, ${span}.`;
    if (s.longest && s.longest.span > 365 * 864e5) t += ` Longest-lived: ${s.longest.name} (${Lifelines.fmtSpan(s.longest.span)}).`;
    return t + " Draw yours:";
  }
  function updateShare() {
    if (state.sample || !state.model) return;
    const url = shareUrl(), text = shareText();
    $("shareX").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    $("shareLi").href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    $("share").hidden = !navigator.share;
  }
  async function nativeShare() {
    const url = shareUrl(), text = shareText();
    try {
      const blob = await getPNG();
      const file = new File([blob], fileName(), { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "GitHub Lifelines", text: `${text} ${url}` });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.share({ title: "GitHub Lifelines", text, url }); } catch (e) { /* cancelled */ }
  }
  async function copyLink() {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch (e) { window.prompt("Copy this link:", url); }
  }
  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  /* ---------- wire up ---------- */

  $("form").addEventListener("submit", e => { e.preventDefault(); show($("u").value); });
  $("example").addEventListener("click", e => { e.preventDefault(); show("pravin"); });
  document.querySelectorAll('.sample-tag a').forEach(a => a.addEventListener("click", e => { e.preventDefault(); show("pravin"); }));
  $("forks").addEventListener("change", () => { if (!state.data) return; if (!state.sample) setUrl(state.login, true); draw(false); });
  $("listToggle").addEventListener("click", () => {
    const open = $("list").hidden; $("list").hidden = !open;
    $("listToggle").setAttribute("aria-expanded", String(open));
    $("listToggle").textContent = open ? "Hide list" : "View as list";
  });
  $("download").addEventListener("click", download);
  $("share").addEventListener("click", nativeShare);
  $("copy").addEventListener("click", copyLink);
  window.addEventListener("popstate", () => route(false));
  window.addEventListener("resize", () => { if (!$("tip").hidden) hideTip(); });

  function route(push) {
    const q = new URLSearchParams(location.search);
    $("forks").checked = q.get("forks") === "1";
    const u = q.get("u");
    if (u) show(u, { push });
    else { state.data = null; status(""); loadSample(); }
  }

  // Wait for the mono font so label positions (computed for Plex Mono) match what's painted.
  const fontsReady = document.fonts ? Promise.race([document.fonts.load("500 13px 'IBM Plex Mono'"), new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
  fontsReady.then(() => route(false));

  // Hooks for automated checks (headless export test).
  window.LL = { exportPNG, state };
})();
