// A friend outside Meter (2700 18th St), waving, with a capybara under his arm. Drawn standing up to the camera, a
// little bigger than life so he can be found; transit.js calls window.__people each frame (under the planes) and
// handles the click.
(async () => {
  while (!window.__transit) await new Promise((r) => setTimeout(r, 300));
  const { G } = window.__transit;
  const FOLK = [{ id: "meter", lat: 37.76194, lon: -122.40921, title: "Cody says hi from Meter 👋", body: "Waving outside 2700 18th Street, with a capybara.", sprite: "people/meter.png", frames: 3, seq: [0, 1, 0, 2] }];
  for (const f of FOLK) {
    f.w = G.toWorld(f.lat, f.lon);
    // a hand-drawn sprite strip (frames side by side, feet at the bottom) replaces the code drawing once it loads
    if (f.sprite) { const img = new Image(); img.onload = () => (f.img = img); img.src = f.sprite + "?v=" + (window.__cv || ""); }
  }
  function drawSprite(ctx, f, x, y, H, t, sel) {
    const img = f.img, fw = img.width / f.frames, fh = img.height, h = H * 1.25, w = (h * fw) / fh;
    const k = f.seq[Math.floor(t * 3.2) % f.seq.length];
    ctx.save();
    ctx.fillStyle = "rgba(10,20,25,0.28)"; ctx.beginPath(); ctx.ellipse(x, y, w * 0.42, w * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    if (sel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(x, y, w * 0.62, w * 0.18, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, k * fw, 0, fw, fh, x - w / 2, y - h + w * 0.04, w, h);
    ctx.restore();
  }

  const C = { skin: "#f1c9ab", stub: "rgba(150,105,80,0.35)", hair: "#6e4527", cap: "#2f5e3c", brim: "#284f33", tee: "#1e2a45", jeans: "#3d5578", shoe: "#2a2a2a", capy: "#9c6b45", capyD: "#6f4a2e", glass: "#3a3f45" };

  function draw(ctx, x, y, H, t, sel) {
    const u = H / 40;   // drawing units: he's 40 tall, feet at (x, y)
    const P = (px, py) => [x + px * u, y - py * u];
    const bob = Math.sin(t * 3) * 0.4;
    const rr = (px, py, w, h, r, c) => { const [a, b] = P(px, py + h); ctx.beginPath(); ctx.roundRect(a, b, w * u, h * u, r * u); ctx.fillStyle = c; ctx.fill(); };
    const circ = (px, py, r, c) => { const [a, b] = P(px, py); ctx.beginPath(); ctx.arc(a, b, r * u, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); };
    const ell = (px, py, rx, ry, c, rot = 0) => { const [a, b] = P(px, py); ctx.beginPath(); ctx.ellipse(a, b, rx * u, ry * u, rot, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); };
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // shadow, and a ring when picked
    ell(0, 0, 9, 2.6, "rgba(10,20,25,0.28)");
    if (sel) { const [a, b] = P(0, 0); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(a, b, 13 * u, 4 * u, 0, 0, Math.PI * 2); ctx.stroke(); }
    // legs and shoes
    rr(-4.4, 1, 4, 13, 1.4, C.jeans); rr(0.4, 1, 4, 13, 1.4, C.jeans);
    ell(-2.6, 1, 2.6, 1.3, C.shoe); ell(2.6, 1, 2.6, 1.3, C.shoe);
    // the waving arm (his left, our right), behind the body at the shoulder
    const sh = P(5, 25.5 + bob), ang = -1.15 + Math.sin(t * 7) * 0.38;   // radians from straight up, swinging
    const elbow = [sh[0] + Math.sin(ang * 0.4 + 0.5) * 6 * u, sh[1] - Math.cos(ang * 0.4 + 0.5) * 6 * u];
    const hand = [elbow[0] + Math.sin(ang + 1.3) * 6 * u, elbow[1] - Math.cos(ang + 1.3) * 6 * u];
    ctx.strokeStyle = C.tee; ctx.lineWidth = 3.4 * u; ctx.beginPath(); ctx.moveTo(sh[0], sh[1]); ctx.lineTo(sh[0] + (elbow[0] - sh[0]) * 0.45, sh[1] + (elbow[1] - sh[1]) * 0.45); ctx.stroke();
    ctx.strokeStyle = C.skin; ctx.lineWidth = 2.6 * u; ctx.beginPath(); ctx.moveTo(sh[0] + (elbow[0] - sh[0]) * 0.4, sh[1] + (elbow[1] - sh[1]) * 0.4); ctx.lineTo(elbow[0], elbow[1]); ctx.lineTo(hand[0], hand[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(hand[0], hand[1], 1.9 * u, 0, Math.PI * 2); ctx.fillStyle = C.skin; ctx.fill();
    // body: navy tee
    rr(-5.5, 13 + bob, 11, 13.5, 3, C.tee);
    // the capybara, held against his chest on our left: a round brown loaf facing out
    const cb = bob * 0.8;
    ell(-3.6, 18.4 + cb, 6.4, 4.0, C.capy);                  // body
    rr(-13.2, 16.6 + cb, 7.4, 5.6, 2.2, C.capy);             // big boxy head
    rr(-13.6, 16.6 + cb, 2.8, 3.6, 1.3, C.capyD);            // blunt dark snout
    circ(-7.4, 22.2 + cb, 0.9, C.capyD); circ(-9.0, 22.4 + cb, 0.8, C.capyD);   // little ears
    circ(-10.0, 20.2 + cb, 0.6, "#1b1b1b");                  // eye
    ell(-1.5, 15.2 + cb, 1.3, 1.1, C.capyD); ell(-6.5, 15.0 + cb, 1.3, 1.1, C.capyD);   // feet tucked
    // his other arm wrapped under it
    ctx.strokeStyle = C.skin; ctx.lineWidth = 2.6 * u; { const a = P(-5, 23 + bob), b = P(-6.2, 16.5 + bob), c = P(-1, 15.6 + bob); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]); ctx.stroke(); }
    // head: hair out the back and sides, face, stubble, glasses, smile
    const hy = 31.5 + bob;
    for (const [hx, hy2, r] of [[-4.7, hy + 1.6, 1.7], [4.7, hy + 1.6, 1.7], [-5.3, hy + 0.1, 1.4], [5.3, hy + 0.1, 1.4], [-4.9, hy - 1.3, 1.1], [4.9, hy - 1.3, 1.1]]) circ(hx, hy2, r, C.hair);
    ell(0, hy, 4.6, 5.1, C.skin);
    ell(0, hy - 2.6, 3.6, 2.2, C.stub);
    if (u > 0.55) {
      ctx.strokeStyle = C.glass; ctx.lineWidth = Math.max(0.6, 0.45 * u);
      for (const gx of [-1.9, 1.9]) { const [a, b] = P(gx, hy + 0.3); ctx.beginPath(); ctx.arc(a, b, 1.45 * u, 0, Math.PI * 2); ctx.stroke(); }
      const [m0, m1] = P(-1.3, hy - 2.3), [m2] = P(1.3, hy - 2.3);
      ctx.strokeStyle = "#7a3e2e"; ctx.lineWidth = Math.max(0.6, 0.5 * u); ctx.beginPath(); ctx.moveTo(m0, m1); ctx.quadraticCurveTo(x, m1 + 1 * u, m2, m1 - 0.3 * u); ctx.stroke();
    }
    // green SOLO cap: crown and a brim toward us
    { const [a, b] = P(0, hy + 2.2); ctx.beginPath(); ctx.ellipse(a, b, 5.2 * u, 4.4 * u, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = C.cap; ctx.fill(); }
    ell(0.6, hy + 2.0, 5.6, 1.25, C.brim);
    if (u > 1.1) { const [a, b] = P(0, hy + 4.0); ctx.fillStyle = "#fff"; ctx.font = `700 ${1.55 * u}px Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("SOLO", a, b); }
    ctx.restore();
  }

  // ---- Happy Donuts, 24th & Church (3801 24th St, the southwest corner): Ari's favourite spot in the city ----
  // It never closes: after dark lights.js draws its shopfront lit. Hover or click the shop to say hi.
  const HD = { id: "happy-donuts", title: "Happy Donuts", body: "24th and Church, open all night. My favorite spot in the city.", tip: "open all night", lat: 37.75157, lon: -122.42766 };
  // a click on the shop: a shower of donuts from the top of the screen
  HD.onOpen = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:50";
    document.body.appendChild(box);
    const W = innerWidth, H = innerHeight, n = Math.round(Math.min(60, Math.max(28, W / 30)));
    let last = 0;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("span"), size = 26 + Math.random() * 34, x = Math.random() * (W - size);
      d.textContent = "\u{1F369}";
      d.style.cssText = `position:absolute;left:${x}px;top:${-size * 1.3}px;font-size:${size}px;line-height:1;will-change:transform`;
      box.appendChild(d);
      const delay = Math.random() * 1400, dur = 1800 + Math.random() * 1600, drift = (Math.random() - 0.5) * 160, spin = (Math.random() - 0.5) * 720;
      d.animate([{ transform: "translate(0,0) rotate(0deg)" }, { transform: `translate(${drift}px,${H + size * 2.6}px) rotate(${spin}deg)` }],
        { duration: dur, delay, easing: "cubic-bezier(.35,0,.75,1)", fill: "both" });
      last = Math.max(last, delay + dur);
    }
    setTimeout(() => box.remove(), last + 100);
  };
  const hdInit = () => {   // on first draw, once the ground grid is in
    const g = (la, lo, up) => { const w = G.toWorld(la, lo), gr = G.ground?.(w[0], w[2]); if (gr != null && gr > -50) w[1] = gr; w[1] += up; return w; };
    HD.door = g(37.75163, -122.42762, 1.5);           // the shopfront on 24th
    HD.mid = g(37.75153, -122.42768, 5);              // the middle of the building, for clicks
  };
  function happyDonuts(ctx, scr, pxPerM, Wc, Hc, sel, t, hits) {
    if (!HD.door) hdInit();
    const d = scr(HD.door);
    if (d[0] < -120 || d[1] < -120 || d[0] > Wc + 120 || d[1] > Hc + 120) return;
    const m = scr(HD.mid);
    hits.push({ x: m[0], y: m[1], r: Math.max(16, pxPerM * 9), person: HD });
  }

  window.__peopleOff = false;
  window.__people = (ctx, scr, pxPerM, Wc, Hc, sel) => {
    const hits = [];
    if (window.__peopleOff || pxPerM < 0.6) return hits;
    const t = performance.now() / 1000;
    happyDonuts(ctx, scr, pxPerM, Wc, Hc, sel, t, hits);
    for (const f of FOLK) {
      const s = scr(f.w);
      if (s[0] < -60 || s[1] < -60 || s[0] > Wc + 60 || s[1] > Hc + 60) continue;
      const H = Math.min(110, Math.max(30, pxPerM * 14));   // ~7x life size close in (up to the sprite's own 220 px at 2x), never smaller than a bus tag
      if (f.img) drawSprite(ctx, f, s[0], s[1], H, t, sel === f); else draw(ctx, s[0], s[1], H, t, sel === f);
      hits.push({ x: s[0], y: s[1] - H * 0.5, r: H * 0.45, person: f });
    }
    return hits;
  };
  window.__personCard = (f) => `<h2>${f.title}</h2><p>${f.body}</p>`;
})();
