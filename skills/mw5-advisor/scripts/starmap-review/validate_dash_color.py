import json
import math
from PIL import Image

starmap = json.load(open('static/data/starmap.json'))
by_id = {s['id']: s for s in starmap['systems']}
rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))
poses = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))
detail = [p for p in poses if p['scale'] >= 13.5 and p['rms'] < 1.0]

def center_of(r, mode='mean'):
    pts = [(by_id[s['Id']]['x'], by_id[s['Id']]['y'], s['Weight']) for s in r['NearbyStarSystems']]
    if mode == 'mean' or all(w == 0.0 for _, _, w in pts):
        return sum(x for x, _, _ in pts)/len(pts), sum(y for _, y, _ in pts)/len(pts)
    tot = sum(1.0 + w for _, _, w in pts)
    return sum(x*(1.0+w) for x, _, w in pts)/tot, sum(y*(1.0+w) for _, y, w in pts)/tot

def is_dash(pr, pg, pb):
    # Bright saturated dash blue: B high, R low, G moderate-low
    return pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80

# Sample dash colors from 3 known-good circles to validate the test
for rname in ['BorderLIAOBaseDavion3to6', 'Kurita7to9', 'Steiner5to8']:
    r = next(x for x in rivals if x['name'] == rname)
    cx, cy = center_of(r)
    best = None
    for p in detail:
        px = p['scale'] * cx + p['tx']
        py = -p['scale'] * cy + p['ty']
        if not (200 < px < 2346 and 180 < py < 754):
            continue
        d = ((px-1273.0)**2 + (py-460.0)**2) ** 0.5
        if best is None or d < best[0]:
            best = (d, p, px, py)
    d, p, px, py = best
    im = Image.open(f"/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/{p['file']}").convert('RGB')
    pix = im.load()
    # scan east ray, collect pixels passing strict test
    hits = []
    for dist in range(60, 481):
        sx = int(round(px + dist))
        sy = int(round(py))
        pr, pg, pb = pix[sx, sy]
        if is_dash(pr, pg, pb):
            hits.append((dist, round(dist/p['scale'], 2), (pr, pg, pb)))
    print(f"{rname}: center=({cx:.1f},{cy:.1f}) frame={p['file']} strict-dash hits on east ray: {hits[:6]}")
