// lat/long -> map pixel, shared by the viewer and its layers. Needs geo.json; heights come from ground.bin (IsoGeo.load).
(function (root) {
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
  function ecef(lat, lon, h) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180, n = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
    return [(n + h) * Math.cos(la) * Math.cos(lo), (n + h) * Math.cos(la) * Math.sin(lo), (n * (1 - E2) + h) * Math.sin(la)];
  }
  const mul = (m, v) => [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]);

  // a gzipped, row-delta-coded Uint16 grid -> Uint16Array
  async function grid(url, cells) {
    // the grid must have exactly the cells geo.json describes; if a stale cached copy slips through, fetch it fresh
    for (const cache of ["default", "reload"]) {
      const res = await fetch(url, { cache, priority: "low" });   // the drawing's tiles come first
      const raw = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      if (raw.byteLength === cells * 2 || cache === "reload") return new Int16Array(raw);
    }
  }
  function undelta(d, w) {
    const out = new Uint16Array(d.length);
    for (let i = 0; i < d.length; i += w) { let v = 0; for (let x = 0; x < w; x++) { v = (v + d[i + x]) & 0xffff; out[i + x] = v; } }
    return out;
  }
  // fetches both grids; resolves to { ground, top, depth } kept as the packed 16-bit values (half the memory of floats,
  // which matters on phones) plus dm(i), the depth at cell i in metres
  async function load(geo) {
    const g = geo.ground, dg = geo.depthGrid;
    const v = geo.gv ? "?v=" + geo.gv : "";
    const [gd, dd] = await Promise.all([grid("ground.bin" + v, g.n * g.n * 2), grid("depth.bin" + v, dg.w * dg.h)]);
    const gu = undelta(gd, g.n), du = undelta(dd, dg.w);
    const n2 = g.n * g.n, k = dg.span / 65535;
    return { ground: gu.subarray(0, n2), top: gu.subarray(n2), depth: du, dm: (i) => dg.lo + du[i] * k };
  }

  function make(geo, grids /* from load(), or null */) {
    const G = geo.ground;
    function sample(arr, x, z, smooth) {
      if (!arr) return null;
      const fx = (x + G.half) / G.res - 0.5, fz = (z + G.half) / G.res - 0.5;
      const i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= G.n - 1 || j >= G.n - 1) return null;
      if (!smooth) return arr[Math.round(fz) * G.n + Math.round(fx)] / G.scale - G.offset;
      const tx = fx - i, tz = fz - j, a = arr[j * G.n + i], b = arr[j * G.n + i + 1], c = arr[(j + 1) * G.n + i], d = arr[(j + 1) * G.n + i + 1];
      return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) / G.scale - G.offset;
    }
    const ground = (x, z) => sample(grids && grids.ground, x, z, true);   // street level, smoothly
    const heightAt = (x, z) => sample(grids && grids.top, x, z, false);  // the top surface right here (a bridge deck)
    function toWorld(lat, lon, lift = 0) {
      const w = mul(geo.ecefToWorld, ecef(lat, lon, -30));
      const g = ground(w[0], w[2]);
      if (g != null) w[1] = g + lift;
      return w;
    }
    function toPixel(lat, lon, lift = 0) {
      const c = mul(geo.worldToCamera, toWorld(lat, lon, lift));
      return { x: (c[0] - geo.x0) / geo.mpp, y: (geo.y1 - c[1]) / geo.mpp, depth: -c[2] };
    }
    function toPixelAt(lat, lon, y) {  // a point at an absolute world height (metres above roughly sea level)
      const w = mul(geo.ecefToWorld, ecef(lat, lon, -30)); w[1] = y;
      const c = mul(geo.worldToCamera, w);
      return { x: (c[0] - geo.x0) / geo.mpp, y: (geo.y1 - c[1]) / geo.mpp, depth: -c[2] };
    }
    return { toWorld, toPixel, toPixelAt, ground, heightAt };
  }
  root.IsoGeo = { make, load };
})(typeof window !== "undefined" ? window : globalThis);
