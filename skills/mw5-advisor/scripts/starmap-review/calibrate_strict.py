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
    return pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80

results = []
for r in rivals:
    if r['active_3026_10_20'] == 'No owner':
        continue
    # try mean and weighted centers, top-3 frames each; keep overall best (most hits, tie -> closest)
    best_overall = None
    for mode in ('mean', 'weighted'):
        cx, cy = center_of(r, mode)
        cands = []
        for p in detail:
            px = p['scale'] * cx + p['tx']
            py = -p['scale'] * cy + p['ty']
            if not (250 < px < 2296 and 230 < py < 704):
                continue
            d = ((px-1273.0)**2 + (py-460.0)**2) ** 0.5
            cands.append((d, p, px, py))
        cands.sort(key=lambda t: t[0])
        for d, p, px, py in cands[:3]:
            im = Image.open(f"/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/{p['file']}").convert('RGB')
            pix = im.load()
            best_r, best_c = 0, -1
            for rp in range(60, 481, 2):
                c = 0
                for k in range(180):
                    a = math.radians(k * 2.0)
                    sx = int(round(px + math.cos(a) * rp))
                    sy = int(round(py + math.sin(a) * rp))
                    if 40 <= sx < 2506 and 104 <= sy < 878:
                        pr, pg, pb = pix[sx, sy]
                        if is_dash(pr, pg, pb):
                            c += 1
                if c > best_c:
                    best_c = c
                    best_r = rp
            score = (best_c, -d)
            if best_overall is None or score > best_overall[0]:
                best_overall = (score, (r['name'], mode, p['file'], cx, cy, best_r, round(best_r/p['scale'], 2), r['Radius'], round((best_r/p['scale'])/r['Radius'], 3) if r['Radius'] else 0, best_c, d))
    if best_overall is not None:
        results.append(best_overall[1])
    else:
        print(f"SKIP {r['name']}: no detail frame covers center")

results.sort(key=lambda t: t[0])
print(f"{'asset':34s} {'mode':8s} {'frame':16s} {'r_px':5s} {'r_ly':6s} {'assetR':7s} {'ratio':7s} hits")
for name, mode, fn, cx, cy, rp, rly, ar, ratio, bc, d in results:
    print(f"{name:34s} {mode:8s} {fn:16s} {rp:5d} {rly:6.2f} {ar:7.3f} {ratio:7.3f} {bc:3d}")
good = [(n, ra) for n, _, _, _, _, _, _, _, ra, bc, _ in results if bc >= 15]
ratios = sorted(ra for _, ra in good)
print(f"\n{len(good)}/{len(results)} circles with >=15 dash hits")
print("ratios:", [round(x, 2) for x in ratios])
if ratios:
    import statistics
    print(f"median={statistics.median(ratios):.3f} mean={statistics.mean(ratios):.3f} stdev={statistics.pstdev(ratios):.3f}")
