// Renders the map for a given region. Each region has its own projection
// (from the data pipeline), so shapes look natural rather than stretched.
// setRegion(key) rebuilds the SVG for that region ("all" = the world view);
// highlight(cca3) spotlights one country with a marker for tiny ones.

const SVG_NS = "http://www.w3.org/2000/svg";
const el = (name) => document.createElementNS(SVG_NS, name);

export function createMap(data, { onPick = null } = {}) {
  const svg = el("svg");
  svg.setAttribute("class", "map");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Map");

  const marker = el("circle");
  marker.setAttribute("class", "marker");
  const markerDot = el("circle");
  markerDot.setAttribute("class", "marker-dot");

  let members = new Map(); // cca3 -> path element
  let labels = new Map(); // cca3 -> [x, y]
  let currentRegion = null;

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

    // markers on top
    svg.appendChild(marker);
    svg.appendChild(markerDot);
    svg.setAttribute("viewBox", viewBox);
    const w = parseFloat(viewBox.split(" ")[2]) || 1000;
    marker.setAttribute("r", w * 0.014);
    markerDot.setAttribute("r", w * 0.005);
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

  return { svg, setRegion, highlight };
}
