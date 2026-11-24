// Live Muni + SF Bay Ferry, drawn as little 3D vehicles on the map.
// Positions come from 511.org via server.mjs and are played back a step behind, gliding along each route's real shape.
(async function () {
  const viewer = window.viewer;
  const geo = await fetch("geo.json", { cache: "no-cache" }).then((r) => r.json());
  const [routesData, grids] = await Promise.all([fetch("routes.json?v=" + (window.__cv || "")).then((r) => r.json()), IsoGeo.load(geo)]);
  window.__grids = grids;
  const G = IsoGeo.make(geo, grids);
  let selected = null;   // the vehicle or boat whose card is open
  // depth of the map surface on a coarse grid, so a bus behind a tower is hidden by it
  const depthGrid = grids.depth, DW = geo.depthGrid.w, DH = geo.depthGrid.h;
  function visibility(w, hh) {  // share of the vehicle's middle that isn't behind something
    const p = toImage([w[0], w[1] + hh, w[2]]), S = geo.depthGrid.scale;
    let seen = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(p[0] / S) + dx, y = Math.round(p[1] / S) + dy;
      if (x < 0 || y < 0 || x >= DW || y >= DH) continue;
      n++; if (grids.dm(y * DW + x) > p[2] - 4) seen++;
    }
    return n ? seen / n : 1;
  }
  const { routes, shapes } = routesData;
  const M = geo.worldToCamera;
  const toImage = (w) => {
    const x = M[0] * w[0] + M[4] * w[1] + M[8] * w[2] + M[12], y = M[1] * w[0] + M[5] * w[1] + M[9] * w[2] + M[13], z = M[2] * w[0] + M[6] * w[1] + M[10] * w[2] + M[14];
    return [(x - geo.x0) / geo.mpp, (geo.y1 - y) / geo.mpp, -z];
  };

  // Each shape as world points with distance along it, built on first use
  const shapeCache = new Map();
  // the Bay Bridge's west span is outside the drawn map's height data: buses there ride the deck (same profile as traffic.js)
  // Muni (sf): only out over the water. The deck crosses above the Embarcadero, and an N or T in the street below was
  // being lifted onto it (drawn on a rooftop); Muni's only bridge route, the 25, is on the deck by then.
  function onBridge(la, lo, w, sf) {
    if (!(lo > (sf ? -122.3866 : -122.3905) && lo < -122.36 && la > 37.786 && la < 37.815 && w[1] < 20)) return w;
    // the deck's own height where the 3D render has it (52 m at the SF anchorage, ~75 m mid-span), else a capped climb:
    // the old 61-83 m guess drew buses 10-20 m above the deck, which at this angle slid them off the bridge onto the bay
    const h = G.heightAt ? G.heightAt(w[0], w[2]) : null;
    w[1] = h != null && h > 30 && h < 95 ? h : Math.min(74, 52 + 22 * Math.hypot((la - 37.7885) * 111320, (lo + 122.3915) * 88000) / 900);
    return w;
  }
  // Street level from the depth map (the surface you actually see), scanning up from near sea level: the height-grid
  // estimate reads rooftops as ground in dense blocks, and at this 45° view a wrong height moves a bus sideways onto
  // the sidewalk. Same method as the simulated traffic.
  const MM = geo.worldToCamera, RT = [[MM[0], MM[1], MM[2]], [MM[4], MM[5], MM[6]], [MM[8], MM[9], MM[10]]], TT = [MM[12], MM[13], MM[14]];
  function streetLevel(w) {
    const dg = geo.depthGrid, D = grids && grids.depth;
    if (!dg || !D || w[1] > 25) return w;   // elevated (bridge deck) stays as set
    const top = Math.max(w[1], 0) + 8;
    // no lower than 3 m under the street estimate: at Steuart and Mission the 3D model has a hole, the scan found a
    // "surface" 8 m down, and the 14's buses were drawn that far off, across the Audiffred Building's roof
    const floor = Math.max(-8, Math.min(w[1], 0) - 3);
    for (let y = floor; y <= top; y += 0.75) {
      const q = toImage([w[0], y, w[2]]), x = Math.floor(q[0] / dg.scale), yy = Math.floor(q[1] / dg.scale);
      if (x < 0 || yy < 0 || x >= dg.w || yy >= dg.h) return w;
      const d = grids.dm(yy * dg.w + x), cx = geo.x0 + (x + 0.5) * dg.scale * geo.mpp, cy = geo.y1 - (yy + 0.5) * dg.scale * geo.mpp;
      const v = [cx - TT[0], cy - TT[1], -d - TT[2]];
      const S = [RT[0][0] * v[0] + RT[0][1] * v[1] + RT[0][2] * v[2], RT[1][0] * v[0] + RT[1][1] * v[1] + RT[1][2] * v[2], RT[2][0] * v[0] + RT[2][1] * v[1] + RT[2][2] * v[2]];
      if (Math.hypot(S[0] - w[0], S[2] - w[2]) < 2.2 && Math.abs(S[1] - y) < 2.5) { w[1] = Math.max(S[1], floor); return w; }
    }
    return w;
  }
  function shapeOf(id) {
    if (!id || !shapes[id]) return null;
    if (shapeCache.has(id)) return shapeCache.get(id);
    const pts = shapes[id].map(([la, lo]) => streetLevel(onBridge(la, lo, G.toWorld(la, lo), id.startsWith("SF:")))), s = [0];
    // a short stub at either end that turns off the street (GTFS often starts a trip a few metres round a corner or out
    // at the kerb): a bus waiting there was drawn on the sidewalk, turned across the street. Start and end on the street itself.
    const leg = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);
    const turn = (a, b, c) => { const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - b[0], vz = c[2] - b[2]; return (ux * vx + uz * vz) / ((Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1); };
    while (pts.length > 2 && leg(pts[0], pts[1]) < 15 && turn(pts[0], pts[1], pts[2]) < 0.9) pts.shift();
    while (pts.length > 2 && leg(pts.at(-1), pts.at(-2)) < 15 && turn(pts.at(-3), pts.at(-2), pts.at(-1)) < 0.9) pts.pop();
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    const sh = { pts, s };
    shapeCache.set(id, sh);
    return sh;
  }
  function project(sh, w, near) {  // distance along shape of the point nearest w (closest to `near` when the route doubles back)
    let best = null;
    for (let i = 1; i < sh.pts.length; i++) {
      const a = sh.pts[i - 1], b = sh.pts[i], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((w[0] - a[0]) * dx + (w[2] - a[2]) * dz) / L2));
      const d = Math.hypot(a[0] + dx * t - w[0], a[2] + dz * t - w[2]), s = sh.s[i - 1] + t * Math.sqrt(L2);
      const score = d + (near != null ? Math.max(0, Math.abs(s - near) - 400) * 0.5 : 0);
      if (!best || score < best.score) best = { s, d, score };
    }
    return best;
  }
  function alongRaw(sh, s) {
    let i = 1;
    while (i < sh.s.length - 1 && sh.s[i] < s) i++;
    const a = sh.pts[i - 1], b = sh.pts[i], L = sh.s[i] - sh.s[i - 1] || 1, t = Math.max(0, Math.min(1, (s - sh.s[i - 1]) / L));
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    return { i, w: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], dir: [(b[0] - a[0]) / len, (b[2] - a[2]) / len] };
  }
  // along a shape, with its corners rounded: within ~9 m of a bend (less between close bends) the vehicle follows a
  // curve from one leg to the next instead of pivoting on the corner point
  function along(sh, s) {
    const r0 = alongRaw(sh, s), S = sh.s, n = S.length;
    for (const k of [r0.i - 1, r0.i]) {
      if (k <= 0 || k >= n - 1) continue;
      const r = Math.min(9, (S[k] - S[k - 1]) / 2, (S[k + 1] - S[k]) / 2);
      if (r < 1 || Math.abs(s - S[k]) >= r) continue;
      const A = alongRaw(sh, S[k] - r), B = alongRaw(sh, S[k] + r);
      if (A.dir[0] * B.dir[0] + A.dir[1] * B.dir[1] > 0.985) continue;   // all but straight: nothing to round
      const C = sh.pts[k], u = (s - (S[k] - r)) / (2 * r), m = 1 - u;
      const w = [0, 1, 2].map((j) => m * m * A.w[j] + 2 * u * m * C[j] + u * u * B.w[j]);
      const dx = m * (C[0] - A.w[0]) + u * (B.w[0] - C[0]), dz = m * (C[2] - A.w[2]) + u * (B.w[2] - C[2]), L = Math.hypot(dx, dz) || 1;
      return { w, dir: [dx / L, dz / L] };
    }
    return { w: r0.w, dir: r0.dir };
  }

  // ---- live data ----
  let fleet = {}, offset = 0, status = {};
  // Muni's arrival predictions (511 StopMonitoring, every 2 min): each vehicle's next stops and times, and each stop's
  // coming arrivals. A vehicle with predictions is drawn where they put it now, not played back behind.
  let predV = new Map(), stopBoard = new Map(), predAt = 0, STOPS = {}, selStop = null, stopTimer = null;
  fetch("stops.json?v=" + (window.__cv || "")).then((r) => r.json()).then((j) => { STOPS = j; }).catch(() => {});
  const ctGps = {};   // Caltrain train id -> its latest 511 GPS fix { t, lat, lon }
  async function load() {
    try {
      const j = await fetch("api/vehicles", { cache: "no-store" }).then((r) => r.json());
      offset = j.now - Date.now();
      status = j.status;
      for (const [id, v] of Object.entries(j.vehicles)) {
        if (id.startsWith("CT:")) { const r = v.reports?.at(-1); if (r) ctGps[id] = r; continue; }   // Caltrain: GPS fixes only; the trains themselves come from traini.ac
        const old = fleet[id];
        // keep our own history: the hosted feed only sends each vehicle's latest report
        if (old) { const seen = new Set(v.reports.map((r) => r.t)); v.reports = [...old.reports.filter((r) => !seen.has(r.t)).map(({ t, lat, lon, bearing }) => ({ t, lat, lon, bearing })), ...v.reports].sort((p, q) => p.t - q.t).slice(-6); }
        v.reports.forEach((r) => { r.w = streetLevel(onBridge(r.lat, r.lon, G.toWorld(r.lat, r.lon), id.startsWith("SF:"))); });
        v.sh = shapeOf(v.shape);
        if (v.sh) { let near = null; for (const r of v.reports) { const p = project(v.sh, r.w, near); r.s = p.d < 60 ? p.s : null; if (r.s != null) near = r.s; } }
        v.seen = old?.seen || Date.now();
        if (old) { v.cs = old.cs; v.sp = old.sp; v.lt = old.lt; v.liveUntil = old.liveUntil; v.lastDir = old.lastDir; if (selected === old) selected = v; if (follow?.v === old) follow.v = v; }
        fleet[id] = v;
      }
      if (j.pred && j.pred.base * 1000 !== predAt) {
        const base = j.pred.base * 1000, pv = new Map(), board = new Map();
        for (const [veh, route, dest, calls] of j.pred.trips) {
          const cs = []; for (let i = 0; i < calls.length; i += 2) cs.push([calls[i], base + calls[i + 1] * 1000]);
          if (!cs.length) continue;
          const had = veh && pv.get(veh);   // a vehicle's current trip is its soonest one (the next may start at the terminal)
          if (veh && (!had || cs[0][1] < had.calls[0][1])) pv.set(veh, { route, dest, calls: cs });
          for (const [sid, t] of cs) (board.get(sid) || board.set(sid, []).get(sid)).push({ route, dest, t, veh });
        }
        predV = pv; stopBoard = board; predAt = base;
        if (selStop) renderStop();
      }
      for (const [id, v] of Object.entries(fleet)) if (!j.vehicles[id] && Date.now() + offset - v.reports.at(-1).t > 10 * 60e3) delete fleet[id];
    } catch {}
  }
  load();   // (not awaited: the cars and the rest of the map don't wait on the live feed; buses appear when it lands)

  // ---- Caltrain from traini.ac: every train's actual and forecast times at San Francisco, 22nd Street and the next
  // stop south, both directions, refreshed each minute. Between stations a train runs along the line at the pace its
  // own times give (finer than 511's one position every five minutes). Waiting at 4th & King it isn't drawn: the
  // drawing already has trains on every platform.
  const CT_ST = { sf: [37.7764, -122.3945], d22: [37.7576, -122.3926], bay: [37.7095, -122.4016], ssf: [37.6559, -122.4053] };
  let ctLine = null;   // a southbound Caltrain shape, with each station's distance along it
  function ctShape() {
    if (ctLine) return ctLine;
    for (const id of Object.keys(shapes)) {
      if (!id.startsWith("CT:")) continue;
      const sh = shapeOf(id); if (!sh) continue;
      const at = {}; let ok = true;
      for (const k of ["sf", "d22"]) { const [la, lo] = CT_ST[k], p = project(sh, G.toWorld(la, lo)); if (!p || p.d > 120) { ok = false; break; } at[k] = p.s; }
      // the shapes stop just short of Bayshore (the map's southern edge): the far end stands in for it
      if (ok && at.sf < at.d22) {
        at.bay = sh.s.at(-1);
        // the tracks at ground level: snapping to the visible surface would lift trains onto I-280 where it crosses over
        // (the ground grid reads a wide freeway deck as ground, so where the line runs beneath one its height is bridged
        // across from the open stretches either side)
        if (!window.__traffic) return null;   // needs the freeway lines; trains wait a moment
        const gs = sh.pts.map((p) => G.ground(p[0], p[2]) ?? p[1]), cov = sh.pts.map((p) => underDeck(p[0], p[1], p[2]));
        const ys = gs.map((g, i) => {
          if (!cov[i]) return g;
          let a = i, b = i; while (a > 0 && cov[a]) a--; while (b < gs.length - 1 && cov[b]) b++;
          const ga = cov[a] ? null : gs[a], gb = cov[b] ? null : gs[b];
          if (ga == null || gb == null) return ga ?? gb ?? g;
          const f = (sh.s[i] - sh.s[a]) / ((sh.s[b] - sh.s[a]) || 1); return ga + (gb - ga) * f;
        });
        const rail = { ...sh, pts: sh.pts.map((p, i) => [p[0], ys[i], p[2]]) };
        // Caltrain's four tunnels between Mission Bay and Bayshore (OpenStreetMap), as stretches along the line
        at.tunnels = [[37.76342, -122.39295, 37.75845, -122.39252], [37.75475, -122.39245, 37.75178, -122.39286], [37.7367, -122.39495, 37.73024, -122.39585], [37.72116, -122.39784, 37.71179, -122.40119]]
          .map(([la1, lo1, la2, lo2]) => [project(sh, G.toWorld(la1, lo1)), project(sh, G.toWorld(la2, lo2))]).filter(([a, b]) => a && b && a.d < 80 && b.d < 80).map(([a, b]) => [Math.min(a.s, b.s), Math.max(a.s, b.s)]);
        return (ctLine = { sh: rail, at });
      }
    }
    return null;
  }
  // One stream per page from traini.ac (its /v1/stream, built for pages like this one): a snapshot of every Caltrain and
  // BART train on the move, then just the trains that change. One request to open and nothing after; the old per-tab
  // polling of /v1/departures, once a minute, filled their database at launch. EventSource reconnects by itself.
  const tx = new Map();   // traini.ac train id -> train
  const exp = (t) => Date.parse(t?.expected || t?.scheduled || "");
  let txT = 0;
  function trainiac() {
    const L = ctShape(); if (!L) { setTimeout(trainiac, 3000); return; }   // the line needs the freeway data: soon
    const now = Date.now(), seen = new Set();
    const add = (x, pts, dir, ref) => {
      const id = x.id, key = "TX:" + id; seen.add(key);
      const v = fleet[key] || (fleet[key] = { route: "CT:Local Weekday", reports: [], tx: true });
      const late = ref && ref.departs ? Math.round((exp(ref.departs) - Date.parse(ref.departs.scheduled || "")) / 60e3) : 0;
      Object.assign(v, { trainId: id, pts: pts.filter((p) => isFinite(p.t)), dir, dest: x.destination?.name || "", head: x.headcode, delay: isFinite(late) ? late : 0, next: pts.find((p) => p.t > now)?.name });
    };
    for (const x of tx.values()) {
      if (x.operator?.code !== "CT" || x.cancelled) continue;
      const cs = (x.calls || []).filter((c) => c.calls !== false), at = (crs) => cs.findIndex((c) => c.station.crs === crs);
      const iSF = at("CT:SAN_FRANCISCO"), i22 = at("CT:22ND_STREET");
      if (iSF < 0) continue;
      if (i22 < 0 ? iSF === 0 : iSF < i22) {   // southbound out of 4th & King
        const sf = cs[iSF], c22 = i22 >= 0 ? cs[i22] : null, nx = cs[(i22 >= 0 ? i22 : iSF) + 1];
        const t0 = exp(sf.departs), t22 = c22 ? exp(c22.departs) : NaN, tn = nx ? exp(nx.arrives || nx.departs) : NaN;
        if (!(t0 > now - 25 * 60e3 && t0 < now + 90 * 60e3)) continue;
        // past 22nd Street: on to Bayshore (an express that skips it reaches its spot in proportion to the distance)
        const tb = !isFinite(tn) ? NaN : nx.station.crs === "CT:BAYSHORE" ? tn : (isFinite(t22) ? t22 : t0) + (tn - (isFinite(t22) ? t22 : t0)) * 0.47;
        add(x, [{ s: L.at.sf, t: t0, name: "San Francisco" }, { s: L.at.d22, t: isFinite(t22) ? t22 : t0 + 5 * 60e3, name: "22nd Street" }, { s: L.at.bay, t: tb, name: nx?.station?.name }], 1, sf);
      } else if (i22 >= 0 && i22 < iSF) {      // northbound, calling at 22nd Street on the way in
        const c22 = cs[i22], t22 = exp(c22.departs), sfc = cs[iSF], tsf = exp(sfc.arrives || sfc.departs);
        if (!(t22 > now - 25 * 60e3 && t22 < now + 90 * 60e3)) continue;
        add(x, [{ s: L.at.bay, t: t22 - 4.5 * 60e3, name: "Bayshore" }, { s: L.at.d22, t: t22, name: "22nd Street" }, { s: L.at.sf, t: isFinite(tsf) ? tsf : t22 + 6 * 60e3, name: "San Francisco" }], -1, c22);
      }
    }
    for (const k of Object.keys(fleet)) if (k.startsWith("TX:") && !seen.has(k)) delete fleet[k];
  }
  {
    const es = new EventSource("https://api.traini.ac/v1/stream?network=bay_area");
    const soon = () => { clearTimeout(txT); txT = setTimeout(trainiac, 250); };   // a burst of updates rebuilds once
    es.addEventListener("snapshot", (e) => { try { tx.clear(); for (const t of JSON.parse(e.data).trains) tx.set(t.id, t); soon(); } catch {} });
    es.addEventListener("update", (e) => { try { for (const t of JSON.parse(e.data).trains) tx.set(t.id, t); soon(); } catch {} });
    es.addEventListener("remove", (e) => { try { for (const id of JSON.parse(e.data).ids) tx.delete(id); soon(); } catch {} });
    setInterval(trainiac, 30e3);   // expected times run on without new events: re-place against the clock
    window.__trainiac = { tx, get state() { return es.readyState; } };
  }
  // where a traini.ac train is now: between the two of its station times that bracket the moment
  const txS = (P, t) => { let i = 1; while (i < P.length - 1 && P[i].t < t) i++; const a = P[i - 1], b = P[i], f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1; return a.s + (b.s - a.s) * f; };
  function txPlace(v) {
    const L = ctLine, P = v.pts, now = Date.now();
    if (!L || !P || P.length < 2 || now < P[0].t || now > P.at(-1).t) return null;
    let s = txS(P, now);
    // its latest GPS fix (511, every five minutes) pulls it to where it really was, fading out over the next few minutes
    const g = ctGps[v.trainId];
    if (g && now - g.t < 8 * 60e3) {
      if (g.s === undefined) { const q = project(L.sh, G.toWorld(g.lat, g.lon)); g.s = q && q.d < 150 ? q.s : null; }
      if (g.s != null) s += (g.s - txS(P, g.t)) * Math.exp(-(now - g.t) / 180e3);
    }
    v.gps = g;
    if (s < L.at.sf + 260) return null;   // still alongside the platforms at 4th & King, which the drawing already shows full of trains
    const sc = Math.max(Math.min(s, Math.max(L.at.bay, L.at.sf)), Math.min(L.at.bay, L.at.sf)), sign = v.dir > 0 ? 1 : -1;
    const fix = (q) => (sign > 0 ? q : { w: q.w, dir: [-q.dir[0], -q.dir[1]] });
    // each car follows the track on its own (off: metres ahead of the train's middle), so the train bends through curves
    return { ...fix(along(L.sh, sc)), carAt: (off) => fix(along(L.sh, sc + sign * off)) };
  }
  setInterval(load, 15000);

  const DELAY = { SF: 100e3, SB: 250e3, CT: 330e3, GG: 210e3, AC: 210e3 };   // Caltrain is fetched every 5 min, so it plays back further behind
  // Muni Metro is hidden only inside its tunnels (Market St subway, Twin Peaks, Sunset and Central Subway; OpenStreetMap
  // light-rail tunnels, simplified to 4 m, plus the turnback loop and tail tracks under the Embarcadero to the portal
  // near Folsom, which OSM lacks, traced from the K's GTFS shape): on the surface (J on Church St, N on Judah, L/K/M past West Portal) it shows
  const METRO = new Set(["J", "K", "L", "M", "N", "S", "T"]);
  const TUNNELS = [[37.76176,-122.43804,37.76191,-122.43684],[37.76206,-122.43689,37.76179,-122.43805],[37.74154,-122.46528,37.74538,-122.46206,37.74647,-122.46096,37.74773,-122.45945,37.76085,-122.44043,37.76143,-122.43939,37.76176,-122.43804],[37.76179,-122.43805,37.76145,-122.4394,37.76088,-122.44044,37.74775,-122.45947,37.74649,-122.46099,37.7454,-122.46209,37.74138,-122.46546],[37.76197,-122.43684,37.76205,-122.43645],[37.76208,-122.43646,37.762,-122.43684],[37.76642,-122.4487,37.76924,-122.43451],[37.76927,-122.43451,37.76645,-122.44871],[37.76987,-122.42598,37.76869,-122.42749],[37.76987,-122.42598,37.76966,-122.42641,37.76959,-122.42718],[37.79204,-122.39082,37.79275,-122.39129,37.7946,-122.39334],[37.76955,-122.42717,37.76961,-122.42639,37.76972,-122.42613],[37.76869,-122.42749,37.76298,-122.43471,37.76251,-122.4355,37.76208,-122.43646],[37.73115,-122.43533,37.73165,-122.43508],[37.73166,-122.43512,37.73114,-122.43541],[37.7853,-122.40535,37.78259,-122.40198],[37.78266,-122.40189,37.78535,-122.40529],[37.79269,-122.3972,37.77099,-122.42466],[37.7709,-122.42455,37.79301,-122.39659],[37.79453,-122.39342,37.79272,-122.39138,37.79239,-122.3911,37.79202,-122.39092],[37.74136,-122.46543,37.74154,-122.46528],[37.77099,-122.42466,37.76987,-122.42598],[37.79355,-122.39228,37.79457,-122.39338],[37.7943,-122.39309,37.79453,-122.39342],[37.79419,-122.39297,37.79449,-122.39322],[37.79396,-122.3955,37.79457,-122.39471],[37.79158,-122.3984,37.79208,-122.39797],[37.79301,-122.39659,37.79367,-122.39575],[37.79375,-122.39587,37.79269,-122.3972],[37.79367,-122.39575,37.79396,-122.3955],[37.762,-122.43684,37.76179,-122.43805],[37.76176,-122.43804,37.76197,-122.43684],[37.76498,-122.43213,37.76525,-122.43183],[37.79375,-122.39587,37.79396,-122.3955],[37.76972,-122.42613,37.7709,-122.42455],[37.79367,-122.39575,37.79453,-122.39466],[37.79461,-122.39476,37.79375,-122.39587],[37.79453,-122.39466,37.79471,-122.39434,37.79475,-122.39414,37.79471,-122.39375,37.79453,-122.39342],[37.7946,-122.39334,37.79472,-122.39351,37.79485,-122.39394,37.79481,-122.39439,37.79461,-122.39476],[37.76259,-122.43528,37.76311,-122.43448,37.76972,-122.42613],[37.76205,-122.43645,37.76259,-122.43528],[37.74174,-122.46516,37.742,-122.46489],[37.765,-122.43215,37.76523,-122.43181],[37.77416,-122.42054,37.77347,-122.42141,37.7733,-122.42173],[37.77239,-122.42267,37.77205,-122.42331],[37.77197,-122.4232,37.77248,-122.42277],[37.792,-122.39786,37.79166,-122.39851],[37.79476,-122.39373,37.79457,-122.39338],[37.79464,-122.39357,37.7948,-122.39394],[37.7946,-122.39334,37.79476,-122.39373],[37.79457,-122.39471,37.79468,-122.39455,37.7948,-122.39415,37.79476,-122.39373],[37.8007,-122.41089,37.79943,-122.40907,37.7993,-122.40901,37.7945,-122.40807],[37.79512,-122.40807,37.79934,-122.40894,37.79948,-122.40903,37.80075,-122.41085],[37.78031,-122.39898,37.78207,-122.40115],[37.782,-122.40123,37.78029,-122.39902],[37.79385,-122.40794,37.79434,-122.40791],[37.79433,-122.40804,37.79387,-122.40782],[37.79327,-122.40782,37.78775,-122.4067],[37.78777,-122.40658,37.79328,-122.4077],[37.7945,-122.40807,37.79327,-122.40782],[37.79328,-122.4077,37.79512,-122.40807],[37.78678,-122.40638,37.78777,-122.40658],[37.78775,-122.4067,37.78676,-122.4065],[37.78676,-122.4065,37.78629,-122.40641,37.78602,-122.40626,37.7853,-122.40535],[37.78535,-122.40529,37.78598,-122.40614,37.78622,-122.40626,37.78678,-122.40638],[37.78207,-122.40115,37.78266,-122.40189],[37.78259,-122.40198,37.782,-122.40123],[37.79424,-122.39502,37.79436,-122.39475,37.79442,-122.39448,37.79442,-122.39418,37.79437,-122.39389,37.7942,-122.39351,37.79344,-122.39222,37.79254,-122.39108,37.79223,-122.39085,37.7915,-122.39055,37.79112,-122.39032,37.7904,-122.38952]];
  // in the map's ground plane (x, z), so the test uses where the train is actually drawn on its curving route
  const TSEG = [];
  for (const o of TUNNELS) for (let i = 0; i + 3 < o.length; i += 2) { const p0 = G.toWorld(o[i], o[i + 1]), p1 = G.toWorld(o[i + 2], o[i + 3]); TSEG.push([p0[0], p0[2], p1[0], p1[2]]); }
  let tx0 = Infinity, tz0 = Infinity, tx1 = -Infinity, tz1 = -Infinity;
  for (const [x0, z0, x1, z1] of TSEG) { tx0 = Math.min(tx0, x0, x1); tx1 = Math.max(tx1, x0, x1); tz0 = Math.min(tz0, z0, z1); tz1 = Math.max(tz1, z0, z1); }
  function inMuniTunnel(x, z) {
    if (x < tx0 - 30 || x > tx1 + 30 || z < tz0 - 30 || z > tz1 + 30) return false;
    for (const [x0, z0, x1, z1] of TSEG) {
      const ax = x0 - x, az = z0 - z, dx = x1 - x0, dz = z1 - z0;
      const t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(ax + t * dx, az + t * dz) < 30) return true;
    }
    return false;
  }
  // w: a world point [x, y, z]
  const underground = (v, w) => METRO.has((routes[v.route] || {}).name) && inMuniTunnel(w[0], w[2]);
  // See-through (TV mode at a subway station, window.__xray = { lat, lon }): trains in the tunnel within ~700 m of it
  // are drawn as faint ghosts over a dark band along the tunnel, instead of hidden
  let XR = null;
  const xrayAt = (w) => { if (!window.__xray) return false; if (!XR || XR.src !== window.__xray) { const c = G.toWorld(window.__xray.lat, window.__xray.lon); XR = { src: window.__xray, x: c[0], z: c[2] }; } return Math.hypot(w[0] - XR.x, w[2] - XR.z) < 700; };
  const hideUnder = (v, w) => { v.under = false; if (!underground(v, w)) return false; if (xrayAt(w)) { v.under = true; return false; } return true; };
  // Caltrain trains waiting at 4th & King: 511 gives every one the station's single point, so each waiting train is
  // parked on its own platform track (from OpenStreetMap), nose at the station end, in a steady order
  let tracks = null;
  fetch("caltrain-tracks.json?v=" + (window.__cv || "")).then((r) => r.json()).then((T) => {
    tracks = T.map(({ track, pts }) => { const w = pts.map(([la, lo]) => G.toWorld(la, lo)), s = [0]; for (let i = 1; i < w.length; i++) s.push(s[i - 1] + Math.hypot(w[i][0] - w[i - 1][0], w[i][2] - w[i - 1][2])); return { track, pts: w, s }; });
  }).catch(() => {});
  const ORDER = [3, 4, 5, 6, 2, 7, 1, 8, 9, 10, 11, 12];   // the busiest platforms first
  function platform(v) {
    if (!tracks) return null;
    const waiting = Object.values(fleet).filter((o) => o.route?.startsWith("CT:") && o.reports.length && Math.hypot((o.reports.at(-1).lat - 37.7764) * 111320, (o.reports.at(-1).lon + 122.3945) * 88000) < 280).map((o) => o.id).sort();
    const i = waiting.indexOf(v.id); if (i < 0) return null;
    const tr = tracks.find((x) => x.track === ORDER[i % ORDER.length]) || tracks[i % tracks.length];
    const p = along(tr, Math.min(tr.s.at(-1) - 5, 72));   // centre of a 130 m train, just short of the bumper
    return { w: p.w, dir: [-p.dir[0], -p.dir[1]], platform: tr.track };
  }
  const f0 = (a, b, t) => (t - a.t < b.t - t ? a : b);
  // the nearest street (OSM, as the traffic uses) to a world point: its centre-line point and direction, or null
  function roadSnap(w, maxD) {
    let best = null, bd = maxD;
    for (const p of window.__traffic?.paths || []) {
      const box = p.wbox || (p.wbox = (() => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of p.pts) { x0 = Math.min(x0, q[0]); z0 = Math.min(z0, q[2]); x1 = Math.max(x1, q[0]); z1 = Math.max(z1, q[2]); } return [x0, z0, x1, z1]; })());
      if (w[0] < box[0] - maxD || w[0] > box[2] + maxD || w[2] < box[1] - maxD || w[2] > box[3] + maxD) continue;
      for (let i = 1; i < p.pts.length; i++) {
        const A = p.pts[i - 1], B = p.pts[i], dx = B[0] - A[0], dz = B[2] - A[2], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((w[0] - A[0]) * dx + (w[2] - A[2]) * dz) / L2));
        const d = Math.hypot(A[0] + dx * t - w[0], A[2] + dz * t - w[2]);
        if (d < bd) {
          bd = d; const L = Math.sqrt(L2), ux = dx / L, uz = dz / L;
          const off = p.oneway ? ((p.lanes || 1) - 1) / 2 * 2.7 : 0.45 * 2.6;   // the right-hand lane, as the simulated traffic lays lanes out
          best = { pt: [A[0] + dx * t - uz * off, A[1] + (B[1] - A[1]) * t, A[2] + dz * t + ux * off], dir: [ux, uz] };
        }
      }
    }
    return best;
  }
  // inside one of Caltrain's tunnels?
  function inTunnel(x, z) {
    const T = ctLine?.at?.tunnels; if (!T || !T.length) return false;
    const q = project(ctLine.sh, [x, 0, z]); if (!q || q.d > 30) return false;
    return T.some(([a, b]) => q.s > a && q.s < b);
  }
  // is this spot under an elevated freeway (OpenStreetMap's bridge/viaduct motorways, as the traffic uses)? Works where the
  // map has no depth data, like the stretch of Caltrain beneath I-280. Cached on a 5 m grid.
  const deckMemo = new Map();
  function underDeck(x, y, z) {
    const key = `${Math.round(x / 5)},${Math.round(z / 5)}`;
    if (deckMemo.has(key)) return deckMemo.get(key);
    let hit = false;
    for (const p of window.__traffic?.paths || []) {
      if (!p.elev || p.hw !== "motorway" && p.hw !== "trunk") continue;
      const box = p.wbox || (p.wbox = (() => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of p.pts) { x0 = Math.min(x0, q[0]); z0 = Math.min(z0, q[2]); x1 = Math.max(x1, q[0]); z1 = Math.max(z1, q[2]); } return [x0, z0, x1, z1]; })());
      if (x < box[0] - 12 || x > box[2] + 12 || z < box[1] - 12 || z > box[3] + 12) continue;
      for (let i = 1; i < p.pts.length && !hit; i++) {
        const A = p.pts[i - 1], B = p.pts[i], dx = B[0] - A[0], dz = B[2] - A[2], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[2]) * dz) / L2));
        // (no height test: out here the ground grid reads the deck itself as ground; a train beside a freeway line within
        // 10 m is beneath it, since Caltrain never runs on top of one)
        if (Math.hypot(A[0] + dx * t - x, A[2] + dz * t - z) < 10) hit = true;
      }
      if (hit) break;
    }
    if (window.__traffic) deckMemo.set(key, hit);
    return hit;
  }
  // a heading for a vehicle that hasn't moved yet: along its route line if it's near it, else along the street it's on,
  // else its reported bearing (Golden Gate always reports 0, which means "none")
  function guessDir(v, a) {
    if (v.sh) { const p = project(v.sh, a.w); if (p && p.d < 300) return along(v.sh, p.s).dir; }
    const r = roadSnap(a.w, 40);
    if (r) return r.dir;
    return v.reports.at(-1).bearing ? null : [1, 0];   // a real bearing: let the caller use it
  }
  // Live: from its newest GPS report, along its route through each stop ahead at the time 511 predicts it gets there.
  // Held at a stop when it's running later than predicted; never more than a bus could plausibly have gone.
  function livePlace(v, now) {
    const P = predV.get(v.id), R = v.reports;
    let r1 = null; for (let i = R.length - 1; i >= 0; i--) if (R[i].s != null) { r1 = R[i]; break; }
    if (!r1 || now - r1.t > 300e3) return undefined;
    if (P.sh !== v.sh || P.r1 !== r1) {
      const K = [[r1.t, r1.s, r1.lat, r1.lon]]; let near = r1.s;
      for (const [sid, t] of P.calls) {
        const st = STOPS[sid]; if (!st || t <= K.at(-1)[0]) continue;
        const q = project(v.sh, G.toWorld(st[0], st[1]), near + 300);
        if (!q || q.d > 50) continue;
        // the stop it's standing at (a terminal layover, a dwell): wait there until 511 says it leaves, instead of
        // gliding off toward the next stop straight away (three F cars at Castro were strung out down Market)
        if (q.s < K.at(-1)[1] + 3) { if (q.s > K.at(-1)[1] - 60 && K.length === 1) K.push([t, K[0][1], st[0], st[1]]); continue; }
        K.push([t, q.s, st[0], st[1]]); near = q.s;
        if (K.length > 6) break;
      }
      P.sh = v.sh; P.r1 = r1; P.K = K;
    }
    const K = P.K; let s = K[0][1], pace = 0;   // where the predictions put it now, and the pace they set (m/s)
    for (let i = 1; i < K.length; i++) {
      const a = K[i - 1], b = K[i];
      if (now >= b[0]) { s = b[1]; continue; }
      if (now > a[0]) { const f = (now - a[0]) / (b[0] - a[0]); s = a[1] + (b[1] - a[1]) * f; pace = (b[1] - a[1]) / ((b[0] - a[0]) / 1000); }
      break;
    }
    s = Math.min(s, r1.s + 16 * Math.max(0, now - r1.t) / 1000 + 40);
    // driven, not dragged: it runs at the predicted pace, a little faster when behind where it should be and slower
    // when ahead, speeding up and braking smoothly, and never backwards (a fresh fix a little behind just slows it
    // down); only a big correction jumps
    const dt = v.lt ? Math.min(0.5, Math.max(0, (now - v.lt) / 1000)) : 0; v.lt = now;
    // a big lead or lag (first sight, a detour, a wrong match) jumps; ordinary lag behind a stale fix just waits
    if (v.cs == null || s - v.cs > 400 || v.cs - s > 800) { v.cs = s; v.sp = pace; }
    else {
      let want = Math.max(0, Math.min(18, pace + (s - v.cs) / 8));
      // ahead of the predictions: don't stand still mid-block waiting for them. Crawl on, and do the waiting at the next
      // stop (pull up to it if it's close, dwell there until the predictions catch up)
      if (v.cs > s + 2) {
        let next = null; for (let i = 1; i < K.length; i++) if (K[i][1] >= v.cs - 2) { next = K[i][1]; break; }   // K[0] is the GPS fix, the rest are stops
        if (next != null && next - v.cs < 60) want = Math.max(0, Math.min(Math.max(pace, 4), (next - v.cs) / 2.5));
        else if (next != null) want = Math.max(want, Math.max(1.2, 0.35 * (pace || 4)));
      }
      v.sp = (v.sp ?? want) + (want - (v.sp ?? want)) * Math.min(1, dt / 2.5);
      v.cs += v.sp * dt;
    }
    const p = along(v.sh, v.cs);
    if (hideUnder(v, p.w)) return null;
    v.lastDir = p.dir; v.live = true; v.liveUntil = now + 180e3;
    return p;
  }
  function placeAt(v, now) {
    if (v.tx) return txPlace(v);
    const ag = v.route.split(":")[0], R = v.reports, t = now - DELAY[ag];
    v.live = false;
    if (ag === "SF" && v.sh && predV.has(v.id)) { const p = livePlace(v, now); if (p !== undefined) return p; }
    // was live a moment ago but its predictions lapsed (a refresh without it): stay where it is rather than drop back
    // to the playback a minute and a half behind, for up to 3 minutes
    if (v.cs != null && v.sh && v.liveUntil > now) { const p = along(v.sh, v.cs); if (hideUnder(v, p.w)) return null; v.lastDir = p.dir; v.live = true; return p; }
    v.cs = null;
    // newly seen: hold at its first report until playback catches up (Caltrain only reports every 5 minutes)
    const slow = ag === "CT" || ag === "GG" || ag === "AC";   // reported every few minutes: hold at the first report, keep a while
    // newly seen (a fresh page has only each vehicle's latest report, newer than the playback moment): show it at that
    // report straight away and let it move on from there, instead of hiding it for the first minute and a half
    if (!R.length || t > R.at(-1).t + (slow ? 600e3 : 240e3)) return null;
    let i = R.findIndex((r) => r.t > t);
    if (i === -1) i = R.length;
    const a = R[Math.max(0, i - 1)], b = R[Math.min(R.length - 1, i)];
    if (hideUnder(v, f0(a, b, t).w)) return null;
    // Caltrain waiting at 4th & King: the drawing already has trains on every platform, and 511 gives the station's
    // one point for all of them, so a train only shows once it has pulled out
    if (ag === "CT") { const r = f0(a, b, t); if (Math.hypot((r.lat - 37.7764) * 111320, (r.lon + 122.3945) * 88000) < 280) return platform(v); }
    // Caltrain and the regional buses (Golden Gate, AC Transit) report only every few minutes: keep rolling along the
    // line between reports (shapes run in the direction of travel) from the newest report at its measured speed, or a
    // gentle default, easing from wherever it was last drawn
    if (slow && v.sh) {
      const nowT = now - 20e3, L = R.filter((r) => r.s != null);
      if (L.length) {
        const r1 = L.at(-1), r0 = L.length > 1 ? L.at(-2) : null;
        const train = ag === "CT", def = train ? 12 : 8;
        let sp = r0 && r1.t > r0.t ? (r1.s - r0.s) / ((r1.t - r0.t) / 1000) : def;
        sp = train ? Math.max(4, Math.min(25, sp || def)) : Math.max(3, Math.min(20, sp || def));
        const ahead = Math.min(Math.max(0, (nowT - r1.t) / 1000) * sp, (train ? 330 : 240) * sp);   // at most a few min past the report
        let target = Math.min(v.sh.s.at(-1) - 2, r1.s + ahead);
        if (v.cs == null || Math.abs(target - v.cs) > 1500) v.cs = target;           // first sight or a big correction: jump
        else v.cs += Math.max(-2, Math.min(sp * 1.6 * 0.05, (target - v.cs) * 0.05));   // otherwise ease, never run backwards much
        const p = along(v.sh, v.cs);
        v.lastDir = p.dir;
        return p;
      }
    }
    const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    if (v.sh && a.s != null && b.s != null && b.s >= a.s - 5 && b.s - a.s < 4000) {
      const p = along(v.sh, a.s + (b.s - a.s) * f);
      v.lastDir = p.dir;
      return p;
    }
    let w = a.w.map((x, k) => x + (b.w[k] - x) * f);
    // off its route line and standing still (a sparse reporter): put it on the nearest road, not the median or a roof
    if (a === b || f >= 1) { const r = a.snap !== undefined ? a.snap : (a.snap = roadSnap(a.w, 15)); if (r) w = r.pt; }
    const dx = b.w[0] - a.w[0], dz = b.w[2] - a.w[2], L = Math.hypot(dx, dz);
    if (L > 3) v.lastDir = [dx / L, dz / L];
    if (!v.lastDir) v.lastDir = guessDir(v, a);
    if (!v.lastDir) { const h = (R.at(-1).bearing || 0) * Math.PI / 180, n = G.toWorld(a.lat + 0.001 * Math.cos(h), a.lon + 0.001 * Math.sin(h) / Math.cos(a.lat * Math.PI / 180)); const ex = n[0] - a.w[0], ez = n[2] - a.w[2], El = Math.hypot(ex, ez) || 1; v.lastDir = [ex / El, ez / El]; }
    return { w, dir: v.lastDir };
  }

  // ---- look of each kind of vehicle ----
  const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const heritage = ["#e07b2a", "#3f7d4e", "#e2c044", "#b5462f", "#2f6f9f", "#d9cfae", "#8c3b5a"];
  // ---- what each vehicle looks like, as stacks of shaded blocks (like the simulated cars) ----
  // Muni today is silver with red striping on every bus and train (SFMTA); Golden Gate and AC Transit run white buses.
  const GL = "#2b3640", TY = "#1c1e21", SILVER = "#c7ccd0", SILVER_HI = "#dde1e4", MUNI_RED = "#c8102e";
  const TROLLEY = new Set(["1", "3", "5", "5R", "6", "14", "14R", "21", "22", "24", "30", "31", "33", "41", "45", "49"]);   // electric trolley coaches
  const ARTIC = new Set(["1", "5", "5R", "7", "8", "9", "9R", "14", "14R", "22", "28R", "30", "38", "38R", "49"]);         // 60-foot articulated
  // one stretch of bus body, from a0 to a1 along the length (-0.5 rear .. 0.5 front)
  function busBody(P, a0, a1, side, band, roof, ends) {
    const c = ends ? 0.35 : 0;
    P.push({ a0, a1, h0: 0.32, h1: 0.92, ch: c, side: band, roof: band, noInk: true });          // the coloured skirt
    P.push({ a0, a1, h0: 0.92, h1: 1.25, ch: c, side, roof: side, noInk: true });                  // belt
    P.push({ a0, a1, w: 0.985, h0: 1.25, h1: 2.4, ch: c, side: GL, roof: GL, noInk: true });       // the window ribbon
    P.push({ a0, a1, h0: 2.4, h1: 3.05, ch: c, ti: 0.04, tw: 0.04, side, roof });                  // upper body and roof
  }
  function bus(r, opts) {
    const artic = ARTIC.has(r.name) && opts.muni, L = artic ? 18.3 : 12.2, P = [];
    // wheels: front axle, rear axle (and the middle one on an articulated bus)
    for (const [w0, w1] of artic ? [[0.33, 0.41], [-0.08, 0.0], [-0.41, -0.33]] : [[0.3, 0.4], [-0.38, -0.28]]) P.push({ a0: w0, a1: w1, w: 1.02, h0: 0, h1: 0.9, side: TY, roof: TY, noInk: true });
    if (artic) {   // two bodies and the dark accordion joint between them
      busBody(P, -0.5, 0.03, opts.side, opts.band, opts.roof, true);
      P.push({ a0: 0.03, a1: 0.09, w: 0.9, h0: 0.4, h1: 2.95, side: "#3a3f44", roof: "#3a3f44", noInk: true });
      busBody(P, 0.09, 0.5, opts.side, opts.band, opts.roof, true);
    } else busBody(P, -0.5, 0.5, opts.side, opts.band, opts.roof, true);
    P.push({ a0: 0.44, a1: 0.5, w: 0.9, h0: 1.0, h1: 2.6, side: GL, roof: GL, noInk: true });      // the big windscreen
    // rooftop pods (one on each half of an articulated bus, never across the joint)
    for (const [p0, p1] of artic ? [[0.16, 0.4], [-0.42, -0.12]] : [[-0.28, 0.12]]) P.push({ a0: p0, a1: p1, w: 0.72, h0: 3.05, h1: 3.4, ch: 0.25, side: SILVER_HI, roof: "#eceef0" });
    // trolley poles ride on the rear body (the rear half of an articulated bus), reaching back to the wires
    return { L, Wd: 2.6, Hh: 3.4, side: opts.side, roof: opts.roof, band: opts.band, parts: P, poles: TROLLEY.has(r.name) && opts.muni, poleAt: artic ? -0.3 : -0.2, r };
  }
  // a Siemens S200 light-rail car: silver, dark windows, the red ribbon round the cab and along the side, a pantograph
  function lrv(r, cars) {
    const P = [], n = cars;
    for (let i = 0; i < n; i++) {
      const a0 = -0.5 + i / n + 0.004, a1 = -0.5 + (i + 1) / n - 0.004, span = a1 - a0, cab = span * 0.06;
      for (const f of [0.18, 0.82]) P.push({ a0: a0 + span * f - span * 0.06, a1: a0 + span * f + span * 0.06, w: 0.96, h0: 0, h1: 0.75, side: TY, roof: TY, noInk: true });   // bogies
      P.push({ a0, a1, h0: 0.55, h1: 1.05, ch: 0.4, side: MUNI_RED, roof: MUNI_RED, noInk: true });     // the red ribbon low along the side
      P.push({ a0, a1, h0: 1.05, h1: 1.35, ch: 0.4, side: SILVER, roof: SILVER, noInk: true });
      P.push({ a0, a1, w: 0.985, h0: 1.35, h1: 2.6, ch: 0.4, side: GL, roof: GL, noInk: true });
      P.push({ a0, a1, h0: 2.6, h1: 3.45, ch: 0.4, ti: 0.02, tw: 0.05, side: SILVER, roof: "#b9bec2" });
      for (const [e0, e1] of [[a0, a0 + cab], [a1 - cab, a1]]) P.push({ a0: e0, a1: e1, w: 1.004, h0: 0.55, h1: 3.2, ch: 0.4, side: MUNI_RED, roof: MUNI_RED, noInk: true });   // red cab ends
    }
    return { L: 23 * n, Wd: 2.65, Hh: 3.45, side: SILVER, roof: "#b9bec2", band: MUNI_RED, parts: P, panto: true, r };
  }
  // an F-line PCC streetcar: rounded ends, its heritage colours, cream roof, one trolley pole
  function pcc(r, col) {
    const P = [{ a0: -0.36, a1: -0.22, w: 0.95, h0: 0, h1: 0.7, side: TY, roof: TY, noInk: true }, { a0: 0.22, a1: 0.36, w: 0.95, h0: 0, h1: 0.7, side: TY, roof: TY, noInk: true },
      { a0: -0.5, a1: 0.5, h0: 0.45, h1: 1.35, ch: 0.9, side: col, roof: col, noInk: true },
      { a0: -0.5, a1: 0.5, w: 0.98, h0: 1.35, h1: 2.35, ch: 0.9, side: GL, roof: GL, noInk: true },
      { a0: -0.5, a1: 0.5, h0: 2.35, h1: 2.75, ch: 0.9, side: col, roof: col, noInk: true },
      { a0: -0.48, a1: 0.48, h0: 2.75, h1: 3.25, ch: 0.9, ti: 0.04, tw: 0.15, side: "#e7ddc4", roof: "#efe7d2" }];
    return { L: 14, Wd: 2.6, Hh: 3.25, side: col, roof: "#efe7d2", band: col, parts: P, pole: true, r };
  }
  // a cable car: a maroon enclosed middle with cream window frames, open ends with benches, one long roof
  function cableCar(r) {
    const M = "#7a2318", CREAM = "#efe3c4", P = [
      { a0: -0.32, a1: -0.18, w: 0.9, h0: 0, h1: 0.55, side: TY, roof: TY, noInk: true }, { a0: 0.18, a1: 0.32, w: 0.9, h0: 0, h1: 0.55, side: TY, roof: TY, noInk: true },
      { a0: -0.5, a1: 0.5, h0: 0.4, h1: 0.95, side: M, roof: "#5b1a12" },                                   // the deck
      { a0: -0.48, a1: -0.24, w: 0.8, h0: 0.95, h1: 1.35, side: "#8a5a2b", roof: "#9c6a37", noInk: true },  // outward-facing benches
      { a0: 0.24, a1: 0.48, w: 0.8, h0: 0.95, h1: 1.35, side: "#8a5a2b", roof: "#9c6a37", noInk: true },
      { a0: -0.22, a1: 0.22, h0: 0.95, h1: 1.55, side: M, roof: M, noInk: true },                           // enclosed cabin
      { a0: -0.22, a1: 0.22, w: 0.99, h0: 1.55, h1: 2.6, side: CREAM, roof: CREAM, noInk: true },
      { a0: -0.21, a1: 0.21, w: 1.0, h0: 1.75, h1: 2.45, side: GL, roof: GL, noInk: true },
      { a0: -0.5, a1: 0.5, w: 1.04, h0: 2.6, h1: 2.95, ch: 0.25, side: M, roof: "#d9c9a1" }];               // the roof over the open ends
    return { L: 8.5, Wd: 2.5, Hh: 2.95, side: M, roof: "#d9c9a1", band: CREAM, parts: P, r };
  }
  function kind(v) {
    const r = routes[v.route] || { type: 3, name: v.route.split(":")[1], color: "#888" };
    if (r.agency === "CT" || r.type === 2) return CALTRAIN(r);
    if (r.agency === "SB" || r.type === 4) return { L: 38, Wd: 10, Hh: 6, side: "#f4f2ec", roof: "#ffffff", band: r.color, r };
    if (r.type === 5) return cableCar(r);
    if (r.name === "F" && r.agency === "SF") return pcc(r, heritage[hash(v.id) % heritage.length]);
    if (r.type === 0) return lrv(r, r.name === "N" || r.name === "T" ? 2 : 1);
    if (r.agency === "GG") return bus(r, { side: "#f1efe9", band: "#c8102e", roof: "#e3e0d8" });   // Golden Gate Transit: white, red
    if (r.agency === "AC") return bus(r, { side: "#eef0ea", band: "#00843d", roof: "#dfe3db" });   // AC Transit: white, green
    return bus(r, { side: SILVER, band: MUNI_RED, roof: "#d3d7da", muni: true });
  }
  // Caltrain: a seven-car Stadler KISS electric bilevel. White body over a red stripe, a dark window band on each deck,
  // red doors, a red cab at each end with a black wraparound windscreen, grey roof, a pantograph
  const ctParts = [], CARS = 7, CW = "#eceae4", CR = "#c8102e", CG = "#2a3239";
  for (let c = 0; c < CARS; c++) {
    const a0 = -0.5 + c / CARS + 0.002, a1 = -0.5 + (c + 1) / CARS - 0.002, sp = a1 - a0, cab = c === 0 || c === CARS - 1;
    const n0 = ctParts.length;
    for (const f of [0.12, 0.88]) ctParts.push({ a0: a0 + sp * f - sp * 0.05, a1: a0 + sp * f + sp * 0.05, w: 0.92, h0: 0, h1: 0.8, side: "#1c1e21", roof: "#1c1e21", noInk: true });
    ctParts.push({ a0, a1, h0: 0.55, h1: 1.15, ch: 0.45, side: CR, roof: CR, noInk: true });                          // red stripe
    ctParts.push({ a0, a1, h0: 1.15, h1: 4.35, ch: 0.45, side: CW, roof: CW, noInk: true });                          // white body
    ctParts.push({ a0: a0 + sp * 0.04, a1: a1 - sp * 0.04, w: 1.006, h0: 1.55, h1: 2.3, side: CG, roof: CG, noInk: true, noTop: true });   // lower-deck windows
    ctParts.push({ a0: a0 + sp * 0.04, a1: a1 - sp * 0.04, w: 1.006, h0: 2.95, h1: 3.7, side: CG, roof: CG, noInk: true, noTop: true });   // upper-deck windows
    for (const f of [0.27, 0.73]) ctParts.push({ a0: a0 + sp * f - sp * 0.035, a1: a0 + sp * f + sp * 0.035, w: 1.012, h0: 1.16, h1: 2.6, side: CR, roof: CR, noInk: true, noTop: true });   // doors
    ctParts.push({ a0, a1, h0: 4.35, h1: 4.75, ch: 0.5, ti: 0.04, tw: 0.08, side: "#c9ccce", roof: "#b9bdc0" });     // roof
    for (const f of [0.22, 0.62]) ctParts.push({ a0: a0 + sp * f, a1: a0 + sp * (f + 0.16), w: 0.6, h0: 4.75, h1: 5.05, ch: 0.2, side: "#d9dcde", roof: "#e6e8e9" });   // rooftop equipment
    if (cab) {   // the cab end: red nose, black windscreen
      const front = c === CARS - 1, e0 = front ? a1 - sp * 0.07 : a0, e1 = front ? a1 : a0 + sp * 0.07;
      ctParts.push({ a0: e0, a1: e1, w: 1.01, h0: 1.16, h1: 4.4, ch: 0.9, side: CR, roof: CR, noInk: true });
      const w0 = front ? a1 - sp * 0.03 : a0, w1 = front ? a1 : a0 + sp * 0.03;
      ctParts.push({ a0: w0, a1: w1, w: 0.86, h0: 2.9, h1: 3.95, ch: 0.6, side: "#111417", roof: "#111417", noInk: true, noTop: true });
    }
    for (let i = n0; i < ctParts.length; i++) ctParts[i].car = c;   // which car each block belongs to, so cars hide one by one
  }
  const CALTRAIN = (r) => ({ L: 185, Wd: 3.1, Hh: 4.75, side: CW, roof: "#b9bdc0", parts: ctParts, lights: true, panto: true,
    r: { ...r, name: "Caltrain", long: (r.name || "").replace(/ Weekday| Weekend/i, "") + " service", color: "#c8102e" } });
  // face colours, cached (shading in 1/64 steps looks the same and spares building a string per face per frame)
  const shadeMemo = new Map();
  const shade = (hex, k) => {
    const key = hex + ((k * 64) | 0); let v = shadeMemo.get(key);
    if (!v) { const n = parseInt(hex.slice(1), 16), q = ((k * 64) | 0) / 64, f = (x) => Math.round(Math.min(255, x * q)); v = `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; shadeMemo.set(key, v); }
    return v;
  };

  // ---- drawing ----
  const canvas = document.createElement("canvas");
  canvas.id = "transit";
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
  // inside the map, under its labels: the label layer (OpenSeadragon's overlays) is lifted above everything drawn here
  viewer.canvas.appendChild(canvas);
  const oc = viewer.overlaysContainer;
  if (oc) Object.assign(oc.style, { position: "absolute", left: "0", top: "0", zIndex: "3" });
  const mainCtx = canvas.getContext("2d");
  let ctx = mainCtx;   // swapped for a scratch canvas while a partly covered vehicle is drawn (see cover())
  const scratch = document.createElement("canvas"), maskC = document.createElement("canvas");
  // ---- the fine depth grid (~0.28 m cells, site/depthfine), in 1024-cell chunks fetched only when zoomed in ----
  let FI = null;
  const fine = new Map(), FINE_MAX = window.__mobile ? 6 : 20;   // chunk key -> Uint16Array (or "loading" / "fail")
  fetch("depthfine/index.json?v=" + (window.__cv || "")).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.chunks) FI = j; }).catch(() => {});
  async function loadFine(key) {
    fine.set(key, "loading");
    try {
      const r = await fetch(`depthfine/${key}.bin?v=${FI.v}`, { priority: "low" }); if (!r.ok) throw 0;
      const d = new Uint16Array(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()), C = FI.chunk;
      for (let y = 0; y < C; y++) { let v = 0; for (let x = 0; x < C; x++) { const i = y * C + x; v = (v + d[i]) & 0xffff; d[i] = v; } }
      fine.delete(key); fine.set(key, d);
      for (const [kk, vv] of fine) { if (fine.size <= FINE_MAX) break; if (typeof vv !== "string") fine.delete(kk); }   // oldest out
    } catch { fine.set(key, "fail"); }
  }
  // depth (camera metres) at a drawing pixel from the fine grid, or null where its chunk isn't in (yet)
  function fineAt(ix, iy) {
    const cx = geo.x0 + ix * geo.mpp, cy = geo.y1 - iy * geo.mpp, C = FI.chunk;
    const col = (cx - FI.x0) / FI.m - 0.5, row = (FI.y1 - cy) / FI.m - 0.5;
    const ci = Math.floor((col + 0.5) / C), cj = Math.floor((row + 0.5) / C), key = ci + "_" + cj, lo = FI.chunks[key];
    if (lo == null) return null;
    const d = fine.get(key); if (!d || typeof d === "string") return null;
    const lx = Math.max(0, Math.min(C - 1.001, col - ci * C)), ly = Math.max(0, Math.min(C - 1.001, row - cj * C)), x0 = Math.floor(lx), y0 = Math.floor(ly), tx = lx - x0, ty = ly - y0;
    const at = (x, y) => { const u = d[y * C + x]; return u === 65535 ? 1e9 : lo + u * FI.step; };
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  }
  // fetch the chunks under the screen (called each frame when zoomed in close)
  function wantFine(o, k, Wc, Hc) {
    if (!FI) return;
    const C = FI.chunk, cell = (sx, sy) => { const cx = geo.x0 + ((sx - o.x) / k) * geo.mpp, cy = geo.y1 - ((sy - o.y) / k) * geo.mpp; return [Math.floor((cx - FI.x0) / FI.m / C), Math.floor((FI.y1 - cy) / FI.m / C)]; };
    const [a0, b0] = cell(0, 0), [a1, b1] = cell(Wc, Hc);
    for (let j = Math.min(b0, b1); j <= Math.max(b0, b1); j++) for (let i = Math.min(a0, a1); i <= Math.max(a0, a1); i++) {
      const key = i + "_" + j; if (FI.chunks[key] != null && !fine.has(key)) loadFine(key);
      else if (fine.get(key) instanceof Uint16Array) { const v = fine.get(key); fine.delete(key); fine.set(key, v); }   // recently used
    }
  }
  const fwd = geo.fwd;
  let hits = [], follow = null, planeHits = [];
  // ---- what shows at which zoom, in one place, in screen px per metre (a 12 m bus is 12× this many px long) ----
  //   below dot: the whole network as route-coloured dots
  //   dot .. vehicle: each bus or train as a pill with its route name (so the label never drops out mid-zoom)
  //   vehicle and up: the bus or train itself, with its route tag above (a bus is ~8 px long at 0.7)
  const ZOOM = { dot: 0.25, vehicle: 0.7, cars: 0.25, stops: 0.8, boatName: 0.9, details: 1.2 };   // follow: a vehicle the camera keeps centred while it flies in
  // the middle of the part of the screen the card doesn't cover
  function clearCentre() {
    let x = innerWidth / 2, y = innerHeight / 2;
    if (!card.hidden) { const r = card.getBoundingClientRect(); if (innerWidth > 700) x = (r.right + innerWidth) / 2; else y = (r.bottom + innerHeight) / 2; }
    return [x, y];
  }

  // how long our own drawing takes each frame (smoothed), so traffic.js thins the cars only when they are what's slow
  let lastDraw = 0, lastView = "";
  function frame(ts) {
    requestAnimationFrame(frame);
    const mi = window.mapItem;
    if (mi) {
      const a = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), b = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0));
      const view = `${a.x.toFixed(2)},${a.y.toFixed(2)},${b.x.toFixed(2)},${innerWidth},${innerHeight}`;
      if (view === lastView && ts - lastDraw < 14) return;   // still view, faster screen than 60 Hz: skip this one
      lastView = view;
    }
    lastDraw = ts;
    const t0 = performance.now();
    try { frameBody(); } finally { const d = performance.now() - t0; window.__drawMs = window.__drawMs == null ? d : window.__drawMs + (d - window.__drawMs) * 0.05; }
  }
  function frameBody() {
  window.__transit = { G, geo, routes, visibility, get fleet() { return fleet; }, placeAt, toImage, offset: () => offset, kind: (v) => kind(v), preview: (K) => vehiclePreview(K), get ctLine() { return ctShape(); }, get follow() { return follow; }, refollow: (v) => { if (v === selected) follow = { v, until: performance.now() + 900 }; }, get hits() { return hits; }, pred: (id) => predV.get(id) };
    ctx = mainCtx;   // in case a draw threw mid-vehicle last frame
    const dpr = window.__dpr || devicePixelRatio || 1, Wc = innerWidth, Hc = innerHeight;
    if (canvas.width !== Wc * dpr || canvas.height !== Hc * dpr) { canvas.width = Wc * dpr; canvas.height = Hc * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wc, Hc);
    if (window.__vehiclesOff) { hits = []; return; }  // toolbar's Transit toggle hides live and ambient vehicles
    const vp = viewer.viewport;
    const mi = window.mapItem, o = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), e = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(geo.W, 0));
    const k = (e.x - o.x) / geo.W;                     // screen px per image px
    const pxPerM = k / geo.mpp;
    const far = pxPerM < ZOOM.cars;                    // too far out for the simulated cars (boats show as badges)
    const scr = (w) => { const p = toImage(w); return [o.x + p[0] * k, o.y + p[1] * k, p[2]]; };
    // Per-pixel cover: the part of a vehicle's screen box that's in the open, as a clip path, from the depth grid (1.6 m
    // cells, sampled at half a cell and blended between cells). Something nearer the camera than the vehicle there (a
    // tree, an awning, a building's edge) hides just that bit, so a car slides under a tree instead of blinking out.
    // Returns "all" (nothing in front), "none" (all of it covered) or { path, frac } (frac = share in the open).
    const DS = geo.depthGrid.scale;
    const depthAt = (ix, iy) => {
      const f = FI ? fineAt(ix, iy) : null; if (f != null) return f;
      const fx = ix / DS - 0.5, fy = iy / DS - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const c = (x, y) => (x < 0 || y < 0 || x >= DW || y >= DH ? 1e9 : grids.dm(y * DW + x));
      return (c(x0, y0) * (1 - tx) + c(x0 + 1, y0) * tx) * (1 - ty) + (c(x0, y0 + 1) * (1 - tx) + c(x0 + 1, y0 + 1) * tx) * ty;
    };
    function cover(pts, zv) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      x0 = Math.floor(x0 - 3); y0 = Math.floor(y0 - 3); x1 += 3; y1 += 3;
      let step = Math.max(1.5, (FI ? FI.m / geo.mpp : DS / 2) * k);   // screen px per sample (a fine cell, or half a coarse one)
      while (((x1 - x0) / step) * ((y1 - y0) / step) > 900) step *= 1.4;   // the mask is smoothed when drawn, so ~30x30 samples is plenty
      const cols = Math.ceil((x1 - x0) / step), rows = Math.ceil((y1 - y0) / step), a = new Uint8ClampedArray(cols * rows * 4);
      let open = 0, n = cols * rows;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const d = depthAt((x0 + (i + 0.5) * step - o.x) / k, (y0 + (j + 0.5) * step - o.y) / k);
        // soft: fully shown where the surface there is behind the vehicle, fading over the 1.2 m in front of it
        const v = Math.max(0, Math.min(1, (d - (zv - 2.7)) / 1.2));
        a[(j * cols + i) * 4 + 3] = v * 255; open += v;
      }
      return open >= n - 0.01 ? "all" : open <= 0.01 ? "none" : { x0, y0, step, cols, rows, a, frac: open / n };
    }
    // draw a vehicle onto the scratch canvas (in screen space, offset to its box), then fade it out where it's covered
    function beginCovered(c, dpr) {
      const w = Math.ceil(c.cols * c.step * dpr), h = Math.ceil(c.rows * c.step * dpr);
      if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(scratch.width, w); scratch.height = Math.max(scratch.height, h); }
      const sc = scratch.getContext("2d");
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, w, h);
      sc.setTransform(dpr, 0, 0, dpr, -c.x0 * dpr, -c.y0 * dpr);
      sc.globalAlpha = 1; sc.globalCompositeOperation = "source-over";
      c.w = w; c.h = h; c.ga = mainCtx.globalAlpha;
      ctx = sc;
    }
    function endCovered(c, dpr) {
      const sc = scratch.getContext("2d");
      if (maskC.width < c.cols || maskC.height < c.rows) { maskC.width = Math.max(maskC.width, c.cols); maskC.height = Math.max(maskC.height, c.rows); }   // grow only: resizing a canvas reallocates it, which cost ~2 ms a frame across the hidden cars
      maskC.getContext("2d").putImageData(new ImageData(c.a, c.cols, c.rows), 0, 0);
      sc.setTransform(1, 0, 0, 1, 0, 0); sc.globalCompositeOperation = "destination-in"; sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = "high";
      sc.drawImage(maskC, 0, 0, c.cols, c.rows, 0, 0, c.w, c.h);
      sc.globalCompositeOperation = "source-over";
      ctx = mainCtx;
      mainCtx.save(); mainCtx.setTransform(1, 0, 0, 1, 0, 0); mainCtx.globalAlpha = c.ga;
      mainCtx.drawImage(scratch, 0, 0, c.w, c.h, Math.round(c.x0 * dpr), Math.round(c.y0 * dpr), c.w, c.h);
      mainCtx.restore();
    }
    if (pxPerM > 1.2) wantFine(o, k, Wc, Hc);
    const now = Date.now() + offset, list = [];
    for (const [id, v] of window.__transitOff ? [] : Object.entries(fleet)) {   // live transit at every zoom (as dots when far out)
      v.id = id;
      // far off screen (by its last report, with room for where it's got to since): don't work out where exactly
      const lr = v.reports.at(-1)?.w;
      if (lr) { const q = scr(lr), m = 200 + 6000 * pxPerM; if (q[0] < -m || q[1] < -m || q[0] > Wc + m || q[1] > Hc + m) continue; }   // shown minutes behind, a bus can be kilometres from its last report
      const p = placeAt(v, now);
      if (!p) continue;
      const s = scr(p.w);
      if (s[0] < -200 || s[1] < -200 || s[0] > Wc + 200 || s[1] > Hc + 200) continue;
      list.push({ v, p, depth: s[2], at: s, transit: true });
    }
    // trains waiting at 4th & King all report the station's own position: put them side by side on parallel tracks
    const trains = list.filter((it) => it.v.route?.startsWith("CT:") && !it.p.platform);
    list.filter((it) => it.p.platform).forEach((it, n) => { if (n > 0) it.noTag = true; });   // one "Caltrain" tag for the station, not five
    for (let i = 0; i < trains.length; i++) {
      const a = trains[i]; if (a.slot != null) continue;
      const group = [a]; a.slot = 0;
      for (let j = i + 1; j < trains.length; j++) { const b = trains[j]; if (b.slot == null && Math.hypot(b.p.w[0] - a.p.w[0], b.p.w[2] - a.p.w[2]) < 40) { b.slot = group.length; group.push(b); } }
      group.forEach((it, n) => {
        const [dx, dz] = it.p.dir, off = (n - (group.length - 1) / 2) * 5.2;
        it.p = { ...it.p, w: [it.p.w[0] - dz * off, it.p.w[1], it.p.w[2] + dx * off] };
        it.at = scr(it.p.w); it.depth = it.at[2]; it.noTag = n > 0;
      });
    }
    // where each live bus and train is this frame, for the simulated cars (traffic.js) to queue behind instead of driving through
    window.__transitSpots = list.map((it) => { let L = 12; try { L = kind(it.v).L || 12; } catch {} return { w: it.p.w, dir: it.p.dir, L }; });
    // ambient traffic from traffic.js, drawn with the same boxes
    if (window.__ambient && !far && !window.__carsOff) for (const a of window.__ambient(Wc, Hc, scr)) list.push(a);
    if (window.__boats && !window.__boatsOff) for (const a of window.__boats(Wc, Hc, scr)) { a.boat = true; list.push(a); }   // live AIS boats from boats.js
    list.sort((a, b) => b.depth - a.depth);
    // following the clicked vehicle: keep it in the clear middle of the screen as it travels, quickly while flying in,
    // gently after, until the card closes or the map is dragged (through a tunnel it waits for it to come back out)
    if (follow) {
      const flying = performance.now() < follow.until;
      if (!flying && follow.v !== selected) follow = null;
      else {
        const ph = planeHits.find((h) => h.plane === follow.v);
        const it = list.find((x) => x.v === follow.v) || (ph && { at: [ph.x, ph.y] });
        if (it) { const [cx, cy] = clearCentre(), dx = it.at[0] - cx, dy = it.at[1] - cy, k = flying ? 0.35 : 0.12; if (Math.hypot(dx, dy) > 0.5) vp.panBy(vp.deltaPointsFromPixels(new OpenSeadragon.Point(dx * k, dy * k), true), true); }
      }
    }
    hits = [];
    // the clicked bus or train's whole route, in its colour, under everything
    if (selected && selected.sh) {
      const R = routes[selected.route] || { color: "#c8102e" };
      ctx.save(); ctx.globalAlpha = 0.85; ctx.strokeStyle = R.color; ctx.lineWidth = Math.max(3, Math.min(9, pxPerM * 3.2)); ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath(); selected.sh.pts.forEach((w, i) => { const q = scr(w); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = Math.max(1, pxPerM * 0.6); ctx.stroke(); ctx.restore();
    }
    if (window.__robotaxi) window.__robotaxi.draw(ctx, scr, pxPerM);   // a tracked robotaxi's route and destination (traffic.js)
    // Muni stops with arrivals coming, when zoomed in close enough to pick one: click for its board
    if (!window.__transitOff && pxPerM >= ZOOM.stops && stopBoard.size) {
      const r = Math.max(3.5, Math.min(6, 2.5 + pxPerM * 1.2));
      ctx.save(); ctx.lineWidth = 1.6;
      for (const sid of stopBoard.keys()) {
        const st = STOPS[sid]; if (!st) continue;
        const w = st.w || (st.w = streetLevel(onBridge(st[0], st[1], G.toWorld(st[0], st[1]), true))), q = scr(w);
        if (q[0] < -10 || q[1] < -10 || q[0] > Wc + 10 || q[1] > Hc + 10) continue;
        if (sid !== selStop && visibility(w, 1) < 0.5) continue;
        const on = sid === selStop;
        ctx.globalAlpha = 1; ctx.fillStyle = on ? "#EE5D4A" : "#fff"; ctx.strokeStyle = on ? "#fff" : "#24313a";
        ctx.beginPath(); ctx.arc(q[0], q[1], on ? r + 2 : r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        hits.push({ x: q[0], y: q[1], r: r + 6, stop: sid });
      }
      ctx.restore();
    }
    if (window.__xray && xrayAt([XR ? XR.x : 0, 0, XR ? XR.z : 0])) {   // the tunnels near the station, as a dark see-through band
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
      const segD = ([x0, z0, x1, z1]) => { const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((XR.x - x0) * dx + (XR.z - z0) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x0 + dx * t - XR.x, z0 + dz * t - XR.z); };
      const near = TSEG.filter((sg) => segD(sg) < 800);   // the Market St tunnel is one 3 km segment: distance to it, not to its middle
      for (const [width, style] of [[Math.max(8, 11 * pxPerM), "rgba(150,195,235,0.30)"], [Math.max(3, 6 * pxPerM), "rgba(20,30,44,0.45)"], [Math.max(1.2, 0.5 * pxPerM), "rgba(255,255,255,0.6)"]]) {
        ctx.strokeStyle = style; ctx.lineWidth = width; if (width < 6) ctx.setLineDash([6, 6]);
        ctx.beginPath();
        for (const [x0, z0, x1, z1] of near) { const y = (G.ground(x0, z0) ?? 0) - 12, a = scr([x0, y, z0]), b = scr([x1, y, z1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.stroke();
      }
      ctx.restore();
    }
    const fade = Math.min(1, (pxPerM - 0.25) / 0.35);
    ctx.globalAlpha = fade;
    const night = window.atmo?.night;
    for (const it of list) {
      const { v, p, at } = it, K = it.K || kind(v);
      const vis = visibility(p.w, K.Hh / 2);
      v.vis = (v.vis ?? vis) + (vis - (v.vis ?? vis)) * (it.transit ? 0.05 : 0.15);  // ease in and out of cover
      if (v === selected) {
        const rr = Math.min(70, Math.max(14, K.L * pxPerM * 0.7));
        ctx.save(); ctx.globalAlpha = 1; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(at[0], at[1], rr, rr * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(20,30,36,0.8)"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
      }
      // zoomed out, a bus or train is a dot in its route's colour, so the whole network shows (and stays clickable);
      // in the middle band, a pill with its route name; only close enough to read does it become the vehicle itself
      if (it.transit && pxPerM < ZOOM.vehicle) {
        const R = K.r || {}, col = R.color || "#005B95";
        ctx.globalAlpha = 1; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.fillStyle = col;
        if (pxPerM < ZOOM.dot) {
          const rr = Math.max(3.4, Math.min(4.6, 3 + pxPerM * 6));
          ctx.beginPath(); ctx.arc(at[0], at[1], rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          hits.push({ x: at[0], y: at[1], r: 9, v, K });
        } else {
          const label = R.name || "", h = 15;
          ctx.font = "700 10px -apple-system, sans-serif";
          const w = Math.max(17, ctx.measureText(label).width + 9);
          ctx.beginPath(); ctx.roundRect(at[0] - w / 2, at[1] - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = luminance(col) > 0.55 ? "#111" : "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(label, at[0], at[1] + 0.5);
          hits.push({ x: at[0], y: at[1], r: Math.max(10, w / 2 + 3), v, K });
        }
        continue;
      }
      // a train is judged car by car (one can be under the freeway while the rest is in the open); anything else as a whole
      let carHidden = null;
      if (K.parts && K.parts[0]?.car != null) {
        carHidden = [];
        const [ddx, ddz] = p.dir;
        for (const q of K.parts) if (carHidden[q.car] === undefined) {
          const n = Math.max(...K.parts.map((r) => r.car)) + 1, a = (-0.5 + (q.car + 0.5) / n) * K.L;
          const cw = p.carAt ? p.carAt(a).w : [p.w[0] + ddx * a, p.w[1], p.w[2] + ddz * a], cx = cw[0], cz = cw[2];
          carHidden[q.car] = visibility([cx, p.w[1], cz], 2.2) < 0.5 || underDeck(cx, p.w[1], cz) || inTunnel(cx, cz);
        }
        if (carHidden.every(Boolean)) continue;
      }
      // even partly behind a building: not drawn. Live transit only fades to a ghost (trees over the J's right of way,
      // say, would otherwise make it blink in and out), so a train can be followed the whole way
      let seen = carHidden ? 1 : Math.max(it.transit ? 0.35 : 0, Math.min(1, Math.max(0, (v.vis - 0.72) / 0.22)));
      // close enough to see the shape: clip to the part in the open instead of fading the whole vehicle
      let covered = null;
      if (v.under) seen = 0.5;   // see-through: a ghost in the tunnel, never covered
      else if (!carHidden && !it.boat && K.L < 30 && pxPerM > 1.2) {
        // all in the open (most cars) or all hidden: the answer holds until it has moved a metre or so or the zoom
        // changes, so it isn't worked out afresh every frame (that was most of the cost of drawing traffic)
        const cv = v._cv, tnow = performance.now();
        let c;
        if (cv && cv.k === pxPerM && tnow - cv.t < 1500 && Math.abs(cv.x - p.w[0]) + Math.abs(cv.z - p.w[2]) < 1.2) c = cv.c;
        else {
          const [dx0, dz0] = p.dir, hl0 = K.L / 2 + 0.3, hw0 = K.Wd / 2 + 0.3, pts = [];
          for (const a of [-hl0, hl0]) for (const b of [-hw0, hw0]) for (const h of [0, K.Hh + 0.3]) pts.push(scr([p.w[0] + dx0 * a - dz0 * b, p.w[1] + h, p.w[2] + dz0 * a + dx0 * b]));
          c = cover(pts, Math.min(...pts.map((q) => q[2])));   // its nearest corner: the road just in front of a car is about as near as the car's own front
          v._cv = typeof c === "string" ? { c, k: pxPerM, x: p.w[0], z: p.w[2], t: tnow } : null;
        }
        if (c === "all") seen = 1;
        else if (c === "none" || c.frac < 0.12) { if (!it.transit) continue; }   // all but hidden: live transit stays a ghost, cars go
        else { covered = c; seen = 1; }
      }
      if (seen < 0.02) continue;
      ctx.globalAlpha = (it.boat || it.transit ? 1 : fade) * seen * (it.alpha ?? 1);   // boats and live transit stay solid at every zoom
      if (covered) beginCovered(covered, dpr);
      if (it.transit && K.r && !(carHidden && carHidden.some(Boolean))) {   // a soft pool of the route's colour under live transit, so it reads apart from the simulated cars
        const rx = Math.min(34, Math.max(7, (Math.min(K.L, 20) * 0.5 + 3) * pxPerM)), a0 = ctx.globalAlpha;
        ctx.globalAlpha = a0 * 0.42; ctx.fillStyle = K.r.color || "#005B95";
        ctx.beginPath(); ctx.ellipse(at[0], at[1], rx, rx * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a0;
      }
      const _k = K, [dx, dz] = p.dir, px = -dz, pz = dx, w = p.w, y0 = w[1] + 0.3;
      const corner = (a, b, h) => scr([w[0] + dx * a + px * b, y0 + h, w[2] + dz * a + pz * b]);
      const corner0 = corner, _dx0 = dx, _dz0 = dz;
      const hl = K.L / 2, hw = K.Wd / 2;
      const base = [corner(-hl, -hw, 0), corner(hl, -hw, 0), corner(hl, hw, 0), corner(-hl, hw, 0)];
      const top = [corner(-hl, -hw, K.Hh), corner(hl, -hw, K.Hh), corner(hl, hw, K.Hh), corner(-hl, hw, K.Hh)];
      // under way: a short wavy trail off the stern at a fixed size on screen, so movement shows at any zoom. It drifts
      // back gently at one calm pace whatever the speed; faster boats only get a longer trail.
      if (it.boat && (v.r?.sog || 0) > 1) {
        const st = corner(-hl, 0, -0.3), bk = corner(-hl - 40, 0, -0.3), ux = (bk[0] - st[0]), uy = (bk[1] - st[1]), ul = Math.hypot(ux, uy) || 1;
        const tx = ux / ul, ty = uy / ul, nx = -ty, ny = tx;
        const len = 24 + Math.min(18, v.r.sog * 0.9), T = performance.now() / 1000, ph = (v.id ? v.id.length * 1.7 : 0);
        ctx.save(); ctx.lineCap = "round"; ctx.lineWidth = 1.8;
        for (let i = 0; i < 3; i++) {   // three soft ripples, each easing back and fading
          const f = ((T * 0.35 + i / 3) % 1), d0 = f * len, d1 = Math.min(len, d0 + 8), amp = 1.2 + f * 1.8;
          ctx.strokeStyle = `rgba(255,255,255,${(0.75 * (1 - f)).toFixed(3)})`;
          ctx.beginPath();
          for (let k = 0; k <= 6; k++) {
            const d = d0 + (d1 - d0) * k / 6, w = Math.sin(d * 0.45 + T * 1.6 + ph) * amp;
            const x = st[0] + tx * d + nx * w, y = st[1] + ty * d + ny * w;
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      if (K.wake) {  // a boat's wake: two thin white lines spreading behind the stern, with faint foam between
        const Lw = K.wake, spread = 0.19;
        const st = corner(-hl * 0.7, 0, -0.3), a = corner(-hl - Lw, -hw - Lw * spread, -0.3), b = corner(-hl - Lw, hw + Lw * spread, -0.3);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const g = ctx.createLinearGradient(st[0], st[1], mid[0], mid[1]);
        g.addColorStop(0, "rgba(255,255,255,0.28)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        poly([corner(-hl * 0.7, -hw * 0.9, -0.3), corner(-hl * 0.7, hw * 0.9, -0.3), b, a]);
        const lg = ctx.createLinearGradient(st[0], st[1], mid[0], mid[1]);
        lg.addColorStop(0, "rgba(255,255,255,0.85)"); lg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = lg; ctx.lineWidth = Math.max(1, Math.min(3, pxPerM * 0.6)); ctx.lineCap = "round";
        for (const [s0, e] of [[corner(-hl * 0.6, -hw, -0.3), a], [corner(-hl * 0.6, hw, -0.3), b]]) { ctx.beginPath(); ctx.moveTo(...s0); ctx.lineTo(...e); ctx.stroke(); }
      }
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      const sh = K.parts ? 0.45 : 2.2;   // cars sit low: a small shadow right under them
      if (!(carHidden && carHidden.some(Boolean)) && !p.carAt) poly(base.map(([x, y]) => [x + sh * pxPerM, y + sh * 0.55 * pxPerM]));   // no shadow cast onto a freeway deck over the hidden cars
      const faces = [[0, 1, [-px, -pz]], [1, 2, [dx, dz]], [2, 3, [px, pz]], [3, 0, [-dx, -dz]]];
      // level of detail: a car only a few pixels long is drawn as one shaded box (its blocks and outlines can't be seen)
      const lod = K.parts && !it.boat && !it.transit && K.L * pxPerM < 9;
      if (K.parts && !lod) {
        // a car built from a few rounded, tapering blocks (wheels, body, glass cabin), outlined like the drawing
        const ink = Math.max(0.5, Math.min(1.3, pxPerM * 0.07));
        ctx.lineJoin = "round"; ctx.lineWidth = ink; ctx.strokeStyle = "rgba(24,28,34,0.75)";
        // footprint: a box with cut corners, or a hull whose front narrows to a point (bow = length of the taper)
        const foot = (x0, x1, h, c, bow) => bow ? [[x0 + c, -h], [x1 - bow, -h], [x1, 0], [x1 - bow, h], [x0 + c, h], [x0, h - c], [x0, -h + c]]
          : c ? [[x0 + c, -h], [x1 - c, -h], [x1, -h + c], [x1, h - c], [x1 - c, h], [x0 + c, h], [x0, h - c], [x0, -h + c]] : [[x0, -h], [x1, -h], [x1, h], [x0, h]];
        const hs = K.hs || 1;   // boats drawn bigger than life when zoomed out scale their heights too
        const along = dx * fwd[0] + dz * fwd[2];
        const parts = K.parts.length > 3 ? K.parts.slice().sort((A, B) => A.h0 - B.h0 || along * ((B.a0 + B.a1) - (A.a0 + A.a1))) : K.parts;
        // an articulated train: every car placed and turned by the track under it
        const art = p.carAt && K.parts[0]?.car != null, frames = [];
        if (art) { const n = Math.max(...K.parts.map((r) => r.car)) + 1; for (let ci = 0; ci < n; ci++) { const ac = (-0.5 + (ci + 0.5) / n) * K.L, f = p.carAt(ac); frames[ci] = { ac, w: f.w, dx: f.dir[0], dz: f.dir[1] }; } }
        for (const q of parts) {
          if (carHidden && carHidden[q.car]) continue;
          let dx = _dx0, dz = _dz0, px = -dz, pz = dx, corner = corner0;
          if (art) {
            const f = frames[q.car]; dx = f.dx; dz = f.dz; px = -dz; pz = dx;
            const cy = f.w[1] + 0.3;
            corner = (a, b, h) => scr([f.w[0] + dx * (a - f.ac) + px * b, cy + h, f.w[2] + dz * (a - f.ac) + pz * b]);
          }
          const x0 = q.a0 * K.L, x1 = q.a1 * K.L, hw2 = hw * (q.w ?? 1), c = (q.ch || 0) * hs, ti = (q.ti || 0) * hs, tw = (q.tw || 0) * hs, bow = q.bow ? q.bow * K.L : 0;
          const ob = (q.o || 0) * hw;   // a block set off to one side (a robotaxi's sensor pods)
          const B = foot(x0, x1, hw2, bow ? Math.min(c, hw2) : c, bow).map(([a, b]) => corner(a, b + ob, q.h0 * hs));
          const T = foot(x0 + ti, x1 - ti, hw2 - tw, Math.max(0, (bow ? Math.min(c, hw2) : c) - Math.min(ti, tw)), bow ? Math.max(0, bow - ti) : 0).map(([a, b]) => corner(a, b + ob, q.h1 * hs));
          const F = foot(x0, x1, hw2, bow ? Math.min(c, hw2) : c, bow);
          for (let i = 0; i < F.length; i++) {
            const j = (i + 1) % F.length, ea = F[j][0] - F[i][0], eb = F[j][1] - F[i][1], L = Math.hypot(ea, eb) || 1;
            const na = eb / L, nb = -ea / L, nx = na * dx + nb * px, nz = na * dz + nb * pz;   // outward normal in world x/z
            if (nx * fwd[0] + nz * fwd[2] >= 0) continue;
            ctx.fillStyle = shade(q.side, 0.7 + 0.3 * Math.abs(nx));
            ctx.beginPath(); ctx.moveTo(...B[i]); ctx.lineTo(...B[j]); ctx.lineTo(...T[j]); ctx.lineTo(...T[i]); ctx.closePath(); ctx.fill();
            if (!q.noInk) ctx.stroke();
          }
          if (!q.noTop) { ctx.fillStyle = q.roof; ctx.beginPath(); T.forEach((pt, i) => (i ? ctx.lineTo(...pt) : ctx.moveTo(...pt))); ctx.closePath(); ctx.fill(); }
          if (!q.noInk) ctx.stroke();
        }
      } else {
      // sides that face the camera: outward normals in world x/z
      for (const [i, j, n] of faces) {
        const facing = n[0] * fwd[0] + n[1] * fwd[2];
        if (facing >= 0) continue;
        ctx.fillStyle = shade(K.side, 0.72 + 0.28 * Math.abs(n[0]));
        poly([base[i], base[j], top[j], top[i]]);
        if (pxPerM > ZOOM.details && K.band) {  // a coloured band along the side
          const lerp = (A, B, f) => [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
          ctx.fillStyle = K.band;
          poly([lerp(base[i], top[i], 0.28), lerp(base[j], top[j], 0.28), lerp(base[j], top[j], 0.4), lerp(base[i], top[i], 0.4)]);
          ctx.fillStyle = "rgba(30,40,48,0.55)";
          poly([lerp(base[i], top[i], 0.55), lerp(base[j], top[j], 0.55), lerp(base[j], top[j], 0.85), lerp(base[i], top[i], 0.85)]);
        }
      }
      ctx.fillStyle = K.roof;
      poly(top);
      if (!lod) { ctx.strokeStyle = "rgba(20,30,36,0.55)"; ctx.lineWidth = Math.max(0.5, Math.min(1.5, pxPerM * 0.25));
        ctx.beginPath(); top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); }
      }
      // overhead gear: a trolley bus's two poles reaching back to the wires, a streetcar's one, a light-rail pantograph
      if ((K.poles || K.pole || K.panto) && pxPerM > 0.9 && !lod) {
        ctx.strokeStyle = "rgba(24,28,34,0.85)"; ctx.lineWidth = Math.max(0.8, Math.min(2, pxPerM * 0.1)); ctx.lineCap = "round";
        ctx.beginPath();
        if (K.panto) {
          const A = corner(K.L * 0.08, 0, K.Hh), B = corner(K.L * 0.14, 0, K.Hh + 1.6), C = corner(K.L * 0.2, 0, K.Hh);
          ctx.moveTo(...A); ctx.lineTo(...B); ctx.lineTo(...C);
          const l = corner(K.L * 0.14, -0.7, K.Hh + 1.6), rr = corner(K.L * 0.14, 0.7, K.Hh + 1.6); ctx.moveTo(...l); ctx.lineTo(...rr);
        } else for (const b of K.poles ? [-0.32, 0.32] : [0]) {
          const at = (K.poleAt ?? -0.2) * K.L, base = corner(at, b, K.Hh), tip = corner(at - 5.2, b * 0.6, K.Hh + 2.6);
          ctx.moveTo(...base); ctx.lineTo(...tip);
        }
        ctx.stroke();
      }
      if (night && K.lights !== false && pxPerM > ZOOM.details) {  // headlights and tail lights: small and soft, only up close
        for (const [a, col, r, al] of [[hl + 0.2, "255,236,170", 0.9, 0.5], [-hl - 0.1, "255,70,50", 0.55, 0.45]]) for (const b of [-hw * 0.6, hw * 0.6]) {
          const [lx, ly] = corner(a, b, 0.7), rr = r * pxPerM;
          const gr = ctx.createRadialGradient(lx, ly, 0, lx, ly, rr);
          gr.addColorStop(0, `rgba(${col},${al})`); gr.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = gr; ctx.fillRect(lx - rr, ly - rr, rr * 2, rr * 2);
        }
      }
      if (covered) endCovered(covered, dpr);   // tags and badges stay whole, drawn after
      if (K.robo && !lod) hits.push({ x: at[0], y: at[1] - K.Hh * pxPerM * 0.5, r: Math.max(8, K.L * pxPerM * 0.5), v, K, robo: K.robo });   // simulated robotaxis: click to track (traffic.js)
      if (!K.r) continue;
      if (it.boat) {   // boats: a round badge with a boat (or sail) glyph at every zoom, plus the name once zoomed in
        const col = BOATCOL[K.type] || "#33424d", tx = top.reduce((a, q) => a + q[0], 0) / 4, ty = Math.min(...top.map((q) => q[1])) - 18;
        ctx.globalAlpha = 1;
        const name = pxPerM > ZOOM.boatName && K.r.name && !/^(Boat|Sailboat|Tug|Work boat|Fishing boat|Cargo ship|Tanker|Ferry|Vessel)$/.test(K.r.name) ? K.r.name : "";
        ctx.font = "600 11px -apple-system, sans-serif";
        const tw = name ? ctx.measureText(name).width + 8 : 0, w = 20 + tw, x0 = tx - w / 2;
        ctx.fillStyle = col; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(tx - 4, ty + 9); ctx.lineTo(tx, ty + 15); ctx.lineTo(tx + 4, ty + 9); ctx.closePath(); ctx.fill();   // pointer to the boat
        ctx.beginPath(); ctx.roundRect(x0, ty - 10, w, 20, 10); ctx.fill(); ctx.stroke();
        boatGlyph(x0 + 10, ty - 0.5, K.type === "sailing");
        if (name) { ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(name, x0 + 19, ty + 0.5); }
        hits.push({ x: tx, y: ty, r: Math.max(14, w / 2), v, K });
        hits.push({ x: at[0], y: at[1] - K.Hh * pxPerM * 0.5, r: Math.max(10, K.L * pxPerM * 0.5), v, K });
        continue;
      }
      // route tag
      const tx = top.reduce((a, q) => a + q[0], 0) / 4, ty = Math.min(...top.map((q) => q[1]));
      if (!K.noTag && !it.noTag) {
        const label = K.r.name, fs = Math.max(10, Math.min(13, pxPerM * 3));   // never smaller than the pills
        ctx.font = `600 ${fs}px -apple-system, sans-serif`;
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = K.r.color; roundRect(tx - tw / 2, ty - fs - 10, tw, fs + 5, 3);
        ctx.fillStyle = luminance(K.r.color) > 0.55 ? "#111" : "#fff";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, tx, ty - fs / 2 - 7.5);
      }
      hits.push({ x: at[0], y: at[1] - K.Hh * pxPerM * 0.5, r: Math.max(10, K.L * pxPerM * 0.5), v, K });
    }
    ctx.globalAlpha = 1;
    // people standing about (people.js)
    if (window.__people) for (const h of window.__people(ctx, scr, pxPerM, Wc, Hc, selected)) hits.push(h);
    // live planes (planes.js), in the sky over everything
    planeHits = window.__planes ? window.__planes(ctx, scr, pxPerM, Wc, Hc, selected) : [];
    for (const h of planeHits) hits.push(h);
    ctx.globalAlpha = 1;
  }
  const BOATCOL = { passenger: "#1f5f9f", cargo: "#8a3324", tanker: "#2d3a44", tug: "#c8432b", sailing: "#3f7f9f", pleasure: "#55707c", fishing: "#2f5d7c", service: "#a8791a", military: "#5b636a" };
  function boatGlyph(cx, cy, sail) {   // a tiny white side-on boat (or sailboat), bow to the right, centred at cx, cy
    ctx.fillStyle = "#fff"; ctx.beginPath();
    ctx.moveTo(cx - 7, cy + 1.5); ctx.lineTo(cx + 7.5, cy + 1.5); ctx.lineTo(cx + 4.5, cy + 5.5); ctx.lineTo(cx - 6, cy + 5.5); ctx.closePath();   // hull, raked bow
    if (sail) { ctx.moveTo(cx - 0.6, cy - 7); ctx.lineTo(cx - 0.6, cy + 0.5); ctx.lineTo(cx - 6, cy + 0.5); ctx.closePath(); ctx.moveTo(cx + 0.6, cy - 6); ctx.lineTo(cx + 0.6, cy + 0.5); ctx.lineTo(cx + 5, cy + 0.5); ctx.closePath(); }
    else { ctx.rect(cx - 4.5, cy - 2.5, 7, 3.5); ctx.rect(cx - 3, cy - 5, 3.5, 2.2); }                                                  // cabin and bridge
    ctx.fill();
  }
  function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
  function luminance(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
  requestAnimationFrame(frame);

  // ---- click a bus, train or boat for its card ----
  const card = document.getElementById("card");
  const TYPE = { 0: "Light rail", 1: "Subway", 2: "Train", 3: "Bus", 4: "Ferry", 5: "Cable car" };
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() + offset - t) / 1000)); return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const slug = (x) => x.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // ---- a turntable preview of the vehicle for its card: its own blocks, drawn through the map's camera, slowly turning ----
  function vehiclePreview(K0) {
    // at its true size: zoomed out, the map draws a boat bigger (and stores that factor as hs), which the preview would
    // otherwise apply twice to its height (a sailboat's mast then towered over the frame and the boat shrank to a speck)
    if (K0.hs && K0.hs !== 1) K0 = { ...K0, L: K0.L / K0.hs, Wd: K0.Wd / K0.hs, Hh: K0.Hh / K0.hs, hs: 1, wake: 0 };
    // a long train shows its front two cars, big enough to read, rather than a thin line
    let K = K0;
    // (trains only, known by their numbered cars: a moored ship has no wake, and its crop was just a box)
    if (K0.parts && K0.L > 50 && K0.parts.some((q) => q.car != null)) {
      const win = Math.min(1, 46 / K0.L), lo = 0.5 - win;
      const parts = K0.parts.filter((q) => q.a1 > lo).map((q) => ({ ...q, a0: (Math.max(q.a0, lo) - lo) / win - 0.5, a1: (q.a1 - lo) / win - 0.5 }));
      K = { ...K0, L: K0.L * win, parts };
    }
    const W = 340, H = 150, dpr = Math.min(2, devicePixelRatio || 1);
    const cv = document.createElement("canvas");
    cv.className = "vprev"; cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = `width:100%;aspect-ratio:${W}/${H};display:block;margin:2px auto 6px`;
    cv.setAttribute("aria-hidden", "true");
    const c = cv.getContext("2d"), M = geo.worldToCamera, F = geo.fwd;
    const proj = (x, y, z) => [M[0] * x + M[4] * y + M[8] * z, -(M[1] * x + M[5] * y + M[9] * z)];
    const L = K.L, hw = K.Wd / 2, Hh = K.Hh * (K.hs || 1);
    const parts = K.parts || [{ a0: -0.5, a1: 0.5, h0: 0, h1: K.Hh, side: K.side, roof: K.roof }];
    const foot = (x0, x1, h, cc, bow) => bow ? [[x0 + cc, -h], [x1 - bow, -h], [x1, 0], [x1 - bow, h], [x0 + cc, h], [x0, h - cc], [x0, -h + cc]]
      : cc ? [[x0 + cc, -h], [x1 - cc, -h], [x1, -h + cc], [x1, h - cc], [x1 - cc, h], [x0 + cc, h], [x0, h - cc], [x0, -h + cc]] : [[x0, -h], [x1, -h], [x1, h], [x0, h]];
    // it rocks gently around its side view (where the livery shows), and one scale fits that whole swing
    const side = Math.atan2(M[8], M[0]), SWING = 0.5;
    // the box the vehicle sweeps through over the whole swing: scale and centre on that, so it fills the frame
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let a = side - SWING; a <= side + SWING + 1e-6; a += SWING / 6) for (const [x, z] of [[L / 2, hw], [L / 2, -hw], [-L / 2, hw], [-L / 2, -hw]]) for (const y of [0, Hh + (K.poles || K.pole || K.panto ? 2.8 : 0.3)]) {
      const dx = Math.cos(a), dz = Math.sin(a), p = proj(dx * x - dz * z, y, dz * x + dx * z);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const ext = Math.max((x1 - x0) / (W - 16), (y1 - y0) / (H - 12)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = 1 / ext, t0 = performance.now();
    function frame(now) {
      if (!cv.isConnected) return;   // the card closed or moved on
      requestAnimationFrame(frame);
      const ang = side + SWING * Math.sin(((now - t0) / 1000) * 0.55), dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
      const pt = (a, b, h) => { const p = proj(dx * a + px * b, h, dz * a + pz * b); return [W / 2 + (p[0] - cx) * k, H / 2 + (p[1] - cy) * k]; };
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      // a soft shadow on the ground
      c.fillStyle = "rgba(0,0,0,0.13)"; c.beginPath(); [[-L / 2, -hw], [L / 2, -hw], [L / 2, hw], [-L / 2, hw]].forEach(([a, b], i) => { const q = pt(a + 0.6, b + 0.6, 0); i ? c.lineTo(...q) : c.moveTo(...q); }); c.closePath(); c.fill();
      const along = dx * F[0] + dz * F[2];
      const order = parts.length > 3 ? parts.slice().sort((A, B) => A.h0 - B.h0 || along * ((B.a0 + B.a1) - (A.a0 + A.a1))) : parts;
      c.lineJoin = "round"; c.lineWidth = 0.9; c.strokeStyle = "rgba(24,28,34,0.7)";
      const hs = K.hs || 1;
      for (const q of order) {
        const x0 = q.a0 * L, x1 = q.a1 * L, h2 = hw * (q.w ?? 1), cc = (q.ch || 0) * hs, ti = (q.ti || 0) * hs, tw = (q.tw || 0) * hs, bow = q.bow ? q.bow * L : 0;
        const ccB = bow ? Math.min(cc, h2) : cc, Fp = foot(x0, x1, h2, ccB, bow);
        const ob = (q.o || 0) * hw;   // set off to one side
        const B = Fp.map(([a, b]) => pt(a, b + ob, q.h0 * hs)), T = foot(x0 + ti, x1 - ti, h2 - tw, Math.max(0, ccB - Math.min(ti, tw)), bow ? Math.max(0, bow - ti) : 0).map(([a, b]) => pt(a, b + ob, q.h1 * hs));
        for (let i = 0; i < Fp.length; i++) {
          const j = (i + 1) % Fp.length, ea = Fp[j][0] - Fp[i][0], eb = Fp[j][1] - Fp[i][1], Ll = Math.hypot(ea, eb) || 1;
          const na = eb / Ll, nb = -ea / Ll, nx = na * dx + nb * px, nz = na * dz + nb * pz;
          if (nx * F[0] + nz * F[2] >= 0) continue;
          c.fillStyle = shade(q.side, 0.7 + 0.3 * Math.abs(nx));
          c.beginPath(); c.moveTo(...B[i]); c.lineTo(...B[j]); c.lineTo(...T[j]); c.lineTo(...T[i]); c.closePath(); c.fill(); if (!q.noInk) c.stroke();
        }
        if (!q.noTop) { c.fillStyle = q.roof; c.beginPath(); T.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p))); c.closePath(); c.fill(); if (!q.noInk) c.stroke(); }
      }
      if (K.poles || K.pole || K.panto) {   // the overhead gear, as on the map
        c.strokeStyle = "rgba(24,28,34,0.85)"; c.lineWidth = 1.2; c.lineCap = "round"; c.beginPath();
        if (K.panto) { c.moveTo(...pt(L * 0.08, 0, Hh)); c.lineTo(...pt(L * 0.14, 0, Hh + 1.6)); c.lineTo(...pt(L * 0.2, 0, Hh)); c.moveTo(...pt(L * 0.14, -0.7, Hh + 1.6)); c.lineTo(...pt(L * 0.14, 0.7, Hh + 1.6)); }
        else for (const b of K.poles ? [-0.32, 0.32] : [0]) { const at = (K.poleAt ?? -0.2) * L; c.moveTo(...pt(at, b, Hh)); c.lineTo(...pt(at - 5.2, b * 0.6, Hh + 2.6)); }
        c.stroke();
      }
    }
    requestAnimationFrame(frame);
    return cv;
  }
  const mins = (t) => { const m = Math.round((t - Date.now() - offset) / 60000); return m <= 0 ? "now" : `${m} min`; };
  function nextStops(v) {
    const P = predV.get(v.id); if (!P) return "";
    const now = Date.now() + offset, next = P.calls.filter(([sid, t]) => t > now - 20e3 && STOPS[sid]).slice(0, 3);
    if (!next.length) return "";
    return `<p class="ctttl">Next stops</p><div class="ctboard"><table>${next.map(([sid, t]) => `<tr><td>${esc(STOPS[sid][2])}</td><td style="text-align:right;white-space:nowrap">${mins(t)}</td></tr>`).join("")}</table></div>`;
  }
  // ---- a stop's board: what's coming, by line and destination, from 511's predictions (refreshed as they come) ----
  const shortDest = (d) => d.replace(/\/Mezzanine Level$/, "").replace(/^Metro (.*) Station$/, "$1").replace(/ Station$/, "");
  function renderStop() {
    const sid = selStop, st = STOPS[sid];
    if (!sid || !st || card.hidden) return;
    // the stop and the ones right beside it (other side of the street, a station's other platform, the surface stops
    // over a Metro station), the same set the TV board shows, so a QR scan and the board agree
    const now = Date.now() + offset, rows = new Map();
    const near = Object.keys(STOPS).filter((k) => Math.hypot((STOPS[k][0] - st[0]) * 111320, (STOPS[k][1] - st[1]) * 88200) < 70);
    for (const id of near) for (const a of stopBoard.get(id) || []) {
      if (a.t < now - 30e3) continue; const k = a.route + "|" + a.dest, l = rows.get(k) || rows.set(k, []).get(k);
      if (!l.some((x) => Math.abs(x.t - a.t) < 20e3 && x.veh === a.veh)) l.push(a);
    }
    const list = [...rows.values()].map((l) => l.sort((a, b) => a.t - b.t)).sort((a, b) => a[0].t - b[0].t);
    const body = list.map((l, i) => {
      const R = routes[l[0].route] || { name: l[0].route.split(":")[1], color: "#005B95" };
      const ts = l.slice(0, 3).map((a) => { const m = Math.round((a.t - now) / 60000); return m <= 0 ? "now" : m; });
      const txt = ts.join(", ") + (typeof ts.at(-1) === "number" ? " min" : "");
      return `<tr data-i="${i}"${l[0].veh && fleet[l[0].veh] ? ' class="go" title="Show this one on the map"' : ""}><td><b class="badge" style="background:${R.color};color:${luminance(R.color) > 0.55 ? "#111" : "#fff"};font-size:12px">${esc(R.name)}</b></td><td>to ${esc(shortDest(l[0].dest))}</td><td style="text-align:right;white-space:nowrap"><b>${txt}</b></td></tr>`;
    }).join("");
    const title = st[2].replace(/^Metro /, "").replace(/\s*\/\s*(Downtown|Downtn|Outbound|Outbd)$/, "").replace(/ (Northbound|Southbound|Outbound|Inbound)$/, "");
    card.innerHTML = `<button class="x" aria-label="Close">×</button><h2>${esc(title)}</h2>
      ${list.length ? `<div class="ctboard"><table>${body}</table></div>` : `<p>No Muni arrivals predicted here right now.</p>`}
      <p class="meta">Muni stop ${esc(sid)} · predictions from 511.org, updated ${ago(predAt)} · <a href="?tv=${encodeURIComponent(sid)}">Show on a TV</a></p>`;
    card.hidden = false;
    card.querySelector(".x").onclick = () => { card.hidden = true; selStop = null; };
    card.querySelectorAll("tr.go").forEach((tr) => (tr.onclick = () => {
      const v = fleet[list[+tr.dataset.i][0].veh]; if (!v) return;
      selStop = null; clearInterval(stopTimer); showCard(v, kind(v)); flyToVehicle(v, kind(v));
    }));
  }
  // a plane's card (planes.js writes it), kept current while open; the view flies in and follows it
  let planeTimer = null;
  function showPlane(p) {
    selStop = null; selected = p;
    window.track?.("plane: open", { type: p.r.t || "" });
    const render = () => {
      if (selected !== p || card.hidden || !window.__planeCard) { clearInterval(planeTimer); return; }
      card.innerHTML = `<button class="x" aria-label="Close">×</button>${window.__planeCard(p)}`;
      card.querySelector(".x").onclick = () => { card.hidden = true; selected = null; };
      if (prev) card.querySelector("h2").after(prev);   // the same picture each refresh, still turning
    };
    const prev = window.__planePreview?.(p);
    card.hidden = false; render();
    clearInterval(planeTimer); planeTimer = setInterval(render, 2000);
    const mi = window.mapItem, vp = viewer.viewport, z = mi.viewportToImageZoom(vp.getZoom(true)) / geo.mpp;
    if (z < 0.7) vp.zoomTo(mi.imageToViewportZoom(1 * geo.mpp));
    follow = { v: p, until: performance.now() + 1600 };
  }
  function showStop(sid) {
    selected = null; selStop = sid; card.hidden = false;
    window.track?.("stop: open", { stop: sid });
    renderStop();
    clearInterval(stopTimer); stopTimer = setInterval(() => { if (selStop && !card.hidden) renderStop(); else clearInterval(stopTimer); }, 15e3);
  }
  // ?stop=<id> (the TV board's QR code): open that stop's arrivals once the stops and predictions are in
  {
    const q0 = new URLSearchParams(location.search), want = q0.get("stop");
    if (want && !q0.has("tv")) (async () => {
      for (let i = 0; i < 160 && !(STOPS[want] && predAt); i++) await new Promise((r) => setTimeout(r, 250));   // up to 40 s on a slow phone connection
      if (STOPS[want]) showStop(want);
    })();
  }
  window.__stops = {
    show: showStop,
    ready: () => Object.keys(STOPS).length > 0 && predAt > 0,
    at: (sid) => STOPS[sid] && { name: STOPS[sid][2], lat: STOPS[sid][0], lon: STOPS[sid][1] },
    // every stop within r metres (both sides of the street, the far corner), for a station's board
    near(sid, r = 70) {
      const a = STOPS[sid]; if (!a) return [];
      return Object.entries(STOPS).filter(([, b]) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 88200) < r).map(([k]) => k);
    },
    // what's coming to a set of stops: one row per line and destination, its next three times
    board(sids) {
      const now = Date.now() + offset, rows = new Map();
      for (const sid of sids) for (const a of stopBoard.get(sid) || []) {
        if (a.t < now - 30e3) continue;
        const k = a.route + "|" + a.dest, l = rows.get(k) || rows.set(k, []).get(k);
        if (!l.some((x) => Math.abs(x.t - a.t) < 20e3 && x.veh === a.veh)) l.push(a);
      }
      return { updated: predAt, rows: [...rows.values()].map((l) => l.sort((a, b) => a.t - b.t)).sort((a, b) => a[0].t - b[0].t).map((l) => {
        const R = routes[l[0].route] || { name: l[0].route.split(":")[1], color: "#005B95" };
        return { name: R.name, color: R.color, ink: luminance(R.color) > 0.55 ? "#111" : "#fff", dest: shortDest(l[0].dest), mins: l.slice(0, 3).map((a) => Math.max(0, Math.round((a.t - now) / 60000))) };
      }) };
    },
    // stops by name for search: every word typed starts a word of the name ("church 18" finds Church St & 18th St)
    search(q) {
      const n = q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean); if (!n.length) return [];
      const out = [];
      for (const [sid, st] of Object.entries(STOPS)) {
        if (!stopBoard.has(sid)) continue;
        const words = st[2].toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ");
        if (!n.every((w) => words.some((x) => x.startsWith(w)))) continue;
        const a = stopBoard.get(sid).slice().sort((p, q) => p.t - q.t)[0], R = routes[a.route] || {};
        out.push({ id: sid, name: st[2], lat: st[0], lon: st[1], sub: `Muni stop · ${R.name || ""} to ${shortDest(a.dest)}` });
        if (out.length >= 6) break;
      }
      return out;
    },
  };
  function showCard(v, K) {
    selStop = null;
    selected = v;
    window.track?.(v.hist ? "boat: open" : "vehicle: open", v.hist ? { type: K.type || "boat", name: K.r?.name } : { route: K.r?.name, agency: (v.route || "").split(":")[0] });
    const R = K.r, badge = `<b class="badge" style="background:${R.color};color:${luminance(R.color) > 0.55 ? "#111" : "#fff"}">${esc(R.name)}</b>`;
    let html;
    if (v.hist) {   // a boat, from AIS
      const r = v.r, mmsi = v.id, size = r.L ? `${Math.round(r.L)} × ${Math.round(r.W || 0)} m` : "";
      html = `<h2>${esc(R.name)}</h2><p>${esc(R.long)}${r.cog != null && r.sog > 0.5 ? ` · heading ${Math.round(r.hdg ?? r.cog)}°` : r.sog <= 0.5 ? " · moored or at anchor" : ""}</p>
        ${v.dest ? `<p>Bound for <b>${esc(v.dest)}</b></p>` : ""}${size ? `<p>${size}</p>` : ""}
        <p class="meta">AIS position ${ago(r.t)}${(r.sog || 0) > 0.5 && Date.now() - r.t > 60e3 ? (v.ashore ? " · held at the shore since (its course runs onto land)" : " · carried forward along its course since") : ""} · MMSI ${esc(mmsi)}</p>
        <p><a href="https://www.vesselfinder.com/vessels/details/${encodeURIComponent(mmsi)}" target="_blank" rel="noopener">VesselFinder ↗</a> · <a href="https://www.myshiptracking.com/vessels/mmsi-${encodeURIComponent(mmsi)}" target="_blank" rel="noopener">MyShipTracking ↗</a></p>`;
    } else {        // Muni, from 511
      const rt = routes[v.route] || {}, kind = rt.agency === "CT" ? "Caltrain train" : rt.agency === "GG" ? "Golden Gate Transit bus" : rt.agency === "AC" ? "AC Transit bus" : rt.name === "F" ? "Historic streetcar" : TYPE[rt.type] || "Bus", num = v.tx ? v.head : String(v.id || "").split(":")[1];
      html = `<h2>${badge} ${esc(R.long || "")}</h2><p>${rt.agency === "SF" ? "Muni " : ""}${rt.agency === "SF" ? kind.toLowerCase() : kind}${v.dest ? ` to <b>${esc(v.dest)}</b>` : ""}</p>
        ${num ? `<p>${v.tx ? "Train" : "Vehicle"} ${esc(num)}</p>` : ""}${v.tx ? `<p>${v.delay > 0 ? `${v.delay} min late` : v.delay < 0 ? `${-v.delay} min early` : "On time"}${v.next ? ` · next: ${esc(v.next)}` : ""}</p>${v.gps ? `<p class="meta">Position corrected by its GPS fix from ${ago(v.gps.t)}</p>` : ""}` : `${nextStops(v)}<p class="meta">${v.live ? `Live: placed by 511.org's arrival predictions · last GPS fix ${ago(v.reports.at(-1).t)}` : `511.org position ${ago(v.reports.at(-1).t)} · shown 1½ min behind`}${v.sh ? " · its route is drawn on the map" : ""}</p>`}
        <p>${rt.agency === "CT" ? `<a href="https://www.caltrain.com/schedules" target="_blank" rel="noopener">Caltrain schedules ↗</a>` : rt.agency === "GG" ? `<a href="https://www.goldengate.org/bus/" target="_blank" rel="noopener">Golden Gate Transit ↗</a>` : rt.agency === "AC" ? `<a href="https://www.actransit.org/" target="_blank" rel="noopener">AC Transit ↗</a>` : `<a href="https://www.sfmta.com/routes/${slug(rt.name + " " + (rt.long || ""))}" target="_blank" rel="noopener">Route on SFMTA ↗</a>`}</p>`;
    }
    card.innerHTML = `<button class="x" aria-label="Close">×</button>${html}`;
    card.hidden = false;
    const prev = vehiclePreview(K);   // what it looks like, turning slowly under the title
    card.querySelector("h2").after(prev);
    if (v.hist) shipPhoto(v).then((ph) => {   // a photo of the real ship, when Wikimedia Commons has one
      if (!ph || selected !== v || card.hidden) return;
      prev.remove();   // the real thing beats the drawing
      const fig = document.createElement("figure");
      fig.className = "shipphoto";
      fig.innerHTML = `<img src="${ph.src}" alt="${esc(K.r.name)}"><figcaption>${ph.byName ? "A boat named " + esc(K.r.name) + ", matched by name · " : ""}Photo: <a href="${ph.page}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption>`;
      card.querySelector("h2").after(fig);
    });
    if (!v.hist && (routes[v.route] || {}).agency === "CT") ctBoard(v.tx ? v.head : String(v.id || "").split(":")[1]).then((h) => {   // live departures, from Trainiac
      if (!h || selected !== v || card.hidden) return;
      const d = document.createElement("div"); d.className = "ctboard"; d.innerHTML = h;
      card.querySelector("p.meta").before(d);
    });
    card.querySelector(".x").onclick = () => { card.hidden = true; selected = null; };
  }
  // Next Caltrain departures from San Francisco (4th & King), from traini.ac (built on 511.org), cached a minute
  // the next departures from San Francisco, from the same traini.ac stream (no request of its own)
  let ctCache = null;
  async function ctBoard(num) {
    try {
      {
        const now = Date.now(), rows = [];
        for (const x of tx.values()) {
          if (x.operator?.code !== "CT" || x.cancelled) continue;
          const c = (x.calls || []).find((k) => k.station.crs === "CT:SAN_FRANCISCO" && k.calls !== false && k.departs);
          const t = c && exp(c.departs); if (!(t > now - 60e3)) continue;
          rows.push({ t, train: { headcode: x.headcode }, destination: x.destination, departs: { scheduled: c.departs.scheduled, estimate: { at: c.departs.expected }, delay_minutes: Math.round((t - Date.parse(c.departs.scheduled)) / 60e3) } });
        }
        ctCache = { t: now, rows: rows.sort((a, b) => a.t - b.t).slice(0, 5) };
      }
      if (!ctCache.rows.length) return null;
      const hm = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
      const rows = ctCache.rows.map((r) => {
        const late = r.departs?.delay_minutes || 0, me = num && r.train?.headcode === num;
        return `<tr${me ? ' class="me"' : ""}><td>${hm(r.departs.estimate?.at || r.departs.scheduled)}</td><td>${esc(r.train?.headcode || "")}</td><td>${esc((r.destination?.name || "").replace(" Diridon", ""))}</td><td>${late > 0 ? `<span class="late">+${late}</span>` : "on time"}</td></tr>`;
      }).join("");
      return `<p class="ctttl">Next from 4th &amp; King</p><table>${rows}</table><p class="meta">Departures: <a href="https://traini.ac/?network=bay-area" target="_blank" rel="noopener">traini.ac</a> · data provided by 511.org</p>`;
    } catch { return null; }
  }
  // A photo of the real ship, from Wikimedia (free to reuse), most certain source first:
  //   1. Wikidata by IMO or MMSI number  2. the Commons category for its IMO number  3. a Commons search by name,
  //   accepted only when the file title names the boat and a Bay Area place (and labelled as a name match)
  const photos = new Map();
  const commons = (p) => fetch("https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({ ...p, format: "json", origin: "*" })).then((r) => r.json());
  const fileOut = (title, byName) => { const f = title.replace(/^File:/, ""); return { src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=640`, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f)}`, byName }; };
  const BAY = /san francisco|golden gate|bay|sausalito|larkspur|tiburon|oakland|alameda|vallejo|richmond|angel island|alcatraz|treasure island|pier \d|embarcadero|ferry building/i;
  function shipPhoto(b) {
    const key = b.id;
    if (photos.has(key)) return photos.get(key);
    const imo = b.r.imo && /^\d{7}$/.test(String(b.r.imo)) ? String(b.r.imo) : null, mmsi = /^\d{9}$/.test(String(b.id)) ? String(b.id) : null;
    const name = (b.r.name || "").trim();
    const pr = (async () => {
      try {
        if (imo || mmsi) {
          const q = `SELECT ?img WHERE { { ${imo ? `?s wdt:P458 "${imo}"` : "FILTER(false)"} } UNION { ${mmsi ? `?s wdt:P587 "${mmsi}"` : "FILTER(false)"} } ?s wdt:P18 ?img } LIMIT 1`;
          const j = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q)).then((r) => r.json());
          const img = j.results.bindings[0]?.img?.value;
          if (img) return fileOut(decodeURIComponent(img.split("/").pop()), false);
        }
        if (imo) {   // Commons files ships under "IMO 1234567" (directly, or via the ship's own category)
          const c = await commons({ action: "query", list: "categorymembers", cmtitle: `Category:IMO ${imo}`, cmtype: "file|subcat", cmlimit: "10" });
          const m = c.query?.categorymembers || [];
          const file = m.find((x) => x.ns === 6);
          if (file) return fileOut(file.title, false);
          const sub = m.find((x) => x.ns === 14);
          if (sub) { const c2 = await commons({ action: "query", list: "categorymembers", cmtitle: sub.title, cmtype: "file", cmlimit: "3" }); const f2 = c2.query?.categorymembers?.[0]; if (f2) return fileOut(f2.title, false); }
        }
        if (name.length >= 4 && !/^\d+$/.test(name)) {
          const r = await commons({ action: "query", list: "search", srnamespace: "6", srsearch: `"${name}" ${b.K?.type === "tug" ? "tug" : "ship OR ferry OR boat"}`, srlimit: "10" });
          const hit = (r.query?.search || []).find((x) => x.title.toLowerCase().includes(name.toLowerCase()) && BAY.test(x.title) && /\.(jpe?g|png|webp)$/i.test(x.title));
          if (hit) return fileOut(hit.title, true);
        }
      } catch {}
      return null;
    })();
    photos.set(key, pr);
    return pr;
  }
  // clicked from far out: fly in to it (a bus close enough to see its route sign, a ship or train to see it whole)
  function flyToVehicle(v, K, at) {
    const mi = window.mapItem, vp = viewer.viewport, now = mi.viewportToImageZoom(vp.getZoom(true)) / geo.mpp;
    // close in on a bus or train (it's followed from here on); a long train or ship needs room to show whole
    const want = v.hist ? (K.L > 60 ? 0.9 : 2) : K.L > 60 ? 1.6 : 4;
    // pan and zoom together onto where it is, so it lands in the middle instead of drifting in after a zoom on the old centre
    if (at) vp.panTo(vp.pointFromPixel(new OpenSeadragon.Point(at[0], at[1]), true));
    if (now < want * 0.85) vp.zoomTo(mi.imageToViewportZoom(want * geo.mpp));
    follow = { v, until: performance.now() + 1600 };   // the frame loop keeps it centred while the zoom runs
  }
  viewer.addHandler("canvas-drag", () => { follow = null; });   // the reader takes the map back
  viewer.addHandler("canvas-click", (e) => {
    if (!e.quick || window.__listEditing) return;
    if (window.__robotaxi?.picking) { window.__robotaxi.pick(e.position); e.preventDefaultAction = true; return; }   // choosing where a robotaxi goes
    const h = hits.slice().reverse().find((q) => Math.hypot(q.x - e.position.x, q.y - e.position.y) < q.r);
    if (h && h.stop) { showStop(h.stop); e.preventDefaultAction = true; }
    else if (h && h.plane) { showPlane(h.plane); e.preventDefaultAction = true; }
    else if (h && h.person) {
      selStop = null; selected = h.person; follow = null;
      card.innerHTML = `<button class="x" aria-label="Close">×</button>${window.__personCard(h.person)}`;
      card.hidden = false; card.querySelector(".x").onclick = () => { card.hidden = true; selected = null; };
      h.person.onOpen?.();
      window.track?.("person: open", { id: h.person.id }); e.preventDefaultAction = true;
    }
    else if (h && h.robo) { selStop = null; selected = h.v; window.__robotaxi.open(h.v); e.preventDefaultAction = true; flyToVehicle(h.v, h.K, [h.x, h.y]); }
    else if (h) { showCard(h.v, h.K); e.preventDefaultAction = true; flyToVehicle(h.v, h.K, [h.x, h.y]); }
    else if (selected || selStop) { selected = null; selStop = null; card.hidden = true; }
  });
  new MutationObserver(() => { if (card.hidden) { selected = null; selStop = null; } }).observe(card, { attributes: true, attributeFilter: ["hidden"] });

  // ---- hover card + status ----
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true;
  document.body.appendChild(tip);
  viewer.container.addEventListener("pointermove", (ev) => {
    const h = hits.slice().reverse().find((q) => Math.hypot(q.x - ev.clientX, q.y - ev.clientY) < q.r);
    if (!h) { tip.hidden = true; return; }
    if (h.person) { tip.innerHTML = `${esc(h.person.title)}<br><span>${esc(h.person.tip || "click to say hi")}</span>`; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px"; tip.hidden = false; return; }
    if (h.plane) { const r = h.plane.r; tip.innerHTML = `${esc(r.f || r.r || "Aircraft")}<br><span>${Math.round(r.alt / 100) * 100} ft · click for details</span>`; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px"; tip.hidden = false; return; }
    if (h.stop) { tip.innerHTML = `${esc(STOPS[h.stop]?.[2] || "Stop")}<br><span>click for arrivals</span>`; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px"; tip.hidden = false; return; }
    if (h.robo) { tip.innerHTML = `${esc(h.robo.brand)} · ${esc(h.robo.model)} (simulated)<br><span>click to track it</span>`; tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px"; tip.hidden = false; return; }
    const R = h.K.r;
    tip.innerHTML = `<b style="background:${R.color};color:${luminance(R.color) > 0.55 ? "#111" : "#fff"}">${R.name}</b> ${R.long || ""}${h.v.dest ? `<br><span>to ${h.v.dest}</span>` : ""}<br><span>click for details</span>`;
    tip.style.left = ev.clientX + 14 + "px"; tip.style.top = ev.clientY + 14 + "px"; tip.hidden = false;
  });
  const live = document.getElementById("live");
  setInterval(() => {
    if (!live || live.hidden) return;   // the interface's status line shows the counts now
    const n = Object.keys(fleet).length, bad = Object.values(status).some((s) => s.error);
    if (live) live.classList.toggle("off", !!window.__vehiclesOff);
    // the count is live buses, streetcars, cable cars and trains only (simulated street traffic isn't counted); boats
    // show a spinner until their first answer comes in
    const boatsTxt = window.__boatCount == null ? ` · boats <span class="ld" aria-label="loading"></span>` : window.__boatCount ? ` · ${window.__boatCount} boats` : "";
    const html = window.__vehiclesOff ? "Vehicles hidden" : bad ? "Transit feed hiccup, retrying" : `Live · ${n} buses &amp; trains${boatsTxt} · 1½ min behind${window.__carsOff ? " · cars hidden" : ""}`;
    if (live && live._html !== html) live.innerHTML = live._html = html;
  }, 1000);
})();
