import json

starmap = json.load(open('static/data/starmap.json'))
by_id = {s['id']: s for s in starmap['systems']}
by_name = {s['name'].upper(): s for s in starmap['systems'] if s['id'] != 0}
rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))

for nm in ['MARIK', 'AVELLANEDA', 'AUGUSTINE', 'BERNARDO', 'PARK PLACE', 'GOMEISA', 'SORUNDA']:
    s = by_name.get(nm)
    print(f"{nm:15s}: ({s['x']:.1f},{s['y']:.1f}) id={s['id']}" if s else f"{nm}: NOT FOUND")

print("\nAssets with any system in x[-100..-10], y[-125..-65]:")
for r in rivals:
    pts = [(s['Name'], by_id[s['Id']]['x'], by_id[s['Id']]['y'], s['Weight']) for s in r['NearbyStarSystems']]
    inside = [(n, x, y, w) for n, x, y, w in pts if -100 <= x <= -10 and -125 <= y <= -65]
    if inside:
        print(f"  {r['name']:34s} R={r['Radius']:.3f} owner={r['active_3026_10_20']:20s} systems={[(n, round(x,1), round(y,1), w) for n,x,y,w in pts]}")
