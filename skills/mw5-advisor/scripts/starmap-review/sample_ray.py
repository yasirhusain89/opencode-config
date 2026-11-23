import json
from PIL import Image

starmap = json.load(open('static/data/starmap.json'))
by_id = {s['id']: s for s in starmap['systems']}
rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))
poses = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))

def center_of(r):
    xs = [by_id[s['Id']]['x'] for s in r['NearbyStarSystems']]
    ys = [by_id[s['Id']]['y'] for s in r['NearbyStarSystems']]
    return sum(xs)/len(xs), sum(ys)/len(ys)

# Target: BorderLIAOBaseDavion3to6 (Mentasta/Beid/Maladar), Radius 1.089
r = next(x for x in rivals if x['name'] == 'BorderLIAOBaseDavion3to6')
cx, cy = center_of(r)
print(f"World center: ({cx:.2f}, {cy:.2f}), asset Radius={r['Radius']}")

# Find best detail frame (scale>=13.5, rms<1.0) minimizing distance of center to frame center
best = None
for p in poses:
    if p['scale'] < 13.5 or p['rms'] > 1.0:
        continue
    px = p['scale'] * cx + p['tx']
    py = -p['scale'] * cy + p['ty']
    if not (100 < px < 2446 and 120 < py < 814):
        continue
    d = ((px - 1273.0)**2 + (py - 460.0)**2) ** 0.5
    if best is None or d < best[0]:
        best = (d, p, px, py)
d, p, px, py = best
print(f"Best frame: {p['file']} scale={p['scale']:.4f} rms={p['rms']:.2f} screen_center=({px:.1f},{py:.1f})")

im = Image.open(f"/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/{p['file']}").convert('RGB')
pix = im.load()

# Sample along horizontal ray east from center: print RGB every 10px + flag blue-ish
print("East ray samples (dist_px, RGB):")
for dist in range(0, 420, 5):
    sx = int(round(px + dist))
    sy = int(round(py))
    pr, pg, pb = pix[sx, sy]
    blue_score = pb - pr
    flag = " <== BLUE" if (pb > 120 and pb - pr > 50 and pb - pg > 20) else ""
    if dist % 10 == 0 or flag:
        print(f"  {dist:3d}px ({dist/p['scale']:.2f}ly): ({pr:3d},{pg:3d},{pb:3d}) B-R={blue_score:4d}{flag}")
