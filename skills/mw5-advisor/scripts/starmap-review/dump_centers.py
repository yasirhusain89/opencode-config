import json

starmap = json.load(open('static/data/starmap.json'))
by_id = {s['id']: s for s in starmap['systems']}
rivals = json.load(open('/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/radial_influences_all.json'))

for name in ['marik13to14', 'BorderLIAOBaseMarik13to14', 'BorderLIAOBaseDavion3to6', 'BorderLIAOBaseDavion11to12', 'Liao12to13', 'BorderDAVIONBaseLiao3to6', 'BorderLIAOBaseDavion7to10']:
    r = next(x for x in rivals if x['name'] == name)
    print(f"{name}: Radius={r['Radius']:.4f} owner={r['active_3026_10_20']}")
    for s in r['NearbyStarSystems']:
        st = by_id[s['Id']]
        print(f"   {s['Name']:18s} id={s['Id']:5d} w={s['Weight']:8.4f} pos=({st['x']:.1f},{st['y']:.1f})")
