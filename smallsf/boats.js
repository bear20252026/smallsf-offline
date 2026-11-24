// Live boats from AIS (/api/boats): ferries, cargo ships, tankers, tugs, sailboats. Each boat glides on from its
// last report at its reported speed and course, and eases onto the next report instead of jumping. Drawn by transit.js.
(async function () {
  while (!window.__transit) await new Promise((r) => setTimeout(r, 200));
  const { G, toImage, geo } = window.__transit;
  // where the water is (8 m cells in camera space, from the photo layer's bay mask), so boats never sail over the city
  let water = null;
  try {
    const meta = await fetch("water.json?v=" + (window.__cv || "")).then((r) => r.json());
    const res = await fetch("water.bin?v=" + (window.__cv || ""));
    const bits = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    water = { ...meta, bits };
  } catch {}
  function isWater(lat, lon) {
    if (!water) return true;
    const w = G.toWorld(lat, lon); w[1] = 0;
    const q = toImage(w), cx = geo.x0 + q[0] * geo.mpp, cy = geo.y1 - q[1] * geo.mpp;
    const i = Math.floor((cx - water.x0) / water.cell), j = Math.floor((water.y1 - cy) / water.cell);
    if (i < 0 || j < 0 || i >= water.w || j >= water.h) return true;   // off the mapped area: open bay
    return (water.bits[j * water.rowBytes + (i >> 3)] >> (7 - (i & 7))) & 1;
  }
  window.__boatsAll = () => [...boats.values()];   // debugging: every boat with its look (K)
  window.__isWater = isWater;   // shared with events.js so the post-game crowd stays on land
  const KN = 0.5144;  // knots -> m/s
  // world-space north and east at the middle of the map (the map is small enough for one pair)
  const c0 = G.toWorld(37.79, -122.40), cn = G.toWorld(37.791, -122.40), ce = G.toWorld(37.79, -122.399);
  const unit = (a, b) => { const x = b[0] - a[0], z = b[2] - a[2], n = Math.hypot(x, z); return [x / n, z / n]; };
  const N = unit(c0, cn), E = unit(c0, ce);
  const dirOf = (deg) => { const r = (deg * Math.PI) / 180; return [N[0] * Math.cos(r) + E[0] * Math.sin(r), N[1] * Math.cos(r) + E[1] * Math.sin(r)]; };

  const LOOK = {
    passenger: { L: 40, W: 11, Hh: 6, side: "#f4f2ec", roof: "#ffffff", band: "#1f5f9f", label: "Ferry" },
    cargo: { L: 200, W: 32, Hh: 11, side: "#7a2a24", roof: "#59636c", label: "Cargo ship" },
    tanker: { L: 180, W: 30, Hh: 9, side: "#2d3a44", roof: "#a0412e", label: "Tanker" },
    tug: { L: 30, W: 10, Hh: 6, side: "#c8432b", roof: "#f4f2ec", label: "Tug" },
    sailing: { L: 11, W: 3.6, Hh: 1.6, side: "#fbfaf5", roof: "#e6dfcf", label: "Sailboat" },
    pleasure: { L: 12, W: 4, Hh: 2.4, side: "#fbfaf5", roof: "#eeeae0", label: "Boat" },
    fishing: { L: 20, W: 6, Hh: 4, side: "#2f5d7c", roof: "#e9e4d6", label: "Fishing boat" },
    service: { L: 25, W: 8, Hh: 5, side: "#e2b23a", roof: "#f4f2ec", label: "Work boat" },
    military: { L: 120, W: 16, Hh: 9, side: "#6b7278", roof: "#7d848a", label: "Navy ship" },
  };
  const CONTAINERS = ["#b5462f", "#2f6f9f", "#3f7d4e", "#d9a640", "#6b4b8a", "#8a8f94", "#c9662e", "#1f4f7a"];
  const GLASS = "#2f3d48", WHITE = "#f6f4ee", OFF = "#e8e4da";
  const rnd = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const TOUR = /HORNBLOWER|BELLE|CLIPPER|CRUISE|ALCATRAZ|BLUE ?& ?GOLD|RED ?& ?WHITE|HARBOR|DREAM|ENTERPRISE|ZEPHYR|COMMODORE|CALIFORNIA|YACHT|CELEBRATION|EMPRESS|DIGNITY|ROYAL/i;
  // a boat as a few blocks (heights in metres at true size; a0/a1 along the length from -0.5 stern to 0.5 bow)
  function design(kind, L, W, seed) {
    const r = rnd(seed), P = [];
    const hull = (h, side, deck, bow = 0.12) => P.push({ a0: -0.5, a1: 0.5, h0: 0, h1: h, ch: Math.min(2, W * 0.15), bow, side, roof: deck });
    if (kind === "cargo") {
      const fb = Math.max(3, L * 0.05);
      hull(fb, r() < 0.5 ? "#7a2a24" : "#2d3a44", "#59636c", 0.1);
      const hS = 2.6, rows = Math.max(3, Math.round(L / 22));
      for (let i = 0; i < rows; i++) {
        const a0 = -0.28 + (i / rows) * 0.62, a1 = a0 + 0.62 / rows - 0.012, tiers = 2 + Math.floor(r() * 3);
        P.push({ a0, a1, w: 0.9, h0: fb, h1: fb + tiers * hS, side: CONTAINERS[Math.floor(r() * CONTAINERS.length)], roof: CONTAINERS[Math.floor(r() * CONTAINERS.length)] });
      }
      P.push({ a0: -0.47, a1: -0.36, w: 0.95, h0: fb, h1: fb + 6, side: WHITE, roof: OFF });                       // accommodation block
      P.push({ a0: -0.46, a1: -0.37, w: 1.0, h0: fb + 6, h1: fb + 13, ti: 0.4, side: WHITE, roof: OFF });          // bridge
      P.push({ a0: -0.47, a1: -0.36, w: 0.7, h0: fb + 13, h1: fb + 14.5, side: GLASS, roof: OFF });
      return { parts: P, Hh: fb + 14.5 };
    }
    if (kind === "tanker") {
      const fb = Math.max(3, L * 0.05);
      hull(fb, "#2d3a44", "#a0412e", 0.1);
      P.push({ a0: -0.3, a1: 0.38, w: 0.08, h0: fb, h1: fb + 1.2, side: "#c9c4b8", roof: "#d8d3c6" });               // pipe rack
      P.push({ a0: -0.48, a1: -0.36, w: 0.9, h0: fb, h1: fb + 9, side: WHITE, roof: OFF });
      P.push({ a0: -0.47, a1: -0.37, w: 1.0, h0: fb + 9, h1: fb + 11, side: GLASS, roof: OFF });
      P.push({ a0: -0.5, a1: -0.46, w: 0.25, h0: fb + 9, h1: fb + 15, side: "#2d3a44", roof: "#c8432b" });            // funnel
      return { parts: P, Hh: fb + 15 };
    }
    if (kind === "tour") {   // party / sightseeing boats: a white hull stacked with decks
      const decks = L > 45 ? 3 : 2;
      hull(2.2, WHITE, OFF, 0.16);
      let h = 2.2;
      for (let d = 0; d < decks; d++) {
        const a0 = -0.46 + d * 0.06, a1 = 0.3 - d * 0.08, w = 0.94 - d * 0.06;
        P.push({ a0, a1, w, h0: h, h1: h + 0.8, ch: 0.6, side: WHITE, roof: WHITE });
        P.push({ a0, a1, w, h0: h + 0.8, h1: h + 2.3, ch: 0.6, side: GLASS, roof: d === decks - 1 ? OFF : WHITE });
        h += 2.6;
      }
      P.push({ a0: 0.12, a1: 0.24, w: 0.4, h0: h - 0.3, h1: h + 1.4, ch: 0.3, side: GLASS, roof: WHITE });           // wheelhouse
      return { parts: P, Hh: h + 1.4 };
    }
    if (kind === "ferry") {  // commuter ferries: a long glassed cabin on a white catamaran, a stripe, a wheelhouse
      hull(1.8, WHITE, OFF, 0.1);
      P.push({ a0: -0.5, a1: 0.42, w: 1.0, h0: 1.8, h1: 2.4, bow: 0.06, side: "#1f5f9f", roof: "#1f5f9f" });
      P.push({ a0: -0.42, a1: 0.32, w: 0.94, h0: 2.4, h1: 4.6, ch: 1, ti: 0.3, side: GLASS, roof: WHITE });
      if (L > 35) P.push({ a0: -0.3, a1: 0.18, w: 0.86, h0: 4.6, h1: 6.6, ch: 1, ti: 0.3, side: GLASS, roof: OFF });
      P.push({ a0: 0.1, a1: 0.24, w: 0.5, h0: L > 35 ? 6.6 : 4.6, h1: (L > 35 ? 6.6 : 4.6) + 1.6, ch: 0.4, side: GLASS, roof: WHITE });
      return { parts: P, Hh: L > 35 ? 8.2 : 6.2 };
    }
    if (kind === "tug") {
      hull(2.2, "#c8432b", "#8a3a2a", 0.2);
      P.push({ a0: -0.2, a1: 0.25, w: 0.7, h0: 2.2, h1: 4.4, ch: 0.6, side: WHITE, roof: WHITE });
      P.push({ a0: -0.02, a1: 0.2, w: 0.6, h0: 4.4, h1: 6.8, ch: 0.5, side: GLASS, roof: WHITE });
      P.push({ a0: -0.16, a1: -0.08, w: 0.25, h0: 4.4, h1: 7.2, side: "#2b2f33", roof: "#2b2f33" });
      return { parts: P, Hh: 7.2 };
    }
    if (kind === "sailing") {
      hull(1.1, WHITE, "#d9c9a3", 0.3);
      P.push({ a0: -0.22, a1: 0.08, w: 0.55, h0: 1.1, h1: 1.9, ch: 0.4, side: WHITE, roof: OFF });
      P.push({ a0: -0.2, a1: 0.22, w: 0.06, h0: 1.9, h1: 1.9 + L * 1.1, ti: L * 0.2, side: "#fffdf6", roof: "#fffdf6", sail: true });   // the sail
      return { parts: P, Hh: 1.9 + L * 1.1 };
    }
    if (kind === "military") {
      hull(4, "#6b7278", "#7d848a", 0.22);
      P.push({ a0: -0.25, a1: 0.12, w: 0.7, h0: 4, h1: 11, ch: 1.5, ti: 0.8, side: "#7d848a", roof: "#8a9196" });
      return { parts: P, Hh: 11 };
    }
    // motorboats, fishing and work boats: a pointed hull and a small cabin
    const col = kind === "fishing" ? "#2f5d7c" : kind === "service" ? "#e2b23a" : WHITE;
    hull(Math.max(0.9, L * 0.08), col, kind === "pleasure" ? "#d9c9a3" : OFF, 0.25);
    const fb = Math.max(0.9, L * 0.08);
    P.push({ a0: -0.15, a1: 0.18, w: 0.7, h0: fb, h1: fb + Math.max(1, L * 0.12), ch: 0.4, ti: 0.3, side: GLASS, roof: kind === "pleasure" ? WHITE : col });
    return { parts: P, Hh: fb + Math.max(1, L * 0.12) };
  }
  // AIS destinations are typed in by the crew: often codes or junk ("XX XXX>US^0VC6"). Keep only ones that read as a place;
  // for "FROM>TO" keep the part after the arrow.
  const cleanDest = (d) => { let x = String(d || "").trim(); if (x.includes(">")) x = x.split(">").pop().trim(); x = x.replace(/[_]+/g, " ").trim();
    return /^[A-Za-z][A-Za-z .,'-]{2,}$/.test(x) && !/^(X+|N\/?A|NONE|UNKNOWN|TBA)$/i.test(x.replace(/\s/g, "")) && !/^([A-Z]{2} ?[A-Z]{3})$/.test(x) ? title(x) : ""; };
  const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  const boats = new Map();   // id -> { r: last report, off: [dlat, dlon] easing out, K, id, dest }
  // the bay's commuter ferries by name (Golden Gate Ferry, San Francisco Bay Ferry, the Angel Island boats): many
  // report a generic "other"/"service" AIS type, so the name wins
  const FERRY = /^(SONOMA|MARIN|SAN FRANCISCO|MENDOCINO|NAPA|DEL NORTE|GOLDEN GATE|BAY BREEZE|SOLANO|PERALTA|ENCINAL|GEMINI|PISCES|SCORPIO|TAURUS|HYDRUS|CETUS|DORADO|LYRA|VELA|CARINA|ARGO|PYXIS|DELPHINUS|MARE ISLAND|INTINTOLI|VALLEJO|ANGEL ISLAND|ISLAND SPIRIT)$/i;
  function look(s, id) {
    let type = FERRY.test((s.name || "").trim()) ? "passenger" : s.type;
    // no type yet (AIS sends it only every few minutes): big shipping lines' names give it away
    if (!type && /^(MSC|MAERSK|EVER|CMA CGM|APL|COSCO|OOCL|ONE |NYK|MOL|HYUNDAI|HMM|ZIM|YM |YANG MING|HAPAG|MATSON|SEASPAN|WAN HAI|PIL |KOTA|MANOA|MAUNAWILI|KAIMANA|LIHUE|DANIEL K|R\.?J\.? PFEIFFER)/i.test(s.name || "")) type = "cargo";
    if (!type && /(SPIRIT|PROSPERITY|TANKER|\bLNG\b|\bLPG\b|CHEMICAL|PETROLEUM|STENA)/i.test(s.name || "")) type = "tanker";
    if (!type && /^(TOWBOAT|.*\bTUG\b|DELTA |SEA RELIANCE|BAYDELTA|FOSS|CROWLEY|AMNAV|SAUSALITO)/i.test(s.name || "")) type = "tug";
    const guessed = !type;   // AIS hasn't sent its type yet: draw a plausible shape but don't claim to know what it is
    if (!type) type = s.cls === "B" ? (s.sog > 12 ? "passenger" : "pleasure") : s.sog > 14 ? "passenger" : s.L > 120 ? "cargo" : "service";
    const base = guessed && s.cls !== "B" ? { ...(LOOK[type] || LOOK.pleasure), label: "Vessel" } : (LOOK[type] || LOOK.pleasure);
    const L = s.L >= 5 && s.L <= 400 ? s.L : base.L, W = Math.min(s.W >= 2 && s.W <= 60 ? s.W : base.W, L / 2.2);   // AIS sizes are often typed in wrong (a 10 m boat 12 m wide drew as a square raft): no hull wider than a catamaran
    const name = s.name ? title(s.name) : base.label;
    let kind = type;
    if (type === "passenger") kind = TOUR.test(s.name || "") || L > 55 ? "tour" : "ferry";
    const seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const D = design(kind, L, W, seed);
    return { L, Wd: W, Hh: D.Hh, parts: D.parts, side: base.side, roof: base.roof, band: null, lights: false, type,
      noTag: type !== "passenger", r: { name, color: type === "passenger" ? "#1f5f9f" : "#33424d", long: `${base.label}${s.sog > 0.5 ? ` · ${Math.round(s.sog)} kn` : ""}` } };
  }
  // Boats replay a few minutes behind, gliding between their real reported positions (AIS here arrives about every
  // 3 minutes per boat); past the newest report they carry on at speed for at most 45 s, and never onto land.
  const DELAY = 210e3;
  // Like the trains: a boat under way keeps going from its newest report along its course at its reported speed
  // (for up to 4 minutes, and never onto land), easing toward each new report instead of jumping.
  function where(b, now) {
    const H = b.hist, r = H.at(-1) || b.r, v = r.sog > 0.5 ? r.sog * KN : 0;
    // carried on along its last course and speed for up to 15 min (moving boats leave the map at 16), stopping at the
    // shore; how far it can go before land is worked out once per report, not every frame
    let dt = Math.min(900, Math.max(0, (now - r.t) / 1000));
    const crs = ((r.cog ?? r.hdg ?? 0) * Math.PI) / 180, kx = 1 / (111320 * Math.cos((r.lat * Math.PI) / 180));
    const at = (s) => [r.lat + (v * s * Math.cos(crs)) / 111320, r.lon + v * s * Math.sin(crs) * kx];
    if (v) {
      if (b.reach?.t !== r.t) { let ok = 0; for (let s = 5; s <= 900; s += 5) { if (!isWater(...at(s))) break; ok = s; } b.reach = { t: r.t, s: ok }; }
      b.ashore = dt > b.reach.s; if (b.ashore) dt = b.reach.s;
    } else b.ashore = false;
    const tgt = v ? at(dt) : [r.lat, r.lon];
    if (!b.cur || Math.hypot((tgt[0] - b.cur[0]) * 111320, (tgt[1] - b.cur[1]) * 88000) > 600) b.cur = tgt.slice();   // first sight or a big jump
    else { const k = Math.min(1, ((now - (b.curT || now)) / 1000) / 3); b.cur[0] += (tgt[0] - b.cur[0]) * k; b.cur[1] += (tgt[1] - b.cur[1]) * k; }
    b.curT = now;
    return b.cur;
  }
  // which way it's pointing: along its track when it's moving between reports, else its reported heading
  function headingOf(b) {
    const r = b.hist.at(-1) || b.r;
    return r.sog > 0.5 ? r.cog ?? r.hdg ?? 0 : r.hdg ?? r.cog ?? 0;
  }

  async function poll() {
    try {
      const d = await fetch("api/boats?m=" + Math.floor(Date.now() / 60e3), { cache: "no-cache" }).then((r) => r.json());   // a fresh address each minute: the CDN's copy of the plain one went stale for minutes on end, and boats that had just come in past the Gate were missing
      const now = Date.now();
      for (const [id, s] of Object.entries(d.ships || {})) {
        const b = boats.get(id) || { id, a: 0, hist: [] };
        const all = [...b.hist, ...(s.hist || [{ t: s.t, lat: s.lat, lon: s.lon, sog: s.sog, cog: s.cog, hdg: s.hdg }])];
        const byT = new Map(all.map((h) => [h.t, h]));
        b.hist = [...byT.values()].sort((x, y) => x.t - y.t).slice(-6);
        b.r = s; b.K = look(s, id); b.dest = cleanDest(s.dest);
        boats.set(id, b);
      }
      for (const [id, b] of boats) if (now - b.r.t > ((b.r.sog || 0) > 1 ? 16 : 41) * 60e3) boats.delete(id);
      window.__boatCount = boats.size;
      // an answer from the CDN's stale copy: a fresh one is being fetched behind it, so look again soon
      if (d.now && now - d.now > 75e3 && !poll.soon) { poll.soon = true; setTimeout(() => { poll.soon = false; poll(); }, 22e3); }
    } catch { window.__boatCount ??= 0; }   // no spinner forever if the feed is down
  }
  if (/[?&]boatdemo\b/.test(location.search)) {   // a preview: one of each kind parked off the Ferry Building
    const demo = [["EVER DEMO", "cargo", 300, 48, 37.8045, -122.3885, 120], ["TANKER DEMO", "tanker", 230, 40, 37.7995, -122.3825, 300], ["HORNBLOWER DEMO", "passenger", 60, 15, 37.7985, -122.3895, 30],
      ["MENDOCINO", "passenger", 49, 12, 37.8015, -122.3915, 80], ["SAIL", "sailing", 11, 3.6, 37.8005, -122.3870, 200], ["TUG", "tug", 30, 10, 37.8030, -122.3935, 250], ["MOTOR", "pleasure", 12, 4, 37.7970, -122.3860, 160]];
    demo.forEach(([name, type, L, W, lat, lon, hdg], i) => boats.set("demo" + i, { id: "demo" + i, r: { lat, lon, sog: type === "cargo" ? 0 : 6, cog: hdg, hdg, t: Date.now(), name, imo: type === "cargo" ? 9241281 : null, L, W, type }, hist: [{ t: Date.now(), lat, lon, sog: 0, cog: hdg, hdg }], a: 1,
      K: look({ name, type, L, W, sog: 6, cls: "A" }, "demo" + i), dest: "" }));
    window.__boatCount = boats.size;
  } else { poll(); setInterval(poll, 60e3); }

  // ---- simulated sailboats: ambience on the open bay, busiest on sunny weekend afternoons; no badges, no cards ----
  const sail = [];
  function wantSails() {
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60, wkend = d.getDay() === 0 || d.getDay() === 6;
    const wx = window.atmo?.wx || {}, alt = window.atmo?.alt ?? 30;
    if (alt < -2 || wx.visibility < 1500 || wx.precip > 0.3) return 0;           // night, thick fog or rain: nobody out
    const day = Math.exp(-((h - 14.5) ** 2) / (2 * 2.6 ** 2));                    // afternoons
    return Math.round((wkend ? 26 : 11) * day * (wx.cloud > 80 ? 0.6 : 1));
  }
  function seedSail() {
    for (let k = 0; k < 40; k++) {
      const lat = 37.792 + Math.random() * 0.04, lon = -122.48 + Math.random() * 0.1;
      if (!isWater(lat, lon) || !isWater(lat + 0.002, lon) || !isWater(lat - 0.002, lon) || !isWater(lat, lon + 0.0025) || !isWater(lat, lon - 0.0025)) continue;   // open water only
      const L = 8 + Math.random() * 8;
      return { lat, lon, hdg: Math.random() * 360, sog: 3 + Math.random() * 3.5, turn: 0, a: 0, dying: false, L, K: { ...look({ type: "sailing", L, W: L / 3.2, sog: 4, cls: "B" }, "s" + Math.random()), r: null } };
    }
    return null;
  }
  function stepSails(dt) {
    const want = wantSails();
    if (sail.length < want && Math.random() < dt * 0.5) { const b = seedSail(); if (b) sail.push(b); }
    if (sail.length > want && sail.length && !sail.some((b) => b.dying)) sail[Math.floor(Math.random() * sail.length)].dying = true;
    const wind = window.atmo?.wx?.windDir ?? 270;
    for (const b of sail.slice()) {
      b.a = b.dying ? b.a - dt / 2 : Math.min(1, b.a + dt / 2);
      if (b.a <= 0 && b.dying) { sail.splice(sail.indexOf(b), 1); continue; }
      // sail across the wind (beam reach); drift a little; tack away from shore
      const reach = [((wind + 90) % 360), ((wind + 270) % 360)], tgt = reach.reduce((best, r) => (Math.abs(((r - b.hdg + 540) % 360) - 180) < Math.abs(((best - b.hdg + 540) % 360) - 180) ? r : best));
      const ahead = (s) => { const r = ((b.hdg) * Math.PI) / 180; return [b.lat + (s * Math.cos(r)) / 111320, b.lon + (s * Math.sin(r)) / (111320 * Math.cos((b.lat * Math.PI) / 180))]; };
      if (!isWater(...ahead(220))) b.hdg = (b.hdg + 180 + (Math.random() - 0.5) * 40) % 360;   // shore ahead: come about
      else { b.turn += (Math.random() - 0.5) * dt * 6; b.turn *= 0.98; b.hdg = (b.hdg + (((tgt - b.hdg + 540) % 360) - 180) * dt * 0.05 + b.turn * dt + 360) % 360; }
      const [la, lo] = ahead(b.sog * KN * dt); b.lat = la; b.lon = lo;
    }
  }

  // out in the fog of war (fog.js): not drawn and not clickable
  const Mc = geo.worldToCamera;
  const fogged = (w) => window.__fogAt && window.__fogAt(Mc[0] * w[0] + Mc[4] * w[1] + Mc[8] * w[2] + Mc[12], Mc[1] * w[0] + Mc[5] * w[1] + Mc[9] * w[2] + Mc[13]) > 0.85;
  let last = performance.now();
  window.__boats = (Wc, Hc, scr) => {
    const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000), ease = 1 - Math.exp(-dt / 4);
    last = t;
    const now = Date.now(), out = [];
    for (const b of boats.values()) {
      b.a = Math.min(1, (b.a || 0) + dt / 1.2);
      if (b.wet === undefined || b.wetAt !== b.r.t) { b.wet = !!isWater(b.r.lat, b.r.lon); b.wetAt = b.r.t; }
      if (!b.wet && (b.r.sog || 0) > 3) continue;   // reporting from land at speed: a boat on a trailer, not on the bay
      const [lat, lon] = where(b, now), w = G.toWorld(lat, lon);
      const r = b.r, dir = dirOf(headingOf(b, now));
      const s = scr(w);
      if (s[0] < -300 || s[1] < -300 || s[0] > Wc + 300 || s[1] > Hc + 300 || fogged(w)) continue;
      // never smaller than a little icon (~18 px long) when zoomed out; a wake behind anything under way
      const s2 = scr([w[0] + 100, w[1], w[2]]), pxPerM = Math.max(1e-3, Math.hypot(s2[0] - s[0], s2[1] - s[1]) / 100);
      const k = Math.max(1, 18 / (b.K.L * pxPerM)), sog = r.sog || 0;
      const K = k === 1 && !(sog > 2) ? b.K : { ...b.K, L: b.K.L * k, Wd: b.K.Wd * k, Hh: b.K.Hh * k, hs: k, wake: sog > 2 ? Math.min(120, b.K.L * 0.6 + sog * 2) * k : 0 };
      out.push({ v: b, p: { w, dir }, depth: s[2], at: s, K, alpha: b.a });
    }
    stepSails(Math.min(0.1, (performance.now() - (window.__sailT || performance.now())) / 1000)); window.__sailT = performance.now();
    for (const b of sail) {
      const w = G.toWorld(b.lat, b.lon), s2 = scr(w);
      if (s2[0] < -200 || s2[1] < -200 || s2[0] > Wc + 200 || s2[1] > Hc + 200 || fogged(w)) continue;
      const q = scr([w[0] + 100, w[1], w[2]]), pxPerM = Math.max(1e-3, Math.hypot(q[0] - s2[0], q[1] - s2[1]) / 100), k = Math.max(1, 12 / (b.L * pxPerM));
      const K = { ...b.K, L: b.K.L * k, Wd: b.K.Wd * k, Hh: b.K.Hh * k, hs: k, wake: Math.min(60, b.L * 1.2) * k, r: null };
      out.push({ v: b, p: { w, dir: dirOf(b.hdg) }, depth: s2[2], at: s2, K, alpha: b.a, boat: true });
    }
    window.__sailCount = sail.length;
    return out;
  };
})();
