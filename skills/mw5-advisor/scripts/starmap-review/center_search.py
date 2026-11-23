import json
import math
from PIL import Image

rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))
poses = {p['file']: p for p in json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))}
import sys
sys.path.insert(0, 'scripts')

def is_dash(pr, pg, pb):
    return pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80

def center_search(rname, frame_file, mx, my, f_fixed):
    r = next(x for x in rivals if x['name'] == rname)
    p = poses[frame_file]
    s = p['scale']
    im = Image.open(f"/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/{frame_file}").convert('RGB')
    pix = im.load()
    rp = r['Radius'] * f_fixed * s
    cands = []
    cx = mx - 8.0
    while cx <= mx + 8.0 + 1e-9:
        cy = my - 8.0
        while cy <= my + 8.0 + 1e-9:
            px = s * cx + p['tx']
            py = -s * cy + p['ty']
            c = 0
            tot = 0
            for k in range(180):
                a = math.radians(k * 2.0)
                sx = int(round(px + math.cos(a) * rp))
                sy = int(round(py + math.sin(a) * rp))
                if 40 <= sx < 2506 and 104 <= sy < 878:
                    tot += 1
                    pr, pg, pb = pix[sx, sy]
                    if is_dash(pr, pg, pb):
                        c += 1
            if tot > 100:
                cands.append((c, round(cx,1), round(cy,1)))
            cy += 1.0
        cx += 1.0
    cands.sort(reverse=True)
    print(f"{rname} fixed f={f_fixed} (mean=({mx},{my})): top 5 centers:")
    for c in cands[:5]:
        print(f"    hits={c[0]:3d} center=({c[1]:6.1f},{c[2]:7.1f}) offset=({c[1]-mx:+.1f},{c[2]-my:+.1f})")

# Maladar: mean (117,-245), f=12.3, best frame f_129
center_search('BorderLIAOBaseDavion3to6', 'f_129_t21.50.png', 117.0, -245.0, 12.3)
# Mandate: mean of {Mandate (89,-127), Highspire (101,-120)} = (95,-123.5), f=12.3
center_search('BorderLIAOBaseDavion11to12', 'f_140_t23.33.png', 95.0, -123.5, 12.3)
