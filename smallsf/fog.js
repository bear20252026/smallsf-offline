// Fog of war: soft cloud banks close in past the bay, so the map ends in weather instead of a hard edge.
// Clear inside a ring around the city and the bay that just takes in the far shores (Sausalito, Tiburon, Angel
// Island, Berkeley, Oakland, Alameda); boats out in the clouds fade away with them. The cloud mask is worked out
// once in camera space and slowly breathes between two variants; it takes the time-of-day tint like the map.
(function () {
  const geo = window.__geo, viewer = window.viewer, vp = viewer.viewport;
  if (!geo || !window.IsoGeo) return;
  const G = IsoGeo.make(geo, null);
  const cam = (la, lo) => { const p = G.toPixelAt(la, lo, 0); return [geo.x0 + p.x * geo.mpp, geo.y1 - p.y * geo.mpp]; };
  // the clear ring, clockwise from the ocean off Lands End (lat, lon)
  const RING = [
    [37.778, -122.524], [37.806, -122.530], [37.826, -122.512], [37.832, -122.488], [37.852, -122.481],
    [37.866, -122.488], [37.877, -122.468], [37.884, -122.448], [37.877, -122.418], [37.872, -122.385],
    [37.876, -122.340], [37.873, -122.307], [37.849, -122.291], [37.822, -122.290], [37.805, -122.282],
    [37.785, -122.268], [37.758, -122.252], [37.738, -122.282], [37.712, -122.318], [37.700, -122.345],
    [37.702, -122.372], [37.706, -122.405], [37.708, -122.455], [37.712, -122.497], [37.735, -122.512],
  ].map(([la, lo]) => cam(la, lo));

  const xs = RING.map((p) => p[0]), ys = RING.map((p) => p[1]);
  const M = 3500, X0 = Math.min(...xs) - M, X1 = Math.max(...xs) + M, Y0 = Math.min(...ys) - M, Y1 = Math.max(...ys) + M;
  const S = 24, MW = Math.ceil((X1 - X0) / S), MH = Math.ceil((Y1 - Y0) / S);   // mask cells of 24 m

  // signed distance to the ring (negative inside), on a coarse grid then filled in bilinearly
  function segDist(px, py) {
    let d = Infinity, inside = false;
    for (let i = 0, j = RING.length - 1; i < RING.length; j = i++) {
      const [ax, ay] = RING[j], [bx, by] = RING[i];
      if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
      d = Math.min(d, Math.hypot(px - ax - vx * t, py - ay - vy * t));
    }
    return inside ? -d : d;
  }
  // value noise
  const hash = (x, y, s) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sm = (t) => t * t * (3 - 2 * t);
  function noise(x, y, s) {
    const i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
    const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  const fbm = (x, y, s) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < 4; o++) { v += a * noise(x * f, y * f, s + o * 17); f *= 2.03; a *= 0.5; } return v; };

  const fp = window.__far, far = fp && { x0: fp.x0, x1: fp.x0 + fp.W * fp.mpp, y1: fp.y1, y0: fp.y1 - fp.H * fp.mpp };
  const C = 4;   // distance on a 4x coarser grid
  const CW = Math.ceil(MW / C) + 2, CH = Math.ceil(MH / C) + 2, dist = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) dist[j * CW + i] = segDist(X0 + i * C * S, Y1 - j * C * S);
  const distAt = (i, j) => {
    const fi = i / C, fj = j / C, a = Math.floor(fi), b = Math.floor(fj), tx = fi - a, ty = fj - b;
    const p = dist[b * CW + a], q = dist[b * CW + a + 1], r = dist[(b + 1) * CW + a], s = dist[(b + 1) * CW + a + 1];
    return (p + (q - p) * tx) * (1 - ty) + (r + (s - r) * tx) * ty;
  };
  // two cloud variants; alpha kept for the boats' lookups
  const alphas = [], masks = [];
  for (const seed of [3, 11]) {
    const cv = document.createElement("canvas"); cv.width = MW; cv.height = MH;
    const cx = cv.getContext("2d"), img = cx.createImageData(MW, MH), px = img.data, al = new Uint8Array(MW * MH);
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const wx = (X0 + i * S) / 1400, wy = (Y1 - j * S) / 1400;   // noise in ~1.4 km features
      const n = fbm(wx, wy, seed), n2 = fbm(wx * 2.7 + 9, wy * 2.7, seed + 5);
      const d = distAt(i, j) + (n - 0.5) * 1500 + (n2 - 0.5) * 450;   // a billowing edge
      let a = Math.max(0, Math.min(1, (d + 250) / 1300)); a = sm(a);
      if (far) { const x = X0 + i * S, y = Y1 - j * S, e = Math.min(x - far.x0, far.x1 - x, far.y1 - y, y - far.y0); a = Math.max(a, Math.min(1, 1 - (e - 300) / 900)); }   // solid before the backdrop runs out
      const edge = Math.min(i, j, MW - 1 - i, MH - 1 - j) / 60;   // flat colour toward the mask's border, so it meets the solid cloud cleanly
      let lit = 0.88 + 0.12 * (n * 0.7 + n2 * 0.3) - 0.09 * Math.max(0, 1 - Math.abs(a - 0.5) * 2.6) * (1 - n);   // soft puffs, a grey rim
      lit = 0.94 + (lit - 0.94) * Math.min(1, edge);
      const k = (j * MW + i) * 4;
      px[k] = 238 * lit + 10; px[k + 1] = 236 * lit + 12; px[k + 2] = 230 * lit + 18; px[k + 3] = a * 255;
      al[j * MW + i] = a * 255;
    }
    cx.putImageData(img, 0, 0);
    masks.push(cv); alphas.push(al);
  }
  const phase = () => 0.5 - 0.5 * Math.cos((Date.now() / 1000) * (2 * Math.PI / 70));   // a slow 70 s breath
  // fog density (0 clear .. 1 solid) at a camera-space point, for the boats
  window.__fogAt = (x, y) => {
    const i = Math.round((x - X0) / S), j = Math.round((Y1 - y) / S);
    if (i < 0 || j < 0 || i >= MW || j >= MH) return 1;
    const t = phase(), k = j * MW + i;
    return (alphas[0][k] * (1 - t) + alphas[1][k] * t) / 255;
  };
  window.__fogMask = { cv: masks[0], X0, X1, Y0, Y1 };
  // summed-area table of cells with any cloud in either variant, so a frame can tell at once if the view is clear
  const SAT = new Uint32Array((MW + 1) * (MH + 1));
  for (let j = 0; j < MH; j++) { let row = 0; for (let i = 0; i < MW; i++) { const k = j * MW + i; row += alphas[0][k] > 2 || alphas[1][k] > 2 ? 1 : 0; SAT[(j + 1) * (MW + 1) + i + 1] = SAT[j * (MW + 1) + i + 1] + row; } }
  const cloudIn = (cx0, cy0, cx1, cy1) => {   // any cloud in a camera-space box?
    const i0 = Math.floor((cx0 - X0) / S), i1 = Math.ceil((cx1 - X0) / S), j0 = Math.floor((Y1 - cy1) / S), j1 = Math.ceil((Y1 - cy0) / S);
    if (i0 < 0 || j0 < 0 || i1 > MW || j1 > MH) return true;
    return SAT[j1 * (MW + 1) + i1] - SAT[j0 * (MW + 1) + i1] - SAT[j1 * (MW + 1) + i0] + SAT[j0 * (MW + 1) + i0] > 0;
  };
  const PAD = 1200; window.__fogHome = { x: Math.min(...xs) - PAD, y: Math.max(...ys) + PAD, w: Math.max(...xs) - Math.min(...xs) + PAD * 2, h: Math.max(...ys) - Math.min(...ys) + PAD * 2 };

  // ---- drawing: a canvas above the vehicles and boats ----
  const out = Object.assign(document.createElement("canvas"), { className: "fogwar" });
  out.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
  const place = () => { const t = document.getElementById("transit"); if (t) t.after(out); else document.body.appendChild(out); };
  place(); setTimeout(place, 3000);
  const ctx = out.getContext("2d");
  let drawn = false, lastKey = "", lastAt = 0, lastTint = "";
  function frame(now) {
    requestAnimationFrame(frame);
    const dpr = window.__softDpr || window.__dpr || 1, cw = innerWidth, ch = innerHeight;
    let resized = false;
    if (out.width !== Math.round(cw * dpr) || out.height !== Math.round(ch * dpr)) { out.width = Math.round(cw * dpr); out.height = Math.round(ch * dpr); resized = true; drawn = false; }
    // viewport units are camera kilometres: x = camX/1000, y = -camY/1000
    const vb = vp.getBounds(true);
    if (!cloudIn(vb.x * 1000, -(vb.y + vb.height) * 1000, (vb.x + vb.width) * 1000, -vb.y * 1000)) {   // clear sky over the whole view
      if (drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, out.width, out.height); drawn = false; }
      return;
    }
    // the clouds only breathe slowly: with the camera still, a few redraws a second are plenty
    const key = `${vb.x},${vb.y},${vb.width}`, tt = window.atmo?.tint, tintKey = tt ? tt.m.map(Math.round).join() + tt.s.toFixed(2) : "";
    if (drawn && !resized && key === lastKey && tintKey === lastTint && now - lastAt < (window.__mobile ? 250 : 66)) return;
    lastKey = key; lastTint = tintKey; lastAt = now; drawn = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
    const a = vp.pixelFromPoint(new OpenSeadragon.Point(X0 / 1000, -Y1 / 1000), true), b = vp.pixelFromPoint(new OpenSeadragon.Point(X1 / 1000, -Y0 / 1000), true);
    // the two cloud variants, crossfaded (additive, so it is a true blend of both)
    const t = phase();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 - t; ctx.drawImage(masks[0], a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.globalAlpha = t; ctx.drawImage(masks[1], a.x, a.y, b.x - a.x, b.y - a.y);
    // past the mask: solid cloud, slid in underneath (drawn first and then added to, the overlap summed to a white line)
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "destination-over";
    const cell = (b.x - a.x) / MW, ins = Math.max(2, cell * 3);   // overlaps the mask's solid border a little: no gap
    ctx.fillStyle = "rgb(234,234,234)";
    ctx.beginPath(); ctx.rect(0, 0, cw, ch); ctx.rect(a.x + ins, a.y + ins, b.x - a.x - ins * 2, b.y - a.y - ins * 2); ctx.fill("evenodd");
    ctx.globalCompositeOperation = "source-over";
    // dusk and night: the same tint the map gets, laid over the clouds only
    const tint = window.atmo?.tint;
    if (tint && tint.s > 0.01) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = Math.min(0.9, tint.s);
      ctx.fillStyle = `rgb(${tint.m.map((v) => Math.round(v * 0.93)).join(",")})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    }
  }
  requestAnimationFrame(frame);
})();
// zoomed all the way out, the view stops at the clear ring and a band of cloud around it
(function () {
  const vp = window.viewer.viewport, h = window.__fogHome;
  if (!h || !vp.setHomeBounds) return;
  vp.setHomeBounds(new OpenSeadragon.Rect(h.x / 1000, -h.y / 1000, h.w / 1000, h.h / 1000), window.viewer.world.getContentFactor());
  vp.applyConstraints();
})();
