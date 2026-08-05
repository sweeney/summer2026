// Map mode: a full-page, printable map of one region, with country names
// optionally overlaid. Everything outside the sheet is hidden when printing.

import { createMap } from "./map.js";
import * as store from "./store.js";

export function initMapView(container, data) {
  const state = {
    // default to whatever region the user was last learning
    region: store.get("mapRegion", store.get("learnRegion", "europe")),
    names: store.get("mapNames", true),
  };

  const map = createMap(data, { sea: true, names: state.names });

  // Regional maps are portrait-ish, the world view is wide — pick the paper
  // orientation to match so the map fills the page without the user fiddling.
  const pageStyle = document.createElement("style");
  document.head.append(pageStyle);

  function regionMeta() {
    return data.meta.regions.find((r) => r.key === state.region) || data.meta.regions[0];
  }

  function setPageOrientation() {
    const [, , w, h] = regionMeta().viewBox.split(/[\s,]+/).map(Number);
    pageStyle.textContent = `@page { size: ${w >= h ? "landscape" : "portrait"}; margin: 10mm; }`;
  }

  function render() {
    container.replaceChildren(buildControls(), buildSheet());
    map.setRegion(state.region);
    map.setNames(state.names);
    map.highlight(null); // no country is "current" here — hides the pulse marker
    setPageOrientation();
  }

  function buildControls() {
    const bar = el("div", "controls no-print");
    const row = el("div", "controls-row");

    const regionGroup = el("div", "seg");
    regionGroup.append(el("span", "seg-label", "Region"));
    regionGroup.append(
      regionSelect(data, state.region, (key) => {
        state.region = key;
        store.set("mapRegion", key);
        render();
      })
    );

    const namesGroup = el("div", "seg");
    namesGroup.append(el("span", "seg-label", "Names"));
    const namesBtn = el("button", "seg-btn" + (state.names ? " on" : ""), state.names ? "Shown" : "Hidden");
    namesBtn.setAttribute("aria-pressed", state.names ? "true" : "false");
    namesBtn.onclick = () => {
      state.names = !state.names;
      store.set("mapNames", state.names);
      render();
    };
    namesGroup.append(namesBtn);

    const printBtn = el("button", "nav-btn primary", "Print ⌘P");
    printBtn.onclick = () => window.print();

    row.append(regionGroup, namesGroup, printBtn);
    bar.append(row);
    return bar;
  }

  function buildSheet() {
    const sheet = el("div", "map-sheet");
    sheet.append(el("h2", "map-sheet-title", regionMeta().label), map.svg);
    return sheet;
  }

  render();

  return {
    destroy() {
      pageStyle.remove();
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
