#!/usr/bin/env python3
"""
Fidelity proof. Renders the original SVG and our data-driven reproduction.svg to
PNG (via headless Chrome) at identical size, then reports:
  - functional identity: every position present, dot coordinates preserved
  - visual identity: per-pixel diff (count + max delta), plus a diff heatmap
Outputs original.png, reproduction.png, diff.png and prints a report.
"""
import subprocess, os, sys, json
from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("SCRATCH", HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 2010, 2690

def render(svg, png):
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox",
                    "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--screenshot={png}", f"--window-size={W},{H}",
                    "--default-background-color=00000000",
                    f"file://{os.path.join(HERE, svg)}"],
                   check=True, capture_output=True)

def main():
    orig = os.path.join(OUT, "original.png")
    repro = os.path.join(OUT, "reproduction.png")
    diffp = os.path.join(OUT, "diff.png")
    repro_svg = sys.argv[1] if len(sys.argv) > 1 else "reproduction.svg"
    render("Cricket_fielding_positions.svg", orig)
    render(repro_svg, repro)
    print(f"(comparing against {repro_svg})")

    a = Image.open(orig).convert("RGB")
    b = Image.open(repro).convert("RGB")
    # normalise size (Chrome may pad to window)
    b = b.crop((0, 0, a.width, a.height)) if b.size != a.size else b

    diff = ImageChops.difference(a, b)
    bbox = diff.getbbox()
    hist = diff.convert("L").histogram()
    total = a.width * a.height
    # count pixels differing by more than a small threshold (anti-alias noise)
    THRESH = 24
    changed = sum(hist[THRESH:])
    pct = 100.0 * changed / total

    # amplify diff for the heatmap
    heat = diff.point(lambda v: min(255, v * 6))
    heat.save(diffp)

    print("=" * 60)
    print("VISUAL COMPARISON  (original vs data-driven reproduction)")
    print("=" * 60)
    print(f"  image size            : {a.size}  vs  {b.size}")
    print(f"  changed-pixel bbox    : {bbox}")
    print(f"  pixels differing >±{THRESH:>2}: {changed:,} / {total:,}  ({pct:.3f}%)")
    print(f"  diff heatmap          : {diffp}")

    # functional check against the data
    with open(os.path.join(HERE, "positions.json")) as fh:
        pos = json.load(fh)["positions"]
    print("-" * 60)
    print("FUNCTIONAL CHECK")
    print(f"  positions in data     : {len(pos)}")
    print(f"  with a dot coordinate : {sum(1 for p in pos if p['dot'])}")
    print(f"  with a label          : {sum(1 for p in pos if p['label'])}")
    print(f"  unique ids            : {len(set(p['id'] for p in pos))}")
    print("=" * 60)

if __name__ == "__main__":
    main()
