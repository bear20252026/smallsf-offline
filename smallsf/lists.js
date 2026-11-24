// Lists of places, kept entirely in the link (no accounts, nothing stored). A shared list opens framed on its pins,
// numbered, with the list in a panel. Making one: Places > Make a list, then click the map to drop a pin (named after the
// building there when it has a name or address) or search for a place.
//
// The link:  ?list=Mission+coffee&by=Ari&p=37.76417,-122.42290,Ritual+Coffee~get+the+morning+bun&p=37.76150,-122.42460,Tartine
//   list  the list's name (up to 80 characters)
//   by    optional: who made it (up to 40), shown as "a list by Ari" and in the link preview
//   p     one per place, in order: lat,lon[,Name[~note]]. Everything after the second comma is the name, so a name can
//         hold commas; everything after the first "~" in it is the note, a short tip (up to 120: "get the morning bun").
//         "~" is the one character a name can't hold (a typed one becomes "-"), so a note can say anything. "~" is
//         unreserved in URLs and travels unescaped. A place with a note but no name is lat,lon,~note. Links from before
//         notes (lat,lon,Name) read exactly as they did.
// Reading a list also shows each place's nearest Muni stop with its next departure (api/board, every minute); for
// directions between the places, Open in Google Maps.
(async function () {
  while (!window.__transit) await new Promise((r) => setTimeout(r, 200));
  const viewer = window.viewer, vp = viewer.viewport, mi = window.mapItem, geo = window.__geo, G = window.__transit.G;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const q = new URLSearchParams(location.search);
  const NAME = 80, NOTE = 120, BY = 40;
  const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const noTilde = (s) => String(s ?? "").replace(/~/g, "-");   // "~" starts a place's note in the link, so a name can't hold one
  let title = q.get("list") || "", by = tidy(q.get("by")).slice(0, BY), pins = q.getAll("p").map(parse).filter(Boolean), editing = false, sel = -1, mine = false;   // mine: made or edited here
  function parse(s) {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),?(.*)$/.exec(s || "");
    if (!m || Math.abs(+m[1] - 37.76) > 0.3 || Math.abs(+m[2] + 122.44) > 0.3) return null;
    const k = m[3].indexOf("~");
    return { lat: +m[1], lon: +m[2], name: tidy(k < 0 ? m[3] : m[3].slice(0, k)).slice(0, NAME), note: k < 0 ? "" : tidy(m[3].slice(k + 1)).slice(0, NOTE) };
  }

  // ---- the panel ----
  const panel = Object.assign(document.createElement("div"), { id: "listpanel", hidden: true });
  document.body.appendChild(panel);
  const css = document.createElement("style");
  css.textContent = `
  #listpanel { position: fixed; left: 16px; top: 72px; z-index: 5; width: min(330px, calc(100vw - 32px)); box-sizing: border-box; max-height: calc(100dvh - 120px); overflow: auto;
    background: var(--u-card); color: var(--u-text); border: 1px solid rgba(0,0,0,.06); border-radius: 12px; box-shadow: 0 14px 34px -14px var(--u-shadow); font: 17px/1.4 var(--u-serif); padding: 14px 16px 12px; }
  #listpanel .lab { margin-bottom: 8px; font: 600 10.5px/1 var(--u-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--u-coral); }
  #listpanel h2 { margin: 0 26px 8px 0; font: 500 24px/1.1 var(--u-serif); color: var(--u-ink); }
  #listpanel .x { position: absolute; top: 9px; right: 10px; width: 24px; height: 24px; font: 400 22px/1 var(--u-sans); color: var(--u-mute); background: none; border: 0; cursor: pointer; }
  #listpanel .x:hover { color: var(--u-coral); }
  #listpanel ol { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 2px; }
  #listpanel li { display: flex; align-items: center; gap: 8px; }
  #listpanel li .n { flex: none; width: 20px; height: 20px; border-radius: 50%; background: var(--u-coral); color: #fff; font: 600 11px/20px var(--u-sans); text-align: center; }
  #listpanel li button.go { flex: 1; text-align: left; font: inherit; color: var(--u-ink); background: none; border: 0; padding: 3px 0; cursor: pointer; }
  #listpanel li button.go:hover, #listpanel li.on button.go { color: var(--u-coral); }
  #listpanel input { font: inherit; color: var(--u-ink); background: none; border: 0; border-bottom: 1px solid var(--u-line); padding: 2px 0; outline: none; min-width: 0; }
  #listpanel input:focus { border-bottom-color: var(--u-coral); }
  #listpanel input.ttl { width: 100%; font: 500 22px/1.2 var(--u-serif); margin: 0 0 8px; }
  #listpanel li input { flex: 1; }
  #listpanel li .rm { flex: none; background: none; border: 0; color: var(--u-mute); font: 18px/1 var(--u-sans); cursor: pointer; padding: 0 2px; }
  #listpanel li .rm:hover { color: var(--u-coral); }
  #listpanel .hint { margin: 0 0 10px; font: 12.5px/1.45 var(--u-sans); color: var(--u-mute); }
  #listpanel .acts { display: flex; gap: 16px; flex-wrap: wrap; font-size: 16px; }
  #listpanel .acts button { font: inherit; color: var(--u-ink); background: none; border: 0; padding: 0; border-bottom: 1px dotted var(--u-dot); cursor: pointer; }
  #listpanel .acts button.primary { color: var(--u-coral); border-bottom-color: var(--u-coral); }
  #listpanel .acts button:hover { color: var(--u-coral); }
  .listpin { position: relative; transform: translate(-13px, -10px); font: 500 15px/18px var(--u-serif); color: var(--u-ink); white-space: nowrap; cursor: pointer;
    background: var(--u-card); padding: 4px 9px 5px 4px; border: 1px solid rgba(0,0,0,.07); border-radius: 99px; box-shadow: 0 6px 16px -8px rgba(60,40,20,.55); }
  .listpin b { display: inline-block; vertical-align: top; width: 18px; height: 18px; margin-right: 6px; border-radius: 50%; background: var(--u-coral); color: #fff; font: 600 10.5px/18px var(--u-sans); text-align: center; }
  .listpin.bare b { margin-right: 0; }
  .listpin::after { content: ""; position: absolute; left: 13px; bottom: -8px; width: 1px; height: 8px; background: var(--u-coral); }
  .listpin.on { color: var(--u-coral); }
  .listpin.bare { padding-right: 4px; }
  body.list-editing .openseadragon-canvas { cursor: crosshair; }
  #drop:not([hidden]) ~ #listpanel, #card:not([hidden]) ~ #listpanel { display: none; }   /* Search, Places, a card: the list steps aside */
  #listpanel .grip { flex: none; width: 10px; cursor: grab; color: var(--u-mute); font: 14px/1 var(--u-sans); letter-spacing: -2px; user-select: none; }
  #listpanel li.dragging { opacity: .4; }
  #listpanel li.over { box-shadow: 0 -2px 0 var(--u-coral); }
  #listpanel li.addrow .n { position: relative; background: none; border: 1px dashed var(--u-coral); box-sizing: border-box; }
  /* a drawn plus, not the "+" glyph: the font sets that a little below the middle */
  #listpanel li.addrow .n::before, #listpanel li.addrow .n::after { content: ""; position: absolute; left: 50%; top: 50%; background: var(--u-coral); transform: translate(-50%, -50%); }
  #listpanel li.addrow .n::before { width: 8px; height: 1.5px; }
  #listpanel li.addrow .n::after { width: 1.5px; height: 8px; }
  #listpanel .sugg { list-style: none; margin: -4px 0 10px 28px; padding: 0; display: grid; }
  #listpanel .sugg button { display: block; width: 100%; text-align: left; font: inherit; font-size: 16px; color: var(--u-ink); background: none; border: 0; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
  #listpanel .sugg button small { display: block; font: 11.5px/1.3 var(--u-sans); color: var(--u-mute); }
  #listpanel .sugg button:hover, #listpanel .sugg button.hi { background: rgba(0,0,0,.04); color: var(--u-coral); }
  #listpanel .sugg .none { font: 12px var(--u-sans); color: var(--u-mute); padding: 4px 6px; }
  .listpin.drag { cursor: grab; }
  /* a place's note: under its name in the panel; on the pin when it's picked or hovered */
  #listpanel .by { margin: -4px 0 10px; font: italic 400 16px/1.3 var(--u-serif); color: var(--u-soft); }
  #listpanel label.byl { display: flex; align-items: baseline; gap: 6px; margin: -2px 0 10px; font: italic 16px/1.3 var(--u-serif); color: var(--u-soft); }
  #listpanel label.byl input { flex: 1; font: inherit; font-style: normal; color: var(--u-ink); }
  #listpanel li.pl { align-items: flex-start; }
  #listpanel li.pl .n, #listpanel li.pl .grip, #listpanel li.pl .rm { margin-top: 5px; }
  #listpanel li .nm { flex: 1; min-width: 0; display: grid; }
  #listpanel li .nm button.go { padding: 3px 0 1px; }
  #listpanel li .nt { font: 13px/1.4 var(--u-sans); color: var(--u-text); padding-bottom: 2px; overflow-wrap: anywhere; }
  #listpanel li input.note { font: 13px/1.4 var(--u-sans); color: var(--u-text); border-bottom-color: transparent; margin-bottom: 4px; }
  #listpanel li input.note:hover { border-bottom-color: var(--u-line); }
  #listpanel li input.note:focus { border-bottom-color: var(--u-coral); }
  #listpanel li input.note::placeholder { color: var(--u-mute); opacity: .8; }
  #listpanel li .live { font: 12px/1.45 var(--u-sans); color: var(--u-mute); padding-bottom: 4px; }
  #listpanel li .live:empty { display: none; }
  #listpanel li .live .ln { display: inline-block; min-width: 14px; margin-right: 4px; padding: 0 4px; border-radius: 3px; font: 600 10.5px/15px var(--u-sans); text-align: center; vertical-align: 1px; }
  .listpin .nt { display: none; width: max-content; max-width: 220px; margin: 3px 0 1px 24px; font: 12.5px/1.35 var(--u-sans); color: var(--u-text); white-space: normal; }
  .listpin.has-note:hover, .listpin.has-note.on { border-radius: 12px; }
  .listpin.has-note:hover .nt, .listpin.has-note.on .nt { display: block; }
  @media (max-width: 700px) { #listpanel { right: 10px; left: 10px; top: auto; bottom: calc(max(10px, env(safe-area-inset-bottom)) + 64px); width: auto; max-height: 42dvh; } }`;
  document.head.appendChild(css);

  // ---- lat/lon <-> the drawing ----
  const toImg = (p) => G.toPixel(p.lat, p.lon);
  function toLatLon(ix, iy) {   // Newton on the projection (with street heights), as Copy link does
    let lat = 37.77, lon = -122.42;
    for (let i = 0; i < 8; i++) {
      const p = G.toPixel(lat, lon), e = 1e-4, pa = G.toPixel(lat + e, lon), po = G.toPixel(lat, lon + e);
      const j11 = (pa.x - p.x) / e, j21 = (pa.y - p.y) / e, j12 = (po.x - p.x) / e, j22 = (po.y - p.y) / e, det = j11 * j22 - j12 * j21, rx = ix - p.x, ry = iy - p.y;
      lat += (j22 * rx - j12 * ry) / det; lon += (j11 * ry - j21 * rx) / det;
    }
    return { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
  }

  // ---- pins on the map ----
  let els = [];
  function drawPins() {
    for (const el of els) viewer.removeOverlay(el);
    els = pins.map((p, i) => {
      const el = document.createElement("div");
      el.className = "listpin" + (p.name ? "" : " bare") + (p.note ? " has-note" : "") + (i === sel ? " on" : "");
      el.innerHTML = `<b>${i + 1}</b>${p.name ? esc(p.name) : ""}${p.note ? `<span class="nt">${esc(p.note)}</span>` : ""}`;
      const px = toImg(p);
      viewer.addOverlay({ element: el, location: mi.imageToViewportCoordinates(px.x, px.y), placement: OpenSeadragon.Placement.BOTTOM_LEFT, checkResize: false });
      if (editing) el.classList.add("drag");
      let moved = 0, ov = null, grab = null;
      new OpenSeadragon.MouseTracker({ element: el,
        pressHandler: (e) => {
          moved = 0; window.__cam?.stop();
          // where on the pin it was grabbed, relative to its tip, so it moves with the pointer without jumping
          const r = viewer.container.getBoundingClientRect(), ev = e.originalEvent, px = toImg(pins[i]);
          const tip = vp.pixelFromPoint(mi.imageToViewportCoordinates(px.x, px.y), true);
          grab = ev ? { dx: ev.clientX - r.left - tip.x, dy: ev.clientY - r.top - tip.y } : { dx: 0, dy: 0 };
        },
        dragHandler: (e) => {
          moved += Math.abs(e.delta.x) + Math.abs(e.delta.y);
          if (!editing) { window.__cam?.dragBy(e.delta.x, e.delta.y); return; }
          // making a list: the pin follows the pointer
          const r = viewer.container.getBoundingClientRect(), ev = e.originalEvent;
          const pt = new OpenSeadragon.Point(ev.clientX - r.left - grab.dx, ev.clientY - r.top - grab.dy);
          ov = vp.pointFromPixel(pt); viewer.updateOverlay(el, ov, OpenSeadragon.Placement.BOTTOM_LEFT);
        },
        dragEndHandler: () => {
          if (!editing) { window.__cam?.release(); return; }
          if (!ov) return;
          const ip = mi.viewportToImageCoordinates(ov), ll = toLatLon(ip.x, ip.y);
          window.track?.("list: move pin"); pins[i].lat = ll.lat; pins[i].lon = ll.lon; ov = null; remember();
        },
        clickHandler: (e) => { if (e.quick && moved < 6) focusPin(i); } });
      return el;
    });
  }
  function focusPin(i) {
    sel = i; const px = toImg(pins[i]);
    vp.panTo(mi.imageToViewportCoordinates(px.x, px.y));
    const ppm = mi.viewportToImageZoom(vp.getZoom()) / geo.mpp;
    if (ppm < 1.2) vp.zoomTo(mi.imageToViewportZoom(1.6 * geo.mpp));
    els.forEach((el, k) => el.classList.toggle("on", k === i));
    panel.querySelectorAll("li").forEach((li, k) => li.classList.toggle("on", k === i));
  }
  // the box round every pin, in drawing pixels (padded), and the shared-view triple for it
  function bounds() {
    const ps = pins.map(toImg), xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const pad = 180 / geo.mpp, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad * 1.6, y1 = Math.max(...ys) + pad * 0.6;
    return { x0, x1, y0, y1 };
  }
  function fit(immediately) {
    if (!pins.length) return;
    const b = bounds(), r = viewer.container.getBoundingClientRect();
    // leave room for the panel on the right (or below on a phone)
    const side = r.width > 700 ? 360 : 0, bottom = r.width > 700 ? 0 : r.height * 0.45;
    const sx = (r.width - side) / (b.x1 - b.x0), sy = (r.height - bottom - 80) / (b.y1 - b.y0);
    const zImg = Math.min(sx, sy);   // screen px per drawing px
    vp.zoomTo(mi.imageToViewportZoom(Math.min(zImg, 2.2 * geo.mpp)), null, immediately);
    const k = Math.min(zImg, 2.2 * geo.mpp), cx = (b.x0 + b.x1) / 2 - side / 2 / k, cy = (b.y0 + b.y1) / 2 + bottom / 2 / k;   // panel on the left
    vp.panTo(mi.imageToViewportCoordinates(cx, cy), immediately);
  }
  function atFor() {   // ?at= framing all the pins, for the link preview picture
    const b = bounds(), c = toLatLon((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const m = Math.max((b.x1 - b.x0), (b.y1 - b.y0) * 1200 / 630) * geo.mpp;
    return `${c.lat.toFixed(5)},${c.lon.toFixed(5)},${Math.round(Math.max(150, m))}m`;
  }
  function url(withAt) {
    const u = new URLSearchParams();
    if (withAt && pins.length) u.set("at", atFor());
    if (title) u.set("list", title);
    if (by) u.set("by", by);
    for (const p of pins) u.append("p", `${p.lat.toFixed(5)},${p.lon.toFixed(5)}${p.name || p.note ? "," + noTilde(p.name) : ""}${p.note ? "~" + p.note : ""}`);
    return location.origin + location.pathname + (u.toString() ? "?" + u.toString().replace(/%2C/g, ",").replace(/%20/g, "+").replace(/%7E/gi, "~") : "");
  }
  const remember = () => history.replaceState(null, "", url(false));

  // ---- the panel: reading a list, or making one ----
  function render() {
    if (!editing && !pins.length) { panel.hidden = true; return; }
    panel.hidden = false;
    if (!editing) {
      panel.innerHTML = `<button class="x" aria-label="Close">×</button><div class="lab">List</div>${title ? `<h2>${esc(title)}</h2>` : ""}${by ? `<p class="by">a list by ${esc(by)}</p>` : ""}
        <ol>${pins.map((p, i) => `<li class="pl${i === sel ? " on" : ""}"><span class="n">${i + 1}</span><div class="nm"><button class="go" data-i="${i}">${esc(p.name || "Pin " + (i + 1))}</button>${p.note ? `<div class="nt">${esc(p.note)}</div>` : ""}<div class="live" data-live="${i}">${liveLine(p)}</div></div></li>`).join("")}</ol>
        <div class="acts">${mine ? `<button class="primary" data-a="copy">Copy link</button><button data-a="gmaps">Open in Google Maps</button><button data-a="edit">Edit</button>`
          : `<button class="primary" data-a="gmaps">Open in Google Maps</button><button data-a="copy">Copy link</button><button data-a="fit">Show all</button><button data-a="edit">Edit a copy</button>`}</div>`;
      refreshLive();
    } else {
      panel.innerHTML = `<button class="x" aria-label="Close">×</button><div class="lab">${pins.length ? "Your list" : "New list"}</div>
        <input class="ttl" placeholder="Name this list" value="${esc(title)}" maxlength="${NAME}">
        <label class="byl">by <input class="by" placeholder="your name (optional)" value="${esc(by)}" maxlength="${BY}" autocomplete="off"></label>
        <p class="hint">Type a place below or click the map to drop a pin. Drag pins to move them and rows to reorder. The whole list lives in the link: nothing is saved anywhere else.</p>
        <ol>${pins.map((p, i) => `<li class="pl${i === sel ? " on" : ""}" data-row="${i}"><span class="grip" title="Drag to reorder">⋮⋮</span><span class="n">${i + 1}</span><div class="nm"><input data-i="${i}" value="${esc(p.name)}" placeholder="Name this pin" maxlength="${NAME}"><input class="note" data-note="${i}" value="${esc(p.note)}" placeholder="Add a note, like what to get" maxlength="${NOTE}" autocomplete="off"></div><button class="rm" data-rm="${i}" aria-label="Remove">×</button></li>`).join("")}
          <li class="addrow"><span class="grip"></span><span class="n plus"></span><input class="add" placeholder="${pins.length ? "Add another place" : "Add a place"}" maxlength="${NAME}" autocomplete="off"></li></ol>
        <ul class="sugg" hidden></ul>
        <div class="acts"><button class="primary" data-a="copy">Copy link</button><button data-a="done">Done</button>${pins.length ? `<button data-a="clear">Clear</button>` : ""}</div>`;
      const t = panel.querySelector(".ttl");
      t.oninput = () => { title = t.value.trim(); remember(); };
      const bi = panel.querySelector("input.by");
      bi.oninput = () => { by = tidy(bi.value).slice(0, BY); remember(); };
      bi.onkeydown = (e) => { if (e.key === "Enter") bi.blur(); };
      // a typed "~" would start a note in the link: it becomes "-" in a name
      const untilde = (inp) => { if (!inp.value.includes("~")) return; const c = inp.selectionStart; inp.value = noTilde(inp.value); inp.setSelectionRange(c, c); };
      panel.querySelectorAll("li input[data-i]").forEach((inp) => {
        inp.oninput = () => { untilde(inp); pins[+inp.dataset.i].name = tidy(inp.value); remember(); clearTimeout(inp._t); inp._t = setTimeout(drawPins, 250); };
        inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
        inp.onfocus = () => { sel = +inp.dataset.i; els.forEach((el, k) => el.classList.toggle("on", k === sel)); };
      });
      panel.querySelectorAll("li input[data-note]").forEach((inp) => {
        const i = +inp.dataset.note;
        inp.oninput = () => { pins[i].note = tidy(inp.value).slice(0, NOTE); remember(); clearTimeout(inp._t); inp._t = setTimeout(drawPins, 250); };
        inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
        inp.onfocus = () => { sel = i; els.forEach((el, k) => el.classList.toggle("on", k === sel)); };
      });
      wireAdd(); wireReorder();
      panel.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { window.track?.("list: remove place"); pins.splice(+b.dataset.rm, 1); sel = -1; remember(); drawPins(); render(); }));
    }
    panel.querySelector(".x").onclick = close;
    panel.querySelectorAll(".go").forEach((b) => (b.onclick = () => focusPin(+b.dataset.i)));
    panel.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => act(b.dataset.a, b)));
  }


  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // ---- live: each place's nearest Muni stop (within 250 m) and its next departure ----
  // From api/board, one request per stop (places sharing a stop share it), two at a time, a quarter second apart, for up to
  // ten places, again every minute while the list is open. A stop with nothing coming, or an error, just shows nothing.
  let stopsAll = null, stopsP = null;
  const boards = new Map(), stopOf = new Map();   // stop id -> { at, j }; "lat,lon" -> stop id ("" for none near)
  const loadStops = () => (stopsP ||= fetch("stops-all.json?v=" + (window.__cv || "")).then((r) => r.json()).then((j) => (stopsAll = j)).catch(() => (stopsP = null)));
  function nearStop(p) {
    const key = p.lat + "," + p.lon;
    if (!stopOf.has(key) && stopsAll) {
      let best = "", bd = 250;
      for (const id in stopsAll) { const s = stopsAll[id], d = Math.hypot((s[0] - p.lat) * 111320, (s[1] - p.lon) * 88200); if (d < bd) { bd = d; best = id; } }
      stopOf.set(key, best);
    }
    return stopOf.get(key) || "";
  }
  const shortDest = (d) => String(d || "").replace(/\/Mezzanine Level$/, "").replace(/^Metro (.*) Station$/, "$1").replace(/ Station$/, "");
  const shortStop = (n) => String(n || "").replace(/ (St|Street)\b/g, "").replace(/\s+/g, " ").trim();
  function liveLine(p) {
    const id = nearStop(p), b = id && boards.get(id)?.j, now = Date.now();
    if (!b || !Array.isArray(b.rows) || !b.updated || now - b.updated > 6 * 60e3) return "";   // stale predictions: say nothing rather than something wrong
    let best = null;
    for (const r of b.rows) { const t = (r.t || []).find((x) => x > now - 30e3); if (t && (!best || t < best.t)) best = { line: r.line, dest: r.dest, t }; }
    if (!best) return "";
    const min = Math.max(0, Math.round((best.t - now) / 60e3));
    if (min > 90) return "";
    const R = window.__transit?.routes?.["SF:" + best.line], col = /^#[0-9a-f]{6}$/i.test(R?.color || "") ? R.color : "#005B95";
    const ink = parseInt(col.slice(1, 3), 16) * 0.299 + parseInt(col.slice(3, 5), 16) * 0.587 + parseInt(col.slice(5, 7), 16) * 0.114 > 150 ? "#111" : "#fff";
    return `<span class="ln" style="background:${col};color:${ink}">${esc(best.line)}</span>to ${esc(shortStop(shortDest(best.dest)))} ${min ? `in ${min} min` : "now"} · ${esc(shortStop(b.name))}`;
  }
  function paintLive() { panel.querySelectorAll(".live[data-live]").forEach((el) => { const p = pins[+el.dataset.live]; if (p) el.innerHTML = liveLine(p); }); }
  let liveBusy = false;
  async function refreshLive() {
    if (liveBusy || panel.hidden || editing || document.hidden || !pins.length) return;
    liveBusy = true;
    try {
      if (!(await loadStops())) return;
      paintLive();
      const ids = [...new Set(pins.slice(0, 10).map(nearStop).filter(Boolean))].filter((id) => !(Date.now() - (boards.get(id)?.at || 0) < 55e3));
      let k = 0;
      const worker = async () => {
        while (k < ids.length) {
          const id = ids[k++];
          let j = null;
          try { const r = await fetch("api/board?stop=" + encodeURIComponent(id)); if (r.ok) j = await r.json(); } catch {}
          boards.set(id, { at: Date.now(), j });
          paintLive();
          await sleep(250);
        }
      };
      await Promise.all([worker(), worker()]);
    } finally { liveBusy = false; }
  }
  setInterval(refreshLive, 60e3);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshLive(); });

  // "Add another": type a place, pick it from what the map's search finds
  let findT = null, found = [], fhi = 0;
  function wireAdd() {
    const inp = panel.querySelector("input.add"), ul = panel.querySelector(".sugg");
    const show = (state) => {
      ul.hidden = !inp.value.trim();
      ul.innerHTML = found.length ? found.map((r, i) => `<li><button data-f="${i}" class="${i === fhi ? "hi" : ""}">${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</button></li>`).join("")
        : `<li class="none">${state === "loading" ? "Searching…" : "Nothing by that name in San Francisco."}</li>`;
      ul.querySelectorAll("[data-f]").forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(found[+b.dataset.f]); }));
    };
    const pick = (r) => { if (!r) return; add(r.lat, r.lon, r.name, true); vpTo(r); };
    inp.oninput = () => {
      clearTimeout(findT); const qv = inp.value.trim(); found = []; fhi = 0;
      if (!qv) { ul.hidden = true; return; }
      show("loading");
      findT = setTimeout(async () => { const res = await window.__findPlaces?.(qv) || []; if (inp.value.trim() !== qv) return; found = res; show("done"); }, 350);
    };
    inp.onkeydown = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (found.length) { fhi = (fhi + (e.key === "ArrowDown" ? 1 : found.length - 1)) % found.length; show("done"); } }
      if (e.key === "Enter") { e.preventDefault(); pick(found[fhi]); }
      if (e.key === "Escape") { inp.value = ""; ul.hidden = true; }
    };
    inp.onblur = () => setTimeout(() => (ul.hidden = true), 150);
  }
  function vpTo(p) { const px = toImg(p); vp.panTo(mi.imageToViewportCoordinates(px.x, px.y)); }
  // rows reorder by their grip
  function wireReorder() {
    let from = -1;
    panel.querySelectorAll("li[data-row]").forEach((li) => {
      const grip = li.querySelector(".grip");
      grip.onpointerdown = () => (li.draggable = true);
      li.ondragstart = (e) => { from = +li.dataset.row; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(from)); };
      li.ondragend = () => { li.draggable = false; li.classList.remove("dragging"); panel.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); };
      li.ondragover = (e) => { if (from < 0) return; e.preventDefault(); panel.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); li.classList.add("over"); };
      li.ondrop = (e) => {
        e.preventDefault(); const to = +li.dataset.row; if (from < 0 || from === to) return;
        window.track?.("list: reorder"); const [p] = pins.splice(from, 1); pins.splice(to, 0, p); from = -1; sel = to; remember(); drawPins(); render();
      };
    });
  }
  function gmaps() {   // walking directions through every place, in order (Google takes up to ten stops)
    const at = (p) => (p.name ? `${p.name}, San Francisco` : `${p.lat},${p.lon}`);
    const ps = pins.slice(0, 10);
    if (ps.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ps[0].name ? at(ps[0]) : `${ps[0].lat},${ps[0].lon}`)}`;
    const u = new URLSearchParams({ api: "1", origin: at(ps[0]), destination: at(ps.at(-1)), travelmode: "walking" });
    if (ps.length > 2) u.set("waypoints", ps.slice(1, -1).map(at).join("|"));
    return "https://www.google.com/maps/dir/?" + u.toString();
  }
  async function act(a, b) {
    if (a === "fit") fit();
    if (a === "gmaps") { window.track?.("list: google maps", { n: pins.length }); open(gmaps(), "_blank", "noopener"); }
    if (a === "edit" || a === "start") window.track?.(a === "start" ? "list: start" : "list: edit", { pins: pins.length });
    if (a === "edit" || a === "start") { editing = true; mine = true; window.__listEditing = true; document.body.classList.add("list-editing"); drawPins(); render(); panel.querySelector("input.add")?.focus(); }
    if (a === "done") window.track?.("list: done", { pins: pins.length, named: !!title, notes: pins.filter((p) => p.note).length, by: !!by });
    if (a === "done") { editing = false; window.__listEditing = false; document.body.classList.remove("list-editing"); drawPins(); render(); }
    if (a === "clear") { pins = []; title = ""; by = ""; sel = -1; remember(); drawPins(); render(); }
    if (a === "copy") {
      const u = url(true);
      try { await navigator.clipboard.writeText(u); b.textContent = "Link copied"; } catch { history.replaceState(null, "", u); b.textContent = "In the address bar"; }
      setTimeout(() => (b.textContent = "Copy link"), 1600);
      window.track?.("list: copy", { n: pins.length });
    }
  }
  function close() {
    editing = false; window.__listEditing = false; document.body.classList.remove("list-editing");
    pins = []; title = ""; by = ""; sel = -1; drawPins(); panel.hidden = true;
    history.replaceState(null, "", location.pathname);
  }
  function add(lat, lon, name, fromAdd) {
    window.track?.("list: add place", { via: fromAdd ? "add another" : name ? "map click on a building" : "map click", pins: pins.length + 1 });
    pins.push({ lat: +(+lat).toFixed(5), lon: +(+lon).toFixed(5), name: tidy(noTilde(name)).slice(0, NAME), note: "" });
    sel = pins.length - 1; remember(); drawPins(); render();
    const inp = fromAdd ? panel.querySelector("input.add") : panel.querySelector(`li input[data-i="${sel}"]`);
    if (inp && (fromAdd || !name)) inp.focus();
  }

  // clicks on the map drop pins while making a list
  viewer.addHandler("canvas-click", async (e) => {
    if (!editing || !e.quick) return;
    e.preventDefaultAction = true;
    const ip = mi.viewerElementToImageCoordinates(e.position), ll = toLatLon(ip.x, ip.y);
    let name = "";
    try { const b = await window.__buildingInfo?.(ip.x, ip.y); if (b) name = b.n || b.a || ""; } catch {}
    add(ll.lat, ll.lon, name);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && editing && document.activeElement?.tagName !== "INPUT") act("done"); });

  window.__lists = { start: () => act("start"), get editing() { return editing; }, add };
  if (pins.length) {
    drawPins(); render();
    if (!q.has("at") && !window.__listFramed) fit(true);   // index.html frames a list before its opening
    window.track?.("list: open", { n: pins.length });
  }
})();
