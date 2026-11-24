// Ambient traffic: made-up cars driving the real street network (OpenStreetMap).
// Streets are cut into blocks at every intersection. Intersections are controlled like San Francisco's:
// real traffic signals where OSM has them, all-way stops on quiet corners, and side streets yielding to
// major ones. Cars keep right, follow the car ahead (even across a corner), slow down for turns, wait for
// the intersection to clear, and fade in and out instead of popping. Drawn by transit.js every frame.
(async function () {
  const roadsP = fetch("roads.json?v=" + (window.__cv || "")).then((r) => r.json());   // the street network loads alongside transit.js's own data, not after it
  while (!window.__transit) await new Promise((r) => setTimeout(r, 100));
  const { G, toImage, geo } = window.__transit;
  const roads = await roadsP;
  const hash = (n) => { let h = n | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---- network ----
  const SPEED = { motorway: 25, trunk: 16, primary: 12, secondary: 11, tertiary: 10, unclassified: 8, residential: 8 };  // m/s
  const RANK = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 0 };
  const DENSITY = { motorway: 0.008, trunk: 0.006, primary: 0.005, secondary: 0.004, tertiary: 0.003, unclassified: 0.0015, residential: 0.0012 };  // cars per m per lane, rush hour (kept light: the drawing already has lots of painted cars)
  const world = new Map();
  // Each street point's real height, found from the depth map (the surface you actually see): try heights along the
  // vertical line through the point and keep the lowest one where the visible surface really is at that spot on the
  // ground. At this 45° view a wrong height moves a car sideways on screen (onto kerbs, rooftops, parks), and
  // elevated freeways sit 10-25 m up. Points hidden under trees or behind buildings keep the street-height estimate.
  const grids = window.__grids, dg = geo.depthGrid, M = geo.worldToCamera;
  const RT = [[M[0], M[1], M[2]], [M[4], M[5], M[6]], [M[8], M[9], M[10]]], TT = [M[12], M[13], M[14]];
  function surfaceAt(x, y, z) {   // the visible surface point in the depth cell where (x, y, z) lands on screen
    const q = toImage([x, y, z]), cx_ = Math.floor(q[0] / dg.scale), cy_ = Math.floor(q[1] / dg.scale);
    if (cx_ < 0 || cy_ < 0 || cx_ >= dg.w || cy_ >= dg.h) return null;
    const d = grids.dm(cy_ * dg.w + cx_), cx = geo.x0 + (cx_ + 0.5) * dg.scale * geo.mpp, cy = geo.y1 - (cy_ + 0.5) * dg.scale * geo.mpp;
    const v = [cx - TT[0], cy - TT[1], -d - TT[2]];
    return [RT[0][0] * v[0] + RT[0][1] * v[1] + RT[0][2] * v[2], RT[1][0] * v[0] + RT[1][1] * v[1] + RT[1][2] * v[2], RT[2][0] * v[0] + RT[2][1] * v[1] + RT[2][2] * v[2]];
  }
  // The Bay Bridge's west span beyond the drawn map: deck ~52 m at the SF anchorage climbing to ~74 m over the bay (tuned against the 3D render)
  function bayBridge(w) {
    if (!w.ll) return null;
    const [la, lo] = w.ll;
    if (!(lo > -122.3905 && lo < -122.36 && la > 37.786 && la < 37.815)) return null;   // the west span, SF anchorage to Yerba Buena
    const d = Math.hypot((la - 37.7885) * 111320, (lo + 122.3915) * 88000);
    return 61 + 22 * Math.min(1, d / 700);
  }
  function snap(w, elevated) {
    if (!grids || !dg) return;
    // scan up from near sea level (the street-height estimate can be tens of metres high where rooftops fill a block)
    const base = w[1];
    let best = null;
    if (elevated) {   // bridges and flyovers: the highest surface we see right here is the deck (the water or street below is visible too)
      const bb = bayBridge(w);
      if (bb != null) { w[1] = bb; return; }   // both directions on the visible top deck
      const deck = G.heightAt(w[0], w[2]);
      for (let y = Math.max(base, deck ?? 0, 0) + 75; y >= -8; y -= 0.75) {
        const S = surfaceAt(w[0], y, w[2]);
        if (!S) break;
        if (Math.hypot(S[0] - w[0], S[2] - w[2]) < 2.2 && Math.abs(S[1] - y) < 2.5) { best = S[1]; break; }
      }
      if (best == null && deck != null && deck > base + 4) best = deck;
      if (best == null && bayBridge(w)) best = bayBridge(w) - (w.layer === 1 ? 11 : 0);   // no surface data out here: the real deck profile
      if (best != null) w[1] = best;
      return;
    }
    const top = Math.max(base, 0) + 8;
    const floor = Math.max(-8, Math.min(base, 0) - 3);   // not far under the street (holes in the 3D model at Steuart St)
    for (let y = floor; y <= top; y += 0.75) {
      const S = surfaceAt(w[0], y, w[2]);
      if (!S) return;
      const err = Math.hypot(S[0] - w[0], S[2] - w[2]);
      if (err < 2.2 && Math.abs(S[1] - y) < 2.5) { best = Math.max(S[1], floor); break; }   // the lowest height where we see this very spot
    }
    if (best != null) w[1] = best;
  }
  const pos = (id, bridge, layer = 0) => {
    const k = id + (bridge ? "b" + layer : "");
    if (!world.has(k)) {
      const [la, lo] = roads.nodes[id], w = G.toWorld(la, lo); w.layer = layer; w.ll = [la, lo];
      snap(w, bridge);
      world.set(k, w);
    }
    return world.get(k);
  };
  // a node is an intersection when more than one way uses it (or a way ends there)
  const uses = new Map();
  for (const w of roads.ways) w.nodes.forEach((n, i) => uses.set(n, (uses.get(n) || 0) + (i === 0 || i === w.nodes.length - 1 ? 1 : 2)));
  const cut = (n) => (uses.get(n) || 0) > 2;
  const paths = [], J = new Map();
  const junction = (n) => { if (!J.has(n)) J.set(n, { n, arms: new Set(), ins: [], outs: [], ctrl: null, maxRank: 0, ref: null, box: [] }); return J.get(n); };
  let segId = 0;
  for (const w of roads.ways) {
    // split the way into blocks between intersections
    const blocks = [];
    let cur = [w.nodes[0]];
    for (let i = 1; i < w.nodes.length; i++) { cur.push(w.nodes[i]); if (i < w.nodes.length - 1 && cut(w.nodes[i])) { blocks.push(cur); cur = [w.nodes[i]]; } }
    blocks.push(cur);
    const lanes = Math.max(1, w.oneway ? w.lanes : Math.floor(w.lanes / 2));
    for (const b of blocks) {
      const seg = ++segId;
      for (const ns of w.oneway ? [b] : [b, b.slice().reverse()]) {
        // raised: bridges and flyovers only. A motorway ramp at street level (the loop at 13th & Mission) scanned from
        // above lands on whatever is highest there, the trees beside it, and cars rode the canopy
        const raised = w.bridge || w.layer > 0;
        const pts = ns.map((n) => pos(n, raised, w.layer)), s = [0];
        for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
        if (s.at(-1) < 2) continue;
        // how much of this street you can actually see from this camera: alleys squeezed between buildings mostly can't be
        let vis = 0, tot = 0, roof = 0;
        const elev = raised;
        if (grids && dg && !elev) for (let d = 2; d < s.at(-1); d += 4) {
          let i = 1; while (i < s.length - 1 && s[i] < d) i++;
          const a = pts[i - 1], b = pts[i], f = (d - s[i - 1]) / (s[i] - s[i - 1] || 1), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
          const S = surfaceAt(x, y, z); if (!S) continue;   // outside the surface data: don't judge
          tot++;
          if (Math.hypot(S[0] - x, S[2] - z) < 4 && Math.abs(S[1] - y) < 4) vis++;
          const g = G.ground(x, z);
          if (g != null && y - g > 3) roof++;   // its height snapped onto a low roof: the street itself is hidden there
        }
        const seenFrac = tot ? vis / tot : 1;   // every block is judged, however short (alleys come in short pieces)
        const minor = /^(residential|unclassified|service|living_street)$/.test(w.hw);
        const p = { i: paths.length, seg, name: w.name || "", seenFrac, ok: elev || (roof <= tot * 0.15 && (!minor || seenFrac >= 0.4)), elev, hw: w.hw, rank: RANK[w.hw] ?? 0, lanes, oneway: w.oneway, pts, s, len: s.at(-1), from: ns[0], to: ns.at(-1), cars: [] };
        // the Bay Bridge's lower deck (eastbound, out of the city) can't be seen from above: its cars don't drive on the top deck
        if (raised && w.layer === 1 && pts.some((q) => bayBridge(q) != null)) p.ok = false;
        const a = pts.at(-2), z = pts.at(-1), L1 = Math.hypot(z[0] - a[0], z[2] - a[2]) || 1, c = pts[1], o = pts[0], L0 = Math.hypot(c[0] - o[0], c[2] - o[2]) || 1;
        p.endDir = [(z[0] - a[0]) / L1, (z[2] - a[2]) / L1];
        p.startDir = [(c[0] - o[0]) / L0, (c[2] - o[2]) / L0];
        paths.push(p);
        const jt = junction(p.to), jf = junction(p.from);
        jt.ins.push(p); jf.outs.push(p);
        jt.arms.add(seg); jf.arms.add(seg);
        jt.maxRank = Math.max(jt.maxRank, p.rank); jf.maxRank = Math.max(jf.maxRank, p.rank);
      }
    }
  }
  // which intersections have real signals: any OSM signal within ~22 m
  const sig = (roads.signals || []).filter((id) => roads.nodes[id]).map((id) => G.toWorld(...roads.nodes[id]));
  const cell = (x, z) => Math.floor(x / 40) + "," + Math.floor(z / 40);
  const sigGrid = new Map();
  for (const w of sig) { const k = cell(w[0], w[2]); if (!sigGrid.has(k)) sigGrid.set(k, []); sigGrid.get(k).push(w); }
  const nearSignal = (w) => { const cx = Math.floor(w[0] / 40), cz = Math.floor(w[2] / 40); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of sigGrid.get(cx + i + "," + (cz + j)) || []) if (Math.hypot(q[0] - w[0], q[2] - w[2]) < 22) return true; return false; };
  for (const j of J.values()) {
    if (j.arms.size < 3) continue;
    const w = pos(j.n, false);
    j.ctrl = nearSignal(w) ? "signal" : j.maxRank >= 3 ? "priority" : "stop";
    const d = j.ins[0]?.endDir || j.outs[0]?.startDir;
    j.ref = d ? Math.atan2(d[1], d[0]) : 0;
    j.offset = hash(j.n) * 60;
    // where each approach stops: behind the crosswalk, i.e. half the widest crossing street + ~4 m of crosswalk
    for (const p of j.ins) {
      let half = 0;
      for (const o of [...j.ins, ...j.outs]) if (o.seg !== p.seg) half = Math.max(half, (o.oneway ? o.lanes : o.lanes * 2) * 2.7 / 2);
      p.stopAt = clamp(half + 4, 7, 16);
    }
  }
  const axisOf = (j, d) => { const a = Math.abs((((Math.atan2(d[1], d[0]) - j.ref) % Math.PI) + Math.PI) % Math.PI); return a > Math.PI / 4 && a < (3 * Math.PI) / 4 ? 1 : 0; };

  function at(p, s, lane) {
    let i = 1;
    while (i < p.s.length - 1 && p.s[i] < s) i++;
    const a = p.pts[i - 1], b = p.pts[i], L = p.s[i] - p.s[i - 1] || 1, f = clamp((s - p.s[i - 1]) / L, 0, 1);
    const dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
    const off = p.oneway ? (lane - (p.lanes - 1) / 2) * 2.7 : (lane + 0.45) * 2.6;   // keep right, close to the line (OSM centrelines can sit a metre or two off)
    return { w: [a[0] + (b[0] - a[0]) * f - dz * off, a[1] + (b[1] - a[1]) * f + 0.05, a[2] + (b[2] - a[2]) * f + dx * off], dir: [dx, dz] };
  }

  // ---- signals: 64 s cycle, two directions, amber, short all-red ----
  const CYCLE = 64;
  function light(j, axis, t) {
    const ph = ((t + j.offset) % CYCLE) / CYCLE, g0 = axis === 0 ? 0 : 0.5;
    const x = (ph - g0 + 1) % 1;
    return x < 0.42 ? "green" : x < 0.47 ? "amber" : "red";
  }

  // ---- how busy: by hour, with a morning and evening peak ----
  // ?time=2026-11-19T08:30 runs the traffic on that clock (as atmosphere.js does the light), for testing
  const CLOCK = (() => { const t = new URLSearchParams(location.search).get("time"); const ms = t ? new Date(t).getTime() : NaN; return Number.isFinite(ms) ? ms - Date.now() : 0; })();
  function busy(d = new Date(Date.now() + CLOCK)) {
    const h = d.getHours() + d.getMinutes() / 60;
    const bump = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
    // the small hours are quiet but never empty (a fifth of rush hour: the city's night owls, delivery vans, and a lot of robotaxis)
    return Math.min(1, 0.2 + 0.5 * bump(8.3, 1.4) + 0.55 * bump(17.5, 1.8) + 0.35 * bump(13, 3.5) + 0.1 * bump(21, 2));
  }

  // ---- cars ----
  const COLORS = ["#f4f2ec", "#f4f2ec", "#1f2328", "#1f2328", "#8f969c", "#b8bec4", "#7a1f24", "#1f3f6b", "#e7e1d1", "#33503c", "#c94a2a"];
  const cars = [];
  let serial = 0;
  // cars are a few rounded blocks: dark wheels, the body, a glass cabin that narrows to the roof (vans and trucks have their own)
  const GLASS = "#33414d", TYRE = "#1d1f22";
  const lift = (hex, k) => { const n = parseInt(hex.slice(1), 16), f = (x) => Math.min(255, Math.round(x * k + 18)).toString(16).padStart(2, "0"); return "#" + f(n >> 16) + f((n >> 8) & 255) + f(n & 255); };
  const wheels = { a0: -0.4, a1: 0.4, w: 0.94, h0: 0, h1: 0.34, side: TYRE, roof: TYRE, noInk: true };
  // Robotaxis, roughly in proportion to San Francisco's fleets (about 7% of the cars here): Waymo's Jaguar I-Paces (most of
  // them) and its Zeekr-built Ojai vans, Zoox's symmetric carriages and Tesla's Cybercab. Same blocks as the cars; a block's
  // o shifts it sideways (a share of the half-width), for the sensor pods on the corners.
  const ROBO = {
    ipace: { kind: "waymo-ipace", brand: "Waymo", model: "Jaguar I-Pace", col: "#0fa197" },
    ojai: { kind: "waymo-ojai", brand: "Waymo", model: "Ojai", col: "#0fa197" },
    zoox: { kind: "zoox", brand: "Zoox", model: "robotaxi", col: "#2f6fd6" },
    cyber: { kind: "tesla-cybercab", brand: "Tesla", model: "Cybercab", col: "#d8323c" },
  };
  const WHITE = "#f6f5f1", SENSOR = "#25292e";
  const TRIM = "#2b2e33";
  // Waymo's roof sensor: a white base, a tall dark lidar drum, and a pale cap, on the middle of the roof (t: drum height)
  const dome = (a, h, t = 0.3) => [
    { a0: a - 0.11, a1: a + 0.11, w: 0.44, h0: h, h1: h + 0.08, ch: 0.3, side: "#e9e8e3", roof: "#f1f0eb" },
    { a0: a - 0.08, a1: a + 0.08, w: 0.35, h0: h + 0.08, h1: h + 0.08 + t, ch: 0.24, side: SENSOR, roof: SENSOR },
    { a0: a - 0.07, a1: a + 0.07, w: 0.31, h0: h + 0.08 + t, h1: h + 0.16 + t, ch: 0.21, side: "#d5d9dc", roof: "#eceeef" }];
  const pods = (a0, a1, h0, h1, o, w) => [-1, 1].map((sd) => ({ a0, a1, w, o: sd * o, h0, h1, ch: 0.04, side: SENSOR, roof: SENSOR }));
  const nose = (a0, a1, h0, h1) => ({ a0, a1, w: 0.3, h0, h1, ch: 0.05, side: SENSOR, roof: SENSOR, noInk: true });   // the bumper's own sensor
  function robotaxi(r) {
    // Waymo's Jaguar I-Pace: a low crossover (front is +a), black trim along the sills, a short hood and a cabin that tapers
    // fore and aft, the tall roof dome, perimeter sensors on the front fenders and rear corners, and one in the front bumper
    if (r < 0.9636) return { L: 4.7, Wd: 1.95, Hh: 1.9, side: WHITE, roof: WHITE, robo: ROBO.ipace, parts: [wheels,
      nose(0.49, 0.515, 0.42, 0.6),   // drawn before the body, so the body hides it when it faces away
      { a0: -0.5, a1: 0.5, h0: 0.28, h1: 0.42, ch: 0.45, side: TRIM, roof: TRIM },
      { a0: -0.5, a1: 0.5, w: 0.99, h0: 0.42, h1: 0.88, ch: 0.45, ti: 0.06, tw: 0.05, side: WHITE, roof: WHITE },
      { a0: -0.4, a1: 0.22, w: 0.9, h0: 0.88, h1: 1.46, ch: 0.3, ti: 0.24, tw: 0.15, side: GLASS, roof: "#ecebe6" },
      ...pods(0.22, 0.29, 0.82, 1.04, 0.86, 0.1), ...pods(-0.47, -0.41, 0.86, 1.0, 0.82, 0.09), ...dome(-0.08, 1.46)] };
    // Waymo's Zeekr-built Ojai: tall and boxy, black cladding low down, a big raked windshield, a sensor brow across the front
    // of the roof, a shorter dome, perimeter sensors by the windshield and in the front bumper
    const OJ = "#b7cbd8", OJR = "#c6d7e2";   // the Ojai comes in a pale powder blue, not white
    if (r < 0.9748) return { L: 4.85, Wd: 2.0, Hh: 2.25, side: OJ, roof: OJ, robo: ROBO.ojai, parts: [wheels,
      nose(0.49, 0.515, 0.48, 0.66),
      { a0: -0.5, a1: 0.5, h0: 0.28, h1: 0.46, ch: 0.4, side: TRIM, roof: TRIM },
      { a0: -0.5, a1: 0.5, w: 0.99, h0: 0.46, h1: 1.02, ch: 0.42, side: OJ, roof: OJ },
      { a0: -0.48, a1: 0.42, w: 0.96, h0: 1.02, h1: 1.78, ch: 0.34, ti: 0.05, tw: 0.05, side: GLASS, roof: OJ },
      { a0: -0.485, a1: 0.37, w: 0.97, h0: 1.78, h1: 1.9, ch: 0.32, side: OJ, roof: OJR },
      { a0: 0.26, a1: 0.33, w: 0.74, h0: 1.9, h1: 1.98, ch: 0.1, side: SENSOR, roof: SENSOR },
      ...pods(0.4, 0.46, 1.0, 1.22, 0.86, 0.1), ...dome(-0.06, 1.9, 0.22)] };
    const Z = "#c3d9c6", ZD = "#2c2f34";   // the production Zoox comes in a solid pale green Zoox calls Aloe
    const stalks = (a0, a1) => [...pods(a0, a1, 1.8, 2.0, 0.84, 0.09), ...pods(a0 - 0.012, a1 + 0.012, 1.96, 2.08, 0.84, 0.14)];
    if (r < 0.9846) return { L: 3.65, Wd: 1.95, Hh: 2.1, side: Z, roof: Z, robo: ROBO.zoox, parts: [{ ...wheels, a0: -0.46, a1: 0.46 },
      { a0: -0.5, a1: 0.5, h0: 0.26, h1: 0.52, ch: 0.5, side: ZD, roof: ZD },
      { a0: -0.49, a1: 0.49, w: 0.98, h0: 0.52, h1: 0.9, ch: 0.52, side: Z, roof: Z },
      { a0: -0.5, a1: 0.5, h0: 0.9, h1: 1.66, ch: 0.62, ti: 0.02, tw: 0.02, side: GLASS, roof: Z },
      { a0: -0.49, a1: 0.49, w: 0.97, h0: 1.66, h1: 1.84, ch: 0.6, ti: 0.04, tw: 0.04, side: Z, roof: "#d3e5d5" },
      ...stalks(-0.47, -0.435), ...stalks(0.435, 0.47)] };
    // Tesla Cybercab: a low two-seater in polished gold, a raked windshield into a long fastback with no rear window,
    // a full-width light bar across the front and a red one across the back
    const C = "#d4a94c", CR = "#f0d58c";   // polished gold, the roof catching the light
    return { L: 4.25, Wd: 1.95, Hh: 1.2, side: C, roof: C, robo: ROBO.cyber, parts: [wheels,
      { a0: 0.49, a1: 0.507, w: 0.8, h0: 0.52, h1: 0.59, ch: 0.08, side: "#fffaf0", roof: "#fffaf0", noInk: true },   // light bars, drawn under the body
      { a0: -0.507, a1: -0.49, w: 0.8, h0: 0.53, h1: 0.6, ch: 0.08, side: "#d8323c", roof: "#d8323c", noInk: true },
      { a0: -0.5, a1: 0.5, h0: 0.28, h1: 0.66, ch: 0.62, ti: 0.06, tw: 0.05, side: C, roof: C },
      { a0: -0.4, a1: 0.3, w: 0.86, h0: 0.66, h1: 1.17, ch: 0.42, ti: 0.26, tw: 0.16, side: GLASS, roof: CR },   // one long cabin, glass at the sides
      { a0: -0.49, a1: -0.18, w: 0.88, h0: 0.66, h1: 0.92, ch: 0.45, ti: 0.22, tw: 0.04, side: C, roof: C },   // the fastback tail, no rear window
      { a0: -0.24, a1: 0.14, w: 0.16, o: -0.18, h0: 1.17, h1: 1.18, ch: 0.08, side: "#fff4cc", roof: "#fffaea", noInk: true }] };   // a glint along the roof
  }
  function spec(r) {
    if (r >= 0.93) return robotaxi(r);
    if (r < 0.06) return { L: 5.3, Wd: 2.0, Hh: 2.3, side: "#f4f2ec", roof: "#e9e6dd", parts: [                       // van
      wheels, { a0: -0.5, a1: 0.5, h0: 0.3, h1: 1.2, ch: 0.35, side: "#f4f2ec", roof: "#f4f2ec" },
      { a0: -0.5, a1: 0.42, h0: 1.2, h1: 2.3, ch: 0.3, ti: 0.12, tw: 0.08, side: "#f4f2ec", roof: "#ebe7dc" },
      { a0: 0.3, a1: 0.47, w: 0.94, h0: 1.2, h1: 2.05, ti: 0.12, side: GLASS, roof: "#ebe7dc", noInk: true }] };
    if (r < 0.09) return { L: 8.2, Wd: 2.4, Hh: 3.4, side: "#e7e3da", roof: "#d6d1c6", parts: [                        // box truck
      wheels, { a0: 0.2, a1: 0.5, h0: 0.35, h1: 1.5, ch: 0.3, side: "#f4f2ec", roof: "#f4f2ec" },
      { a0: 0.2, a1: 0.47, w: 0.96, h0: 1.5, h1: 2.4, ti: 0.15, tw: 0.08, side: GLASS, roof: "#f4f2ec" },
      { a0: -0.5, a1: 0.18, h0: 0.45, h1: 3.4, ch: 0.1, side: "#e7e3da", roof: "#d6d1c6" }] };
    const taxi = r < 0.13, c = taxi ? "#f2c230" : COLORS[Math.floor(hash(r * 1e6) * COLORS.length)];
    const parts = [wheels,
      { a0: -0.5, a1: 0.5, h0: 0.3, h1: 0.82, ch: 0.42, ti: 0.04, tw: 0.04, side: c, roof: c },
      { a0: -0.28, a1: 0.2, w: 0.92, h0: 0.82, h1: 1.42, ch: 0.25, ti: 0.16, tw: 0.13, side: GLASS, roof: lift(c, 0.92) }];
    if (taxi) parts.push({ a0: -0.06, a1: 0.04, w: 0.4, h0: 1.42, h1: 1.6, side: "#f6f0d8", roof: "#f6f0d8" });
    return { L: 4.5, Wd: 1.85, Hh: 1.45, side: c, roof: c, parts };
  }
  function next(p, car) {
    if (car?.route) {   // a robotaxi sent somewhere: the next block of its route
      const i = car.route.indexOf(p, car.ri || 0);
      if (i >= 0) car.ri = i;
      else { car.route = null; car.dest = null; car.msg = "Lost its way. Pick the destination again."; }   // off its route (shouldn't happen)
      if (i >= 0 && i + 1 < car.route.length) return car.route[i + 1];
    }
    let outs = (J.get(p.to)?.outs || []).filter((q) => q.seg !== p.seg && q.ok);   // no U-turns, no hidden alleys
    if (!outs.length && car && kept(car)) outs = (J.get(p.to)?.outs || []).filter((q) => q.ok);   // the tracked car turns round at a dead end
    if (!outs.length) return null;
    const [ex, ez] = p.endDir;
    // prefer carrying on straight, sometimes turn; stay on the bigger street a bit more often
    const scored = outs.map((q) => { const [sx, sz] = q.startDir; return { q, w: Math.max(0.04, ex * sx + ez * sz + 0.35) ** 2 * (q.hw === p.hw ? 1.6 : 1) * (q.rank >= p.rank ? 1.2 : 1) }; });
    let r = Math.random() * scored.reduce((a, o) => a + o.w, 0);
    for (const o of scored) if ((r -= o.w) <= 0) return o.q;
    return scored.at(-1).q;
  }
  function add(p, s, fadeIn) {
    // robotaxis run around the clock while people mostly don't: ~7% of cars at rush hour, up to ~45% in the small hours
    const rb = Math.min(0.45, 0.07 + Math.max(0, 0.5 - busy()) * 0.9);
    let r = Math.random();
    if (r < rb) r = 0.93 + (r / rb) * 0.07; else if (r >= 0.93) r = (r - 0.93) / 0.07 * 0.93;   // map the draw onto spec()'s robotaxi band, or out of it
    const K = { ...spec(r), band: null, r: null };
    const car = { id: ++serial, p, lane: Math.floor(Math.random() * p.lanes), s, v: 0, vmax: SPEED[p.hw] * (0.82 + Math.random() * 0.3), temper: 0.8 + Math.random() * 0.4,
      K, a: fadeIn ? 0 : 1, dying: false, off: [0, 0], hd: null, next: null, go: false, stopped: 0, wait: 0, box: null, onScreen: false };
    if (K.robo) { car.vmax *= 0.93; car.temper = 0.75; }   // robotaxis: a touch slower, gentler off the line
    car.next = next(p);
    car.v = fadeIn ? car.vmax * 0.6 : 0;
    p.cars.push(car); cars.push(car);
    return car;
  }
  function drop(car) {
    car.p.cars.splice(car.p.cars.indexOf(car), 1);
    cars.splice(cars.indexOf(car), 1);
    leaveBox(car);
  }
  function leaveBox(car) { if (car.box) { const b = car.box.box, i = b.indexOf(car); if (i >= 0) b.splice(i, 1); car.box = null; } }

  // may this car enter the intersection at the end of its block now?
  function mayGo(car, t, distLine) {
    const p = car.p, j = J.get(p.to);
    if (!j || !j.ctrl || p.len < 14) return true;                     // plain bend, or a tiny link inside a big junction
    // a live bus or train in the middle of the junction (crossing it, or turning): wait for it to clear rather than drive
    // through it. Its whole length counts, so a long LRV half across still blocks.
    const spots = window.__transitSpots;
    if (spots && spots.length && p.pts.length) {
      const c = p.pts[p.pts.length - 1];
      for (const sp of spots) {
        const dx = sp.w[0] - c[0], dz = sp.w[2] - c[2], h = (sp.L || 12) / 2;
        if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
        const along = dx * sp.dir[0] + dz * sp.dir[1], across = Math.abs(-dx * sp.dir[1] + dz * sp.dir[0]);
        if (across < 6 && Math.abs(along) < h + 4) return false;   // actually over the junction, not waiting at a near-side stop
      }
    }
    if (j.ctrl !== "signal" && car.wait > 12) return true;           // never stuck forever at a stop sign (but never runs a red)
    const axis = axisOf(j, p.endDir);
    const othersIn = j.box.filter((o) => o !== car);
    if (j.ctrl === "signal") {
      const l = light(j, axis, t);
      if (l === "red") return false;
      if (l === "amber" && distLine > (car.v * car.v) / (2 * 4) + 1) return false;  // stop if it can comfortably
      if (l === "amber" && car.K.robo && distLine > (car.v * car.v) / (2 * 5.5)) return false;   // a robotaxi stops whenever it can
      return othersIn.every((o) => axisOf(j, o.fromDir) === axis);                 // crossing traffic still clearing
    }
    const major = j.ctrl === "priority" && p.rank >= 3;
    if (!major && car.stopped < 0.9) return false;                                // full stop at the line first
    if (major) return othersIn.every((o) => o.fromRank >= 3 || o.fromP === p);
    // all-way stop / side street: wait for the box to clear of other approaches
    if (othersIn.some((o) => o.fromP !== p)) return false;
    if (j.ctrl === "priority") {                                                  // side street: also wait for a gap in the main road
      for (const q of j.ins) if (q.rank >= 3) for (const o of q.cars) if (o.s > q.len - 30 && o.v > 2) return false;
    }
    return true;
  }

  const viewer = window.viewer;
  let live = [], liveSet = new Set();
  for (const p of paths) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of p.pts) { const q = toImage(w); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    p.box = [x0, y0, x1, y1];
  }
  let view = null;   // the screen, in image pixels (for keeping new cars out of sight)
  function updateLive() {
    const item = window.mapItem;
    if (!item || document.hidden) { live = []; liveSet = new Set(); return; }
    const z = item.viewportToImageZoom(viewer.viewport.getZoom(true));
    if (z / geo.mpp < 0.25) { live = []; liveSet = new Set(); return; }   // zoomed out too far to see a car
    const el = viewer.container, a = item.viewerElementToImageCoordinates(new OpenSeadragon.Point(0, 0)), b = item.viewerElementToImageCoordinates(new OpenSeadragon.Point(el.clientWidth, el.clientHeight));
    const mx = (b.x - a.x) * 0.22, my = (b.y - a.y) * 0.22;   // a margin past the screen, so cars are already driving when they come into view
    live = paths.filter((p) => p.ok && p.box[2] > a.x - mx && p.box[0] < b.x + mx && p.box[3] > a.y - my && p.box[1] < b.y + my);
    view = [a.x, a.y, b.x, b.y];
    liveSet = new Set(live);
  }
  setInterval(updateLive, 400);
  updateLive();
  const DENS = Math.max(0.2, Math.min(10, +new URLSearchParams(location.search).get("traffic") || 1));   // ?traffic=3: busier, for recording
  // how many cars this device can comfortably draw: frames are timed as they run, and if they run slow (under ~48 fps)
  // the traffic thins, a little at a time, down to a third; with headroom again it fills back up. Phones start lighter.
  let QUAL = window.__mobile ? 0.6 : 1, frameMs = 16.7, lastFrame = 0;
  (function watch(t) {
    if (lastFrame && !document.hidden) { const d = Math.min(100, t - lastFrame); frameMs += (d - frameMs) * 0.05; }
    lastFrame = t; requestAnimationFrame(watch);
  })(performance.now());
  const warm = performance.now() + 8000;   // the first seconds are slow on any machine (tiles decoding, everything starting up): don't judge the device by them
  setInterval(() => {
    if (document.hidden || !live.length || performance.now() < warm) return;
    if (frameMs > 21 && (window.__drawMs ?? 99) > 7) QUAL = Math.max(0.35, QUAL * 0.9); else if (frameMs < 18.5 || (window.__drawMs ?? 99) < 5) QUAL = Math.min(1, QUAL * 1.1);   // (18.5: a 60 Hz screen keeping up counts as headroom; slow frames that aren't our drawing (tiles, the browser) don't count)
  }, 1000);
  const target = () => Math.round(live.reduce((a, p) => a + p.len * p.lanes * DENSITY[p.hw], 0) * busy() * DENS * QUAL);

  // live buses and trains (transit.js publishes where each is drawn) as obstacles on the blocks they sit on: for each, the
  // spot along the block and the lanes it covers, so a car behind one waits instead of driving through it
  function transitObstacles() {
    const spots = window.__transitSpots; for (const p of live) p.obs = null;
    if (!spots || !spots.length) return;
    for (const sp of spots) {
      const q = toImage(sp.w);
      for (const p of live) {
        const b = p.box; if (q[0] < b[0] - 140 || q[0] > b[2] + 140 || q[1] < b[1] - 140 || q[1] > b[3] + 140) continue;
        let best = null;
        for (let i = 1; i < p.pts.length; i++) {
          const a = p.pts[i - 1], c = p.pts[i], L = p.s[i] - p.s[i - 1] || 1, dx = (c[0] - a[0]) / L, dz = (c[2] - a[2]) / L;
          const f = clamp(((sp.w[0] - a[0]) * dx + (sp.w[2] - a[2]) * dz) / L, 0, 1), along = f * L;
          const px = a[0] + dx * along, pz = a[2] + dz * along, lat = (sp.w[0] - px) * -dz + (sp.w[2] - pz) * dx;
          const d = Math.hypot(sp.w[0] - px, sp.w[2] - pz), dot = sp.dir ? sp.dir[0] * dx + sp.dir[1] * dz : 1;
          if (d < 9 && (!best || d < best.d)) best = { d, s: p.s[i - 1] + along, lat, dot };
        }
        if (!best) continue;
        // transit shapes sit a few metres off OpenStreetMap's centrelines, so match loosely: going the same way, it
        // takes the lane nearest it; standing across the road (turning, or crossing in the junction), every lane
        const offs = []; for (let lane = 0; lane < p.lanes; lane++) offs.push(p.oneway ? (lane - (p.lanes - 1) / 2) * 2.7 : (lane + 0.45) * 2.6);
        let lanes = [];
        if (Math.abs(best.dot) < 0.55) { if (best.d < 6) lanes = offs.map((_, i) => i); }
        else if (best.dot > 0) { let li = 0; offs.forEach((o, i) => { if (Math.abs(best.lat - o) < Math.abs(best.lat - offs[li])) li = i; }); if (Math.abs(best.lat - offs[li]) < 4.5) lanes = [li]; }
        for (const lane of lanes) (p.obs || (p.obs = [])).push({ s: best.s, lane, L: Math.abs(best.dot) < 0.55 ? 3.5 : sp.L });
      }
    }
  }
  setInterval(transitObstacles, 200);

  function step(dt, t) {
    for (const p of live) if (p.cars.length > 1) p.cars.sort((a, b) => a.s - b.s);
    for (const car of cars.slice()) {
      const p = car.p, q = car.next;
      // the car ahead in this lane, on this block or just around the corner
      let gap = Infinity, vLead = 0;
      for (const o of p.cars) if (o !== car && o.lane === car.lane && o.s > car.s) { gap = o.s - car.s - (o.K.L + car.K.L) / 2; vLead = o.v; break; }
      if (gap === Infinity && q) {
        const ln = Math.min(car.lane, q.lanes - 1);
        for (const o of q.cars) if (o.lane === ln) { gap = p.len - car.s + o.s - (o.K.L + car.K.L) / 2; vLead = o.v; break; }
      }
      // a live bus or train ahead in this lane (this block or the next): queue behind it as if it were stopped
      if (p.obs) for (const o of p.obs) if (o.lane === car.lane && o.s > car.s) { const g = o.s - car.s - (o.L + car.K.L) / 2; if (g < gap) { gap = g; vLead = 0; } }
      if (q && q.obs) { const ln = Math.min(car.lane, q.lanes - 1); for (const o of q.obs) if (o.lane === ln) { const g = p.len - car.s + o.s - (o.L + car.K.L) / 2; if (g < gap) { gap = g; vLead = 0; } } }
      const distLine = p.len - car.s - (p.stopAt ?? 6) - car.K.L / 2;   // front bumper to the stop line (behind the crosswalk)
      if (!car.go && distLine < 30) car.go = mayGo(car, t, distLine);
      // target speed: cruise, follow, stop at the line, ease round corners
      let want = car.vmax;
      if (gap < Infinity) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 4 * Math.max(0, gap - 2.2))) + vLead * 0.5);
      if (!car.go) want = Math.min(want, Math.sqrt(2 * 3.5 * Math.max(0, distLine)));
      if (q) {
        const c = p.endDir[0] * q.startDir[0] + p.endDir[1] * q.startDir[1], vt = c > 0.92 ? car.vmax : c > 0.4 ? 7 : 4.5;
        want = Math.min(want, Math.sqrt(vt * vt + 2 * 2.5 * Math.max(0, p.len - car.s - 3)));
      }
      // a robotaxi sent somewhere: ease to a stop at the destination, wait at the kerb a few seconds, then drive on
      if (onLast(car) && !car.hold) {
        const d = car.dest.s - car.s;
        want = Math.min(want, Math.sqrt(2 * 2.2 * Math.max(0, d - 0.3)));
        if (d < 2 && car.v < 0.8) arrive(car);
      }
      if (car.hold) {
        want = 0; car.hold = Math.max(0, car.hold - dt);
        if (!car.hold) { car.next = next(p, car); robo.update(); }
      }
      const acc = want > car.v ? 2.2 * car.temper : -6;
      car.v = Math.max(0, car.v + clamp(want - car.v, acc < 0 ? acc * dt : 0, acc > 0 ? acc * dt : 0));
      car.s += car.v * dt;
      car.stopped = car.v < 0.3 && distLine < 4 ? car.stopped + dt : 0;
      car.wait = car.v < 0.3 ? car.wait + dt : 0;
      // into the intersection box
      const j = J.get(p.to);
      if (j && j.ctrl && car.go && !car.box && distLine < 0.5) { car.box = j; car.fromP = p; car.fromDir = p.endDir; car.fromRank = p.rank; j.box.push(car); }
      // onto the next block
      if (car.s >= p.len) {
        if (!q) { car.s = p.len; car.v = 0; if (!kept(car)) car.dying = true; else car.next = next(p, car); }     // dead end: fade out where it stands
        else {
        const before = at(p, car.s, car.lane).w, lane0 = car.lane;
        p.cars.splice(p.cars.indexOf(car), 1);
        car.s -= p.len; car.p = q; car.lane = Math.min(car.lane, q.lanes - 1);
        car.vmax = (SPEED[q.hw] || 8) * (car.vmax / (SPEED[p.hw] || 8));
        q.cars.push(car);
        car.prev = p; car.prevLane = lane0;
        if (!bends(p, q) || radius(p, q) <= 1) {   // straight on (or too tight to curve): glide across any lane change, no jump
          const after = at(q, car.s, car.lane).w;
          car.off[0] += before[0] - after[0]; car.off[1] += before[2] - after[2];
        }
        car.next = next(q, car); car.go = false; car.stopped = 0;
        if (Math.random() < 0.03 && !car.onScreen && !kept(car)) car.dying = true;             // turns into a driveway (never while you can see it)
        }
      }
      if (car.box && car.p !== car.fromP && car.s > 8) leaveBox(car);
      // fades
      if (car.dying) { car.a -= dt / 0.7; if (car.a <= 0) drop(car); }
      else if (car.a < 1) car.a = Math.min(1, car.a + dt / 0.8);
    }
    // cars on blocks that left the simulated area go quietly (they are off screen)
    for (const c of cars.slice()) if (!liveSet.has(c.p) && !kept(c)) drop(c);   // (not the tracked robotaxi, or one on its way somewhere)
    const want = target();
    if (live.length) {
      // a newly shown street fills mid-block straight away (fading in); after that cars join at block starts
      const fast = cars.length < want * 0.75;
      for (let i = 0; i < (fast ? 12 : 2) && cars.length < want; i++) {   // a newly shown street fills over a few frames, not all in one
        const p = live[Math.floor(Math.random() * live.length)];
        const s = fast ? Math.random() * p.len * 0.8 : 0;
        // after the first fill, a car only joins where you can't see it (a block start is the middle of a junction)
        if (!fast && view) { const q = toImage(at(p, s, 0).w), m = 40; if (q[0] > view[0] - m && q[0] < view[2] + m && q[1] > view[1] - m && q[1] < view[3] + m) continue; }
        if (!p.cars.some((o) => Math.abs(o.s - s) < 14)) add(p, s, true);
      }
    }
    if (cars.length > want * 1.08) {   // too many for the hour: someone parks, preferably off screen
      // only one you can't see: the cars in view drive on until they leave it (zooming in shrinks the area, so this runs a lot)
      const c = cars.find((c) => !c.onScreen && !c.dying && !kept(c));
      if (c) c.dying = true;
    }
  }

  // ---- robotaxis you can ride along with: click one to track it, then send it somewhere (a click on the map, or a search) ----
  const card = document.getElementById("card");
  let selCar = null, picking = false, statusT = null;
  // the tracked robotaxi, and any robotaxi still on its way somewhere, never park or leave with the simulated area
  function kept(car) { return !!car.dest || car === selCar; }
  // on the last block of its route (a route can start and end on the same block, going round the houses in between)
  const onLast = (car) => !!(car.dest && car.route && car.ri === car.route.length - 1 && car.p === car.dest.p);
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const segPaths = new Map();
  for (const p of paths) if (p.ok) (segPaths.get(p.seg) || segPaths.set(p.seg, []).get(p.seg)).push(p);
  const where = (p, s) => at(p, clamp(s, 0, p.len), 0).w;
  // Dijkstra over blocks (each one-way where the street is), by driving time with a little extra for each turn, from where
  // the car is to either side of the destination's block. Returns the blocks in order, starting with the car's own.
  function findRoute(car, seg, sOn) {
    const targets = new Map();
    for (const p of segPaths.get(seg) || []) targets.set(p, sOn(p));
    if (targets.has(car.p) && targets.get(car.p) > car.s + 8) return { route: [car.p], dp: car.p, ds: targets.get(car.p) };
    const cost = new Map(), prev = new Map(), heap = [];
    const push = (c, p) => { heap.push([c, p]); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    // hidden blocks (squeezed between buildings, or misread onto a roof) are allowed but cost more: without them the
    // visible network splits into islands (the Embarcadero was cut off from the rest of the city)
    const outs = (p) => (J.get(p.to)?.outs || []).filter((q) => q.seg !== p.seg);
    const hop = (p, q) => (p.endDir[0] * q.startDir[0] + p.endDir[1] * q.startDir[1] < 0.7 ? 4 : 0);
    const first = car.go && car.next ? [car.next] : outs(car.p);   // already committed to a turn: start from it
    for (const q of first) { const c = (car.p.len - car.s) / (SPEED[car.p.hw] || 8) + hop(car.p, q); cost.set(q, c); prev.set(q, car.p); push(c, q); }
    while (heap.length) {
      const [c, p] = pop();
      if (c > cost.get(p)) continue;
      if (targets.has(p)) {
        const route = [p]; let x = p; while (x !== car.p) { x = prev.get(x); route.unshift(x); }
        return { route, dp: p, ds: targets.get(p) };
      }
      for (const q of outs(p)) {
        const nc = c + (p.ok ? 1 : 1.6) * p.len / (SPEED[p.hw] || 8) + hop(p, q);
        if (nc < (cost.get(q) ?? Infinity)) { cost.set(q, nc); prev.set(q, p); push(nc, q); }
      }
    }
    return null;
  }
  // the nearest drivable block to a point: on screen (image px, for a click on the map) or on the ground (for a search)
  function nearestImage(ix, iy) {
    const m = 60 / geo.mpp;
    let best = null;
    for (const p of paths) {
      if (!p.ok || p.box[0] > ix + m || p.box[2] < ix - m || p.box[1] > iy + m || p.box[3] < iy - m) continue;
      const ip = p.ip || (p.ip = p.pts.map((w) => toImage(w)));
      for (let i = 1; i < ip.length; i++) {
        const a = ip[i - 1], b = ip[i], dx = b[0] - a[0], dy = b[1] - a[1], f = clamp(((ix - a[0]) * dx + (iy - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        const d = Math.hypot(a[0] + dx * f - ix, a[1] + dy * f - iy) + (p.len < 25 ? 15 / geo.mpp : 0);   // a short link inside a junction only if nothing else is near
        if (!best || d < best.d) best = { d, p, s: p.s[i - 1] + (p.s[i] - p.s[i - 1]) * f };
      }
    }
    return best && best.d * geo.mpp < 75 ? best : null;
  }
  function nearestGround(x, z) {
    let best = null;
    for (const p of paths) {
      if (!p.ok) continue;
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1], b = p.pts[i], dx = b[0] - a[0], dz = b[2] - a[2], f = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const d = Math.hypot(a[0] + dx * f - x, a[2] + dz * f - z) + (p.len < 25 ? 15 : 0);
        if (!best || d < best.d) best = { d, p, s: p.s[i - 1] + (p.s[i] - p.s[i - 1]) * f };
      }
    }
    return best && best.d < 165 ? best : null;
  }
  function sendTo(car, hit, name, how) {
    car.msg = null; car.arrived = null;
    const seg = hit.p.seg, s0 = hit.s, p0 = hit.p;
    // the same spot measured along either direction of a two-way street, kept out of the junctions at both ends: past the
    // stop line and a car length more (on a short block, its middle)
    const sOn = (p) => { const m = clamp((p.stopAt ?? 10) + 5, 10, 21); return p.len <= 2 * m ? p.len / 2 : clamp(p === p0 ? s0 : p.len - s0, m, p.len - m); };
    const r = findRoute(car, seg, sOn);
    if (!r) { car.msg = "Can't get there from here."; car.dest = null; car.route = null; update(); return; }
    car.hold = 0;
    car.route = r.route; car.ri = 0;
    car.dest = { p: r.dp, s: r.ds, w: where(r.dp, r.ds), name: name || hit.p.name || "there" };
    if (r.route.length > 1 && !car.go) car.next = r.route[1];
    if (car.dying) { car.dying = false; }
    window.track?.("robotaxi: destination", { how, km: Math.round(left(car) / 100) / 10 });
    window.__transit.refollow?.(car);
    update();
  }
  function arrive(car) {
    car.hold = 6; car.arrived = car.dest.name; car.dest = null; car.route = null;
    window.track?.("robotaxi: arrived");
    update();
  }
  // metres still to drive
  function left(car) {
    if (!car.dest) return 0;
    if (onLast(car)) return Math.max(0, car.dest.s - car.s);
    let m = car.p.len - car.s;
    for (let i = (car.ri || 0) + 1; i < car.route.length; i++) { const p = car.route[i]; m += p === car.dest.p ? car.dest.s : p.len; }
    return m;
  }
  function setPicking(on) {
    picking = on;
    viewer.canvas.style.cursor = on ? "crosshair" : "";
    update();
  }
  function status() {
    const car = selCar;
    if (!car) return "";
    if (picking) return `Click the map to pick a destination <span class="meta">(Esc to cancel)</span>`;
    if (car.msg) return esc(car.msg);
    if (car.hold) return car.arrived === "Happy Donuts" ? `Arrived at <b>Happy Donuts</b>. Fresh ones are up.` : `Arrived at <b>${esc(car.arrived)}</b>`;
    if (car.dest) { const m = left(car), min = Math.max(1, Math.round(m / 7 / 60)); return `Heading to <b>${esc(car.dest.name)}</b> · ${m < 950 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km"} · about ${min} min`; }
    if (car.arrived) return `Arrived at ${esc(car.arrived)}, cruising again`;
    return "Cruising around";
  }
  function update() {
    const box = card.querySelector(".robo");
    if (!box || !selCar) return;
    box.querySelector(".rst").innerHTML = status();
    const b = box.querySelector(".rgo");
    b.textContent = picking ? "Cancel" : selCar.dest ? "Change destination" : "Set a destination";
  }
  // card closed, or taken over by another vehicle's card: let go
  new MutationObserver(() => {
    if (selCar && (card.hidden || !card.querySelector(".robo"))) { selCar = null; clearInterval(statusT); if (picking) setPicking(false); }
  }).observe(card, { attributes: true, attributeFilter: ["hidden"], childList: true });
  addEventListener("keydown", (e) => { if (picking && e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); setPicking(false); } }, true);
  const css = document.createElement("style");
  css.textContent = `#card .robo .rctl { display: flex; gap: 10px; align-items: center; margin: 8px 0 4px; }
    #card .robo .rgo { flex: none; font: 600 13px/1 var(--u-sans); color: #fff; background: var(--u-coral); border: 0; border-radius: 999px; padding: 8px 13px; cursor: pointer; }
    #card .robo .rq { flex: 1; min-width: 0; font: 13px var(--u-sans); color: var(--u-ink); background: none; border: 0; border-bottom: 1px solid var(--u-line); border-radius: 0; padding: 6px 0; outline: none; }
    #card .robo .rq::placeholder { color: var(--u-mute); }
    #card .robo .rsugg { list-style: none; margin: 2px 0 6px; padding: 0; font: 13px/1.35 var(--u-sans); }
    #card .robo .rsugg button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 6px 2px; cursor: pointer; border-top: 1px solid var(--u-line); }
    #card .robo .rsugg button:hover, #card .robo .rsugg button.hi { color: var(--u-coral); }
    #card .robo .rsugg small { color: var(--u-mute); margin-left: 6px; } #card .robo .rsugg .none { padding: 6px 2px; color: var(--u-mute); }
    #card .robo .rdonut { all: unset; cursor: pointer; font: 13px var(--u-sans); color: var(--u-mute); border-bottom: 1px dotted currentColor; margin: 2px 0 6px; }
    #card .robo .rdonut:hover { color: var(--u-coral); }
    #card .robo .rst { font-size: 15px; } #card .robo .rst .meta { font-size: 12px; }`;
  document.head.appendChild(css);
  const robo = {
    get picking() { return picking; },
    update,
    open(car) {
      selCar = car; car.dying = false; car.a = 1;
      const R = car.K.robo;
      card.innerHTML = `<button class="x" aria-label="Close">×</button><h2>${esc(R.brand)} · ${esc(R.model)}</h2><p>Simulated robotaxi</p>
        <div class="robo"><p class="rst"></p><div class="rctl"><button class="rgo"></button><input class="rq" type="search" placeholder="or search a place" autocomplete="off" spellcheck="false"></div><ul class="rsugg" hidden></ul><button class="rdonut">or go get a donut</button></div>
        <p class="meta">A made-up car driving the real streets, not a live position. It keeps to one-way streets and stops at the lights.</p>`;
      card.hidden = false;
      card.querySelector(".x").onclick = () => { card.hidden = true; };
      const prev = window.__transit.preview?.(car.K); if (prev) card.querySelector("h2").after(prev);
      card.querySelector(".rgo").onclick = () => setPicking(!picking);
      // search: the map's own place search, then the nearest street to what it finds
      const inp = card.querySelector(".rq"), ul = card.querySelector(".rsugg");
      let found = [], hi = 0, t = null;
      const show = (state) => {
        ul.hidden = !inp.value.trim();
        ul.innerHTML = found.length ? found.map((r, i) => `<li><button data-f="${i}" class="${i === hi ? "hi" : ""}">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</button></li>`).join("")
          : `<li class="none">${state === "loading" ? "Searching…" : "Nothing by that name in San Francisco."}</li>`;
        ul.querySelectorAll("[data-f]").forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(found[+b.dataset.f]); }));
      };
      const pick = (r) => {
        if (!r || selCar !== car) return;
        inp.value = ""; ul.hidden = true; inp.blur(); if (picking) setPicking(false);
        const w = G.toWorld(r.lat, r.lon), hit = nearestGround(w[0], w[2]);
        if (!hit) { car.msg = "That's off the map's streets."; update(); return; }
        sendTo(car, hit, r.name, "search");
      };
      // Ari's favourite spot in the city: Happy Donuts, 24th & Church, open all night (people.js draws the shop)
      card.querySelector(".rdonut").onclick = () => pick({ name: "Happy Donuts", lat: 37.75173, lon: -122.42772 });
      inp.oninput = () => {
        clearTimeout(t); const qv = inp.value.trim(); found = []; hi = 0;
        if (!qv) { ul.hidden = true; return; }
        show("loading");
        t = setTimeout(async () => { const res = (await window.__findPlaces?.(qv)) || []; if (inp.value.trim() !== qv) return; found = res; show("done"); }, 350);
      };
      inp.onkeydown = (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (found.length) { hi = (hi + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length; show("done"); } }
        if (e.key === "Enter") { e.preventDefault(); pick(found[hi]); }
      };
      inp.onblur = () => setTimeout(() => (ul.hidden = true), 150);
      update();
      clearInterval(statusT); statusT = setInterval(() => { if (selCar && !card.hidden) update(); }, 1000);
      window.track?.("robotaxi: open", { kind: R.kind });
    },
    // a click on the map while picking: the nearest street there is the destination
    pick(pos) {
      const car = selCar;
      setPicking(false);
      if (!car || !window.mapItem) return;
      const ip = window.mapItem.viewerElementToImageCoordinates(pos), hit = nearestImage(ip.x, ip.y);
      if (!hit) { car.msg = "No street there. Try clicking on a road."; update(); return; }
      sendTo(car, hit, hit.p.name, "map");
    },
    // the tracked robotaxi's way ahead, in its brand's colour, and a pin where it's going (transit.js draws it under the vehicles)
    draw(ctx, scr, pxPerM) {
      const car = selCar;
      if (!car || !car.dest || !car.route || card.hidden) return;
      const pts = [], add = (p, s0, s1) => { pts.push(where(p, s0)); for (let i = 1; i < p.s.length - 1; i++) if (p.s[i] > s0 && p.s[i] < s1) pts.push(where(p, p.s[i])); pts.push(where(p, s1)); };
      if (onLast(car)) add(car.p, car.s, car.dest.s);
      else {
        add(car.p, car.s, car.p.len);
        for (let i = (car.ri || 0) + 1; i < car.route.length; i++) { const p = car.route[i]; add(p, 0, p === car.dest.p ? car.dest.s : p.len); if (p === car.dest.p) break; }
      }
      const col = car.K.robo.col, t = performance.now() / 1000;
      // in screen space, near-duplicate points dropped; corners rounded (about a 7 m radius, less on short blocks)
      const S = []; for (const w of pts) { const q = scr(w); if (!S.length || Math.hypot(q[0] - S[S.length - 1][0], q[1] - S[S.length - 1][1]) > 0.75) S.push(q); }
      if (S.length < 2) return;
      const R = Math.max(5, pxPerM * 7), d = (i, j) => Math.hypot(S[j][0] - S[i][0], S[j][1] - S[i][1]);
      const trace = () => {
        ctx.beginPath(); ctx.moveTo(S[0][0], S[0][1]);
        for (let i = 1; i < S.length - 1; i++) ctx.arcTo(S[i][0], S[i][1], S[i + 1][0], S[i + 1][1], Math.min(R, d(i - 1, i) / 2, d(i, i + 1) / 2));
        ctx.lineTo(S[S.length - 1][0], S[S.length - 1][1]);
      };
      const w = Math.max(3, Math.min(8, pxPerM * 2.4));
      ctx.save(); ctx.lineJoin = ctx.lineCap = "round";
      trace();
      ctx.globalAlpha = 0.2; ctx.strokeStyle = col; ctx.lineWidth = w * 3.4; ctx.stroke();                 // a soft glow of the brand's colour
      ctx.globalAlpha = 0.95; ctx.strokeStyle = lift(col, 0.55); ctx.lineWidth = w + 2.4; ctx.stroke();     // a darker edge, so it sits on the drawing
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
      // white dots flowing along it toward the destination
      const gap = Math.max(10, w * 3.2);
      ctx.globalAlpha = 0.95; ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1.6, w * 0.42);
      ctx.setLineDash([0.01, gap]); ctx.lineDashOffset = -((t * gap * 1.6) % gap); ctx.stroke(); ctx.setLineDash([]);
      // a ripple spreading on the ground under the pin
      { const [x, y] = scr(car.dest.w), ph = (t % 1.8) / 1.8;
        ctx.globalAlpha = (1 - ph) * 0.8; ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, 6 + ph * 22, (6 + ph * 22) * 0.45, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      // the pin: a round head on a short point, standing on the destination
      const [x, y] = scr(car.dest.w), r = 8;
      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(x, y, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - r * 0.62, y - r * 1.9); ctx.arc(x, y - r * 2.4, r, Math.PI * 0.82, Math.PI * 0.18); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y - r * 2.4, r * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  };
  window.__robotaxi = robo;

  // turns drawn as curves: from up to 11 m before the corner to as far after, a car follows a quadratic curve from its
  // lane on one block to its lane on the next, rather than driving into the corner point and pivoting there
  const bends = (p, q) => p.endDir[0] * q.startDir[0] + p.endDir[1] * q.startDir[1] < 0.97;
  // the curve starts up to 11 m before the corner but ends within 5 m after it: the turn finishes inside the junction,
  // short of the cars waiting at the stop line on the street it turns into
  const rin = (p) => Math.min(11, p.len * 0.4), rout = (q) => Math.min(5, q.len * 0.4);
  const radius = (p, q) => Math.min(rin(p), rout(q));   // (only used to tell whether a corner is too tight to curve at all)
  function curve(a, la, b, lb, u) {
    const r = Math.max(rin(a), rout(b)), A = at(a, a.len - rin(a), la), B = at(b, rout(b), lb);
    const d1 = A.dir, d2 = B.dir, den = d1[0] * d2[1] - d1[1] * d2[0];
    let C;
    if (Math.abs(den) < 0.05) C = [(A.w[0] + B.w[0]) / 2, 0, (A.w[2] + B.w[2]) / 2];
    else { let t = ((B.w[0] - A.w[0]) * d2[1] - (B.w[2] - A.w[2]) * d2[0]) / den; t = clamp(t, 0, 3 * r); C = [A.w[0] + d1[0] * t, 0, A.w[2] + d1[1] * t]; }
    const m = 1 - u, w = [m * m * A.w[0] + 2 * u * m * C[0] + u * u * B.w[0], A.w[1] + (B.w[1] - A.w[1]) * u, m * m * A.w[2] + 2 * u * m * C[2] + u * u * B.w[2]];
    const dx = m * (C[0] - A.w[0]) + u * (B.w[0] - C[0]), dz = m * (C[2] - A.w[2]) + u * (B.w[2] - C[2]), L = Math.hypot(dx, dz) || 1;
    return { w, dir: [dx / L, dz / L] };
  }
  function pose(car) {
    const p = car.p, s = car.s, q = car.next;
    if (q && bends(p, q) && radius(p, q) > 1) { const i = rin(p), o = rout(q); if (s > p.len - i) return curve(p, car.lane, q, Math.min(car.lane, q.lanes - 1), (s - (p.len - i)) / (i + o)); }
    const b = car.prev;
    if (b && bends(b, p) && radius(b, p) > 1) { const i = rin(b), o = rout(p); if (s < o) return curve(b, Math.min(car.prevLane ?? 0, b.lanes - 1), p, car.lane, (i + s) / (i + o)); }
    return at(p, s, car.lane);
  }

  // ---- handed to transit.js each frame: advance, then place every car ----
  let last = performance.now();
  window.__ambient = (Wc, Hc, scr) => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (live.length || cars.length) step(dt, now / 1000);
    const out = [], ease = 1 - Math.exp(-dt / 0.45), turn = 1 - Math.exp(-dt / 0.18);
    for (const car of cars) {
      const q = pose(car);
      car.off[0] -= car.off[0] * ease; car.off[1] -= car.off[1] * ease;
      q.w[0] += car.off[0]; q.w[2] += car.off[1];
      car.pull = (car.pull || 0) + ((car.hold ? 1 : 0) - (car.pull || 0)) * ease;   // pulled over to the kerb while it waits
      if (car.pull > 0.01) { q.w[0] -= q.dir[1] * car.pull * 1.5; q.w[2] += q.dir[0] * car.pull * 1.5; }
      // heading turns smoothly instead of snapping at corners
      if (!car.hd) car.hd = q.dir.slice();
      else { car.hd[0] += (q.dir[0] - car.hd[0]) * turn; car.hd[1] += (q.dir[1] - car.hd[1]) * turn; const n = Math.hypot(car.hd[0], car.hd[1]) || 1; car.hd[0] /= n; car.hd[1] /= n; }
      q.dir = car.hd;
      const s = scr(q.w);
      car.onScreen = !(s[0] < -60 || s[1] < -60 || s[0] > Wc + 60 || s[1] > Hc + 60);
      if (!car.onScreen) continue;
      out.push({ v: car, p: q, depth: s[2], at: s, K: car.K, alpha: car.a });
    }
    return out;
  };
  window.__traffic = { paths, J, cars, light, spec, get quality() { return QUAL; }, get frameMs() { return frameMs; } };   // for poking at in the console
})();
