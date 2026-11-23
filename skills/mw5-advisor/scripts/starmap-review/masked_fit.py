import json
import math
from PIL import Image

starmap = json.load(open('static/data/starmap.json'))
by_id = {s['id']: s for s in starmap['systems']}
rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))
poses = {p['file']: p for p in json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))}

def is_dash(pr, pg, pb):
    return pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80

def masked_fit(rname, frame_file, cx0, cx1, cy0, cy1, f0, f1, mask):
    """mask(wx, wy) -> True to include sample."""
    r = next(x for x in rivals if x['name'] == rname)
    p = poses[frame_file]
    s = p['scale']
    im = Image.open(f"/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/{frame_file}").convert('RGB')
    pix = im.load()
    cands = []
    cx = cx0
    while cx <= cx1 + 1e-9:
        cy = cy0
        while cy <= cy1 + 1e-9:
            px = s * cx + p['tx']
            py = -s * cy + p['ty']
            f = f0
            while f <= f1 + 1e-9:
                rp = r['Radius'] * f * s
                c = 0
                tot = 0
                for k in range(144):
                    a = math.radians(k * 2.5)
                    wx = cx + math.cos(a) * r['Radius'] * f
                    wy = cy + math.sin(a) * r['Radius'] * f
                    if not mask(wx, wy):
                        continue
                    sx = int(round(px + math.cos(a) * rp))
                    sy = int(round(py + math.sin(a) * rp))
                    if 40 <= sx < 2506 and 104 <= sy < 878:
                        tot += 1
                        pr, pg, pb = pix[sx, sy]
                        if is_dash(pr, pg, pb):
                            c += 1
                if tot > 25:
                    cands.append((c, tot, round(cx,1), round(cy,1), round(r['Radius']*f,2), round(f,2)))
                f += 0.25
            cy += 1.0
        cx += 1.0
    cands.sort(key=lambda t: (t[0], -abs(t[5]-12.3)), reverse=True)
    print(f"{rname} in {frame_file} (masked): top 6:")
    for c in cands[:6]:
        print(f"    hits={c[0]:3d}/{c[1]:3d} center=({c[2]:6.1f},{c[3]:7.1f}) r={c[4]:5.2f}ly factor={c[5]:.2f}")
    return cands[0] if cands else None

print("--- Ibstock circle, samples restricted to x > -24 (Abadan cant reach there) ---")
masked_fit('BorderLIAOBaseMarik13to14', 'f_164_t27.33.png', -24, -6, -108, -92, 9.0, 15.0, lambda wx, wy: wx > -24.0)
print("--- Abadan circle, samples restricted to x < -30 (Ibstock cant reach there) ---")
masked_fit('marik13to14', 'f_165_t27.50.png', -70, -35, -110, -70, 10.0, 17.0, lambda wx, wy: wx < -30.0)
