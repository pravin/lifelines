/* GitHub Lifelines — data model + SVG poster renderer.
   Pure functions, no DOM access, so the same code draws the page, the PNG export and the OG image. */
(function (global) {
  "use strict";

  const W = 1200;            // poster width in SVG units
  const P = 64;              // outer margin
  const ROW = 24;            // height of one lifeline row
  const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
  const CH = 0.6;            // IBM Plex Mono advance width, in em (every glyph is 600/1000)
  const DAY = 864e5, YEAR = 365.25 * DAY;
  const MAX_ROWS = 40;

  const C = {
    ground: "#0b1220", panel: "#0e1729", ink: "#dfe6f2", ink2: "#9aa7bd", ink3: "#5c6a83",
    line: "#22314e", amber: "#e8a33d", cyan: "#5fa8bc",
  };
  // Categorical slots for languages, validated against the navy ground (dataviz validator, dark mode).
  // Assigned to a person's languages by how often they use them, across all repos (forks included),
  // so toggling forks never repaints a language.
  const SLOTS = ["#d68a24", "#3f7fd0", "#3f9a6e", "#c25f9c", "#b9a332", "#2f9fbd", "#d4553c", "#8576d6"];
  const OTHER = "#7d8aa3", NOLANG = "#5c6a83";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tw = (s, size, ls = 0) => [...String(s)].length * (size * CH + ls); // text width in mono
  const clip = (s, n) => { const a = [...String(s)]; return a.length > n ? a.slice(0, Math.max(1, n - 1)).join("") + "…" : a.join(""); };
  const t = d => Date.parse(d);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = ms => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const fmtSpan = ms => {
    const y = ms / YEAR;
    if (y >= 1) return `${y >= 10 ? Math.round(y) : y.toFixed(1).replace(/\.0$/, "")} yr${y >= 1.05 ? "s" : ""}`;
    const m = Math.round(ms / (YEAR / 12));
    if (m >= 1) return `${m} mo`;
    const d = Math.round(ms / DAY);
    return d <= 1 ? "1 day" : `${d} days`;
  };

  /* ---------- model ---------- */

  function interest(r, now) {
    const life = Math.max(0, t(r.pushed_at) - t(r.created_at)) / YEAR;
    const age = (now - t(r.pushed_at)) / YEAR;
    return Math.log2(1 + (r.stargazers_count || 0)) * 2
      + Math.min(life, 10) * 0.8
      + Math.log10(1 + (r.size || 0)) * 0.6
      + (age < 1 ? 2 : age < 3 ? 1 : 0)
      + (r.description ? 0.5 : 0)
      - (r.archived ? 0.5 : 0);
  }

  function build(data, opts = {}) {
    const now = opts.now || Date.now();
    const user = data.user;
    const all = (data.repos || []).filter(r => r.created_at && r.pushed_at);

    // Language colours: by frequency over everything fetched, ties by name.
    const freq = {};
    all.forEach(r => { if (r.language) freq[r.language] = (freq[r.language] || 0) + 1; });
    const ranked = Object.keys(freq).sort((a, b) => freq[b] - freq[a] || a.localeCompare(b));
    const colorOf = {};
    ranked.forEach((l, i) => { colorOf[l] = i < SLOTS.length ? SLOTS[i] : OTHER; });
    const color = lang => (lang ? colorOf[lang] || OTHER : NOLANG);

    const eligible = all.filter(r => opts.includeForks || !r.fork);
    const forkCount = all.filter(r => r.fork).length;
    let shown = eligible;
    if (eligible.length > MAX_ROWS) {
      shown = eligible.map(r => [r, interest(r, now)]).sort((a, b) => b[1] - a[1]).slice(0, MAX_ROWS).map(x => x[0]);
    }
    shown = shown.slice().sort((a, b) => t(a.created_at) - t(b.created_at) || a.name.localeCompare(b.name));

    const rows = shown.map(r => {
      const c = t(r.created_at), p = t(r.pushed_at);
      return {
        name: r.name, url: r.html_url, description: r.description || "", language: r.language || null,
        color: color(r.language), stars: r.stargazers_count || 0, fork: !!r.fork, archived: !!r.archived,
        created: c, pushed: p, start: Math.min(c, p), end: Math.max(c, p),
        prehistory: p < c,                 // fork/import whose last push predates its creation here
        alive: now - p < 90 * DAY,
        life: Math.max(0, p - c),
      };
    });

    // Stats over every eligible project (not only the ones drawn).
    const stats = {};
    if (eligible.length) {
      const lon = eligible.reduce((a, r) => (t(r.pushed_at) - t(r.created_at) > t(a.pushed_at) - t(a.created_at) ? r : a));
      stats.longest = { name: lon.name, span: Math.max(0, t(lon.pushed_at) - t(lon.created_at)) };
      const years = {};
      eligible.forEach(r => { const y = new Date(r.created_at).getUTCFullYear(); years[y] = (years[y] || 0) + 1; });
      const by = Object.keys(years).sort((a, b) => years[b] - years[a] || b - a)[0];
      stats.busiest = { year: +by, count: years[by] };
      const star = eligible.reduce((a, r) => ((r.stargazers_count || 0) > (a.stargazers_count || 0) ? r : a));
      stats.starred = star.stargazers_count > 0 ? { name: star.name, stars: star.stargazers_count } : null;
      const first = eligible.reduce((a, r) => (t(r.created_at) < t(a.created_at) ? r : a));
      stats.first = { name: first.name, at: t(first.created_at) };
      stats.totalStars = eligible.reduce((s, r) => s + (r.stargazers_count || 0), 0);
      stats.active = eligible.filter(r => now - t(r.pushed_at) < YEAR).length;
      const lf = {};
      eligible.forEach(r => { const k = r.language || "—"; lf[k] = (lf[k] || 0) + 1; });
      stats.languages = Object.keys(lf).filter(k => k !== "—")
        .sort((a, b) => lf[b] - lf[a] || a.localeCompare(b))
        .map(l => ({ name: l, count: lf[l], color: color(l) }));
      stats.noLanguage = lf["—"] || 0;
    }

    const firstYear = rows.length ? new Date(Math.min(...rows.map(r => r.start))).getUTCFullYear() : null;
    const lastYear = new Date(now).getUTCFullYear();
    return {
      user, rows, stats, now, firstYear, lastYear,
      total: eligible.length, shownCount: rows.length, forkCount,
      includeForks: !!opts.includeForks,
      scanned: all.length, publicRepos: user.public_repos || all.length,
      truncatedScan: (user.public_repos || 0) > (data.repos || []).length,
      fetchedAt: data.fetchedAt,
      sample: !!opts.sample,
    };
  }

  /* ---------- svg ---------- */

  function ticks(t0, t1) {
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    const out = [];
    if (y1 - y0 >= 2) {
      const step = y1 - y0 > 24 ? 4 : y1 - y0 > 13 ? 2 : 1;
      for (let y = y0 + 1; y <= y1; y++) out.push({ at: Date.UTC(y, 0, 1), label: String(y), major: (y % step) === 0 });
    } else {
      const months = (t1 - t0) / (YEAR / 12);
      const step = months > 14 ? 3 : months > 6 ? 2 : 1;
      const d = new Date(t0);
      let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
      for (;;) {
        if (m > 11) { m = 0; y++; }
        const at = Date.UTC(y, m, 1);
        if (at > t1) break;
        out.push({ at, label: m === 0 ? String(y) : `${MON[m]} ${String(y).slice(2)}`, major: m % step === 0 });
        m++;
      }
    }
    return out;
  }

  function rowLabel(r) {
    return { text: clip(r.name, 34), stars: r.stars ? `★${r.stars >= 1000 ? (r.stars / 1000).toFixed(1).replace(/\.0$/, "") + "k" : r.stars}` : "" };
  }

  /**
   * render(model, opts) -> { svg: string, width, height }
   * opts.id: prefix for ids; opts.avatar: href override (data: URL for export); opts.fontCSS: @font-face css to embed;
   * opts.interactive: add focus/aria hooks and animation classes; opts.scale: output pixel scale.
   */
  function render(m, opts = {}) {
    const id = opts.id || "ll";
    const interactive = !!opts.interactive;
    const u = m.user;
    const plotL = P, plotR = W - P, plotW = plotR - plotL;
    const out = [];
    let y = 0;

    /* header */
    const headTop = 70;
    const span = m.firstYear ? (m.firstYear === m.lastYear ? `${m.firstYear}` : `${m.firstYear}–${m.lastYear}`) : "";
    const count = `${m.total} project${m.total === 1 ? "" : "s"}`;
    const rightW = Math.max(tw(span, 34), tw(count, 15), tw("GITHUB LIFELINES", 12, 2.2));
    const nameMax = Math.floor((W - P - (P + 100) - rightW - 32) / (36 * CH));
    const display = clip(u.name || u.login, Math.max(8, nameMax));
    const joined = u.created_at ? `on GitHub since ${new Date(u.created_at).getUTCFullYear()}` : "";
    const avatarHref = opts.avatar !== undefined ? opts.avatar : (u.avatar_url ? u.avatar_url + (u.avatar_url.includes("?") ? "&" : "?") + "s=160" : "");
    const head = [];
    head.push(`<circle cx="${P + 40}" cy="${headTop + 40}" r="41" fill="${C.panel}" stroke="${C.line}"/>`);
    if (avatarHref) head.push(`<image href="${esc(avatarHref)}" x="${P}" y="${headTop}" width="80" height="80" clip-path="url(#${id}-av)" preserveAspectRatio="xMidYMid slice"/>`);
    else head.push(`<text x="${P + 40}" y="${headTop + 52}" text-anchor="middle" font-size="34" font-weight="600" fill="${C.amber}">${esc((u.login || "?")[0].toUpperCase())}</text>`);
    head.push(`<circle cx="${P + 40}" cy="${headTop + 40}" r="40.5" fill="none" stroke="${C.cyan}" stroke-opacity=".5"/>`);
    head.push(`<text x="${P + 104}" y="${headTop + 38}" font-size="36" font-weight="600" fill="${C.ink}" letter-spacing="-1">${esc(display)}</text>`);
    head.push(`<text x="${P + 105}" y="${headTop + 68}" font-size="15" fill="${C.ink2}">@${esc(u.login)}<tspan fill="${C.ink3}">${joined ? "  ·  " + esc(joined) : ""}</tspan></text>`);
    head.push(`<text x="${W - P}" y="${headTop + 6}" text-anchor="end" font-size="12" font-weight="500" letter-spacing="2.2" fill="${C.amber}">GITHUB LIFELINES</text>`);
    head.push(`<text x="${W - P}" y="${headTop + 46}" text-anchor="end" font-size="34" font-weight="500" letter-spacing="-1" fill="${C.ink}">${esc(span)}</text>`);
    head.push(`<text x="${W - P}" y="${headTop + 72}" text-anchor="end" font-size="15" fill="${C.ink2}">${esc(count)}</text>`);
    out.push(`<g>${head.join("")}</g>`);
    y = headTop + 80 + 44;
    out.push(`<line x1="${P}" x2="${W - P}" y1="${y}" y2="${y}" stroke="${C.line}"/>`);

    /* chart */
    const rows = m.rows;
    const chartTop = y + 30;            // top axis labels baseline area
    const rowsTop = chartTop + 22;
    const rowsH = Math.max(rows.length, 1) * ROW;
    const chartBottom = rowsTop + rowsH + 6;
    const chart = [];

    if (rows.length) {
      const minT = Math.min(...rows.map(r => r.start));
      const ys = new Date(minT).getUTCFullYear();
      let t0 = Date.UTC(ys, 0, 1);
      const t0base = t0;
      if (m.now - t0 < 2 * YEAR) t0 = Date.UTC(ys, new Date(minT).getUTCMonth(), 1);
      const spanT = m.now - t0;
      const t1 = m.now + spanT * 0.07;
      const labelW = r => { const l = rowLabel(r); return tw(l.text, 12.5) + (l.stars ? tw(" ", 12.5) + [...l.stars].length * 12.5 * 0.62 + 2 : 0); };
      // Pull the left edge back in time just enough that early, long-running projects can be
      // labelled before their start dot instead of on top of their own line (capped at 28% of the width).
      for (let pass = 0; pass < 3; pass++) {
        const Xp = ms => plotL + ((ms - t0) / (t1 - t0)) * plotW;
        let need = 0;
        rows.forEach(r => {
          const x1 = Xp(r.start), x2 = Math.max(Xp(r.end), x1), w = labelW(r);
          const endPad = r.alive ? (x2 - x1 < 8 ? 15 : 10) : 5;
          if (x2 + endPad + 10 + w <= plotR) return;
          need = Math.max(need, w + 18 - (x1 - plotL));
        });
        if (need <= 1) break;
        t0 = Math.max(t0 - (need / plotW) * (t1 - t0) * 1.02, t0base - 0.4 * (t1 - t0base));
      }
      const X = ms => plotL + ((ms - t0) / (t1 - t0)) * plotW;

      // gridlines + axis labels
      const tk = ticks(t0, t1);
      let lastLabelX = -1e9;
      const minGap = 46;
      tk.forEach(k => {
        const x = X(k.at);
        if (x < plotL - 0.5 || x > plotR) return;
        chart.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${chartTop - 6}" y2="${chartBottom}" stroke="${C.cyan}" stroke-opacity="${k.major ? 0.16 : 0.07}"/>`);
        if (k.major && x - lastLabelX >= minGap && x < X(m.now) - 52) {
          chart.push(`<text x="${x.toFixed(1)}" y="${chartTop - 12}" text-anchor="middle" font-size="11" fill="${C.ink3}">${k.label}</text>`);
          chart.push(`<text x="${x.toFixed(1)}" y="${chartBottom + 18}" text-anchor="middle" font-size="11" fill="${C.ink3}">${k.label}</text>`);
          lastLabelX = x;
        }
      });
      // joined marker
      if (u.created_at && t(u.created_at) > t0) {
        const jx = X(t(u.created_at));
        chart.push(`<line x1="${jx.toFixed(1)}" x2="${jx.toFixed(1)}" y1="${rowsTop - 6}" y2="${chartBottom}" stroke="${C.ink3}" stroke-dasharray="2 4"/>`);
        chart.push(`<text x="${(jx + 5).toFixed(1)}" y="${rowsTop - 8}" font-size="10" letter-spacing="1.2" fill="${C.ink3}">JOINED</text>`);
      }
      // NOW marker
      const nx = X(m.now);
      chart.push(`<line x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${chartTop - 6}" y2="${chartBottom}" stroke="${C.amber}" stroke-opacity=".55" stroke-dasharray="3 3"/>`);
      chart.push(`<text x="${nx.toFixed(1)}" y="${chartTop - 12}" text-anchor="middle" font-size="11" font-weight="600" letter-spacing="1.5" fill="${C.amber}">NOW</text>`);

      rows.forEach((r, i) => {
        const cy = rowsTop + i * ROW + ROW / 2;
        const x1 = X(r.start), x2 = Math.max(X(r.end), x1);
        const lab = rowLabel(r);
        const fs = 12.5;
        const gap = 10;
        const wName = tw(lab.text, fs), wStar = lab.stars ? tw(" ", fs) + [...lab.stars].length * fs * 0.62 + 2 : 0;
        const wl = wName + wStar;
        const endPad = r.alive ? (x2 - x1 < 8 ? 15 : 10) : 5;
        let lx, anchor = "start", on = false;
        if (x2 + endPad + gap + wl <= plotR) lx = x2 + endPad + gap;
        else if (x1 - 6 - gap - wl >= plotL) { lx = x1 - 6 - gap; anchor = "end"; }
        else { lx = Math.min(Math.max(x1 + 16, plotL), plotR - wl); on = true; }
        const lx0 = anchor === "end" ? lx - wl : lx;
        const hitL = Math.max(plotL - 8, Math.min(x1 - 8, lx0 - 4)), hitR = Math.min(plotR + 8, Math.max(x2 + 12, lx0 + wl + 4));
        const g = [];
        g.push(`<rect class="ll-hit" x="${hitL.toFixed(1)}" y="${cy - ROW / 2}" width="${(hitR - hitL).toFixed(1)}" height="${ROW}" fill="${C.cyan}" fill-opacity="0"/>`);
        const sw = r.fork ? 2 : 3;
        const dash = r.fork ? ` stroke-dasharray="5 4"` : "";
        if (r.prehistory) {
          // pushes that predate the repo's creation here (fork or import): dashed pre-history
          g.push(`<line x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${cy}" y2="${cy}" stroke="${r.color}" stroke-width="2" stroke-opacity=".7" stroke-dasharray="2 4" stroke-linecap="round"/>`);
        } else if (x2 - x1 > 0.5) {
          g.push(`<line ${r.fork ? `class="ll-fork"` : `class="ll-line" pathLength="1"`} x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${cy}" y2="${cy}" stroke="${r.color}" stroke-width="${sw}" stroke-linecap="round"${dash}/>`);
        }
        // start dot (creation)
        const sx = r.prehistory ? x2 : x1;
        g.push(`<circle class="ll-dot" cx="${sx.toFixed(1)}" cy="${cy}" r="4.5" fill="${r.color}" stroke="${C.ground}" stroke-width="2"/>`);
        // end mark (last push)
        const ex = r.prehistory ? x1 : x2;
        if (r.archived) g.push(`<rect class="ll-dot" x="${(ex - 3.5).toFixed(1)}" y="${cy - 3.5}" width="7" height="7" fill="${C.ground}" stroke="${r.color}" stroke-width="1.6"/>`);
        else if (r.alive) g.push(`<path class="ll-dot" d="M${(ex + (x2 - x1 < 8 ? 7 : 2)).toFixed(1)} ${cy - 4.5} l6 4.5 l-6 4.5" fill="none" stroke="${r.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
        else if (Math.abs(x2 - x1) > 7) g.push(`<circle class="ll-dot" cx="${ex.toFixed(1)}" cy="${cy}" r="2.8" fill="${C.ground}" stroke="${r.color}" stroke-width="1.6"/>`);
        // label
        const halo = ` stroke="${C.ground}" stroke-width="${on ? 9 : 5}" stroke-linejoin="round" paint-order="stroke"`;
        g.push(`<text class="ll-label" x="${lx.toFixed(1)}" y="${cy + 4.3}" text-anchor="${anchor}" font-size="${fs}" fill="${r.fork ? C.ink2 : C.ink}"${halo}>${esc(lab.text)}${lab.stars ? `<tspan fill="${C.ink3}" font-size="11"> ${esc(lab.stars)}</tspan>` : ""}</text>`);
        const aria = `${r.name}${r.fork ? " (fork)" : ""}, ${r.language || "no language"}, created ${fmtDate(r.created)}, last push ${fmtDate(r.pushed)}${r.stars ? `, ${r.stars} stars` : ""}`;
        const attrs = interactive ? ` class="ll-row" tabindex="0" role="link" data-i="${i}" style="--i:${i}" aria-label="${esc(aria)}"` : "";
        chart.push(`<g${attrs}>${g.join("")}</g>`);
      });
    } else {
      chart.push(`<text x="${W / 2}" y="${rowsTop + 4}" text-anchor="middle" font-size="16" fill="${C.ink2}">No public projects to draw yet.</text>`);
    }
    out.push(`<g>${chart.join("")}</g>`);
    y = chartBottom + 26;

    // note about capping
    const notes = [];
    if (m.shownCount < m.total) notes.push(`showing ${m.shownCount} of ${m.total} ${m.includeForks ? "repos" : "projects"} · picked by stars, lifespan & recent activity`);
    if (m.truncatedScan) notes.push(`scanned the ${m.scanned} most recently pushed of ${m.publicRepos} public repos`);
    if (!m.includeForks && m.forkCount) notes.push(`${m.forkCount} fork${m.forkCount === 1 ? "" : "s"} hidden`);
    if (notes.length) {
      out.push(`<text x="${P}" y="${y + 14}" font-size="11" fill="${C.ink3}">${esc(notes.join("  ·  "))}</text>`);
      y += 22;
    }

    /* stats */
    const s = m.stats;
    if (m.total) {
      y += 14;
      out.push(`<line x1="${P}" x2="${W - P}" y1="${y}" y2="${y}" stroke="${C.line}"/>`);
      const cells = [];
      if (s.longest) cells.push(["LONGEST-LIVED", s.longest.name, fmtSpan(s.longest.span) + " of pushes"]);
      if (s.busiest) cells.push(["BUSIEST YEAR", String(s.busiest.year), `${s.busiest.count} new project${s.busiest.count === 1 ? "" : "s"}`]);
      if (s.starred) cells.push(["MOST STARRED", s.starred.name, `${s.starred.stars.toLocaleString("en-US")} stars · ${s.totalStars.toLocaleString("en-US")} total`]);
      else if (s.first) cells.push(["FIRST PROJECT", s.first.name, `created ${fmtDate(s.first.at)}`]);
      cells.push(["ACTIVE NOW", `${s.active} of ${m.total}`, "pushed in the last 12 months"]);
      const cw = (W - 2 * P) / cells.length;
      cells.forEach((c, i) => {
        const x = P + i * cw;
        if (i) out.push(`<line x1="${x}" x2="${x}" y1="${y + 18}" y2="${y + 96}" stroke="${C.line}"/>`);
        const tx = x + (i ? 22 : 0);
        const max = Math.floor((cw - 30) / (22 * CH));
        out.push(`<text x="${tx}" y="${y + 38}" font-size="11" font-weight="500" letter-spacing="1.8" fill="${C.amber}">${c[0]}</text>`);
        out.push(`<text x="${tx}" y="${y + 70}" font-size="22" font-weight="500" letter-spacing="-.5" fill="${C.ink}">${esc(clip(c[1], max))}</text>`);
        out.push(`<text x="${tx}" y="${y + 92}" font-size="12" fill="${C.ink2}">${esc(clip(c[2], Math.floor((cw - 30) / (12 * CH))))}</text>`);
      });
      y += 116;

      /* language legend */
      const legend = (s.languages || []).filter(l => l.color !== OTHER);
      if (legend.length || s.noLanguage) {
        out.push(`<line x1="${P}" x2="${W - P}" y1="${y}" y2="${y}" stroke="${C.line}"/>`);
        y += 34;
        out.push(`<text x="${P}" y="${y}" font-size="11" font-weight="500" letter-spacing="1.8" fill="${C.amber}">LANGUAGES</text>`);
        let lx = P + 126, ly = y;
        const items = legend.map(l => ({ label: l.name, n: l.count, color: l.color }));
        const rest = (s.languages || []).filter(l => l.color === OTHER).reduce((a, l) => a + l.count, 0);
        if (rest) items.push({ label: "other", n: rest, color: OTHER });
        if (s.noLanguage) items.push({ label: "none", n: s.noLanguage, color: NOLANG });
        items.forEach(it => {
          const w = 22 + tw(`${it.label} ${it.n}`, 13) + 26;
          if (lx + w > W - P + 20) { lx = P + 126; ly += 26; }
          out.push(`<line x1="${lx}" x2="${lx + 14}" y1="${ly - 4.5}" y2="${ly - 4.5}" stroke="${it.color}" stroke-width="3" stroke-linecap="round"/>`);
          out.push(`<text x="${lx + 22}" y="${ly}" font-size="13" fill="${C.ink}">${esc(it.label)} <tspan fill="${C.ink3}">${it.n}</tspan></text>`);
          lx += w;
        });
        y = ly + 20;
        // key for the marks
        y += 14;
        const kx = P + 126;
        const key = [];
        key.push(`<circle cx="${kx + 4}" cy="${y - 4}" r="4" fill="${C.ink2}"/><text x="${kx + 14}" y="${y}" font-size="11" fill="${C.ink3}">created</text>`);
        key.push(`<circle cx="${kx + 94}" cy="${y - 4}" r="2.8" fill="${C.ground}" stroke="${C.ink2}" stroke-width="1.6"/><text x="${kx + 103}" y="${y}" font-size="11" fill="${C.ink3}">last push</text>`);
        key.push(`<path d="M${kx + 190} ${y - 8.5} l6 4.5 l-6 4.5" fill="none" stroke="${C.ink2}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="${kx + 203}" y="${y}" font-size="11" fill="${C.ink3}">pushed in last 90 days</text>`);
        key.push(`<rect x="${kx + 376}" y="${y - 7.5}" width="7" height="7" fill="${C.ground}" stroke="${C.ink2}" stroke-width="1.6"/><text x="${kx + 390}" y="${y}" font-size="11" fill="${C.ink3}">archived</text>`);
        if (m.includeForks && m.forkCount) key.push(`<line x1="${kx + 470}" x2="${kx + 496}" y1="${y - 4}" y2="${y - 4}" stroke="${C.ink2}" stroke-width="2" stroke-dasharray="5 4"/><text x="${kx + 504}" y="${y}" font-size="11" fill="${C.ink3}">fork</text>`);
        out.push(key.join(""));
        y += 10;
      }
    }

    /* footer */
    y += 30;
    out.push(`<line x1="${P}" x2="${W - P}" y1="${y}" y2="${y}" stroke="${C.line}"/>`);
    y += 30;
    const stamp = m.sample && m.fetchedAt ? `example · data from ${m.fetchedAt.slice(0, 10)}` : `drawn ${new Date(m.now).toISOString().slice(0, 10)} · public data`;
    out.push(`<text x="${P}" y="${y}" font-size="12" fill="${C.ink2}">github.com/${esc(u.login)}<tspan fill="${C.ink3}">  ·  ${esc(stamp)}</tspan></text>`);
    out.push(`<text x="${W - P}" y="${y}" text-anchor="end" font-size="12" font-weight="500" letter-spacing=".5" fill="${C.amber}">pravin.github.io/lifelines</text>`);
    const H = Math.round(y + 44);

    // frame, grid, corner ticks
    const bg = [];
    bg.push(`<rect width="${W}" height="${H}" fill="${C.ground}"/>`);
    bg.push(`<rect width="${W}" height="${H}" fill="url(#${id}-g1)"/><rect width="${W}" height="${H}" fill="url(#${id}-g2)"/>`);
    bg.push(`<rect x="24.5" y="24.5" width="${W - 49}" height="${H - 49}" fill="none" stroke="${C.line}"/>`);
    bg.push(`<path d="M24.5 44.5V24.5H44.5M${W - 24.5} ${H - 44.5}V${H - 24.5}H${W - 44.5}" fill="none" stroke="${C.cyan}" stroke-width="1.5"/>`);
    bg.push(`<path d="M${W - 44.5} 24.5H${W - 24.5}V44.5M44.5 ${H - 24.5}H24.5V${H - 44.5}" fill="none" stroke="${C.cyan}" stroke-opacity=".35"/>`);

    const scale = opts.scale || 1;
    const defs = `<defs>${opts.fontCSS ? `<style>${opts.fontCSS}</style>` : ""}`
      + `<pattern id="${id}-g1" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="${C.cyan}" stroke-opacity=".045"/></pattern>`
      + `<pattern id="${id}-g2" width="140" height="140" patternUnits="userSpaceOnUse"><path d="M140 0H0V140" fill="none" stroke="${C.cyan}" stroke-opacity=".08"/></pattern>`
      + `<clipPath id="${id}-av"><circle cx="${P + 40}" cy="${headTop + 40}" r="40"/></clipPath></defs>`;
    const title = `GitHub lifelines for @${u.login}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" font-family="${esc(MONO)}"${interactive ? ` class="ll-svg" role="group" aria-labelledby="${id}-title ${id}-desc"` : ""}>`
      + `<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(summary(m))}</desc>`
      + defs + bg.join("") + out.join("") + `</svg>`;
    return { svg, width: W, height: H };
  }

  function summary(m) {
    const u = m.user;
    if (!m.total) return `@${u.login} has no public projects yet.`;
    const s = m.stats;
    const parts = [`${m.total} public project${m.total === 1 ? "" : "s"} by @${u.login}, ${m.firstYear === m.lastYear ? m.firstYear : `${m.firstYear} to ${m.lastYear}`}.`];
    if (m.shownCount < m.total) parts.push(`Showing ${m.shownCount}.`);
    if (s.longest) parts.push(`Longest-lived: ${s.longest.name} (${fmtSpan(s.longest.span)}).`);
    if (s.busiest) parts.push(`Busiest year: ${s.busiest.year} with ${s.busiest.count} new.`);
    if (s.languages && s.languages.length) parts.push(`Top languages: ${s.languages.slice(0, 3).map(l => l.name).join(", ")}.`);
    return parts.join(" ");
  }

  global.Lifelines = { build, render, summary, fmtDate, fmtSpan, MAX_ROWS };
})(typeof window !== "undefined" ? window : globalThis);
