import json
from PIL import Image, ImageDraw

poses = {p['file']: p for p in json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))}
p = poses['f_132_t22.00.png']
s = p['scale']

im = Image.open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/f_132_t22.00.png').convert('RGB')

def to_screen(wx, wy):
    return s * wx + p['tx'], -s * wy + p['ty']

# L_3_6 zone ring: center (131.6,-267.2), r 70.2. SE corner of frame world x[150..205], y[-270..-235]
x0, y0 = to_screen(150, -235)
x1, y1 = to_screen(205, -270)
print(f"crop screen: ({x0:.0f},{y0:.0f})-({x1:.0f},{y1:.0f})")
crop = im.crop((int(x0), int(y0), int(x1), int(y1)))
crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST)
dr = ImageDraw.Draw(crop)
for (cx, cy, rl, color, label) in [
    (131.6, -267.2, 70.2, (255, 60, 60), "zoneL_3_6 r70"),
    (117.0, -245.0, 1.0891 * 12.3, (60, 220, 255), "radial r13.4"),
]:
    ix, iy = (cx - 150) * s * 2, (-235 - cy) * s * 2
    rr = rl * s * 2
    dr.ellipse([ix - rr, iy - rr, ix + rr, iy + rr], outline=color, width=3)
    dr.text((10, 10) if label.startswith("zone") else (10, 40), label, fill=color)
crop.save('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/check_zone_ring_SE.png')
print("saved check_zone_ring_SE.png", crop.size)
