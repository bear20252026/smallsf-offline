// The map's sound, off unless you turn it on (the speaker square, top right; remembered as "sf-sound"). Nothing here
// makes a noise or even opens an AudioContext until you do: browsers only allow audio after a tap, so a remembered
// "on" waits for your first tap or key on the page.
// What you hear: the Golden Gate's foghorn when the satellite has fog at the bridge (atmosphere.js, window.__fogAtLL),
// every 45-90 s, quieter the further from the Gate you're looking; and a distant thump for each firework (moments.js).
// All synthesized with the Web Audio API, no audio files. ?foghorn=1 sounds one as soon as sound is on (any weather);
// ?weather=fog or ?fogtime=... give it fog to blow for.
(function () {
  const btn = document.querySelector('.sq [data-act="sound"]');
  const q = new URLSearchParams(location.search);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  let on = store.get("sf-sound") === "1", ac = null, master = null, verb = null, wantDemo = q.get("foghorn") === "1";

  function paint() {
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    btn.title = on ? "Sound on" : "Sound off";
  }
  paint();

  // ---- the audio graph, made on the first tap with sound on: master volume, and a long, dark reverb (the bay) ----
  function start() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
      // a reverb from decaying noise: 4 s, darker as it fades (a soft-edged lowpass on the tail)
      const len = Math.round(ac.sampleRate * 4), ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch); let lp = 0;
        for (let i = 0; i < len; i++) { const t = i / ac.sampleRate, k = 0.35 - Math.min(0.3, t * 0.08); lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.exp(-t * 1.5) * 1.8; }
      }
      verb = ac.createConvolver(); verb.buffer = ir;
      const wet = ac.createGain(); wet.gain.value = 0.55; verb.connect(wet); wet.connect(master);
    }
    if (ac.state === "suspended") ac.resume();
    return true;
  }

  // ---- how loud: the Gate is where the horn is; looking at the far side of the city, it's faint ----
  const GATE = [37.8199, -122.4783];
  let G0 = null;
  function far(lat, lon) {   // km from the middle of the view to a place, and how zoomed in (0 = the whole city)
    const mi = window.mapItem, vp = window.viewer?.viewport, geo = window.__geo;
    if (!mi || !vp || !geo || !window.IsoGeo) return { km: 5, zin: 0 };
    G0 ||= IsoGeo.make(geo, null);
    const p = G0.toPixelAt(lat, lon, 10), c = mi.viewportToImageCoordinates(vp.getCenter(true));
    const pxPerM = mi.viewportToImageZoom(vp.getZoom(true)) / geo.mpp;
    return { km: (Math.hypot(p.x - c.x, p.y - c.y) * geo.mpp) / 1000, zin: Math.max(0, Math.min(1, Math.log2(pxPerM / 0.15) / 3)) };
  }
  const loudness = (lat, lon) => { const f = far(lat, lon), near = Math.max(0.12, Math.min(1, 1.2 - f.km / 6)); return { g: 0.55 + (near - 0.55) * f.zin, km: f.km * f.zin }; };

  // ---- the foghorn: the Golden Gate's two-tone call, a high note then a lower one with a grunt at the end ----
  // A reedy, brassy tone (two slightly detuned saws and a sine, through a lowpass with a horn-ish peak), a slow swell,
  // a slight waver; then distance: more lowpass the further off, an echo off the hills and the reverb.
  function foghorn(vol) {
    if (!start()) return;
    const t0 = ac.currentTime + 0.05, L = loudness(...GATE), level = (vol ?? 1) * L.g;
    const bus = ac.createGain(); bus.gain.value = level * 0.26;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.max(320, 820 - L.km * 70); lp.Q.value = 0.5;
    const echo = ac.createDelay(2); echo.delayTime.value = 0.75; const eg = ac.createGain(); eg.gain.value = 0.22;
    bus.connect(lp); lp.connect(master); lp.connect(verb); lp.connect(echo); echo.connect(eg); eg.connect(lp);   // the echo feeds back, softly
    const notes = [[0, 1.9, 172, 1], [2.1, 2.5, 138, 0.82]];   // start (s), length (s), Hz, level
    for (const [at, len, f, lv] of notes) {
      const s = t0 + at, e = s + len, g = ac.createGain(), body = ac.createBiquadFilter();
      body.type = "peaking"; body.frequency.value = 420; body.Q.value = 1.4; body.gain.value = 6;
      const tone = ac.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 1100;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(lv, s + 0.38); g.gain.setValueAtTime(lv, e - 0.35); g.gain.linearRampToValueAtTime(0, e + 0.25);
      g.connect(body); body.connect(tone); tone.connect(bus);
      const lfo = ac.createOscillator(), depth = ac.createGain(); lfo.frequency.value = 4.6; depth.gain.value = f * 0.006; lfo.connect(depth);
      for (const [type, mul, amp] of [["sawtooth", 1, 0.5], ["sawtooth", 1.006, 0.4], ["sine", 1, 0.7], ["sine", 0.5, 0.35]]) {
        const o = ac.createOscillator(), a = ac.createGain(); o.type = type; a.gain.value = amp;
        o.frequency.setValueAtTime(f * mul * 0.97, s); o.frequency.linearRampToValueAtTime(f * mul, s + 0.25);   // the reed catching
        if (at > 0) { o.frequency.setValueAtTime(f * mul, e - 0.45); o.frequency.linearRampToValueAtTime(f * mul * 0.82, e + 0.2); }   // the grunt
        depth.connect(o.frequency); o.connect(a); a.connect(g); o.start(s); o.stop(e + 0.3);
      }
      lfo.start(s); lfo.stop(e + 0.3);
    }
    setTimeout(() => { try { bus.disconnect(); eg.disconnect(); } catch {} }, 12e3);
  }

  // ---- a firework's thump, delayed a moment for the distance ----
  let booms = 0;
  function boom({ lat, lon, big } = {}) {
    if (!on || !ac || ac.state !== "running" || document.hidden || booms > 6) return;
    const L = loudness(lat, lon), t = ac.currentTime + Math.min(0.8, 0.05 + L.km * 0.12), len = big ? 1.4 : 0.9;
    const n = Math.round(ac.sampleRate * len), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * (big ? 0.28 : 0.18)));
    const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; lp.type = "lowpass"; lp.frequency.value = Math.max(110, 260 - L.km * 25); g.gain.value = L.g * (big ? 0.9 : 0.6);
    src.connect(lp); lp.connect(g); g.connect(master); g.connect(verb);
    booms++; src.onended = () => booms--;
    src.start(t);
  }
  window.__sound = { get on() { return on && !!ac; }, foghorn, boom };

  // ---- when to blow: fog at the Gate (the satellite's, or the weather station's word when there's no satellite) ----
  function fogAtGate() {
    const f = window.__fogAtLL?.(...GATE); if (f != null) return f;
    const wx = window.atmo?.wx; return wx && (wx.code === 45 || wx.code === 48 || wx.visibility < 3000) ? 1 : 0;
  }
  let next = null;
  setInterval(() => {
    if (!on || !ac || ac.state !== "running" || document.hidden) return;
    if (fogAtGate() <= 0.4) { next = null; return; }
    const t = Date.now();
    if (next == null) next = t + 4e3 + Math.random() * 8e3;   // fog just came in, or sound just went on: soon
    else if (t >= next) { foghorn(); next = t + 45e3 + Math.random() * 45e3; }
  }, 1000);

  // ---- the button, and the first tap after a remembered "on" ----
  function enable() {
    if (!start()) return;
    if (wantDemo) { wantDemo = false; foghorn(); next = Date.now() + 45e3 + Math.random() * 45e3; }
  }
  btn?.addEventListener("click", () => {
    on = !on; store.set("sf-sound", on ? "1" : null); paint();
    window.track?.("map: sound", { on });
    if (on) enable(); else { next = null; if (ac) ac.suspend(); }
  });
  const gesture = () => { if (on) enable(); if (ac && ac.state === "running") for (const ev of ["pointerdown", "keydown"]) removeEventListener(ev, gesture, true); };
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, gesture, true);
})();
