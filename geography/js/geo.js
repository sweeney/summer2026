// Real-world distances from map coordinates — used by Locate to say how far a
// tap landed from the country it was hunting for.
//
// The dataset ships projected paths, not coordinates. Two steps get us back to
// kilometres:
//
//   1. The world view is a plain Equal Earth projection fitted to a known
//      viewBox, so a country's world label point inverts exactly to its lat/lon.
//   2. Regional maps use per-region Azimuthal Equal-Area projections whose scale
//      the build doesn't record. We recover it empirically: compare on-map
//      distances between a region's countries with the real distances between
//      the same countries and take the median ratio. The projection is
//      equal-area and near-conformal at these extents, so one scale per region
//      lands within a few percent — plenty for "you were 340 km out".

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2; // Equal Earth's sin-latitude compression
const DEG = 180 / Math.PI;
const EARTH_KM = 6371;

let frame = null; // { k, tx, ty } — the world projection's scale and centre

function worldFrame(data) {
  if (!frame) {
    const [x, y, w, h] = data.meta.worldViewBox.split(/[\s,]+/).map(Number);
    // The sphere spans ±π/(M·A1) in raw Equal Earth units; the build fits that
    // to the viewBox width, centred.
    frame = { k: w / ((2 * Math.PI) / (M * A1)), tx: x + w / 2, ty: y + h / 2 };
  }
  return frame;
}

// World-view map point -> [lon, lat]. Newton's method on the y equation, the
// same inversion d3-geo uses.
export function worldToLatLon(data, [px, py]) {
  const { k, tx, ty } = worldFrame(data);
  const x = (px - tx) / k;
  const y = (ty - py) / k; // SVG y grows downward
  let l = y, l2 = l * l, l6 = l2 * l2 * l2, dydl = A1;
  for (let i = 0; i < 12; i++) {
    const fy = l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)) - y;
    dydl = A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2);
    const step = fy / dydl;
    l -= step;
    l2 = l * l;
    l6 = l2 * l2 * l2;
    if (Math.abs(step) < 1e-12) break;
  }
  return [M * x * dydl * DEG / Math.cos(l), Math.asin(clamp(Math.sin(l) / M)) * DEG];
}

export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) / DEG, dLon = (lon2 - lon1) / DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 / DEG) * Math.cos(lat2 / DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(clamp(Math.sqrt(a)));
}

// Median km per map unit for a region, or null if it can't be calibrated.
const scales = new Map();
export function kmPerUnit(data, regionKey) {
  if (regionKey === "all") return null; // world view converts exactly instead
  if (scales.has(regionKey)) return scales.get(regionKey);

  const geo = data.regionGeo[regionKey]?.geo || {};
  const pts = data.countries
    .filter((c) => c.group === regionKey && c.labelPoint && geo[c.cca3]?.label)
    .map((c) => ({ unit: geo[c.cca3].label, ll: worldToLatLon(data, c.labelPoint) }));

  const ratios = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const u = Math.hypot(pts[i].unit[0] - pts[j].unit[0], pts[i].unit[1] - pts[j].unit[1]);
      // Short hops are dominated by the mismatch between a country's nominal
      // centre and its clipped-shape centroid, so only trust the long ones.
      if (u > 80) ratios.push(haversineKm(pts[i].ll, pts[j].ll) / u);
    }
  }
  const scale = ratios.length >= 3 ? median(ratios) : null;
  scales.set(regionKey, scale);
  return scale;
}

// Distance in km between two points of the map currently on screen, or null
// when the region has no usable scale.
export function distanceKm(data, regionKey, a, b) {
  if (regionKey === "all") {
    return haversineKm(worldToLatLon(data, a), worldToLatLon(data, b));
  }
  const scale = kmPerUnit(data, regionKey);
  return scale == null ? null : Math.hypot(a[0] - b[0], a[1] - b[1]) * scale;
}

const clamp = (n) => Math.min(1, Math.max(-1, n));
function median(list) {
  const s = list.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
