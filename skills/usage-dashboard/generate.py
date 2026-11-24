#!/usr/bin/env python3
"""opencode usage dashboard generator (stdlib only, python3.9+ compatible).

Reads ~/.local/share/opencode/opencode.db read-only, prices usage at
Claude Opus 5.5 standard rates, appends a daily snapshot to history.jsonl,
and writes data.js + sessions/*.js (JSON payloads loaded by the Svelte
templates in app/src; no HTML is generated here).

Usage:  python3 generate.py   (safe to run any time; idempotent per day)
"""
import datetime
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys

# Test hook: point HOME at a sandbox (fixture DB + output) instead of ~.
# Usage: OCUD_HOME=/tmp/fakehome python3 generate.py
_home = os.environ.get("OCUD_HOME")
HOME = pathlib.Path(_home) if _home else pathlib.Path.home()
DB = HOME / ".local/share/opencode/opencode.db"
LOG_FILE = DB.parent / "log" / "opencode.log"  # next to the DB (follows OCUD_HOME)
OUT_DIR = HOME / ".opencode/usage-dashboard"
HISTORY = OUT_DIR / "history.jsonl"
DATA_JS = OUT_DIR / "data.js"
SESS_DIR = OUT_DIR / "sessions"
# Go plan-window snapshot written by scripts/go_quota.mjs (absent = unknown).
QUOTA_FILE = OUT_DIR / "quota.json"
# Provider credit snapshot written by scripts/provider_credits.mjs.
CREDITS_FILE = OUT_DIR / "credits.json"
# Live Go allowance snapshot kept fresh by plugins/cost-tracker.js (schema 4,
# console-anchored account-wide request counts; absent = unknown).
SR_LIVE_FILE = DB.parent / "sr-live.json"

# OpenCode Go reference (atomicbot.ai/blog/opencode-go, checked 2026-11-02,
# re-verified 2026-11-22): per-1M token prices (input, output, cached read)
# for the published models, and per-model dollar allowances (monthly,
# per-5h, per-week) from the blog's limit tiers. Mirrors dashboard.mjs GO.
# Recorded per-message costs in opencode.db match these prices to the 4th
# decimal on GLM-5.3-Flash, Muse Spark 1.3 Contributor, DeepSeek V4.1 Flash
# (off-peak) and MiMo-V2.6-Pro — so this table prices the rows whose
# recorded cost was lost in the V2 migration (cost=0 after ~Nov 12).
# Caps: $100 DS V4.1 Flash; $60 GLM-Flash/GLM-5.2/K2.7-Code/MiMo-Flash/
# MiMo-V2.5/MiniMax-M3/Spark-1.3+1.2/Qwen3.7-Plus/LongCat-2.0/Hy3; $30
# Qwen3.8-Flash/Argon/Hy4-preview(+Hy4); $20 MiniMax-M3.1-Flash(+space-bunny
# historic); $15 everything else. Qwen4-Max postdates the blog (tier
# unverified, default $15). Prices marked verify need a Go-console check.
GO_PRICES = {
    "glm-5.3-flash": (0.15, 0.50, 0.03),
    "glm-5.3": (1.40, 4.40, 0.26),
    "glm-5.2": (1.40, 4.40, 0.26),  # blog $60 tier; price = GLM-5.3 list — verify
    "muse-spark-1.3-contributor": (0.10, 0.20, 0.002),
    "muse-spark-1.2-contributor": (0.10, 0.20, 0.002),
    "deepseek-v4.1-flash": (0.15, 0.60, 0.003),
    "deepseek-v4-pro": (0.66, 1.98, 0.022),
    "mimo-v2.6-pro": (0.435, 0.87, 0.003625),
    "mimo-v2.5-pro": (0.435, 0.87, 0.003625),  # blog $15 tier; price = V2.6-Pro — verify
    "mimo-v2.6-flash": (0.14, 0.28, 0.0028),
    "mimo-v2.5": (0.14, 0.28, 0.0028),
    "minimax-m3.1-flash": (0.15, 0.60, 0.015),
    "minimax-m3": (0.30, 1.20, 0.06),  # blog $60 tier (was $15 default)
    "space-bunny": (0.15, 0.60, 0.015),  # historic = M3.1 early build; tier follows $20
    "gpt-6-luna": (0.10, 0.50, 0.01),
    "gpt-5.6-luna": (0.20, 1.20, 0.02),
    "claude-haiku-5.5": (0.10, 0.50, 0.01),
    "kimi-k3.1-pro": (2.00, 10.00, 0.20),
    "kimi-k3": (3.00, 15.00, 0.30),
    "kimi-k2.7-code": (0.95, 4.00, 0.19),  # blog $60 tier (was $15 default)
    "qwen3.8-flash": (0.15, 0.47, 0.016),  # blog $30 tier (was 15)
    "qwen3.7-plus": (0.40, 1.60, 0.04),  # blog $60 tier (was $15 default)
    "qwen3.8-max": (2.00, 6.00, 0.25),
    "qwen4-max": (1.50, 4.50, 0.18),  # postdates blog; price = AA 11-21 — verify
    "gemini-4-argon": (2.00, 10.00, 0.10),  # blog $30 tier (was 60)
    "gemini-4-argon-contributor": (2.00, 10.00, 0.10),  # same tier as argon
    "grok-4.7": (2.00, 6.00, 0.50),  # blog $15 tier; price = AA 10-24 — verify
    "longcat-2.0": (0.30, 1.20, 0.06),  # blog $60 tier; price placeholder — verify
    "hy3": (0.30, 1.20, 0.06),  # blog $60 tier; price placeholder — verify
    "hy4-preview": (0.83, 2.50, 0.08),  # blog $30 tier; price = AA tencent-hy4 — verify
    "hy4": (0.83, 2.50, 0.08),  # tier follows Hy4-preview $30 — verify
    "step-5-preview": (1.00, 2.70, 0.10),  # blog $15 tier (was 60)
}
# (monthly $ allowance, per-5h $, per-week $) — blog limit tiers. None = not
# published in the blog reference (e.g. the Gemini 4 Argon Contributor
# variant's tier is not listed).
GO_ALLOWANCE = {
    "glm-5.3-flash": (60, 12, 30),
    "glm-5.3": (15, 3, 7.5),
    "glm-5.2": (60, 12, 30),
    "muse-spark-1.3-contributor": (60, 12, 30),
    "muse-spark-1.2-contributor": (60, 12, 30),
    "mimo-v2.6-flash": (60, 12, 30),
    "mimo-v2.5": (60, 12, 30),
    "mimo-v2.6-pro": (15, 3, 7.5),
    "mimo-v2.5-pro": (15, 3, 7.5),
    "gemini-4-argon": (30, 6, 15),
    "gemini-4-argon-contributor": (30, 6, 15),
    "kimi-k3.1-pro": (15, 3, 7.5),
    "kimi-k3": (15, 3, 7.5),
    "kimi-k2.7-code": (60, 12, 30),
    "deepseek-v4.1-flash": (100, 20, 50),
    "deepseek-v4-pro": (15, 3, 7.5),
    "minimax-m3.1-flash": (20, 4, 10),
    "minimax-m3": (60, 12, 30),
    "space-bunny": (20, 4, 10),
    "gpt-6-luna": (15, 3, 7.5),
    "gpt-5.6-luna": (15, 3, 7.5),
    "claude-haiku-5.5": (15, 3, 7.5),
    "qwen3.8-flash": (30, 6, 15),
    "qwen3.7-plus": (60, 12, 30),
    "qwen3.8-max": (15, 3, 7.5),
    "qwen4-max": (15, 3, 7.5),
    "grok-4.7": (15, 3, 7.5),
    "longcat-2.0": (60, 12, 30),
    "hy3": (60, 12, 30),
    "hy4-preview": (30, 6, 15),
    "hy4": (30, 6, 15),
    "step-5-preview": (15, 3, 7.5),
}

# Claude Opus 5.5 standard pricing (2026-10-07 rate card; was Opus 5 $5/$25)
PRICE_IN = 4.00 / 1_000_000       # $/token input
PRICE_OUT = 20.00 / 1_000_000     # $/token output (incl. reasoning/thinking)
PRICE_CACHE_READ = 0.20 / 1_000_000   # 95% off input
PRICE_CACHE_WRITE = 5.00 / 1_000_000  # 5-min TTL, 1.25x input

# Top-20 AA leaderboard (scraped 2026-10-19 from artificialanalysis.ai) with
# family token pricing from the model pages (per 1M tokens; cw=5-min write,
# 1.25x input derived where AA doesn't publish it; Sonnet 5.5 from Anthropic's
# official 2026-10-07 rate card as its AA page had no pricing yet).
# Refresh via the usage-dashboard skill (aa_model_info.mjs + aa_snippet.py).
TOP_MODELS = [
    {'name': 'Claude Opus 5.5 (max with fallback)', 'creator': 'Anthropic', 'aa': 58, 'cpt': 5.98,
     'pin': 4, 'pout': 20, 'pcr': 0.2, 'pcw': 5.0},
    {'name': 'Claude Sonnet 5.5 (max with fallback)', 'creator': 'Anthropic', 'aa': 56, 'cpt': 5.46,
     'pin': 2, 'pout': 10, 'pcr': 0.1, 'pcw': 2.5},
    {'name': 'Claude Opus 5.5 (xhigh with fallback)', 'creator': 'Anthropic', 'aa': 56, 'cpt': 3.46,
     'pin': 4, 'pout': 20, 'pcr': 0.2, 'pcw': 5.0},
    {'name': 'Claude Opus 5.5 (high with fallback)', 'creator': 'Anthropic', 'aa': 54, 'cpt': 1.82,
     'pin': 4, 'pout': 20, 'pcr': 0.2, 'pcw': 5.0},
    {'name': 'Claude Fable 5.1 (max with fallback)', 'creator': 'Anthropic', 'aa': 53, 'cpt': 7.63,
     'pin': 10, 'pout': 50, 'pcr': 0.25, 'pcw': 12.5},
    {'name': 'Claude Fable 5.1 (xhigh with fallback)', 'creator': 'Anthropic', 'aa': 53, 'cpt': 5.98,
     'pin': 10, 'pout': 50, 'pcr': 0.25, 'pcw': 12.5},
    {'name': 'GPT-6 Astra (max)', 'creator': 'OpenAI', 'aa': 53, 'cpt': 3.26,
     'pin': 10, 'pout': 50, 'pcr': 1, 'pcw': 12.5},
    {'name': 'Muse Wonder (max)', 'creator': 'Meta', 'aa': 52, 'cpt': 4.52,
     'pin': 4, 'pout': 20, 'pcr': 0.2, 'pcw': 5.0},
    {'name': 'GPT-6 Astra (xhigh)', 'creator': 'OpenAI', 'aa': 52, 'cpt': 2.31,
     'pin': 10, 'pout': 50, 'pcr': 1, 'pcw': 12.5},
    {'name': 'Claude Sonnet 5.5 (xhigh with fallback)', 'creator': 'Anthropic', 'aa': 52, 'cpt': 2.01,
     'pin': 2, 'pout': 10, 'pcr': 0.1, 'pcw': 2.5},
    {'name': 'GPT-6.1 Sol (max)', 'creator': 'OpenAI', 'aa': 52, 'cpt': 0.72,
     'pin': 2, 'pout': 10, 'pcr': 0.1, 'pcw': 2.5},
    {'name': 'Claude Opus 5.5 (medium with fallback)', 'creator': 'Anthropic', 'aa': 51, 'cpt': 1.34,
     'pin': 4, 'pout': 20, 'pcr': 0.2, 'pcw': 5.0},
    {'name': 'Claude Fable 5.1 (high with fallback)', 'creator': 'Anthropic', 'aa': 51, 'cpt': 3.91,
     'pin': 10, 'pout': 50, 'pcr': 0.25, 'pcw': 12.5},
    {'name': 'GPT-6.1 Sol (xhigh)', 'creator': 'OpenAI', 'aa': 51, 'cpt': 0.39,
     'pin': 2, 'pout': 10, 'pcr': 0.1, 'pcw': 2.5},
    {'name': 'GPT-6 Astra (high)', 'creator': 'OpenAI', 'aa': 51, 'cpt': 1.73,
     'pin': 10, 'pout': 50, 'pcr': 1, 'pcw': 12.5},
    {'name': 'GPT-6.1 Sol (high)', 'creator': 'OpenAI', 'aa': 50, 'cpt': 0.32,
     'pin': 2, 'pout': 10, 'pcr': 0.1, 'pcw': 2.5},
    {'name': 'GPT-6 Astra (medium)', 'creator': 'OpenAI', 'aa': 50, 'cpt': 1.54,
     'pin': 10, 'pout': 50, 'pcr': 1, 'pcw': 12.5},
    {'name': 'Claude Fable 5.1 (medium with fallback)', 'creator': 'Anthropic', 'aa': 49, 'cpt': 2.98,
     'pin': 10, 'pout': 50, 'pcr': 0.25, 'pcw': 12.5},
    {'name': 'Muse Spark 1.3 (max)', 'creator': 'Meta', 'aa': 48, 'cpt': 1.6,
     'pin': 1.25, 'pout': 4.25, 'pcr': 0.15, 'pcw': 1.56},
    {'name': 'GPT-6.1 Sol (medium)', 'creator': 'OpenAI', 'aa': 48, 'cpt': 0.21,
     'pin': 2, 'pout': 10, 'pcr': 0.1, 'pcw': 2.5},
]
# Models actually in use here (free tiers) with their paid AA equivalents;
# appended to the comparison table so usage can be compared against same tier.
# The "in use" badge is NOT read from here — it is derived from real DB usage
# (IN_USE_MIN_MSGS below); these rows are paid-equivalent references.
IN_USE_EQUIV = [
    {"name": "GLM-5.3-Flash", "creator": "Z AI",
     "aa": 42, "cpt": 0.25, "pin": 0.15, "pout": 0.50, "pcr": 0.03, "pcw": None},
    {"name": "Qwen3.8 Max", "creator": "Alibaba",
     "aa": 40, "cpt": 2.67, "pin": 2.00, "pout": 6.00, "pcr": 0.24, "pcw": None},
    # Space Bunny: no AA page; rates from models.dev/Sovyron 2026-10-18
    # (opencode-go $0.15/$0.60, cache read $0.03, cache write free).
    {"name": "Space Bunny", "creator": "OpenCode",
     "aa": None, "cpt": None, "pin": 0.15, "pout": 0.60, "pcr": 0.03, "pcw": 0.0},
    # Nemotron 3.5 Super VL: no AA pricing page; rates from OpenRouter
    # 2026-10-15 (Crusoe/DeepInfra $0.10/$0.40, cache read $0.08).
    {"name": "Nemotron 3.5 Super VL", "creator": "NVIDIA",
     "aa": None, "cpt": None, "pin": 0.10, "pout": 0.40, "pcr": 0.08, "pcw": None},
]
# A comparison row earns the "in use" badge when its model family reaches
# this many assistant messages in the DB (free / Go / API variants count).
IN_USE_MIN_MSGS = 100
# Providers behind API keys: opencode records $0 cost for these, so any
# non-free model served here may bill outside the dashboard. Flagged below
# (confirm free-tier status on the provider billing page, or add the spend).
METERED_PROVIDERS = {"nvidia", "openrouter"}
# Flat-rate subscriptions. The DB's recorded `cost` is metered value only, so
# plans are added here: `covers` providers are billed flat (their recorded
# metered cost is NOT added on top), any other recorded cost counts as overage.
SUBSCRIPTIONS = [
    {"label": "OpenCode Go", "monthly": 10.00, "since": "2026-10",
     "covers": ["opencode-go"]},
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
    return price_cost(d, 4.00, 20.00, 0.20, 5.00)


# --- per-session metrics. Improvement tips live in the
# Svelte templates (app/src/lib/tips.js); Python emits raw numbers only. ---
# Featured sessions (deep-dive pages): 12 costliest + up to 6 most errors
# (>=3) + up to 6 most user turns (>=8), de-duplicated.
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

        zm = zombie_minute([(m["te"], m["te"] - m["ts"]) for m in a
                              if m["te"] and m["ts"] and m["te"] > m["ts"]])
        zok = (lambda m: zm is None or (m["te"] or 0) // 60000 != zm)
        asst_dur = [min(max(0.0, (m["te"] - m["ts"]) / 1000.0),
                        GAP_MIN * 60.0)
                    for m in a if m["te"] and m["ts"] and zok(m)]
        active_s = sum(asst_dur)
        out_tot = sum(m["out"] + m["reas"] for m in a)
        reas_tot = sum(m["reas"] for m in a)
        reason_share = (reas_tot / out_tot) if out_tot else None
        tps_num = sum(m["out"] + m["reas"] for m in a
                      if m["te"] > m["ts"] and zok(m))
        tps_den = sum((m["te"] - m["ts"]) / 1000.0 for m in a
                      if m["te"] > m["ts"] and zok(m))
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
        # physical truth: model-active time cannot exceed wall span
        # (crash-stamped completions would otherwise bill days as work)
        if wall_s > 0:
            active_s = min(active_s, wall_s)
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
                "active": sum(min(max(0.0, (m["te"] - m["ts"]) / 1000.0),
                                            GAP_MIN * 60.0)
                              for m in ma
                              if m["te"] and m["ts"] and zok(m)),
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
            "gaps": gaps, "gap_ms": gap_ms, "after_err": after_err,
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


# --- V2 session source + context scoring (post-Nov-14 migration). ---
# When session_v2 holds rows it is the canonical session list (migrated
# history + new sessions); the V1 session/message/part aggregates above stay
# frozen as the spend baseline. scripts/context_eval.mjs is the reference
# implementation for the deterministic scoring below — thresholds are
# intentionally identical (no LLM calls, no network, stdlib only).
CTX_ORIENTATION = ("AGENTS.md", "EXPERIENCE.md", "README.md",
                   "package.json", "Cargo.toml", "opencode.jsonc",
                   "tsconfig.json")
CTX_OVERT_LINES = 400     # a single read past this is an oversized dump
CTX_ORIENT_MAX = 220      # bounded orientation read (AGENTS.md etc.)
CTX_PER_SITE = 250        # credited lines per edit/citation site
CTX_GREP_BUDGET = 4000    # chars credited per grep/glob output
CTX_SHELL_BUDGET = 4000   # chars credited per verification command
CTX_SHELL_BLOAT = 8000    # shell output past this is unfiltered bloat
CTX_EARLY_TURNS = 10      # first-N-turn window for cache amplification
CTX_EARLY_SPIKE = 80000   # context tokens in early window = spike
CTX_PEAK_CAP = 180000     # soft ceiling before compaction pressure
CTX_DELEG_CHARS = 80000   # main-session read volume needing delegation
CTX_SEMINDEX_DAYS = 7     # .semindex older than this is stale


def v2_has_rows(cur):
    try:
        cur.execute("SELECT COUNT(*) FROM sqlite_master "
                    "WHERE type='table' AND name='session_v2'")
        if not cur.fetchone()[0]:
            return False
        cur.execute("SELECT COUNT(*) FROM session_v2")
        return cur.fetchone()[0] > 0
    except sqlite3.Error:
        return False


def v2_repo_index(directory):
    """Retrieval-index readiness for a project dir (fresh/stale/missing)."""
    sem = os.path.join(directory, ".semindex", "index.db") \
        if directory else None
    gn = os.path.join(directory, ".gitnexus") if directory else None
    out = {"sem": "missing", "gitnexus": "missing"}
    try:
        if sem and os.path.exists(sem):
            age = (datetime.datetime.now().timestamp()
                   - os.path.getmtime(sem)) / 86400.0
            out["sem"] = ("fresh" if age <= CTX_SEMINDEX_DAYS else "stale")
        if gn and os.path.isdir(gn):
            out["gitnexus"] = "fresh"
    except OSError:
        pass
    return out


def build_v2_session_rows(cur):
    """Session rollup from session_v2 (+ message/part counts). Same sd keys
    as the V1 branch so everything downstream keeps working."""
    cur.execute("""SELECT s.id, s.directory, s.time_created, s.time_updated,
        s.tokens_input, s.tokens_output, s.tokens_reasoning,
        s.tokens_cache_read, s.tokens_cache_write, s.title,
        s.summary_additions, s.summary_deletions, s.summary_files,
        s.agent, s.model, s.parent_id,
        (SELECT count(*) FROM session_message m WHERE m.session_id = s.id),
        (SELECT count(*) FROM session_part p WHERE p.session_id = s.id
            AND json_extract(p.data,'$.type')='tool'),
        (SELECT count(*) FROM session_part p WHERE p.session_id = s.id
            AND json_extract(p.data,'$.type')='tool'
            AND json_extract(p.data,'$.state.status')='error'),
        (SELECT count(DISTINCT json_extract(m2.data,'$.model.variant'))
            FROM session_message m2 WHERE m2.session_id = s.id
            AND m2.type = 'assistant'
            AND json_extract(m2.data,'$.model.variant') IS NOT NULL)
        FROM session_v2 s ORDER BY s.time_created""")
    rows = []
    for r in cur.fetchall():
        (sid, directory, tc, tu, i, o, reas, cr, cw, title, sadd, sdel,
         sfiles, agent, smodel, parent) = r[:16]
        msgs, calls, errs, nvar = r[16], r[17], r[18], r[19]
        sd = {"id": sid, "directory": directory or "", "msgs": msgs,
              "calls": calls, "errors": errs,
              "input": i or 0, "output": o or 0, "reasoning": reas or 0,
              "cache_read": cr or 0, "cache_write": cw or 0,
              "variants": nvar or 0, "title": title or "",
              "add": sadd or 0, "delete": sdel or 0,
              "sum_files": sfiles or 0, "agent": agent or "",
              "model": smodel or "", "parent": parent or ""}
        sd["cost"] = cost(sd)["total"]
        rows.append(sd)
    for sd in rows:
        f_l = cur.execute(
            """SELECT min(time_created), max(time_updated)
            FROM session_message WHERE session_id = ?""",
            (sd["id"],)).fetchone()
        first, last = f_l
        sd["dur_min"] = ((last - first) / 60000.0
                         if (first and last and last > first) else 0.0)
        sd["first"], sd["last"] = first, last
        arow = cur.execute(
            """SELECT coalesce(sum(
                CASE WHEN CAST(json_extract(data,'$.time.completed') AS INTEGER)
                          > CAST(json_extract(data,'$.time.created') AS INTEGER)
                THEN min(CAST(json_extract(data,'$.time.completed') AS INTEGER)
                    - CAST(json_extract(data,'$.time.created') AS INTEGER),
                    """ + str(GAP_MIN * 60000) + """)
                ELSE 0 END), 0) FROM session_message
            WHERE session_id = ? AND type = 'assistant'""",
            (sd["id"],)).fetchone()
        sd["active_min"] = (arow[0] or 0) / 60000.0
    vzadj = zombie_adjust(cur, "session_message", "type='assistant'")
    for sd in rows:
        sd["active_min"] = max(
            0.0, sd["active_min"] - vzadj.get(sd["id"], 0) / 60000.0)
        if sd.get("dur_min"):
            sd["active_min"] = min(sd["active_min"], sd["dur_min"])
        try:
            day = datetime.datetime.fromtimestamp(
                sd["first"] / 1000.0).strftime("%Y-%m-%d") \
                if sd.get("first") else ""
        except (OSError, OverflowError, TypeError, ValueError):
            day = ""
        sd["day"] = day
    rows.sort(key=lambda s: -s["cost"])
    # dominant variant + model label (mirrors the V1 branch)
    for sd in rows:
        cur.execute(
            """SELECT json_extract(data,'$.model.variant'), count(*)
            FROM session_message WHERE session_id = ? AND type = 'assistant'
            GROUP BY 1""", (sd["id"],))
        best, bestn = "unset", 0
        for v, n in cur.fetchall():
            if (v or "unset") and n > bestn:
                best, bestn = (v or "unset"), n
        sd["dom_var"] = best
        try:
            sm = json.loads(sd["model"]) if sd["model"] else {}
        except ValueError:
            sm = {}
        sd["model_label"] = ((sm.get("providerID") or "?") + " / "
                             + short_model(sm.get("id"))) if sm else "?"
    return rows


def v2_code_intent(cur):
    """Session ids with edit/write tool calls in session_part."""
    try:
        cur.execute("""SELECT DISTINCT session_id FROM session_part WHERE
            json_extract(data,'$.type')='tool'
            AND json_extract(data,'$.name') IN ('edit','write')""")
        return {r[0] for r in cur.fetchall()}
    except sqlite3.Error:
        return set()


def zombie_minute(pairs):
    """Modal completed-minute shared by >=20 turns at >=50% share whose
    median duration exceeds GAP_MIN: backfilled crash/migration stamps
    (Oct-18 reboots), not measurements. Returns the minute or None."""
    if len(pairs) < 20:
        return None
    counts = {}
    for c, _d in pairs:
        m = c // 60000
        counts[m] = counts.get(m, 0) + 1
    mode, n = max(counts.items(), key=lambda kv: kv[1])
    if n < 20 or n / len(pairs) < 0.5:
        return None
    durs = sorted(d for c, d in pairs if c // 60000 == mode)
    if durs[len(durs) // 2] <= GAP_MIN * 60000:
        return None
    return mode


def zombie_adjust(cur, table, pred):
    """{sid: zombie-bucket active ms to subtract} for a message table."""
    try:
        cur.execute(
            "SELECT session_id, "
            "CAST(json_extract(data,'$.time.completed') AS INTEGER), "
            "CAST(json_extract(data,'$.time.created') AS INTEGER) "
            "FROM " + table + " WHERE " + pred)
        by_sid = {}
        for sid, te, ts in cur.fetchall():
            if te and ts and te > ts:
                by_sid.setdefault(sid, []).append((te, te - ts))
    except sqlite3.Error:
        return {}
    out = {}
    for sid, pairs in by_sid.items():
        zm = zombie_minute(pairs)
        if zm is not None:
            # same per-turn cap as the session active sums being adjusted
            out[sid] = sum(min(d, GAP_MIN * 60000)
                           for c, d in pairs if c // 60000 == zm)
    return out


def _v2_text_of(content):
    """Assistant text from session_message content[] (cite detection)."""
    bits = []
    for c in content or []:
        if isinstance(c, dict) and c.get("type") == "text" and c.get("text"):
            bits.append(c["text"])
    return "\n".join(bits)


def _v2_tool_events(content, mid, ts, seq):
    """Tool events from an assistant message's content[]: (ts, mid, seq,
    name, input, out_text, status). content[] is the complete record —
    session_part only mirrors a subset, so it is not used here.
    Mirrors context_eval.mjs tool parsing."""
    evts = []
    for d in content or []:
        if not isinstance(d, dict) or d.get("type") != "tool":
            continue
        st = d.get("state") or {}
        inp = st.get("input") or {}
        outs = st.get("content") or []
        if not isinstance(outs, list):
            outs = []
        text = "\n".join(x.get("text", "") for x in outs
                         if isinstance(x, dict))
        tm = st.get("time") or {}
        evts.append({"ts": ts, "mid": mid, "seq": seq,
                     "name": d.get("name"),
                     "input": inp, "out": text,
                     "status": st.get("status"),
                     "t_start": tm.get("start"), "t_end": tm.get("end")})
    return evts


def _v2_read_span(name, inp, out):
    """(start, end) line span of a read output; falls back to input."""
    m = re.match(r"^Read (?:file|directory) .+?, (?:lines|entries) (\d+)-(\d+)",
                 out or "")
    if m:
        return int(m.group(1)), int(m.group(2))
    start = inp.get("offset") or 1
    end = start + max(1, (out or "").count("\n") - 1)
    return start, end


def score_v2_context(sid, directory, agent, is_sub, turns, compactions,
                     turn_ctx, events, edited, asst_text, comp_seqs=()):
    """Deterministic SCOS/NCR port of context_eval.mjs evaluateSession
    (no embeddings: rescue thresholds stay server-side in that script).
    Single chronological pass over tool events so post-edit re-reads
    credit correctly. edited: {path: count}. asst_text: joined assistant
    text for citation detection."""
    total_out = sum(len(e["out"]) for e in events)
    # per-file line state across compaction epochs (fresh/dirty)
    line_state = {}
    recs = []  # read records in time order, with dup/post overlap counts
    unmod_dup_calls = 0
    unmod_dup_lines = 0
    unmod_dup_chars = 0
    post_dup_lines = 0
    post_dup_chars = 0
    oversized_calls = 0
    oversized_excess = 0
    grep_calls = empty_grep = max_streak = streak = 0
    grep_chars = grep_needed = 0
    shell_calls = shell_chars = shell_needed = 0
    shell_anti = shell_anti_chars = shell_bloat = 0
    sem_calls = graph_calls = sub_calls = 0
    other_chars = other_needed = 0
    skill_chars = 0
    resets = sorted(comp_seqs)
    for e in events:
        # compaction epoch boundary: drop pre-compaction line state,
        # exactly like the reference implementation
        if resets and resets[0] <= e.get("seq", -1):
            line_state = {}
            while resets and resets[0] <= e.get("seq", -1):
                resets.pop(0)
        name, out, inp = e["name"], e["out"], e["input"]
        n = len(out)
        if name in ("grep", "glob"):
            grep_calls += 1
            grep_chars += n
            streak += 1
            max_streak = max(max_streak, streak)
            t = out.strip()
            if not t or re.search(r"(?i)No files found|No matches found",
                                 t):
                empty_grep += 1
            else:
                grep_needed += min(n, CTX_GREP_BUDGET)
        elif name in ("shell", "bash"):
            shell_calls += 1
            shell_chars += n
            cmd = (inp.get("command") or "")
            if re.search(r"semantic:q|semantic_index", cmd):
                sem_calls += 1
                streak = 0
                shell_needed += min(n, CTX_GREP_BUDGET)
            elif re.match(r"^\s*(cat|sed\s+-n|head\b|tail\b|grep\b|rg\b|"
                           r"find\b|awk\b|wc\s+-l)\b", cmd):
                shell_anti += 1
                shell_anti_chars += n
                shell_needed += round(min(n, 2000) * 0.25)
            else:
                if n > CTX_SHELL_BLOAT:
                    shell_bloat += 1
                shell_needed += min(n, CTX_SHELL_BUDGET)
                streak = 0
        elif name == "execute":
            code = inp.get("code") or ""
            other_chars += n
            if re.search(r"gitnexus[._](query|context|trace|impact|"
                         r"api_impact|cypher|pdg_query|explain)", code):
                graph_calls += 1
                streak = 0
                other_needed += min(n, CTX_GREP_BUDGET)
            else:
                other_needed += min(n, CTX_SHELL_BUDGET)
                streak = 0
        elif (name or "").startswith("gitnexus_"):
            other_chars += n
            other_needed += min(n, CTX_GREP_BUDGET)
            if re.search(r"query|context|trace|impact|cypher",
                         name.replace("gitnexus_", "")):
                graph_calls += 1
            streak = 0
        elif name in ("subagent", "task"):
            sub_calls += 1
            other_chars += n
            other_needed += min(n, 8000)
            streak = 0
        elif name == "skill":
            skill_chars += n
            other_chars += n
            other_needed += min(n, 15000)
            streak = 0
        elif name in ("edit", "write", "apply_patch"):
            other_chars += n
            other_needed += min(n, 2000)
            streak = 0
            st = line_state.get((inp.get("path") or ""))
            if st:
                for k in st:
                    st[k] = "dirty"
        elif name == "read":
            streak = 0
            path = inp.get("path") or ""
            start, end = _v2_read_span(name, inp, out)
            span = max(1, end - start + 1)
            st = line_state.setdefault(path, {})
            fresh = dirty = 0
            for ln in range(start, end + 1):
                prev = st.get(ln)
                if prev == "fresh":
                    fresh += 1
                elif prev == "dirty":
                    dirty += 1
                st[ln] = "fresh"
            if fresh:
                unmod_dup_calls += 1
            unmod_dup_lines += fresh
            post_dup_lines += dirty
            unmod_dup_chars += round(n * fresh / span)
            post_dup_chars += round(n * dirty / span)
            if span > CTX_OVERT_LINES:
                oversized_calls += 1
            recs.append({"path": path, "start": start, "end": end,
                         "out": n, "dup": fresh, "post": dirty})
        else:
            other_chars += n
            other_needed += min(n, 3000)
            streak = 0
    # classify read files: used (edited/cited/orientation) vs dead
    total_read_calls = len(recs)
    total_read_chars = sum(r["out"] for r in recs)
    total_lines = sum(max(1, r["end"] - r["start"] + 1) for r in recs)
    needed_read = dead_chars = 0
    dead_files = used_files = 0
    base_hits = {}
    for r in recs:
        base = r["path"].rsplit("/", 1)[-1]
        base_hits[base] = base_hits.get(base, 0) + 1
    cites = {}
    for r in recs:
        base = r["path"].rsplit("/", 1)[-1]
        if base not in cites:
            cites[base] = (asst_text.count(base)
                           if len(base) > 2 else 0)

    def _used(r):
        base = r["path"].rsplit("/", 1)[-1]
        if edited.get(r["path"]) or cites.get(base, 0) > 0:
            return True
        return (base in CTX_ORIENTATION and base_hits.get(base, 0) == 1
                and (r["end"] - r["start"] + 1) <= CTX_ORIENT_MAX)

    for r in recs:
        if not _used(r):
            dead_chars += r["out"]
    dead_files = len({r["path"] for r in recs if not _used(r)})
    used_files = len({r["path"] for r in recs}) - dead_files
    for r in recs:
        if not _used(r):
            continue
        base = r["path"].rsplit("/", 1)[-1]
        sites = max(1, edited.get(r["path"], 0)
                    + min(4, cites.get(base, 0)))
        cap_lines = max(CTX_OVERT_LINES, sites * CTX_PER_SITE)
        span = max(1, r["end"] - r["start"] + 1)
        # unique-fresh chars approximated via the non-duplicate line
        # share of the output (both dup kinds excluded, like the
        # reference: post-edit lines earn only the 50% re-read credit)
        fresh_share = max(0.0, 1.0 - ((r.get("dup", 0)
                                       + r.get("post", 0)) / span))
        fresh_chars = round(r["out"] * fresh_share)
        factor = cap_lines / span if span > cap_lines else 1.0
        credited = round(fresh_chars * factor)
        oversized_excess += fresh_chars - credited
        post_credit = 0
        if span <= 80:
            post_credit = round(r["out"] * (r.get("post", 0) / span) * 0.5)
        needed_read += credited + post_credit
    total_needed = (needed_read + grep_needed + shell_needed + other_needed)
    ncr = round(100.0 * total_needed / total_out, 1) if total_out else 100.0
    had_thrash = (max_streak >= 4 or empty_grep >= 2
                  or (grep_calls >= 3 and empty_grep >= 1
                      and empty_grep / grep_calls >= 0.25))
    had_blind = dead_files >= 4
    had_brute = oversized_calls >= 3 and grep_calls < 2
    sem_needed = bool(had_thrash or had_blind or had_brute)
    used_sem = bool(sem_calls or graph_calls)
    ctx_vals = [t for t in turn_ctx if t > 0]
    peak = max(ctx_vals) if ctx_vals else 0
    early = [t for i, t in enumerate(turn_ctx)
             if i < CTX_EARLY_TURNS and t > 0]
    early_peak = max(early) if early else 0
    early_spike = early_peak > CTX_EARLY_SPIKE
    main_sess = (not is_sub and agent not in
                 ("researcher", "explore", "reviewer"))
    need_deleg = bool(main_sess and turns >= 15
                      and total_read_chars > CTX_DELEG_CHARS
                      and len({r["path"] for r in recs}) >= 6)
    used_deleg = sub_calls > 0
    s1 = 25 * min(1.0, ncr / 80.0)
    dup_rate = (unmod_dup_lines / total_lines) if total_lines else 0.0
    over_rate = ((oversized_calls / total_read_calls)
                 if total_read_calls else 0.0)
    s2 = (12 * max(0.0, 1 - dup_rate / 0.5)
          + 8 * max(0.0, 1 - over_rate / 0.5))
    s3 = 20.0
    if sem_needed and not used_sem:
        if had_thrash:
            s3 -= 7
        if had_blind:
            s3 -= 6
        if had_brute:
            s3 -= 5
    elif sem_needed and used_sem and dead_files >= 8:
        s3 -= 3
    repo = v2_repo_index(directory)
    if repo["sem"] == "missing" and repo["gitnexus"] == "missing":
        s3 -= 4
    elif repo["sem"] == "stale":
        s3 -= 2
    s3 = max(0.0, min(20.0, s3))
    s4 = 20.0
    if early_spike:
        s4 -= max(2.0, min(7.0, ((early_peak - CTX_EARLY_SPIKE)
                                 / 120000.0) * 7))
    if peak > CTX_PEAK_CAP:
        s4 -= max(1.0, min(6.0, ((peak - CTX_PEAK_CAP)
                                 / 150000.0) * 6))
    s4 -= min(4.0, compactions * 2.0)
    if need_deleg and not used_deleg:
        s4 -= 5
    s4 = max(0.0, min(20.0, s4))
    s5 = 15.0
    if shell_anti:
        s5 -= min(6.0, shell_anti * 1.5)
    if shell_bloat:
        s5 -= min(5.0, shell_bloat * 1.5)
    if turn_ctx and turn_ctx[0] > 12500 and 0 < turns < 8:
        s5 -= 2
    s5 = max(0.0, min(15.0, s5))
    scos = round(s1 + s2 + s3 + s4 + s5, 1)
    dup_pct = round(100.0 * unmod_dup_lines / total_lines, 1) \
        if total_lines else 0.0
    return {
        "scos": scos, "ncr": ncr,
        "s1": round(s1, 2), "s2": round(s2, 2), "s3": round(s3, 2),
        "s4": round(s4, 2), "s5": round(s5, 2),
        "dup_pct": dup_pct, "read_kb": round(total_read_chars / 1024.0, 1),
        "needed_kb": round(needed_read / 1024.0, 1),
        "dead_kb": round(dead_chars / 1024.0, 1),
        "dead_files": dead_files,
        "oversized_calls": oversized_calls,
        "semantic_needed": sem_needed, "used_semantic": used_sem,
        "had_thrash": had_thrash, "had_blind": had_blind,
        "early_spike": early_spike, "peak_k": round(peak / 1000.0, 1),
        "shell_anti": shell_anti, "shell_bloat": shell_bloat,
        "need_deleg": need_deleg, "used_deleg": used_deleg,
        "turns": turns, "compactions": compactions,
    }


def collect_v2_metrics(cur, ids, meta):
    """Per-session metrics + context scores from V2 tables. meta maps
    sid -> {directory, agent, parent}. Returns {sid: {"q": q, "ctx": ctx}}
    with q shaped exactly like collect_session_metrics output."""
    out = {}
    if not ids:
        return out
    ph = ",".join(["?"] * len(ids))
    users = {}
    cur.execute("SELECT session_id, seq, time_created, data "
                "FROM session_message WHERE session_id IN (" + ph + ") "
                "AND type='user' ORDER BY session_id, seq", ids)
    for sid, seq, ts, data in cur.fetchall():
        try:
            d = json.loads(data) if data else {}
        except ValueError:
            d = {}
        tm = ((d.get("time") or {}).get("created")) or ts or 0
        text = d.get("text") or ((d.get("metadata") or {}).get(
            "displayText")) or ""
        users.setdefault(sid, []).append(
            {"seq": seq, "ts": tm, "text": text})
    assts = {}
    cur.execute("SELECT id, session_id, seq, time_created, data "
                "FROM session_message WHERE session_id IN (" + ph + ") "
                "AND type='assistant' ORDER BY session_id, seq", ids)
    for mid, sid, seq, ts, data in cur.fetchall():
        try:
            d = json.loads(data) if data else {}
        except ValueError:
            d = {}
        tm = d.get("time") or {}
        toks = d.get("tokens") or {}
        cache = toks.get("cache") or {}
        model = d.get("model") or {}
        assts.setdefault(sid, []).append({
            "mid": mid, "seq": seq, "ts": tm.get("created") or ts or 0,
            "te": tm.get("completed") or 0,
            "out": toks.get("output") or 0,
            "reas": toks.get("reasoning") or 0,
            "tin": toks.get("input") or 0, "cr": cache.get("read") or 0,
            "cw": cache.get("write") or 0,
            "var": model.get("variant") or "unset",
            "prov": model.get("providerID") or "?",
            "fin": d.get("finish"),
            "text": _v2_text_of(d.get("content")),
            "tools": _v2_tool_events(d.get("content"), mid,
                                     tm.get("created") or ts or 0, seq)})
    cur.execute("SELECT session_id, seq FROM session_message "
                "WHERE session_id IN (" + ph + ") AND type='compaction' "
                "ORDER BY session_id, seq", ids)
    comp_seqs = {}
    for sid, seq in cur.fetchall():
        comp_seqs.setdefault(sid, []).append(seq)
    compactions = {sid: len(v) for sid, v in comp_seqs.items()}

    def excerpt(text, limit=140):
        return re.sub(r"\s+", " ", text or "").strip()[:limit]

    for sid in ids:
        u = users.get(sid, [])
        a = assts.get(sid, [])
        evts = [e for m in a for e in m.get("tools", [])]
        calls = len(evts)
        errors = sum(1 for e in evts if e["status"] == "error")
        err_rate = (errors / calls) if calls else None
        eb_tool = {}
        for e in evts:
            if e["status"] == "error":
                eb_tool[e["name"]] = eb_tool.get(e["name"], 0) + 1
        err_by_tool = sorted(eb_tool.items(), key=lambda kv: -kv[1])
        streak = ("", 0)
        run_tool, run_n = "", 0
        for e in evts:
            if e["status"] == "error" and (not run_tool
                                           or e["name"] == run_tool):
                run_tool = e["name"]
                run_n += 1
                if run_n > streak[1]:
                    streak = (run_tool, run_n)
            else:
                run_tool = e["name"] if e["status"] == "error" else ""
                run_n = 1 if e["status"] == "error" else 0
        err_ts = sorted(e["ts"] for e in evts if e["status"] == "error")
        after_err = 0
        for i in range(1, len(u)):
            prev, now = u[i - 1]["ts"], u[i]["ts"]
            if any(prev < x <= now and (now - x) <= AFTER_ERR_S * 1000
                   for x in err_ts):
                after_err += 1
        gaps, gap_ms = 0, 0
        for i in range(1, len(u)):
            g = u[i]["ts"] - u[i - 1]["ts"]
            if g > GAP_MIN * 60000:
                gaps += 1
                gap_ms += g
        zm = zombie_minute([(m["te"], m["te"] - m["ts"]) for m in a
                              if m["te"] and m["ts"] and m["te"] > m["ts"]])
        zok = (lambda m: zm is None or (m["te"] or 0) // 60000 != zm)
        asst_dur = [min(max(0.0, (m["te"] - m["ts"]) / 1000.0),
                        GAP_MIN * 60.0)
                    for m in a if m["te"] and m["ts"] and zok(m)]
        active_s = sum(asst_dur)
        out_tot = sum(m["out"] + m["reas"] for m in a)
        reas_tot = sum(m["reas"] for m in a)
        reason_share = (reas_tot / out_tot) if out_tot else None
        tps_num = sum(m["out"] + m["reas"] for m in a
                      if m["te"] > m["ts"] and zok(m))
        tps_den = sum((m["te"] - m["ts"]) / 1000.0 for m in a
                      if m["te"] > m["ts"] and zok(m))
        tps = (tps_num / tps_den) if tps_den else None
        var_c = {}
        provs = set()
        for m in a:
            var_c[m["var"]] = var_c.get(m["var"], 0) + 1
            provs.add(m["prov"])
        variants = sorted(var_c.items(), key=lambda kv: -kv[1])
        last_fin = a[-1]["fin"] if a else None
        msgs_per_turn = (len(a) / len(u)) if u else None
        first_prompt = len(u[0]["text"]) if u else 0
        stamps = [x["ts"] for x in u] + [m["ts"] for m in a] \
            + [m["te"] for m in a if m["te"]] \
            + [e["ts"] for e in evts]
        stamps = [x for x in stamps if x]
        wall_s = ((max(stamps) - min(stamps)) / 1000.0) \
            if len(stamps) > 1 else 0.0
        # physical truth: model-active time cannot exceed wall span
        # (crash-stamped completions would otherwise bill days as work)
        if wall_s > 0:
            active_s = min(active_s, wall_s)
        idle_pct = ((wall_s - active_s) / wall_s * 100.0) \
            if wall_s > 0 else None
        mid_turn = {}  # assistant mid -> turn index (seq windows)
        for i, um in enumerate(u):
            hi = u[i + 1]["seq"] if i + 1 < len(u) else None
            for m in a:
                if m["seq"] > um["seq"] and (hi is None or m["seq"] < hi):
                    mid_turn[m["mid"]] = i
        tl = []
        interrupted = 0
        edited_paths = set()
        for i, um in enumerate(u):
            ma = [m for m in a if mid_turn.get(m["mid"]) == i]
            mt = [e for e in evts
                  if mid_turn.get(e["mid"]) == i]
            last_te = max([m["te"] for m in ma if m["te"]] or [0])
            cut = bool(ma) and not any(m["fin"] == "stop" for m in ma) \
                and i + 1 < len(u) and last_te \
                and u[i + 1]["ts"] < last_te
            if cut:
                interrupted += 1
            pfiles = set()
            for e in mt:
                if e["name"] in ("edit", "write", "apply_patch"):
                    p = (e["input"].get("path") or "").rsplit("/", 1)[-1]
                    if p:
                        pfiles.add(p)
                        edited_paths.add(e["input"].get("path") or "")
            n_err = sum(1 for e in mt if e["status"] == "error")
            if not ma and not mt:
                outcome, tsum = "queued", "queued"
            else:
                mix, emix = {}, {}
                for e in mt:
                    mix[e["name"]] = mix.get(e["name"], 0) + 1
                    if e["status"] == "error":
                        emix[e["name"]] = emix.get(e["name"], 0) + 1
                if cut:
                    outcome = "cut short"
                elif pfiles:
                    outcome = "edited"
                elif n_err >= 3 or (n_err and n_err / max(len(mt), 1)
                                    >= 0.5):
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
                                     + next(iter(pfiles)))
                        else:
                            tsum += " · edited %d files" % len(pfiles)
                    if emix:
                        et = max(emix.items(),
                                 key=lambda kv: kv[1])[0]
                        tsum += (" · %d error%s (%s)"
                                 % (n_err,
                                    "" if n_err == 1 else "s", et))
            tl.append({
                "start": um["ts"], "pex": excerpt(um["text"]),
                "sum": tsum, "outcome": outcome,
                "asst": len(ma), "calls": len(mt), "err": n_err,
                "out": sum(m["out"] + m["reas"] for m in ma),
                "active": sum(min(max(0.0, (m["te"] - m["ts"]) / 1000.0),
                                            GAP_MIN * 60.0)
                              for m in ma
                              if m["te"] and m["ts"] and zok(m)),
                "var": ma[-1]["var"] if ma else None})
        cm = {}
        for e in evts:
            if (e["name"] or "") in ("bash", "shell"):
                cat = classify_bash(e["input"].get("command") or "")
            else:
                cat = classify_tool(e["name"] or "")
            cell = cm.setdefault(cat, [0, 0])
            cell[1] += 1
            if e["t_start"] and e["t_end"] and e["t_end"] > e["t_start"]:
                cell[0] += e["t_end"] - e["t_start"]
        tool_cats = [{"cat": c, "ms": cm[c][0], "calls": cm[c][1]}
                     for c in cm]
        tool_cats.sort(key=lambda r: -r["ms"])
        edited = {}
        for e in evts:
            if e["name"] in ("edit", "write", "apply_patch"):
                p = e["input"].get("path") or ""
                if p:
                    edited[p] = edited.get(p, 0) + 1
        asst_text = "\n".join(m["text"] for m in a if m["text"])
        turn_ctx = [m["tin"] + m["cr"] + m["cw"] for m in a]
        m = meta.get(sid, {})
        ctx = score_v2_context(
            sid, m.get("directory", ""), m.get("agent", ""),
            bool(m.get("parent")), len(u), compactions.get(sid, 0),
            turn_ctx, evts, edited, asst_text,
            comp_seqs.get(sid, ()))
        q = {
            "turns": len(u), "asst": len(a), "calls": calls,
            "errors": errors, "err_rate": err_rate,
            "err_by_tool": err_by_tool, "streak": streak,
            "interrupted": interrupted,
            "gaps": gaps, "gap_ms": gap_ms, "after_err": after_err,
            "first_prompt": first_prompt,
            "active_min": active_s / 60.0, "idle_pct": idle_pct,
            "wall_min": wall_s / 60.0,
            "turn_p50": med(asst_dur), "tps": tps,
            "reason_share": reason_share, "out_tot": out_tot,
            "variants": variants, "providers": sorted(provs),
            "msgs_per_turn": msgs_per_turn, "last_fin": last_fin,
            "files": len(edited_paths),
            "tool_cats": tool_cats,
            "tool_ms": sum(r["ms"] for r in tool_cats),
            "tl": tl[:TL_MAX], "tl_truncated": len(tl) > TL_MAX,
        }
        out[sid] = {"q": q, "ctx": ctx}
    return out


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

    # --- billing flags: non-free models on key-authed providers ($0 recorded) ---
    billing_flags = sorted(
        ({"provider": m["provider"],
          "model": re.sub(r"^" + re.escape(m["provider"] or "") + "/",
                          "", m["model"] or ""),
          "msgs": m["messages"]} for m in models
         if m["provider"] in METERED_PROVIDERS
         and not re.search(r"(:free$|-free$)", m["model"] or "")),
        key=lambda f: -f["msgs"])

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
    #     grouped per provider+model (opencode timestamps are ms) ---
    cur.execute("""SELECT json_extract(data,'$.providerID'),
        json_extract(data,'$.modelID'),
        json_extract(data,'$.time.created'),
        json_extract(data,'$.time.completed'),
        json_extract(data,'$.tokens.output') + json_extract(data,'$.tokens.reasoning')
        FROM message WHERE json_extract(data,'$.role')='assistant'
        AND json_extract(data,'$.time.completed') IS NOT NULL""")
    prov_lat = {}
    for provider, model, created, completed, out_tok in cur.fetchall():
        if not (created and completed and completed > created):
            continue
        secs = (completed - created) / 1000.0
        key = ((provider or "?"), (model or "?"))
        p = prov_lat.setdefault(key, {"msgs": 0, "durs": [], "tps": []})
        p["msgs"] += 1
        p["durs"].append(secs)
        if out_tok and secs > 0:
            p["tps"].append(out_tok / secs)

    def pctiles(vals, p):
        if not vals:
            return 0.0
        return vals[min(int(len(vals) * p), len(vals) - 1)]

    prov_lat_list = []
    for (p, m), d in sorted(prov_lat.items(), key=lambda kv: -kv[1]["msgs"]):
        durs = sorted(d["durs"])
        tps = sorted(d["tps"])
        prov_lat_list.append({
            "provider": p, "model": m, "msgs": d["msgs"],
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

    # --- tool calls + errors per provider+model (part joins message) ---
    # provider rollup (prov_rel) is kept for backward compat; model_rel
    # powers the per-model reliability table.
    cur.execute("""SELECT json_extract(m.data,'$.providerID'),
        json_extract(m.data,'$.modelID'), count(*),
        sum(CASE WHEN json_extract(p.data,'$.state.status')='error'
            THEN 1 ELSE 0 END)
        FROM part p JOIN message m ON p.message_id = m.id
        WHERE json_extract(p.data,'$.type')='tool'
        GROUP BY 1, 2 ORDER BY 3 DESC""")
    prov_err = {}
    for provider, model, n, errs in cur.fetchall():
        prov_err[((provider or "?"), (model or "?"))] = {
            "calls": n, "errors": errs or 0}
    by_prov_err = {}
    for (provider, _model), er in prov_err.items():
        b = by_prov_err.setdefault(provider, {"calls": 0, "errors": 0})
        b["calls"] += er["calls"]
        b["errors"] += er["errors"]

    model_rel = []
    for e in prov_lat_list:
        er = prov_err.get((e["provider"], e["model"]),
                          {"calls": 0, "errors": 0})
        e2 = dict(e)
        e2["calls"] = er["calls"]
        e2["errors"] = er["errors"]
        model_rel.append(e2)
    for key in sorted(prov_err):
        if not any(e["provider"] == key[0] and e["model"] == key[1]
                   for e in model_rel):
            er = prov_err[key]
            model_rel.append({"provider": key[0], "model": key[1],
                              "msgs": 0, "p50": 0.0, "p95": 0.0,
                              "tps_p50": 0.0, "total_min": 0.0,
                              "calls": er["calls"], "errors": er["errors"]})

    # provider p50/p95 need durations: re-aggregate from prov_lat directly
    prov_roll = {}
    for (provider, _model), d in prov_lat.items():
        b = prov_roll.setdefault(provider, {"msgs": 0, "durs": [],
                                            "tps": []})
        b["msgs"] += d["msgs"]
        b["durs"].extend(d["durs"])
        b["tps"].extend(d["tps"])
    prov_rel = []
    for p, d in sorted(prov_roll.items(),
                       key=lambda kv: -kv[1]["msgs"]):
        durs = sorted(d["durs"])
        tps = sorted(d["tps"])
        er = by_prov_err.get(p, {"calls": 0, "errors": 0})
        prov_rel.append({
            "provider": p, "msgs": d["msgs"],
            "p50": durs[len(durs) // 2] if durs else 0.0,
            "p95": pctiles(durs, 0.95),
            "tps_p50": tps[len(tps) // 2] if tps else 0.0,
            "total_min": sum(durs) / 60.0,
            "calls": er["calls"], "errors": er["errors"]})
    for p in sorted(by_prov_err):
        if not any(e["provider"] == p for e in prov_rel):
            er = by_prov_err[p]
            prov_rel.append({"provider": p, "msgs": 0, "p50": 0.0,
                             "p95": 0.0, "tps_p50": 0.0, "total_min": 0.0,
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

    # --- active assistant time per session (turn durations, all sessions).
    # Wall spans (dur_min) include idle days; this is the honest work clock.
    # Per-turn cap (GAP_MIN): crash-stamped completions (e.g. the Oct-18 hard
    # reboots left thousands of ~2-day "turns" on two sessions) must not
    # bill as work; no single message is 15 min of continuous generation.
    cur.execute("""SELECT session_id, coalesce(sum(
        CASE WHEN CAST(json_extract(data,'$.time.completed') AS INTEGER)
                  > CAST(json_extract(data,'$.time.created') AS INTEGER)
        THEN min(CAST(json_extract(data,'$.time.completed') AS INTEGER)
            - CAST(json_extract(data,'$.time.created') AS INTEGER),
            """ + str(GAP_MIN * 60000) + """)
        ELSE 0 END), 0) FROM message
        WHERE json_extract(data,'$.role')='assistant'
        GROUP BY session_id""")
    active_by_session = {sid: ms / 60000.0 for sid, ms in cur.fetchall()}
    cur.execute("""SELECT id, date(time_created/1000,'unixepoch','localtime')
        FROM session""")
    day_by_session = {sid: day for sid, day in cur.fetchall()}
    zadj = zombie_adjust(cur, "message",
                         "json_extract(data,'$.role')='assistant'")
    for sd in session_rows_data:
        sd["active_min"] = max(
            0.0, active_by_session.get(sd["id"], 0.0)
            - zadj.get(sd["id"], 0) / 60000.0)
        if sd.get("dur_min"):
            sd["active_min"] = min(sd["active_min"], sd["dur_min"])
        sd["day"] = day_by_session.get(sd["id"], "")
    total_active = sum(sd["active_min"] for sd in session_rows_data)
    active_by_dir = {}
    active_by_day = {}
    for sd in session_rows_data:
        if sd["directory"]:
            active_by_dir[sd["directory"]] = \
                active_by_dir.get(sd["directory"], 0.0) + sd["active_min"]
        if sd["day"]:
            active_by_day[sd["day"]] = \
                active_by_day.get(sd["day"], 0.0) + sd["active_min"]
    for d in days:
        d["active"] = active_by_day.get(d["day"], 0.0)

    # --- code-intent per session (edit/write tool call or patch part).
    # Sessions without any are Q&A/exploration: excluded from landing stats.
    cur.execute("""SELECT DISTINCT session_id FROM part WHERE
        json_extract(data,'$.type')='patch' OR
        (json_extract(data,'$.type')='tool'
         AND json_extract(data,'$.tool') IN ('edit','write'))""")
    code_intent = {r[0] for r in cur.fetchall()}

    # --- dominant effort variant + session model label (all sessions) ---
    cur.execute("""SELECT session_id, json_extract(data,'$.variant'),
        count(*) FROM message
        WHERE json_extract(data,'$.role')='assistant'
        GROUP BY session_id, 2""")
    dom_var = {}
    for sid, var, n in cur.fetchall():
        v = var or "unset"
        if sid not in dom_var or n > dom_var[sid][1]:
            dom_var[sid] = (v, n)
    for sd in session_rows_data:
        sd["dom_var"] = dom_var.get(sd["id"], ("unset", 0))[0]
        try:
            sm = json.loads(sd["model"]) if sd["model"] else {}
        except ValueError:
            sm = {}
        sd["model_label"] = ((sm.get("providerID") or "?") + " / "
                             + short_model(sm.get("id"))) if sm else "?"

    # --- per-session metrics (all sessions): effectiveness/efficiency ---
    sess_q = collect_session_metrics(
        cur, [s["id"] for s in session_rows_data])
    for sd in session_rows_data:
        sd["q"] = sess_q.get(sd["id"])
    for sd in session_rows_data:
        sd["ctx"] = None
    # --- V2 overlay: live sessions + context scores (superset; V2 wins) ---
    # V1 tables froze at the Nov-14 migration; session_v2/session_message/
    # session_part carry everything since. V2 rows replace same-id V1 rows.
    if v2_has_rows(cur):
        v2_rows = build_v2_session_rows(cur)
        v2m = collect_v2_metrics(
            cur, [s["id"] for s in v2_rows],
            {s["id"]: {"directory": s["directory"], "agent": s["agent"],
                       "parent": s.get("parent", "")}
             for s in v2_rows})
        for s in v2_rows:
            m = v2m.get(s["id"], {})
            s["q"] = m.get("q")
            s["ctx"] = m.get("ctx")
        have = {s["id"] for s in v2_rows}
        session_rows_data = ([s for s in session_rows_data
                              if s["id"] not in have] + v2_rows)
        session_rows_data.sort(key=lambda s: -s["cost"])
        code_intent = code_intent | v2_code_intent(cur)

    # --- human vs model time split ---
    # engaged wall per session = wall span minus idle gaps (>15m, away from
    # keyboard); human ≈ engaged wall minus assistant turn time. Gaps keep
    # lunch/afternoon-away out of the human number.
    human_by_day = {}
    human_min = 0.0
    for sd in session_rows_data:
        q = sd.get("q") or {}
        engaged = max(0.0, (q.get("wall_min") or 0.0)
                      - (q.get("gap_ms") or 0) / 60000.0)
        h = max(0.0, engaged - (q.get("active_min") or 0.0))
        human_min += h
        if sd.get("day"):
            human_by_day[sd["day"]] = human_by_day.get(sd["day"], 0.0) + h
    for d in days:
        d["human"] = human_by_day.get(d["day"], 0.0)

    # --- featured sessions: costliest + most errors + most turns ---
    feat_ids = set(s["id"] for s in session_rows_data[:12])
    feat_ids.update(s["id"] for s in
                    sorted(session_rows_data, key=lambda s: -s["errors"])[:6]
                    if s["errors"] >= 3)
    feat_ids.update(s["id"] for s in
                    sorted(session_rows_data,
                           key=lambda s: -(s["q"] or {}).get("turns", 0))[:6]
                    if (s["q"] or {}).get("turns", 0) >= 8)
    featured = [s for s in session_rows_data if s["id"] in feat_ids]

    # --- context health aggregates (live V2-scored sessions only) ---
    call = [s["ctx"] for s in session_rows_data if s.get("ctx")]
    need_sem = [c for c in call if c.get("semantic_needed")]
    ctxagg = ({
        "n": len(call),
        "scos": round(sum(c["scos"] for c in call) / len(call), 1),
        "ncr": round(sum(c["ncr"] for c in call) / len(call), 1),
        "need_sem": len(need_sem),
        "used_sem": sum(1 for c in need_sem if c.get("used_semantic")),
        "mean_dup": round(sum(c["dup_pct"] for c in call) / len(call), 1),
    } if call else None)
    ctx_by_proj = {}
    for s in session_rows_data:
        c = s.get("ctx")
        if not c:
            continue
        p = (s.get("directory") or "").rstrip("/").split("/")[-1] or "?"
        e = ctx_by_proj.setdefault(p, {"n": 0, "scos": 0.0, "ncr": 0.0,
                                       "need": 0, "used": 0})
        e["n"] += 1
        e["scos"] += c["scos"]
        e["ncr"] += c["ncr"]
        if c.get("semantic_needed"):
            e["need"] += 1
            if c.get("used_semantic"):
                e["used"] += 1
    ctx_projects = [{
        "project": p, "n": e["n"],
        "scos": round(e["scos"] / e["n"], 1),
        "ncr": round(e["ncr"] / e["n"], 1),
        "need_sem": e["need"], "used_sem": e["used"],
    } for p, e in sorted(ctx_by_proj.items(),
                         key=lambda kv: (kv[1]["scos"], -kv[1]["n"]))]
    # --- aggregate prompt/session habits (training lens, all sessions) ---
    qall = [s["q"] for s in session_rows_data if s.get("q")]
    t1 = [q["turns"] for q in qall if q["turns"] >= 1]
    fp = [q["first_prompt"] for q in qall if q["turns"] >= 1]
    habits = {
        "n": len(t1),
        "turns_p50": med(t1), "turns_p90": pctiles(sorted(t1), 0.90),
        "gap_sessions": sum(1 for q in qall if q["gaps"] > 0),
        "gap_hours": round(sum(q.get("gap_ms", 0) for q in qall)
                     / 3600000.0, 1),
        "cut_sessions": sum(1 for q in qall if q["interrupted"] > 0),
        "after_err_turns": sum(q["after_err"] for q in qall),
        "prompt_p50": med(fp), "prompt_p90": pctiles(sorted(fp), 0.90),
        # clean = conversational, no idle gaps, no cut turns, no post-error
        # re-prompts (8-turn bar mirrors tips.js TURNS_MANY)
        "clean": sum(1 for q in qall if 1 <= q["turns"] < 8
                     and not q["gaps"] and not q["interrupted"]
                     and not q["after_err"]),
    }

    # --- effort-level (variant) mix ---
    cur.execute("""SELECT json_extract(data,'$.variant'), count(*),
        coalesce(sum(CAST(json_extract(data,'$.tokens.output') AS INTEGER)),0),
        coalesce(sum(CAST(json_extract(data,'$.tokens.reasoning') AS INTEGER)),0)
        FROM message WHERE json_extract(data,'$.role')='assistant'
        GROUP BY 1 ORDER BY 2 DESC""")
    variants = [(r[0] or "unset", r[1], r[2], r[3]) for r in cur.fetchall()]

    # --- hour-of-day activity (UTC, from session tokens) ---
    cur.execute("""SELECT CAST(strftime('%H', time_created/1000, 'unixepoch', 'localtime') AS INTEGER),
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
        if sd["id"] not in code_intent:
            sd["landed"] = None
            sd["intent"] = False
        else:
            sd["intent"] = True
            sd["landed"] = landed(sd["directory"], sd.get("last"))

    n_landed = sum(1 for s in session_rows_data if s["landed"])
    n_checkable = sum(1 for s in session_rows_data if s["landed"] is not None)
    n_no_intent = sum(1 for s in session_rows_data if not s["intent"])

    # Sessions ended <24h ago haven't had their landing window yet: they are
    # pending, not failures. (The in-flight work from the last day, including
    # today's sessions, would otherwise read as 0% landed.)
    now_ms = datetime.datetime.now().astimezone().timestamp() * 1000.0
    for sd in session_rows_data:
        if (sd["intent"] and sd.get("last")
                and now_ms - sd["last"] < 86400000):
            sd["landed"] = None
            sd["pending"] = True
    n_pending = sum(1 for s in session_rows_data if s.get("pending"))
    n_landed = sum(1 for s in session_rows_data if s["landed"])
    n_checkable = sum(1 for s in session_rows_data if s["landed"] is not None)

    # --- landed rate by session model + dominant effort (intent sessions) ---
    def landed_table(keyfn):
        rows = {}
        for s in session_rows_data:
            if s["landed"] is None:
                continue
            k = keyfn(s)
            r = rows.setdefault(k, [0, 0])
            r[1] += 1
            r[0] += 1 if s["landed"] else 0
        return [{"name": k, "landed": v[0], "n": v[1],
                 "rate": round(100.0 * v[0] / v[1]) if v[1] else None}
                for k, v in sorted(rows.items(), key=lambda kv: -kv[1][1])]

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

    # --- rate-limit incidents in the last 24h (opencode.log, same scan as
    # the benchmarks weekly job: stream-error lines mentioning 429s) ---
    rate429 = {"count": 0, "by_model": []}
    try:
        log_lines = LOG_FILE.read_text(errors="replace").splitlines()
    except OSError:
        log_lines = []
    cutoff = now - datetime.timedelta(hours=24)
    by_mod429 = {}
    for line in log_lines:
        if "stream error" not in line:
            continue
        if not re.search(r"Too Many Requests| 429 ", line):
            continue
        m = re.search(r"timestamp=([0-9T:.\-]+Z)", line)
        if not m:
            continue
        try:
            ts = datetime.datetime.fromisoformat(
                m.group(1).replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts < cutoff:
            continue
        mod = (re.search(r"modelID=([^\s]+)", line) or [None, "?"])[1]
        rate429["count"] += 1
        by_mod429[mod] = by_mod429.get(mod, 0) + 1
    rate429["by_model"] = sorted(by_mod429.items(), key=lambda kv: -kv[1])

    # --- Go quota snapshot (manual fetch; absent file = unknown) ---
    quota = None
    try:
        qj = json.loads(QUOTA_FILE.read_text())
        quota = {"fetched_at": qj.get("fetched_at"),
                 "rolling": qj.get("rolling"),
                 "weekly": qj.get("weekly"),
                 "monthly": qj.get("monthly")}
    except (OSError, ValueError):
        quota = None

    # --- provider credit snapshot (manual fetch; absent file = unknown) ---
    credits = None
    try:
        cj = json.loads(CREDITS_FILE.read_text())
        credits = {"fetched_at": cj.get("fetched_at"),
                   "providers": cj.get("providers")}
    except (OSError, ValueError):
        credits = None
    # --- OpenCode Go: billing-cycle actuals vs the blog reference ---
    # Cycles = 19th–19th UTC billing months (mirrors sr-calc.mjs). Requests
    # count Go-product rows only (providerID='opencode-go', error rows
    # excluded — matches the console-verified meter). Cost is priced at
    # GO_PRICES (blog-validated) so the V2-migration cost loss is recovered;
    # models without published prices fall back to recorded cost.
    # Account-wide request caps (sr-calc.mjs): month 18,000, week 15,700.
    GO_MONTH_CAP = 18000
    GO_WEEK_CAP = 15700
    GO_SOURCE = ("atomicbot.ai/blog/opencode-go, checked 2026-11-02; "
                 "caps $100/$60/$30/$20/$15 per model, account-wide "
                 "18,000 req/mo + 15,700 req/wk")

    def go_cycle_for(start, end, live, u):
        t0 = int(start.timestamp() * 1000)
        t1 = int(end.timestamp() * 1000)
        try:
            con = sqlite3.connect("file:" + str(DB) + "?mode=ro", uri=True)
            cur = con.cursor()
            cur.execute("SELECT COUNT(*) FROM sqlite_master "
                        "WHERE type='table' AND name='session_message'")
            if cur.fetchone()[0]:
                frm = "session_message WHERE type='assistant'"
                prov = "COALESCE(json_extract(data,'$.model.providerID'),'?')"
                mdl = "COALESCE(json_extract(data,'$.model.id'),'?')"
            else:
                frm = "message WHERE json_extract(data,'$.role')='assistant'"
                prov = "COALESCE(json_extract(data,'$.providerID'),'?')"
                mdl = "COALESCE(json_extract(data,'$.modelID'),'?')"
            cur.execute(
                "SELECT " + mdl + ", COUNT(*), "
                "COALESCE(SUM(json_extract(data,'$.tokens.input')),0), "
                "COALESCE(SUM(json_extract(data,'$.tokens.output')),0), "
                "COALESCE(SUM(json_extract(data,'$.tokens.reasoning')),0), "
                "COALESCE(SUM(json_extract(data,'$.tokens.cache.read')),0), "
                "COALESCE(SUM(json_extract(data,'$.tokens.cache.write')),0), "
                "COALESCE(SUM(json_extract(data,'$.cost')),0) "
                "FROM " + frm + " AND time_created>=" + str(t0) +
                " AND time_created<" + str(t1) +
                " AND " + prov + "='opencode-go'"
                " AND json_extract(data,'$.error') IS NULL GROUP BY 1")
            rows = cur.fetchall()
            con.close()
        except sqlite3.Error:
            return None
        if not rows:
            return None
        models = []
        tot_req = 0
        tot_usd = 0.0
        for r in sorted(rows, key=lambda r: -r[7]):
            mid = r[0]
            pr = GO_PRICES.get(mid)
            rec = round(r[7], 4)
            if pr:
                # cache-write price is unpublished in the blog reference; it is
                # 0 for every Go row this cycle, so it is excluded from est.
                est = round((r[2] * pr[0] + (r[3] + r[4]) * pr[1]
                             + r[5] * pr[2]) / 1e6, 4)
                priced = True
            else:
                est = rec
                priced = False
            allow = GO_ALLOWANCE.get(mid)
            models.append({"model": mid, "reqs": r[1],
                           "tin": r[2], "tout": r[3] + r[4],
                           "tcr": r[5], "tcw": r[6],
                           "rec": rec, "est": est, "priced": priced,
                           "allow": allow,
                           "pct": (round(100.0 * est / allow[0], 1)
                                   if allow and est else None)})
            tot_req += r[1]
            tot_usd += est
        span_s = (end - start).total_seconds() or 1
        if u < start:
            elapsed = 0.0
        elif u >= end:
            elapsed = 1.0
        else:
            elapsed = (u - start).total_seconds() / span_s
        days = max(1, round(span_s / 86400.0))
        day = days if u >= end else max(1, int((u - start).total_seconds() // 86400) + 1)
        expected_req = int(round(GO_MONTH_CAP * elapsed))
        pace = (round(100.0 * tot_req / expected_req, 1)
                if expected_req > 0 else None)
        return {"start": start.strftime("%b %d"),
                "end": end.strftime("%b %d"),
                "start_iso": start.strftime("%Y-%m-%d"),
                "end_iso": end.strftime("%Y-%m-%d"),
                "live": live, "models": models,
                "reqs": tot_req, "usd": round(tot_usd, 2),
                "source": GO_SOURCE, "capReq": GO_MONTH_CAP,
                "weekCapReq": GO_WEEK_CAP,
                "elapsed": round(elapsed, 4), "day": day, "days": days,
                "expected_req": expected_req, "pace": pace,
                "pct": round(100.0 * tot_req / GO_MONTH_CAP, 1)}

    def go_cycles():
        u = now.astimezone(datetime.timezone.utc)
        cur = datetime.datetime(u.year, u.month, 19,
                                tzinfo=datetime.timezone.utc)
        if u.day < 19:
            prev = (datetime.datetime(u.year, u.month, 1,
                                      tzinfo=datetime.timezone.utc)
                    - datetime.timedelta(days=1))
            cur = datetime.datetime(prev.year, prev.month, 19,
                                    tzinfo=datetime.timezone.utc)
        live = None
        try:
            lj = json.loads(SR_LIVE_FILE.read_text())
            if lj.get("schema") == 4:
                live = {"as_of": (lj.get("fullRecomputeAt")
                                  or lj.get("generated_at")),
                        "windows": {k: v for k, v
                                    in (lj.get("windows") or {}).items()
                                    if k in ("month", "week", "rolling")}}
        except (OSError, ValueError):
            live = None
        # current + 3 prior 19th–19th cycles, newest first
        out = []
        s = cur
        for i in range(3, -1, -1):
            ss = s
            for _ in range(i):
                ss = datetime.datetime(
                    ss.year - (1 if ss.month == 1 else 0),
                    12 if ss.month == 1 else ss.month - 1, 19,
                    tzinfo=datetime.timezone.utc)
            ee = datetime.datetime(
                ss.year + (1 if ss.month == 12 else 0),
                1 if ss.month == 12 else ss.month + 1, 19,
                tzinfo=datetime.timezone.utc)
            c = go_cycle_for(ss, ee, live if i == 0 else None, u)
            if c:
                out.append(c)
        out.sort(key=lambda c: c["start_iso"], reverse=True)
        for c in out:
            c.pop("_s", None)
        return out

    go_list = go_cycles()
    go = go_list[0] if go_list else None

    # --- Go requests per day (daily usage trend: % of monthly request cap) ---
    try:
        con2 = sqlite3.connect("file:" + str(DB) + "?mode=ro", uri=True)
        cur2 = con2.cursor()
        cur2.execute("SELECT COUNT(*) FROM sqlite_master "
                     "WHERE type='table' AND name='session_message'")
        if cur2.fetchone()[0]:
            gfrm = "session_message WHERE type='assistant'"
            gprov = "COALESCE(json_extract(data,'$.model.providerID'),'?')"
        else:
            gfrm = "message WHERE json_extract(data,'$.role')='assistant'"
            gprov = "COALESCE(json_extract(data,'$.providerID'),'?')"
        cutoff_ms = int(now.timestamp() * 1000) - 90 * 86400000
        cur2.execute(
            "SELECT date(time_created/1000,'unixepoch','localtime'), COUNT(*) "
            "FROM " + gfrm + " AND time_created>=" + str(cutoff_ms) +
            " AND " + gprov + "='opencode-go'"
            " AND json_extract(data,'$.error') IS NULL GROUP BY 1 ORDER BY 1")
        go_daily = [{"day": r[0], "reqs": r[1],
                     "pct": round(100.0 * r[1] / GO_MONTH_CAP, 2)}
                    for r in cur2.fetchall()]
        con2.close()
    except sqlite3.Error:
        go_daily = []
    primary = models[0] if models else {"model": "?", "provider": "?",
                                        "messages": 0, "actual": 0.0, "cost": 0.0}
    equiv = []
    for m in TOP_MODELS + IN_USE_EQUIV:
        c = price_cost(total, m["pin"], m["pout"], m["pcr"], m["pcw"])
        equiv.append({"model": m, "cost": c})
    equiv.sort(key=lambda e: -(e["model"]["aa"] or 0))

    # --- usage-derived "in use" families (free/Go/API variants unified) ---
    def fam_key(s):
        s = (s or "").lower().split("/")[-1]
        s = re.sub(r":.*$", "", s)
        s = s.split(" (")[0]
        s = s.replace(".", "-").replace(" ", "-")
        s = re.sub(r"-(free|contributor)$", "", s)
        s = re.sub(r"-(free|contributor)$", "", s)
        return s

    fam_msgs = {}
    for m in models:
        k = fam_key(m["model"])
        fam_msgs[k] = fam_msgs.get(k, 0) + m["messages"]
    used_fams = set()
    for e in equiv:
        rk = fam_key(e["model"]["name"])
        for fk, n in fam_msgs.items():
            if n >= IN_USE_MIN_MSGS and (fk == rk or rk.startswith(fk + "-")
                                         or fk.startswith(rk + "-")):
                used_fams.add(rk)
                break

    # --- history (one snapshot per day = that day's usage; frozen at day end) ---
    today = now.strftime("%Y-%m-%d")

    def day_snapshot(d, backfilled=False):
        rec = {"date": d["day"],
               "generated": now.isoformat(timespec="seconds"),
               "sessions": d["sessions"],
               "input": d["input"], "output": d["output"],
               "reasoning": d["reasoning"], "cache_read": d["cache_read"],
               "cache_write": d["cache_write"],
               "opus55_total": round(d["cost"], 2)}
        if backfilled:
            rec["backfilled"] = True
        return rec

    hist = []
    OUT_DIR.mkdir(parents=True, exist_ok=True)
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
    max_hist = max([h["opus55_total"] for h in hist] + [1])
    peak = max(days, key=lambda d: d["cost"]) if days else None

    # --- flat subscriptions: recorded `actual` is metered value only ---
    cur_ym = now.strftime("%Y-%m")
    subs = []
    for s in SUBSCRIPTIONS:
        y1, m1 = [int(x) for x in s["since"].split("-")]
        y2, m2 = [int(x) for x in cur_ym.split("-")]
        n = (y2 - y1) * 12 + (m2 - m1) + 1
        if n > 0:
            subs.append({"label": s["label"], "months": n,
                         "amount": round(n * s["monthly"], 2)})
    covered = set(p for s in SUBSCRIPTIONS for p in s.get("covers", []))
    metered_covered = round(sum(m["actual"] for m in models
                                if m["provider"] in covered), 4)
    metered_other = round(sum(m["actual"] for m in models
                              if m["provider"] not in covered), 4)
    sub_total = round(sum(s["amount"] for s in subs), 2)
    paid = round(sub_total + metered_other, 2)
    paid_bits = ["%s $%g x %d mo" % (s["label"], s["amount"] / s["months"]
                                     if s["months"] else 0, s["months"])
                 for s in subs]
    if metered_other:
        paid_bits.append("metered overage $%.4f" % metered_other)
    paid_note = (" · ".join(paid_bits) +
                 (" · $%.2f metered value covered by plan" % metered_covered
                  if metered_covered else ""))

    mix_total = sum(m["messages"] for m in models) or 1
    mix = [{"name": m["provider"] + " / " + short_model(m["model"]),
            "msgs": m["messages"],
            "pct": round(100.0 * m["messages"] / mix_total, 1)}
           for m in sorted(models, key=lambda m: -m["messages"])[:3]]

    payload = {
        "generated": now.strftime("%Y-%m-%d %H:%M %Z"),
        "hero": {
            "opus55": total_cost["total"], "sessions": total["sessions"],
            "messages": total["messages"], "actual": paid,
            "metered_covered": metered_covered, "subs": subs,
            "paid_note": paid_note, "mix": mix, "quota": quota,
            "prov": primary["provider"],
            "model": short_model(primary["model"]),
            "avoided": total_cost["total"] - paid,
            "cache_hit": cache_hit, "cache_read": total["cache_read"],
            "cache_in": total["input"] + total["cache_read"],
            "err_rate": err_rate, "calls_err": calls_err,
            "calls_total": calls_total, "overall_min": overall_min,
            "sum_min": sum_min, "active_min": total_active,
            "human_min": human_min,
        },
        "go": go,
        "go_cycles": go_list,
        "go_daily": go_daily,
        "compare_opts": [{
            "name": short_model_name(e["model"]["name"]),
            "aa": e["model"]["aa"], "cpt": e["model"]["cpt"],
            "in_use": fam_key(e["model"]["name"]) in used_fams,
            "pin": e["model"]["pin"], "pout": e["model"]["pout"],
            "pcr": e["model"]["pcr"], "pcw": e["model"]["pcw"],
            "cost": round(e["cost"]["total"], 2)} for e in fams],
        "top20": [{
            "name": e["model"]["name"], "creator": e["model"]["creator"],
            "aa": e["model"]["aa"], "cpt": e["model"]["cpt"],
            "pin": e["model"]["pin"], "pout": e["model"]["pout"],
            "pcr": e["model"]["pcr"], "pcw": e["model"]["pcw"],
            "cost": round(e["cost"]["total"], 2),
            "in_use": fam_key(e["model"]["name"]) in used_fams} for e in equiv],
        "hist": [{"date": h["date"], "opus55": h["opus55_total"]}
                 for h in hist],
        "max_hist": max_hist,
        "peak": ({"day": peak["day"], "cost": peak["cost"]}
                 if peak is not None else None),
        "perday": [{
            "day": d["day"], "sessions": d["sessions"],
            "tokens": d["input"] + d["output"] + d["reasoning"]
                      + d["cache_read"] + d["cache_write"],
            "cost": d["cost"], "active": d["active"],
            "human": d.get("human", 0.0)} for d in days],
        "cats": [{"cat": c, "n": n} for c, n in cat_counts.items() if n],
        "mapping": [{"tool": t, "cat": c, "n": n}
                    for t, c, n in mapping],
        "total_calls": total_calls,
        "projects": [{
            "dir": p["directory"], "sessions": p["sessions"],
            "mins": dir_time.get(p["directory"], 0.0),
            "active_min": active_by_dir.get(p["directory"], 0.0),
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
        "billing_flags": billing_flags,
        "rate429": rate429,
        "credits": credits,
        "prov_rel": [{
            "provider": e["provider"], "msgs": e["msgs"],
            "calls": e.get("calls", 0), "errors": e.get("errors", 0),
            "p50": e["p50"], "p95": e["p95"], "tps": e["tps_p50"],
            "total_min": e["total_min"]} for e in prov_rel],
        "model_rel": [{
            "provider": e["provider"],
            "model": short_model(e["model"]), "msgs": e["msgs"],
            "calls": e.get("calls", 0), "errors": e.get("errors", 0),
            "p50": e["p50"], "p95": e["p95"], "tps": e["tps_p50"],
            "total_min": e["total_min"]} for e in model_rel],
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
            "dur_min": s["dur_min"], "active_min": s["active_min"],
            "msgs": s["msgs"],
            "in_cache": s["input"] + s["cache_read"],
            "out_r": s["output"] + s["reasoning"], "cost": s["cost"],
            "calls": s["calls"],
            "errors": s["errors"] if s["calls"] else None,
            "landed": s["landed"], "intent": s["intent"],
            "scos": (s.get("ctx") or {}).get("scos"),
            "ncr": (s.get("ctx") or {}).get("ncr")}
            for s in featured],
        "habits": habits,
        "ctxagg": ctxagg,
        "ctx_projects": ctx_projects,
        "variants": [{
            "name": name, "msgs": n, "out": out_tok + reas_tok}
            for name, n, out_tok, reas_tok in variants],
        "hours": [{
            "h": hh, "sessions": hours[hh]["sessions"],
            "tokens": hours[hh]["input"] + hours[hh]["cache_read"]
                      + hours[hh]["output"] + hours[hh]["reasoning"]}
            for hh in range(24)],
        "landing": ({"landed": n_landed, "checkable": n_checkable,
                     "no_intent": n_no_intent, "pending": n_pending,
                     "total": len(session_rows_data),
                     "by_model": landed_table(lambda s: s["model_label"]),
                     "by_variant": landed_table(lambda s: s["dom_var"])}
                    if n_checkable else None),
    }
    DATA_JS.write_text("window.__OCUD__ = " + json.dumps(payload) + ";\n")

    SESS_DIR.mkdir(parents=True, exist_ok=True)
    keep = set()
    for s in featured:
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
    try:
        db_kb = DB.stat().st_size / 1024
    except OSError:
        db_kb = 0
    try:
        log_kb = LOG_FILE.stat().st_size / 1024
    except OSError:
        log_kb = 0
    print("wrote " + str(DATA_JS) + " (%.1f KB) + %d session files, "
          "sessions=%d opus55=$%.2f paid=$%.2f (subs=$%.2f metered-covered=$%.4f) "
          "db=%.0fKB log=%.0fKB flags=%d 429_24h=%d"
          % (size_kb, len(keep), total["sessions"], total_cost["total"],
             paid, sub_total, metered_covered, db_kb, log_kb,
             len(billing_flags), rate429["count"]))


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
        "ctx": s.get("ctx"),
    }

if __name__ == "__main__":
    main()
