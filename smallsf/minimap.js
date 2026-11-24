// Overview map in the corner: the bay inside the fog of war (wide backdrop, city photo, the drawn parts on top,
// clouds round the edge) and a box for what's on screen. Click or drag on it to move there. Hidden on small phones.
(async function () {
  const viewer = window.viewer, vp = viewer.viewport, photo = window.__photo, geo = window.__geo, far = window.__far;
  if (!photo) return;
  for (let i = 0; i < 20 && !window.__fogHome; i++) await new Promise((r) => setTimeout(r, 250));   // fog.js sets the frame
  const fh = window.__fogHome;
  // the overview's extent in camera metres: the fog ring's frame, else the photo layer
  const E = fh ? { x0: fh.x, y1: fh.y, w: fh.w, h: fh.h } : { x0: photo.x0, y1: photo.y1, w: photo.W * photo.mpp, h: photo.H * photo.mpp };
  const MW = 196, MH = Math.round(MW * E.h / E.w);
  const wrap = document.createElement("div");
  wrap.className = "minimap";
  wrap.innerHTML = `<canvas width="${MW * 2}" height="${MH * 2}" style="width:${MW}px;height:${MH}px"></canvas>`;
  document.body.appendChild(wrap);
  const cv = wrap.querySelector("canvas"), ctx = cv.getContext("2d");
  ctx.scale(2, 2);

  // the coarse levels of each pyramid are single tiles: one small image each
  const level = (w) => Math.ceil(Math.log2(w)) - Math.ceil(Math.log2(w / 1024));
  const load = (url) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
  const mapW = window.mapItem.getContentSize().x, mapH = window.mapItem.getContentSize().y;
  const layers = [   // [image url, camera x0, camera y1, width m, height m]
    far && [`${far.tiles || "far_files/"}${level(far.W)}/0_0.webp`, far.x0, far.y1, far.W * far.mpp, far.H * far.mpp],
    [`${photo.tiles || "photo_files/"}${level(photo.W)}/0_0.webp`, photo.x0, photo.y1, photo.W * photo.mpp, photo.H * photo.mpp],
    [`${window.mapItem?.source?.tilesUrl || "map_files/"}${level(mapW)}/0_0.webp`, geo.x0, geo.y1, mapW * geo.mpp, mapH * geo.mpp],
  ].filter(Boolean);
  let imgs = [];
  Promise.all(layers.map((l) => load(l[0]))).then((r) => { imgs = r; draw(); });
  const fx = (x) => ((x - E.x0) / E.w) * MW, fy = (y) => ((E.y1 - y) / E.h) * MH;

  // viewport units are camera-space kilometres: x = camX/1000, y = -camY/1000
  const toMini = (x, y) => [fx(x * 1000), fy(-y * 1000)];
  function draw() {
    ctx.clearRect(0, 0, MW, MH);
    ctx.fillStyle = "#045470"; ctx.fillRect(0, 0, MW, MH);
    layers.forEach((l, i) => { if (imgs[i]) ctx.drawImage(imgs[i], fx(l[1]), fy(l[2]), (l[3] / E.w) * MW, (l[4] / E.h) * MH); });
    const fm = window.__fogMask;
    if (fm) ctx.drawImage(fm.cv, fx(fm.X0), fy(fm.Y1), ((fm.X1 - fm.X0) / E.w) * MW, ((fm.Y1 - fm.Y0) / E.h) * MH);
    const b = vp.getBounds(true), [x0, y0] = toMini(b.x, b.y), [x1, y1] = toMini(b.x + b.width, b.y + b.height);
    const w = Math.max(4, x1 - x0), h = Math.max(3, y1 - y0);
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, h);
    ctx.strokeStyle = "rgba(20,30,36,0.8)"; ctx.lineWidth = 0.75; ctx.strokeRect(x0 - 1, y0 - 1, w + 2, h + 2);
  }
  // at most one redraw a frame, and none while it's hidden (small phones)
  const hidden = matchMedia("(max-width: 700px)");
  let queued = 0;
  const later = () => { if (!queued && !hidden.matches) queued = requestAnimationFrame(() => { queued = 0; draw(); }); };
  viewer.addHandler("animation", later);
  viewer.addHandler("viewport-change", later);
  hidden.addEventListener?.("change", later);
  draw();

  // click or drag on the overview to move the view there
  const goTo = (ev, now) => {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const x = (E.x0 + (mx / MW) * E.w) / 1000, y = -(E.y1 - (my / MH) * E.h) / 1000;
    window.__cam?.stop();
    vp.panTo(new OpenSeadragon.Point(x, y), now);
  };
  let down = false;
  cv.addEventListener("pointerdown", (e) => { down = true; cv.setPointerCapture(e.pointerId); goTo(e, false); });
  cv.addEventListener("pointermove", (e) => { if (down) goTo(e, true); });
  cv.addEventListener("pointerup", () => { down = false; vp.applyConstraints(); });
  wrap.addEventListener("wheel", (e) => e.stopPropagation());
})();
