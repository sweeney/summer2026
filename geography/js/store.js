// Tiny localStorage-backed settings/state store.

const KEY = "europe-explorer";

let cache = null;

function read() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    cache = {};
  }
  return cache;
}

export function get(key, fallback) {
  const v = read()[key];
  return v === undefined ? fallback : v;
}

export function set(key, value) {
  const s = read();
  s[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable (private mode) — ignore */
  }
}
