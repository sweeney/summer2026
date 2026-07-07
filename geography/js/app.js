// Entry point: loads data, renders the mode switcher, mounts the active mode.

import { loadData } from "./data.js";
import { initLearn } from "./learn.js";
import { initCompete } from "./compete.js";
import * as store from "./store.js";

const MODES = [
  { id: "learn", label: "Learn", init: initLearn },
  { id: "compete", label: "Compete", init: initCompete },
];

const view = document.getElementById("view");
const modesNav = document.getElementById("modes");

let active = null; // { destroy() }

async function main() {
  let data;
  try {
    data = await loadData();
  } catch (e) {
    view.innerHTML = `<div class="error"><h2>Couldn't load data</h2><p>${e.message}</p></div>`;
    return;
  }

  const hashMode = location.hash.replace("#", "");
  let currentMode = hashMode || store.get("mode", "learn");
  if (!MODES.some((m) => m.id === currentMode && m.init)) currentMode = "learn";

  function renderTabs() {
    modesNav.replaceChildren(
      ...MODES.map((m) => {
        const b = document.createElement("button");
        b.className = "mode-tab" + (m.id === currentMode ? " on" : "");
        b.innerHTML = m.label;
        b.disabled = !m.init;
        if (!m.init) b.title = "Coming soon";
        b.onclick = () => switchMode(m.id);
        return b;
      })
    );
  }

  function switchMode(id) {
    const mode = MODES.find((m) => m.id === id);
    if (!mode || !mode.init) return;
    if (active) active.destroy();
    currentMode = id;
    store.set("mode", id);
    if (location.hash.replace("#", "") !== id) location.hash = id;
    renderTabs();
    active = mode.init(view, data);
  }

  window.addEventListener("hashchange", () => {
    const m = location.hash.replace("#", "");
    if (m && m !== currentMode && MODES.some((x) => x.id === m && x.init)) switchMode(m);
  });

  renderTabs();
  switchMode(currentMode);
}

main();
