#!/usr/bin/env node
// Bumps the ?v= cache-busting stamp on every module the app loads.
//
// GitHub Pages serves index.html with a short max-age, so a release can sit
// behind a browser's cached copy of the old entry point — new tabs and modes
// simply don't appear. Versioning the module URLs means that once index.html
// does refresh, every module behind it is fetched anew.
//
// It has to be the whole import tree, not just the entry: a fresh app.js
// paired with a stale cached map.js is worse than a wholly stale app, because
// the two no longer agree on what map.js exports.
//
// Run after changing anything under js/:  npm run bump  (in this directory)
//
// data/countries.json is deliberately left alone — it's 2.7 MB and changes
// only when the data pipeline is re-run, so it rides on ETag revalidation
// rather than forcing a full re-download on every code release.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = resolve(ROOT, "index.html");
const JS_DIR = resolve(ROOT, "js");

// <script type="module" src="js/app.js?v=3">
const ENTRY = /(src=")(js\/app\.js)(?:\?v=\d+)?(")/g;
// import … from "./map.js?v=3"
const IMPORT = /(from\s+")(\.\/[\w-]+\.js)(?:\?v=\d+)?(")/g;

const current = Number(readFileSync(INDEX, "utf8").match(/js\/app\.js\?v=(\d+)/)?.[1] || 0);
const next = Number(process.argv[2] || current + 1);
if (!Number.isInteger(next) || next < 1) {
  console.error(`Version must be a positive integer, got "${process.argv[2]}"`);
  process.exit(1);
}

const stamp = (file, pattern) => {
  const before = readFileSync(file, "utf8");
  const after = before.replace(pattern, `$1$2?v=${next}$3`);
  if (after !== before) writeFileSync(file, after);
  return (after.match(/\?v=\d+/g) || []).length;
};

let total = stamp(INDEX, ENTRY);
for (const name of readdirSync(JS_DIR).filter((n) => n.endsWith(".js")).sort()) {
  total += stamp(resolve(JS_DIR, name), IMPORT);
}
console.log(`v${current || "(none)"} → v${next}: stamped ${total} module URLs.`);
