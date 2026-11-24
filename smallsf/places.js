// Landmark pins: a paper tag over each place, a card with a short note (and a live cam when there is one) on click.
(async function () {
  const viewer = window.viewer;
  const [geo, places] = await Promise.all([fetch("geo.json", { cache: "no-cache" }).then((r) => r.json()), fetch("landmarks.json?v=" + (window.__cv || "")).then((r) => r.json())]);
  const G = IsoGeo.make(geo, null);
  const card = document.getElementById("card");
  const pins = [];
  for (const p of places) {
    const px = G.toPixelAt(p.lat, p.lon, p.y);
    const el = document.createElement("button");
    el.className = `pin ${p.kind}`;
    el.innerHTML = `<span>${p.name}</span>${p.cam ? `<i class="camdot" title="Live cam"></i>` : ""}`;
    el.title = p.name;
    el.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });   // clicks go through the tracker below
    viewer.addOverlay({ element: el, location: window.mapItem.imageToViewportCoordinates(px.x, px.y), placement: OpenSeadragon.Placement.BOTTOM, checkResize: false });
    // OSD swallows clicks on overlays unless told otherwise
    // a press that turns into a drag pans the map instead of opening the place
    let moved = 0;
    new OpenSeadragon.MouseTracker({ element: el,
      pressHandler: () => { moved = 0; window.__cam?.stop(); },
      dragHandler: (e) => { moved += Math.abs(e.delta.x) + Math.abs(e.delta.y); window.__cam?.dragBy(e.delta.x, e.delta.y); },
      dragEndHandler: () => window.__cam?.release(),
      clickHandler: (e) => { if (e.quick && moved < 6) open(p); } });
    pins.push({ p, el, rank: p.kind === "landmark" ? 0 : 1 });
  }
  // Show more pins the closer you are: big landmarks first, parks once zoomed in
  function update() {
    const pxPerM = window.mapItem.viewportToImageZoom(viewer.viewport.getZoom(true)) / geo.mpp;  // screen px per metre
    for (const { el, rank } of pins) el.classList.toggle("off", pxPerM < (rank ? 1.6 : 0.6));
  }
  viewer.addHandler("animation", update);
  viewer.addHandler("open", update);
  update();
  const ready = (fn) => (viewer.world.getItemCount() ? fn() : viewer.addOnceHandler("open", fn));

  function open(p) {
    window.track?.("place: open", { name: p.name });
    card.innerHTML = `<button class="x" aria-label="Close">×</button><h2>${p.name}</h2><p>${p.blurb}</p>${cam(p.cam)}${cam(p.cam2)}`;
    card.hidden = false;
    card.querySelector(".x").onclick = close;
    const px = G.toPixelAt(p.lat, p.lon, p.y);
    viewer.viewport.panTo(window.mapItem.imageToViewportCoordinates(px.x, px.y + 40 / geo.mpp));
    if (window.mapItem.viewportToImageZoom(viewer.viewport.getZoom()) / geo.mpp < 2.5) viewer.viewport.zoomTo(window.mapItem.imageToViewportZoom(3 * geo.mpp));
    history.replaceState(null, "", `#${p.id}`);
  }
  function close() { card.hidden = true; history.replaceState(null, "", location.pathname + location.search); }
  window.__places = { list: places, open, close };  // the toolbar's Places list and search reuse these
  function cam(c) {
    if (!c) return "";
    if (c.type === "youtube") return `<div class="cam"><iframe src="https://www.youtube-nocookie.com/embed/${c.id}?autoplay=1&mute=1" allow="autoplay; encrypted-media" allowfullscreen></iframe><small>Live: ${c.label}</small></div>`;
    if (c.type === "still") return `<div class="cam"><img src="${c.url}?t=${Date.now()}" alt="${c.label}" data-still="${c.url}"><small>Live still, refreshed each minute: ${c.label}</small></div>`;
    return `<p><a href="${c.url}" target="_blank" rel="noopener">Watch the live cam ↗</a></p>`;
  }
  setInterval(() => document.querySelectorAll("img[data-still]").forEach((i) => (i.src = `${i.dataset.still}?t=${Date.now()}`)), 60e3);
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const start = places.find((p) => `#${p.id}` === location.hash);
  if (start) ready(() => setTimeout(() => open(start), 50));
})();
