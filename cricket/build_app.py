#!/usr/bin/env python3
"""
Generate a self-contained index.html: the field background (field-base.svg) with
a data-driven dot/label overlay rendered from positions.json, plus a small demo
UI proving programmatic show/hide-by-id and label toggling.
Everything is inlined so it works from file:// with no server.
"""
import json, re

with open("positions.json") as fh:
    data = json.load(fh)
with open("field-base.svg") as fh:
    base = fh.read()

# make the base svg responsive: strip xml decl / comments, add a viewBox,
# drop the fixed pixel width/height, give it an id.
base = re.sub(r'<\?xml[^>]*\?>', '', base)
base = re.sub(r'<!--.*?-->', '', base, flags=re.S)
base = re.sub(r'(<svg\b)', r'\1 id="field" viewBox="0 0 2010 2690" '
                           r'preserveAspectRatio="xMidYMid meet"', base, count=1)
base = re.sub(r'\swidth="2010"', '', base, count=1)
base = re.sub(r'\sheight="2690"', '', base, count=1)
# insert two empty overlay groups just before </svg>; JS fills them
base = re.sub(r'</svg>\s*$',
              '  <g id="fielding-dots"></g>\n  <g id="fielding-labels"></g>\n</svg>',
              base)

POS = json.dumps(data["positions"], separators=(",", ":"))

HTML = """<title>Cricket Fielding Positions — Trainer</title>
<style>
  :root{ --bg:#f4f6f4; --fg:#14231a; --panel:#fff; --line:#dfe5df;
         --accent:#0ba70e; --accent2:#c81d1d; --good:#158a3a; --bad:#c81d1d; }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#0f1512; --fg:#e7efe8; --panel:#182420; --line:#2a3a32; }}
  *{ box-sizing:border-box }
  body{ margin:0; font:15px/1.45 system-ui,sans-serif; color:var(--fg);
        background:var(--bg); display:flex; min-height:100vh; }
  #stage{ flex:1; display:flex; align-items:center; justify-content:center;
          padding:16px; min-width:0; }
  #field{ width:100%; height:auto; max-height:96vh;
          filter:drop-shadow(0 4px 18px rgba(0,0,0,.18)); }
  aside{ width:320px; flex:none; background:var(--panel);
         border-left:1px solid var(--line); padding:20px; overflow-y:auto;
         max-height:100vh; }
  h1{ font-size:18px; margin:0 0 4px }
  p.sub{ margin:0 0 16px; color:#7d8a82; font-size:13px }
  .card{ border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:14px }
  .row{ display:flex; gap:8px; margin-top:10px }
  .row button{ flex:1; padding:9px; border-radius:8px; border:0; cursor:pointer;
    font:inherit; font-weight:600; background:var(--accent); color:#fff }
  .row button.ghost{ background:transparent; border:1px solid var(--line); color:inherit; font-weight:500 }
  label.chk{ display:flex; align-items:center; gap:8px; font-size:14px; margin:6px 0; cursor:pointer }
  .fp-dot{ cursor:pointer; transition:transform .08s }
  .fp-dot.hit{ stroke:#111; stroke-width:3 }
  .fp-dot.dim{ opacity:.18 }
  .fp-label{ pointer-events:none; user-select:none }
  .fp-label.hidden{ display:none }
</style>

<div id="stage">__BASE__</div>

<aside>
  <h1>🏏 Fielding Positions</h1>
  <p class="sub">Data-driven from the extracted SVG. Every dot is addressable by id.</p>

  <section id="explorePanel">
    <div class="card">
      <label class="chk"><input type="checkbox" id="onlyPrimary"> Primary positions only</label>
      <label class="chk"><input type="checkbox" id="showLabels" checked> Show labels</label>
      <div class="row">
        <button class="ghost" onclick="API.showAll()">Show all</button>
        <button class="ghost" onclick="API.hideAll()">Hide all</button>
      </div>
    </div>
    <p class="sub">Click any dot to name it. Try the console too:<br>
      <code>API.only('mid-off')</code>, <code>API.hideLabel('deep-point')</code></p>
  </section>
</aside>

<script>
const POSITIONS = __POS__;
const svg = document.getElementById('field');
const gDots = document.getElementById('fielding-dots');
const gLabels = document.getElementById('fielding-labels');
const NS = 'http://www.w3.org/2000/svg';
const byId = {};
const seenDots = {};

// ---- render dots + labels from data --------------------------------------
for(const p of POSITIONS){
  const d = p.dot;
  // a dot can be shared by >1 label (source duplicate): draw it once, but let
  // every position reference it so all remain independently addressable
  const dkey = d.cx+','+d.cy+','+d.fill;
  let c = seenDots[dkey];
  if(!c){
    c = document.createElementNS(NS,'circle');
    c.setAttribute('id','dot-'+p.id);
    c.setAttribute('class','fp-dot fp-'+p.type);
    c.setAttribute('cx',d.cx); c.setAttribute('cy',d.cy); c.setAttribute('r',d.r);
    c.setAttribute('fill',d.fill);
    if(d.stroke){ c.setAttribute('stroke',d.stroke); c.setAttribute('stroke-width',d.strokeWidth); }
    if(d.opacity!==1) c.setAttribute('opacity',d.opacity);
    c.dataset.id=p.id; c.dataset.name=p.name; c.dataset.type=p.type;
    c.addEventListener('click',()=>onDotClick(p.id));
    gDots.appendChild(c);
    seenDots[dkey]=c;
  }

  const lg=p.label_geom;
  let t=null;
  if(lg){
    t=document.createElementNS(NS,'text');
    t.setAttribute('id','label-'+p.id);
    t.setAttribute('class','fp-label');
    t.setAttribute('text-anchor',lg.anchor);
    t.setAttribute('font-family','sans-serif');
    t.setAttribute('font-weight',lg.bold?'bold':'normal');
    t.setAttribute('fill','#000');
    for(const s of lg.tspans){
      const sp=document.createElementNS(NS,'tspan');
      sp.setAttribute('x',s.x); sp.setAttribute('y',s.y);
      sp.setAttribute('font-size',s.fontSize||lg.fontSize||44);
      sp.textContent=s.text;
      t.appendChild(sp);
    }
    gLabels.appendChild(t);
  }
  byId[p.id]={data:p, dot:c, label:t};
}

// ---- programmatic API (the whole point) ----------------------------------
const API = {
  show(id){ byId[id].dot.style.display=''; },
  hide(id){ byId[id].dot.style.display='none'; },
  showLabel(id){ const l=byId[id].label; if(l) l.classList.remove('hidden'); },
  hideLabel(id){ const l=byId[id].label; if(l) l.classList.add('hidden'); },
  showAll(){ for(const id in byId){ this.show(id); this.showLabel(id);} },
  hideAll(){ for(const id in byId){ this.hide(id);} },
  only(id){ for(const k in byId){ this.hide(k);} this.show(id); this.hideLabel(id); },
  highlight(id){ for(const k in byId) byId[k].dot.classList.toggle('hit',k===id); },
  get(id){ return byId[id].data; },
  ids(){ return Object.keys(byId); },
};
window.API = API;

// ---- explore interactions ------------------------------------------------
function onDotClick(id){ API.highlight(id); API.showLabel(id); }

const cbLabels  = document.getElementById('showLabels');
const cbPrimary = document.getElementById('onlyPrimary');

function applyView(){
  const labels  = cbLabels.checked;
  const primaryOnly = cbPrimary.checked;
  for(const id in byId){
    const isPrimary = byId[id].data.type!=='variation';
    // dim variation dots when "primary only" is on
    byId[id].dot.classList.toggle('dim', primaryOnly && !isPrimary);
    // show a label only if labels are on AND (all positions, or this is primary)
    const showThisLabel = labels && (!primaryOnly || isPrimary);
    if(byId[id].label) byId[id].label.classList.toggle('hidden', !showThisLabel);
  }
}
cbLabels.onchange = applyView;
cbPrimary.onchange = applyView;
applyView();
</script>
"""

html = HTML.replace("__BASE__", base).replace("__POS__", POS)
with open("index.html", "w") as fh:
    fh.write(html)
print(f"wrote index.html ({len(data['positions'])} positions, {len(html)//1024} KB)")
