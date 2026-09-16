#!/usr/bin/env python3
"""opencode usage dashboard generator (stdlib only, python3.9+ compatible).

Reads ~/.local/share/opencode/opencode.db read-only, prices usage at
Claude Opus 5 standard rates, appends a daily snapshot to history.jsonl,
and writes data.js + sessions/*.js (JSON payloads loaded by the Svelte
templates in app/src; no HTML is generated here).

Usage:  python3 generate.py   (safe to run any time; idempotent per day)
"""
import datetime
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
DATA_JS = OUT_DIR / "data.js"
SESS_DIR = OUT_DIR / "sessions"

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
              "Write", "Delegate", "Skill", "Interaction", "Web",
              "Wait/idle", "Meta/tooling"]

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
    ("Wait/idle", ["^\\s*sleep\\b"]),
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


# --- per-session metrics (top N by cost). Improvement tips live in the
# Svelte templates (app/src/lib/tips.js); Python emits raw numbers only. ---
SESS_TOP_N = 20
GAP_MIN = 15        # idle gap between user turns (minutes)
AFTER_ERR_S = 120   # user re-prompt within Ns of a tool error
TL_MAX = 60         # cap turn-timeline rows per session file


def med(vals):
    s = sorted(vals)
    return s[len(s) // 2] if s else 0.0


def collect_session_metrics(cur, ids):
    """Per-session effectiveness/efficiency metrics (raw numbers only).

    Returns {session_id: q}. The Svelte session template formats these and
    derives improvement tips (app/src/lib/tips.js).
    """
    q = {}
    if not ids:
        return q
    ph = ",".join(["?"] * len(ids))

    amsgs = {}
    cur.execute(
        """SELECT session_id, json_extract(data,'$.time.created'),
        json_extract(data,'$.time.completed'),
        CAST(json_extract(data,'$.tokens.output') AS INTEGER),
        CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER),
        json_extract(data,'$.variant'), json_extract(data,'$.providerID'),
        json_extract(data,'$.finish')
        FROM message WHERE session_id IN (""" + ph + """)
        AND json_extract(data,'$.role')='assistant'
        ORDER BY session_id, time_created""", ids)
    for sid, tc, td, out, reas, var, prov, fin in cur.fetchall():
        amsgs.setdefault(sid, []).append(
            {"ts": tc or 0, "te": td or 0, "out": out or 0,
             "reas": reas or 0, "var": var or "unset",
             "prov": prov or "?", "fin": fin})

    umsgs = {}
    cur.execute(
        """SELECT id, session_id,
        CASE WHEN json_extract(data,'$.time.created') IS NOT NULL
             THEN json_extract(data,'$.time.created') ELSE time_created END
        FROM message WHERE session_id IN (""" + ph + """)
        AND json_extract(data,'$.role')='user'
        ORDER BY session_id, 3""", ids)
    for mid, sid, ts in cur.fetchall():
        umsgs.setdefault(sid, []).append({"mid": mid, "ts": ts or 0})

    utext = {}  # (sid, mid) -> user text parts in time order
    cur.execute(
        """SELECT m.session_id, m.id, json_extract(p.data,'$.text')
        FROM message m JOIN part p ON p.message_id = m.id
        WHERE m.session_id IN (""" + ph + """)
        AND json_extract(m.data,'$.role')='user'
        AND json_extract(p.data,'$.type')='text'
        ORDER BY m.session_id, p.time_created""", ids)
    for sid, mid, tx in cur.fetchall():
        if tx:
            utext.setdefault((sid, mid), []).append(tx)

    def excerpt(parts, limit=140):
        s = re.sub(r"\s+", " ", " ".join(parts)).strip()
        return s[:limit]

    prompt_chars = {k: sum(len(t) for t in v) for k, v in utext.items()}

    tools = {}
    cur.execute(
        """SELECT session_id, time_created, json_extract(data,'$.tool'),
        json_extract(data,'$.state.status')
        FROM part WHERE session_id IN (""" + ph + """)
        AND json_extract(data,'$.type')='tool'
        ORDER BY session_id, time_created""", ids)
    for sid, ts, tool, st in cur.fetchall():
        tools.setdefault(sid, []).append(
            {"ts": ts or 0, "tool": tool or "?",
             "err": (st == "error")})

    patch_files = {}
    cur.execute(
        """SELECT session_id, json_extract(data,'$.files') FROM part
        WHERE session_id IN (""" + ph + """)
        AND json_extract(data,'$.type')='patch'""", ids)
    for sid, files_json in cur.fetchall():
        try:
            files = json.loads(files_json) if files_json else []
        except ValueError:
            files = []
        s = patch_files.setdefault(sid, set())
        for f in files:
            s.add(f)

    patch_evts = {}  # sid -> [(ts, [files])] for per-turn edit attribution
    cur.execute(
        """SELECT session_id, time_created, json_extract(data,'$.files')
        FROM part WHERE session_id IN (""" + ph + """)
        AND json_extract(data,'$.type')='patch'""", ids)
    for sid, ts, files_json in cur.fetchall():
        try:
            files = json.loads(files_json) if files_json else []
        except ValueError:
            files = []
        patch_evts.setdefault(sid, []).append((ts or 0, files))

    # --- tool time per category (start->end per call; bash by intent) ---
    cat_ms = {}  # sid -> {cat: [ms, calls]}
    cur.execute(
        """SELECT session_id, json_extract(data,'$.tool'),
        json_extract(data,'$.state.input.command'),
        json_extract(data,'$.state.time.start'),
        json_extract(data,'$.state.time.end')
        FROM part WHERE session_id IN (""" + ph + """)
        AND json_extract(data,'$.type')='tool'""", ids)
    for sid, tool, cmd, ts, te in cur.fetchall():
        if (tool or "") == "bash":
            cat = classify_bash(cmd or "")
        else:
            cat = classify_tool(tool or "")
        e = cat_ms.setdefault(sid, {}).setdefault(cat, [0, 0])
        e[1] += 1
        if ts and te and te > ts:
            e[0] += te - ts

    for sid in ids:
        a = amsgs.get(sid, [])
        u = umsgs.get(sid, [])
        t = tools.get(sid, [])

        calls = len(t)
        errors = sum(1 for e in t if e["err"])
        err_rate = (errors / calls) if calls else None
        eb_tool = {}
        for e in t:
            if e["err"]:
                eb_tool[e["tool"]] = eb_tool.get(e["tool"], 0) + 1
        err_by_tool = sorted(eb_tool.items(), key=lambda kv: -kv[1])
        streak = ("", 0)  # worst run of consecutive same-tool errors
        run_tool, run_n = "", 0
        for e in t:
            if e["err"] and (not run_tool or e["tool"] == run_tool):
                run_tool = e["tool"]
                run_n += 1
                if run_n > streak[1]:
                    streak = (run_tool, run_n)
            else:
                run_tool = e["tool"] if e["err"] else ""
                run_n = 1 if e["err"] else 0

        err_ts = sorted(e["ts"] for e in t if e["err"])
        after_err = 0
        for i in range(1, len(u)):
            prev, now = u[i - 1]["ts"], u[i]["ts"]
            if any(prev < x <= now and x <= now and
                   (now - x) <= AFTER_ERR_S * 1000 for x in err_ts):
                after_err += 1
        gaps, gap_ms = 0, 0
        for i in range(1, len(u)):
            g = u[i]["ts"] - u[i - 1]["ts"]
            if g > GAP_MIN * 60000:
                gaps += 1
                gap_ms += g

        asst_dur = [max(0.0, (m["te"] - m["ts"]) / 1000.0)
                    for m in a if m["te"] and m["ts"]]
        active_s = sum(asst_dur)
        out_tot = sum(m["out"] + m["reas"] for m in a)
        reas_tot = sum(m["reas"] for m in a)
        reason_share = (reas_tot / out_tot) if out_tot else None
        tps_num = sum(m["out"] + m["reas"] for m in a
                      if m["te"] > m["ts"])
        tps_den = sum((m["te"] - m["ts"]) / 1000.0 for m in a
                      if m["te"] > m["ts"])
        tps = (tps_num / tps_den) if tps_den else None
        var_c = {}
        provs = set()
        for m in a:
            var_c[m["var"]] = var_c.get(m["var"], 0) + 1
            provs.add(m["prov"])
        variants = sorted(var_c.items(), key=lambda kv: -kv[1])
        last_fin = a[-1]["fin"] if a else None
        msgs_per_turn = (len(a) / len(u)) if u else None
        first_prompt = (prompt_chars.get((sid, u[0]["mid"]), 0)
                        if u else 0)

        stamps = [x["ts"] for x in u] + [m["ts"] for m in a] \
            + [e["ts"] for e in t]
        stamps = [x for x in stamps if x]
        wall_s = ((max(stamps) - min(stamps)) / 1000.0) if len(stamps) > 1 \
            else 0.0
        idle_pct = ((wall_s - active_s) / wall_s * 100.0) if wall_s > 0 \
            else None

        # --- turn timeline: each user msg starts a turn ---
        tl = []
        interrupted = 0
        for i, um in enumerate(u):
            lo = um["ts"]
            hi = u[i + 1]["ts"] if i + 1 < len(u) else (
                max(stamps) if stamps else lo)
            ma = [m for m in a if lo <= m["ts"] < hi or
                  (i + 1 == len(u) and m["ts"] >= lo)]
            mt = [e for e in t if lo <= e["ts"] < hi or
                  (i + 1 == len(u) and e["ts"] >= lo)]
            last_te = max([m["te"] for m in ma if m["te"]] or [0])
            # no stop in window + next prompt arrived before the agent
            # finished = the user cut the turn short
            cut = bool(ma) and not any(m["fin"] == "stop" for m in ma) \
                and i + 1 < len(u) and last_te \
                and u[i + 1]["ts"] < last_te
            if cut:
                interrupted += 1
            pfiles = set()
            for pts, pf in patch_evts.get(sid, []):
                if lo <= pts < hi or (i + 1 == len(u) and pts >= lo):
                    pfiles.update(pf)
            n_err = sum(1 for e in mt if e["err"])
            if not ma and not mt:
                outcome, tsum = "queued", "queued"
            else:
                mix, emix = {}, {}
                for e in mt:
                    mix[e["tool"]] = mix.get(e["tool"], 0) + 1
                    if e["err"]:
                        emix[e["tool"]] = emix.get(e["tool"], 0) + 1
                if cut:
                    outcome = "cut short"
                elif pfiles:
                    outcome = "edited"
                elif n_err >= 3 or \
                        (n_err and n_err / max(len(mt), 1) >= 0.5):
                    outcome = "stuck"
                elif mt:
                    outcome = "explored"
                else:
                    outcome = "answered"
                if not mt:
                    tsum = "answered directly"
                else:
                    top = sorted(mix.items(), key=lambda kv: -kv[1])
                    tsum = ", ".join("%s×%d" % (tn, n)
                                     for tn, n in top[:3])
                    if len(top) > 3:
                        tsum += " +%d more" % (len(top) - 3)
                    if pfiles:
                        if len(pfiles) == 1:
                            tsum += (" · edited "
                                     + next(iter(pfiles)).rsplit("/", 1)[-1])
                        else:
                            tsum += " · edited %d files" % len(pfiles)
                    if emix:
                        et = max(emix.items(), key=lambda kv: kv[1])[0]
                        tsum += (" · %d error%s (%s)"
                                 % (n_err,
                                    "" if n_err == 1 else "s", et))
            tl.append({
                "start": lo, "pex": excerpt(utext.get((sid, um["mid"]), [])),
                "sum": tsum, "outcome": outcome,
                "asst": len(ma), "calls": len(mt), "err": n_err,
                "out": sum(m["out"] + m["reas"] for m in ma),
                "active": sum(max(0.0, (m["te"] - m["ts"]) / 1000.0)
                              for m in ma if m["te"] and m["ts"]),
                "var": ma[-1]["var"] if ma else None})

        cm = cat_ms.get(sid, {})
        tool_cats = [{"cat": c, "ms": cm[c][0], "calls": cm[c][1]}
                     for c in cm]
        tool_cats.sort(key=lambda r: -r["ms"])

        q[sid] = {
            "turns": len(u), "asst": len(a), "calls": calls,
            "errors": errors, "err_rate": err_rate,
            "err_by_tool": err_by_tool, "streak": streak,
            "interrupted": interrupted,
            "gaps": gaps, "after_err": after_err,
            "first_prompt": first_prompt,
            "active_min": active_s / 60.0, "idle_pct": idle_pct,
            "wall_min": wall_s / 60.0,
            "turn_p50": med(asst_dur), "tps": tps,
            "reason_share": reason_share, "out_tot": out_tot,
            "variants": variants, "providers": sorted(provs),
            "msgs_per_turn": msgs_per_turn, "last_fin": last_fin,
            "files": len(patch_files.get(sid, set())),
            "tool_cats": tool_cats,
            "tool_ms": sum(r["ms"] for r in tool_cats),
            "tl": tl[:TL_MAX], "tl_truncated": len(tl) > TL_MAX,
        }
    return q


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
    cur.execute("""SELECT date(time_created/1000,'unixepoch','localtime'), count(*),
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
        s.tokens_cache_write, s.title, s.summary_additions, s.summary_deletions,
        s.summary_files, s.agent, s.model,
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
        sid, directory, tc, tu, i, o, reas, cr, cw, title, sadd, sdel, \
            sfiles, agent, smodel = r[:15]
        rest = r[15:]
        msgs, calls, errs, nvar = rest[0], rest[1], rest[2], rest[3]
        sd = {"id": sid, "directory": directory, "msgs": msgs, "calls": calls,
              "errors": errs, "input": i, "output": o, "reasoning": reas,
              "cache_read": cr, "cache_write": cw, "variants": nvar,
              "title": title or "", "add": sadd or 0, "delete": sdel or 0,
              "sum_files": sfiles or 0, "agent": agent or "",
              "model": smodel or ""}
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

    # --- per-session metrics (top N by cost): effectiveness/efficiency ---
    sess_q = collect_session_metrics(
        cur, [s["id"] for s in session_rows_data[:SESS_TOP_N]])
    for sd in session_rows_data:
        sd["q"] = sess_q.get(sd["id"])

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

    # --- history (one snapshot per day = that day's usage; frozen at day end) ---
    today = now.strftime("%Y-%m-%d")

    def day_snapshot(d, backfilled=False):
        rec = {"date": d["day"],
               "generated": now.isoformat(timespec="seconds"),
               "sessions": d["sessions"],
               "input": d["input"], "output": d["output"],
               "reasoning": d["reasoning"], "cache_read": d["cache_read"],
               "cache_write": d["cache_write"],
               "opus5_total": round(d["cost"], 2)}
        if backfilled:
            rec["backfilled"] = True
        return rec

    hist = []
    if HISTORY.exists():
        for line in HISTORY.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    hist.append(json.loads(line))
                except ValueError:
                    pass
    known = {h.get("date") for h in hist}
    # backfill days the DB knows about that have no frozen snapshot yet
    for d in days:
        if d["day"] not in known:
            hist.append(day_snapshot(d, backfilled=True))
    # today's bar: that day's usage, refreshed on every run
    hist = [h for h in hist if h.get("date") != today]
    today_row = next((d for d in days if d["day"] == today), None)
    hist.append(day_snapshot(today_row if today_row else
                             {"day": today, "sessions": 0, "input": 0,
                              "output": 0, "reasoning": 0, "cache_read": 0,
                              "cache_write": 0, "cost": 0.0}))
    hist = sorted(hist, key=lambda h: h.get("date") or "")
    hist = hist[-365:]
    HISTORY.write_text("\n".join([json.dumps(h) for h in hist]) + "\n")

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

    # --- comparison families (same rates -> same cost) for the dropdown ---
    fams = []
    seen = set()
    for e in equiv:
        m = e["model"]
        key = (m["pin"], m["pout"], m["pcr"], m["pcw"])
        if key in seen:
            continue
        seen.add(key)
        fams.append(e)

    def fmt_dt(ms):
        if not ms:
            return "–"
        return datetime.datetime.fromtimestamp(ms / 1000.0).strftime(
            "%m-%d %H:%M")

    err_rate = (100.0 * calls_err / calls_total) if calls_total else 0.0
    max_hist = max([h["opus5_total"] for h in hist] + [1])
    peak = max(days, key=lambda d: d["cost"]) if days else None

    payload = {
        "generated": now.strftime("%Y-%m-%d %H:%M %Z"),
        "hero": {
            "opus5": total_cost["total"], "sessions": total["sessions"],
            "messages": total["messages"], "actual": actual,
            "prov": primary["provider"],
            "model": short_model(primary["model"]),
            "avoided": total_cost["total"] - actual,
            "cache_hit": cache_hit, "cache_read": total["cache_read"],
            "cache_in": total["input"] + total["cache_read"],
            "err_rate": err_rate, "calls_err": calls_err,
            "calls_total": calls_total, "overall_min": overall_min,
            "sum_min": sum_min,
        },
        "compare_opts": [{
            "name": short_model_name(e["model"]["name"]),
            "aa": e["model"]["aa"], "cpt": e["model"]["cpt"],
            "in_use": bool(e["model"].get("in_use")),
            "pin": e["model"]["pin"], "pout": e["model"]["pout"],
            "pcr": e["model"]["pcr"], "pcw": e["model"]["pcw"],
            "cost": round(e["cost"]["total"], 2)} for e in fams],
        "top20": [{
            "name": e["model"]["name"], "creator": e["model"]["creator"],
            "aa": e["model"]["aa"], "cpt": e["model"]["cpt"],
            "pin": e["model"]["pin"], "pout": e["model"]["pout"],
            "pcr": e["model"]["pcr"], "pcw": e["model"]["pcw"],
            "cost": round(e["cost"]["total"], 2),
            "in_use": bool(e["model"].get("in_use"))} for e in equiv],
        "hist": [{"date": h["date"], "opus5": h["opus5_total"]}
                 for h in hist],
        "max_hist": max_hist,
        "peak": ({"day": peak["day"], "cost": peak["cost"]}
                 if peak is not None else None),
        "perday": [{
            "day": d["day"], "sessions": d["sessions"],
            "tokens": d["input"] + d["output"] + d["reasoning"]
                      + d["cache_read"] + d["cache_write"],
            "cost": d["cost"]} for d in days],
        "cats": [{"cat": c, "n": n} for c, n in cat_counts.items() if n],
        "mapping": [{"tool": t, "cat": c, "n": n}
                    for t, c, n in mapping],
        "total_calls": total_calls,
        "projects": [{
            "dir": p["directory"], "sessions": p["sessions"],
            "mins": dir_time.get(p["directory"], 0.0),
            "input": p["input"], "out_r": p["output"] + p["reasoning"],
            "cache_read": p["cache_read"], "cost": p["cost"]}
            for p in projects],
        "models": [{
            "name": m["provider"] + " / " + short_model(m["model"]),
            "msgs": m["messages"], "input": m["input"],
            "out_r": m["output"] + m["reasoning"],
            "cache_read": m["cache_read"], "cost": m["cost"],
            "actual": m["actual"]} for m in models],
        "providers": [{
            "provider": p["provider"], "models": p["models"],
            "msgs": p["messages"], "input": p["input"],
            "out_r": p["output"] + p["reasoning"],
            "cache_read": p["cache_read"], "cost": p["cost"],
            "actual": p["actual"]} for p in provider_list],
        "prov_rel": [{
            "provider": e["provider"], "msgs": e["msgs"],
            "calls": e.get("calls", 0), "errors": e.get("errors", 0),
            "p50": e["p50"], "p95": e["p95"], "tps": e["tps_p50"],
            "total_min": e["total_min"]} for e in prov_rel],
        "latency": (({
            "msgs": latency["msgs"], "p50": latency["p50"],
            "p95": latency["p95"], "tps": latency["tps_p50"],
            "total_min": latency["total_min"]} if latency is not None
            else None)),
        "calls_err": calls_err,
        "errors_by_tool": [{"tool": t, "n": n} for t, n in errors_by_tool],
        "sessions": [{
            "id8": s["id"][-8:], "title": s["title"],
            "project": s["directory"].rstrip("/").split("/")[-1],
            "start": fmt_dt(s.get("first")), "end": fmt_dt(s.get("last")),
            "dur_min": s["dur_min"], "msgs": s["msgs"],
            "in_cache": s["input"] + s["cache_read"],
            "out_r": s["output"] + s["reasoning"], "cost": s["cost"],
            "calls": s["calls"],
            "errors": s["errors"] if s["calls"] else None,
            "landed": s["landed"]}
            for s in session_rows_data[:SESS_TOP_N]],
        "variants": [{
            "name": name, "msgs": n, "out": out_tok + reas_tok}
            for name, n, out_tok, reas_tok in variants],
        "hours": [{
            "h": hh, "sessions": hours[hh]["sessions"],
            "tokens": hours[hh]["input"] + hours[hh]["cache_read"]
                      + hours[hh]["output"] + hours[hh]["reasoning"]}
            for hh in range(24)],
        "landing": ({"landed": n_landed, "checkable": n_checkable,
                     "total": len(session_rows_data)}
                    if n_checkable else None),
    }
    DATA_JS.write_text("window.__OCUD__ = " + json.dumps(payload) + ";\n")

    SESS_DIR.mkdir(exist_ok=True)
    keep = set()
    for s in session_rows_data[:SESS_TOP_N]:
        if not s.get("q"):
            continue
        name = s["id"][-8:] + ".js"
        keep.add(name)
        (SESS_DIR / name).write_text(
            "window.__OCUD_SESSION__ = "
            + json.dumps(build_session_payload(s)) + ";\n")
    for old in SESS_DIR.glob("*.js"):
        if old.name not in keep:
            old.unlink()

    size_kb = DATA_JS.stat().st_size / 1024
    print("wrote " + str(DATA_JS) + " (%.1f KB) + %d session files, "
          "sessions=%d opus5=$%.2f actual=$%.4f"
          % (size_kb, len(keep), total["sessions"], total_cost["total"],
             actual))


def short_model(model_id):
    return (model_id or "?").split("/")[-1]


def short_model_name(name):
    return re.sub(r"\s*\(.*$", "", name or "?")


def build_session_payload(s):
    """JSON-serializable payload for sessions/<id8>.js (raw numbers only)."""
    q = s.get("q") or {}
    inc = s["input"] + s["cache_read"]
    outr = s["output"] + s["reasoning"]
    streak = q.get("streak", ("", 0))
    return {
        "id8": s["id"][-8:], "id": s["id"], "title": s["title"],
        "project": s["directory"].rstrip("/").split("/")[-1],
        "dir": s["directory"],
        "start_ms": s.get("first"), "end_ms": s.get("last"),
        "cost": s["cost"], "in_cache": inc, "out_r": outr,
        "cache_hit": (s["cache_read"] / inc) if inc else None,
        "landed": s["landed"], "add": s["add"], "del": s["delete"],
        "files_patched": q.get("files", 0),
        "calls": q.get("calls", 0), "errors": q.get("errors", 0),
        "err_by_tool": [{"tool": t, "n": n}
                        for t, n in q.get("err_by_tool", [])],
        "streak": ({"tool": streak[0], "n": streak[1]}
                   if streak[1] else None),
        "turns": q.get("turns", 0), "asst": q.get("asst", 0),
        "msgs_per_turn": q.get("msgs_per_turn"),
        "interrupted": q.get("interrupted", 0),
        "first_prompt": q.get("first_prompt", 0),
        "after_err": q.get("after_err", 0), "gaps": q.get("gaps", 0),
        "wall_min": q.get("wall_min", 0),
        "active_min": q.get("active_min", 0),
        "idle_pct": q.get("idle_pct"),
        "turn_p50": q.get("turn_p50", 0), "tps": q.get("tps"),
        "reason_share": q.get("reason_share"),
        "out_tot": q.get("out_tot", 0),
        "variants": [{"v": v, "n": n} for v, n in q.get("variants", [])],
        "providers": q.get("providers", []),
        "last_fin": q.get("last_fin"),
        "tool_cats": q.get("tool_cats", []),
        "tool_ms": q.get("tool_ms", 0),
        "tl": [{
            "start_ms": tr["start"], "pex": tr["pex"], "sum": tr["sum"],
            "outcome": tr["outcome"],
            "asst": tr["asst"], "calls": tr["calls"], "err": tr["err"],
            "out": tr["out"], "active_s": tr["active"]} for tr in q.get("tl", [])],
        "tl_truncated": q.get("tl_truncated", False),
    }

if __name__ == "__main__":
    main()
