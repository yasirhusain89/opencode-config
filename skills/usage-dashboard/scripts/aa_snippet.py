#!/usr/bin/env python3
"""Merge scraped AA artifacts (top20.json + models.json) into a ready-to-paste
TOP_MODELS literal for generate.py.

Usage: python3 aa_snippet.py /tmp/models.json /tmp/top20.json
(top20 first arg is also accepted; files are detected by their "top20"/"models" key)

Override wrong values here, keyed by slug (cache_read is derived from AA's
rounded cache discount, so it is the usual suspect):

OVERRIDES = {
    "claude-fable-5-1": {"cache_read": 0.25},
}
"""
import json
import sys

OVERRIDES = {
    "claude-fable-5-1": {"cache_read": 0.25},
}


def slugify(name):
    s = name.split(" (")[0]
    return s.lower().replace(" ", "-").replace(".", "-")


def load(path, key):
    data = json.load(open(path))
    if key in data:
        return data[key]
    # files given in either order: detect by the other key
    other = "models" if key == "top20" else "top20"
    if other in data:
        return data[other]
    raise SystemExit("%s does not look like an AA artifact (no %r/%r)"
                     % (path, key, other))


def main():
    paths = sys.argv[1:]
    if len(paths) != 2:
        raise SystemExit("usage: aa_snippet.py MODELS_JSON TOP20_JSON")
    models = {m["slug"]: m for m in load(paths[0], "models")}
    top20 = load(paths[1], "top20")

    rows = []
    for t in top20:
        slug = slugify(t["name"])
        m = models.get(slug)
        if not m:
            print("# !! no pricing match for %r (slug %s)" % (t["name"], slug),
                  file=sys.stderr)
            continue
        rates = {"input": m["input"], "output": m["output"],
                 "cache_read": m["cache_read"], "cache_write": m["cache_write"]}
        rates.update(OVERRIDES.get(slug, {}))
        rows.append({
            "name": t["name"],
            "creator": t["creator"],
            "aa": t["aa_index"],
            "cpt": t["cost_per_task"],
            "pin": rates["input"],
            "pout": rates["output"],
            "pcr": rates["cache_read"],
            "pcw": rates["cache_write"],
        })
    rows.sort(key=lambda r: -r["aa"])

    print("TOP_MODELS = [")
    for r in rows:
        print("    {'name': %r, 'creator': %r, 'aa': %s, 'cpt': %s,"
              % (r["name"], r["creator"], r["aa"], r["cpt"]))
        print("     'pin': %s, 'pout': %s, 'pcr': %s, 'pcw': %s},"
              % (r["pin"], r["pout"], r["pcr"], repr(r["pcw"])))
    print("]")


if __name__ == "__main__":
    main()
