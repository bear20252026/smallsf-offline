// The interface, in dutilh.net's look: a slim bar along the top (Search, Places, Layers, TV, Share, About); Search, Places,
// Layers and TV open a small pop-over under it, Share copies a link to the view, About goes to the about page (how/); whatever you click on the map shows in the same spot; a status line along the bottom says
// what San Francisco is doing right now. Square buttons top right: light or dark, zoom, full screen.
(async function () {
  const viewer = window.viewer, vp = viewer.viewport, mi = window.mapItem;
  const [geo, places] = await Promise.all([fetch("geo.json", { cache: "no-cache" }).then((r) => r.json()), fetch("landmarks.json?v=" + (window.__cv || "")).then((r) => r.json())]);
  const G0 = IsoGeo.make(geo, null);  // no height grids: the same projection the opening view and shared links use
  const $ = (id) => document.getElementById(id);
  const drop = $("drop"), card = $("card"), page = $("page"), layersEl = $("layers"), findbox = $("findbox"), input = $("q"), sr = $("sr"), sn = $("sn");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const phone = matchMedia("(max-width: 700px)");

  // ---- moving the camera ----
  const pxPerM = () => mi.viewportToImageZoom(vp.getZoom()) / geo.mpp;
  // the landmark nearest the middle of the screen (for the visit summary in analytics)
  window.__nearestPlace = () => {
    const c = mi.viewportToImageCoordinates(vp.getCenter(true)); let best = null, bd = Infinity;
    for (const p of places) { const q = G0.toPixelAt(p.lat, p.lon, 10), d = Math.hypot(q.x - c.x, q.y - c.y); if (d < bd) { bd = d; best = p.name; } }
    return bd * geo.mpp < 900 ? best : null;
  };
  function flyTo(px, minPxPerM) {
    vp.panTo(mi.imageToViewportCoordinates(px.x, px.y));
    if (minPxPerM && pxPerM() < minPxPerM) vp.zoomTo(mi.imageToViewportZoom(minPxPerM * geo.mpp));
    vp.applyConstraints();
  }
  const flyToLatLon = (lat, lon, minPxPerM) => { const G = window.__transit?.G; flyTo(G ? G.toPixel(lat, lon) : G0.toPixelAt(lat, lon, 10), minPxPerM); };
  function zoom(f) { if (window.__cam) { const c = viewer.container; window.__cam.zoomStep(f, new OpenSeadragon.Point(c.clientWidth / 2, c.clientHeight / 2)); } else { vp.zoomBy(f); vp.applyConstraints(); } }

  // ---- light or dark: dark once the sun is down, unless you've picked one ----
  let chosen = store.get("sf-ui-theme");
  function applyTheme() {
    const night = window.atmo ? !!window.atmo.night : sunAlt(Date.now()) < -6;
    document.body.dataset.night = night ? "1" : "0";
    document.body.dataset.ui = chosen || (night ? "dark" : "light");
  }

  // ---- the sun (after Agafonkin's SunCalc, as atmosphere.js): its height, for light or dark before the sky loads ----
  const LAT = 37.7936, LON = -122.3965;
  function sunAlt(date) {
    const rad = Math.PI / 180, d = date / 864e5 - 0.5 + 2440588 - 2451545, M = rad * (357.5291 + 0.98560028 * d);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const e = rad * 23.4397, dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
    const H = rad * (280.16 + 360.9856235 * d) + rad * LON - ra, phi = rad * LAT;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  }

  // ---- San Francisco's clock ----
  const TZ = "America/Los_Angeles";
  const sfDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const sfParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const sfClock = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const clock = (d) => sfClock.format(d).replace(/\s?[AP]M$/i, "");
  function when(now) {
    const p = Object.fromEntries(sfParts.formatToParts(now).map((x) => [x.type, x.value])), h = +p.hour % 24;
    const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 21 ? "evening" : "night";
    return { title: `${p.weekday} ${part}, ${clock(now)}`, short: `${p.weekday}, ${clock(now)}` };
  }

  // ---- the weather in words (Open-Meteo, via atmosphere.js) ----
  function weather() {
    const wx = window.atmo?.wx; if (!wx) return "";
    const c = wx.code ?? 0, fog = c === 45 || c === 48 || (wx.visibility != null && wx.visibility < 3000);
    const cond = fog ? "foggy" : c >= 95 ? "stormy" : c >= 80 && c <= 82 ? "showery" : c >= 51 && c <= 67 ? "raining" : c === 3 || (wx.cloud ?? 0) > 85 ? "overcast" : c >= 1 && c <= 2 ? "partly cloudy" : "clear";
    const mph = wx.windMph ?? 0, dir = wx.windDir ?? 270;
    const from = dir >= 200 && dir <= 330 ? "off the ocean" : dir >= 30 && dir < 150 ? "off the bay" : dir >= 150 && dir < 200 ? "from the south" : "from the north";
    const wind = mph < 3 ? ", still" : `, ${mph < 10 ? "light wind" : mph < 18 ? "breezy" : "windy"} ${mph < 10 ? from : ""}`.trimEnd();
    const t = wx.temp != null ? `${Math.round(wx.temp)}° ` : "";
    return `${t}${cond}${wind}`;
  }
  // ---- where the fog is (satellite, via atmosphere.js): "fog in the Sunset and Richmond, clear in the Mission" ----
  const HOODS = [["the Sunset", 37.753, -122.494], ["the Richmond", 37.779, -122.483], ["the Presidio", 37.798, -122.466], ["the Marina", 37.802, -122.437],
    ["Twin Peaks", 37.752, -122.447], ["the Haight", 37.770, -122.446], ["the Castro", 37.761, -122.435], ["Noe Valley", 37.750, -122.433],
    ["the Mission", 37.759, -122.415], ["Downtown", 37.790, -122.403], ["SoMa", 37.778, -122.400], ["Potrero Hill", 37.758, -122.400], ["Bayview", 37.731, -122.389]];
  function fogWords() {
    if (!window.atmo?.sat || !window.__fogAtLL) return "";
    const f = HOODS.map(([n, la, lo]) => [n, window.__fogAtLL(la, lo)]);
    const foggy = f.filter(([, v]) => v > 0.45).map(([n]) => n), clear = f.filter(([, v]) => v < 0.15).map(([n]) => n);
    if (!foggy.length) return "";
    if (foggy.length >= HOODS.length - 1) return "fog over the whole city";
    const list = (a) => a.length === 1 ? a[0] : `${a[0]} and ${a[1]}`;
    const sun = window.atmo.alt > 0 && !(window.atmo.wx?.cloud > 70) ? "sun" : "clear";
    return `fog in ${list(foggy.slice(0, 2))}${clear.length ? `, ${sun} in ${clear.includes("the Mission") ? "the Mission" : clear.at(-1)}` : ""}`;
  }
  // ---- the status line, kept current ----
  const live = (n) => `<span class="live-n">${n.toLocaleString()}</span>`;
  let lastHTML = "";
  function update() {
    applyTheme();
    const now = new Date(), w = when(now), T = window.__transit;
    const nT = T ? Object.keys(T.fleet).length : null, nB = window.__boatCount;
    // one piece per idea, each kept whole: the line only wraps between them
    const g = (txt, cls = "") => txt ? `<span class="g ${cls}">${txt}</span>` : "";
    // one weather phrase: where the fog is when the satellite sees some (it says more than "clear, light wind"), else the sky and wind
    const fw = fogWords(), wx = weather();
    const html = g(esc(fw ? (wx.match(/^\d+° /)?.[0] || "") + fw : wx))
      + (nT == null ? g("Buses and boats loading…", "loading")
        : g(`${live(nT)} buses &amp; trains`) + (nB == null ? g("boats loading…", "loading") : g(`${live(nB)} boats`))
        + (window.__planesOff || !window.__planesInView ? "" : g(`${live(window.__planesInView)} plane${window.__planesInView === 1 ? "" : "s"} in view`)));
    if ($("when").textContent !== w.title) $("when").textContent = w.title;
    if (html !== lastHTML) $("now").innerHTML = lastHTML = html;
    $("n-transit").textContent = nT == null ? "" : `${nT} live`;
    $("n-boats").textContent = nB == null ? "loading" : `${nB} live`;
    if ($("n-planes")) $("n-planes").textContent = window.__planeCount == null ? "loading" : `${window.__planesOnMap ?? window.__planesInView ?? 0} over the map`;
  }
  update();
  setInterval(update, 3000);

  // ---- layers: each row is its own switch (on: coral, dotted underline) ----
  const LAYERS = { transit: "__transitOff", boats: "__boatsOff", cars: "__carsOff", planes: "__planesOff" };
  layersEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-layer]"); if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true", k = b.dataset.layer;
    b.setAttribute("aria-pressed", String(on));
    if (k === "labels") document.body.classList.toggle("nolabels", !on);
    else { window[LAYERS[k]] = !on; if (!on && (k === "transit" || k === "boats" || k === "planes")) hideCard(); }
  });

  // ---- closing a card: empty it (stops a live-cam video) and drop a place's #id from the address ----
  function hideCard() {
    if (card.hidden) return;
    card.hidden = true; card.innerHTML = "";
    if (/^#[a-z]/i.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  }
  // ---- the pop-over under the bar: Search, Places, Layers or TV ----
  let openPage = null;
  const tool = (n) => document.querySelector(`.tools [data-act="${n}"]`);
  function openDrop(name) {
    if (openPage === name) return closeDrop();
    hideCard();
    findbox.hidden = name !== "search"; layersEl.hidden = name !== "layers"; page.hidden = !(name === "places" || name === "tv");
    if (name !== "search") { sr.hidden = true; sn.hidden = true; }
    for (const n of ["search", "places", "layers", "tv"]) tool(n)?.setAttribute("aria-expanded", String(n === name));
    drop.hidden = false; drop.scrollTop = 0; openPage = name;
  }
  function closeDrop() {
    clearTimeout(timer); ctrl?.abort();
    drop.hidden = true; openPage = null; page.innerHTML = "";
    for (const n of ["search", "places", "layers", "tv"]) tool(n)?.setAttribute("aria-expanded", "false");
  }
  function showPage(name, html) { if (openPage === name) return closeDrop(); page.innerHTML = html; openDrop(name); }
  const closePage = closeDrop;
  function openPlace(p) {
    closePage(); clearSearch();
    if (window.__places) window.__places.open(p); else flyTo(G0.toPixelAt(p.lat, p.lon, p.y), 2.5);
  }
  function placesPage() {
    const groups = [["landmark", "Landmarks"], ["park", "Parks and squares"]];
    let html = "";
    for (const [kind, title] of groups) {
      const list = places.filter((p) => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
      if (list.length) html += `<h3>${title}</h3><ul>${list.map((p) => `<li><button type="button" data-id="${esc(p.id)}">${esc(p.name)}</button></li>`).join("")}</ul>`;
    }
    html = `<p style="margin:0 0 14px"><button type="button" class="mklist" style="font:inherit;color:var(--u-coral);border-bottom:1px dotted var(--u-coral)">Make a list of your own places</button></p>` + html;
    showPage("places", html);
    page.querySelector(".mklist").onclick = () => { closeDrop(); window.__lists?.start(); };
    page.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => openPlace(places.find((p) => p.id === b.dataset.id))));
  }
  // ---- TV: pick a stop for a full-screen departures board (tv.js); the main stations, or search any Muni stop ----
  let tvData = null, drawnMask = null;
  // is a lat/lon on the drawn part of the map? (the drawing's small preview: opaque where it's drawn)
  async function loadDrawn() {
    if (drawnMask) return drawnMask;
    try {
      const im = new Image(); im.crossOrigin = "anonymous"; im.src = (window.__mapTiles || "map_files/") + "preview.webp"; await im.decode();
      const c = Object.assign(document.createElement("canvas"), { width: im.naturalWidth, height: im.naturalHeight }), x = c.getContext("2d");
      x.drawImage(im, 0, 0); const sz = mi.getContentSize();
      drawnMask = { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, sx: c.width / sz.x, sy: c.height / sz.y };
    } catch { drawnMask = { none: true }; }
    return drawnMask;
  }
  const isDrawn = (lat, lon) => {
    const m = drawnMask; if (!m || m.none) return true;
    const p = G0.toPixelAt(lat, lon, 10), x = Math.floor(p.x * m.sx), y = Math.floor(p.y * m.sy);
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
    return m.d[(y * m.w + x) * 4 + 3] > 200;
  };
  // a stop button: live where the map is drawn; greyed with a "coming soon" note (and the donate link) where it isn't
  const tvBtn = (label, id, all) => {
    const st = all[id], ok = !st || isDrawn(st[0], st[1]);
    return ok ? `<li><button type="button" data-tv="${esc(id)}">${esc(label)}</button></li>`
      : `<li class="soon"><button type="button" data-soon="${esc(id)}" aria-describedby="soon-${esc(id)}">${esc(label)}</button><span class="soontip" id="soon-${esc(id)}" role="tooltip">Coming soon: this part of the city isn't drawn yet. <a href="about#help">Help fund it</a></span></li>`;
  };
  function wireSoon(root) {   // greyed stops: tap toggles the note on touch screens; the donate link is tracked
    root.querySelectorAll("[data-soon]").forEach((b) => (b.onclick = () => { b.parentElement.classList.toggle("open"); window.track?.("tv: coming soon", { stop: b.textContent }); }));
    root.querySelectorAll(".soontip a").forEach((a) => (a.onclick = () => window.track?.("tv: donate link")));
  }
  async function tvPage() {
    showPage("tv", `<p class="small">A big live departures board for any Muni stop, with the map around it. Open it on a TV, an old iPad or a spare monitor and leave it running.</p><p class="note">Loading stops…</p>`);
    try { tvData = tvData || await Promise.all(["tv-stations.json", "stops-all.json"].map((f) => fetch(f + "?v=" + (window.__cv || "")).then((r) => r.json()))); } catch { return; }
    await loadDrawn();
    if (openPage !== "tv") return;
    const [menu, all] = tvData, go = (id) => { location.href = location.pathname + "?tv=" + encodeURIComponent(id); };
    const names = new Map(); for (const [id, v] of Object.entries(all)) if (!names.has(v[2])) names.set(v[2], id);
    page.innerHTML = `<p class="small">A big live departures board for any Muni stop, with the map around it. Open it on a TV, an old iPad or a spare monitor and leave it running.</p>
      <input class="tvq" type="search" placeholder="Search any Muni stop" aria-label="Search Muni stops" autocomplete="off"><ul class="tvr"></ul>
      <div class="tvm">${menu.map(([g, list]) => `<h3>${esc(g)}</h3><ul>${list.map(([label, id]) => tvBtn(label, id, all)).join("")}</ul>`).join("")}</div>
      <p class="note">Times are Muni's own live predictions, via 511.org, refreshed every couple of minutes: usually within a minute of Muni's signs.</p>`;
    page.querySelectorAll("[data-tv]").forEach((b) => (b.onclick = () => { window.track?.("tv: pick", { from: "menu", stop: b.textContent }); go(b.dataset.tv); }));
    const q = page.querySelector(".tvq"), ul = page.querySelector(".tvr"), menuEl = page.querySelector(".tvm");
    q.oninput = () => {
      const n = norm(q.value).split(" ").filter(Boolean);
      if (!n.length) { ul.innerHTML = ""; menuEl.hidden = false; return; }
      const hits = [];
      for (const [name, id] of names) { const w = norm(name).split(" "); if (n.every((x) => w.some((y) => y.startsWith(x)))) { hits.push([name, id]); if (hits.length >= 10) break; } }
      menuEl.hidden = true;
      ul.innerHTML = hits.length ? hits.map(([name, id]) => tvBtn(name, id, all)).join("") : `<li class="note">No Muni stop by that name.</li>`;
      wireSoon(ul);
      ul.querySelectorAll("[data-tv]").forEach((b) => (b.onclick = () => { window.track?.("tv: pick", { from: "search", stop: b.textContent }); go(b.dataset.tv); }));
    };
    q.onkeydown = (e) => { if (e.key === "Enter") ul.querySelector("[data-tv]")?.click(); };
    wireSoon(page);
    if (!phone.matches) q.focus();
  }
  // ---- search: landmarks first, then Nominatim (bounded to SF, at most one request a second) ----
  const cache = new Map();
  let lastReq = 0, timer = null, ctrl = null, results = [], hi = 0;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function localMatches(q) {
    const n = norm(q); if (!n) return [];
    return places.filter((p) => norm(p.name).includes(n) || n.split(" ").every((w) => norm(p.name).split(" ").some((x) => x.startsWith(w))))
      .map((p) => ({ name: p.name, sub: p.kind === "park" ? "Park on the map" : "Landmark on the map", place: p }))
      .concat((window.__stops?.search(q) || []).map((st) => ({ ...st, stop: st.id })));   // Muni stops with arrivals coming
  }
  const AREA = new Set(["suburb", "neighbourhood", "quarter", "city_district", "borough", "residential", "park", "island"]);
  function fromNominatim(r) {
    const parts = r.display_name.split(", ");
    const house = /^\d+[a-z]?(-\d+)?$/i.test(parts[0]);                     // "1072, Noe Street, …": an address
    const name = r.name || (house ? `${parts[0]} ${parts[1]}` : parts[0]);
    const sub = parts.slice(house ? 2 : 0).filter((x) => x !== name && !/^\d{5}/.test(x) && !/^(San Francisco|California|United States|San Francisco City and County)$/.test(x)).slice(0, 2).join(", ");
    const building = house || r.addresstype === "building" || r.class === "building" || r.type === "house";
    return { name, sub, lat: +r.lat, lon: +r.lon, area: AREA.has(r.type) || AREA.has(r.addresstype), building };
  }
  function renderResults(q, remoteList, state) {
    const local = localMatches(q), seen = new Set(local.map((r) => norm(r.name)));
    results = [...local, ...(remoteList || []).filter((r) => !seen.has(norm(r.name)))];
    hi = 0;
    sr.innerHTML = results.map((r, i) => `<li><button type="button" data-i="${i}" class="${i === hi ? "hi" : ""}">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</button></li>`).join("");
    sr.hidden = !results.length;
    sr.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => pickResult(results[+b.dataset.i])));
    sn.textContent = !q.trim() ? "" : state === "loading" ? (results.length ? "Searching the rest of the city…" : "Searching…")
      : state === "error" ? "Search isn't available right now. Try again in a minute." : state === "done" && !results.length ? "Nothing by that name in San Francisco." : "";
    sn.hidden = !sn.textContent;
  }
  function clearSearch() { input.value = ""; results = []; sr.hidden = true; sr.innerHTML = ""; sn.hidden = true; }
  function pickResult(r) {
    if (!r) return;
    window.track?.("search: pick", { kind: r.place ? "landmark" : r.stop ? "muni stop" : r.building ? "address" : r.area ? "neighborhood" : "place" });
    // making a list: a search result becomes its next pin
    if (window.__lists?.editing) {
      const lat = r.place ? r.place.lat : r.lat, lon = r.place ? r.place.lon : r.lon;
      if (lat != null) { clearSearch(); input.blur(); closeDrop(); window.__lists.add(lat, lon, r.place ? r.place.name : r.name); flyToLatLon(lat, lon); }
      return;
    }
    if (r.place) return openPlace(r.place);
    if (r.stop) {   // a Muni stop: fly in and open its arrivals
      clearSearch(); input.blur(); closeDrop(); unmark();
      flyToLatLon(r.lat, r.lon, 2.2);
      return setTimeout(() => window.__stops?.show(r.stop), 700);
    }
    clearSearch(); input.blur(); closeDrop(); unmark();
    // an address: zoom right in and select its building (outline and card); anything else gets a marker
    flyToLatLon(r.lat, r.lon, r.area ? 0.7 : r.building ? 4 : 2);
    setTimeout(async () => {
      const b = r.building && window.__selectBuildingAt ? await window.__selectBuildingAt(r.lat, r.lon) : null;
      if (!b) mark(r.lat, r.lon, r.name);
    }, 700);
  }
  // ---- a marker for a searched place, until the next click on the map or the next search ----
  let marker = null;
  function mark(lat, lon, name) {
    unmark();
    const G = window.__transit?.G, p = G ? G.toPixel(lat, lon) : G0.toPixelAt(lat, lon, 10);
    const el = document.createElement("div"); el.className = "searchpin"; el.textContent = name;
    viewer.addOverlay({ element: el, location: mi.imageToViewportCoordinates(p.x, p.y), placement: OpenSeadragon.Placement.BOTTOM });
    marker = el;
  }
  function unmark() { if (marker) { viewer.removeOverlay(marker); marker = null; } }
  viewer.addHandler("canvas-click", (e) => { if (e.quick) unmark(); });
  async function remote(q, now) {
    const key = norm(q);
    if (key.length < 3) return renderResults(q, [], "done");
    if (cache.has(key)) return renderResults(q, cache.get(key), "done");
    clearTimeout(timer);
    const wait = Math.max(now ? 0 : 900, lastReq + 1100 - Date.now());
    renderResults(q, null, "loading");
    timer = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController(); lastReq = Date.now();
      try {
        window.track?.("search: query");
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&viewbox=-122.52,37.83,-122.35,37.70&bounded=1&limit=5`;
        const list = (await fetch(url, { signal: ctrl.signal, headers: { "Accept-Language": "en" } }).then((r) => r.json())).map(fromNominatim);
        cache.set(key, list);
        if (openPage === "search" && norm(input.value) === key) renderResults(q, list, "done");
      } catch (e) { if (e.name !== "AbortError" && openPage === "search") renderResults(q, null, "error"); }
    }, wait);
  }
  // the same search for other panels (a list's "Add another"): landmarks and stops first, then Nominatim (shared rate limit)
  window.__findPlaces = async (q) => {
    const key = norm(q), local = localMatches(q).map((r) => ({ name: r.name, sub: r.sub, lat: r.place ? r.place.lat : r.lat, lon: r.place ? r.place.lon : r.lon })).filter((r) => r.lat != null);
    if (key.length < 3) return local;
    let list = cache.get(key);
    if (!list) {
      await new Promise((r) => setTimeout(r, Math.max(0, lastReq + 1100 - Date.now())));
      lastReq = Date.now();
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&viewbox=-122.52,37.83,-122.35,37.70&bounded=1&limit=5`;
        list = (await fetch(url, { headers: { "Accept-Language": "en" } }).then((r) => r.json())).map(fromNominatim); cache.set(key, list);
      } catch { list = []; }
    }
    const seen = new Set(local.map((r) => norm(r.name)));
    return [...local, ...list.filter((r) => !seen.has(norm(r.name)))].slice(0, 6);
  };
  input.addEventListener("input", () => { renderResults(input.value, cache.get(norm(input.value)) || [], "loading"); remote(input.value, false); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!results.length) return;
      hi = (hi + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      sr.querySelectorAll("button").forEach((b, i) => b.classList.toggle("hi", i === hi));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length && (cache.has(norm(input.value)) || localMatches(input.value).length)) pickResult(results[hi]);
      else remote(input.value, true);
    }
  });

  // ---- Share (copy a link to this view): ?at=lat,lon,metres-across, read back by index.html on load ----
  function viewAt() {
    const c = mi.viewportToImageCoordinates(vp.getCenter());
    let lat = 37.7953, lon = -122.3936;
    for (let i = 0; i < 6; i++) {
      const p = G0.toPixelAt(lat, lon, 10), e = 1e-4, pa = G0.toPixelAt(lat + e, lon, 10), po = G0.toPixelAt(lat, lon + e, 10);
      const j11 = (pa.x - p.x) / e, j21 = (pa.y - p.y) / e, j12 = (po.x - p.x) / e, j22 = (po.y - p.y) / e, det = j11 * j22 - j12 * j21, rx = c.x - p.x, ry = c.y - p.y;
      lat += (j22 * rx - j12 * ry) / det; lon += (j11 * ry - j21 * rx) / det;
    }
    return `${lat.toFixed(5)},${lon.toFixed(5)},${Math.round(viewer.container.clientWidth / pxPerM())}m`;
  }
  let toastEl = null, toastT = null;
  // a short confirmation; given the button that made it, it drops down from that button (caret pointing at it)
  function toast(text, from) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast gone"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    toastEl.append(text);
    const b = from && from.getBoundingClientRect();
    if (b && b.width) {
      const w = toastEl.offsetWidth, cx = b.left + b.width / 2, x = Math.max(12 + w / 2, Math.min(innerWidth - 12 - w / 2, cx));
      toastEl.style.left = x + "px"; toastEl.style.top = Math.round(b.bottom + 22) + "px"; toastEl.style.setProperty("--ox", Math.round(cx - (x - w / 2)) + "px");
    } else { toastEl.style.left = ""; toastEl.style.top = ""; toastEl.style.removeProperty("--ox"); }
    requestAnimationFrame(() => toastEl.classList.remove("gone"));
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.add("gone"), 2000);
  }
  async function copyLink() {
    window.track?.("share: copy view link");
    // ?at= rather than #: the server sees it, so a pasted link previews as a picture of this view (api/page, api/og)
    const q = new URLSearchParams(location.search); q.set("at", viewAt());
    const url = location.origin + location.pathname + "?" + q.toString().replace(/%2C/g, ",");
    history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); toast("Copied your current view to clipboard.", document.querySelector('.tools [data-act="share"]')); }
    catch {
      const t = document.createElement("textarea"); t.value = url; t.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(t); t.select();
      const ok = document.execCommand && document.execCommand("copy"); t.remove();
      toast(ok ? "Copied your current view to clipboard." : "The link is in the address bar", document.querySelector('.tools [data-act="share"]'));
    }
  }

  // ---- full screen (hidden where the page can't, like iPhone Safari) ----
  const de = document.documentElement, fsOn = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsBtn = document.querySelector('.sq [data-act="full"]');
  fsBtn.hidden = !(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const fullscreen = () => (fsOn() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (de.requestFullscreen || de.webkitRequestFullscreen).call(de));

  // ---- a click on the map closes the pop-over; a selection takes its place ----
  viewer.addHandler("canvas-press", () => { if (openPage) closeDrop(); });
  new MutationObserver(() => { if (!card.hidden && openPage) closeDrop(); }).observe(card, { attributes: true, attributeFilter: ["hidden"] });

  // ---- buttons ----
  const acts = {
    search: () => { openDrop("search"); if (openPage === "search") setTimeout(() => input.focus(), 0); }, layers: () => openDrop("layers"),
    places: placesPage, tv: tvPage, share: copyLink, full: fullscreen,   // About is a link to the about page (/about, files in how/), not a pop-over
    in: () => zoom(1.6), out: () => zoom(1 / 1.6),
    theme: () => { const next = document.body.dataset.ui === "dark" ? "light" : "dark"; chosen = next === ((window.atmo ? window.atmo.night : sunAlt(Date.now()) < -6) ? "dark" : "light") ? null : next; store.set("sf-ui-theme", chosen); applyTheme(); },
  };
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".tools [data-act], .sq [data-act]"); if (b) acts[b.dataset.act]?.(); });

  // ---- keyboard: / search, + and - zoom, Esc closes ----
  // OpenSeadragon's own keys: keep its arrows and zoom keys, but not the ones that would flip the city (f) or spin it (r),
  // which used to fire when a click (a robotaxi, a bus) left the map with the keyboard focus
  viewer.addHandler("canvas-key", (e) => { if ([187, 189].includes(e.originalEvent.keyCode)) e.preventDefaultAction = true; });
  for (const ev of ["keydown", "keypress"]) addEventListener(ev, (e) => {
    if (/^[fFrR]$/.test(e.key) && !e.metaKey && !e.ctrlKey && viewer.element.contains(e.target)) e.stopPropagation();
  }, true);
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "Escape") {
      if (typing) { clearSearch(); e.target.blur(); return; }
      if (openPage) closeDrop(); else hideCard();
      return;
    }
    if (typing) return;
    if (e.key === "/") { e.preventDefault(); if (openPage !== "search") openDrop("search"); input.focus(); return; }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.6); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoom(1 / 1.6); }
  });
})();
