// Compete mode: a timed quiz of N countries. Prompt attribute -> guess attribute.
// Easy = 3-way multiple choice; Hard = fuzzy text entry. Question types are mixed
// by default, or locked to one via the setup toggle.

import { pool, TIERS, flagUrl } from "./data.js";
import { createMap } from "./map.js";
import { fuzzyMatch } from "./fuzzy.js";
import * as store from "./store.js";

// prompt: what we show. target: what they guess (always text-answerable).
const TYPES = [
  { key: "map-name", prompt: "map", target: "name", label: "Map → Country" },
  { key: "flag-name", prompt: "flag", target: "name", label: "Flag → Country" },
  { key: "name-capital", prompt: "name", target: "capital", label: "Country → Capital" },
  { key: "capital-name", prompt: "capital", target: "name", label: "Capital → Country" },
  { key: "flag-capital", prompt: "flag", target: "capital", label: "Flag → Capital" },
  { key: "map-capital", prompt: "map", target: "capital", label: "Map → Capital" },
];

// Extra accepted spellings for the text-entry (country) answers.
const ALIASES = {
  GBR: ["uk", "britain", "great britain"],
  CZE: ["czech republic"],
  MKD: ["macedonia"],
  BIH: ["bosnia"],
  VAT: ["vatican"],
  NLD: ["holland"],
  TUR: ["turkey"],
  MMR: ["burma"],
  SWZ: ["swaziland"],
  TLS: ["east timor"],
  COD: ["democratic republic of the congo", "dr congo", "drc", "congo"],
  COG: ["republic of the congo", "congo"],
  USA: ["usa", "america", "united states of america"],
  ARE: ["uae", "emirates"],
  KOR: ["south korea"],
  PRK: ["north korea"],
};

const COUNTS = [5, 10, 15, 20];

export function initCompete(container, data) {
  const map = createMap(data);

  const state = {
    region: store.get("competeRegion", "europe"),
    maxTier: store.get("competeTier", 1),
    mode: store.get("competeMode", "easy"), // "easy" | "hard"
    count: store.get("competeCount", 10),
    lockType: store.get("competeLock", null), // null = mixed, else a TYPES key
    phase: "setup", // "setup" | "playing" | "done"
    questions: [],
    qIndex: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    startTime: 0,
    answered: false,
  };

  // ---- round setup --------------------------------------------------------
  function poolTypes() {
    return state.lockType ? TYPES.filter((t) => t.key === state.lockType) : TYPES;
  }

  function buildRound() {
    const available = pool(data, state.region, state.maxTier);
    const n = Math.min(state.count, available.length);
    const picks = sample(available, n);
    const types = poolTypes();
    state.questions = picks.map((c, i) => {
      const type = types[Math.floor(Math.random() * types.length)];
      const answer = targetValue(c, type.target);
      const q = { country: c, type, answer, given: null, correct: null };
      if (state.mode === "easy") q.options = buildOptions(c, type, available);
      return q;
    });
    state.qIndex = 0;
    state.score = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.answered = false;
    state.startTime = Date.now();
    state.phase = "playing";
  }

  // Distractors are drawn from nearby countries so choices are plausible:
  // land-border neighbours first, then the geographically closest others.
  function buildOptions(country, type, available) {
    const answer = targetValue(country, type.target);
    const others = available.filter((c) => c.cca3 !== country.cca3 && c.labelPoint);
    const borderSet = new Set(country.borders || []);

    const neighbours = shuffle(others.filter((c) => borderSet.has(c.cca3)));
    const rest = others
      .filter((c) => !borderSet.has(c.cca3))
      .sort((a, b) => distance(country, a) - distance(country, b));
    // shuffle the nearest handful for variety, keep the far ones as a fallback
    const ranked = [...neighbours, ...shuffle(rest.slice(0, 5)), ...rest.slice(5)];

    const distractors = [];
    for (const c of ranked) {
      const v = targetValue(c, type.target);
      if (v && v !== answer && !distractors.includes(v)) distractors.push(v);
      if (distractors.length === 2) break;
    }
    return shuffle([answer, ...distractors]);
  }

  const distance = (a, b) =>
    Math.hypot(a.labelPoint[0] - b.labelPoint[0], a.labelPoint[1] - b.labelPoint[1]);

  const targetValue = (c, target) => (target === "capital" ? c.capital : c.name);
  const acceptedFor = (c, target) =>
    target === "name" ? [c.name, ...(ALIASES[c.cca3] || [])] : [c.capital];

  // ---- answering ----------------------------------------------------------
  function answer(given) {
    if (state.answered) return;
    const q = state.questions[state.qIndex];
    const ok =
      state.mode === "easy"
        ? given === q.answer
        : fuzzyMatch(given, acceptedFor(q.country, q.type.target));
    q.given = given;
    q.correct = ok;
    state.answered = true;
    if (ok) {
      state.score++;
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    } else {
      state.streak = 0;
    }
    render();
  }

  function next() {
    if (state.qIndex < state.questions.length - 1) {
      state.qIndex++;
      state.answered = false;
      render();
    } else {
      finish();
    }
  }

  // Identifies a "best score" bucket: region + level + mode + type.
  const bestKey = () =>
    `${state.region}-${state.maxTier}-${state.mode}-${state.lockType || "mixed"}`;

  function finish() {
    state.phase = "done";
    const key = bestKey();
    const best = store.get("competeBest", {});
    const elapsed = Date.now() - state.startTime;
    const prev = best[key];
    const beat =
      !prev ||
      state.score > prev.score ||
      (state.score === prev.score && elapsed < prev.timeMs);
    if (beat) best[key] = { score: state.score, total: state.questions.length, timeMs: elapsed };
    store.set("competeBest", best);
    state.lastElapsed = elapsed;
    state.wasBest = beat;
    render();
  }

  // ---- rendering ----------------------------------------------------------
  function render() {
    if (state.phase === "setup") container.replaceChildren(renderSetup());
    else if (state.phase === "playing") container.replaceChildren(renderQuestion());
    else container.replaceChildren(renderResults());
  }

  function renderSetup() {
    const wrap = el("div", "setup");
    wrap.append(el("h2", "setup-title", "Set up your quiz"));

    // Region selector
    const regionRow = el("div", "seg");
    regionRow.append(el("span", "seg-label", "Region"));
    const regionOpts = el("div", "seg-opts");
    regionOpts.append(
      regionSelect(data, state.region, (key) => {
        state.region = key;
        store.set("competeRegion", key);
        render();
      })
    );
    regionRow.append(regionOpts);
    wrap.append(regionRow);

    wrap.append(
      segRow("Level", TIERS.map((t) => ({
        label: t.label,
        on: state.maxTier === t.max,
        onClick: () => { state.maxTier = t.max; store.set("competeTier", t.max); render(); },
      })))
    );

    wrap.append(
      segRow("Mode", [
        { label: "Easy (choices)", on: state.mode === "easy", onClick: () => setMode("easy") },
        { label: "Hard (typing)", on: state.mode === "hard", onClick: () => setMode("hard") },
      ])
    );

    wrap.append(
      segRow("Questions", COUNTS.map((n) => ({
        label: String(n),
        on: state.count === n,
        onClick: () => { state.count = n; store.set("competeCount", n); render(); },
      })))
    );

    const typeOpts = [
      { label: "Mixed", on: !state.lockType, onClick: () => setLock(null) },
      ...TYPES.map((t) => ({
        label: t.label,
        on: state.lockType === t.key,
        onClick: () => setLock(t.key),
      })),
    ];
    wrap.append(segRow("Type", typeOpts, "wrapseg"));

    const start = el("button", "start-btn", "▶ Start quiz");
    start.onclick = () => { buildRound(); render(); };
    wrap.append(start);

    const best = (store.get("competeBest", {}) || {})[bestKey()];
    if (best) wrap.append(el("p", "best-note", `Best for this setup: ${best.score}/${best.total} in ${fmtTime(best.timeMs)}`));
    return wrap;

    function setMode(m) { state.mode = m; store.set("competeMode", m); render(); }
    function setLock(k) { state.lockType = k; store.set("competeLock", k); render(); }
  }

  function renderQuestion() {
    const q = state.questions[state.qIndex];
    const wrap = el("div", "quiz");

    // header: progress + score + streak
    const head = el("div", "quiz-head");
    head.append(
      el("span", "q-progress", `Question ${state.qIndex + 1} / ${state.questions.length}`),
      el("span", "q-score", `Score ${state.score}` + (state.streak > 1 ? `  🔥${state.streak}` : ""))
    );
    wrap.append(head);

    // Two columns: the prompt (map/flag/text) on the left, the question and
    // answer flow on the right — lets the map be large without pushing the
    // answer below the fold.
    const body = el("div", "quiz-body");
    const left = el("div", "quiz-prompt");
    left.append(renderPrompt(q));

    const right = el("div", "quiz-answer");
    right.append(el("div", "q-text", questionText(q)));
    right.append(state.mode === "easy" ? renderChoices(q) : renderTextEntry(q));

    if (state.answered) {
      const fb = el("div", "feedback " + (q.correct ? "ok" : "bad"));
      const fact =
        q.type.target === "capital"
          ? `<strong>${q.country.capital}</strong> is the capital of ${q.country.name}`
          : `It's <strong>${q.country.name}</strong> — capital: ${q.country.capital}`;
      fb.innerHTML = (q.correct ? "✅ Correct! " : "❌ ") + fact;
      right.append(fb);
      const nextBtn = el("button", "nav-btn primary next-btn",
        state.qIndex < state.questions.length - 1 ? "Next ›" : "See results");
      nextBtn.onclick = next;
      right.append(nextBtn);
    }

    body.append(left, right);
    wrap.append(body);
    return wrap;
  }

  function renderPrompt(q) {
    const panel = el("div", "panel prompt-panel " + q.type.prompt + "-prompt");
    if (q.type.prompt === "map") {
      panel.classList.add("map-panel");
      panel.append(map.svg);
      map.setRegion(state.region);
      map.highlight(q.country.cca3);
    } else if (q.type.prompt === "flag") {
      const img = document.createElement("img");
      img.className = "flag";
      img.src = flagUrl(q.country);
      img.alt = "Flag to identify";
      panel.append(img);
    } else if (q.type.prompt === "name") {
      panel.append(el("div", "name", q.country.name));
    } else if (q.type.prompt === "capital") {
      const d = el("div", "capital");
      d.append(el("span", "cap-label", "Capital"), el("span", "cap-value", q.country.capital));
      panel.append(d);
    }
    return panel;
  }

  function renderChoices(q) {
    const box = el("div", "choices");
    q.options.forEach((opt, i) => {
      const b = el("button", "choice", `<span class="key">${i + 1}</span> ${opt}`);
      if (state.answered) {
        b.disabled = true;
        if (opt === q.answer) b.classList.add("is-correct");
        else if (opt === q.given) b.classList.add("is-wrong");
      } else {
        b.onclick = () => answer(opt);
      }
      box.append(b);
    });
    return box;
  }

  function renderTextEntry(q) {
    const box = el("div", "text-entry");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "answer-input";
    input.placeholder = q.type.target === "capital" ? "Type the capital…" : "Type the country…";
    input.autocomplete = "off";
    input.autocapitalize = "words";
    input.spellcheck = false;
    if (state.answered) {
      input.value = q.given || "";
      input.disabled = true;
    }
    const submit = el("button", "nav-btn primary", "Check");
    submit.onclick = () => { if (input.value.trim()) answer(input.value.trim()); };
    box.append(input, submit);
    if (!state.answered) queueMicrotask(() => input.focus());
    return box;
  }

  function renderResults() {
    const wrap = el("div", "results");
    const total = state.questions.length;
    const pct = Math.round((state.score / total) * 100);
    wrap.append(el("h2", "results-title", `${state.score} / ${total}`));
    wrap.append(el("div", "results-sub", `${pct}%  ·  ${fmtTime(state.lastElapsed)}  ·  best streak ${state.bestStreak}`));
    if (state.wasBest) wrap.append(el("div", "results-best", "New best for this setup!"));

    // per-question recap
    const list = el("div", "recap");
    state.questions.forEach((q, i) => {
      const row = el("div", "recap-row " + (q.correct ? "ok" : "bad"));
      row.innerHTML = `<span>${q.correct ? "✅" : "❌"}</span>` +
        `<span class="recap-c">${q.country.name}</span>` +
        `<span class="recap-t">${q.type.label}</span>` +
        `<span class="recap-a">${q.correct ? q.answer : (q.given || "—") + " → " + q.answer}</span>`;
      list.append(row);
    });
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

  function questionText(q) {
    switch (q.type.key) {
      case "map-name": return "Which country is highlighted?";
      case "flag-name": return "Which country's flag is this?";
      case "name-capital": return `What is the capital of ${q.country.name}?`;
      case "capital-name": return `${q.country.capital} is the capital of…?`;
      case "flag-capital": return "What is the capital of this country?";
      case "map-capital": return "What is the capital of the highlighted country?";
      default: return "";
    }
  }

  // ---- keyboard -----------------------------------------------------------
  function onKey(e) {
    if (state.phase === "setup") {
      if (e.key === "Enter") { buildRound(); render(); }
      return;
    }
    if (state.phase === "done") {
      if (e.key === "Enter") { buildRound(); render(); }
      return;
    }
    // playing
    if (state.answered) {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target && e.target.tagName === "BUTTON") return;
        e.preventDefault();
        next();
      }
      return;
    }
    if (state.mode === "easy" && ["1", "2", "3"].includes(e.key)) {
      const q = state.questions[state.qIndex];
      const opt = q.options[Number(e.key) - 1];
      if (opt != null) answer(opt);
    } else if (state.mode === "hard" && e.key === "Enter") {
      const input = container.querySelector(".answer-input");
      if (input && input.value.trim()) answer(input.value.trim());
    }
  }
  document.addEventListener("keydown", onKey);

  render();

  return {
    destroy() {
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
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
