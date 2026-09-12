// Locate mode: the chosen continent is drawn as one borderless landmass — just
// its coastline — and the player is given a country name to find by tapping the
// map. Two ways to score it:
//
//   Hot & cold      three tries, each miss answered with a warmer/colder nudge
//                   and a direction; 3 points for a first-try find, then 2, 1.
//   Distance points one tap, 100 points for landing on the country and fewer
//                   the further out you are.
//
// Tiny countries (Andorra, Malta, Singapore) can't be hit reliably at continent
// zoom, so a tap within a fingertip's radius of the country's centre counts —
// and whenever the answer is missed, or the country is a speck, the map zooms
// in on the reveal so you actually see where it was.

import { pool, TIERS } from "./data.js?v=1";
import { createMap } from "./map.js?v=1";
import { distanceKm } from "./geo.js?v=1";
import * as store from "./store.js?v=1";

const SCORINGS = [
  { key: "hotcold", label: "Hot & cold", tries: 3, max: 3,
    blurb: "Three tries. Each miss tells you how warm you are and which way to go." },
  { key: "distance", label: "Distance points", tries: 1, max: 100,
    blurb: "One tap. The closer you land, the more of the 100 points you keep." },
];

const COUNTS = [5, 10, 15, 20];

// Miss distances are judged against the width of the map on screen, so the
// bands mean the same thing on Europe as on the Americas.
const TEMPS = [
  [0.015, "🔥", "Boiling"],
  [0.04, "🌶", "Hot"],
  [0.10, "☀️", "Warm"],
  [0.22, "🧊", "Cold"],
  [Infinity, "❄️", "Freezing"],
];
const MISS_SPAN = 0.18; // a tap this far across the map scores nothing
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (name) => document.createElementNS(SVG_NS, name);

export function initLocate(container, data) {
  const map = createMap(data, { sea: true, silhouette: true });
  const overlay = svgEl("g");
  overlay.setAttribute("class", "locate-layer");

  const state = {
    region: store.get("locateRegion", store.get("competeRegion", "europe")),
    maxTier: store.get("locateTier", 1),
    count: store.get("locateCount", 10),
    scoring: store.get("locateScoring", "hotcold"),
    phase: "setup", // "setup" | "playing" | "done"
    questions: [],
    qIndex: 0,
    score: 0,
    startTime: 0,
  };

  let ui = null; // the playing screen's live nodes, so the map isn't rebuilt
  let view = null; // viewBox currently on screen, [x, y, w, h]
  let anim = 0; // in-flight zoom animation frame
  let scaled = []; // overlay shapes whose size must track the zoom

  const scoringDef = () => SCORINGS.find((s) => s.key === state.scoring) || SCORINGS[0];
  const regionMeta = () =>
    data.meta.regions.find((r) => r.key === state.region) || data.meta.regions[0];

  // Where a country sits on the map that's currently drawn.
  const pointFor = (c) =>
    state.region === "all"
      ? c.labelPoint
      : data.regionGeo[state.region]?.geo[c.cca3]?.label || null;

  // ---- round setup --------------------------------------------------------
  function buildRound() {
    const available = pool(data, state.region, state.maxTier).filter(pointFor);
    const picks = sample(available, Math.min(state.count, available.length));
    state.questions = picks.map((c) => ({
      country: c,
      taps: [], // { p, hit, dist, km }
      done: false,
      points: 0,
    }));
    state.qIndex = 0;
    state.score = 0;
    state.startTime = Date.now();
    state.phase = "playing";
  }

  const current = () => state.questions[state.qIndex];
  const roundTotal = () => state.questions.length * scoringDef().max;

  // ---- answering ----------------------------------------------------------
  function onTap(e) {
    if (state.phase !== "playing") return;
    const q = current();
    if (!q || q.done) return;
    const p = toUserSpace(e);
    if (!p) return;
    judge(q, p, e.target?.dataset?.cca3 || null);
  }

  function judge(q, p, hitCode) {
    const target = pointFor(q.country);
    const dist = Math.hypot(p[0] - target[0], p[1] - target[1]);
    // Landing on the country's shape counts; so does landing within a
    // fingertip of its centre, which is the only way specks are playable.
    const hit = hitCode === q.country.cca3 || dist <= tolerance();
    const scoring = scoringDef();

    q.taps.push({ p, hit, dist, km: distanceKm(data, state.region, p, target), hitCode });

    if (hit) {
      q.points = scoring.key === "hotcold" ? Math.max(1, scoring.max - (q.taps.length - 1)) : scoring.max;
      finishQuestion(q);
    } else if (q.taps.length >= scoring.tries) {
      q.points = scoring.key === "distance" ? distancePoints(dist) : 0;
      finishQuestion(q);
    } else {
      drawPin(p, false);
      updatePlay();
    }
  }

  function distancePoints(dist) {
    const span = MISS_SPAN * baseView()[2];
    return Math.max(0, Math.round(scoringDef().max * (1 - dist / span)));
  }

  function finishQuestion(q) {
    q.done = true;
    state.score += q.points;
    revealAnswer(q);
    updatePlay();
  }

  function next() {
    if (state.qIndex < state.questions.length - 1) {
      state.qIndex++;
      clearOverlay();
      map.highlight(null);
      animateTo(baseView());
      updatePlay();
    } else {
      finish();
    }
  }

  const bestKey = () => `${state.region}-${state.maxTier}-${state.scoring}-${state.count}`;

  function finish() {
    state.phase = "done";
    const elapsed = Date.now() - state.startTime;
    const best = store.get("locateBest", {}) || {};
    const prev = best[bestKey()];
    const beat = !prev || state.score > prev.score || (state.score === prev.score && elapsed < prev.timeMs);
    if (beat) best[bestKey()] = { score: state.score, total: roundTotal(), timeMs: elapsed };
    store.set("locateBest", best);
    state.lastElapsed = elapsed;
    state.wasBest = beat;
    render();
  }

  // ---- the map: tap geometry, overlay marks, zoom -------------------------
  const baseView = () => map.baseView() || [0, 0, 1000, 1000];

  function toUserSpace(e) {
    const ctm = map.svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }

  // A fingertip in map units: fixed on screen, so it shrinks as you zoom in.
  // The CTM gives the true pixels-per-unit — the SVG is letterboxed inside its
  // box, so its width alone overstates the scale.
  function tolerance() {
    const w = (view || baseView())[2];
    const ctm = map.svg.getScreenCTM();
    const perPx = ctm && ctm.a ? 1 / ctm.a : w / 800;
    return Math.max((matchMedia("(pointer: coarse)").matches ? 18 : 12) * perPx, w * 0.004);
  }

  function clearOverlay() {
    overlay.replaceChildren();
    scaled = [];
  }

  function drawPin(p, final) {
    const ring = svgEl("circle");
    ring.setAttribute("class", "locate-pin" + (final ? " final" : ""));
    ring.setAttribute("cx", p[0]);
    ring.setAttribute("cy", p[1]);
    const dot = svgEl("circle");
    dot.setAttribute("class", "locate-pin-dot");
    dot.setAttribute("cx", p[0]);
    dot.setAttribute("cy", p[1]);
    overlay.append(ring, dot);
    scaled.push([ring, 0.011], [dot, 0.003]);
    applyScale();
  }

  function revealAnswer(q) {
    const target = pointFor(q.country);
    const last = q.taps[q.taps.length - 1];
    map.highlight(q.country.cca3);
    if (!last.hit) {
      drawPin(last.p, true);
      const line = svgEl("line");
      line.setAttribute("class", "locate-trail");
      line.setAttribute("x1", last.p[0]);
      line.setAttribute("y1", last.p[1]);
      line.setAttribute("x2", target[0]);
      line.setAttribute("y2", target[1]);
      overlay.insertBefore(line, overlay.firstChild);
    }

    const ping = svgEl("circle");
    ping.setAttribute("class", "locate-ping");
    ping.setAttribute("cx", target[0]);
    ping.setAttribute("cy", target[1]);
    overlay.append(ping);
    scaled.push([ping, 0.014]);

    const label = svgEl("text");
    label.setAttribute("class", "locate-name");
    label.setAttribute("x", target[0]);
    label.setAttribute("y", target[1]);
    label.textContent = q.country.name;
    overlay.append(label);

    zoomForReveal(q, target, last);
  }

  // Zoom in when the answer was missed, or when the country is too small to
  // make out at continent scale — otherwise the reveal teaches nothing.
  function zoomForReveal(q, target, last) {
    const [, , bw, bh] = baseView();
    const box = map.bboxOf(q.country.cca3);
    const speck = box ? box[2] < bw * 0.035 && box[3] < bh * 0.035 : true;
    if (last.hit && !speck) return;

    let [x0, y0, x1, y1] = box
      ? [box[0], box[1], box[0] + box[2], box[1] + box[3]]
      : [target[0], target[1], target[0], target[1]];
    // Include the miss when it's near enough that both still fit comfortably.
    if (!last.hit && last.dist < bw * 0.22) {
      x0 = Math.min(x0, last.p[0]); x1 = Math.max(x1, last.p[0]);
      y0 = Math.min(y0, last.p[1]); y1 = Math.max(y1, last.p[1]);
    }
    animateTo(fitBox(x0, y0, x1 - x0, y1 - y0));
  }

  // Pad a box, force it to the map's aspect ratio, and keep it inside the map.
  function fitBox(x, y, w, h) {
    const [bx, by, bw, bh] = baseView();
    const aspect = bw / bh;
    let cx = x + w / 2, cy = y + h / 2;
    w = Math.max(w * 2.6, bw * 0.13);
    h = Math.max(h * 2.6, (bw * 0.13) / aspect);
    if (w / h > aspect) h = w / aspect;
    else w = h * aspect;
    if (w > bw) { w = bw; h = bh; }
    return [
      Math.min(Math.max(cx - w / 2, bx), bx + bw - w),
      Math.min(Math.max(cy - h / 2, by), by + bh - h),
      w,
      h,
    ];
  }

  function animateTo(to) {
    cancelAnimationFrame(anim);
    const from = view || baseView();
    if (!view) { setView(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 460);
      const e = 1 - Math.pow(1 - t, 3);
      setView(from.map((v, i) => v + (to[i] - v) * e));
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  function setView(box) {
    view = box;
    map.setView(box);
    applyScale();
  }

  // Overlay marks are sized in map units, so they have to shrink as we zoom in
  // to stay a constant size on screen.
  function applyScale() {
    const w = (view || baseView())[2];
    overlay.setAttribute("font-size", w * 0.026);
    for (const [node, frac] of scaled) node.setAttribute("r", w * frac);
  }

  // ---- rendering ----------------------------------------------------------
  function render() {
    ui = null;
    if (state.phase === "setup") container.replaceChildren(renderSetup());
    else if (state.phase === "playing") mountPlay();
    else container.replaceChildren(renderResults());
  }

  function renderSetup() {
    const wrap = el("div", "setup");
    wrap.append(el("h2", "setup-title", "Find the country"));
    wrap.append(
      el("p", "setup-note",
        "The continent is drawn with no internal borders — just its coastline. " +
        "You get a country name; tap or click where it is.")
    );

    const regionRow = el("div", "seg");
    regionRow.append(el("span", "seg-label", "Continent"));
    const regionOpts = el("div", "seg-opts");
    regionOpts.append(
      regionSelect(data, state.region, (key) => {
        state.region = key;
        store.set("locateRegion", key);
        render();
      })
    );
    regionRow.append(regionOpts);
    wrap.append(regionRow);

    wrap.append(
      segRow("Level", TIERS.map((t) => ({
        label: t.label,
        on: state.maxTier === t.max,
        onClick: () => { state.maxTier = t.max; store.set("locateTier", t.max); render(); },
      })))
    );

    wrap.append(
      segRow("Scoring", SCORINGS.map((s) => ({
        label: s.label,
        on: state.scoring === s.key,
        onClick: () => { state.scoring = s.key; store.set("locateScoring", s.key); render(); },
      })))
    );
    wrap.append(el("p", "setup-note", scoringDef().blurb));

    wrap.append(
      segRow("Countries", COUNTS.map((n) => ({
        label: String(n),
        on: state.count === n,
        onClick: () => { state.count = n; store.set("locateCount", n); render(); },
      })))
    );

    const available = pool(data, state.region, state.maxTier).filter(pointFor).length;
    const start = el("button", "start-btn", "▶ Start");
    start.disabled = available === 0;
    start.onclick = () => { buildRound(); render(); };
    wrap.append(start);
    if (available < state.count) {
      wrap.append(el("p", "best-note", `${regionMeta().label} at this level has ${available} countries — you'll be asked for all of them.`));
    }

    const best = (store.get("locateBest", {}) || {})[bestKey()];
    if (best) wrap.append(el("p", "best-note", `Best for this setup: ${best.score}/${best.total} in ${fmtTime(best.timeMs)}`));
    return wrap;
  }

  // The playing screen is built once per round and then updated in place, so
  // the map (and anything drawn on it) survives between questions.
  function mountPlay() {
    const wrap = el("div", "locate");
    const head = el("div", "quiz-head");
    const progress = el("span", "q-progress");
    const score = el("span", "q-score");
    head.append(progress, score);

    const ask = el("div", "locate-ask");
    const askText = el("div", "q-text");
    const askSub = el("div", "locate-sub");
    ask.append(askText, askSub);

    const panel = el("div", "panel map-panel locate-map");
    const caption = el("div", "locate-caption");
    caption.append(
      el("span", "locate-continent", regionMeta().label),
      el("span", "locate-hint", "no borders — tap the country")
    );
    panel.append(caption, map.svg);

    const feedback = el("div", "locate-feedback");

    wrap.append(head, ask, panel, feedback);
    container.replaceChildren(wrap);

    map.setRegion(state.region);
    map.setNames(false);
    map.highlight(null);
    map.svg.append(overlay); // setRegion may have rebuilt the SVG's children
    clearOverlay();
    view = null;
    setView(baseView());

    ui = { progress, score, askText, askSub, feedback };
    updatePlay();
  }

  function updatePlay() {
    if (!ui) return;
    const q = current();
    const scoring = scoringDef();
    ui.progress.textContent = `Country ${state.qIndex + 1} / ${state.questions.length}`;
    ui.score.textContent = `Score ${state.score} / ${roundTotal()}`;
    ui.askText.innerHTML = `Find <strong>${q.country.name}</strong>`;

    const triesLeft = scoring.tries - q.taps.length;
    ui.askSub.textContent = q.done
      ? ""
      : scoring.key === "hotcold"
        ? triesLeft === scoring.tries
          ? `Tap the map — ${scoring.tries} tries, ${scoring.max} points if you get it first go`
          : `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left`
        : "One tap — the closer you land, the more points you keep";

    ui.feedback.replaceChildren();
    if (!q.done && q.taps.length) ui.feedback.append(hintNode(q));
    if (q.done) {
      ui.feedback.append(resultNode(q));
      const btn = el("button", "nav-btn primary next-btn",
        state.qIndex < state.questions.length - 1 ? "Next ›" : "See results");
      btn.onclick = next;
      ui.feedback.append(btn);
    }
  }

  function hintNode(q) {
    const tap = q.taps[q.taps.length - 1];
    const [emoji, word] = temperature(tap.dist);
    const target = pointFor(q.country);
    const bits = [`${emoji} <strong>${word}</strong>`];
    const hitName = tap.hitCode && tap.hitCode !== q.country.cca3 ? nameOf(tap.hitCode) : null;
    if (hitName) bits.push(`that's ${hitName}`);
    const km = fmtKm(tap.km);
    if (km) bits.push(`${km} away`);
    bits.push(`head ${bearing(tap.p, target)}`);
    return el("div", "feedback bad", bits.join(" · "));
  }

  function resultNode(q) {
    const scoring = scoringDef();
    const tap = q.taps[q.taps.length - 1];
    const pts = `<span class="locate-points">+${q.points}</span>`;
    if (tap.hit) {
      const tries = q.taps.length;
      const how =
        scoring.key === "distance"
          ? "Spot on"
          : tries === 1 ? "First go" : `Got it in ${tries} ${tries === 1 ? "try" : "tries"}`;
      return el("div", "feedback ok", `✅ <strong>${q.country.name}</strong> — ${how}. ${pts}`);
    }
    const near = closestTap(q);
    const km = fmtKm(near.km);
    const off = km ? `${km} off` : "not close";
    const tail = scoring.key === "distance" ? `${off}. ${pts}` : `closest tap ${off}. ${pts}`;
    const partial = q.points > 0;
    return el("div", "feedback " + (partial ? "ok" : "bad"),
      `${partial ? "📍" : "❌"} <strong>${q.country.name}</strong> is here — ${tail}`);
  }

  function renderResults() {
    const wrap = el("div", "results");
    const total = roundTotal();
    const pct = total ? Math.round((state.score / total) * 100) : 0;
    wrap.append(el("h2", "results-title", `${state.score} / ${total}`));
    wrap.append(el("div", "results-sub",
      `${pct}%  ·  ${regionMeta().label}  ·  ${scoringDef().label}  ·  ${fmtTime(state.lastElapsed)}`));
    if (state.wasBest) wrap.append(el("div", "results-best", "New best for this setup!"));

    const list = el("div", "recap");
    for (const q of state.questions) {
      const tap = closestTap(q);
      const found = tap && tap.hit;
      const row = el("div", "recap-row " + (found || q.points > 0 ? "ok" : "bad"));
      const detail = !tap
        ? "—"
        : found
          ? q.taps.length === 1 ? "first go" : `${q.taps.length} tries`
          : (fmtKm(tap.km) || "missed") + " off";
      const mark = found ? "✅" : q.points > 0 ? "📍" : "❌";
      row.innerHTML =
        `<span>${mark}</span>` +
        `<span class="recap-c">${q.country.name}</span>` +
        `<span class="recap-t">${detail}</span>` +
        `<span class="recap-a">${q.points} pts</span>`;
      list.append(row);
    }
    wrap.append(list);

    const again = el("button", "start-btn", "↺ Play again");
    again.onclick = () => { buildRound(); render(); };
    const back = el("button", "nav-btn", "Change setup");
    back.onclick = () => { state.phase = "setup"; render(); };
    const actions = el("div", "results-actions");
    actions.append(again, back);
    wrap.append(actions);
    return wrap;
  }

  // ---- hint wording -------------------------------------------------------
  function temperature(dist) {
    const frac = dist / baseView()[2];
    for (const [limit, emoji, word] of TEMPS) if (frac <= limit) return [emoji, word];
    return TEMPS[TEMPS.length - 1].slice(1);
  }

  // Regional projections are centred on their own region, so screen-up is north
  // closely enough for a nudge.
  function bearing(from, to) {
    const angle = (Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI;
    return COMPASS[Math.round((((angle % 360) + 360) % 360) / 45) % 8];
  }

  // The last tap ends the question; the closest one is what's worth reporting.
  const closestTap = (q) => q.taps.reduce((a, t) => (a && a.dist <= t.dist ? a : t), null);

  const nameOf = (cca3) => data.countries.find((c) => c.cca3 === cca3)?.name || null;

  // ---- keyboard -----------------------------------------------------------
  function onKey(e) {
    if (state.phase === "setup" || state.phase === "done") {
      if (e.key === "Enter") { buildRound(); render(); }
      return;
    }
    if (current()?.done && (e.key === "Enter" || e.key === " ")) {
      if (e.target && e.target.tagName === "BUTTON") return;
      e.preventDefault();
      next();
    }
  }

  map.svg.addEventListener("click", onTap);
  document.addEventListener("keydown", onKey);
  render();

  return {
    destroy() {
      cancelAnimationFrame(anim);
      map.svg.removeEventListener("click", onTap);
      document.removeEventListener("keydown", onKey);
      container.replaceChildren();
    },
  };
}

// ---- helpers --------------------------------------------------------------
function el(tag, className, html) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (html != null) n.innerHTML = html;
  return n;
}
function regionSelect(data, current, onChange) {
  const sel = document.createElement("select");
  sel.className = "region-select";
  for (const r of data.meta.regions) {
    const o = document.createElement("option");
    o.value = r.key;
    o.textContent = `${r.label} (${r.count})`;
    if (r.key === current) o.selected = true;
    sel.append(o);
  }
  sel.onchange = () => onChange(sel.value);
  return sel;
}
function segRow(label, options, extraClass = "") {
  const row = el("div", "seg " + extraClass);
  row.append(el("span", "seg-label", label));
  const opts = el("div", "seg-opts");
  options.forEach((o) => {
    const b = el("button", "seg-btn" + (o.on ? " on" : ""), o.label);
    b.onclick = o.onClick;
    opts.append(b);
  });
  row.append(opts);
  return row;
}
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const sample = (arr, n) => shuffle(arr).slice(0, n);
function fmtTime(ms) {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtKm(km) {
  if (km == null) return null;
  if (km < 15) return "under 15 km";
  const rounded = km < 1000 ? Math.round(km / 10) * 10 : Math.round(km / 50) * 50;
  return `${rounded.toLocaleString("en-GB")} km`;
}
