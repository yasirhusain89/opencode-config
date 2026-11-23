import json
from PIL import Image, ImageDraw

stitch = Image.open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/stitched_zoomed_south_14px.png').convert('RGB')
wxMin, wyMax, SC = -135.0, -20.0, 14.64

def to_img(wx, wy):
    return (wx - wxMin) * SC, (wyMax - wy) * SC

# Ibstock area: world x [-35..15], y [-120..-85] -> full-res crop, 2x upscale for visibility
x0, y0 = to_img(-35, -85)
x1, y1 = to_img(15, -120)
crop = stitch.crop((int(x0), int(y0), int(x1), int(y1)))
crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.NEAREST)
dr = ImageDraw.Draw(crop)
# Our mean+12.3 prediction: center (-4.33,-100), r=12.3
for (cx, cy, rl, color, w) in [(-4.33, -100.0, 12.3, (255, 60, 60), 2)]:
    ix, iy = (cx + 35) * SC * 2, (-85 - cy) * SC * 2  # crop-local coords, 2x
    rr = rl * SC * 2
    dr.ellipse([ix - rr, iy - rr, ix + rr, iy + rr], outline=color, width=w)
    dr.ellipse([ix - 5, iy - 5, ix + 5, iy + 5], fill=color)
crop.save('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/zoom_ibstock.png')
print("saved zoom_ibstock.png", crop.size)
