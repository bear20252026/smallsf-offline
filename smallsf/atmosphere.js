// Real sky over the map: light follows the actual sun over SF (day, golden hour, dusk, blue hour, night),
// and Open-Meteo's current weather adds fog, cloud shade and rain.
// Preview any mix with the URL: ?sun=-4 (sun altitude in degrees) or ?time=2026-11-10T16:50, plus ?weather=fog|rain|cloudy|clear
// (?at= is a shared view's place, not a time); ?fogtime=2026-10-05T16:30Z paints the satellite's fog from that moment
(async function () {
  const viewer = window.viewer;
  const LAT = 37.7936, LON = -122.3965;
  const q = new URLSearchParams(location.search);

  // ---- sun altitude (degrees), after Agafonkin's SunCalc ----
  function sunAltitude(date) {
    const rad = Math.PI / 180, d = date / 864e5 - 0.5 + 2440588 - 2451545;
    const M = rad * (357.5291 + 0.98560028 * d);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const e = rad * 23.4397, dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const H = rad * (280.16 + 360.9856235 * d) + rad * LON - ra, phi = rad * LAT;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  }

  // ---- light keyframes by sun altitude: multiply tint (darkens + colours) and a soft glow ----
  // [alt, multiply rgb, multiply strength, glow rgb, glow strength, vehicle brightness]
  const KEYS = [
    [-18, [38, 52, 98], 0.80, [40, 60, 120], 0.10, 0.45],   // night
    [-10, [52, 66, 120], 0.70, [70, 80, 150], 0.12, 0.5],   // late blue hour
    [-5, [92, 88, 150], 0.50, [220, 120, 150], 0.18, 0.65], // dusk / dawn
    [-1, [190, 130, 140], 0.32, [255, 140, 90], 0.22, 0.8], // sun on the horizon
    [5, [255, 196, 150], 0.22, [255, 170, 90], 0.16, 0.92], // golden hour
    [14, [255, 236, 210], 0.08, [255, 220, 170], 0.05, 1],
    [25, [255, 255, 255], 0, [255, 255, 255], 0, 1],        // plain day
  ];
  function light(alt) {
    if (alt <= KEYS[0][0]) return KEYS[0];
    if (alt >= KEYS.at(-1)[0]) return KEYS.at(-1);
    let i = 1; while (KEYS[i][0] < alt) i++;
    const a = KEYS[i - 1], b = KEYS[i], f = (alt - a[0]) / (b[0] - a[0]), mix = (x, y) => (Array.isArray(x) ? x.map((v, k) => v + (y[k] - v) * f) : x + (y - x) * f);
    return a.map((v, k) => mix(v, b[k]));
  }

  // ---- weather ----
  let wx = { visibility: 20000, cloud: 0, precip: 0, code: 0, temp: null, windDir: 270, windMph: 5 };
  const forced = q.get("weather");
  async function weather() {
    if (forced) {
      wx = { ...wx, ...{ fog: { visibility: 400, cloud: 100, code: 45 }, rain: { precip: 1.5, cloud: 100, visibility: 6000, code: 63 }, cloudy: { cloud: 90, code: 3 }, clear: {} }[forced] };
      return;
    }
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,cloud_cover,visibility,precipitation,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles`;
      const c = (await fetch(u).then((r) => r.json())).current;
      wx = { visibility: c.visibility, cloud: c.cloud_cover, precip: c.precipitation, code: c.weather_code, temp: c.temperature_2m, windDir: c.wind_direction_10m, windMph: c.wind_speed_10m };
      fetchedAt = Date.now();
    } catch { setTimeout(weather, 30e3); }   // offline at load (laptop just woke): try again soon, not in 10 minutes
  }
  let fetchedAt = 0;
  weather();   // not awaited: the light follows the sun from the first frame; clouds and fog join when Open-Meteo answers (it can take seconds)
  setInterval(weather, 10 * 60e3);
  // background tabs get their timers paused; catch up as soon as the map is looked at again
  const stale = () => { if (Date.now() - fetchedAt > 5 * 60e3) weather(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) stale(); });
  addEventListener("online", stale); addEventListener("focus", stale);
  const isFog = () => wx.code === 45 || wx.code === 48 || wx.visibility < 3000;

  // ---- where the fog actually is: GOES-West low cloud on a ~0.5 km grid (api/fog), every 10 min, ~30-40 min behind ----
  // ?weather= previews skip it (they paint the old citywide fog). sat.d is 0..255 per cell, row 0 at the north edge.
  let sat = null, satAt = 0, field = null;
  async function satellite() {
    if (forced) return;
    try {
      const r = await fetch("api/fog" + (q.get("fogtime") ? "?time=" + encodeURIComponent(q.get("fogtime")) : "")); if (!r.ok) throw 0;
      const j = await r.json(), d = Uint8Array.from(atob(j.d), (c) => c.charCodeAt(0));
      sat = { ...j, d, any: d.some((v) => v > 40) }; satAt = Date.now(); field = null;
    } catch { setTimeout(satellite, 60e3); }
  }
  satellite(); setInterval(satellite, 10 * 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - satAt > 8 * 60e3) satellite(); });
  // fog 0..1 at a place (bilinear), for the status line
  window.__fogAtLL = (lat, lon) => {
    if (!sat) return null;
    const [x0, y0, x1, y1] = sat.bbox, fx = (lon - x0) / (x1 - x0) * sat.w - 0.5, fy = (y1 - lat) / (y1 - y0) * sat.h - 0.5;
    const cl = (v, n) => Math.max(0, Math.min(n - 1, v)), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const at = (a, b) => sat.d[cl(b, sat.h) * sat.w + cl(a, sat.w)] / 255;
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
  };
  // the grid as a soft alpha image, padded with its edge values so the fog doesn't stop at a line
  const PADC = 12, UP = 8;
  function buildField() {
    const w = sat.w + PADC * 2, h = sat.h + PADC * 2, small = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const sx = small.getContext("2d"), img = sx.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const a = sat.d[Math.max(0, Math.min(sat.h - 1, j - PADC)) * sat.w + Math.max(0, Math.min(sat.w - 1, i - PADC))];
      const k = (j * w + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a;
    }
    sx.putImageData(img, 0, 0);
    const big = Object.assign(document.createElement("canvas"), { width: w * UP, height: h * UP }), bx = big.getContext("2d");
    bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = "high"; bx.filter = `blur(${UP * 0.9}px)`;
    bx.drawImage(small, 0, 0, w * UP, h * UP);
    field = { cv: big, w, h };
    if (G && !dom.sat) {
      const [x0, y0, x1, y1] = sat.bbox, ps = [[y0, x0], [y0, x1], [y1, x0], [y1, x1]].map(([la, lo]) => G.toPixelAt(la, lo, 10));
      const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
      dom = { sat: true, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      seedBanks();
    }
  }
  const G = window.IsoGeo && window.__geo ? IsoGeo.make(window.__geo, null) : null;

  // ---- layers: inside the map's canvas box, above the tiles but under the pins ----
  const box = viewer.canvas;
  // Night tint as an SVG colour matrix on the map canvas, not a mix-blend-mode layer: in some browsers (Arc, 11/18)
  // a multiply layer over the WebGL map drew it solid black after dark. ?tint=blend brings back the old layer.
  let tintFilter = null;
  if (q.get("tint") !== "blend") {
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), f = document.createElementNS(ns, "filter"), m = document.createElementNS(ns, "feColorMatrix");
    svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
    f.setAttribute("id", "sf-tint"); f.setAttribute("color-interpolation-filters", "sRGB"); m.setAttribute("type", "matrix");
    f.appendChild(m); svg.appendChild(f); document.body.appendChild(svg);
    tintFilter = { m, last: "" };
  }
  const mult = Object.assign(document.createElement("div"), { className: "sky-mult" });
  const glow = Object.assign(document.createElement("div"), { className: "sky-glow" });
  const fogC = Object.assign(document.createElement("canvas"), { className: "sky-fog" });
  const rainC = Object.assign(document.createElement("canvas"), { className: "sky-rain" });
  const anchor = box.querySelector("canvas")?.nextSibling || null;
  for (const el of [mult, glow, fogC, rainC]) box.insertBefore(el, anchor);
  const style = document.createElement("style");
  style.textContent = `.sky-mult,.sky-glow,.sky-fog,.sky-rain{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .sky-mult{mix-blend-mode:multiply}.sky-glow{mix-blend-mode:soft-light}`;
  document.head.appendChild(style);

  // Fog banks live in map coordinates, so they pan with the city, and drift downwind
  const W = window.mapItem.getContentSize().x;
  const SC = W / 10240;  // banks were tuned on the 10,240px photo map
  // banks fill a box of the map image and wrap round inside it: the drawing by default, the satellite's whole area with it
  let dom = { x0: -W * 0.2, x1: W * 1.2, y0: -W * 0.15, y1: W * 0.95 }, banks = [];
  function seedBanks() {
    const n = Math.min(450, Math.round(70 * ((dom.x1 - dom.x0) * (dom.y1 - dom.y0)) / (W * W * 1.54)));
    banks = Array.from({ length: n }, () => ({ x: dom.x0 + Math.random() * (dom.x1 - dom.x0), y: dom.y0 + Math.random() * (dom.y1 - dom.y0), r: (500 + Math.random() * 1400) * SC * (dom.sat ? 1.5 : 1), a: 0.4 + Math.random() * 0.6, s: Math.random() }));
  }
  seedBanks();
  const drops = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), l: 0.5 + Math.random() }));
  let last = performance.now();

  function setStyle(el, bg, op) {   // compares against what we last wrote (reading el.style back is slower than writing)
    const o = op.toFixed(3), hide = op < 0.004, was = el._was || (el._was = {});
    if (!hide && was.bg !== bg) el.style.background = was.bg = bg;
    if (was.o !== o) el.style.opacity = was.o = o;
    if (was.hide !== hide) el.style.display = (was.hide = hide) ? "none" : "";
  }
  let fogDrawn = true, rainDrawn = true;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const at = q.get("time") ? new Date(q.get("time")) : new Date();
    const alt = q.has("sun") ? +q.get("sun") : sunAltitude(at);
    const [, m, ms, g, gs, vb] = light(alt);
    // clouds flatten the light: less colour, a touch darker
    const overcast = Math.min(1, wx.cloud / 100) * 0.6 + (isFog() ? 0.3 : 0);
    const mm = m.map((v) => v * (1 - overcast * 0.12));
    // styles only when they change (each write costs a style pass), and the blend layers off when they'd be invisible
    const tc = document.getElementById("transit");
    if (tintFilter) {
      // the same multiply, as a colour matrix on the map's own canvas (no blend layer: some GPUs draw a multiply
      // layer over the WebGL map as solid black)
      const a = Math.min(0.9, ms + overcast * 0.12), k = mm.map((v) => (1 - a + a * v / 255).toFixed(3)).join();
      if (k !== tintFilter.last) { tintFilter.last = k; const [r, gg, b] = k.split(","); tintFilter.m.setAttribute("values", `${r} 0 0 0 0  0 ${gg} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`); }
      const c = viewer.canvas.querySelector("canvas"); if (c && c.style.filter !== "url(#sf-tint)") c.style.filter = "url(#sf-tint)";
      setStyle(mult, "", 0); setStyle(glow, "", 0);
    } else {
      setStyle(mult, `rgb(${mm.map(Math.round)})`, Math.min(0.9, ms + overcast * 0.12));
      setStyle(glow, `rgb(${g.map(Math.round)})`, gs * (1 - overcast * 0.7));
    }
    const flt = vb < 0.99 ? `brightness(${Math.max(0.8, vb).toFixed(2)})` : "";   // vehicles dim with the light, but never so far that the live dots vanish at night
    if (tc && tc._flt !== flt) tc.style.filter = tc._flt = flt;
    window.atmo = { alt, wx, sat, night: alt < -6, tint: { m: mm, s: Math.min(0.9, ms + overcast * 0.12) } };

    const cw = box.clientWidth, ch = box.clientHeight;
    let dpr = window.__softDpr || 1;   // the fog banks are soft: few pixels; the rain's thin streaks get the full density
    for (const [c, d] of [[fogC, dpr], [rainC, window.__dpr || 1]]) if (c.width !== Math.round(cw * d) || c.height !== Math.round(ch * d)) { c.width = Math.round(cw * d); c.height = Math.round(ch * d); }

    // fog
    const fx = fogC.getContext("2d");
    // with the satellite: fog banks wherever it sees low cloud, cut to its shape below; without it: the station's word, citywide
    const useSat = sat && G;
    // zoomed in on a neighbourhood, you're under the fog rather than looking down on it: it thins as the view narrows
    // (full from ~2.5 km across, a faint veil by ~350 m), so the streets under it can still be read
    let near = 1;
    { const mi = window.mapItem, mpp = window.__geo?.mpp; if (mi && mpp) { const kk = mi.viewportToImageZoom(viewer.viewport.getZoom(true)), across = cw / kk * mpp;
      near = Math.max(0.12, Math.min(1, (across - 350) / (2500 - 350))); near = near * near * (3 - 2 * near); near = Math.max(0.12, near); } }
    const thick = near * (useSat ? (sat.any ? 0.95 : 0) : isFog() ? Math.min(1, Math.max(0.25, 1 - wx.visibility / 3000)) : wx.cloud > 85 ? 0.12 : 0);
    if (thick > 0 || fogDrawn) { fx.setTransform(dpr, 0, 0, dpr, 0, 0); fx.clearRect(0, 0, cw, ch); fogDrawn = thick > 0; }
    if (thick > 0) {
      const mi = window.mapItem, o = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0)), e = mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(W, 0)), k = (e.x - o.x) / W;
      // wind blows *from* windDir; on screen, map-west is roughly screen-up-left for this camera
      const toward = ((wx.windDir + 180) % 360) * Math.PI / 180, speed = (6 + wx.windMph * 2.5) * SC;   // image px per second
      const vx = Math.sin(toward - 65 * Math.PI / 180) * speed, vy = -Math.cos(toward - 65 * Math.PI / 180) * speed * 0.7;
      const night = alt < -6, col = night ? "185,195,220" : "246,248,250";
      fx.globalCompositeOperation = "source-over";
      for (const b of banks) {
        b.x += vx * dt * (0.6 + b.s * 0.8); b.y += vy * dt * (0.6 + b.s * 0.8);
        const dw = dom.x1 - dom.x0, dh = dom.y1 - dom.y0;
        if (b.x > dom.x1) b.x -= dw; if (b.x < dom.x0) b.x += dw;
        if (b.y > dom.y1) b.y -= dh; if (b.y < dom.y0) b.y += dh;
        const sx = o.x + b.x * k, sy = o.y + b.y * k, sr = b.r * k;
        if (sx + sr < 0 || sy + sr < 0 || sx - sr > cw || sy - sr > ch) continue;
        const gr = fx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        gr.addColorStop(0, `rgba(${col},${(useSat ? 0.7 : 0.55) * thick * b.a})`); gr.addColorStop(1, `rgba(${col},0)`);
        fx.fillStyle = gr; fx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
      fx.fillStyle = `rgba(${col},${(useSat ? 0.42 : 0.25) * thick})`; fx.fillRect(0, 0, cw, ch);   // the overall haze
      if (useSat) {
        // keep the fog only where the satellite has it: lat/lon -> screen is affine at street level (orthographic camera)
        if (!field) buildField();
        const [x0, y0, x1, y1] = sat.bbox, dx = (x1 - x0) / sat.w, dy = (y1 - y0) / sat.h;
        const scr = (lat, lon) => { const p = G.toPixelAt(lat, lon, 10); return mi.imageToViewerElementCoordinates(new OpenSeadragon.Point(p.x, p.y)); };
        const p0 = scr(y1 + PADC * dy, x0 - PADC * dx), px = scr(y1 + PADC * dy, x1 + PADC * dx), py = scr(y0 - PADC * dy, x0 - PADC * dx);
        const fw = field.w * UP, fh = field.h * UP;
        fx.globalCompositeOperation = "destination-in";
        fx.setTransform(dpr * (px.x - p0.x) / fw, dpr * (px.y - p0.y) / fw, dpr * (py.x - p0.x) / fh, dpr * (py.y - p0.y) / fh, dpr * p0.x, dpr * p0.y);
        fx.drawImage(field.cv, 0, 0);
        fx.setTransform(dpr, 0, 0, dpr, 0, 0); fx.globalCompositeOperation = "source-over";
      }
    }

    // rain
    // Open-Meteo's precipitation lags a cloudburst; the weather code (drizzle 51-57, rain 61-67, showers 80-82, storm 95+) sets a floor
    const codeRate = { 53: 0.2, 55: 0.35, 57: 0.35, 61: 0.3, 63: 0.8, 65: 1.5, 66: 0.3, 67: 1, 80: 0.5, 81: 1, 82: 1.5, 95: 1.5, 96: 1.5, 99: 1.5 }[wx.code] || 0;
    const rate = Math.max(wx.precip || 0, codeRate);
    const rx = rainC.getContext("2d"), raining = rate > 0.05;
    dpr = window.__dpr || 1;
    if (raining || rainDrawn) { rx.setTransform(dpr, 0, 0, dpr, 0, 0); rx.clearRect(0, 0, cw, ch); rainDrawn = raining; }
    if (raining) {
      const n = Math.min(drops.length, 60 + rate * 120);
      rx.strokeStyle = alt < -6 ? "rgba(200,210,235,0.35)" : "rgba(255,255,255,0.45)"; rx.lineWidth = 1;
      rx.beginPath();
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        d.y += dt * 1.6 * d.l; d.x += dt * 0.15; if (d.y > 1) { d.y -= 1; d.x = Math.random(); } if (d.x > 1) d.x -= 1;
        const x = d.x * cw, y = d.y * ch; rx.moveTo(x, y); rx.lineTo(x - 3 * d.l, y - 14 * d.l);
      }
      rx.stroke();
    }
  }
  requestAnimationFrame(frame);

  // ---- the little weather tag ----
  const tag = document.getElementById("sky");
  const words = (c) => (c === 0 ? "Clear" : c <= 2 ? "Partly cloudy" : c === 3 ? "Overcast" : c === 45 || c === 48 ? "Fog" : c >= 51 && c <= 67 ? "Rain" : c >= 80 && c <= 82 ? "Showers" : c >= 95 ? "Thunder" : "Cloudy");
  function phase(alt) { return alt > 6 ? "Day" : alt > -0.8 ? "Golden hour" : alt > -6 ? (new Date().getHours() < 12 ? "Dawn" : "Dusk") : alt > -12 ? "Blue hour" : "Night"; }
  setInterval(() => {
    if (!tag || tag.hidden || !window.atmo) return;   // the interface's status line says this now
    const w = isFog() && wx.code < 45 ? "Fog" : words(wx.code);
    tag.textContent = `${wx.temp != null ? Math.round(wx.temp) + "°F · " : ""}${w} · ${phase(window.atmo.alt)}`;
  }, 1000);
})();
