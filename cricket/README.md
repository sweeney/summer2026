# Cricket Fielding Positions — interactive trainer

An interactive single-page app to learn the fielding positions in cricket, built
on top of the classic Wikipedia fielding-positions diagram.

This waypoint turns a **hand-drawn, un-scriptable SVG** into a **data-driven,
programmatically-addressable** model — and *proves* the conversion is faithful
by re-rendering the diagram from the extracted data and pixel-diffing it against
the original (currently **0.000% difference — bit-for-bit identical**).

## Why this was needed

The source (`Cricket_fielding_positions.svg`, Milind Joshi, 2005) was drawn for a
human to look at, not for code:

- IDs were meaningless auto-generated junk (`path2440`, `text2910`).
- The coloured **dots** (in layer `layer5`) and their **text labels** (in
  `layer3`) live in separate layers with **no link** between a dot and its name.
- One `"Short"` label was even stranded in the dots layer.

So you couldn't "show only mid-off" or "show a dot but hide its name" — the two
things the trainer needs.

## What we built

A small build pipeline (plain Python + a browser for rendering) that extracts
every fielding position into structured data, plus a self-contained app that
renders from that data with a clean programmatic API.

```
Cricket_fielding_positions.svg          the untouched original (source of truth)
│
├─ build.py      ─►  positions.json      68 positions: id, name, label, type,
│                    field-base.svg      dot geometry, label geometry (verbatim)
│                                        + the original artwork MINUS the dots
│                                          and fielding labels (pitch, boundary,
│                                          figures, legend kept)
│
├─ render.py     ─►  reproduction.svg        data → clean SVG (circles + labels)
│                    reproduction-proof.svg  data → verbatim SVG (bit-identical)
│
├─ compare.py    ─►  renders original vs reproduction in headless Chrome and
│                    pixel-diffs them  → the fidelity proof
│
└─ build_app.py  ─►  index.html          the self-contained trainer (field-base
                                          + JS overlay from positions.json)
```

### The data model — `positions.json`

68 positions, each keyed by a stable slug `id` (e.g. `mid-off`, `deep-point`):

| field | meaning |
|-------|---------|
| `id` | unique, URL-safe slug |
| `name` | canonical position name (for future quiz answer-matching) |
| `label` | the exact text the diagram shows |
| `type` | `primary` (red dot), `variation` (orange), or `mandatory` (WK/Bowler) |
| `dot` | `cx, cy, r, fill, stroke, strokeWidth, opacity` + `raw` (verbatim source markup) |
| `label_geom` | `x, y, anchor, fontSize, bold, tspans` + `raw` (null for unnamed dots) |

The `raw` fields hold the original element markup verbatim; that's what lets the
verbatim reproduction render **identically** to the original.

### The app — `index.html`

Self-contained (inlines `field-base.svg` + `positions.json`, works from
`file://`). Renders one `<circle>` per dot and one `<text>` per label from the
data, and exposes a programmatic API — the whole point of the exercise:

```js
API.only('mid-off')        // hide everything, show just this dot (label hidden)
API.hideLabel('deep-point')// show a dot but hide its name
API.show(id) / API.hide(id)
API.showLabel(id) / API.hideLabel(id)
API.showAll() / API.hideAll()
API.highlight(id)
```

Current UI (Explore mode only): **Primary positions only** and **Show labels**
toggles (when both on, only primary positions are labelled), Show all / Hide all,
and click-a-dot-to-name-it.

## How to rebuild / verify

```bash
python3 build.py                          # extract → positions.json + field-base.svg
python3 render.py clean    reproduction.svg
python3 render.py verbatim reproduction-proof.svg
python3 build_app.py                      # → index.html
SCRATCH=/tmp python3 compare.py reproduction-proof.svg   # the fidelity proof

open index.html                           # run the app
```

`compare.py` needs Google Chrome (used headless to rasterise SVG) and Pillow.

## Design decisions & known trade-offs

- **Fidelity is decoupled from naming.** Every dot and label is rendered at its
  *own* original coordinate, so the picture is provably identical regardless of
  how a dot is associated with a name. Association only matters for the app's
  interactivity, and a wrong name can never introduce a visual difference.
- **Colour-aware matching.** Bold region labels (Gully, Point, Cover…) bind to
  the region's **red primary dot** first; other labels fill in around them. This
  is why Gully is correctly a `primary`.
- **Names are best-effort.** The ~13 bold regions, multi-word labels, numbered
  slips and WK/Bowler are solid. Bare modifiers (a stray "Deep" → "Deep point")
  are composed by nearest region and may want manual polish in `positions.json`.
- **Slip cluster ambiguity.** The red slip dot is named "Slips"; "First slip"
  (the `1` label) sits on the adjacent dot. Genuine ambiguity in the source.
- **Right-handed batter only.** A left-hander view would mirror the same data.

## Next steps (not yet built)

- Quiz mode (show a dot, type the name) — the data already supports it.
- Hand-verify / polish the canonical `name` values.
- Left-handed mirror.
- Region grouping, difficulty tiers, streaks.
