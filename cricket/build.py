#!/usr/bin/env python3
"""
Build pipeline: turn the hand-drawn Wikipedia cricket-fielding SVG into a
data-driven, programmatically-addressable form.

Outputs (in this directory):
  - positions.json   : one record per fielding position (id, name, dot geometry,
                       original label text + geometry, type)
  - field-base.svg   : the original artwork with the 67 fielding dots and their
                       text labels REMOVED (pitch, boundary, figures, legend kept)

The key property we preserve for the fidelity proof: every dot and every label
keeps its EXACT original coordinate, so a render of (field-base + dots + labels)
is pixel-identical to the original. Association of a label to a dot is a separate
semantic layer used only for the quiz; it never moves anything.
"""
import xml.etree.ElementTree as ET
import re, json, math, copy

SRC = "Cricket_fielding_positions.svg"
SVG = "http://www.w3.org/2000/svg"
ns = "{%s}" % SVG
ET.register_namespace("", SVG)
for p, u in (("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
             ("cc", "http://creativecommons.org/ns#"),
             ("dc", "http://purl.org/dc/elements/1.1/")):
    ET.register_namespace(p, u)

tree = ET.parse(SRC)
root = tree.getroot()

def parse_tf(s):
    a, b, c, d, e, f = 1, 0, 0, 1, 0, 0
    if not s:
        return (a, b, c, d, e, f)
    for name, args in re.findall(r'(\w+)\s*\(([^)]*)\)', s):
        v = [float(x) for x in re.split(r'[ ,]+', args.strip()) if x]
        if name == 'matrix':
            a, b, c, d, e, f = v
        elif name == 'translate':
            e += v[0]; f += (v[1] if len(v) > 1 else 0)
        elif name == 'scale':
            a *= v[0]; d *= (v[1] if len(v) > 1 else v[0])
    return (a, b, c, d, e, f)

def apply_tf(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)

def style_get(style, key):
    m = re.search(re.escape(key) + r'\s*:\s*([^;]+)', style or "")
    return m.group(1).strip() if m else None

def layer(gid):
    for g in root.iter(ns + "g"):
        if g.get("id") == gid:
            return g

DOT_D = "M 432 658 A 50 54"
# Local ellipse center of that path, and its local radii.
LOCAL_CX, LOCAL_CY, LOCAL_RX, LOCAL_RY = 382.0, 658.0, 50.0, 54.0

# ---- 1. dots ------------------------------------------------------------
l5 = layer("layer5")
dots = []
for p in list(l5):
    if p.tag == ns + "path" and (p.get("d", "").startswith(DOT_D)):
        m = parse_tf(p.get("transform"))
        cx, cy = apply_tf(m, LOCAL_CX, LOCAL_CY)
        scale = math.hypot(m[0], m[1])           # uniform-ish scale factor
        r = LOCAL_RX * scale                      # displayed radius (~14.3px)
        st = p.get("style", "")
        fill = style_get(st, "fill")
        stroke = style_get(st, "stroke")
        sw = style_get(st, "stroke-width")
        opacity = style_get(st, "opacity")
        raw = ET.tostring(p, encoding="unicode").replace(ns, "").replace(' xmlns="%s"' % SVG, "")
        dots.append({
            "raw": raw,
            "el": p,
            "cx": round(cx, 2), "cy": round(cy, 2), "r": round(r, 2),
            "fill": fill,
            "stroke": None if stroke in (None, "none") else stroke,
            "strokeWidth": round(float(sw) * scale, 2) if (sw and stroke not in (None, "none")) else 0,
            "opacity": float(opacity) if opacity else 1.0,
            "srcId": p.get("id"),
        })

# type by fill colour (matches the legend)
TYPE = {"#b00000": "mandatory", "#ff0000": "primary", "#f8a20c": "variation"}
for d in dots:
    d["type"] = TYPE.get((d["fill"] or "").lower(), "variation")

# Design edits: elements from the original artwork we deliberately drop from the
# field background (we've let go of 1:1 fidelity to the source). Keyed by the
# source element id. compare.py strips the same ids from the original before the
# fidelity diff, so the extraction proof stays meaningful.
DESIGN_REMOVE = {
    "30 yards",   # the dashed 30-yard circle
    "Batter (R)", "text2453", "text2012", "text2016",  # the Runner "(R*)"
}

# ---- 2. text labels -----------------------------------------------------
STRUCT = {"Cricket: Fielding positions for a right-handed batter", "Off side",
          "On (Leg) side", "R", "S", "NS", "U", "Sq L U", "(", ")"}
# Fielding labels live mostly in layer3, but the source has one stray "Short"
# text parked in layer5. Gather text from every layer EXCEPT layer6 (which holds
# the legend/glossary/figures), so nothing is missed.
parent = {c: p for p in root.iter() for c in p}
def layer_of(el):
    p = parent.get(el)
    while p is not None:
        if p.tag == ns + "g" and (p.get("id") or "").startswith("layer"):
            return p.get("id")
        p = parent.get(p)
    return None

labels = []
for tx in root.iter(ns + "text"):
    if layer_of(tx) == "layer6":
        continue
    parts = [(sp.text or "").strip() for sp in tx.iter(ns + "tspan")]
    text = " ".join(p for p in parts if p)
    x = float(tx.get("x")); y = float(tx.get("y"))
    st = tx.get("style", "")
    # capture every tspan verbatim (text + its own x/y/size) so multi-line
    # labels reproduce with identical geometry
    tspans = []
    fs = None
    for sp in tx.iter(ns + "tspan"):
        sst = sp.get("style", "")
        m = re.search(r'font-size:(\d+)', sst)
        sfs = int(m.group(1)) if m else fs
        if m:
            fs = sfs
        fam = style_get(sst, "font-family")
        tspans.append({
            "text": sp.text or "",
            "x": round(float(sp.get("x")), 2) if sp.get("x") else round(x, 2),
            "y": round(float(sp.get("y")), 2) if sp.get("y") else round(y, 2),
            "fontSize": sfs,
            "fontFamily": fam,
        })
    # verbatim serialization of the original <text> element (namespace stripped)
    raw = ET.tostring(tx, encoding="unicode")
    raw = raw.replace(ns, "").replace(' xmlns="%s"' % SVG, "")
    labels.append({
        "el": tx, "x": round(x, 2), "y": round(y, 2), "text": text,
        "bold": "bold" in st,
        "anchor": "middle" if "text-anchor:middle" in st else "start",
        "fontSize": fs,
        "tspans": tspans,
        "raw": raw,
        "structural": text in STRUCT,
        "srcId": tx.get("id"),
    })

fielding_labels = [l for l in labels if not l["structural"]]

# ---- 3. associate each fielding label with a dot (colour-aware) ---------
# A bold region label (Gully, Point, Cover, ...) names the region's *primary*
# fielder, which the diagram draws as a RED dot. So bold labels must bind to red
# dots, not merely the nearest dot. Order of assignment:
#   1. bold labels  -> nearest red/primary dot  (exclusive among bold labels)
#   2. other labels -> nearest dot, greedy, exclusive among themselves but
#      allowed to share a dot already claimed by a bold label (e.g. "1"/first
#      slip sharing the red slip dot that "Slips" also points at)
#   3. any leftover label -> nearest dot (share)
def dist(ax, ay, bx, by):
    return math.hypot(ax - bx, ay - by)

red_dots = [di for di, d in enumerate(dots) if d["type"] == "primary"]
dot_of_label = {}       # li -> di   (every label gets a dot)
claimed_nonbold = set()  # dots consumed by a non-bold label

def assign(cands, dot_pool, blocked):
    pairs = sorted((dist(fielding_labels[li]["x"], fielding_labels[li]["y"],
                         dots[di]["cx"], dots[di]["cy"]), li, di)
                   for li in cands for di in dot_pool)
    taken = set()
    for _, li, di in pairs:
        if li in dot_of_label or di in taken or di in blocked:
            continue
        dot_of_label[li] = di
        taken.add(di)
    return taken

bold = [li for li, l in enumerate(fielding_labels) if l["bold"]]
nonbold = [li for li, l in enumerate(fielding_labels) if not l["bold"]]
assign(bold, red_dots, blocked=set())                 # 1. bold -> red dots
bold_dots = {dot_of_label[li] for li in bold if li in dot_of_label}
assign(nonbold, range(len(dots)), blocked=bold_dots)  # 2. others (not on region primaries)
for li in nonbold:                                     # 3. leftovers share
    if li not in dot_of_label:
        dot_of_label[li] = min(range(len(dots)),
            key=lambda d: dist(fielding_labels[li]["x"], fielding_labels[li]["y"],
                               dots[d]["cx"], dots[d]["cy"]))

# ---- 4. canonical names -------------------------------------------------
bold_regions = [l for l in fielding_labels if l["bold"]]
def nearest_region_base(x, y):
    r = min(bold_regions, key=lambda b: dist(x, y, b["x"], b["y"]))
    return r["text"]

BARE = {"Deep", "Short", "Backward", "Forward", "Square", "Straight", "Wide", "Fine"}
ORD = {"1": "First", "2": "Second", "3": "Third", "4": "Fourth", "5": "Fifth",
       "6": "Sixth", "7": "Seventh", "8": "Eighth", "9": "Ninth"}

def canonical(l):
    t = l["text"]
    if t in ORD:
        return f"{ORD[t]} slip"
    if t == "Slips":
        return "Slips"
    if t in BARE:
        base = nearest_region_base(l["x"], l["y"])
        return f"{t} {base[0].lower() + base[1:]}"
    return t

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

# one position per fielding label (label-centric: guarantees every source label
# becomes addressable, even the extra one sharing a dot)
positions = []
seen_ids = {}
for li, lbl in enumerate(fielding_labels):
    di = dot_of_label[li]
    d = dots[di]
    name = canonical(lbl)
    base = slug(name)
    sid = base
    n = seen_ids.get(base, 0)
    if n:
        sid = f"{base}-{n+1}"
    seen_ids[base] = n + 1
    positions.append({
        "id": sid,
        "name": name,
        "label": lbl["text"],
        "type": d["type"],
        "dot": {"cx": d["cx"], "cy": d["cy"], "r": d["r"], "fill": d["fill"],
                "stroke": d["stroke"], "strokeWidth": d["strokeWidth"],
                "opacity": d["opacity"], "raw": d["raw"]},
        "label_geom": {
            "x": lbl["x"], "y": lbl["y"], "anchor": lbl["anchor"],
            "fontSize": lbl["fontSize"],
            # primary-position labels render bold; the source leaves "Long stop"
            # and "Straight hit" un-bolded, so normalise them to match the rest
            "bold": lbl["bold"] or d["type"] == "primary",
            "tspans": lbl["tspans"], "raw": lbl["raw"]},
    })

# any dot no label points at (e.g. an unnamed variation a bold label vacated)
# still renders + stays addressable, so the diagram remains complete
labelled_dots = set(dot_of_label.values())
for di, d in enumerate(dots):
    if di in labelled_dots:
        continue
    sid = f"unnamed-{di}"
    positions.append({
        "id": sid, "name": None, "label": None, "type": d["type"],
        "dot": {"cx": d["cx"], "cy": d["cy"], "r": d["r"], "fill": d["fill"],
                "stroke": d["stroke"], "strokeWidth": d["strokeWidth"],
                "opacity": d["opacity"], "raw": d["raw"]},
        "label_geom": None,
    })

with open("positions.json", "w") as fh:
    json.dump({"viewBox": [0, 0, 2010, 2690],
               "designRemoved": sorted(DESIGN_REMOVE),
               "positions": positions}, fh, indent=2)

# ---- 5. field-base.svg : remove dots + fielding labels ------------------
base_tree = ET.parse(SRC)
base_root = base_tree.getroot()
def find(gid, rt):
    for g in rt.iter(ns + "g"):
        if g.get("id") == gid:
            return g
# remove all dot paths from layer5
b5 = find("layer5", base_root)
for p in list(b5):
    if p.tag == ns + "path" and p.get("d", "").startswith(DOT_D):
        b5.remove(p)
# remove every fielding-label text node, wherever it lives (layer3 + the stray
# in layer5), leaving structural + legend text intact
b_parent = {c: p for p in base_root.iter() for c in p}
fielding_texts = {l["srcId"] for l in fielding_labels}
for tx in list(base_root.iter(ns + "text")):
    if tx.get("id") in fielding_texts:
        b_parent[tx].remove(tx)
# design edits: drop the elements we've chosen to remove from the artwork
for el in list(base_root.iter()):
    if el.get("id") in DESIGN_REMOVE:
        b_parent[el].remove(el)
base_tree.write("field-base.svg", xml_declaration=True, encoding="UTF-8")

print(f"dots={len(dots)} fielding_labels={len(fielding_labels)} positions={len(positions)}")
reused = len(dot_of_label) - len(set(dot_of_label.values()))
print(f"dots reused by >1 label: {reused}")
print("wrote positions.json, field-base.svg")
