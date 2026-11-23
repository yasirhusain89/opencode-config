import json
import math
from PIL import Image

poses = {p['file']: p for p in json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))}

def is_dash(pr, pg, pb):
    return pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80

def ring_hits(frame_file, cx, cy, r_ly, label):
    p = poses[frame_file]
    s = p['scale']
    im = Image.open(f"/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/{frame_file}").convert('RGB')
    pix = im.load()
    px, py = s * cx + p['tx'], -s * cy + p['ty']
    rp = r_ly * s
    c = tot = 0
    for k in range(360):
        a = math.radians(k)
        sx, sy = int(round(px + math.cos(a) * rp)), int(round(py + math.sin(a) * rp))
        if 40 <= sx < 2506 and 104 <= sy < 878:
            tot += 1
            pr, pg, pb = pix[sx, sy]
            if is_dash(pr, pg, pb):
                c += 1
    print(f"{label}: r={r_ly}ly in {frame_file}: {c}/{tot} dash hits ({c/max(tot,1)*100:.0f}%)")
    return c, tot

# L_3_6 zone ring r=70.2 around (131.6,-267.2) in frames covering the south
ring_hits('f_132_t22.00.png', 131.6, -267.2, 70.2, "L_3_6 zone ring")
ring_hits('f_129_t21.50.png', 131.6, -267.2, 70.2, "L_3_6 zone ring")
# Control: proven radial circle should score ~50%+
ring_hits('f_129_t21.50.png', 117.0, -245.0, 13.39, "Maladar radial (control)")
