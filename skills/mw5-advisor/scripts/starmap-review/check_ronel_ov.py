import json
from PIL import Image, ImageDraw

poses = {p['file']: p for p in json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/poses_6fps.json'))}
p = poses['f_154_t25.67.png']
s = p['scale']
im = Image.open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/pan_6fps/f_154_t25.67.png').convert('RGB')
dr = ImageDraw.Draw(im)
# Liao13to14 radial prediction
cx, cy, rl = 99.67, -14.67, 1.529 * 12.3
ix, iy = s * cx + p['tx'], -s * cy + p['ty']
rr = rl * s
dr.ellipse([ix - rr, iy - rr, ix + rr, iy + rr], outline=(255, 60, 60), width=3)
dr.ellipse([ix - 5, iy - 5, ix + 5, iy + 5], fill=(255, 60, 60))
im.save('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/check_ronel_overlay.png')
print(f"drew Liao13to14 radial at screen ({ix:.0f},{iy:.0f}) r={rr:.0f}px")
