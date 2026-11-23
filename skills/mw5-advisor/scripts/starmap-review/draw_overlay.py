import json
from PIL import Image, ImageDraw

starmap = json.load(open('static/data/starmap.json'))
by_id = {s['id']: s for s in starmap['systems']}
rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))

FACTOR = 12.3
wxMin, wyMax, outScale = -135.0, -20.0, 14.64

def world_to_img(wx, wy):
    return (wx - wxMin) * outScale, (wyMax - wy) * outScale

def center_of(r, mode='mean'):
    pts = [(by_id[s['Id']]['x'], by_id[s['Id']]['y'], s['Weight']) for s in r['NearbyStarSystems']]
    if mode == 'mean' or all(w == 0.0 for _, _, w in pts):
        return sum(x for x, _, _ in pts)/len(pts), sum(y for _, y, _ in pts)/len(pts)
    tot = sum(1.0 + w for _, _, w in pts)
    return sum(x*(1.0+w) for x, _, w in pts)/tot, sum(y*(1.0+w) for _, y, w in pts)/tot

base = Image.open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_zoomed_south_14px.png').convert('RGB')
ov = base.copy()
dr = ImageDraw.Draw(ov)

for r in rivals:
    if r['active_3026_10_20'] == 'No owner':
        continue
    for mode, color in (('mean', (255, 60, 60)), ('weighted', (60, 200, 255))):
        cx, cy = center_of(r, mode)
        if not (wxMin < cx < 215.0 and -285.0 < cy < wyMax):
            continue
        ix, iy = world_to_img(cx, cy)
        rl = r['Radius'] * FACTOR * outScale
        if rl < 8:
            continue
        dr.ellipse([ix - rl, iy - rl, ix + rl, iy + rl], outline=color, width=4)
        dr.ellipse([ix - 4, iy - 4, ix + 4, iy + 4], fill=color)
        dr.text((ix + rl + 6, iy - 10), f"{r['name'].split('Base')[-1][:14]}:{mode[0]}", fill=color)

ov.save('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/overlay_rival_12p3_south.png')
print("saved overlay_rival_12p3_south.png")

# Crop 2: Ibstock/Abadan area to inspect the marik13to14 vs BorderLIAOBaseMarik13to14 confusion
# marik13to14 mean center (-55.88,-94.84), BorderLIAOBaseMarik13to14 weighted (-6.85,-100.45)
for label, wcx, wcy, half in [('ibstock_abadan', -30, -97, 55)]:
    x0, y0 = world_to_img(wcx - half, wcy + half)
    x1, y1 = world_to_img(wcx + half, wcy - half)
    crop = ov.crop((int(x0), int(y0), int(x1), int(y1)))
    crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
    crop.save(f'/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/overlay_crop_{label}.png')
    print(f"saved crop {label}")
