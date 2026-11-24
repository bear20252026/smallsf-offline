// TV mode (?tv=<Muni stop id>): a screen for a hallway or a café wall. The map sits on the stop, with every bus and
// train coming in moving toward it, and a big departures board for it and the stops beside it (the other side of the
// street, the far corner), from api/board: any of the city's ~3,200 stops. No bar, no buttons; the cursor hides; the
// screen is kept awake; the page reloads overnight. Pick a stop from TV in the bar, or Show on a TV on a stop's card.
// &m=600 sets how many metres across the view shows (230 by default).
(async function () {
  const q = new URLSearchParams(location.search), sid = q.get("tv");
  if (!sid) return;
  document.body.classList.add("tv");
  const css = document.createElement("style");
  css.textContent = `
  body.tv .bar, body.tv .drop, body.tv .status, body.tv .sq, body.tv .minimap, body.tv #card, body.tv #listpanel, body.tv .pin, body.tv .listpin { display: none !important; }
  body.tv.idle, body.tv.idle * { cursor: none !important; }
  #tvboard { position: fixed; right: 3vw; top: 4vh; z-index: 6; width: min(34vw, 560px); min-width: 320px; box-sizing: border-box; background: var(--u-card); color: var(--u-text);
    border-radius: 18px; box-shadow: 0 20px 50px -20px var(--u-shadow); padding: 2.2vh 2vw 1.8vh; font: 2.2vh/1.3 var(--u-serif); max-height: 92vh; overflow: hidden; }
  #tvboard .top { display: flex; justify-content: space-between; align-items: baseline; font: 600 1.35vh/1 var(--u-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--u-coral); margin-bottom: 1vh; }
  #tvboard .top .clock { letter-spacing: .04em; color: var(--u-mute); font-variant-numeric: tabular-nums; }
  #tvboard h1 { margin: 0 0 1.2vh; font: 500 3.8vh/1.05 var(--u-serif); color: var(--u-ink); }
  #tvboard table { width: 100%; border-collapse: collapse; }
  #tvboard td { padding: .75vh 0; border-top: 1px solid var(--u-line); vertical-align: middle; }
  #tvboard td.r { width: 1%; padding-right: 1.1vw; }
  #tvboard .badge { display: inline-block; min-width: 3vh; text-align: center; padding: .3vh .65vh; border-radius: .5vh; font: 700 1.95vh/1.2 var(--u-sans); }
  #tvboard td.d { font-size: 2.35vh; line-height: 1.2; color: var(--u-ink); }
  #tvboard td.m { text-align: right; white-space: nowrap; font: 600 3vh/1 var(--u-sans); color: var(--u-ink); font-variant-numeric: tabular-nums; }
  #tvboard td.m small { font: 500 1.6vh var(--u-sans); color: var(--u-mute); margin-left: .3vw; }
  #tvboard td.m .later { font: 500 1.55vh var(--u-sans); color: var(--u-mute); display: block; margin-top: .3vh; }
  #tvboard .foot { margin-top: 1.2vh; font: 1.35vh/1.4 var(--u-sans); color: var(--u-mute); display: flex; justify-content: space-between; gap: 1vw; }
  #tvboard .sec { display: flex; align-items: center; gap: .8vw; margin: 1.5vh 0 .3vh; font: 600 1.35vh/1 var(--u-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--u-mute); }
  #tvboard .bartmark { display: inline-block; padding: .45vh .8vh; border-radius: .5vh; background: #0099d8; color: #fff; font: 800 1.6vh/1 var(--u-sans); letter-spacing: .06em; }
  #tvboard .line { display: inline-block; width: 2.8vh; height: 2.8vh; border-radius: 50%; vertical-align: middle; box-shadow: inset 0 0 0 1px rgba(0,0,0,.18); }
  #tvboard .note { margin: .8vh 0 0; font: 1.7vh/1.4 var(--u-sans); color: var(--u-mute); }
  #tvhere { position: relative; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: var(--u-coral); border: 3px solid #fff; box-sizing: border-box; box-shadow: 0 2px 10px rgba(0,0,0,.4); pointer-events: none; }
  #tvhere::before, #tvhere::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 3px solid var(--u-coral); animation: tvping 2.4s ease-out infinite; }
  #tvhere::after { animation-delay: 1.2s; }
  #tvhere span { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); white-space: nowrap; padding: 4px 9px 5px; border-radius: 6px; background: var(--u-card); color: var(--u-ink); font: 500 15px/1 var(--u-serif); box-shadow: 0 6px 16px -8px rgba(0,0,0,.5); }
  @keyframes tvping { from { transform: scale(1); opacity: .9; } to { transform: scale(3.2); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { #tvhere::before, #tvhere::after { animation: none; opacity: 0; } }
  #tvexit { position: fixed; left: 3vw; top: 4vh; z-index: 7; padding: 9px 14px; border: 0; border-radius: 99px; background: var(--u-card); color: var(--u-ink); font: 500 15px var(--u-sans); box-shadow: 0 10px 24px -12px var(--u-shadow); cursor: pointer; transition: opacity .3s; }
  body.tv.idle #tvexit { opacity: 0; pointer-events: none; }
  #tvqr { position: fixed; left: 3vw; bottom: 4vh; z-index: 6; display: flex; align-items: center; gap: 1.4vh; max-width: 30vw; padding: 1.4vh 1.8vh 1.4vh 1.4vh; box-sizing: border-box;
    background: var(--u-card); border-radius: 14px; box-shadow: 0 20px 50px -20px var(--u-shadow); font: 1.6vh/1.35 var(--u-sans); color: var(--u-soft); }
  #tvqr svg { flex: none; width: 15vh; height: 15vh; background: #fff; border-radius: .6vh; }
  #tvqr b { display: block; font: 600 2vh/1.3 var(--u-sans); color: var(--u-ink); margin-bottom: .3vh; }
  @media (max-aspect-ratio: 1/1) { #tvqr { display: none; } }
  @media (max-aspect-ratio: 1/1) { #tvboard { left: 3vw; right: 3vw; top: auto; bottom: 3vh; width: auto; } }`;
  document.head.appendChild(css);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let B = null;
  // the last good answer is kept through a failed refresh, but rows older than their feed allows are not shown (render)
  async function fetchBoard() { try { const r = await fetch("api/board?stop=" + encodeURIComponent(sid)); const j = await r.json(); if (j.name) B = j; } catch {} }
  await fetchBoard();
  if (!B) { document.body.classList.remove("tv"); return; }
  // On a phone: this is a screen for a wall, not a hand. Say so, show what it looks like on a TV, and offer to send the
  // link on (the share sheet: AirDrop to a laptop, Messages to yourself). "Show it here anyway" adds &here.
  if (matchMedia("(max-width: 700px), (max-height: 500px) and (pointer: coarse)").matches && !q.has("here")) {
    const clean = B.name.replace(/^Metro /, "").replace(/\s*\/\s*(Downtown|Downtn|Outbound|Outbd)$/, "").replace(/ (Northbound|Southbound|Outbound|Inbound)$/, "");
    const link = location.origin + location.pathname + "?tv=" + encodeURIComponent(sid);
    const css2 = document.createElement("style");
    css2.textContent = `#tvphone { position: fixed; inset: 0; z-index: 60; overflow: auto; background: var(--u-solid, #EBE6DC); color: var(--u-text); font: 17px/1.45 var(--u-serif); padding: max(28px, env(safe-area-inset-top)) 22px 28px; box-sizing: border-box; }
      #tvphone .x { position: absolute; top: max(14px, env(safe-area-inset-top)); right: 14px; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--u-card); color: var(--u-ink); font: 400 26px/40px var(--u-sans); cursor: pointer; }
      #tvphone .lab { font: 600 11px/1 var(--u-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--u-coral); margin: 0 0 10px; }
      #tvphone h1 { margin: 0 0 10px; font: 500 34px/1.05 var(--u-serif); color: var(--u-ink); }
      #tvphone p { margin: 0 0 16px; }
      #tvphone .tvshot { aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; border: 6px solid #1d1f22; border-bottom-width: 10px; box-shadow: 0 16px 34px -18px rgba(0,0,0,.5); margin: 4px 0 6px; background: #1d1f22; }
      #tvphone .tvshot img { width: 100%; height: 100%; object-fit: cover; display: block; }
      #tvphone .stand { width: 22%; height: 10px; margin: 0 auto 6px; background: #1d1f22; border-radius: 0 0 6px 6px; }
      #tvphone small { display: block; text-align: center; font: 12px var(--u-sans); color: var(--u-mute); margin-bottom: 22px; }
      #tvphone .acts { display: grid; gap: 10px; }
      #tvphone .acts button { font: 500 16px var(--u-sans); padding: 13px 16px; border-radius: 99px; border: 1px solid var(--u-line); background: var(--u-card); color: var(--u-ink); cursor: pointer; }
      #tvphone .acts button.primary { background: var(--u-coral); border-color: var(--u-coral); color: #fff; }
      #tvphone .url { margin-top: 14px; font: 12.5px/1.4 var(--u-sans); color: var(--u-mute); word-break: break-all; text-align: center; }`;
    document.head.appendChild(css2);
    const el = Object.assign(document.createElement("div"), { id: "tvphone" });
    el.innerHTML = `<button type="button" class="x" aria-label="Close">×</button><div class="lab">TV mode</div><h1>${esc(clean)}</h1>
      <p>This screen is made for a monitor or TV that stays put: a big live departures board, with the buses and trains moving on the map around it. Send it to a computer, or open the link in your TV's browser.</p>
      <div class="tvshot"><img src="tv-preview.jpg" alt="TV mode on a big screen: the map around 24th and Mission with a departures board"></div><div class="stand"></div>
      <small>What it looks like on a TV</small>
      <div class="acts">${navigator.share ? `<button class="primary" data-a="share">Send to a computer</button>` : ""}<button class="${navigator.share ? "" : "primary"}" data-a="copy">Copy the link</button><button data-a="here">Show it here anyway</button></div>
      <div class="url">${esc(link.replace(/^https?:\/\//, ""))}</div>`;
    document.body.appendChild(el);
    el.querySelector("[data-a=share]")?.addEventListener("click", () => (window.track?.("tv: phone action", { action: "send to a computer" }), 0) || navigator.share({ title: `${clean} departures`, text: `Live Muni departures for ${clean}, for a TV or monitor`, url: link }).catch(() => {}));
    el.querySelector("[data-a=copy]").addEventListener("click", async (e) => { window.track?.("tv: phone action", { action: "copy link" }); try { await navigator.clipboard.writeText(link); e.target.textContent = "Link copied"; } catch { e.target.textContent = link; } });
    // close: back to the plain map at this stop (what a phone can use), the stop's arrivals open
    el.querySelector(".x").addEventListener("click", () => { window.track?.("tv: phone action", { action: "close" }); location.href = `${location.pathname}?at=${(+B.lat).toFixed(5)},${(+B.lon).toFixed(5)},300m&stop=${encodeURIComponent(sid)}`; });
    el.querySelector("[data-a=here]").addEventListener("click", () => { window.track?.("tv: phone action", { action: "show it here" }); location.search = location.search + "&here"; });
    window.track?.("tv: phone", { stop: sid });
    return;
  }
  setInterval(fetchBoard, 30e3);
  while (!window.__transit) await new Promise((r) => setTimeout(r, 200));
  const st = { name: B.name, lat: B.lat, lon: B.lon };
  // line colours: the map's own route colours where it knows the line, else Muni's (Rapid red, the rest blue)
  const ROUTES = window.__transit.routes || {}, lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  // a streetcar line run by buses (FBUS, KBUS...) shows as its own line
  const colour = (line) => { line = String(line).replace(/(.)BUS$/, "$1"); const R = ROUTES["SF:" + line]; const c = R?.color || (/R$/.test(line) ? "#c8102e" : "#005B95"); return { name: R?.name || line, color: c, ink: lum(c) > 0.55 ? "#111" : "#fff" }; };
  const shortDest = (d) => d.replace(/\bNiagra\b/, "Niagara").replace(/\/Mezzanine Level$/, "").replace(/^Metro (.*) Station$/, "$1").replace(/ Station$/, "");

  // ---- the view: on the stop, wide enough to see what's coming; back there a minute after anyone moves it ----
  const viewer = window.viewer, vp = viewer.viewport, mi = window.mapItem, geo = window.__geo, G = window.__transit.G;
  // the corner itself, close enough to see each bus pull in; where the city isn't drawn yet, far enough out that the
  // 3D photo underneath still reads as a map (it's soft up close). Drawn or not: the drawing's small preview's alpha.
  let drawn = true;
  try {
    const im = new Image(); im.crossOrigin = "anonymous"; im.src = (window.__mapTiles || "map_files/") + "preview.webp";
    await im.decode();
    const c = Object.assign(document.createElement("canvas"), { width: im.naturalWidth, height: im.naturalHeight }), cx = c.getContext("2d");
    cx.drawImage(im, 0, 0);
    const p0 = window.__transit.G.toPixel(st.lat, st.lon), sz = window.mapItem.getContentSize();
    drawn = cx.getImageData(Math.floor(p0.x / sz.x * c.width), Math.floor(p0.y / sz.y * c.height), 1, 1).data[3] > 200;
  } catch {}
  const metres = Math.max(100, Math.min(6000, +q.get("m") || (drawn ? 230 : 900)));
  function home(immediately) {
    const p = G.toPixel(st.lat, st.lon), w = viewer.container.clientWidth, board = w > viewer.container.clientHeight ? Math.min(w * 0.34, 560) + w * 0.03 : 0;
    const k = (w - board) / (metres / geo.mpp);   // screen px per drawing px
    vp.zoomTo(mi.imageToViewportZoom(k), null, immediately);
    vp.panTo(mi.imageToViewportCoordinates(p.x + board / 2 / k, p.y), immediately);   // the stop in the middle of what the board leaves
  }
  home(true);
  let moved = 0;
  viewer.addHandler("canvas-drag", () => (moved = Date.now()));
  viewer.addHandler("canvas-scroll", () => (moved = Date.now()));
  setInterval(() => { if (moved && Date.now() - moved > 60e3) { moved = 0; home(); } }, 5e3);
  addEventListener("resize", () => home(true));

  // ---- the board ----
  const el = Object.assign(document.createElement("div"), { id: "tvboard" });
  document.body.appendChild(el);
  // "Metro Castro Station/Downtown" -> "Castro Station": a station's board covers both platforms anyway
  const name = st.name.replace(/^Metro /, "").replace(/\s*\/\s*(Downtown|Downtn|Outbound|Outbd)$/, "").replace(/ (Northbound|Southbound|Outbound|Inbound)$/, "").replace(/\s*&\s*/g, " & ");
  // QR: this stop on a phone (the map at the stop with its arrivals card open)
  const phoneURL = `https://smallsf.com/?at=${(+B.lat).toFixed(5)},${(+B.lon).toFixed(5)},300m&stop=${encodeURIComponent(sid)}`;
  let qrSVG = "";
  await new Promise((ok) => { const sc = document.createElement("script"); sc.src = "vendor/qrcode.js?v=" + (window.__cv || ""); sc.onload = sc.onerror = ok; document.head.appendChild(sc); });
  try { const qr = window.qrcode(0, "M"); qr.addData(phoneURL); qr.make(); qrSVG = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }) /* a full four-module quiet zone */; } catch {}
  // minutes until each departure; anything already gone is dropped, never shown as "now"
  const upcoming = (ts, now) => ts.filter((t) => t > now - 30e3).map((t) => Math.max(0, Math.round((t - now) / 60000)));
  const STALE = { muni: 6 * 60e3, bart: 3 * 60e3 };   // past this the rows aren't trustworthy: say so instead of showing them
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m ? `${m} min ago` : "just now"; };
  const times = (mins) => { const [m0, ...more] = mins; return `${m0 === 0 ? "now" : `${m0}<small>min</small>`}${more.length ? `<span class="later">then ${more.join(", ")}</span>` : ""}`; };
  // a subway station: see through the street to the trains in the tunnel (transit.js draws them as ghosts)
  if (/Station|Metro/i.test(B.name)) window.__xray = { lat: st.lat, lon: st.lon };
  // the stop itself, marked on the map
  {
    const pin = Object.assign(document.createElement("div"), { id: "tvhere" });
    pin.innerHTML = `<span>${esc(name)}</span>`;
    const px = G.toPixel(st.lat, st.lon);
    viewer.addOverlay({ element: pin, location: mi.imageToViewportCoordinates(px.x, px.y), placement: OpenSeadragon.Placement.CENTER, checkResize: false });
  }
  // back to the regular map: a button that shows when the mouse moves, or Esc
  const back = () => { window.track?.("tv: back to map", { stop: sid }); location.href = `${location.pathname}?at=${(+st.lat).toFixed(5)},${(+st.lon).toFixed(5)},300m&stop=${encodeURIComponent(sid)}`; };
  { const b = Object.assign(document.createElement("button"), { id: "tvexit", type: "button", textContent: "← Back to the map" }); b.onclick = back; document.body.appendChild(b); }
  addEventListener("keydown", (e) => { if (e.key === "Escape") back(); });
  if (qrSVG) {
    const qel = Object.assign(document.createElement("div"), { id: "tvqr" });
    qel.innerHTML = `${qrSVG}<div><b>This stop on your phone</b>Scan for live arrivals and the map around ${esc(name)}</div>`;
    document.body.appendChild(qel);
  }
  function render() {
    const now = Date.now(), clock = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
    const wx = window.atmo?.wx, temp = wx?.temp != null ? `${Math.round(wx.temp)}°` : "";
    const bt = B.bart, hasBart = !!bt;
    // Muni
    const muniStale = !B.updated || now - B.updated > STALE.muni;
    const muni = muniStale ? [] : (B.rows || []).map((r) => ({ ...colour(r.line), dest: shortDest(r.dest), mins: upcoming(r.t, now) })).filter((r) => r.mins.length).sort((a, b) => a.mins[0] - b.mins[0]);   // re-sorted: dropping a departed time moves a row's next one later
    const muniRows = muni.slice(0, hasBart ? 5 : 8).map((r) => `<tr><td class="r"><span class="badge" style="background:${r.color};color:${r.ink}">${esc(r.name)}</span></td><td class="d">${esc(r.dest)}</td><td class="m">${times(r.mins)}</td></tr>`).join("");
    const muniBody = muniStale ? `<p class="note">Muni predictions haven't updated${B.updated ? ` for ${Math.max(1, Math.round((now - B.updated) / 60000))} min` : ""}, so none are shown.</p>`
      : muniRows ? `<table>${muniRows}</table>` : `<p class="note">No Muni arrivals predicted here right now.</p>`;
    // BART
    let bartBody = "";
    if (hasBart) {
      const stale = bt.error || !bt.updated || now - bt.updated > STALE.bart;
      const rows = stale ? [] : (bt.rows || []).map((r) => ({ ...r, mins: upcoming(r.t, now) })).filter((r) => r.mins.length).sort((a, b) => a.mins[0] - b.mins[0]);
      bartBody = `<div class="sec"><span class="bartmark">BART</span><span>${esc(bt.name)} station</span></div>` + (stale
        ? `<p class="note">BART departures are unavailable right now${bt.updated ? ` (last update ${ago(bt.updated)})` : ""}.</p>`
        : rows.length ? `<table>${rows.slice(0, 4).map((r) => `<tr><td class="r"><span class="line" style="background:${esc(r.color)}"></span></td><td class="d">${esc(r.dest)}</td><td class="m">${times(r.mins)}</td></tr>`).join("")}</table>`
        : `<p class="note">No BART departures listed right now.</p>`);
    }
    el.innerHTML = `<div class="top"><span>${hasBart ? "Departures" : "Muni departures"}</span><span class="clock">${clock}${temp ? " · " + temp : ""}</span></div><h1>${esc(name)}</h1>
      ${hasBart ? `<div class="sec" style="margin-top:0"><span>Muni</span></div>` : ""}${muniBody}${bartBody}
      <div class="foot"><span>Muni via 511.org${B.updated ? `, ${ago(B.updated)}` : ""}${hasBart && bt.updated ? ` · BART via bart.gov, ${ago(bt.updated)}` : ""}</span><span>smallsf.com</span></div>`;
  }
  render(); setInterval(render, 10e3);
  window.track?.("tv: open", { stop: sid, name: B.name, bart: !!B.bart });
  // how long a board stays up (sent when the screen is switched away or closed)
  { const t0 = Date.now(); let sent = false; const done = () => { if (sent) return; sent = true; const m = Math.round((Date.now() - t0) / 60000); window.track?.("tv: watched", { stop: sid, minutes: m, length: m < 1 ? "<1 min" : m < 30 ? "1-30 min" : m < 240 ? "30 min-4 h" : "4 h+" }); };
    addEventListener("pagehide", done); document.addEventListener("visibilitychange", () => { if (document.hidden) done(); }); }

  // ---- a screen left on: no cursor, no sleep, a fresh page every night ----
  let idleT = null;
  const wake = () => { document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 3000); };
  addEventListener("pointermove", wake); wake();
  let lock = null;
  const keepAwake = async () => { try { if (!lock || lock.released) lock = await navigator.wakeLock?.request("screen"); } catch {} };
  keepAwake(); document.addEventListener("visibilitychange", () => { if (!document.hidden) keepAwake(); });
  const loaded = Date.now();
  setInterval(() => { const h = +new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }); if (Date.now() - loaded > 6 * 3600e3 && h === 4) location.reload(); }, 10 * 60e3);
})();
