// Loads and caches the generated country dataset + region/tier helpers.

// Everything in countries.json (flag paths) is relative to this directory.
export const DATA_BASE = "data/";
export const flagUrl = (c) => DATA_BASE + c.flag;

let _data = null;

export async function loadData() {
  if (_data) return _data;
  let res;
  try {
    res = await fetch("data/countries.json");
  } catch (e) {
    throw new Error(
      "Could not load data/countries.json. If you opened index.html directly " +
        "(file://), run a local server instead, e.g.  python3 -m http.server"
    );
  }
  if (!res.ok) throw new Error("Failed to load countries.json: HTTP " + res.status);
  _data = await res.json();
  return _data;
}

// Tiers are cumulative: Easy = tier 1, Medium = tiers 1-2, All = everything.
export const TIERS = [
  { max: 1, label: "Easy" },
  { max: 2, label: "Medium" },
  { max: 3, label: "All" },
];

// Region metadata: [{ key, label, viewBox, count }], "all" first.
export const regions = (data) => data.meta.regions;

// Countries in a region (key "all" = everything), up to a difficulty tier.
export function pool(data, regionKey, maxTier) {
  return data.countries.filter(
    (c) => (regionKey === "all" || c.group === regionKey) && c.tier <= maxTier
  );
}

export function byCode(data, cca3) {
  return data.countries.find((c) => c.cca3 === cca3) || null;
}
