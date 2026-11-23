import json
from PIL import Image, ImageDraw

poses = {p['file']: p for p in json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))}
p = poses['f_165_t27.50.png']
s = p['scale']
print(f"f_165 scale={s:.4f} tx={p['tx']:.1f} ty={p['ty']:.1f}")

im = Image.open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/f_165_t27.50.png').convert('RGB')
W, H = im.size

def to_screen(wx, wy):
    return s * wx + p['tx'], -s * wy + p['ty']

# Abadan area world x [-95..-15], y [-120..-70]
x0, y0 = to_screen(-95, -70)
x1, y1 = to_screen(-15, -120)
print(f"crop screen: ({x0:.0f},{y0:.0f})-({x1:.0f},{y1:.0f})")
crop = im.crop((int(x0), int(y0), int(x1), int(y1)))
crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST)
dr = ImageDraw.Draw(crop)

def draw_circle(cx, cy, rl, color, label):
    ix, iy = (cx + 95) * s * 2, (-70 - cy) * s * 2
    rr = rl * s * 2
    dr.ellipse([ix - rr, iy - rr, ix + rr, iy + rr], outline=color, width=3)
    dr.ellipse([ix - 6, iy - 6, ix + 6, iy + 6], fill=color)
    dr.text((ix + rr + 8, iy - 12), label, fill=color)

# mean+12.3 prediction vs fine-fit winner
draw_circle(-52.33, -94.33, 1.8465 * 12.3, (255, 60, 60), "mean+12.3")
draw_circle(-36.0, -85.0, 27.70, (60, 220, 255), "fit(-36,-85)x15.0")
crop.save('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/zoom_abadan_frame.png')
print("saved zoom_abadan_frame.png", crop.size)
