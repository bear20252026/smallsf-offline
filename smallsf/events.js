// Live games at Oracle Park (Giants) and Chase Center (Warriors, Valkyries), from ESPN's public scoreboards.
// During a game: a score badge over the venue, and its lights glow after dark.
// Preview with ?event=oracle or ?event=chase (add :post for a finished game).
// A Giants home run at Oracle Park sets off fireworks over the ballpark (drawn by moments.js), and while the Giants are
// home the kayaks and little boats gather in McCovey Cove. Preview a home run with ?homerun=1 (?homerun=splash for a
// splash hit into the cove).
(async function () {
  while (!(window.__transit && window.mapItem)) await new Promise((r) => setTimeout(r, 300));
  const viewer = window.viewer, { G, geo, toImage } = window.__transit;
  const VENUES = {
    oracle: { name: "Oracle Park", lat: 37.77837, lon: -122.38911, y: 30, match: /oracle park/i, leagues: [["baseball", "mlb"]] },
    chase: { name: "Chase Center", lat: 37.76797, lon: -122.38761, y: 28, match: /chase center/i, leagues: [["basketball", "nba"], ["basketball", "wnba"]] },
  };
  const q = new URLSearchParams(location.search).get("event");
  const state = {};   // venue -> { phase: "pre"|"in"|"post", line, ended }

  async function poll() {
    for (const [key, V] of Object.entries(VENUES)) {
      let found = null;
      for (const [sport, league] of V.leagues) {
        try {
          const d = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`).then((r) => r.json());
          for (const e of d.events || []) {
            const c = e.competitions?.[0];
            if (!c || !V.match.test(c.venue?.fullName || "")) continue;
            const st = e.status.type, home = c.competitors.find((t) => t.homeAway === "home"), away = c.competitors.find((t) => t.homeAway === "away");
            const gc = (e.links || []).find((l) => (l.rel || []).includes("summary"))?.href || (e.links || [])[0]?.href || null;
            const tv = [...new Set([...(c.broadcasts || []).flatMap((b) => b.names || []), ...(c.geoBroadcasts || []).map((g) => g.media?.shortName).filter(Boolean)])];
            const sfg = c.competitors.find((t) => t.team?.abbreviation === "SF") || home;
            found = { league, id: e.id, gid: String(sfg.team?.id ?? sfg.id ?? ""), gc, tv, phase: st.state, detail: st.shortDetail, home: home.team.shortDisplayName || home.team.abbreviation, away: away.team.shortDisplayName || away.team.abbreviation, hs: home.score, as: away.score, start: Date.parse(e.date) };
            if (st.state === "post") found.ended = state[key]?.ended || Date.now();
          }
        } catch {}
      }
      if (found && state[key]?.hr) found.hr = state[key].hr;   // keep a home run's flash on the badge
      state[key] = found;
    }
    if (q) {   // preview
      const [k, ph] = q.split(":"), V = VENUES[k];
      if (V) state[k] = { league: k === "oracle" ? "mlb" : "nba", gc: "https://www.espn.com/", tv: [k === "oracle" ? "NBCSBA" : "NBCSBA"], phase: ph || "in", detail: ph === "post" ? "Final" : k === "oracle" ? "Bot 7th" : "Q3 4:12", home: k === "oracle" ? "Giants" : "Warriors", away: k === "oracle" ? "Dodgers" : "Lakers", hs: "5", as: "3", ended: Date.now() - 5 * 60e3 };
    }
    draw();
  }

  // ---- the badge over each venue ----
  const pins = {};
  function draw() {
    for (const [key, V] of Object.entries(VENUES)) {
      const s = state[key], show = s && (s.phase === "in" || (s.phase === "post" && Date.now() - s.ended < 45 * 60e3) || (s.phase === "pre" && s.start - Date.now() < 90 * 60e3));
      if (!show) { if (pins[key]) { viewer.removeOverlay(pins[key]); pins[key] = null; } continue; }
      if (!pins[key]) {
        const el = document.createElement("div");
        el.className = "gamepin";
        const px = G.toPixelAt(V.lat, V.lon, V.y);
        viewer.addOverlay({ element: el, location: window.mapItem.imageToViewportCoordinates(px.x, px.y), placement: OpenSeadragon.Placement.BOTTOM, checkResize: false });
        pins[key] = el;
        new OpenSeadragon.MouseTracker({ element: el, clickHandler: (e) => { if (e.quick) openGame(key); } });
      }
      const live = s.phase === "in";
      pins[key].classList.toggle("on", live);
      const extra = s.phase === "pre" ? new Date(s.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : s.phase === "in" ? s.detail : "";
      if (s.hr && Date.now() < s.hr.until) { pins[key].innerHTML = `<b>${s.hr.splash ? "SPLASH HIT" : "HOME RUN"}</b>${esc(s.hr.who || s.home)} <span>· ${s.away} ${s.as}–${s.hs} ${s.home}</span>`; continue; }
      pins[key].innerHTML = `<b>${live ? "LIVE" : s.phase === "pre" ? "TONIGHT" : "FINAL"}</b>${s.away} ${s.phase === "pre" ? "at" : s.as + "–" + s.hs} ${s.home}${extra ? ` <span>· ${extra}</span>` : ""}`;
    }
  }
  const style = document.createElement("style");
  style.textContent = `.gamepin{background:rgba(245,240,228,.92);color:var(--ink);font:600 10.5px/1 -apple-system,sans-serif;padding:3px 6px 3px 3px;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.2);white-space:nowrap;transform:translateY(-6px);cursor:pointer;transition:opacity .2s}
    .gamepin b{color:#fff;background:#5d6a6c;padding:2px 4px;border-radius:2px;margin-right:5px;font-size:8.5px;letter-spacing:.05em}.gamepin.on b{background:#c8102e;animation:gp 1.6s infinite}
    .gamepin span{font-weight:400;color:#5d6a6c}.gamepin.far{opacity:0;pointer-events:none}.gamepin:hover{box-shadow:0 2px 8px rgba(0,0,0,.35)}@keyframes gp{50%{opacity:.55}}`;
  document.head.appendChild(style);

  // ---- the game card: score, where it's on, and the live gamecast (or recap) ----
  const WATCH = { mlb: ["MLB.TV", "https://www.mlb.com/tv"], nba: ["NBA League Pass", "https://www.nba.com/watch/league-pass-stream"], wnba: ["WNBA League Pass", "https://www.wnba.com/league-pass-stream"] };
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function openGame(key) {
    const s = state[key], V = VENUES[key], card = document.getElementById("card");
    if (!s || !card) return;
    window.track?.("game: open", { venue: V.name, league: s.league || "" });
    const live = s.phase === "in", pre = s.phase === "pre", w = WATCH[s.league];
    const head = pre ? `${esc(s.away)} at ${esc(s.home)}` : `${esc(s.away)} ${esc(s.as)} – ${esc(s.hs)} ${esc(s.home)}`;
    const when = pre ? `Starts ${new Date(s.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : live ? `Live · ${esc(s.detail)}` : "Final";
    card.innerHTML = `<button class="x" aria-label="Close">×</button><h2>${head}</h2><p>${when} at ${V.name}</p>
      ${s.tv?.length ? `<p>On TV: <b>${s.tv.map(esc).join(", ")}</b></p>` : ""}
      <p>${s.gc ? `<a href="${esc(s.gc)}" target="_blank" rel="noopener">${s.phase === "post" ? "Recap and box score" : "Live gamecast"} on ESPN ↗</a>` : ""}${w && !pre && s.phase !== "post" ? `${s.gc ? " · " : ""}<a href="${w[1]}" target="_blank" rel="noopener">Stream on ${w[0]} ↗</a>` : ""}</p>
      <p class="meta">Score from ESPN, checked every 2 minutes. Local broadcasts may be blacked out on streaming.</p>`;
    card.hidden = false;
    card.querySelector(".x").onclick = () => (card.hidden = true);
  }

  // like the landmark labels: only once zoomed in a bit
  const fade = () => { const pxPerM = window.mapItem.viewportToImageZoom(viewer.viewport.getZoom(true)) / geo.mpp; for (const el of Object.values(pins)) if (el) el.classList.toggle("far", pxPerM < 0.6); };
  viewer.addHandler("animation", fade); setInterval(fade, 1000);

  // ---- Giants home runs: fireworks over the ballpark ----
  // While a Giants game at Oracle Park is live (and the tab is looked at), ESPN's play-by-play from the game summary
  // (~75 KB gzipped) every 25 s. Every pitch is a play; a home run shows as a "home-run" pitch and then a "play-result"
  // whose text says "Gilbert homered to right (375 feet)." Both carry the at-bat's id, which is what fires once. Only
  // Giants batters: the half-inning they bat in (bottom at home), and the play result's batting team when it has one.
  // Plays already there when the page opens don't fire, unless they're under 90 s old.
  function homeRunsIn(sum, gid) {
    const g = sum?.header?.competitions?.[0]?.competitors?.find((c) => String(c.id ?? c.team?.id) === String(gid)), half = g?.homeAway === "away" ? "Top" : "Bottom";
    const out = new Map();
    for (const p of sum?.plays || []) {
      const hr = p.type?.type === "home-run" || p.alternativeType?.type === "home-run" || /\bhomer(s|ed)\b/i.test(p.text || "");
      if (!hr) continue;
      const ours = p.type?.type === "play-result" && p.team?.id ? String(p.team.id) === String(gid) : p.period?.type === half;
      if (!ours) continue;
      const key = p.atBatId || p.id, prev = out.get(key), text = /homer/i.test(p.text || "") ? p.text : prev?.text || "";
      // ESPN's text rarely says where it landed; a splash hit only when it does ("Splash Hit", "McCovey Cove")
      out.set(key, { key, text, who: (text.match(/^(.+?) homer/i) || [])[1] || "", splash: /splash|mccovey|\bcove\b/i.test(text), at: Date.parse(p.wallclock || "") || 0 });
    }
    return [...out.values()];
  }
  window.__homeRunsIn = homeRunsIn;   // for testing against a past game's summary
  const seenHR = new Set();
  let seededFor = null;
  function homeRun(hr, from) {
    window.__fireworks?.homeRun({ splash: hr.splash });
    window.track?.("map: home run fireworks", { splash: !!hr.splash, from });
    if (state.oracle) { state.oracle.hr = { ...hr, until: Date.now() + 15e3 }; draw(); setTimeout(draw, 15.5e3); }
    cove.rush = { until: performance.now() + 25e3 };   // everyone in the cove paddles for the wall
  }
  async function pollPlays() {
    const s = state.oracle;
    if (!s || s.phase !== "in" || !s.id || !s.gid || document.hidden) return;
    try {
      const sum = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${s.id}`).then((r) => r.json());
      const first = seededFor !== s.id; seededFor = s.id;
      for (const hr of homeRunsIn(sum, s.gid)) {
        if (seenHR.has(hr.key)) continue;
        seenHR.add(hr.key);
        if (!first || Date.now() - hr.at < 90e3) homeRun(hr, "live");
      }
    } catch {}
  }
  setInterval(pollPlays, 25e3);
  const hrq = new URLSearchParams(location.search).get("homerun");
  if (hrq) (async () => { while (!window.__fireworks) await new Promise((r) => setTimeout(r, 300)); setTimeout(() => homeRun({ who: "Preview", splash: hrq === "splash" }, "preview"), 1200); })();

  // ---- McCovey Cove: kayaks and small boats wait for a splash hit while the Giants are home ----
  // Simulated, like boats.js's sailboats (no badges, no cards); drawn by transit.js through window.__boats.
  const cove = { boats: [], rush: null };
  const COVE = { lat: 37.7771, lon: -122.3889, wall: [37.7776, -122.3895] };   // the middle of the cove, and right field's wall
  const KAY = ["#e8542f", "#f2c14e", "#2f7fc1", "#3fa34d", "#d9363e", "#fd5a1e"], SHIRT = ["#fd5a1e", "#27251f", "#f4f2ec", "#fd5a1e"];
  const c0 = G.toWorld(37.777, -122.388), cn = G.toWorld(37.778, -122.388), ce = G.toWorld(37.777, -122.387);
  const unit = (a, b) => { const x = b[0] - a[0], z = b[2] - a[2], n = Math.hypot(x, z); return [x / n, z / n]; };
  const Nn = unit(c0, cn), Ee = unit(c0, ce);
  const dirOf = (deg) => { const r = (deg * Math.PI) / 180; return [Nn[0] * Math.cos(r) + Ee[0] * Math.sin(r), Nn[1] * Math.cos(r) + Ee[1] * Math.sin(r)]; };
  const wet = (lat, lon) => (window.__isWater ? !!window.__isWater(lat, lon) : true);
  function spot(nearWall) {   // somewhere on the cove's water (near the wall in a rush)
    for (let k = 0; k < 30; k++) {
      const [la, lo] = nearWall ? COVE.wall : [COVE.lat, COVE.lon], r = nearWall ? 0.0003 : 0.0006;
      const lat = la + (Math.random() - 0.5) * r * 2, lon = lo + (Math.random() - 0.5) * r * 2.6;
      if (wet(lat, lon)) return [lat, lon];
    }
    return [COVE.lat, COVE.lon];
  }
  function kayak(i) {
    const motor = i >= 6, L = motor ? 6 : 4.2, W = motor ? 2.2 : 0.7, [lat, lon] = spot(false);
    const parts = motor
      ? [{ a0: -0.5, a1: 0.5, h0: 0, h1: 0.7, ch: 0.3, bow: 0.25, side: "#fbfaf5", roof: "#d9c9a3" }, { a0: -0.15, a1: 0.18, w: 0.7, h0: 0.7, h1: 1.5, ch: 0.3, ti: 0.2, side: "#2f3d48", roof: "#ffffff" }]
      : [{ a0: -0.5, a1: 0.5, h0: 0, h1: 0.3, ch: 0.1, bow: 0.35, side: KAY[i % KAY.length], roof: KAY[i % KAY.length] }, { a0: -0.09, a1: 0.07, w: 0.75, h0: 0.3, h1: 0.95, ch: 0.12, side: SHIRT[i % SHIRT.length], roof: "#3a2c22" }];
    return { id: "cove" + i, lat, lon, hdg: Math.random() * 360, tgt: spot(false), speed: motor ? 1.6 : 1.1, a: 0, L, K: { L, Wd: W, Hh: motor ? 1.5 : 0.95, parts, side: parts[0].side, roof: parts[0].roof, type: "pleasure", r: null } };
  }
  const coveOn = () => state.oracle?.phase === "in" || !!hrq;
  let coveT = performance.now();
  function stepCove() {
    const t = performance.now(), dt = Math.min(0.1, (t - coveT) / 1000); coveT = t;
    if (coveOn() && !cove.boats.length) cove.boats = Array.from({ length: 8 }, (_, i) => kayak(i));
    const rush = cove.rush && t < cove.rush.until;
    if (cove.rush && !rush) { cove.rush = null; for (const b of cove.boats) b.tgt = spot(false); }
    for (const b of cove.boats.slice()) {
      b.a = coveOn() ? Math.min(1, b.a + dt / 2) : b.a - dt / 2;
      if (b.a <= 0 && !coveOn()) { cove.boats.splice(cove.boats.indexOf(b), 1); continue; }
      if (rush && !b.rushing) { b.rushing = true; b.tgt = spot(true); }
      if (!rush) b.rushing = false;
      const dy = (b.tgt[0] - b.lat) * 111320, dx = (b.tgt[1] - b.lon) * 111320 * Math.cos(b.lat * Math.PI / 180), d = Math.hypot(dx, dy);
      b.moving = d > 3;
      if (!b.moving) { if (Math.random() < dt * (rush ? 0 : 0.03)) b.tgt = spot(false); continue; }   // bobbing, until it drifts off somewhere else
      const want = (Math.atan2(dx, dy) * 180) / Math.PI;
      b.hdg = (b.hdg + (((want - b.hdg + 540) % 360) - 180) * Math.min(1, dt * 1.5) + 360) % 360;
      const v = b.speed * (rush ? 1.6 : 1) * dt, r = (b.hdg * Math.PI) / 180;
      const lat = b.lat + (v * Math.cos(r)) / 111320, lon = b.lon + (v * Math.sin(r)) / (111320 * Math.cos((b.lat * Math.PI) / 180));
      if (wet(lat, lon)) { b.lat = lat; b.lon = lon; } else b.tgt = spot(rush);
    }
  }
  (async () => {
    while (!window.__boats) await new Promise((r) => setTimeout(r, 500));
    const inner = window.__boats;
    window.__boats = (Wc, Hc, scr) => {
      const out = inner(Wc, Hc, scr);
      stepCove();
      for (const b of cove.boats) {
        const w = G.toWorld(b.lat, b.lon); w[1] = 0;
        const s = scr(w); if (s[0] < -100 || s[1] < -100 || s[0] > Wc + 100 || s[1] > Hc + 100) continue;
        const s2 = scr([w[0] + 100, w[1], w[2]]), pxPerM = Math.hypot(s2[0] - s[0], s2[1] - s[1]) / 100;
        if (pxPerM < 0.35) continue;   // too far out to see a kayak
        const k = Math.max(1, 7 / (b.L * pxPerM));
        const K = { ...b.K, L: b.K.L * k, Wd: b.K.Wd * k, Hh: b.K.Hh * k, hs: k, wake: b.moving ? b.L * 1.5 * k : 0 };
        out.push({ v: b, p: { w, dir: dirOf(b.hdg) }, depth: s[2], at: s, K, alpha: Math.max(0, b.a), boat: true });
      }
      return out;
    };
  })();

  // ---- stadium lights after dark ----
  const box = viewer.canvas, cv = Object.assign(document.createElement("canvas"), { className: "sky-events" });
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  box.insertBefore(cv, box.querySelector(".sky-fog"));
  const ctx = cv.getContext("2d");
  let drawn = true;
  function frame() {
    requestAnimationFrame(frame);
    const night = Math.max(0, Math.min(1, (-(window.atmo?.alt ?? 30) + 2) / 6));
    const on = night > 0 && Object.keys(VENUES).some((k) => state[k]?.phase === "in");
    // nothing lit: leave the canvas empty and do no work
    if (!on) { if (drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; } return; }
    drawn = true;
    const dpr = window.__softDpr || window.__dpr || 1, cw = box.clientWidth, ch = box.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
    const mi = window.mapItem, o = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), e = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0));
    const k = (e.x - o.x) / 1000, pxPerM = k / geo.mpp;
    ctx.globalCompositeOperation = "lighter";
    for (const [key, V] of Object.entries(VENUES)) {
      if (state[key]?.phase !== "in") continue;
      // the lights: a bright bloom over the venue
      const p = G.toPixelAt(V.lat, V.lon, V.y + 10), x = o.x + p.x * k, y = o.y + p.y * k, r = Math.max(30, 140 * pxPerM);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,250,225,${0.55 * night})`); g.addColorStop(0.4, `rgba(255,240,200,${0.22 * night})`); g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  requestAnimationFrame(frame);
  await poll();
  setInterval(poll, 120e3);
})();
