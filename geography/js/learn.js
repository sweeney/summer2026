// Learn mode: browse countries, hide chosen attributes, reveal on click/keypress.

import { pool, TIERS, flagUrl } from "./data.js";
import { createMap } from "./map.js";
import * as store from "./store.js";

const FIELDS = ["flag", "name", "capital"]; // hideable attributes (map stays visible)
const REVEAL_LABEL = { flag: "Flag", name: "Country", capital: "Capital" }; // shown on the reveal button

export function initLearn(container, data) {
  const map = createMap(data);

  const state = {
    region: store.get("learnRegion", "europe"),
    maxTier: store.get("learnTier", 1),
    hide: store.get("learnHide", { flag: false, name: true, capital: true }),
    optionsOpen: true, // config panel expanded? collapses when navigating
    index: 0,
    order: [],
    revealed: new Set(),
  };

  function buildOrder() {
    const list = pool(data, state.region, state.maxTier).slice();
    shuffleInPlace(list); // Learn always presents countries in a random order
    state.order = list;
    if (state.index >= list.length) state.index = 0;
  }

  const current = () => state.order[state.index];
  const shown = (field) => !state.hide[field] || state.revealed.has(field);

  function go(delta) {
    state.index = (state.index + delta + state.order.length) % state.order.length;
    state.revealed.clear();
    state.optionsOpen = false; // stepping through collapses the options panel
    render();
  }
  function reveal(field) {
    state.revealed.add(field);
    render();
  }
  function revealAll() {
    for (const f of FIELDS) if (state.hide[f]) state.revealed.add(f);
    render();
  }

  // ---- rendering ----------------------------------------------------------
  function render() {
    const scrollY = window.scrollY; // rebuilding the view resets scroll — restore it
    const c = current();
    container.replaceChildren(buildControls(), buildCard(c));
    map.setRegion(state.region);
    map.highlight(c.cca3);
    window.scrollTo(0, scrollY);
  }

  function buildControls() {
    const bar = el("div", "controls");

    const toggle = el("button", "options-toggle", `Options ${state.optionsOpen ? "▾" : "▸"}`);
    toggle.setAttribute("aria-expanded", state.optionsOpen ? "true" : "false");
    toggle.onclick = () => {
      state.optionsOpen = !state.optionsOpen;
      render();
    };

    if (state.optionsOpen) {
      // Options banner, then the options panel, then the nav (options above nav).
      bar.append(toggle, buildOptionsPanel(), buildNav());
    } else {
      // Collapsed: keep the Options banner on the same row as the nav.
      const row = el("div", "controls-row");
      row.append(toggle, buildNav());
      bar.append(row);
    }
    return bar;
  }

  // Collapsible panel of Region / Level / Hide controls.
  function buildOptionsPanel() {
    const panel = el("div", "options-panel");

    const regionGroup = el("div", "seg");
    regionGroup.append(el("span", "seg-label", "Region"));
    regionGroup.append(
      regionSelect(data, state.region, (key) => {
        state.region = key;
        store.set("learnRegion", key);
        state.index = 0;
        buildOrder();
        render();
      })
    );

    const tierGroup = el("div", "seg");
    tierGroup.append(el("span", "seg-label", "Level"));
    TIERS.forEach((t) => {
      const b = el("button", "seg-btn" + (state.maxTier === t.max ? " on" : ""), t.label);
      b.onclick = () => {
        state.maxTier = t.max;
        store.set("learnTier", t.max);
        state.index = 0;
        buildOrder();
        render();
      };
      tierGroup.append(b);
    });

    const hideGroup = el("div", "seg");
    hideGroup.append(el("span", "seg-label", "Hide"));
    FIELDS.forEach((f) => {
      const b = el("button", "seg-btn" + (state.hide[f] ? " on" : ""), cap(f));
      b.onclick = () => {
        state.hide[f] = !state.hide[f];
        store.set("learnHide", state.hide);
        state.revealed.delete(f);
        render();
      };
      hideGroup.append(b);
    });

    panel.append(regionGroup, tierGroup, hideGroup);
    return panel;
  }

  function buildCard(c) {
    const card = el("div", "card");

    // Map panel (always visible)
    const mapPanel = el("div", "panel map-panel");
    mapPanel.append(map.svg);
    card.append(mapPanel);

    const info = el("div", "info");

    // Flag
    info.append(
      panel("flag", shown("flag"), () => {
        const wrap = el("div", "flag-wrap");
        const img = document.createElement("img");
        img.className = "flag";
        img.src = flagUrl(c);
        img.alt = "Flag of " + c.name;
        wrap.append(img);
        return wrap;
      })
    );

    // Country + Capital share the same labelled-value style.
    info.append(panel("name", shown("name"), () => labeledValue("Country", c.name)));
    info.append(panel("capital", shown("capital"), () => labeledValue("Capital", c.capital || "—")));

    card.append(info);
    return card;
  }

  // A hideable panel: shows content, or a "?" reveal button when hidden.
  function panel(field, isShown, contentFn) {
    const p = el("div", `panel ${field}-panel`);
    if (isShown) {
      p.append(contentFn());
    } else {
      p.classList.add("hidden");
      const btn = el("button", "reveal-btn", `Reveal ${REVEAL_LABEL[field] || field} <span class="q">?</span>`);
      btn.onclick = () => reveal(field);
      p.append(btn);
    }
    return p;
  }

  function buildNav() {
    const nav = el("div", "nav");
    const prev = el("button", "nav-btn", "‹ Prev");
    prev.onclick = () => go(-1);
    const next = el("button", "nav-btn primary", "Next ›");
    next.onclick = () => go(1);
    const count = el("span", "counter", `${state.index + 1} / ${state.order.length}`);
    nav.append(prev, count, next);
    return nav;
  }

  // ---- keyboard -----------------------------------------------------------
  function onKey(e) {
    const t = e.target;
    if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
    if (e.key === "ArrowRight") { go(1); }
    else if (e.key === "ArrowLeft") { go(-1); }
    else if (e.key === " " || e.key === "Enter") {
      if (t && t.tagName === "BUTTON") return; // let the focused button handle it
      e.preventDefault();
      revealAll();
    } else return;
  }
  document.addEventListener("keydown", onKey);

  buildOrder();
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
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function labeledValue(label, value) {
  const d = el("div", "attr");
  d.append(el("span", "attr-label", label), el("span", "attr-value", value));
  return d;
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
function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
