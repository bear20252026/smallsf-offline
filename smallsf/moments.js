// Small San Francisco moments, drawn over the map on a canvas of their own (above the vehicles, under the labels):
// fireworks when the Giants homer at Oracle Park (events.js spots the home run and calls window.__fireworks.homeRun),
// the Fourth of July show off the Wharf, New Year's at midnight off the Ferry Building, and the Blue Angels over the
// bay on Fleet Week's air show afternoons. The calendar ones start themselves, on San Francisco's clock.
// Previews: ?event=july4, ?event=newyear, ?event=fleetweek (fireworks read best after dark: add ?sun=-15);
// ?homerun=1 (events.js) fires one home run's worth straight away.
(async function () {
  while (!(window.__transit && window.mapItem)) await new Promise((r) => setTimeout(r, 300));
  const viewer = window.viewer, { G, geo, toImage } = window.__transit;
  const q = new URLSearchParams(location.search), preview = q.get("event");

  // ---- San Francisco's clock: which moment (if any) is on right now ----
  const PT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
  const sf = (d) => { const p = Object.fromEntries(PT.formatToParts(d).map((x) => [x.type, x.value])); return { y: +p.year, mo: +p.month, d: +p.day, m: (+p.hour % 24) * 60 + +p.minute + +p.second / 60 }; };
  // Fleet Week's air show: the Friday to Sunday before the second Monday of October (Columbus / Indigenous Peoples'
  // Day), so Oct 9-11 in 2026 (checked against the 2026 schedule)
  function airShowDays(y) {
    const first = new Date(Date.UTC(y, 9, 1)).getUTCDay(), mon2 = 1 + ((8 - first) % 7) + 7;
    return [mon2 - 3, mon2 - 2, mon2 - 1];
  }
  // seconds into each show; null when it isn't on
  function calendar(now) {
    const t = sf(now);
    if (t.mo === 7 && t.d === 4 && t.m >= 21 * 60 + 30 && t.m < 22 * 60) return { which: "july4", t: (t.m - (21 * 60 + 30)) * 60 };   // the show's ~30 min from 9:30
    if (t.mo === 12 && t.d === 31 && t.m >= 23 * 60 + 58) return { which: "newyear", t: (t.m - 24 * 60) * 60 };                     // a few stray shells before midnight
    if (t.mo === 1 && t.d === 1 && t.m < 20) return { which: "newyear", t: t.m * 60 };
    if (t.mo === 10 && airShowDays(t.y).includes(t.d) && t.m >= 12 * 60 + 30 && t.m < 16 * 60) return { which: "fleetweek", t: (t.m - (12 * 60 + 30)) * 60 };
    return null;
  }
  const t0 = performance.now();
  function current() {
    // previews loop a short version of the show from the moment the page opened
    if (preview === "july4") return { which: "july4", t: ((performance.now() - t0) / 1000) % 75, cycle: 75 };
    if (preview === "newyear") return { which: "newyear", t: ((performance.now() - t0) / 1000) % 70, cycle: 70 };
    if (preview === "fleetweek") return { which: "fleetweek", t: (performance.now() - t0) / 1000 };
    return calendar(new Date());
  }
  // checked once a second; at says when, so the jets can fly smoothly in between
  const stamp = (c) => (c ? { ...c, at: performance.now() } : null);
  let now = stamp(current());
  const tracked = new Set();
  setInterval(() => { now = stamp(current()); if (now && !tracked.has(now.which)) { tracked.add(now.which); window.track?.("map: calendar event", { which: now.which }); } }, 1000);

  // ---- the canvas: inside the map, above the vehicles and the fog of war, under the labels ----
  const box = viewer.canvas, cv = Object.assign(document.createElement("canvas"), { className: "sky-moments" });
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2";
  box.appendChild(cv);
  const ctx = cv.getContext("2d");
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // ---- fireworks ----
  // A shell rises from its barge (or the ballpark), bursts into a sphere of stars that fly out against air drag,
  // sag under gravity and fade, and leaves a puff of smoke. Positions are worked out in the world (metres), so it sits
  // on the map at its real height; zoomed far out, a show is drawn bigger than life around its launch point (like the
  // boats and planes), so it still reads.
  const PAL = {
    giants: ["#fd5a1e", "#fd5a1e", "#27251f", "#fffaf0", "#f2c14e"],
    july4: ["#ff3b3b", "#ff3b3b", "#fffaf0", "#5b84ff", "#5b84ff", "#ffd36b"],
    newyear: ["#ffd36b", "#ffd36b", "#fffaf0", "#d9e2f2", "#ff4fa3", "#46e0ff", "#7dff6a", "#ff3b3b"],
  };
  // the launch sites: July 4th's barges off Aquatic Park (Municipal Pier) and Pier 39; New Year's barges off the Ferry
  // Building and by the Bay Bridge; and the ballpark's own scoreboard battery for a home run
  const SITES = {
    july4: [[37.8112, -122.4228, 0], [37.8118, -122.4092, 0]],
    newyear: [[37.7968, -122.3882, 0], [37.7905, -122.3838, 0]],
    giants: [[37.7792, -122.3887, 34]],
  };
  const shells = [], smoke = [];
  function shell(site, pal, o = {}) {
    const [lat, lon, y0] = site, w = G.toWorld(lat + (Math.random() - 0.5) * 0.0004, lon + (Math.random() - 0.5) * 0.0005); w[1] = y0;
    const R = (o.R || 90) * (0.75 + Math.random() * 0.5), kinds = o.kinds || ["peony", "peony", "chrys", "willow", "ring", "crackle"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const c1 = kind === "willow" ? "#f2c14e" : pal[Math.floor(Math.random() * pal.length)], c2 = Math.random() < 0.35 ? pal[Math.floor(Math.random() * pal.length)] : c1;
    const n = Math.round((kind === "ring" ? 46 : kind === "willow" ? 70 : 80) * (window.__mobile ? 0.6 : 1));
    const parts = [];
    // a ring lies in a random tilted plane; everything else is a sphere (an even spiral of directions, jittered)
    const ax = Math.random() * Math.PI, ay = Math.random() * Math.PI;
    for (let i = 0; i < n; i++) {
      let d;
      if (kind === "ring") { const a = (i / n) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); d = [x * Math.cos(ay), z * Math.sin(ax) + x * Math.sin(ay) * 0.3, z * Math.cos(ax)]; }
      else { const yv = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - yv * yv), th = i * 2.39996 + Math.random() * 0.3; d = [Math.cos(th) * r, yv, Math.sin(th) * r]; }
      const s = kind === "ring" ? 1 : 0.85 + Math.random() * 0.3;
      parts.push({ d: d.map((v) => v * s), c: hex(i % 2 && c2 !== c1 && kind !== "ring" ? c2 : c1) });
    }
    shells.push({
      w, lat, lon, H: (o.H || 220) * (0.85 + Math.random() * 0.3), drift: [(Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12], R, kind, parts,
      rise: (o.rise || 1.4) * (0.85 + Math.random() * 0.3), t: -(o.delay || 0), tau: kind === "willow" ? 0.9 : 0.5, life: kind === "willow" ? 3.6 : kind === "crackle" ? 2.8 : 2.2,
      trail: kind === "willow" ? 0.45 : kind === "chrys" ? 0.3 : 0.12, g: kind === "willow" ? 0.16 : 0.1, ref: o.ref || 90, burst: false, show: o.show,
    });
  }
  window.__fireworks = {
    // a Giants home run: a quick volley over the ballpark (~5 s), more and bigger for a splash hit into McCovey Cove
    homeRun({ splash } = {}) {
      const n = splash ? 12 : 7, site = SITES.giants[0];
      for (let i = 0; i < n; i++) shell(site, PAL.giants, { R: splash && i === n - 1 ? 70 : 38, H: 95, rise: 0.9, ref: 40, delay: i < 3 ? i * 0.25 : 0.9 + (i - 3) * (splash ? 0.38 : 0.6), kinds: splash && i === n - 1 ? ["willow"] : ["peony", "peony", "chrys", "crackle", "ring"], show: "homerun" });
    },
    shell, get count() { return shells.length; },
  };

  // how many shells a second each show fires, by seconds into it (finales at the end)
  function rate(c) {
    if (c.which === "july4") {
      const len = c.cycle || 1800, fin = c.cycle ? 15 : 160;
      return c.t > len - fin ? 6 : 1.1 + 0.6 * Math.sin(c.t / (c.cycle ? 6 : 40));   // waves of shells, then the finale
    }
    if (c.which === "newyear") {
      if (c.cycle) return c.t < 5 ? 9 : c.t > c.cycle - 15 ? 6 : 1.4;
      if (c.t < 0) return 0.04;                       // an eager few before midnight
      if (c.t < 12) return 9;                         // midnight: the opening salvo
      if (c.t < 900) return 1.3 + 0.5 * Math.sin(c.t / 35);
      if (c.t < 1020) return 6;                       // the finale, about a quarter past
      return 0;
    }
    return 0;
  }
  let acc = 0;
  function spawn(dt) {
    const c = now;
    if (!c || c.which === "fleetweek") return;
    acc += rate(c) * dt * (0.4 + Math.random() * 1.2);
    while (acc >= 1) { acc -= 1; const sites = SITES[c.which]; shell(sites[Math.floor(Math.random() * sites.length)], PAL[c.which], { R: 95, H: 240, rise: 1.6, ref: 100, show: c.which }); }
  }

  // ---- the Blue Angels: six F/A-18 Super Hornets in the Delta, on laps over the bay ----
  // A racetrack between the Golden Gate and Alcatraz: low along the Marina and the waterfront with smoke on, pulling up
  // over the ends, higher out by Alcatraz. Not live tracking: drawn from the air show's schedule.
  const C0 = [37.8195, -122.4480], A = 2900, B = 850, SPEED = 175;   // centre, half-length E-W and half-width N-S (m), m/s
  const mLat = 111320, mLon = 111320 * Math.cos(C0[0] * Math.PI / 180);
  const path = [];
  {
    let len = 0, prev = null;
    for (let i = 0; i <= 720; i++) {
      const th = (i / 720) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const e = A * Math.sign(c) * Math.abs(c) ** 0.55, n = B * Math.sign(s) * Math.abs(s) ** 0.55;   // a squarish ellipse: long straight legs
      const w = G.toWorld(C0[0] + n / mLat, C0[1] + e / mLon); w[1] = 0;
      if (prev) len += Math.hypot(w[0] - prev[0], w[2] - prev[2]);
      // altitude: ~140 m on the crowd line (the south leg), higher on the far leg, climbing hard over each end
      const alt = 140 + (n > 0 ? 260 * (n / B) : 0) + 520 * (Math.abs(e) / A) ** 5;
      path.push({ w, len, alt, smoke: n < 0 && Math.abs(e) < A * 0.85 });
      prev = w;
    }
  }
  const LAP = path.at(-1).len;
  function along(dist) {
    dist = ((dist % LAP) + LAP) % LAP;
    let lo = 0, hi = path.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid].len < dist) lo = mid; else hi = mid; }
    const a = path[lo], b = path[hi], f = (dist - a.len) / (b.len - a.len || 1), fx = b.w[0] - a.w[0], fz = b.w[2] - a.w[2], L = Math.hypot(fx, fz) || 1;
    // the path runs counter-clockwise from the east end; flown the other way, west along the waterfront first
    return { w: [a.w[0] + fx * f, a.alt + (b.alt - a.alt) * f, a.w[2] + fz * f], fx: -fx / L, fz: -fz / L, smoke: a.smoke };
  }
  // the Delta: lead, two wingmen, the slot, and the solos further back on each side (forward a, right b, metres)
  const DELTA = [[0, 0], [-13, 9], [-13, -9], [-26, 0], [-26, 18], [-26, -18]];
  let jets = [];      // screen hit areas, for clicks
  window.__blueAngels = () => jets;   // for testing: where they are on screen
  // the Super Hornet from above, in metres (nose +9.2, tail -9.1, span 13.6): fuselage, wings with leading-edge
  // extensions, stabilators, twin canted fins; navy blue with the team's yellow trim
  const BODY = [[9.2, 0], [7.2, 0.45], [4.5, 0.85], [-6.6, 1.15], [-9.1, 0.85], [-9.1, -0.85], [-6.6, -1.15], [4.5, -0.85], [7.2, -0.45]];
  const WING = [[4.4, 0.85], [1.0, 2.0], [-0.7, 6.8], [-2.3, 6.8], [-4.4, 2.0], [-4.8, 1.1]];
  const LEX = [[4.4, 0.85], [1.0, 2.0], [-0.7, 6.8], [-1.0, 6.8], [0.7, 2.25], [3.6, 1.15]];   // the yellow leading edge
  const STAB = [[-6.3, 1.1], [-7.9, 3.5], [-9.2, 3.5], [-8.8, 1.1]];
  const FIN = [[-5.4, 1.25, 0.6], [-7.4, 1.95, 3.6], [-8.6, 2.05, 3.6], [-8.6, 1.3, 0.6]];
  const NAVY = "#0d2a5c", GOLD = "#f6c12b";
  function drawJet(at, k, shadowAt) {
    const poly = (pts, mirror, h, fill) => {
      ctx.beginPath();
      pts.forEach(([a, b, hh], i) => { const p = at(a, mirror * b, hh ?? h); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
    };
    if (shadowAt) {   // its shadow on the water, soft and gone by ~1,500 m up
      ctx.save(); ctx.globalAlpha = shadowAt.a; ctx.fillStyle = "#0b1418"; ctx.strokeStyle = "transparent";
      for (const m of [1, -1]) { ctx.beginPath(); WING.forEach(([a, b], i) => { const p = shadowAt.at(a, m * b); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.fill(); }
      ctx.beginPath(); BODY.forEach(([a, b], i) => { const p = shadowAt.at(a, b); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.fill();
      ctx.restore();
    }
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(0.5, Math.min(1, k * 0.35)); ctx.strokeStyle = "rgba(10,18,30,0.6)";
    for (const m of [1, -1]) { poly(STAB, m, 0.2, NAVY); poly(WING, m, 0.5, NAVY); poly(LEX, m, 0.55, GOLD); }
    poly(BODY, 1, 0.9, NAVY);
    const c = at(5.2, 0, 1.6), n = at(6.6, 0, 1.6);   // the canopy
    ctx.fillStyle = "#3b4b5c"; ctx.beginPath(); ctx.ellipse(c[0], c[1], Math.max(1, Math.hypot(n[0] - c[0], n[1] - c[1])), Math.max(0.6, Math.hypot(n[0] - c[0], n[1] - c[1]) * 0.45), Math.atan2(n[1] - c[1], n[0] - c[0]), 0, Math.PI * 2); ctx.fill();
    for (const m of [1, -1]) poly(FIN, m, 0, NAVY);
    const s0 = at(8.6, 0, 1.0), s1 = at(-8.8, 0, 1.0);   // the gold stripe down the spine
    ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = Math.max(0.6, k * 0.25); ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke(); ctx.restore();
  }

  // ---- clicking a jet: its card ----
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  viewer.addHandler("canvas-click", (e) => {
    if (!e.quick || !jets.length || e.preventDefaultAction) return;
    const h = jets.find((j) => Math.hypot(j.x - e.position.x, j.y - e.position.y) < j.r);
    if (!h) return;
    e.preventDefaultAction = true;   // before buildings.js looks under it
    window.track?.("map: blue angels open");
    // after the other click handlers have run (an empty click elsewhere closes the open card)
    setTimeout(() => {
      const card = document.getElementById("card"); if (!card) return;
      card.innerHTML = `<button class="x" aria-label="Close">×</button><h2>Blue Angels · Fleet Week</h2>
        <p>The U.S. Navy's flight demonstration squadron: six F/A-18 Super Hornets in the Delta formation, a few feet apart.</p>
        <p>They fly the Fleet Week air show over the bay between the Golden Gate and Alcatraz, Friday to Sunday afternoons. Marina Green has the best free view.</p>
        <p><a href="https://fleetweeksf.org" target="_blank" rel="noopener">Fleet Week San Francisco ↗</a></p>
        <p class="meta">${esc("Drawn from the air show's schedule, not tracked live.")}</p>`;
      card.hidden = false;
      card.querySelector(".x").onclick = () => (card.hidden = true);
    }, 0);
  }, null, 50);   // ahead of the other map clicks

  // ---- each frame ----
  let drawn = false, last = performance.now();
  function frame(nowT) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (nowT - last) / 1000); last = nowT;
    spawn(dt);
    const fleet = now && now.which === "fleetweek" && !window.__planesOff;
    if (!shells.length && !smoke.length && !fleet) {   // nothing on: an empty canvas and no work
      if (drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; }
      jets = [];
      return;
    }
    drawn = true;
    const dpr = window.__dpr || 1, cw = box.clientWidth, ch = box.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
    const mi = window.mapItem, o = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), e = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0));
    const k = (e.x - o.x) / 1000, pxPerM = k / geo.mpp;
    const scr = (w) => { const p = toImage(w); return [o.x + p[0] * k, o.y + p[1] * k]; };
    const night = Math.max(0, Math.min(1, (-(window.atmo?.alt ?? 30) + 2) / 6));

    // smoke first, under the stars
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i]; s.t += dt; if (s.t > s.life) { smoke.splice(i, 1); continue; }
      const K = Math.max(1, 22 / (s.ref * pxPerM)), p = scr([s.w[0] + s.off[0] * K + s.t * 2 * K, s.w[1] + (s.off[1] - s.t * 1.5) * K, s.w[2] + s.off[2] * K]);
      const r = (s.R * (0.7 + s.t / s.life * 0.6)) * K * pxPerM, a = (night ? 0.06 : 0.16) * (1 - s.t / s.life) * Math.min(1, s.t * 3);
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
      g.addColorStop(0, night ? `rgba(150,140,130,${a})` : `rgba(235,232,226,${a})`); g.addColorStop(1, "rgba(235,232,226,0)");
      ctx.fillStyle = g; ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
    }
    // the shells: lit stars add up after dark; by day they're coloured sparks against the city
    ctx.globalCompositeOperation = night > 0.3 ? "lighter" : "source-over";
    ctx.lineCap = "round";
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i]; s.t += dt;
      if (s.t < 0) continue;
      if (s.t > s.rise + s.life) { shells.splice(i, 1); continue; }
      const K = Math.max(1, 22 / (s.ref * pxPerM));
      // seen through the fog: the satellite's fog where it bursts dims it to a glow
      if (s.fog == null) s.fog = Math.min(0.75, (window.__fogAtLL?.(s.lat, s.lon) ?? 0) * 0.85);
      const vis = 1 - s.fog;
      const W = (dx, dy, dz) => scr([s.w[0] + dx * K, s.w[1] + dy * K, s.w[2] + dz * K]);
      if (s.t < s.rise) {   // rising: a pale spark with a short tail
        const u = s.t / s.rise, u0 = Math.max(0, (s.t - 0.18) / s.rise), h = (v) => s.H * (1 - (1 - v) ** 2);
        const a = W(s.drift[0] * h(u0), h(u0), s.drift[1] * h(u0)), b = W(s.drift[0] * h(u), h(u), s.drift[1] * h(u));
        ctx.globalAlpha = 0.85 * vis; ctx.strokeStyle = "#ffe6b0"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        continue;
      }
      const t = s.t - s.rise, c = [s.drift[0] * s.H, s.H, s.drift[1] * s.H];
      if (!s.burst) {
        s.burst = true;
        smoke.push({ w: s.w, off: c, R: s.R * 0.9, t: 0, life: 7, ref: s.ref });
        window.__sound?.boom?.({ lat: s.lat, lon: s.lon, big: s.R > 60 });
      }
      // the flash: a soft bloom that lights the sky round it for a moment
      if (t < 0.4 && night > 0) {
        const p = W(...c), r = s.R * 1.8 * K * pxPerM, col = s.parts[0].c, a = 0.4 * night * vis * (1 - t / 0.4);
        const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
      }
      // falling: gravity against drag, so the stars settle to a slow drift down (terminal speed ~1.2 s of free fall)
      const R = s.R, TF = 1.2, fall = (tt) => s.g * R * TF * (tt - TF * (1 - Math.exp(-tt / TF))), out = (tt) => R * (1 - Math.exp(-Math.max(0, tt) / s.tau));
      const fade = Math.max(0, 1 - (t / s.life) ** 2), t1 = Math.max(0, t - s.trail), o0 = out(t1), o1 = out(t), f0 = fall(t1), f1 = fall(t);
      ctx.lineWidth = Math.max(1.1, Math.min(3, R * K * pxPerM * 0.04)) * (night ? 1 : 1.3);
      for (const p of s.parts) {
        let a = fade * vis;
        if (s.kind === "crackle" && t > s.life * 0.45) a *= Math.random() < 0.5 ? 1 : 0.15;   // glitter at the end
        if (a < 0.02) continue;
        const d = p.d, A0 = W(c[0] + d[0] * o0, c[1] + d[1] * o0 - f0, c[2] + d[2] * o0), A1 = W(c[0] + d[0] * o1, c[1] + d[1] * o1 - f1, c[2] + d[2] * o1);
        // a dark star (the Giants' black) only shows by day; after dark it burns a deep orange
        const col = night > 0.3 && p.c[0] + p.c[1] + p.c[2] < 150 ? [214, 72, 18] : p.c;
        ctx.globalAlpha = a; ctx.strokeStyle = `rgb(${col})`;
        ctx.beginPath(); ctx.moveTo(A0[0], A0[1]); ctx.lineTo(A1[0], A1[1]); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

    // the Blue Angels
    jets = [];
    if (fleet) {
      const ft = now.t + (nowT - now.at) / 1000, lead = along(-ft * SPEED);   // backwards along the path: west down the waterfront first
      const L = 18.3, kk = Math.max(1, 30 / (L * pxPerM));   // drawn bigger than life when zoomed out, formation and all
      const slot = (p, a, b) => [p.w[0] + (p.fx * a - p.fz * b) * kk, p.w[1], p.w[2] + (p.fz * a + p.fx * b) * kk];
      // the smoke: one white ribbon per jet along where the formation was over the last 6 s (the path is fixed, so it's
      // worked out rather than remembered: smooth at any frame rate), widening and fading as it hangs; a stroke per
      // tenth of a second with flat ends, so the see-through pieces meet without doubling up
      ctx.lineCap = "butt"; ctx.strokeStyle = "#ffffff";
      const past = [];
      for (let age = 0; age <= 6; age += 0.1) past.push({ age, p: along(-(ft - age) * SPEED) });
      for (const [a, b] of DELTA) {
        let prev = null;
        for (const { age, p } of past) {
          const w = slot(p, a - 9, b); w[1] -= age * 3;   // it settles a little
          const s2 = scr(w);
          if (prev && p.smoke && prev.smoke) {
            ctx.globalAlpha = 0.5 * (1 - age / 6); ctx.lineWidth = Math.max(1.2, (2 + age * 2.5) * pxPerM * Math.min(kk, 2.5));
            ctx.beginPath(); ctx.moveTo(prev.s[0], prev.s[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
          }
          prev = { s: s2, smoke: p.smoke };
        }
      }
      ctx.globalAlpha = 1;
      // the jets, back to front, with their shadows on the water
      const order = DELTA.map((d, i) => ({ d, i })).sort((x, y) => scr(slot(lead, ...x.d))[1] - scr(slot(lead, ...y.d))[1]);
      for (const { d: [a, b] } of order) {
        const c = slot(lead, a, b), rx = -lead.fz, rz = lead.fx;
        const at = (aa, bb, h) => scr([c[0] + (lead.fx * aa + rx * bb) * kk, c[1] + h * kk, c[2] + (lead.fz * aa + rz * bb) * kk]);
        const sh = { a: night > 0.5 ? 0 : 0.2 * Math.max(0, 1 - c[1] / 1500), at: (aa, bb) => scr([c[0] + (lead.fx * aa + rx * bb) * kk, 0, c[2] + (lead.fz * aa + rz * bb) * kk]) };
        drawJet(at, kk * pxPerM, sh.a > 0.01 ? sh : null);
        const s = scr(c); jets.push({ x: s[0], y: s[1], r: Math.max(14, L * kk * pxPerM * 0.6) });
      }
    }
  }
  requestAnimationFrame(frame);
})();
