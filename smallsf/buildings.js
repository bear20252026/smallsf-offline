// Click any building: what it is, when it was built, how tall. The click is turned back into a spot on the ground
// using the map's depth grid (the visible surface under the pointer), then matched against the city's building
// outlines (tools/build-buildings.mjs: DataSF footprints + LiDAR heights, the Assessor's roll, OpenStreetMap names).
// The chosen building is outlined on the map while its card is open.
(async function () {
  while (!(window.__transit && window.__grids && window.mapItem)) await new Promise((r) => setTimeout(r, 300));
  const viewer = window.viewer, { G, geo } = window.__transit, grids = window.__grids, card = document.getElementById("card");
  const index = await fetch("bldg.json?v=" + (window.__cv || "")).then((r) => r.json()).catch(() => null);
  if (!index || !card) return;
  const have = new Set(index.chunks), loaded = new Map();
  const chunk = (k) => {
    if (!have.has(k)) return Promise.resolve([]);
    if (!loaded.has(k)) loaded.set(k, fetch(`bldg/${k}.json?v=${window.__cv || ""}`).then((r) => r.json()).then((list) => list.map((b) => { const pts = pairs(b.p), xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]); return { ...b, pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] }; })).catch(() => []));
    return loaded.get(k);
  };
  const pairs = (p) => { const out = []; for (let i = 0; i < p.length; i += 2) out.push([p[i] / 10, p[i + 1] / 10]); return out; };

  // ---- screen -> world: undo the camera (a rotation plus an offset) at the depth the map shows there ----
  const M = geo.worldToCamera, dg = geo.depthGrid, depth = grids.depth;
  const toWorld = (cx, cy, cz) => { const c = [cx - M[12], cy - M[13], cz - M[14]]; return [0, 1, 2].map((j) => M[4 * j] * c[0] + M[4 * j + 1] * c[1] + M[4 * j + 2] * c[2]); };
  function surfaceAt(ix, iy) {   // map image pixel -> world point on the visible surface, or null off the drawn area
    const gx = Math.round(ix / dg.scale), gy = Math.round(iy / dg.scale);
    if (gx < 0 || gy < 0 || gx >= dg.w || gy >= dg.h) return null;
    const d = grids.dm(gy * dg.w + gx);
    if (!(d > dg.lo + 1 && d < dg.lo + dg.span - 1)) return null;   // the grid's ends mean "nothing rendered here"
    return toWorld(geo.x0 + ix * geo.mpp, geo.y1 - iy * geo.mpp, -d);
  }
  const project = (x, y, z) => ({ x: (M[0] * x + M[4] * y + M[8] * z + M[12] - geo.x0) / geo.mpp, y: (geo.y1 - (M[1] * x + M[5] * y + M[9] * z + M[13])) / geo.mpp });
  const near = (w, b, tol) => w && (inside(w[0], w[2], b.pts) || edgeDist(w[0], w[2], b.pts) < tol);
  const inside = (x, z, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const edgeDist = (x, z, ring) => { let m = Infinity; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [ax, az] = ring[j], [bx, bz] = ring[i], vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1))); m = Math.min(m, Math.hypot(x - ax - vx * t, z - az - vz * t)); } return m; };
  const keyOf = (x, z) => `${Math.floor(x / index.cell)}_${Math.floor(z / index.cell)}`;
  // select the building at a spot on the map (a searched address): the one there, or the nearest within 25 m
  window.__selectBuildingAt = async (lat, lon) => {
    const w = G.toWorld(lat, lon), list = await chunk(keyOf(w[0], w[2]));
    let best = null, bd = 25;
    for (const b of list) { if (inside(w[0], w[2], b.pts)) { best = b; break; } const d = edgeDist(w[0], w[2], b.pts); if (d < bd) { bd = d; best = b; } }
    if (best) open(best);
    return best;
  };
  async function pick(ix, iy) {
    const w = surfaceAt(ix, iy);
    if (!w) return rayPick(ix, iy);
    const list = await chunk(keyOf(w[0], w[2]));
    let best = null, bd = 2.5;   // a click on a wall lands on the outline's edge: allow a couple of metres
    for (const b of list) {
      if (inside(w[0], w[2], b.pts)) return b;
      const d = edgeDist(w[0], w[2], b.pts); if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  // Off the drawn area there's no depth: follow the line of sight down from 450 m and stop in the first building
  // it passes through (outline, up to its height), so a click on a tower's top finds the tower, not the street behind.
  async function rayPick(ix, iy) {
    const cx = geo.x0 + ix * geo.mpp, cy = geo.y1 - iy * geo.mpp, at = (d) => toWorld(cx, cy, -d);
    const a = at(15000), slope = at(15001)[1] - a[1];            // world height change per metre along the ray
    if (Math.abs(slope) < 1e-6) return null;
    const d0 = 15000 + (450 - a[1]) / slope, d1 = 15000 + (-40 - a[1]) / slope, step = Math.sign(d1 - d0) * 1.5;
    const keys = new Set(); for (let d = d0; (d1 - d) * step > 0; d += step * 40) { const w = at(d); keys.add(keyOf(w[0], w[2])); }
    const w1 = at(d1); keys.add(keyOf(w1[0], w1[2]));
    const lists = new Map(await Promise.all([...keys].map(async (k) => [k, await chunk(k)])));
    for (let d = d0; (d1 - d) * step > 0; d += step) {
      const [x, y, z] = at(d), g = G.ground(x, z);
      if (g != null && y < g - 1) break;                                 // reached the ground: nothing in the way
      for (const b of lists.get(keyOf(x, z)) || []) {
        if (x < b.box[0] || x > b.box[2] || z < b.box[1] || z > b.box[3]) continue;
        if (y <= (g ?? 0) + Math.max(3, b.h) && inside(x, z, b.pts)) return b;
      }
    }
    return null;
  }

  // ---- height: the 2010 LiDAR survey, or for newer buildings the 3D city model under the map ----
  // street level around a building: the ground grid can read a big roof as ground, so look 14 m outside its outline
  function baseOf(b) {
    if (b.g != null) return b.g;
    const n = b.pts.length, cx = b.pts.reduce((s, p) => s + p[0], 0) / n, cz = b.pts.reduce((s, p) => s + p[1], 0) / n;
    // the middle of the readings round it, so a downhill side on a slope doesn't sink the base below the building
    const gs = [];
    // the ground grid has no reading over water (-100 m): piers and buildings over the bay skip those, or their outline
    // was drawn 100 m down, on some other building further down the screen
    const real = (g) => g != null && g > -50;
    for (const [x, z] of b.pts) { const dx = x - cx, dz = z - cz, L = Math.hypot(dx, dz) || 1, g = G.ground(x + dx / L * 14, z + dz / L * 14); if (real(g)) gs.push(g); }
    if (!gs.length) { const g = G.ground(cx, cz); if (real(g)) return (b.g = g); return grids ? (b.g = 2) : (g ?? 0); }   // all over water: a pier, at about sea level
    gs.sort((p, q) => p - q);
    return (b.g = gs[gs.length >> 1]);
  }
  // The survey predates newer towers, so for those, measure on the map: climb a column over the building and find the
  // highest point where the surface seen on screen still belongs to it (only where the map is drawn).
  function heightOf(b) {
    if (b.H != null) return b.H;
    let h = b.h;
    if (!b.y || b.y >= 2010 || !h) {
      const n = b.pts.length, cx = b.pts.reduce((s, p) => s + p[0], 0) / n, cz = b.pts.reduce((s, p) => s + p[1], 0) / n;
      const g = baseOf(b);
      let top = 0, misses = 0;
      for (let y = 3; y < 600 && misses < 12; y += 3) {
        const p = project(cx, g + y, cz), w = surfaceAt(p.x, p.y);
        if (!w) { misses = 99; break; }
        if (near(w, b, 3)) { top = y; misses = 0; } else misses++;
      }
      if (top > h) h = top;
    }
    return (b.H = h);
  }

  // ---- the card ----
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let selected = null;
  const USES = { "Office Gov": "Government office", "Dwelling": "House", "Flats & Duplex": "Flats", "Apartment": "Apartments", "Commercial Stores": "Shops", "Garages (Commercial)": "Parking garage", "Residential Hotel & SRO": "Residential hotel (SRO)", "Commercial Store Condo": "Shop condo", "Condominium BMR": "Condominiums (below market rate)", "Condominium": "Condominiums", "Office": "Offices", "Hotels": "Hotel", "Churches,Convents,Rectories": "Church", "Live/Work Condominium": "Live/work lofts" };
  function open(b) {
    selected = b;
    const h = heightOf(b), ft = Math.round(h * 3.281);
    const resid = /dwell|apart|condo|flat|resid|tic|coop|live|hotel|sro/i.test(b.c || "");
    const use = b.c && !/vacant|^NA$|miscellaneous/i.test(b.c) ? USES[b.c] || b.c : "";
    const facts = [b.y && (b.y === 1900 && !b.yo ? "Built around 1900 or earlier" : `Built ${b.y}`), b.s && `${b.s} ${b.s === 1 ? "story" : "stories"}`, resid && b.u > 1 && `${b.u} units`].filter(Boolean).join(" · ");
    const wiki = b.w && /^(\w\w):(.+)$/.exec(b.w);
    card.innerHTML = `<button class="x" aria-label="Close">×</button><h2>${esc(b.n || b.a || "Building")}</h2>
      ${b.n && b.a ? `<p>${esc(b.a)}</p>` : ""}${facts ? `<p>${esc(facts)}</p>` : ""}${use ? `<p>${esc(use)}</p>` : ""}
      ${h > 2 ? `<p>About ${ft.toLocaleString()} ft tall (${Math.round(h)} m)</p>` : ""}
      ${wiki ? `<p><a href="https://${wiki[1]}.wikipedia.org/wiki/${encodeURIComponent(wiki[2].replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia ↗</a></p>` : ""}
      <p class="meta">Outline and height: DataSF's 2010 LiDAR survey${h > b.h ? " (height measured on the map, as the building is newer)" : ""}. Year, use and units: SF Assessor, 2025 roll.${b.n ? " Name: OpenStreetMap." : ""}</p>`;
    card.hidden = false;
    card.querySelector(".x").onclick = close;
    window.track?.("building: open", { name: b.n || b.a || "" });
  }
  function close() { selected = null; card.hidden = true; }
  new MutationObserver(() => { if (card.hidden) selected = null; }).observe(card, { attributes: true, attributeFilter: ["hidden"] });

  viewer.addHandler("canvas-click", async (e) => {
    if (!e.quick || e.preventDefaultAction || window.__listEditing) return;   // a drag, a bus/boat took the click, or a list is taking pins
    const t = e.originalEvent?.target;
    if (t && t.closest && t.closest(".pin, .gamepin")) return;           // landmark and game pins have their own cards
    const p = window.mapItem.viewerElementToImageCoordinates(e.position);
    const b = await pick(p.x, p.y);
    if (b) open(b); else if (selected) close();
  });
  // the building under a point of the drawing, without opening it (lists.js names a dropped pin after it)
  window.__buildingInfo = (ix, iy) => pick(ix, iy);
  // for testing: the building under a point on screen (and open its card)
  window.__buildingAt = async (sx, sy) => { const p = window.mapItem.viewerElementToImageCoordinates(new OpenSeadragon.Point(sx, sy)), b = await pick(p.x, p.y); if (b) open(b); return b; };

  // ---- outline the chosen building: its roof ring, the ground ring, and the corners between ----
  const cv = Object.assign(document.createElement("canvas"), { className: "bldg-sel" });
  cv.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
  const place = () => { const tr = document.getElementById("transit"); if (tr) tr.before(cv); else document.body.appendChild(cv); };
  place();
  const ctx = cv.getContext("2d");
  const Mw = geo.worldToCamera;
  const scr = (o, k, x, y, z) => { const cx = Mw[0] * x + Mw[4] * y + Mw[8] * z + Mw[12], cy = Mw[1] * x + Mw[5] * y + Mw[9] * z + Mw[13]; return [o.x + ((cx - geo.x0) / geo.mpp) * k, o.y + ((geo.y1 - cy) / geo.mpp) * k]; };
  let drawn = false;
  function frame() {
    requestAnimationFrame(frame);
    if (!selected) { if (drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; } return; }
    const dpr = window.__dpr || 1, cw = innerWidth, ch = innerHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch); drawn = true;
    const mi = window.mapItem, o = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), e = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0)), k = (e.x - o.x) / 1000;
    const b = selected, pts = b.pts;
    if (b.g == null) baseOf(b);
    if (b.H == null) heightOf(b);
    // the roof ring sits at the typical roof height (a dome or spire would float it); newer towers use the measured one
    const rh = b.H > b.h ? b.H : b.r >= 3 ? b.r : Math.max(3, b.h);
    const base = pts.map(([x, z]) => scr(o, k, x, b.g, z)), roof = pts.map(([x, z]) => scr(o, k, x, b.g + rh, z));
    // the two outermost corners on screen make the silhouette's sides
    let li = 0, ri = 0; base.forEach(([x], i) => { if (x < base[li][0]) li = i; if (x > base[ri][0]) ri = i; });
    const ring = (r) => { ctx.beginPath(); r.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    ctx.lineJoin = "round";
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ring(roof); ctx.fill();
    for (const [w, col] of [[3.2, "rgba(20,30,36,0.55)"], [1.6, "#fff"]]) {
      ctx.lineWidth = w; ctx.strokeStyle = col;
      ring(roof); ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.55; ring(base); ctx.stroke(); ctx.restore();
      ctx.beginPath(); for (const i of [li, ri]) { ctx.moveTo(...base[i]); ctx.lineTo(...roof[i]); } ctx.stroke();
    }
  }
  requestAnimationFrame(frame);
})();
