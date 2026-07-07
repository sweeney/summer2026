#!/usr/bin/env node
// Regenerates ../data/countries.json + ../data/flags/*.svg from open datasets.
//
// Global build: every independent country (minus tiny micro-islands), grouped
// into regions. Each REGION gets its own projection centred on that region
// (Azimuthal Equal-Area) so shapes look natural — the way the old Europe-only
// map did. The whole world is also projected once (Equal Earth) for the "All"
// view. So each country carries a world path AND a region path.
//
// Sources (all open / freely licensed):
//   - Names, capitals, ISO codes, region/subregion, borders, area, latlng:
//     mledoze/countries (ODbL)
//   - Geometry + population + label rank: Natural Earth 1:50m admin-0 (public domain)
//   - Flags: flagcdn.com SVGs (public domain)
//
// Join key: ISO 3166-1 alpha-3 (ISO_A3_EH -> ISO_A3 -> ADM0_A3 -> SOV_A3,
// with a UNK->KOS alias for Kosovo).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { geoEqualEarth, geoAzimuthalEqualArea, geoPath } from "d3-geo";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA = resolve(ROOT, "data");
const FLAGS = resolve(DATA, "flags");
const CACHE = resolve(__dirname, ".cache");
const REFRESH = process.argv.includes("--refresh");

// ---------------------------------------------------------------------------
// Regions. Continents stay whole; Asia is split by sub-region. Each region's
// lon/lat window frames its map (clips overseas bits, selects context, and
// centres its projection). Order here is the dropdown order (after "All").
// ---------------------------------------------------------------------------
const REGIONS = [
  { key: "africa",         label: "Africa",         window: [-26,  58, -37, 38] },
  { key: "americas",       label: "Americas",       window: [-170, -34, -56, 74] },
  { key: "middle-east",    label: "Middle East",    window: [25,   63,  12, 43] },
  { key: "central-asia",   label: "Central Asia",   window: [46,   96,  36, 62] }, // north to 62 to show Russia
  { key: "south-asia",     label: "South Asia",     window: [43,   98,   4, 39] },
  { key: "southeast-asia", label: "Southeast Asia", window: [92,  141, -11, 29] },
  { key: "east-asia",      label: "East Asia",      window: [73,  146,  18, 54] },
  { key: "europe",         label: "Europe",         window: [-25,  45,  34, 72] },
  { key: "oceania",        label: "Oceania",        window: [110, 200, -50,  3] }, // >180 crosses antimeridian (Samoa)
];

const CONTINENT = { Africa: "africa", Americas: "americas", Europe: "europe", Oceania: "oceania" };
const ASIA_SUB = {
  "Western Asia": "middle-east",
  "Central Asia": "central-asia",
  "Southern Asia": "south-asia",
  "South-Eastern Asia": "southeast-asia",
  "Eastern Asia": "east-asia",
};
// Manual group overrides. Russia is transcontinental and enormous — in Europe
// it blows the map out of scale, so it lives in Asia (Central Asia, where it
// borders Kazakhstan and adds the least horizontal spread).
const GROUP_OVERRIDE = { RUS: "central-asia" };
function groupFor(ml) {
  if (GROUP_OVERRIDE[ml.cca3]) return GROUP_OVERRIDE[ml.cca3];
  if (ml.region === "Asia") return ASIA_SUB[ml.subregion] || null;
  return CONTINENT[ml.region] || null; // null => excluded (e.g. Antarctica)
}

const NE_ALIAS = { UNK: "KOS" };
// Include despite not being flagged independent in mledoze (Kosovo).
const INCLUDE_EXTRA = new Set(["UNK"]);

const tierForLabelRank = (r) => (r == null ? 3 : r <= 2 ? 1 : r <= 4 ? 2 : 3);
const skipMicroIsland = (ml, popEst) =>
  ml.region !== "Europe" && (ml.borders || []).length === 0 && ml.area < 1000 && popEst < 1_000_000;

const WORLD_WIDTH = 2000; // width of the world ("All") coordinate space
const REGION_WIDTH = 1000; // width of each region coordinate space
const COORD_PRECISION = 1;

const SOURCES = {
  countries: "https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
  geometry: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
  flag: (cca2) => `https://flagcdn.com/${cca2.toLowerCase()}.svg`,
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const K = 10 ** COORD_PRECISION;
const r1 = (n) => Math.round(n * K) / K;
const roundPath = (str) => (str ? str.replace(/-?\d+\.\d+/g, (m) => String(r1(parseFloat(m)))) : str);
const feat = (geom) => ({ type: "Feature", geometry: geom });

async function loadCached(name, url) {
  mkdirSync(CACHE, { recursive: true });
  const file = resolve(CACHE, name);
  if (existsSync(file) && !REFRESH) return JSON.parse(readFileSync(file, "utf8"));
  process.stdout.write(`  fetching ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  writeFileSync(file, text);
  console.log(`ok (${(text.length / 1024).toFixed(0)} KiB)`);
  return JSON.parse(text);
}

function ringBbox(ring, wrap) {
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  for (let [x, y] of ring) {
    if (wrap && x < 0) x += 360; // antimeridian: treat e.g. -172° as 188°
    if (x < a[0]) a[0] = x;
    if (y < a[1]) a[1] = y;
    if (x > a[2]) a[2] = x;
    if (y > a[3]) a[3] = y;
  }
  return a;
}
// Keep only polygon parts intersecting the window (drops overseas territories).
function clip(geom, [minLon, maxLon, minLat, maxLat]) {
  const wrap = maxLon > 180;
  const ringBb = (ring) => ringBbox(ring, wrap);
  const hit = (b) => !(b[2] < minLon || b[0] > maxLon || b[3] < minLat || b[1] > maxLat);
  if (!geom) return null;
  if (geom.type === "Polygon") return hit(ringBb(geom.coordinates[0])) ? geom : null;
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates.filter((poly) => hit(ringBb(poly[0])));
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  return geom;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
console.log("Building global country data (per-region projections)...");
mkdirSync(FLAGS, { recursive: true });

const mledoze = await loadCached("mledoze-countries.json", SOURCES.countries);
const ne = await loadCached("ne_50m_admin_0_countries.geojson", SOURCES.geometry);

const findNE = (cca3) => {
  const code = NE_ALIAS[cca3] || cca3;
  for (const key of ["ISO_A3_EH", "ISO_A3", "ADM0_A3", "SOV_A3"]) {
    const f = ne.features.find((f) => f.properties[key] === code);
    if (f) return f;
  }
  return null;
};

// Select + resolve.
const issues = [];
const skipped = [];
const resolved = [];
for (const ml of mledoze) {
  if (ml.independent !== true && !INCLUDE_EXTRA.has(ml.cca3)) continue;
  const group = groupFor(ml);
  if (!group) continue;
  const neFeat = findNE(ml.cca3);
  const popEst = neFeat ? neFeat.properties.POP_EST || 0 : 0;
  if (skipMicroIsland(ml, popEst)) { skipped.push(`${ml.name.common} (${ml.cca3}, ${ml.area}km²)`); continue; }
  if (!neFeat) { issues.push(`${ml.cca3}: no Natural Earth geometry`); continue; }
  const capital = ml.capital?.[0] || null;
  if (!capital) issues.push(`${ml.cca3} (${ml.name.common}): no capital`);
  resolved.push({ ml, group, neFeat, capital, tier: tierForLabelRank(neFeat.properties.LABELRANK) });
}

// ---- world projection (for the "All" view) --------------------------------
const worldProj = geoEqualEarth();
worldProj.fitWidth(WORLD_WIDTH, { type: "Sphere" });
const worldPath = geoPath(worldProj);
const [[wx0, wy0], [wx1, wy1]] = worldPath.bounds({ type: "Sphere" });
const worldViewBox = `${r1(wx0)} ${r1(wy0)} ${r1(wx1 - wx0)} ${r1(wy1 - wy0)}`;
const projPoint = (proj, latlng) => {
  if (!Array.isArray(latlng) || latlng.length !== 2) return null;
  const p = proj([latlng[1], latlng[0]]);
  return p ? [r1(p[0]), r1(p[1])] : null;
};

// ---- per-region projections -----------------------------------------------
// regionGeo[key] = { viewBox, context: [pathStrings], geo: { cca3: {path,label} } }
const regionGeo = {};
for (const R of REGIONS) {
  const members = resolved
    .filter((r) => r.group === R.key)
    .map((r) => ({ r, geom: clip(r.neFeat.geometry, R.window) }))
    .filter((m) => m.geom);
  const fc = { type: "FeatureCollection", features: members.map((m) => feat(m.geom)) };

  const [cLon, cLat] = [(R.window[0] + R.window[1]) / 2, (R.window[2] + R.window[3]) / 2];
  const proj = geoAzimuthalEqualArea().rotate([-cLon, -cLat]);
  proj.fitWidth(REGION_WIDTH, fc);
  const path = geoPath(proj);
  let [[x0, y0], [x1, y1]] = path.bounds(fc);
  const padX = (x1 - x0) * 0.05, padY = (y1 - y0) * 0.05;
  const viewBox = `${r1(x0 - padX)} ${r1(y0 - padY)} ${r1(x1 - x0 + 2 * padX)} ${r1(y1 - y0 + 2 * padY)}`;

  const geo = {};
  for (const m of members) {
    const f = feat(m.geom);
    // Marker sits on the centroid of the *visible* (clipped) shape, so it lands
    // on-screen even for countries whose true centre is outside the frame.
    const c = path.centroid(f);
    const label = c && isFinite(c[0]) ? [r1(c[0]), r1(c[1])] : projPoint(proj, m.r.ml.latlng);
    geo[m.r.ml.cca3] = { path: roundPath(path(f)), label };
  }
  // Context: non-member countries clipped to the window (faint background).
  const context = [];
  for (const other of resolved) {
    if (other.group === R.key) continue;
    const g = clip(other.neFeat.geometry, R.window);
    if (!g) continue;
    const d = roundPath(path(feat(g)));
    if (d && d.length > 12) context.push(d);
  }
  regionGeo[R.key] = { viewBox, context, geo };
}

// ---- country records (world path + metadata) ------------------------------
const countries = resolved
  .map(({ ml, group, neFeat, capital, tier }) => ({
    cca2: ml.cca2,
    cca3: ml.cca3,
    name: ml.name.common,
    capital,
    tier,
    group,
    continent: ml.region,
    subregion: ml.subregion,
    flag: `flags/${ml.cca2.toLowerCase()}.svg`,
    svgPath: roundPath(worldPath(neFeat)),
    labelPoint: projPoint(worldProj, ml.latlng),
    borders: Array.isArray(ml.borders) ? ml.borders : [],
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Region metadata for the dropdown (+ viewBox per region).
const regionMeta = [
  { key: "all", label: "All (World)", viewBox: worldViewBox, count: countries.length },
  ...REGIONS.map((r) => ({
    key: r.key,
    label: r.label,
    viewBox: regionGeo[r.key].viewBox,
    count: countries.filter((c) => c.group === r.key).length,
  })),
];

// ---- flags ----------------------------------------------------------------
console.log(`Downloading ${countries.length} flags...`);
const flagFails = [];
const queue = countries.slice();
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const c = queue.pop();
      try {
        const res = await fetch(SOURCES.flag(c.cca2));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        writeFileSync(resolve(DATA, c.flag), await res.text());
      } catch (e) {
        flagFails.push(`${c.cca3}: flag failed (${e.message})`);
      }
    }
  })
);
issues.push(...flagFails);

// ---- write ----------------------------------------------------------------
const out = {
  meta: {
    generated: new Date().toISOString(),
    scope: "World — independent states (excl. tiny micro-islands & Antarctica)",
    count: countries.length,
    worldViewBox,
    projection: "per-region Azimuthal Equal-Area; world = Equal Earth",
    tiers: { 1: "easy / most prominent", 2: "medium", 3: "hard / all" },
    regions: regionMeta,
    sources: {
      names_capitals_borders: "mledoze/countries (ODbL)",
      geometry_population: "Natural Earth 1:50m admin-0 (public domain)",
      flags: "flagcdn.com (public domain)",
    },
  },
  regionGeo,
  countries,
};
writeFileSync(resolve(DATA, "countries.json"), JSON.stringify(out) + "\n");

// ---- report ---------------------------------------------------------------
const withRegionGeom = countries.filter((c) => regionGeo[c.group]?.geo[c.cca3]).length;
const report = [
  `# Data validation report`,
  ``,
  `Generated: ${out.meta.generated}`,
  ``,
  `- Countries emitted: ${countries.length}`,
  `- With world geometry: ${countries.filter((c) => c.svgPath).length}/${countries.length}`,
  `- With region geometry: ${withRegionGeom}/${countries.length}`,
  `- Flag failures: ${flagFails.length}`,
  ``,
  `## Regions`,
  ...regionMeta.map((r) => `- ${r.label} (${r.key}): ${r.count}` + (regionGeo[r.key] ? `, context ${regionGeo[r.key].context.length}` : "")),
  ``,
  `## Tier distribution`,
  ...[1, 2, 3].map((t) => `- tier ${t}: ${countries.filter((c) => c.tier === t).length}`),
  ``,
  `## Skipped micro-islands (${skipped.length})`,
  ...skipped.map((s) => `- ${s}`),
  ``,
  issues.length ? `## Issues (${issues.length})` : `## No issues 🎉`,
  ...issues.map((i) => `- ${i}`),
  ``,
].join("\n");
writeFileSync(resolve(DATA, "validation-report.md"), report + "\n");
console.log("\n" + report);
console.log(`Wrote data/countries.json (${countries.length} countries).`);
