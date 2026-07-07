#!/usr/bin/env python3
"""
Reconstruct an SVG from the DATA ONLY (positions.json) laid over field-base.svg.
If build.py captured everything faithfully, this reproduction renders identically
to the original. Used by the comparison/proof step.

Emits reproduction.svg with two extra groups on top of the base artwork:
  <g id="fielding-dots">   one <circle> per position, id="dot-<id>"
  <g id="fielding-labels"> one <text>   per position, id="label-<id>"
Every element carries data-id / data-name / data-type so JS can address it.
"""
import json, re, sys

SVG = "http://www.w3.org/2000/svg"
# "verbatim": re-emit the original dot/label markup exactly (fidelity proof).
# "clean":    render dots as <circle> + labels from structured tspans (the app).
MODE = sys.argv[1] if len(sys.argv) > 1 else "clean"
OUTFILE = sys.argv[2] if len(sys.argv) > 2 else "reproduction.svg"

def inject_attrs(raw, attrs):
    """insert extra attributes right after the opening tag name, first stripping
    any existing occurrence of the attributes we're setting (avoids dup id=)"""
    m = re.match(r'(\s*<\w+)(.*?)(/?>)', raw, flags=re.S)
    head, body, close = m.group(1), m.group(2), m.group(3)
    for k in attrs:
        body = re.sub(r'\s+' + re.escape(k) + r'\s*=\s*"[^"]*"', '', body, count=1)
    attr_str = " " + " ".join(f'{k}="{v}"' for k, v in attrs.items())
    return head + attr_str + body + close + raw[m.end():]

with open("positions.json") as fh:
    data = json.load(fh)
with open("field-base.svg") as fh:
    base = fh.read()

def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))

dot_els, label_els = [], []
seen_dots = set()
for p in data["positions"]:
    d = p["dot"]
    # a dot may be shared by >1 label (source duplicate) — draw it once only,
    # otherwise semi-transparent dots double up and render darker
    key = (d["cx"], d["cy"], d["fill"])
    if key in seen_dots:
        d = None
    else:
        seen_dots.add(key)
    attrs = {"id": f"dot-{esc(p['id'])}", "class": f"fp-dot fp-{p['type']}",
             "data-id": esc(p["id"]), "data-name": esc(p["name"] or ""),
             "data-type": p["type"]}
    if d is None:
        pass
    elif MODE == "verbatim":
        dot_els.append(inject_attrs(d["raw"], attrs))
    else:
        stroke = f' stroke="{d["stroke"]}" stroke-width="{d["strokeWidth"]}"' if d["stroke"] else ""
        op = f' opacity="{d["opacity"]}"' if d["opacity"] != 1 else ""
        dot_els.append(
            f'<circle {" ".join(f2 + chr(61) + chr(34) + str(v) + chr(34) for f2, v in attrs.items())} '
            f'cx="{d["cx"]}" cy="{d["cy"]}" r="{d["r"]}" fill="{d["fill"]}"{stroke}{op}/>')
    lg = p.get("label_geom")
    if lg and p["label"] and MODE == "verbatim":
        label_els.append(inject_attrs(lg["raw"], {
            "id": f"label-{esc(p['id'])}", "class": "fp-label",
            "data-id": esc(p["id"]), "data-name": esc(p["name"])}))
    elif lg and p["label"]:
        weight = "bold" if lg["bold"] else "normal"
        anchor = lg["anchor"]
        fs = lg["fontSize"] or 44
        # reproduce each original tspan at its own x/y so multi-line labels
        # keep identical geometry
        spans = "".join(
            f'<tspan x="{t["x"]}" y="{t["y"]}" font-size="{t["fontSize"] or fs}"'
            f'{(" font-family=" + chr(34) + t["fontFamily"] + chr(34)) if t.get("fontFamily") else ""}'
            f'>{esc(t["text"])}</tspan>'
            for t in lg["tspans"])
        label_els.append(
            f'<text id="label-{esc(p["id"])}" class="fp-label" '
            f'data-id="{esc(p["id"])}" data-name="{esc(p["name"])}" '
            f'x="{lg["x"]}" y="{lg["y"]}" font-weight="{weight}" '
            f'font-family="sans-serif" text-anchor="{anchor}" '
            f'fill="#000">{spans}</text>')

overlay = (
    '  <g id="fielding-dots">\n    ' + "\n    ".join(dot_els) + "\n  </g>\n"
    '  <g id="fielding-labels">\n    ' + "\n    ".join(label_els) + "\n  </g>\n"
)

# inject the overlay just before the closing </svg>
out = re.sub(r'</svg>\s*$', overlay + "</svg>\n", base)
with open(OUTFILE, "w") as fh:
    fh.write(out)
print(f"wrote {OUTFILE} [{MODE}] ({len(data['positions'])} dots, "
      f"{len(label_els)} labels)")
