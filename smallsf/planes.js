// Live aircraft overhead, from ADS-B (api/planes: adsb.fi open data, relayed and shared for 5 s). Each plane is drawn
// at its real altitude with its shadow on the city below, and carried along its track at its ground speed and climb
// rate between updates. Below about 20,000 ft only: higher, at this 45° view, a plane is drawn kilometres from where
// it is and reads as noise. transit.js draws them (window.__planes) on top of everything else and handles clicks.
(async () => {
  while (!window.__transit) await new Promise((r) => setTimeout(r, 300));
  const { G } = window.__transit;
  const planes = new Map();   // hex -> { r: latest fix (+ at: its time, x, z, dx, dz), off: [x, y, z] easing out, offT }
  let offset = 0, src = "";
  const FT = 0.3048, KN = 0.514444, FPM = 0.00508, CEIL = 6100;   // m per ft, m/s per knot, m/s per ft/min; ceiling in m

  function raw(p, now) {   // where its latest fix puts it now, by its track, speed and climb (at most a minute on)
    const r = p.r, dt = Math.min(60, Math.max(0, (now - r.at) / 1000)), v = r.gs * KN;
    return [r.x + r.dx * v * dt, Math.max(0, r.alt * FT + r.vr * FPM * dt), r.z + r.dz * v * dt];
  }
  function pos(p, now) {   // plus whatever jump a fresh fix made, eased out over ~3 s
    const w = raw(p, now);
    if (p.off) { const f = Math.exp(-(now - p.offT) / 1500); if (f < 0.01) p.off = null; else for (let i = 0; i < 3; i++) w[i] += p.off[i] * f; }
    return w;
  }
  async function load() {
    try {
      const j = await fetch("api/planes", { cache: "no-store" }).then((r) => r.json());
      offset = j.now - Date.now(); src = j.src || "";
      const now = Date.now() + offset, seen = new Set();
      for (const a of j.ac || []) {
        if (typeof a.alt !== "number" || a.alt * FT > CEIL) continue;
        seen.add(a.h);
        const w = G.toWorld(a.lat, a.lon), h = a.trk * Math.PI / 180;
        const n = G.toWorld(a.lat + 0.001 * Math.cos(h), a.lon + 0.001 * Math.sin(h) / Math.cos(a.lat * Math.PI / 180));
        const L = Math.hypot(n[0] - w[0], n[2] - w[2]) || 1;
        let p = planes.get(a.h);
        const before = p ? pos(p, now) : null;
        if (!p) planes.set(a.h, (p = { h: a.h }));
        p.r = { ...a, at: j.now - (a.age || 0) * 1000, x: w[0], z: w[2], dx: (n[0] - w[0]) / L, dz: (n[2] - w[2]) / L, g: w[1] };
        if (before) { const after = raw(p, now), d = [before[0] - after[0], before[1] - after[1], before[2] - after[2]]; if (Math.hypot(...d) < 3000) { p.off = d; p.offT = now; } }
      }
      for (const [h, p] of planes) if (!seen.has(h) && now - p.r.at > 30e3) planes.delete(h);
      window.__planeCount = planes.size;
    } catch { window.__planeCount ??= 0; }
  }
  load(); setInterval(() => { if (!document.hidden && !window.__planesOff) load(); }, 6000);

  // ---- what it looks like: each common type built from its real length and span, in the shape of its family ----
  const SIZE = { A1: 9, A2: 15, A3: 38, A4: 47, A5: 66, A6: 16, A7: 13 };
  const HELI = new Set(["B06", "B407", "B429", "R44", "R66", "EC35", "EC30", "EC45", "AS50", "AS55", "H125", "H130", "H135", "H145", "S76", "A109", "A139", "B412", "UH60", "MD52"]);
  const LIGHT = /^(C1[5-9]\d|C2[0-9]\d|C208|PA\d\d|P28A|P28R|SR2\d|DA4\d|DA20|BE3\d|M20P|M20T|PC12|TBM\d|C77R|C82R|A5)$/;
  const TAIL = { UAL: "#1b3f8b", SKW: "#1b3f8b", SWA: "#304cb2", ASA: "#01426a", QXE: "#01426a", DAL: "#c01933", AAL: "#9da6ab", JBU: "#2e5aac", FFT: "#2f7d3a", NKS: "#f6e500", HAL: "#4e2a84", ACA: "#d22630", WJA: "#00a1b2", BAW: "#1d3c6e", DLH: "#0a1d3d", AFR: "#002157", KLM: "#00a1de", EVA: "#00703c", CPA: "#006564", ANA: "#13448f", JAL: "#cc0000", KAL: "#00a3e0", AAR: "#9e8e75", SIA: "#f2a900", QFA: "#e40000", ANZ: "#111111", CAL: "#c8102e", UAE: "#c8102e", QTR: "#5c0632", THY: "#c8102e", VIR: "#da0530", AMX: "#0b2343", VOI: "#a12b8f", FDX: "#4d148c", UPS: "#351c15", AAY: "#f7a800", MXY: "#00a9ce", VXP: "#4a2e83" };
  // fuselages that aren't white from above
  const BODY = { SWA: "#304cb2", AAL: "#cdd2d6", NKS: "#f6e500", KAL: "#bfe3f2", UPS: "#5a3d2b", FFT: "#f2f2ee", ANZ: "#1d1d1d" };
  const ENGC = { UAL: "#1b3f8b", SKW: "#1b3f8b", DAL: "#c01933", ASA: "#01426a", QXE: "#01426a", AAL: "#9da6ab", SWA: "#304cb2", JBU: "#2e5aac", HAL: "#4e2a84", UAE: "#c8a252" };
  // families: fuselage width fw, sweep, root/tip chord as share of span, wing root's leading edge (share of length
  // ahead of centre), engines [share of half-span, diameter, length] (a negative share = on the rear fuselage),
  // tailplane span as share of span, fin height, wingtip, high wing, T-tail, propellers
  const FAM = {
    a320:  { fw: 3.95, sw: 25, rc: 0.19, tc: 0.045, le: 0.07, eng: [[0.34, 1.9, 4.3]], ht: 0.35, fin: 5.6, tip: "sharklet" },
    neo:   { fw: 3.95, sw: 25, rc: 0.19, tc: 0.045, le: 0.07, eng: [[0.34, 2.3, 4.7]], ht: 0.35, fin: 5.6, tip: "sharklet" },
    b737:  { fw: 3.76, sw: 25, rc: 0.2, tc: 0.045, le: 0.08, eng: [[0.31, 1.9, 4.0]], ht: 0.36, fin: 5.8, tip: "blended" },
    max:   { fw: 3.76, sw: 25, rc: 0.2, tc: 0.045, le: 0.08, eng: [[0.31, 2.2, 4.6]], ht: 0.36, fin: 5.8, tip: "scimitar" },
    a220:  { fw: 3.7, sw: 24, rc: 0.18, tc: 0.045, le: 0.06, eng: [[0.33, 2.0, 4.2]], ht: 0.34, fin: 5.2, tip: "fence" },
    b757:  { fw: 3.76, sw: 25, rc: 0.2, tc: 0.045, le: 0.1, eng: [[0.34, 2.2, 5.0]], ht: 0.4, fin: 7, tip: "blended" },
    b767:  { fw: 5.0, sw: 31, rc: 0.19, tc: 0.045, le: 0.08, eng: [[0.33, 2.7, 6.0]], ht: 0.39, fin: 8, tip: "blended" },
    b777:  { fw: 6.2, sw: 31.6, rc: 0.2, tc: 0.04, le: 0.09, eng: [[0.33, 3.4, 7.3]], ht: 0.33, fin: 9.3, tip: "raked" },
    b787:  { fw: 5.8, sw: 32, rc: 0.18, tc: 0.035, le: 0.08, eng: [[0.33, 2.9, 6.6]], ht: 0.32, fin: 8.6, tip: "raked" },
    a330:  { fw: 5.64, sw: 30, rc: 0.18, tc: 0.04, le: 0.08, eng: [[0.33, 2.8, 6.0]], ht: 0.32, fin: 8.6, tip: "sharklet" },
    a350:  { fw: 5.96, sw: 31.9, rc: 0.19, tc: 0.035, le: 0.08, eng: [[0.33, 3.0, 6.5]], ht: 0.29, fin: 8.8, tip: "curl" },
    b747:  { fw: 6.5, sw: 37.5, rc: 0.21, tc: 0.04, le: 0.12, eng: [[0.4, 2.6, 6.0], [0.69, 2.6, 6.0]], ht: 0.34, fin: 10, tip: "blended" },
    a380:  { fw: 7.1, sw: 33.5, rc: 0.22, tc: 0.04, le: 0.1, eng: [[0.38, 3.0, 6.6], [0.64, 3.0, 6.6]], ht: 0.38, fin: 11, tip: "fence" },
    ejet:  { fw: 3.0, sw: 23, rc: 0.2, tc: 0.05, le: 0.06, eng: [[0.3, 1.6, 3.6]], ht: 0.4, fin: 4.8, tip: "blended" },
    crj:   { fw: 2.7, sw: 26, rc: 0.17, tc: 0.05, le: 0.02, eng: [[-1, 1.4, 3.6]], ht: 0.36, fin: 4.2, tip: "blended", t: 1 },
    biz:   { fw: 2.5, sw: 30, rc: 0.19, tc: 0.05, le: 0.0, eng: [[-1, 1.3, 3.4]], ht: 0.34, fin: 3.6, tip: "blended", t: 1 },
    tprop: { fw: 2.7, sw: 3, rc: 0.09, tc: 0.055, le: 0.1, eng: [[0.3, 1.25, 5.2]], ht: 0.3, fin: 4.4, hi: 1, t: 1, prop: 1.9 },
    light: { fw: 1.4, sw: 0, rc: 0.14, tc: 0.12, le: 0.12, eng: [], ht: 0.31, fin: 1.4, hi: 1, nose: 0.95 },
    gaLow: { fw: 1.4, sw: 2, rc: 0.14, tc: 0.09, le: 0.08, eng: [], ht: 0.33, fin: 1.4, nose: 0.95 },
  };
  // type -> [family, length m, span m]
  const TYPES = {
    A318: ["a320", 31.4, 34.1], A319: ["a320", 33.8, 35.8], A320: ["a320", 37.6, 35.8], A321: ["a320", 44.5, 35.8], A19N: ["neo", 33.8, 35.8], A20N: ["neo", 37.6, 35.8], A21N: ["neo", 44.5, 35.8],
    B736: ["b737", 31.2, 35.8], B737: ["b737", 33.6, 35.8], B738: ["b737", 39.5, 35.8], B739: ["b737", 42.1, 35.8], B37M: ["max", 35.6, 35.9], B38M: ["max", 39.5, 35.9], B39M: ["max", 42.2, 35.9], B3XM: ["max", 43.8, 35.9],
    BCS1: ["a220", 35, 35.1], BCS3: ["a220", 38.7, 35.1], B752: ["b757", 47.3, 38], B753: ["b757", 54.4, 38], B762: ["b767", 48.5, 47.6], B763: ["b767", 54.9, 47.6], B764: ["b767", 61.4, 51.9],
    B772: ["b777", 63.7, 60.9], B77L: ["b777", 63.7, 64.8], B77W: ["b777", 73.9, 64.8], B778: ["b777", 70.9, 71.8], B779: ["b777", 76.7, 71.8], B788: ["b787", 57, 60.1], B789: ["b787", 62.8, 60.1], B78X: ["b787", 68.3, 60.1],
    A332: ["a330", 58.8, 60.3], A333: ["a330", 63.7, 60.3], A338: ["a330", 58.8, 64], A339: ["a330", 63.7, 64], A359: ["a350", 66.8, 64.8], A35K: ["a350", 73.8, 64.8], B744: ["b747", 70.7, 64.4], B748: ["b747", 76.3, 68.4], A388: ["a380", 72.7, 79.8],
    E170: ["ejet", 29.9, 26], E75L: ["ejet", 31.7, 26], E75S: ["ejet", 31.7, 26], E190: ["ejet", 36.2, 28.7], E195: ["ejet", 38.7, 28.7], E290: ["ejet", 36.2, 33.7], E295: ["ejet", 41.5, 35.1],
    CRJ2: ["crj", 26.8, 21.2], CRJ7: ["crj", 32.3, 23.2], CRJ9: ["crj", 36.2, 24.9], DH8D: ["tprop", 32.8, 28.4], DH8C: ["tprop", 25.7, 27.4], AT75: ["tprop", 27.2, 27.1], AT76: ["tprop", 27.2, 27.1], AT45: ["tprop", 22.7, 24.6],
    GLF4: ["biz", 26.9, 23.7], GLF5: ["biz", 29.4, 28.5], GLF6: ["biz", 30.4, 30.4], GA6C: ["biz", 30.4, 30.4], GA7C: ["biz", 33.5, 31.4], GL5T: ["biz", 29.5, 28.7], GLEX: ["biz", 30.3, 28.7], GL7T: ["biz", 33.8, 31.7], CL30: ["biz", 20.9, 19.5], CL35: ["biz", 20.9, 21], CL60: ["biz", 20.9, 19.6],
    C68A: ["biz", 19.4, 22], C680: ["biz", 19.4, 19.4], C700: ["biz", 22.9, 22], C56X: ["biz", 16, 17.2], C560: ["biz", 14.9, 15.9], C25A: ["biz", 14.4, 14.3], C25B: ["biz", 15.6, 15.5], C25C: ["biz", 16.3, 15.5], E55P: ["biz", 15.6, 16.2], E50P: ["biz", 12.8, 12.3], PC24: ["biz", 16.9, 17], LJ45: ["biz", 17.7, 14.6], LJ75: ["biz", 17.7, 15.5], F2TH: ["biz", 20.2, 19.3], FA7X: ["biz", 23.4, 26.2], FA8X: ["biz", 24.5, 26.3], HDJT: ["biz", 13, 12.1],
    C172: ["light", 8.3, 11], C182: ["light", 8.8, 11], C152: ["light", 7.3, 10.2], C206: ["light", 8.6, 11], C208: ["light", 11.5, 15.9], SR20: ["gaLow", 7.9, 11.7], SR22: ["gaLow", 7.9, 11.7], SR22T: ["gaLow", 7.9, 11.7], P28A: ["gaLow", 7.3, 10.7], P28R: ["gaLow", 7.6, 10.8], PA28: ["gaLow", 7.3, 10.7], PC12: ["gaLow", 14.4, 16.3], TBM9: ["gaLow", 10.7, 12.8], TBM7: ["gaLow", 10.6, 12.8], DA40: ["gaLow", 8.1, 11.9], BE36: ["gaLow", 8.4, 10.2],
  };
  // LTA Research's Pathfinder 1 (Moffett Field) and Goodyear's Zeppelin NTs
  const SHIPS = { N125LT: [124.5, 20], N1A: [75.1, 14.2], N2A: [75.1, 14.2], N3A: [75.1, 14.2] };
  const SHIPNAME = { N125LT: "LTA Research Pathfinder 1" };
  const BYCAT = { A1: ["gaLow", 8, 11], A2: ["biz", 16, 16], A3: ["a320", 38, 35.8], A4: ["b757", 47, 38], A5: ["b777", 66, 62], A6: ["biz", 18, 17] };
  const spec = (r) => {
    if (r._sp && r._sp.ty === r.t) return r._sp;
    // airships (type SHIP, or lighter-than-air category B2): length and envelope diameter, by registration when known
    if (r.t === "SHIP" || r.c === "B2") { const [L, D] = SHIPS[r.r] || [75, 14]; return (r._sp = { ty: r.t, fam: "ship", ship: 1, L, D, S: D * 1.7, fw: D, fin: D * 0.35 }); }
    const [fam, L, S] = TYPES[r.t] || (LIGHT.test(r.t) ? ["light", 8.5, 11] : BYCAT[r.c] || (r.t ? ["a320", 36, 35] : ["gaLow", 9, 11]));
    return (r._sp = { ty: r.t, fam, L, S, ...FAM[fam] });
  };
  const airlineOf = (r) => (/^[A-Z]{3}\d/.test(r.f || "") ? r.f.slice(0, 3) : "");
  const sz = (r) => (kindOf(r) === "heli" ? 13 : spec(r).L);
  const unknown = (r) => !r.t && !r.c;
  const slowHeli = (r) => unknown(r) && r.gs < 50;
  const kindOf = (r) => (HELI.has(r.t) || r.c === "A7" || slowHeli(r) ? "heli" : /^(light|gaLow)$/.test(spec(r).fam) ? "light" : "jet");

  // the outline, in metres: a forward from its centre, b to the right, h up. at(a, b, h) -> screen.
  function parts(P) {
    const L = P.L, S = P.S / 2, fw = P.fw, rf = fw / 2, tan = Math.tan(P.sw * Math.PI / 180);
    const nose = P.nose ? 0.06 : 0.12;
    const fus = [[L / 2, 0], [L / 2 - 0.025 * L, rf * 0.62], [L / 2 - nose * 0.6 * L, rf * 0.92], [L / 2 - nose * L, rf], [-L / 2 + 0.24 * L, rf], [-L / 2 + 0.05 * L, rf * 0.3], [-L / 2, rf * 0.08]];
    const aR = P.le * L + (P.rc * P.S) / 2, rc = P.rc * P.S, tc = P.tc * P.S;
    const leAt = (b) => aR - tan * (b - rf * 0.8);
    const kb = rf + (S - rf) * 0.32;
    const wing = P.sw > 10
      ? [[aR, rf * 0.8], [leAt(S), S], [leAt(S) - tc, S], [leAt(kb) - Math.max(tc * 1.6, rc * 0.55), kb], [aR - rc, rf * 0.8]]
      : [[aR, rf * 0.8], [aR - (rc - tc) * 0.25, S], [aR - (rc - tc) * 0.25 - tc, S], [aR - rc, rf * 0.8]];
    const hS = (P.ht * P.S) / 2, hc = L * (P.nose ? 0.11 : 0.085), hLE = -L / 2 + L * (P.t ? 0.1 : 0.16), htan = Math.tan((P.sw > 10 ? P.sw + 6 : 4) * Math.PI / 180);
    const tail = [[hLE, rf * 0.3], [hLE - htan * hS, hS], [hLE - htan * hS - hc * 0.45, hS], [hLE - hc, rf * 0.3]];
    const fH = P.fin, fc = L * (P.nose ? 0.13 : 0.17), fLE = -L / 2 + L * (P.nose ? 0.16 : 0.2), ftan = Math.tan((P.sw > 10 ? 40 : 18) * Math.PI / 180);
    const fin = [[fLE, rf * 0.7], [fLE - ftan * fH - fc * 0.1, rf * 0.7 + fH], [fLE - ftan * fH - fc * 0.55, rf * 0.7 + fH], [Math.max(-L / 2 + 0.01 * L, fLE - fc), rf * 0.7]];
    const eng = P.eng.map(([f, d, l]) => f < 0
      ? { a: -L / 2 + L * 0.33, b: rf + d * 0.55, d, l, rear: 1 }
      : { a: leAt(rf + (S - rf) * f) + l * (P.prop ? 0.45 : 0.62), b: rf + (S - rf) * f, d, l });
    // a T-tail sits on the fin's top, its leading edge a little behind the fin's
    const tOff = P.t ? fin[1][0] - hLE - fc * 0.08 : 0;
    return { fus, wing, tail, fin, eng, tipLE: leAt(S), S, tc, rf, tH: P.t ? rf * 0.7 + fH : 0, tOff };
  }
  const mirror = (pts) => [...pts, ...pts.slice().reverse().map(([a, b]) => [a, -b])];
  // draws one plane through at(); colours by airline; lw = outline width
  function drawPlane(ctx, P, op, at, lw, t) {
    if (P.ship) return drawShip(ctx, P, at, lw);
    const G = parts(P), poly = (pts, h, fill) => { ctx.beginPath(); pts.forEach(([a, b], i) => { const q = at(a, b, h); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (lw) ctx.stroke(); };
    const side = (pts, fill) => { ctx.beginPath(); pts.forEach(([a, h], i) => { const q = at(a, 0, h); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (lw) ctx.stroke(); };
    ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = "rgba(25,32,38,0.5)";
    const al = op.al, body = BODY[al] || "#f5f4f0", tailC = TAIL[al] || "#c9ced2", engC = ENGC[al] || "#b9bfc4", wingC = "#cfd5da";
    const nacelle = (e, s, h) => {
      const r = e.d / 2, b = s * e.b;
      poly([[e.a, b - r * 0.85], [e.a - e.l * 0.15, b - r], [e.a - e.l, b - r * 0.55], [e.a - e.l, b + r * 0.55], [e.a - e.l * 0.15, b + r], [e.a, b + r * 0.85]], h, engC);
      const f0 = at(e.a, b - r * 0.8, h), f1 = at(e.a, b + r * 0.8, h);   // the intake
      ctx.save(); ctx.strokeStyle = "#2a3036"; ctx.lineWidth = Math.max(lw, 1.2); ctx.beginPath(); ctx.moveTo(f0[0], f0[1]); ctx.lineTo(f1[0], f1[1]); ctx.stroke(); ctx.restore();
    };
    const prop = (a, b, h, R) => {   // a spinning disc
      const p0 = at(a, b - R, h), p1 = at(a, b + R, h);
      ctx.save(); ctx.globalAlpha *= 0.35; ctx.strokeStyle = "#39424a"; ctx.lineWidth = Math.max(1, lw * 1.5); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); ctx.restore();
    };
    const under = P.hi ? 0 : -G.rf * 0.5, wingH = P.hi ? G.rf * 0.9 : -G.rf * 0.2;
    // underwing engines first (the wing hides their back half), then the wing, body, tailplane, fin
    for (const e of G.eng) if (!e.rear && !P.hi) for (const s of [-1, 1]) nacelle(e, s, under);
    if (!P.hi) poly(mirror(G.wing), wingH, wingC);
    poly(mirror(G.fus), 0, body);
    // cockpit windows
    const cw = [[P.L / 2 - P.L * 0.028, G.rf * 0.5], [P.L / 2 - P.L * (P.nose ? 0.06 : 0.045), G.rf * 0.78]];
    ctx.save(); ctx.lineWidth = 0; poly(mirror(cw), G.rf * 0.3, "#2b3540"); ctx.restore();
    if (P.hi) { poly(mirror(G.wing), wingH, wingC); for (const e of G.eng) for (const s of [-1, 1]) { nacelle(e, s, wingH + e.d * 0.3); prop(e.a + 0.1, s * e.b, wingH + e.d * 0.3, P.prop); } }
    if (P.nose) prop(P.L / 2 + 0.1, 0, 0, P.nose);
    for (const e of G.eng) if (e.rear) for (const s of [-1, 1]) nacelle(e, s, G.rf * 0.3);
    if (!P.t) poly(mirror(G.tail), G.rf * 0.25, wingC);
    side(G.fin.map(([a, h]) => [a, h]), tailC);
    if (P.t) poly(mirror(G.tail).map(([a, b]) => [a + G.tOff, b]), G.tH, wingC);
    // wingtips: a little upturned fin where the real ones have one (two on the MAX: the split scimitar)
    if (P.tip && P.tip !== "raked" && !P.hi) {
      const h = P.S * (P.tip === "fence" ? 0.03 : P.tip === "scimitar" ? 0.066 : 0.065);
      for (const s of [-1, 1]) {
        const a0 = G.tipLE, b = s * G.S;
        const up = [[a0 - G.tc * 0.1, wingH], [a0 - G.tc * 0.55 - h * 0.5, wingH + h], [a0 - G.tc * 0.95 - h * 0.5, wingH + h], [a0 - G.tc, wingH]];
        ctx.beginPath(); up.forEach(([a, hh], i) => { const q = at(a, b, hh); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fillStyle = tailC; ctx.fill(); if (lw) ctx.stroke();
        if (P.tip === "scimitar") { const q0 = at(a0 - G.tc * 0.3, b, wingH), q1 = at(a0 - G.tc * 0.1 - 0.4, b, wingH - 1.2); ctx.save(); ctx.strokeStyle = tailC; ctx.lineWidth = Math.max(1, lw * 2); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke(); ctx.restore(); }
      }
    }
    return G;
  }
  // an airship: a silver envelope (the outline of its sections, seen through the camera), X-tail fins, a gondola
  const shipR = (P, a) => { const u = a / (P.L / 2); return (P.D / 2) * Math.sqrt(Math.max(0, 1 - u * u)) * (u < 0 ? 1 - 0.25 * u * u : 1); };
  function hull(pts) {
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of pts) { while (lo.length > 1 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length > 1 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function drawShip(ctx, P, at, lw) {
    const L = P.L / 2, R = P.D / 2, N = 28, M = 16;
    ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = "rgba(25,32,38,0.5)";
    const fill = (pts, c) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); if (lw) ctx.stroke(); };
    const fins = (upper) => {
      for (const th of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) {
        if ((Math.sin(th) > 0) !== upper) continue;
        const a0 = -L * 0.93, a1 = -L * 0.66, c = Math.cos(th), s = Math.sin(th), o = R * 0.45;
        fill([[a1, shipR(P, a1)], [a0, shipR(P, a0)], [a0 - R * 0.05, shipR(P, a0) + o], [a1 - R * 0.35, shipR(P, a1) + o * 0.6]].map(([a, r]) => at(a, r * c, r * s)), "#b9c0c6");
      }
    };
    // the gondola, under its front half
    fill([[L * 0.32, -R * 0.12], [L * 0.05, -R * 0.12], [L * 0.05, R * 0.12], [L * 0.32, R * 0.12]].map(([a, b]) => at(a, b, -R * 1.02)), "#5c656d");
    fins(false);
    const pts = [];
    for (let i = 0; i <= N; i++) { const a = -L + (2 * L * i) / N, r = shipR(P, a); for (let j = 0; j < M; j++) { const th = (j / M) * Math.PI * 2; pts.push(at(a, r * Math.cos(th), r * Math.sin(th))); } }
    fill(hull(pts), "#d3d8dc");
    // light on its back, and the frame's rings
    ctx.save(); ctx.globalAlpha *= 0.55; fill(hull(Array.from({ length: N + 1 }, (_, i) => { const a = -L * 0.92 + (1.84 * L * i) / N, r = shipR(P, a); return [at(a, r * 0.45, r * 0.9), at(a, -r * 0.45, r * 0.9)]; }).flat()), "#f1f3f4"); ctx.restore();
    ctx.save(); ctx.strokeStyle = "rgba(60,70,80,0.18)"; ctx.lineWidth = Math.max(0.5, lw * 0.8);
    for (let i = 1; i < 9; i++) { const a = -L + (2 * L * i) / 9, r = shipR(P, a); ctx.beginPath(); for (let j = 0; j <= 12; j++) { const th = (j / 12) * Math.PI; const q = at(a, r * Math.cos(th), r * Math.sin(th)); j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } ctx.stroke(); }
    ctx.restore();
    fins(true);
  }
  // a helicopter: cabin, tail boom and fin, skids, and the main rotor turning (local metres, ~13 m long)
  const HELIP = { L: 13, S: 11, fin: 1.6, fw: 2, ship: 0 };
  function drawHeli(ctx, at, lw, t) {
    ctx.lineJoin = "round"; ctx.lineWidth = lw; ctx.strokeStyle = "rgba(25,32,38,0.5)";
    const fill = (pts, c) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); if (lw) ctx.stroke(); };
    const line = (a, b, w, c) => { ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore(); };
    for (const s of [-1, 1]) line(at(3, s * 1.2, -1.4), at(-2.2, s * 1.2, -1.4), Math.max(1, lw * 1.6), "#4a525a");   // skids
    line(at(-1.5, 0, 0.4), at(-7.2, 0, 0.9), Math.max(1.5, lw * 3), "#d9dcdf");   // tail boom
    fill([[-6.4, 0.9], [-7.6, 2.6], [-8, 2.6], [-7.4, 0.9]].map(([a, h]) => at(a, 0, h)), "#c9ced2");   // fin
    const body = []; for (let i = 0; i < 20; i++) { const th = (i / 20) * Math.PI * 2; body.push(at(0.8 + Math.cos(th) * 2.6, Math.sin(th) * 1.15, 0)); }
    fill(body, "#ece9e2");
    fill([[3.1, 0.7], [3.35, 0], [3.1, -0.7], [2.3, -0.9], [2.3, 0.9]].map(([a, b]) => at(a, b, 0.3)), "#2b3540");   // windscreen
    for (let i = 0; i < 2; i++) { const th = t * 9 + i * Math.PI / 2, c = Math.cos(th) * 5.5, d = Math.sin(th) * 5.5; line(at(0.4 - c, -d, 1.5), at(0.4 + c, d, 1.5), Math.max(1, lw * 1.4), "rgba(60,66,72,0.6)"); }
  }
  function footprint(ctx, P, at) {   // its shadow: wing, body and tailplane, flat
    if (P.ship) { ctx.beginPath(); for (let i = 0; i <= 40; i++) { const a = -P.L / 2 + (P.L * i) / 40, q = at(a, shipR(P, a)); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } for (let i = 40; i >= 0; i--) { const a = -P.L / 2 + (P.L * i) / 40, q = at(a, -shipR(P, a)); ctx.lineTo(q[0], q[1]); } ctx.fill(); return; }
    const G = parts(P), poly = (pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => { const q = at(a, b); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fill(); };
    poly(mirror(G.wing)); poly(mirror(G.fus)); poly(mirror(G.tail).map(([a, b]) => [a + G.tOff, b]));
  }

  window.__planes = (ctx, scr, pxPerM, Wc, Hc, sel) => {
    const hits = [];
    if (window.__planesOff) return hits;
    const now = Date.now() + offset, night = (window.atmo?.night || 0) > 0.5, t = performance.now() / 1000;
    const list = [], home = window.__fogHome, vp = viewer.viewport;
    let onMap = 0;
    for (const p of planes.values()) {
      const w = pos(p, now), s = scr(w);
      // over the whole map (the view fully zoomed out), for the Layers count; viewport units are camera km
      if (home) { const v = vp.pointFromPixel(new OpenSeadragon.Point(s[0], s[1]), true), cx = v.x * 1000, cy = -v.y * 1000; if (cx >= home.x && cx <= home.x + home.w && cy <= home.y && cy >= home.y - home.h) onMap++; }
      // off screen: skipped, except the one being followed (the camera needs to know where it went)
      if (p !== sel && (s[0] < -150 || s[1] < -150 || s[0] > Wc + 150 || s[1] > Hc + 150)) continue;
      list.push({ p, w, s });
    }
    // the status line counts what's actually on screen, not everything within range (most of that is around SFO)
    window.__planesOnMap = home ? onMap : null;
    window.__planesInView = list.filter(({ s }) => s[0] > 0 && s[1] > 0 && s[0] < Wc && s[1] < Hc).length;
    list.sort((a, b) => a.w[1] - b.w[1]);   // lower first, so a plane above draws over one below
    for (const { p, w, s } of list) {
      const r = p.r, L0 = sz(r), k = Math.max(1, 26 / (L0 * pxPerM)), L = L0 * k, kind = kindOf(r);
      const g = G.ground(w[0], w[2]) ?? r.g ?? 0;
      // local frame: forward along its track, right across it, in world x/z; drawn k times its size when it would be tiny
      const fx = r.dx, fz = r.dz, rx = -fz, rz = fx;
      const at = (a, b, y) => scr([w[0] + (fx * a + rx * b) * L, y, w[2] + (fz * a + rz * b) * L]);
      const atM = (a, b, h) => scr([w[0] + (fx * a + rx * b) * k, w[1] + h * k, w[2] + (fz * a + rz * b) * k]);
      const agl = w[1] - g;
      // its shadow, straight down on the city: sharp low down, gone by ~8,000 ft and after dark
      if (!night && agl < 2500) {
        ctx.globalAlpha = 0.28 * (1 - agl / 2500); ctx.fillStyle = "#0b1418";
        if (kind === "heli") { const q = at(0, 0, g), q2 = at(0.5, 0, g); ctx.beginPath(); ctx.ellipse(q[0], q[1], Math.hypot(q2[0] - q[0], q2[1] - q[1]), Math.hypot(q2[0] - q[0], q2[1] - q[1]) * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
        else footprint(ctx, spec(r), (a, b) => scr([w[0] + (fx * a + rx * b) * k, g, w[2] + (fz * a + rz * b) * k]));
      }
      ctx.globalAlpha = 1; ctx.lineJoin = "round"; ctx.lineWidth = 0.8; ctx.strokeStyle = "rgba(25,32,38,0.55)";
      const y = w[1];
      if (kind === "heli") {
        const c = at(0, 0, y), n = at(0.5, 0, y), R = Math.hypot(n[0] - c[0], n[1] - c[1]);
        ctx.fillStyle = "#e9e6df"; ctx.beginPath(); ctx.ellipse(c[0], c[1], R * 0.42, R * 0.26, Math.atan2(n[1] - c[1], n[0] - c[0]), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const tb = at(-0.6, 0, y); ctx.strokeStyle = "#e9e6df"; ctx.lineWidth = Math.max(1.2, R * 0.08); ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(tb[0], tb[1]); ctx.stroke();
        ctx.strokeStyle = "rgba(240,240,236,0.55)"; ctx.lineWidth = Math.max(1, R * 0.05);   // the rotor, turning
        for (let i = 0; i < 2; i++) { const a = t * 18 + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(c[0] - Math.cos(a) * R, c[1] - Math.sin(a) * R * 0.6); ctx.lineTo(c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R * 0.6); ctx.stroke(); }
      } else drawPlane(ctx, spec(r), { al: airlineOf(r) }, atM, L0 * k * pxPerM > 60 ? 0.8 : 0.5, t);
      // lights: red to the left, green to the right, a white strobe; a landing light low on approach
      if (night || pxPerM > 0.6) {
        const tipL = at(kind === "heli" ? 0 : -0.14, kind === "heli" ? -0.25 : -0.5, y), tipR = at(kind === "heli" ? 0 : -0.14, kind === "heli" ? 0.25 : 0.5, y);
        const dot = (q, col, rad) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[0], q[1], rad, 0, Math.PI * 2); ctx.fill(); };
        const rr = night ? 2.2 : 1.4;
        dot(tipL, "#ff3b30", rr); dot(tipR, "#34c759", rr);
        if ((t + (parseInt(p.h, 16) % 97) / 97) % 1.2 < 0.08) { ctx.globalAlpha = 0.9; dot(at(0, 0, y), "#ffffff", night ? 5 : 3); ctx.globalAlpha = 1; }
        if (night && agl < 900 && r.vr <= 0) { const nose = at(0.55, 0, y), g2 = ctx.createRadialGradient(nose[0], nose[1], 0, nose[0], nose[1], 14); g2.addColorStop(0, "rgba(255,250,225,0.9)"); g2.addColorStop(1, "rgba(255,250,225,0)"); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(nose[0], nose[1], 14, 0, Math.PI * 2); ctx.fill(); }
      }
      // zoomed out a plane is a few pixels of white, lost against the fog: a dark callsign pill above it, like the
      // route pills on buses and trains in that band
      if (pxPerM < 0.7) {
        const label = r.f || r.r || (r.h.startsWith("~") ? "?" : kind === "heli" ? "Heli" : "Plane"), h = 15, ty = s[1] - Math.max(14, L * pxPerM * 0.5) - 6;
        ctx.font = "700 10px -apple-system, sans-serif";
        const txt = "✈ " + label, tw = ctx.measureText(txt).width + 10;
        ctx.fillStyle = "#24323d"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(s[0] - tw / 2, ty - h / 2, tw, h, h / 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(txt, s[0], ty + 0.5);
        hits.push({ x: s[0], y: ty, r: Math.max(10, tw / 2), plane: p });
      }
      if (p === sel) {
        const rad = Math.max(16, L * pxPerM * 0.7);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(s[0], s[1], rad, rad * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
      }
      hits.push({ x: s[0], y: s[1], r: Math.max(14, L * pxPerM * 0.55), plane: p });
    }
    return hits;
  };

  // ---- its card ----
  const AIRLINE = { UAL: "United", SWA: "Southwest", ASA: "Alaska", DAL: "Delta", AAL: "American", JBU: "JetBlue", SKW: "SkyWest", QXE: "Horizon", FFT: "Frontier", NKS: "Spirit", HAL: "Hawaiian", AAY: "Allegiant", ACA: "Air Canada", WJA: "WestJet", BAW: "British Airways", DLH: "Lufthansa", AFR: "Air France", KLM: "KLM", EVA: "EVA Air", CPA: "Cathay Pacific", ANA: "ANA", JAL: "Japan Airlines", KAL: "Korean Air", AAR: "Asiana", SIA: "Singapore Airlines", QFA: "Qantas", ANZ: "Air New Zealand", CAL: "China Airlines", UAE: "Emirates", QTR: "Qatar Airways", THY: "Turkish Airlines", VIR: "Virgin Atlantic", AMX: "Aeroméxico", VOI: "Volaris", FDX: "FedEx", UPS: "UPS", CCA: "Air China", CES: "China Eastern", CSN: "China Southern", PAL: "Philippine Airlines", EIN: "Aer Lingus", IBE: "Iberia", SAS: "SAS", FIN: "Finnair", ICE: "Icelandair", MXY: "Breeze", VXP: "Avelo", CFG: "Condor", AIC: "Air India", ETD: "Etihad", SWR: "Swiss", AUA: "Austrian", STK: "Starlux", VJT: "VistaJet", EJA: "NetJets", CPZ: "Compass", ENY: "Envoy", RPA: "Republic", ASH: "Mesa", GTI: "Atlas Air", ABX: "ABX Air", CKS: "Kalitta", PCM: "PenAir", CXA: "XiamenAir", HKE: "HK Express", PAC: "Polar Air Cargo", CLX: "Cargolux" };
  const TYPE = { A19N: "Airbus A319neo", A319: "Airbus A319", A320: "Airbus A320", A20N: "Airbus A320neo", A321: "Airbus A321", A21N: "Airbus A321neo", A332: "Airbus A330-200", A333: "Airbus A330-300", A339: "Airbus A330-900", A359: "Airbus A350-900", A35K: "Airbus A350-1000", A388: "Airbus A380", BCS1: "Airbus A220-100", BCS3: "Airbus A220-300", B737: "Boeing 737-700", B738: "Boeing 737-800", B739: "Boeing 737-900", B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9", B3XM: "Boeing 737 MAX 10", B752: "Boeing 757-200", B753: "Boeing 757-300", B763: "Boeing 767-300", B764: "Boeing 767-400", B772: "Boeing 777-200", B77L: "Boeing 777-200LR", B77W: "Boeing 777-300ER", B778: "Boeing 777-8", B779: "Boeing 777-9", B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10", B744: "Boeing 747-400", B748: "Boeing 747-8", E75L: "Embraer 175", E75S: "Embraer 175", E170: "Embraer 170", E190: "Embraer 190", E195: "Embraer 195", E290: "Embraer E190-E2", CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900", DH8D: "Dash 8-400", AT76: "ATR 72", C172: "Cessna 172", C182: "Cessna 182", C208: "Cessna Caravan", SR22: "Cirrus SR22", SR20: "Cirrus SR20", PC12: "Pilatus PC-12", B06: "Bell 206", B407: "Bell 407", R44: "Robinson R44", R66: "Robinson R66", EC35: "Airbus H135", H135: "Airbus H135", EC45: "Airbus H145", H145: "Airbus H145", AS50: "Airbus AS350", H125: "Airbus H125", S76: "Sikorsky S-76", GLF5: "Gulfstream G550", GLF6: "Gulfstream G650", GL7T: "Bombardier Global 7500", CL35: "Bombardier Challenger 350", C68A: "Cessna Latitude", E55P: "Embraer Phenom 300", PC24: "Pilatus PC-24" };
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // where it's flying, from adsbdb.com's route database (by callsign; airlines only), looked up once per flight
  const routes = new Map();
  function route(r) {
    if (!r.f || !/^[A-Z]{3}\d/.test(r.f)) return null;
    if (!routes.has(r.f)) {
      routes.set(r.f, undefined);
      fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(r.f)}`).then((x) => x.json()).then((j) => {
        const fr = j?.response?.flightroute;
        // a flight number can cover several legs (Southwest's do) and the database knows one of them: keep it only
        // if the plane is roughly on the way, measured where it was when we asked
        const km = (a, b, c, d) => { const R = Math.PI / 180, x = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
        const ok = fr && fr.origin && fr.destination && (() => {
          const o = fr.origin, d = fr.destination, direct = km(o.latitude, o.longitude, d.latitude, d.longitude);
          return km(o.latitude, o.longitude, r.lat, r.lon) + km(r.lat, r.lon, d.latitude, d.longitude) < direct * 1.08 + 60;
        })();
        routes.set(r.f, ok ? fr : null); if (fr) routes.set(r.f + "#raw", fr);
      }).catch(() => routes.set(r.f, null));
    }
    return routes.get(r.f);
  }
  // the airports a plane over the city is likely leaving or landing at
  const AIRPORTS = [["SFO", "San Francisco", 37.6213, -122.379], ["OAK", "Oakland", 37.7126, -122.2197], ["SJC", "San Jose", 37.3626, -121.929], ["HWD", "Hayward", 37.6589, -122.1217], ["SQL", "San Carlos", 37.5119, -122.2495], ["PAO", "Palo Alto", 37.4611, -122.1151], ["NUQ", "Moffett Field", 37.4161, -122.049], ["HAF", "Half Moon Bay", 37.5134, -122.5012], ["CCR", "Concord", 37.9897, -122.0569]];
  const kmTo = (a, b, c, d) => { const R = Math.PI / 180, x = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  // low, climbing away from an airport: it just left it; low, descending toward one: it's about to land there
  function phase(r) {
    if (r.alt > 9000 || Math.abs(r.vr) < 300) return null;
    const h = r.trk * Math.PI / 180, fx = Math.sin(h), fy = Math.cos(h);
    let best = null;
    for (const [code, name, la, lo] of AIRPORTS) {
      const d = kmTo(r.lat, r.lon, la, lo); if (d > 45) continue;
      const ex = (lo - r.lon) * Math.cos(r.lat * Math.PI / 180), ey = la - r.lat, cos = (ex * fx + ey * fy) / (Math.hypot(ex, ey) || 1);
      const toward = cos > 0;
      // sure: low, close and pointed at (or straight away from) the field, within ~40°: then it beats the route database
      const sure = r.alt < 4000 && d < 25 && Math.abs(cos) > 0.76;
      if (r.vr > 0 && !toward && (!best || d < best.d)) best = { d, code, name, dep: true, sure: sure && cos < 0 };
      if (r.vr < 0 && toward && (!best || d < best.d)) best = { d, code, name, dep: false, sure: sure && cos > 0 };
    }
    return best;
  }
  const city = (ap) => `${esc(ap.municipality || ap.name)} <span class="iata">${esc(ap.iata_code || ap.icao_code)}</span>`;
  // ---- the flight's own radio, on request: its last two ATC calls from Enhanced Radar, and the newest one's recording ----
  // Nothing is fetched until a reader presses the button (api/atc caps what it spends and shares each answer).
  const atc = new Map();   // callsign -> { state: "loading"|"done"|"off"|"none", calls }
  let atcAudio = null;
  const atcHTML = (cs) => {
    const a = atc.get(cs);
    if (!a) return `<button class="atcbtn" data-atc="${esc(cs)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>Hear its radio calls</button>`;
    if (a.state === "loading") return `<p class="atcmeta">Tuning in…</p>`;
    if (a.state === "off") return `<p class="atcmeta">The radio's off for ${a.off === "month" ? "this month" : "today"}. Back soon.</p>`;
    if (!a.calls.length) return `<p class="atcmeta">Nothing heard from it on the frequencies we can hear in the last 45 minutes.</p>`;
    const ago = (t) => { const m = Math.round((Date.now() - Date.parse(t)) / 60e3); return m < 1 ? "just now" : m === 1 ? "1 min ago" : m + " min ago"; };
    const L = a.calls.slice().reverse();   // oldest first, so it reads as the exchange it was; the recording is the newest
    return `<div class="atc">${L.map((c, i) => `<p class="atcl"><span class="who">${c.who === "atc" ? "Controller" : "Pilot"} · ${ago(c.at)}</span>${esc(c.text)}${i === L.length - 1 && a.audio !== false ? `<button class="atcplay" data-clip="${esc(c.id)}" aria-label="Play the recording">${a.playing ? "■" : "▶"}</button>` : ""}</p>`).join("")}</div>
      <p class="atcmeta">Radio via <a href="https://enhancedradar.com" target="_blank" rel="noopener">Enhanced Radar</a></p>`;
  };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("[data-atc]"), pl = e.target.closest?.("[data-clip]");
    if (b) {
      const cs = b.dataset.atc; atc.set(cs, { state: "loading", calls: [] }); b.outerHTML = atcHTML(cs);
      window.track?.("plane: radio");
      try { const j = await fetch("api/atc?cs=" + encodeURIComponent(cs)).then((r) => r.json()); atc.set(cs, { state: j.off && !j.calls?.length ? "off" : "done", off: j.off, calls: j.calls || [] }); }
      catch { atc.set(cs, { state: "done", calls: [] }); }
      return;
    }
    if (pl) {
      const id = pl.dataset.clip, a = [...atc.values()].find((x) => x.calls?.[0]?.id === id);
      if (atcAudio && !atcAudio.paused) { atcAudio.pause(); if (a) a.playing = false; if (atcAudio.dataset.id === id) return; }
      atcAudio = new Audio("api/atc-audio?id=" + encodeURIComponent(id)); atcAudio.dataset.id = id;
      if (a) a.playing = true;
      atcAudio.onended = () => { if (a) a.playing = false; };
      atcAudio.onerror = () => { if (a) { a.playing = false; a.audio = false; } };
      atcAudio.play().catch(() => { if (a) a.playing = false; });
      window.track?.("plane: radio audio");
    }
  });
  {
    const st = document.createElement("style");
    st.textContent = `#card .atcbtn { all: unset; display: inline-flex; align-items: center; gap: 8px; margin: 4px 0 6px; padding: 8px 13px 8px 11px; border-radius: 999px; background: var(--u-coral, #e85d4a); color: #fff; font: 600 13px/1 var(--u-sans); cursor: pointer; }
      #card .atcbtn svg { width: 12px; height: 12px; fill: currentColor; }
      #card .atc { margin: 6px 0 2px; border-left: 2px solid var(--u-line); padding-left: 10px; }
      #card .atcl { margin: 0 0 8px; font: italic 400 16px/1.3 var(--u-serif); color: var(--u-ink); }
      #card .atcl .who { display: block; font: 600 10.5px/1.4 var(--u-sans); letter-spacing: .06em; text-transform: uppercase; color: var(--u-mute); font-style: normal; }
      #card .atcplay { all: unset; cursor: pointer; margin-left: 8px; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--u-coral, #e85d4a); color: #fff; font: 600 10px/1 var(--u-sans); vertical-align: 2px; }
      #card .atcmeta { margin: 2px 0 8px; font: 12px/1.4 var(--u-sans); color: var(--u-mute); }`;
    document.head.appendChild(st);
  }
  window.__planeCard = (p) => {
    const r = p.r, now = Date.now() + offset, w = pos(p, now), ft = Math.round(w[1] / FT / 25) * 25;
    const al = AIRLINE[r.f.slice(0, 3)] && /^[A-Z]{3}\d/.test(r.f) ? AIRLINE[r.f.slice(0, 3)] : "", ty = TYPE[r.t] || r.t || "";
    const tisb = r.h.startsWith("~");
    const what = spec(r).ship ? SHIPNAME[r.r] || "Airship" : [al, ty].filter(Boolean).join(" · ") || (slowHeli(r) ? `Probably a helicopter: ${Math.round(r.gs)} kn is slower than planes fly` : kindOf(r) === "heli" ? "Helicopter" : unknown(r) ? "Type unknown" : "Aircraft");
    const climb = Math.abs(r.vr) < 300 ? "level" : r.vr > 0 ? `climbing ${(Math.round(r.vr / 100) * 100).toLocaleString("en-US")} ft/min` : `descending ${(Math.round(-r.vr / 100) * 100).toLocaleString("en-US")} ft/min`;
    const ago = Math.max(0, Math.round((now - r.at) / 1000)), name = r.f || r.r || (r.h.startsWith("~") ? "Unidentified aircraft" : r.h.toUpperCase());
    const fa = r.f ? `<a href="https://www.flightaware.com/live/flight/${encodeURIComponent(r.f)}" target="_blank" rel="noopener">FlightAware ↗</a> · ` : "";
    const ph = phase(r), raw = routes.get(r.f + "#raw");
    let rt = route(r);
    // flight numbers get reused (regional ones especially), so the database can hold an old leg that happens to pass
    // near here: a plane clearly landing at or leaving a field that isn't that route's end overrides it
    if (rt && ph?.sure && (ph.dep ? rt.origin?.iata_code : rt.destination?.iata_code) !== ph.code) rt = null;
    const apHTML = (code, name) => `${esc(name)} <span class="iata">${code}</span>`;
    // when the database's route doesn't fit, say what the flight itself shows, keeping a database end that matches
    const phLine = !rt && ph ? `<p class="route">${ph.dep ? `Just left ${apHTML(ph.code, ph.name)}${raw && raw.origin?.iata_code === ph.code ? ` → ${city(raw.destination)}` : ""}` : `${raw && raw.destination?.iata_code === ph.code ? `${city(raw.origin)} → ` : "Coming in to land at "}${apHTML(ph.code, ph.name)}`}</p>` : "";
    const rtLine = phLine || (rt ? `<p class="route">${city(rt.origin)} → ${city(rt.destination)}</p>` : rt === undefined && r.f && /^[A-Z]{3}\d/.test(r.f) ? `<p class="route soft">Looking up its route…</p>` : "");
    return `<h2>${esc(name)}</h2>${rtLine}<p>${esc(what)}</p>
      <p>${ft.toLocaleString("en-US")} ft · ${climb} · ${Math.round(r.gs)} kn · heading ${Math.round(r.trk)}°</p>
      ${r.sq === "7700" ? "<p><b>Squawking 7700 (emergency)</b></p>" : ""}
      ${tisb ? `<p class="meta">It isn't broadcasting its own identity: this is the FAA's radar track of it, rebroadcast (TIS-B), so there's no name, registration or type.</p>` : ""}
      ${r.f && /^[A-Z]{3}\d/.test(r.f) ? atcHTML(r.f) : ""}
      <p class="meta">${tisb ? "Radar" : "ADS-B"} position ${ago} s ago via ${esc(src || "ADS-B")}${r.r ? ` · ${esc(r.r)}` : ""} · ${esc(r.h)}${rt ? " · route from adsbdb.com" : ""}</p>
      <p>${fa}<a href="https://globe.adsb.fi/?icao=${encodeURIComponent(r.h)}" target="_blank" rel="noopener">adsb.fi map ↗</a></p>`;
  };
  // the card's picture: the same drawing, big, slowly turning under the map's camera
  window.__planePreview = (p) => {
    const r = p.r, W = 340, H = 150, dpr = Math.min(2, devicePixelRatio || 1);
    const cv = document.createElement("canvas");
    cv.className = "vprev"; cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = `width:100%;aspect-ratio:${W}/${H};display:block;margin:2px auto 6px`;
    cv.setAttribute("aria-hidden", "true");
    const c = cv.getContext("2d"), M = window.__transit.geo.worldToCamera;
    const proj = (x, y, z) => [M[0] * x + M[4] * y + M[8] * z, -(M[1] * x + M[5] * y + M[9] * z)];
    const heli = kindOf(r) === "heli", P = heli ? HELIP : spec(r), t0 = performance.now();
    // one scale for the whole turn, from where its nose, tail, wingtips and fin top land at every heading
    let sc = 1;
    if (P) {
      let mx = 0, my = 0;
      const pts = [[P.L / 2, 0, 0], [-P.L / 2, 0, 0], [0, P.S / 2, 0], [0, -P.S / 2, 0], [-P.L / 2, 0, P.fin + P.fw], [-P.L * 0.3, P.S / 2, 0], [-P.L * 0.3, -P.S / 2, 0]];
      for (let th = P.ship ? 0.25 : 0; th < (P.ship ? 0.96 : Math.PI * 2); th += P.ship ? 0.05 : 0.2) {
        const ct = Math.cos(th), st = Math.sin(th), o = proj(0, 0, 0);
        for (const [a, b, h] of pts) { const q = proj(a * ct - b * st, h, a * st + b * ct); mx = Math.max(mx, Math.abs(q[0] - o[0])); my = Math.max(my, Math.abs(q[1] - o[1]) + (h ? 0 : 0)); }
      }
      sc = Math.min((W * 0.48) / mx, (H * 0.44) / my);
    }
    const frame = () => {
      if (!cv.isConnected && performance.now() - t0 > 1000) return;
      // planes turn all the way round; a long airship rocks around its side view so it can fill the frame
      const el = (performance.now() - t0) / 1000, th = P && P.ship ? 0.6 + 0.35 * Math.sin(el * 0.5) : 0.6 + el * 0.25, ct = Math.cos(th), st = Math.sin(th);
      const loc = (a, b, h) => proj(a * ct - b * st, h, a * st + b * ct);
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      const ctr = loc(0, 0, 0);
      const at = (a, b, h) => { const q = loc(a, b, h); return [W / 2 + (q[0] - ctr[0]) * sc, H * 0.46 + (q[1] - ctr[1]) * sc]; };
      if (heli) {
        const g = at(0.8, 0, -4), g2 = at(4, 0, -4);
        c.fillStyle = "rgba(11,20,24,0.13)"; c.beginPath(); c.ellipse(g[0], g[1] + H * 0.08, Math.hypot(g2[0] - g[0], g2[1] - g[1]) * 1.2, Math.hypot(g2[0] - g[0], g2[1] - g[1]) * 0.5, 0, 0, Math.PI * 2); c.fill();
        drawHeli(c, at, 0.9, (performance.now() - t0) / 1000);
      } else {
        c.fillStyle = "rgba(11,20,24,0.13)"; footprint(c, P, (a, b) => { const q = at(a, b, 0); return [q[0], q[1] + H * 0.16]; });
        drawPlane(c, P, { al: airlineOf(r) }, at, 0.9, 0);
      }
      requestAnimationFrame(frame);
    };
    frame();
    return cv;
  };
})();
