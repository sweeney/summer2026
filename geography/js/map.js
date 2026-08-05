// Renders the map for a given region. Each region has its own projection
// (from the data pipeline), so shapes look natural rather than stretched.
// setRegion(key) rebuilds the SVG for that region ("all" = the world view);
// highlight(cca3) spotlights one country with a marker for tiny ones;
// setNames(bool) overlays country names (used by the printable Map mode).

const SVG_NS = "http://www.w3.org/2000/svg";
const el = (name) => document.createElementNS(SVG_NS, name);

// `sea` paints the water inside the SVG rather than via CSS, so it survives
// printing (browsers drop CSS backgrounds unless the user opts in).
export function createMap(data, { onPick = null, sea = false, names = false } = {}) {
  const svg = el("svg");
  svg.setAttribute("class", "map");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Map");

  const infoByCode = new Map(data.countries.map((c) => [c.cca3, c]));

  const seaRect = sea ? el("rect") : null;
  if (seaRect) seaRect.setAttribute("class", "sea-rect");

  const labelLayer = el("g");
  labelLayer.setAttribute("class", "labels");

  const marker = el("circle");
  marker.setAttribute("class", "marker");
  const markerDot = el("circle");
  markerDot.setAttribute("class", "marker-dot");

  let members = new Map(); // cca3 -> path element
  let labels = new Map(); // cca3 -> [x, y]
  let currentRegion = null;
  let showNames = names;
  let unitWidth = 1000; // viewBox width — label sizes scale off it

  function drawCountry(cca3, d, cls) {
    const p = el("path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    if (cls === "country") {
      p.dataset.cca3 = cca3;
      if (onPick) {
        p.style.cursor = "pointer";
        p.addEventListener("click", () => onPick(cca3));
      }
      members.set(cca3, p);
    }
    svg.appendChild(p);
  }

  function setRegion(key) {
    if (key === currentRegion) return;
    currentRegion = key;
    svg.replaceChildren();
    members = new Map();
    labels = new Map();
    if (seaRect) svg.appendChild(seaRect);

    let viewBox;
    if (key === "all") {
      viewBox = data.meta.worldViewBox;
      for (const c of data.countries) {
        if (!c.svgPath) continue;
        drawCountry(c.cca3, c.svgPath, "country");
        if (c.labelPoint) labels.set(c.cca3, c.labelPoint);
      }
    } else {
      const rg = data.regionGeo[key];
      viewBox = rg.viewBox;
      for (const d of rg.context) drawCountry(null, d, "ctx");
      for (const [cca3, g] of Object.entries(rg.geo)) {
        drawCountry(cca3, g.path, "country");
        if (g.label) labels.set(cca3, g.label);
      }
    }

    // names, then markers, on top
    svg.appendChild(labelLayer);
    svg.appendChild(marker);
    svg.appendChild(markerDot);
    svg.setAttribute("viewBox", viewBox);
    const [vx, vy, w, h] = viewBox.split(/[\s,]+/).map(Number);
    unitWidth = w || 1000;
    if (seaRect) {
      seaRect.setAttribute("x", vx);
      seaRect.setAttribute("y", vy);
      seaRect.setAttribute("width", w);
      seaRect.setAttribute("height", h);
    }
    marker.setAttribute("r", unitWidth * 0.014);
    markerDot.setAttribute("r", unitWidth * 0.005);
    drawNames();
  }

  // ---- country names ------------------------------------------------------
  // Drawn as SVG text at each country's label point, sized off the viewBox so
  // one rule works for the wide world view and the taller regional ones.
  //
  // Placed greedily with collision avoidance: prominent countries (tier 1) get
  // first pick, each label is nudged around its point to find a free slot, and
  // anything still overlapping is dropped. Without this the world view turns
  // into an unreadable pile of text over Europe.
  function drawNames() {
    labelLayer.replaceChildren();
    if (!showNames) return;
    const fs = unitWidth * 0.0115;
    labelLayer.setAttribute("font-size", fs);
    labelLayer.setAttribute("stroke-width", fs * 0.3); // white halo, see .labels in CSS

    const placed = [];
    for (const { lines, x, y, w, h } of layoutNames(fs)) {
      const box = { x: x - w / 2, y: y - h / 2, w, h };
      const spot = freeSpot(box, placed, h);
      if (!spot) continue;
      placed.push(spot);
      labelLayer.appendChild(labelText(lines, spot.x + w / 2, spot.y + h / 2));
    }
  }

  // Label candidates in drawing priority order, with their measured extents.
  function layoutNames(fs) {
    const items = [];
    for (const [cca3, [x, y]] of labels) {
      const c = infoByCode.get(cca3);
      if (!c) continue;
      const lines = wrapName(c.name);
      const cols = Math.max(...lines.map((l) => l.length));
      items.push({
        tier: c.tier || 3,
        lines,
        x,
        y,
        // Georgia averages ~0.5em per character; pad slightly so labels breathe.
        w: cols * fs * 0.54,
        h: lines.length * fs * 1.04,
      });
    }
    return items.sort((a, b) => a.tier - b.tier || b.w - a.w);
  }

  // Try the label point first, then small vertical/horizontal nudges.
  function freeSpot(box, placed, h) {
    const step = h * 0.9;
    const offsets = [[0, 0], [0, -step], [0, step], [0, -2 * step], [0, 2 * step]];
    for (const [dx, dy] of offsets) {
      const cand = { ...box, x: box.x + dx, y: box.y + dy };
      if (!placed.some((p) => overlaps(p, cand))) return cand;
    }
    return null;
  }

  function labelText(lines, cx, cy) {
    const t = el("text");
    t.setAttribute("class", "country-label");
    t.setAttribute("x", cx);
    t.setAttribute("y", cy);
    // Centre the block vertically on the point (0.34em ≈ half cap height).
    const first = 0.34 - (lines.length - 1) * 0.52;
    lines.forEach((line, i) => {
      const ts = el("tspan");
      ts.setAttribute("x", cx);
      ts.setAttribute("dy", (i === 0 ? first : 1.04) + "em");
      ts.textContent = line;
      t.appendChild(ts);
    });
    return t;
  }

  function setNames(on) {
    showNames = on;
    drawNames();
  }

  function highlight(cca3) {
    for (const [code, p] of members) p.classList.toggle("active", code === cca3);
    const lp = labels.get(cca3);
    for (const m of [marker, markerDot]) {
      if (lp) {
        m.setAttribute("cx", lp[0]);
        m.setAttribute("cy", lp[1]);
        m.style.display = "";
      } else {
        m.style.display = "none";
      }
    }
  }

  return { svg, setRegion, highlight, setNames };
}

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Long names ("Bosnia and Herzegovina") overflow their country, so wrap them
// greedily onto short lines at word boundaries.
const WRAP_AT = 11;
function wrapName(name) {
  if (name.length <= WRAP_AT) return [name];
  const lines = [];
  for (const word of name.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && last.length + 1 + word.length <= WRAP_AT) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines;
}
