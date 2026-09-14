#!/usr/bin/env python3
"""opencode usage dashboard generator (stdlib only, python3.9+ compatible).

Reads ~/.local/share/opencode/opencode.db read-only, prices usage at
Claude Opus 5 standard rates, appends a daily snapshot to history.jsonl,
and rewrites dashboard.html (self-contained, no network/CDN).

Usage:  python3 generate.py   (safe to run any time; idempotent per day)
"""
import datetime
import html
import json
import pathlib
import re
import sqlite3
import subprocess
import sys

HOME = pathlib.Path.home()
DB = HOME / ".local/share/opencode/opencode.db"
OUT_DIR = HOME / ".opencode/usage-dashboard"
HISTORY = OUT_DIR / "history.jsonl"
HTML_OUT = OUT_DIR / "dashboard.html"

# Claude Opus 5 standard pricing (2026-07-24, unchanged from Opus 4.8)
PRICE_IN = 5.00 / 1_000_000       # $/token input
PRICE_OUT = 25.00 / 1_000_000     # $/token output (incl. reasoning/thinking)
PRICE_CACHE_READ = 0.50 / 1_000_000   # 90% off input
PRICE_CACHE_WRITE = 6.25 / 1_000_000  # 5-min TTL, 1.25x input

# Top-20 AA leaderboard (scraped 2026-09-14 from artificialanalysis.ai) with
# family token pricing from the model pages (per 1M tokens; cw=None unpublished).
# Refresh via the usage-dashboard skill (aa_model_info.mjs + aa_snippet.py).
TOP_MODELS = [
    {"name": "Claude Fable 5.1 (max w/ fallback)", "creator": "Anthropic",
     "aa": 53, "cpt": 7.63, "pin": 10.00, "pout": 50.00, "pcr": 0.25, "pcw": None},
    {"name": "Claude Fable 5.1 (xhigh w/ fallback)", "creator": "Anthropic",
     "aa": 53, "cpt": 5.98, "pin": 10.00, "pout": 50.00, "pcr": 0.25, "pcw": None},
    {"name": "GPT-6 Astra (max)", "creator": "OpenAI",
     "aa": 53, "cpt": 3.26, "pin": 10.00, "pout": 50.00, "pcr": 1.00, "pcw": 12.50},
    {"name": "GPT-6 Astra (xhigh)", "creator": "OpenAI",
     "aa": 53, "cpt": 2.31, "pin": 10.00, "pout": 50.00, "pcr": 1.00, "pcw": 12.50},
    {"name": "Claude Fable 5.1 (high w/ fallback)", "creator": "Anthropic",
     "aa": 51, "cpt": 3.91, "pin": 10.00, "pout": 50.00, "pcr": 0.25, "pcw": None},
    {"name": "GPT-6 Astra (high)", "creator": "OpenAI",
     "aa": 51, "cpt": 1.72, "pin": 10.00, "pout": 50.00, "pcr": 1.00, "pcw": 12.50},
    {"name": "Claude Opus 5 (max)", "creator": "Anthropic",
     "aa": 51, "cpt": 5.86, "pin": 5.00, "pout": 25.00, "pcr": 0.50, "pcw": 6.25},
    {"name": "Claude Fable 5 (w/ fallback)", "creator": "Anthropic",
     "aa": 50, "cpt": 8.75, "pin": 10.00, "pout": 50.00, "pcr": 1.00, "pcw": None},
    {"name": "GPT-6 Astra (medium)", "creator": "OpenAI",
     "aa": 50, "cpt": 1.54, "pin": 10.00, "pout": 50.00, "pcr": 1.00, "pcw": 12.50},
    {"name": "Claude Opus 5 (xhigh)", "creator": "Anthropic",
     "aa": 50, "cpt": 4.88, "pin": 5.00, "pout": 25.00, "pcr": 0.50, "pcw": 6.25},
    {"name": "Claude Fable 5.1 (medium w/ fallback)", "creator": "Anthropic",
     "aa": 49, "cpt": 2.98, "pin": 10.00, "pout": 50.00, "pcr": 0.25, "pcw": None},
    {"name": "Claude Opus 5 (high)", "creator": "Anthropic",
     "aa": 48, "cpt": 3.61, "pin": 5.00, "pout": 25.00, "pcr": 0.50, "pcw": 6.25},
    {"name": "Muse Spark 1.3 (max)", "creator": "Meta",
     "aa": 48, "cpt": 1.60, "pin": 1.25, "pout": 4.25, "pcr": 0.15, "pcw": None},
    {"name": "GPT-5.6 Sol (max)", "creator": "OpenAI",
     "aa": 47, "cpt": 1.99, "pin": 4.00, "pout": 20.00, "pcr": 0.40, "pcw": 5.00},
    {"name": "Claude Fable 5.1 (low w/ fallback)", "creator": "Anthropic",
     "aa": 47, "cpt": 2.37, "pin": 10.00, "pout": 50.00, "pcr": 0.25, "pcw": None},
    {"name": "GPT-6 Astra (low)", "creator": "OpenAI",
     "aa": 46, "cpt": 0.82, "pin": 10.00, "pout": 50.00, "pcr": 1.00, "pcw": 12.50},
    {"name": "Muse Spark 1.3 (xhigh)", "creator": "Meta",
     "aa": 45, "cpt": 1.37, "pin": 1.25, "pout": 4.25, "pcr": 0.15, "pcw": None},
    {"name": "Claude Opus 5 (medium)", "creator": "Anthropic",
     "aa": 45, "cpt": 2.19, "pin": 5.00, "pout": 25.00, "pcr": 0.50, "pcw": 6.25},
    {"name": "GLM-5.3 (max)", "creator": "Z AI",
     "aa": 45, "cpt": 2.01, "pin": 1.40, "pout": 4.40, "pcr": 0.26, "pcw": None},
    {"name": "Grok 4.6 (high)", "creator": "SpaceXAI",
     "aa": 44, "cpt": 1.86, "pin": 2.00, "pout": 6.00, "pcr": 0.50, "pcw": None},
]
# Models actually in use here (free tiers) with their paid AA equivalents;
# appended to the comparison table so usage can be compared against same tier.
IN_USE_EQUIV = [
    {"name": "GLM-5.3-Flash", "creator": "Z AI", "in_use": True,
     "aa": 42, "cpt": 0.25, "pin": 0.15, "pout": 0.50, "pcr": 0.03, "pcw": None},
    {"name": "Qwen3.8 Max", "creator": "Alibaba", "in_use": True,
     "aa": 40, "cpt": 2.67, "pin": 2.00, "pout": 6.00, "pcr": 0.24, "pcw": None},
]

# --- tool-use taxonomy (ordered for display) ---
CATEGORIES = ["Read", "Lexical search", "Graph search", "Structural search",
              "Versioning", "Container", "Build/package", "DB", "Net/Cloud",
              "Write", "Delegate", "Skill", "Interaction", "Web", "Meta/tooling"]

TOOL_CATEGORY = {
    "read": "Read",
    "edit": "Write", "write": "Write",
    "grep": "Lexical search", "glob": "Lexical search",
    "zvec_grep_zvec_grep_search": "Lexical search",  # hybrid vector+BM25
    "task": "Delegate",
    "skill": "Skill",
    "question": "Interaction",
    "webfetch": "Web", "websearch": "Web",
    "todowrite": "Meta/tooling",
}

# bash intents, first match wins (matched against the full command, lowercase)
BASH_RULES = [
    ("Meta/tooling", ["usage-dashboard", "generate\\.py", "serve-monartha",
                       "serve-myfinances"]),
    ("DB", ["opencode\\s+db", "\\bsqlite3?\\b", "\\bpsql\\b", "\\.sqlite\\b"]),
    ("Versioning", ["\\bgit\\b", "\\bgh\\b", "gitnexus", "github"]),
    ("Container", ["docker", "kubectl", "podman", "colima"]),
    ("Build/package", ["\\bnpm\\b", "\\bnpx\\b", "\\bnode\\b", "\\bcargo\\b",
                        "tauri", "\\buv\\b", "\\bpip\\b", "pytest", "vite",
                        "playwright", "\\btsc\\b", "svelte", "\\bbrew\\b",
                        "vitest", "storybook", "\\bmake\\b", "\\bpython[0-9.]*\\b"]),
    ("Net/Cloud", ["\\bcurl\\b", "\\bwget\\b", "\\bssh\\b", "\\bscp\\b",
                    "gcloud", "\\baws\\b"]),
    ("Structural search", ["\\bjq\\b", "\\byq\\b", "ast-grep", "\\btree\\b"]),
    ("Lexical search", ["\\brg\\b", "grep", "\\bfind\\b", "\\bfd\\b", "fzf",
                         "mdfind"]),
    ("Read", ["\\bls\\b", "\\bcat\\b", "\\bhead\\b", "\\btail\\b", "\\bless\\b",
               "\\bpwd\\b", "\\bwhich\\b", "\\bfile\\b", "\\bstat\\b", "\\bwc\\b",
               "\\bdu\\b", "sw_vers", "uname"]),
    ("Meta/tooling", ["\\bopencode\\b", "\\bopen\\b", "launchctl", "plutil",
                       "defaults\\s+write"]),
]
BASH_RULES_COMPILED = [(c, [re.compile(p) for p in ps]) for c, ps in BASH_RULES]


def classify_bash(cmd):
    if not cmd:
        return "Meta/tooling"
    low = cmd.lower()
    for cat, pats in BASH_RULES_COMPILED:
        for p in pats:
            if p.search(low):
                return cat
    return "Meta/tooling"


def classify_tool(name):
    if name in TOOL_CATEGORY:
        return TOOL_CATEGORY[name]
    if name.startswith("gitnexus"):
        return "Graph search"
    if name.startswith("zvec"):
        return "Lexical search"
    return "Meta/tooling"


def price_cost(d, pin, pout, pcr, pcw):
    out_and_reason = d["output"] + d["reasoning"]
    c_in = d["input"] * pin / 1_000_000
    c_out = out_and_reason * pout / 1_000_000
    c_read = d["cache_read"] * pcr / 1_000_000
    c_write = d["cache_write"] * pcw / 1_000_000 if pcw else 0.0
    return {
        "input": c_in, "output": c_out, "cache_read": c_read,
        "cache_write": c_write, "total": c_in + c_out + c_read + c_write,
    }


def cost(d):
    return price_cost(d, 5.00, 25.00, 0.50, 6.25)


def main():
    if not DB.exists():
        sys.exit("db not found: " + str(DB))
    con = sqlite3.connect("file:" + str(DB) + "?mode=ro", uri=True)
    cur = con.cursor()

    # --- totals from session table (canonical counters) ---
    cur.execute("""SELECT count(*), coalesce(sum(tokens_input),0),
        coalesce(sum(tokens_output),0), coalesce(sum(tokens_reasoning),0),
        coalesce(sum(tokens_cache_read),0), coalesce(sum(tokens_cache_write),0),
        coalesce(sum(cost),0) FROM session""")
    row = cur.fetchone()
    total = {"input": row[1], "output": row[2], "reasoning": row[3],
             "cache_read": row[4], "cache_write": row[5],
             "sessions": row[0], "messages": 0}
    actual = row[6]

    cur.execute("SELECT count(*) FROM message")
    total["messages"] = cur.fetchone()[0]

    # --- per project directory ---
    cur.execute("""SELECT project_id, directory, count(*),
        coalesce(sum(tokens_input),0), coalesce(sum(tokens_output),0),
        coalesce(sum(tokens_reasoning),0), coalesce(sum(tokens_cache_read),0),
        coalesce(sum(tokens_cache_write),0)
        FROM session GROUP BY project_id, directory ORDER BY 4 DESC""")
    projects = []
    for r in cur.fetchall():
        d = {"project_id": r[0], "directory": r[1], "sessions": r[2],
             "input": r[3], "output": r[4], "reasoning": r[5],
             "cache_read": r[6], "cache_write": r[7]}
        d["cost"] = cost(d)["total"]
        projects.append(d)

    # --- per model (tokens + recorded actual cost) ---
    cur.execute("""SELECT json_extract(data,'$.providerID'), json_extract(data,'$.modelID'), count(*),
        coalesce(sum(CAST(json_extract(data,'$.tokens.input') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.tokens.output') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.tokens.cache.read') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.tokens.cache.write') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.cost') AS REAL)),0.0)
        FROM message WHERE json_extract(data,'$.role')='assistant'
        GROUP BY 1, 2 ORDER BY 4 DESC""")
    models = []
    for r in cur.fetchall():
        d = {"provider": r[0] or "?", "model": r[1] or "?", "messages": r[2],
             "input": r[3], "output": r[4], "reasoning": r[5],
             "cache_read": r[6], "cache_write": r[7], "actual": r[8]}
        d["cost"] = cost(d)["total"]
        models.append(d)

    # --- per provider rollup (models grouped by providerID) ---
    providers = {}
    for m in models:
        p = providers.setdefault(m["provider"], {
            "provider": m["provider"], "messages": 0, "input": 0, "output": 0,
            "reasoning": 0, "cache_read": 0, "cache_write": 0, "actual": 0.0,
            "models": []})
        for k in ["messages", "input", "output", "reasoning",
                  "cache_read", "cache_write"]:
            p[k] += m[k]
        p["actual"] += m["actual"]
        p["models"].append(m["model"])
    provider_list = sorted(providers.values(),
                           key=lambda p: -p["input"] - p["cache_read"])
    for p in provider_list:
        p["cost"] = cost(p)["total"]

    # --- per day ---
    cur.execute("""SELECT date(time_created/1000,'unixepoch'), count(*),
        coalesce(sum(tokens_input),0), coalesce(sum(tokens_output),0),
        coalesce(sum(tokens_reasoning),0), coalesce(sum(tokens_cache_read),0),
        coalesce(sum(tokens_cache_write),0)
        FROM session GROUP BY 1 ORDER BY 1""")
    days = []
    for r in cur.fetchall():
        d = {"day": r[0], "sessions": r[1], "input": r[2], "output": r[3],
             "reasoning": r[4], "cache_read": r[5], "cache_write": r[6]}
        d["cost"] = cost(d)["total"]
        days.append(d)

    # --- tool calls by tool name ---
    cur.execute("""SELECT json_extract(data,'$.tool'), count(*) FROM part
        WHERE json_extract(data,'$.type')='tool'
        GROUP BY 1 ORDER BY 2 DESC""")
    tool_counts = [(r[0] or "?", r[1]) for r in cur.fetchall()]

    # --- reliability: tool errors ---
    cur.execute("""SELECT count(*),
        sum(CASE WHEN json_extract(data,'$.state.status')='error' THEN 1 ELSE 0 END)
        FROM part WHERE json_extract(data,'$.type')='tool'""")
    calls_total, calls_err = cur.fetchone()
    calls_err = calls_err or 0

    # --- errors by tool ---
    cur.execute("""SELECT json_extract(data,'$.tool'), count(*) FROM part
        WHERE json_extract(data,'$.type')='tool'
        AND json_extract(data,'$.state.status')='error'
        GROUP BY 1 ORDER BY 2 DESC""")
    errors_by_tool = [(r[0] or "?", r[1]) for r in cur.fetchall()]

    # --- efficiency: cache hit rate ---
    denom = total["input"] + total["cache_read"]
    cache_hit = (100.0 * total["cache_read"] / denom) if denom else 0.0

    # --- latency: turn durations + tokens/sec from message timestamps,
    #     grouped per provider (opencode timestamps are ms) ---
    cur.execute("""SELECT json_extract(data,'$.providerID'),
        json_extract(data,'$.time.created'),
        json_extract(data,'$.time.completed'),
        json_extract(data,'$.tokens.output') + json_extract(data,'$.tokens.reasoning')
        FROM message WHERE json_extract(data,'$.role')='assistant'
        AND json_extract(data,'$.time.completed') IS NOT NULL""")
    prov_lat = {}
    for provider, created, completed, out_tok in cur.fetchall():
        if not (created and completed and completed > created):
            continue
        secs = (completed - created) / 1000.0
        p = prov_lat.setdefault(provider or "?", {"msgs": 0, "durs": [], "tps": []})
        p["msgs"] += 1
        p["durs"].append(secs)
        if out_tok and secs > 0:
            p["tps"].append(out_tok / secs)

    def pctiles(vals, p):
        if not vals:
            return 0.0
        return vals[min(int(len(vals) * p), len(vals) - 1)]

    prov_lat_list = []
    for p, d in sorted(prov_lat.items(), key=lambda kv: -kv[1]["msgs"]):
        durs = sorted(d["durs"])
        tps = sorted(d["tps"])
        prov_lat_list.append({
            "provider": p, "msgs": d["msgs"],
            "p50": durs[len(durs) // 2] if durs else 0.0,
            "p95": pctiles(durs, 0.95),
            "tps_p50": tps[len(tps) // 2] if tps else 0.0,
            "total_min": sum(durs) / 60.0})
    latency = None
    if prov_lat_list:
        alld = sorted(x for d in prov_lat.values() for x in d["durs"])
        allt = sorted(x for d in prov_lat.values() for x in d["tps"])
        latency = {"msgs": len(alld),
                   "p50": alld[len(alld) // 2] if alld else 0.0,
                   "p95": pctiles(alld, 0.95),
                   "total_min": sum(alld) / 60.0,
                   "tps_p50": allt[len(allt) // 2] if allt else 0.0,
                   "tps_p10": pctiles(allt, 0.10)}

    # --- tool calls + errors per provider (part joins message on message_id) ---
    cur.execute("""SELECT json_extract(m.data,'$.providerID'), count(*),
        sum(CASE WHEN json_extract(p.data,'$.state.status')='error'
            THEN 1 ELSE 0 END)
        FROM part p JOIN message m ON p.message_id = m.id
        WHERE json_extract(p.data,'$.type')='tool'
        GROUP BY 1 ORDER BY 2 DESC""")
    prov_err = {}
    for provider, n, errs in cur.fetchall():
        prov_err[provider or "?"] = {"calls": n, "errors": errs or 0}

    prov_rel = []
    for e in prov_lat_list:
        er = prov_err.get(e["provider"], {"calls": 0, "errors": 0})
        e2 = dict(e)
        e2["calls"] = er["calls"]
        e2["errors"] = er["errors"]
        prov_rel.append(e2)
    for p in sorted(prov_err):
        if not any(e["provider"] == p for e in prov_rel):
            er = prov_err[p]
            prov_rel.append({"provider": p, "msgs": 0, "p50": 0.0, "p95": 0.0,
                             "tps_p50": 0.0, "total_min": 0.0,
                             "calls": er["calls"], "errors": er["errors"]})

    # --- per-session rollup (sessions table + message msg/duration + tool calls) ---
    cur.execute("""SELECT s.id, s.directory, s.time_created, s.time_updated,
        s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read,
        s.tokens_cache_write,
        (SELECT count(*) FROM message m WHERE m.session_id = s.id),
        (SELECT count(*) FROM part p WHERE p.session_id = s.id
            AND json_extract(p.data,'$.type')='tool'),
        (SELECT count(*) FROM part p WHERE p.session_id = s.id
            AND json_extract(p.data,'$.type')='tool'
            AND json_extract(p.data,'$.state.status')='error'),
        (SELECT count(DISTINCT json_extract(m2.data,'$.variant')) FROM message m2
            WHERE m2.session_id = s.id AND json_extract(m2.data,'$.role')='assistant'
            AND json_extract(m2.data,'$.variant') IS NOT NULL)
        FROM session s ORDER BY s.time_created""")
    session_rows_data = []
    for r in cur.fetchall():
        sid, directory, tc, tu, i, o, reas, cr, cw, msgs, calls, errs, nvar = r
        sd = {"id": sid, "directory": directory, "msgs": msgs, "calls": calls,
              "errors": errs, "input": i, "output": o, "reasoning": reas,
              "cache_read": cr, "cache_write": cw, "variants": nvar}
        sd["cost"] = cost(sd)["total"]
        session_rows_data.append(sd)

    # first/last message timestamps per session (for duration + landing)
    for sd in session_rows_data:
        row = cur.execute(
            """SELECT min(time_created), max(time_updated) FROM message
            WHERE session_id = ?""", (sd["id"],)).fetchone()
        first, last = row
        sd["dur_min"] = ((last - first) / 60000.0) if (first and last and last > first) else 0.0
        sd["first"], sd["last"] = first, last
    session_rows_data.sort(key=lambda s: -s["cost"])

    # --- effort-level (variant) mix ---
    cur.execute("""SELECT json_extract(data,'$.variant'), count(*),
        coalesce(sum(CAST(json_extract(data,'$.tokens.output') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER)),0)
        FROM message WHERE json_extract(data,'$.role')='assistant'
        GROUP BY 1 ORDER BY 2 DESC""")
    variants = [(r[0] or "unset", r[1], r[2], r[3]) for r in cur.fetchall()]

    # --- hour-of-day activity (UTC, from session tokens) ---
    cur.execute("""SELECT CAST(strftime('%H', time_created/1000, 'unixepoch') AS INTEGER),
        count(*), coalesce(sum(tokens_input),0), coalesce(sum(tokens_cache_read),0),
        coalesce(sum(tokens_output),0), coalesce(sum(tokens_reasoning),0)
        FROM session GROUP BY 1""")
    hours = {h: {"sessions": n, "input": i, "cache_read": crr, "output": o,
                 "reasoning": reas}
             for h, n, i, crr, o, reas in cur.fetchall()}
    for h in range(24):
        hours.setdefault(h, {"sessions": 0, "input": 0, "cache_read": 0,
                             "output": 0, "reasoning": 0})

    # --- commit-landing: session end times vs git log in each project dir ---
    con.close()
    commits_by_dir = {}
    dirs = sorted({s["directory"] for s in session_rows_data
                   if s["directory"] and s["directory"].startswith("/")})
    for d in dirs:
        try:
            out = subprocess.run(
                ["git", "-C", d, "log", "--format=%ct", "--all"],
                capture_output=True, text=True, timeout=15)
            stamps = []
            for line in out.stdout.splitlines():
                line = line.strip()
                if line.isdigit():
                    stamps.append(int(line))
            commits_by_dir[d] = stamps
        except Exception:
            commits_by_dir[d] = []

    def landed(directory, last_ts):
        stamps = commits_by_dir.get(directory, [])
        if not stamps or not last_ts:
            return None
        # opencode timestamps are ms; git commit stamps are seconds
        last_s = last_ts / 1000.0 if last_ts > 1e11 else float(last_ts)
        # a commit within 24h after the last message counts as landed
        return any(0 <= c - last_s <= 86400 for c in stamps)

    for sd in session_rows_data:
        sd["landed"] = landed(sd["directory"], sd.get("last"))

    n_landed = sum(1 for s in session_rows_data if s["landed"])
    n_checkable = sum(1 for s in session_rows_data if s["landed"] is not None)

    # --- bash command intents ---
    con = sqlite3.connect("file:" + str(DB) + "?mode=ro", uri=True)
    cur = con.cursor()
    cur.execute("""SELECT json_extract(data,'$.state.input.command') FROM part
        WHERE json_extract(data,'$.type')='tool'
        AND json_extract(data,'$.tool')='bash'""")
    bash_cats = {}
    for r in cur.fetchall():
        cat = classify_bash(r[0] or "")
        bash_cats[cat] = bash_cats.get(cat, 0) + 1
    con.close()

    # --- roll up categories ---
    cat_counts = {c: 0 for c in CATEGORIES}
    mapping = []  # (tool label, category, count)
    for tool, n in tool_counts:
        if tool == "bash":
            for cat in CATEGORIES:
                c = bash_cats.get(cat, 0)
                if c:
                    cat_counts[cat] += c
                    mapping.append(("bash: " + cat.lower(), cat, c))
        else:
            cat = classify_tool(tool)
            cat_counts[cat] += n
            mapping.append((tool, cat, n))
    mapping.sort(key=lambda t: -t[2])
    total_calls = sum(cat_counts.values())

    now = datetime.datetime.now().astimezone()
    total_cost = cost(total)
    primary = models[0] if models else {"model": "?", "provider": "?",
                                        "messages": 0, "actual": 0.0, "cost": 0.0}
    equiv = []
    for m in TOP_MODELS + IN_USE_EQUIV:
        c = price_cost(total, m["pin"], m["pout"], m["pcr"], m["pcw"])
        equiv.append({"model": m, "cost": c})
    equiv.sort(key=lambda e: -e["model"]["aa"])

    # --- history (one snapshot per day, update in place) ---
    snap = {"date": now.strftime("%Y-%m-%d"),
            "generated": now.isoformat(timespec="seconds"),
            "sessions": total["sessions"], "messages": total["messages"],
            "input": total["input"], "output": total["output"],
            "reasoning": total["reasoning"], "cache_read": total["cache_read"],
            "cache_write": total["cache_write"],
            "opus5_total": round(total_cost["total"], 2),
            "actual_cost": round(actual, 4)}
    hist = []
    if HISTORY.exists():
        for line in HISTORY.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    hist.append(json.loads(line))
                except ValueError:
                    pass
        hist = [h for h in hist if h.get("date") != snap["date"]]
    hist.append(snap)
    hist = hist[-365:]
    HISTORY.write_text("\n".join([json.dumps(h) for h in hist]) + "\n")

    HTML_OUT.write_text(render(now, total, total_cost, actual, primary,
                               equiv, projects, models, provider_list, days,
                               cat_counts, mapping, total_calls,
                               cache_hit, calls_total, calls_err,
                               errors_by_tool, latency, hist,
                               session_rows_data, n_landed, n_checkable,
                               variants, hours, prov_rel))
    size_kb = HTML_OUT.stat().st_size / 1024
    print("wrote " + str(HTML_OUT) + " (%.1f KB), sessions=%d opus5=$%.2f actual=$%.4f"
          % (size_kb, total["sessions"], total_cost["total"], actual))


def fmt(n):
    if n >= 1_000_000:
        return "%.1fM" % (n / 1_000_000)
    if n >= 1_000:
        return "%.1fK" % (n / 1_000)
    return str(n)


def money(x):
    return "$%s" % format(x, ",.2f")


def hrs(m):
    return ("%.1f h" % (m / 60.0)) if m >= 60 else ("%.0f min" % m)


def esc(s):
    return html.escape(s if isinstance(s, str) else str(s))


def hbar(pct, color):
    pct = max(0.0, min(100.0, pct))
    return ('<span class="bar"><span class="fill" style="width:%.1f%%;'
            'background:%s"></span></span>' % (pct, color))


CAT_COLORS = {
    "Read": "#4c9aff", "Lexical search": "#36b37e",
    "Graph search": "#7c5cff", "Structural search": "#00b8d9",
    "Versioning": "#ff5630", "Container": "#0065ff",
    "Build/package": "#ffab00", "DB": "#6554c0", "Net/Cloud": "#00a3bf",
    "Write": "#36b37e", "Delegate": "#8777d9", "Skill": "#ff7452",
    "Interaction": "#de350b", "Web": "#0052cc", "Meta/tooling": "#97a0af",
}


def render(now, total, total_cost, actual, primary, equiv, projects, models,
           provider_list, days, cat_counts, mapping, total_calls, cache_hit,
           calls_total, calls_err, errors_by_tool, latency, hist,
           session_rows_data, n_landed, n_checkable, variants, hours, prov_rel):
    max_proj = max([p["cost"] for p in projects] + [1])
    max_hist = max([h["opus5_total"] for h in hist] + [1])
    max_cat = max(list(cat_counts.values()) + [1])
    n_days = max(len(days), 1)
    avg_day = total_cost["total"] / n_days
    avoided = total_cost["total"] - actual
    peak = max(days, key=lambda d: d["cost"]) if days else None

    def union_minutes(intervals):
        if not intervals:
            return 0.0
        ivs = sorted(iv for iv in intervals if iv[0] and iv[1] and iv[1] > iv[0])
        acc = 0.0
        cur_s, cur_e = ivs[0]
        for s0, e0 in ivs[1:]:
            if s0 <= cur_e:
                cur_e = max(cur_e, e0)
            else:
                acc += cur_e - cur_s
                cur_s, cur_e = s0, e0
        acc += cur_e - cur_s
        return acc / 60000.0

    dir_intervals = {}
    for s in session_rows_data:
        if s.get("first") and s.get("last"):
            dir_intervals.setdefault(s["directory"], []).append(
                (s["first"], s["last"]))
    dir_time = {d: union_minutes(ivs) for d, ivs in dir_intervals.items()}
    overall_min = union_minutes(
        [(s["first"], s["last"]) for s in session_rows_data
         if s.get("first") and s.get("last")])
    sum_min = sum(s["dur_min"] for s in session_rows_data)

    # ---- hero ----
    err_rate = (100.0 * calls_err / calls_total) if calls_total else 0.0
    hero = (
        "<div class='hero'>"
        "<div class='card big'><div class='k'>Would cost on Opus 5</div>"
        "<div class='v'>" + money(total_cost["total"]) + "</div>"
        "<div class='s'>" + str(total["sessions"]) + " sessions &middot; "
        + format(total["messages"], ",d") + " messages</div></div>"
        "<div class='card big'><div class='k'>Actually paid</div>"
        "<div class='v ok'>" + money(actual) + "</div>"
        "<div class='s'>" + esc(primary["provider"]) + " / "
        + esc(primary["model"].split("/")[-1]) + "</div></div>"
        "<div class='card'><div class='k'>Avoided</div>"
        "<div class='v ok'>" + money(avoided) + "</div>"
        "<div class='s'>vs Opus 5 list price</div></div>"
        "<div class='card'><div class='k'>Cache hit</div>"
        "<div class='v ok'>%.1f%%</div>"
        "<div class='s'>" + fmt(total["cache_read"]) + " of "
        + fmt(total["input"] + total["cache_read"]) + " input</div></div>"
        "<div class='card'><div class='k'>Tool errors</div>"
        "<div class='v %.1f%% ok'>%.1f%%</div>"
        "<div class='s'>" + str(calls_err) + " of " + str(calls_total)
        + " calls</div></div>"
        "<div class='card'><div class='k'>Time with opencode</div>"
        "<div class='v'>" + hrs(overall_min) + "</div>"
        "<div class='s'>wall-clock union &middot; "
        + hrs(sum_min) + " summed</div></div>"
        "</div>") % (cache_hit, err_rate, err_rate)

    # ---- pricing: comparison model choice (dropdown) + in-use card ----
    # dedupe into families (same rates -> same cost) for the comparison dropdown
    fams = []
    seen = set()
    for e in equiv:
        m = e["model"]
        key = (m["pin"], m["pout"], m["pcr"], m["pcw"])
        if key in seen:
            continue
        seen.add(key)
        fams.append(e)
    cmp_json = json.dumps({"opts": [
        {"name": re.sub(r"\s*\(.*$", "", e["model"]["name"]),
         "aa": e["model"]["aa"], "cpt": e["model"]["cpt"],
         "in_use": bool(e["model"].get("in_use")),
         "pin": e["model"]["pin"], "pout": e["model"]["pout"],
         "pcr": e["model"]["pcr"], "pcw": e["model"]["pcw"],
         "cost": round(e["cost"]["total"], 2)}
        for e in fams]})
    cw_str = lambda pcw: ("$%.2f / 1M" % pcw) if pcw else "n/a"
    opts = ""
    for idx, e in enumerate(fams):
        m = e["model"]
        opts += ("<option value='" + str(idx) + "'>"
                 + esc(re.sub(r"\s*\(.*$", "", m["name"])) + " &mdash; "
                 + money(e["cost"]["total"]) + "</option>\n")
    short_primary = esc(primary["model"].split("/")[-1])
    pricing = ("<h2>Pricing &mdash; your usage on each model</h2>"
               "<div class='grid2'>"
               "<div class='card'><div class='k'>Compare model</div>"
               "<select id='cmpsel' class='cmpsel'>" + opts + "</select>"
               "<div id='cmpcard'></div></div>"
               "<div class='card'><div class='k'>In use &middot; " + short_primary
               + "</div><div class='v ok'>" + money(primary["actual"]) + "</div>"
               "<table class='rates'>"
               "<tr><td>Input</td><td class='r'>$0.00</td></tr>"
               "<tr><td>Output</td><td class='r'>$0.00</td></tr>"
               "<tr><td>Cache</td><td class='r'>n/a</td></tr>"
               "</table><div class='s'>Free contributor tier &middot; recorded spend across "
               + format(primary["messages"], ",d") + " messages. Rates not published; "
               "cost as recorded by opencode.</div></div></div>"
               "<script type='application/json' id='cmp-data'>" + cmp_json
               + "</script>")

    # ---- top-20 AA comparison table ----
    def in_use_flag(m):
        return " <span class='ok-flag'>&#10003;</span>" if m.get("in_use") else ""
    cmp_rows = ""
    for e in equiv:
        m = e["model"]
        cmp_rows += ("<tr><td>" + esc(m["name"]) + in_use_flag(m) + "</td>"
                     "<td>" + esc(m["creator"]) + "</td>"
                     "<td class='r'>" + str(m["aa"]) + "</td>"
                     "<td class='r'>$%.2f</td>" % m["cpt"]
                     + "<td class='r'>$%.2f</td>" % m["pin"]
                     + "<td class='r'>$%.2f</td>" % m["pout"]
                     + "<td class='r'>" + cw_str(m["pcr"]).replace(" / 1M", "")
                     + "</td>"
                     "<td class='r'>" + cw_str(m["pcw"]).replace(" / 1M", "")
                     + "</td>"
                     "<td class='r'><b>" + money(e["cost"]["total"]) + "</b></td></tr>\n")
    compare = ("<details><summary><b>Top-20 comparison</b> (AA intelligence index; "
               "your usage priced on each)</summary>"
               "<div class='s'>Top 20 by Artificial Analysis Intelligence Index "
               "(scraped 2026-09-14) + the paid equivalents of the free models in "
               "use (&#10003;). Cost/task is AA's weighted cost per Intelligence "
               "Index task; the last column prices YOUR token mix at that model's "
               "rates.</div>"
               "<table><tr><th>Model</th><th>Creator</th>"
               "<th style='text-align:right'>AA idx</th>"
               "<th style='text-align:right'>Cost/task</th>"
               "<th style='text-align:right'>In $/1M</th>"
               "<th style='text-align:right'>Out $/1M</th>"
               "<th style='text-align:right'>Cache r</th>"
               "<th style='text-align:right'>Cache w</th>"
               "<th style='text-align:right'>Your usage</th></tr>"
               + cmp_rows + "</table></details>")

    # ---- trend ----
    hist_bars = ""
    for h in hist[-30:]:
        pct = 100 * h["opus5_total"] / max_hist
        hist_bars += ("<div class='hcol' title='" + esc(h["date"]) + ": "
                      + money(h["opus5_total"]) + "'>"
                      "<div class='hval'>" + money(h["opus5_total"]) + "</div>"
                      "<div class='htrack'><div class='hfill' style='height:%.1f%%'>"
                      "</div></div><div class='hdate'>" + esc(h["date"][5:])
                      + "</div></div>\n") % pct
    if not hist_bars:
        hist_bars = '<span class="note">no snapshots yet</span>'
    peak_note = ""
    if peak is not None:
        peak_note = ("<span class='pill'>peak " + esc(peak["day"]) + " &middot; "
                     + money(peak["cost"]) + "</span>")
    trend = ("<h2>Daily Opus-5 trend " + peak_note + "</h2>"
             "<div class='hist'>" + hist_bars + "</div>"
             "<div class='s'>Snapshots accumulate once a day; intra-day runs update "
             "today's bar.</div>")

    # ---- per-session table (collapsed, sorted by cost) ----
    ss_rows = ""
    for s in session_rows_data[:20]:
        flag = ""
        if s["landed"] is True:
            flag = "<span class='ok-flag'>&#10003;</span>"
        elif s["landed"] is False:
            flag = "<span class='bad-flag'>&#215;</span>"
        out_r = s["output"] + s["reasoning"]
        start = (datetime.datetime.fromtimestamp(s["first"] / 1000.0)
                 .strftime("%m-%d %H:%M")) if s.get("first") else "&ndash;"
        end = (datetime.datetime.fromtimestamp(s["last"] / 1000.0)
               .strftime("%m-%d %H:%M")) if s.get("last") else "&ndash;"
        calls_cell = ("<td>" + str(s["calls"]) + "</td><td class='r'>"
                      + str(s["errors"]) + "</td>") if s["calls"] else \
            ("<td>&ndash;</td><td>&ndash;</td>")
        ss_rows += ("<tr><td class='mono'>" + esc(s["id"][-8:]) + "</td>"
                    "<td class='mono'>" + esc(s["directory"].rstrip("/").split("/")[-1])
                    + "</td>"
                    "<td class='mono'>" + start + "</td>"
                    "<td class='mono'>" + end + "</td>"
                    "<td>%.0f</td>" % s["dur_min"]
                    + "<td>" + str(s["msgs"]) + "</td>"
                    "<td>" + fmt(s["input"] + s["cache_read"]) + "</td>"
                    "<td>" + fmt(out_r) + "</td>"
                    "<td class='r'>" + money(s["cost"]) + "</td>"
                    + calls_cell
                    + "<td>" + flag + "</td></tr>\n")
    session_sec = ("<details><summary><b>Per session</b> (top 20 by Opus-5 cost; "
                   "&#10003; = commit within 24h after, &#215; = none)</summary>"
                   "<table><tr><th>Session</th><th>Project</th><th>Started</th>"
                   "<th>Ended</th><th>Min</th>"
                   "<th>Msgs</th><th>In+Cache</th><th>Out+reas</th>"
                   "<th style='text-align:right'>Opus 5</th><th>Calls</th>"
                   "<th style='text-align:right'>Err</th><th></th></tr>"
                   + ss_rows + "</table>"
                   "<div class='s'>Times are local; Min is first-to-last message. "
                   "Landing check matches git log in the session's project dir.</div>"
                   "</details>")

    # ---- effort-level mix ----
    total_var_msgs = sum(v[1] for v in variants) or 1
    var_rows = ""
    for name, n, out_tok, reas_tok in variants:
        pct = 100.0 * n / total_var_msgs
        var_rows += ("<tr><td class='mono'>" + esc(name) + "</td>"
                     "<td>" + format(n, ",d") + "</td>"
                     "<td class='r'>%.1f%%</td>" % pct
                     + "<td>" + hbar(pct, "#ffab00") + "</td>"
                     "<td>" + fmt(out_tok + reas_tok) + "</td></tr>\n")
    effort = ("<details><summary><b>Effort-level mix</b> (thinking variants; "
              "the cost lever)</summary>"
              "<table><tr><th>Variant</th><th>Msgs</th>"
              "<th style='text-align:right'>Share</th><th></th>"
              "<th>Out+reas tokens</th></tr>"
              + var_rows + "</table>"
              "<div class='s'>Reasoning effort per assistant message. Routine "
              "turns at high/medium instead of max/xhigh cut thinking tokens "
              "billed at the output rate.</div></details>")

    # ---- hour-of-day heatstrip (UTC) ----
    hour_cells = ""
    max_hour = max((h["input"] + h["cache_read"] + h["output"] + h["reasoning"])
                   for h in hours.values()) or 1
    for h in range(24):
        d = hours[h]
        toks = d["input"] + d["cache_read"] + d["output"] + d["reasoning"]
        pct = 100.0 * toks / max_hour
        alpha = 0.15 + 0.85 * (toks / max_hour)
        hour_cells += ("<div class='hcell2' title='%02d:00 UTC &middot; %s tokens "
                       "&middot; %d sessions'><div class='hfill2' "
                       "style='height:%.1f%%;opacity:%.2f'></div>"
                       "<div class='hlab'>%02d</div></div>\n"
                       % (h, fmt(toks), d["sessions"], max(pct, 4), alpha, h))
    hours_sec = ("<details><summary><b>Hour-of-day activity</b> (UTC tokens; "
                 "when sessions start)</summary>"
                 "<div class='heatstrip'>" + hour_cells + "</div>"
                 "<div class='s'>Peak hours are when expensive sessions happen "
                 "and when the daily 08:00 regen lands relative to your "
                 "overnight block.</div></details>")

    # ---- commit-landing ----
    if n_checkable:
        land_pct = 100.0 * n_landed / n_checkable
        landing = ("<details><summary><b>Commit-landing ratio</b> (did the work "
                   "land in git?)</summary>"
                   "<div class='grid2'>"
                   "<div class='card'><div class='k'>Sessions landed</div>"
                   "<div class='v ok'>" + str(n_landed) + " / "
                   + str(n_checkable) + "</div>"
                   "<div class='s'>%.0f%% of git-backed sessions had a commit "
                   "within 24h after their last message</div></div>" % land_pct
                   + "<div class='card'><div class='k'>Not checkable</div>"
                   "<div class='v'>" + str(len(session_rows_data) - n_checkable)
                   + "</div><div class='s'>sessions in non-git or missing "
                   "directories</div></div></div>"
                   "<div class='s'>Matching: git log --all in each session's "
                   "project dir; a commit timestamped within 24h after the "
                   "session's last message counts as landed. Solo/personal "
                   "sessions can legitimately end without commits (exploration, "
                   "questions).</div></details>")
    else:
        landing = ""

    # ---- per day, recent first ----
    day_rows = ""
    for d in reversed(days):
        toks = (d["input"] + d["output"] + d["reasoning"] + d["cache_read"]
                + d["cache_write"])
        day_rows += ("<tr><td class='mono'>" + esc(d["day"]) + "</td>"
                     "<td>" + str(d["sessions"]) + "</td>"
                     "<td>" + fmt(toks) + "</td>"
                     "<td class='r'>" + money(d["cost"]) + "</td></tr>\n")
    perday = ("<h2>Cost per day</h2>"
              "<table><tr><th>Day</th><th>Sessions</th><th>Tokens</th>"
              "<th style='text-align:right'>Opus 5</th></tr>" + day_rows + "</table>")

    # ---- tool categories ----
    cat_rows = ""
    for c in CATEGORIES:
        n = cat_counts.get(c, 0)
        if not n:
            continue
        pct = 100.0 * n / max(total_calls, 1)
        cat_rows += ("<tr><td>" + esc(c) + "</td><td>" + format(n, ",d") + "</td>"
                     "<td class='r'>%.1f%%</td>" % pct
                     + "<td>" + hbar(pct, CAT_COLORS.get(c, "#97a0af")) + "</td></tr>\n")
    map_rows = ""
    for tool, cat, n in mapping:
        map_rows += ("<tr><td class='mono'>" + esc(tool) + "</td><td>" + esc(cat)
                     + "</td><td>" + format(n, ",d") + "</td></tr>\n")
    tools = ("<h2>Tool use by category</h2>"
             "<div class='s'>Share of " + format(total_calls, ",d")
             + " tool calls. Tokens are billed per message, not per call, so this "
             "shows where effort goes, not cost.</div>"
             "<table><tr><th>Category</th><th>Calls</th>"
             "<th style='text-align:right'>Share</th><th></th></tr>"
             + cat_rows + "</table>"
             "<details><summary>Tool &rarr; category mapping ("
             + str(len(mapping)) + ")</summary>"
             "<table><tr><th>Tool / bash intent</th><th>Category</th><th>Calls</th></tr>"
             + map_rows + "</table>"
             "<div class='s'>bash intents classified by command keywords "
             "(DB &gt; versioning &gt; container &gt; build &gt; net &gt; structural "
             "&gt; lexical &gt; read, else meta). "
             "zvec hybrid search counted under lexical search.</div></details>")

    # ---- projects (collapsed) ----
    proj_rows = ""
    for p in projects:
        out_r = p["output"] + p["reasoning"]
        t = dir_time.get(p["directory"], 0.0)
        proj_rows += ("<tr><td class='mono'>" + esc(p["directory"]) + "</td>"
                      "<td>" + str(p["sessions"]) + "</td>"
                      "<td class='mono'>" + hrs(t) + "</td>"
                      "<td>" + fmt(p["input"]) + "</td>"
                      "<td>" + fmt(out_r) + "</td>"
                      "<td>" + fmt(p["cache_read"]) + "</td>"
                      "<td class='r'>" + money(p["cost"]) + "</td>"
                      "<td>" + hbar(100 * p["cost"] / max_proj, "#7c5cff")
                      + "</td></tr>\n")
    proj_sec = ("<details><summary><b>Cost per project directory</b></summary>"
                "<table><tr><th>Directory</th><th>Sessions</th><th>Time</th>"
                "<th>Input</th><th>Out+reas</th><th>CacheRead</th>"
                "<th style='text-align:right'>Opus 5</th><th></th></tr>"
                + proj_rows + "</table></details>")

    # ---- models (collapsed) ----
    model_rows = ""
    for m in models:
        out_r = m["output"] + m["reasoning"]
        model_rows += ("<tr><td class='mono'>" + esc(m["provider"]) + " / "
                       + esc(m["model"].split("/")[-1]) + "</td>"
                       "<td>" + str(m["messages"]) + "</td>"
                       "<td>" + fmt(m["input"]) + "</td>"
                       "<td>" + fmt(out_r) + "</td>"
                       "<td>" + fmt(m["cache_read"]) + "</td>"
                       "<td class='r'>" + money(m["cost"]) + "</td>"
                       "<td class='r'>" + money(m["actual"]) + "</td></tr>\n")
    model_sec = ("<details><summary><b>Cost per model</b> (Opus-5 equivalent vs "
                 "actually recorded)</summary>"
                 "<table><tr><th>Model</th><th>Msgs</th><th>Input</th>"
                 "<th>Out+reas</th><th>CacheRead</th>"
                 "<th style='text-align:right'>Opus 5</th>"
                 "<th style='text-align:right'>Paid</th></tr>"
                 + model_rows + "</table></details>")

    # ---- per provider (collapsed) ----
    prov_rows = ""
    for p in provider_list:
        out_r = p["output"] + p["reasoning"]
        prov_rows += ("<tr><td class='mono'>" + esc(p["provider"]) + "</td>"
                      "<td>" + esc(", ".join(p["models"])) + "</td>"
                      "<td>" + str(p["messages"]) + "</td>"
                      "<td>" + fmt(p["input"]) + "</td>"
                      "<td>" + fmt(out_r) + "</td>"
                      "<td>" + fmt(p["cache_read"]) + "</td>"
                      "<td class='r'>" + money(p["cost"]) + "</td>"
                      "<td class='r'>" + money(p["actual"]) + "</td></tr>\n")
    prov_sec = ("<details><summary><b>Cost per provider</b> (all message traffic "
                "rolled up by provider)</summary>"
                "<table><tr><th>Provider</th><th>Models</th><th>Msgs</th>"
                "<th>Input</th><th>Out+reas</th><th>CacheRead</th>"
                "<th style='text-align:right'>Opus 5</th>"
                "<th style='text-align:right'>Paid</th></tr>"
                + prov_rows + "</table>"
                "<div class='s'>Costs priced at Opus-5 rates on each provider's "
                "traffic; Paid is what the provider recorded (free tiers = $0). "
                "The nvidia/z-ai GLM-5.3-Flash traffic is the post-free-quota "
                "switch.</div></details>")

    # ---- reliability + efficiency (per provider) ----
    prov_rel_rows = ""
    for e in prov_rel:
        erate = (100.0 * e["errors"] / e["calls"]) if e.get("calls") else 0.0
        prov_rel_rows += ("<tr><td class='mono'>" + esc(e["provider"]) + "</td>"
                          "<td>" + format(e["msgs"], ",d") + "</td>"
                          "<td>" + format(e.get("calls", 0), ",d") + "</td>"
                          "<td class='r'>" + str(e.get("errors", 0)) + "</td>"
                          "<td class='r'>%.1f%%</td>" % erate
                          + "<td class='r'>%.1fs</td>" % e["p50"]
                          + "<td class='r'>%.0fs</td>" % e["p95"]
                          + "<td class='r'>%.0f</td></tr>\n" % e["tps_p50"])
    lat_sum = ""
    if latency:
        lat_sum = ("<div class='s'>All providers: turn p50 %.0fs &middot; p95 %.0fs "
                   "&middot; %.0f tok/s p50 &middot; %.0f min total across "
                   + format(latency["msgs"], ",d") + " turns</div>") % (
            latency["p50"], latency["p95"], latency["tps_p50"],
            latency["total_min"])
    err_rows = ""
    for tool, n in errors_by_tool:
        err_rows += ("<tr><td class='mono'>" + esc(tool) + "</td>"
                     "<td>" + str(n) + "</td></tr>\n")
    rel = ("<h2>Reliability & efficiency &mdash; per provider</h2>"
           "<table><tr><th>Provider</th><th>Turns</th><th>Tool calls</th>"
           "<th style='text-align:right'>Err</th>"
           "<th style='text-align:right'>Err rate</th>"
           "<th style='text-align:right'>p50 turn</th>"
           "<th style='text-align:right'>p95 turn</th>"
           "<th style='text-align:right'>tok/s p50</th></tr>"
           + prov_rel_rows + "</table>" + lat_sum +
           "<details><summary>Tool errors &middot; by tool ("
           + str(calls_err) + " of " + format(calls_total, ",d") + " calls, "
           + "%.1f%%)</summary>" % err_rate
           + "<table class='rates'><tr><th>Tool</th><th>Errors</th></tr>"
           + err_rows + "</table>"
           "<div class='s'>Spikes usually mean a broken environment, not a bad "
           "model. Tool calls join to their message's provider, so a session "
           "that switched providers splits across rows.</div></details>")

    notes = ("<details><summary><b>Methodology</b></summary>"
             "<p class='note'>Source: <span class='mono'>"
             "~/.local/share/opencode/opencode.db</span> (session counters; "
             "message token JSON; part tool calls), read-only. "
             "Rates (Sep 2026): Opus 5 standard $5/$25 + $0.50 cache read, "
             "$6.25 cache write; GPT-5.6 Sol promo $4/$20 + $0.40 read, $5.00 "
             "write (list $5/$30 + $0.50/$6.25, promo ~Nov 21); GLM-5.3 "
             "$1.40/$4.40 + $0.26 read via Z.ai (cache-write unpublished). "
             "Top-20 comparison + pricing scraped from artificialanalysis.ai "
             "on 2026-09-14 (refresh via the usage-dashboard skill). "
             "Reasoning billed as output everywhere. "
             "Regenerates daily 08:00 via launchd "
             "(<span class='mono'>ai.opencode.usage-dashboard</span>) and on login; "
             "manual: <span class='mono'>python3 "
             "~/.opencode/usage-dashboard/generate.py</span></p></details>")

    gen = esc(now.strftime("%Y-%m-%d %H:%M %Z"))
    doc = ["""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>opencode usage &mdash; Opus 5 equivalent</title>
<style>
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1c1c1e;--border:#d4d4d8;
--soft:rgba(127,127,127,.07);--line:rgba(127,127,127,.25)}
:root[data-theme="dark"]{--bg:#161617;--fg:#f4f4f5;--border:#3f3f46}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161617;--fg:#f4f4f5;--border:#3f3f46}}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
margin:0 auto;padding:28px 24px 60px;max-width:1060px;line-height:1.45;
background:var(--bg);color:var(--fg)}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
#theme{flex:none;font:inherit;font-size:12px;color:var(--fg);background:var(--soft);
border:1px solid var(--border);border-radius:99px;padding:6px 14px;cursor:pointer}
.cmpsel{font:inherit;font-size:14px;color:var(--fg);background:var(--bg);
border:1px solid var(--border);border-radius:8px;padding:8px 10px;width:100%;
margin-bottom:8px;cursor:pointer}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:#888;margin-bottom:22px;font-size:13px}
h2{font-size:15px;margin:30px 0 10px;letter-spacing:.01em;text-transform:uppercase;
font-size:12px;color:#888}
.hero{display:grid;grid-template-columns:1.4fr 1.2fr 1fr 1fr;gap:12px;margin-bottom:8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
@media(max-width:760px){.hero{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}
.card{border:1px solid var(--border);border-radius:14px;padding:16px 18px;
background:var(--soft)}
.card .k{font-size:12px;color:#888;margin-bottom:4px}
.card .v{font-size:26px;font-weight:700;letter-spacing:-.02em}
.card.big .v{font-size:34px}
.card .v.ok{color:#16a34a}
.card .s{font-size:12px;color:#888;margin-top:4px}
table{border-collapse:collapse;width:100%;margin:6px 0 10px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);font-size:13px}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}
table.rates td{padding:5px 0;border:0;font-size:13px}
.bar{display:inline-block;width:150px;max-width:30vw;height:8px;background:var(--line);
border-radius:4px;overflow:hidden;vertical-align:middle}
.fill{display:block;height:100%}
.hist{display:flex;align-items:flex-end;gap:8px;min-height:160px;border:1px solid var(--border);
border-radius:14px;padding:16px 12px 10px;overflow-x:auto;background:var(--soft)}
.hcol{flex:1;min-width:58px;text-align:center}
.hval{font-size:11px;font-variant-numeric:tabular-nums}
.htrack{height:92px;display:flex;align-items:flex-end;justify-content:center}
.hfill{width:28px;background:linear-gradient(180deg,#9d8cff,#7c5cff);border-radius:5px 5px 0 0;min-height:3px}
.hdate{font-size:11px;color:#888}
.heatstrip{display:flex;align-items:flex-end;gap:6px;height:110px;border:1px solid var(--border);
border-radius:14px;padding:14px 12px 10px;background:var(--soft)}
.hcell2{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
.hfill2{width:100%;background:#ff9500;border-radius:4px 4px 0 0}
.hlab{font-size:10px;color:#888;margin-top:4px}
.ok-flag{color:#16a34a;font-weight:700}
.bad-flag{color:#dc2626;font-weight:700}
.pill{display:inline-block;font-size:11px;border:1px solid var(--border);border-radius:99px;
padding:2px 10px;margin-left:8px;color:inherit;vertical-align:middle;text-transform:none;letter-spacing:0}
details{border:1px solid var(--border);border-radius:14px;padding:12px 16px;margin:14px 0;background:var(--soft)}
summary{cursor:pointer;font-size:13px}
.s{font-size:12px;color:#888;margin:2px 0 8px}
.note{font-size:12px;color:#888}
b{font-weight:650}
</style></head><body>
<div class="top"><div><h1>Usage &mdash; Opus 5 equivalent</h1>
<div class="sub">Generated """, gen, """ &middot; opencode &middot; refreshes daily 08:00</div>
</div><button id="theme" type="button">Theme: System</button></div>
""", hero, pricing, compare, trend, perday, tools, proj_sec, model_sec,
             prov_sec, rel, session_sec, effort, hours_sec, landing, notes,
             """<script>
var cmpData=JSON.parse(document.getElementById("cmp-data").textContent);
(function(){var s=document.getElementById("cmpsel"),c=document.getElementById("cmpcard");
function cw(pcw){return pcw?("$"+pcw.toFixed(2)+" / 1M"):"n/a";}
function show(i){var o=cmpData.opts[i];if(!o){return;}
var meta=(o.aa?("AA #"+o.aa+" &middot; $"+o.cpt.toFixed(2)+"/task"):"")+
(o.in_use?(" &middot; <span class='ok-flag'>in use (free)</span>"):"");
c.innerHTML="<div class='v'>"+o.cost.toLocaleString("en-US",{style:"currency",currency:"USD"})+
"</div><table class='rates'>"+
"<tr><td>Input</td><td class='r'>$"+o.pin.toFixed(2)+" / 1M</td></tr>"+
"<tr><td>Output</td><td class='r'>$"+o.pout.toFixed(2)+" / 1M</td></tr>"+
"<tr><td>Cache read</td><td class='r'>$"+o.pcr.toFixed(2)+" / 1M</td></tr>"+
"<tr><td>Cache write</td><td class='r'>"+cw(o.pcw)+"</td></tr></table>"+
"<div class='s'>Your token mix priced at these rates. "+meta+"</div>";}
var cur="0";try{cur=localStorage.getItem("ocud-cmp")||"0";}catch(e){}
if(!cmpData.opts[+cur]){cur="0";}
s.value=cur;show(+cur);
s.onchange=function(){try{localStorage.setItem("ocud-cmp",s.value);}catch(e){}show(+s.value);};
})();
(function(){var k="ocud-theme",h=document.documentElement,b=document.getElementById("theme");
var order=["auto","light","dark"],label={auto:"Theme: System",light:"Theme: Light",dark:"Theme: Dark"};
function show(t){b.textContent=label[t]||label.auto;}
function apply(t){if(t==="light"||t==="dark"){h.setAttribute("data-theme",t);}else{h.removeAttribute("data-theme");}show(t||"auto");}
var cur="auto";try{cur=localStorage.getItem(k)||"auto";}catch(e){}
if(order.indexOf(cur)<0){cur="auto";}
apply(cur);
b.onclick=function(){cur=order[(order.indexOf(cur)+1)%order.length];
try{localStorage.setItem(k,cur);}catch(e){}apply(cur);};
})();
</script></body></html>"""]
    return "".join(doc)


if __name__ == "__main__":
    main()
