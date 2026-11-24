// City lights after dark: warm streetlight pools along every street (lit windows were tried and dropped).
// Fades in through dusk, out at dawn; drawn above the night tint.
(async function () {
  while (!(window.__transit && window.__traffic && window.__grids && window.atmo)) await new Promise((r) => setTimeout(r, 300));
  const viewer = window.viewer, { toImage, geo } = window.__transit, grids = window.__grids;

  // ---- streetlights: every ~34 m along each street, at the kerb ----
  const lamps = [];
  const G = window.__transit.G;
  // every street gets lamps, not just the ones cars are allowed on (that check drops streets whose height reading
  // went onto a roof, which left whole blocks of North Beach dark); each lamp sits at street level from the ground grid
  for (const p of window.__traffic.paths) {
    if (p.hw === "service" || p.len < 12) continue;
    const off = (p.oneway ? p.lanes * 1.6 : p.lanes * 3.1) + 2.2;
    for (let s = 17 + (p.i % 3) * 5; s < p.len; s += 34) {
      let i = 1; while (i < p.s.length - 1 && p.s[i] < s) i++;
      const a = p.pts[i - 1], b = p.pts[i], L = p.s[i] - p.s[i - 1] || 1, f = (s - p.s[i - 1]) / L, dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
      const w = [a[0] + (b[0] - a[0]) * f - dz * off, a[1] + (b[1] - a[1]) * f + 0.2, a[2] + (b[2] - a[2]) * f + dx * off];
      const g = G.ground(w[0], w[2]);
      if (!p.elev && g != null && w[1] - g > 3) w[1] = g + 0.2;   // its height reading landed on a roof: put it back at street level
      const q = toImage(w);
      lamps.push(q[0], q[1], q[2], p.hw === "motorway" ? 1 : 0);
    }
  }
  // a lamp is hidden when the visible surface there is nearer than it by more than tol metres (behind a building, not a tree)
  const dg = geo.depthGrid, depth = grids.depth;
  const hidden = (q, tol = 7) => { const x = Math.round(q[0] / dg.scale), y = Math.round(q[1] / dg.scale); if (x < 0 || y < 0 || x >= dg.w || y >= dg.h) return false; return grids.dm(y * dg.w + x) < q[2] - tol; };

  // a soft warm glow, pre-drawn once
  const sprite = document.createElement("canvas"); sprite.width = sprite.height = 64;
  { const s = sprite.getContext("2d"), g = s.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,196,110,0.95)"); g.addColorStop(0.25, "rgba(255,170,80,0.45)"); g.addColorStop(1, "rgba(255,150,60,0)"); s.fillStyle = g; s.fillRect(0, 0, 64, 64); }

  // Happy Donuts (24th & Church) never closes: after dark its shopfront is drawn lit, sign and all (a night version of
  // that corner from the same drawing, cut to the shop), at its place in the full-size drawing
  const HDN = { x: 26058, y: 23868, w: 300, h: 160, img: null };
  { const im = new Image(); im.onload = () => { HDN.img = im; lastKey = ""; }; im.src = "people/happy-donuts-night.webp?v=" + (window.__cv || ""); }

  const box = viewer.canvas, cv = Object.assign(document.createElement("canvas"), { className: "sky-lights" });
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  box.insertBefore(cv, box.querySelector(".sky-fog"));
  const ctx = cv.getContext("2d");

  // the lamps don't move: redraw only when the view, the window size or the darkness changes
  let lastKey = "";
  function frame() {
    requestAnimationFrame(frame);
    const alt = window.atmo.alt, night = Math.max(0, Math.min(1, (-alt - 1.5) / 8));
    const dpr = window.__softDpr || window.__dpr || 1, cw = box.clientWidth, ch = box.clientHeight;
    const on = night > 0 && window.__vehiclesOff !== "lights";
    const mi = window.mapItem, o = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), e = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(1000, 0));
    const key = on ? `${o.x},${o.y},${e.x},${cw},${ch},${night.toFixed(3)}` : "off";
    if (key === lastKey && cv.width === Math.round(cw * dpr)) return;
    lastKey = key;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
    if (!on) return;
    const k = (e.x - o.x) / 1000, pxPerM = k / geo.mpp;
    if (pxPerM < 0.05) return;
    ctx.globalCompositeOperation = "lighter";
    // streetlights: a pool of light on the road, brighter as you zoom in
    const r = Math.max(1.6, 7 * pxPerM), pad = r;
    ctx.globalAlpha = night * Math.min(0.7, 0.3 + pxPerM * 0.2);
    for (let i = 0; i < lamps.length; i += 4) {
      const x = o.x + lamps[i] * k, y = o.y + lamps[i + 1] * k;
      if (x < -pad || y < -pad || x > cw + pad || y > ch + pad) continue;
      if (hidden([lamps[i], lamps[i + 1], lamps[i + 2]])) continue;   // behind a building
      const rr = lamps[i + 3] ? r * 1.25 : r;
      ctx.drawImage(sprite, x - rr, y - rr * 0.62, rr * 2, rr * 1.24);
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    if (HDN.img) { const x = o.x + HDN.x * k, y = o.y + HDN.y * k; if (x < cw && y < ch && x + HDN.w * k > 0 && y + HDN.h * k > 0) { ctx.globalAlpha = night; ctx.drawImage(HDN.img, x, y, HDN.w * k, HDN.h * k); ctx.globalAlpha = 1; } }
  }
  requestAnimationFrame(frame);
})();
