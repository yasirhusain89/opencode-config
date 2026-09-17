#!/usr/bin/env python3
"""Deterministic SQLite migration validator (black box for agents).

Usage:
    validate_migration.py [--strict] <migration.sql> [...]

Exit 0 (PASS) when no errors; exit 1 (FAIL) on any error.
Warnings never fail unless --strict is given.
"""
import os
import re
import sys

ERRORS = [
    ("DROP TABLE", re.compile(r"\bDROP\s+TABLE\b", re.I),
     "destructive: provide a backup/rename strategy in the same change"),
    ("DROP COLUMN", re.compile(r"\bDROP\s+(COLUMN\b|\"?[A-Za-z_]+\"?\s*[,;])", re.I),
     "destructive: ADD the replacement column + backfill first, drop later"),
    ("ALTER DROP", re.compile(r"\bALTER\s+TABLE\b.*\bDROP\b", re.I | re.S),
     "destructive: ADD the replacement column + backfill first, drop later"),
    ("DELETE sans WHERE", re.compile(r"\bDELETE\s+FROM\b(?![\s\S]*?\bWHERE\b)", re.I),
     "unbounded delete: add a WHERE clause or justify in full"),
    ("FK OFF unclosed", None,
     "PRAGMA foreign_keys=OFF without a matching foreign_keys=ON later in file"),
    ("AMOUNT invariant", re.compile(r"(DROP|ALTER).*amount", re.I),
     "touches an *amount* column: signed-amount invariant (expenses negative, "
     "income positive) must be preserved; dropping amount CHECKs is forbidden"),
]

WARNINGS = [
    ("no PRIMARY KEY", re.compile(r"\bCREATE\s+TABLE\b", re.I),
     "CREATE TABLE without an explicit PRIMARY KEY — confirm intended"),
    ("no down path",
     None, "no reversibility: add a sibling *.down.sql or an in-file "
     "'-- migrate:down' section, or document forward-only"),
]


def split_statements(text):
    """Yield (statement, start_line) splitting on ';' outside strings/comments."""
    stmts, buf, start = [], [], 1
    line, instr = 1, None
    i = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if ch == "\n":
            line += 1
            buf.append(ch)
            if not "".join(buf).strip():
                start = line  # blank gap (incl. comment lines): next stmt starts here
            i += 1
            continue
        if instr:
            buf.append(ch)
            if ch == instr and text[i - 1] != "\\":
                instr = None
            i += 1
            continue
        if ch == "-" and nxt == "-":
            # Line comment: consume through (not incl.) newline without
            # appending, so commented-out SQL never matches rules. The
            # '-- migrate:down' marker is detected separately on raw text.
            i += 2
            while i < len(text) and text[i] != "\n":
                i += 1
            continue
        if ch in ("'", '"', "`"):
            instr = ch
            buf.append(ch)
            i += 1
            continue
        buf.append(ch)
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt.strip(";").strip():
                stmts.append((stmt, start))
            buf, start = [], line
        i += 1
    tail = "".join(buf).strip()
    if tail.strip(";").strip():
        stmts.append((tail, start))
    return stmts


def check_file(path):
    errors, warnings = [], []
    try:
        with open(path) as f:
            text = f.read()
    except OSError as e:
        return [f"{path}:1: ERROR: unreadable file: {e}"], []
    upper = text.upper()
    down_mark = re.search(r"--\s*migrate:down", text, re.I)
    down_line = text.count("\n", 0, down_mark.start()) + 1 if down_mark else None
    # Down migrations legitimately reverse the up side (DROP what was
    # CREATEd), so the three destructive-drop rules apply to UP only.
    UP_ONLY = {"DROP TABLE", "DROP COLUMN", "ALTER DROP"}
    for name, pattern, msg in ERRORS:
        if name == "FK OFF unclosed":
            off = [m.start() for m in re.finditer(r"PRAGMA\s+foreign_keys\s*=\s*OFF", text, re.I)]
            on = [m.start() for m in re.finditer(r"PRAGMA\s+foreign_keys\s*=\s*ON", text, re.I)]
            if off and (not on or min(on) < max(off)):
                errors.append(f"{path}:1: ERROR [FK OFF unclosed]: {msg}")
            continue
        for stmt, ln in split_statements(text):
            if pattern.search(stmt):
                if down_line is not None and ln >= down_line and name in UP_ONLY:
                    continue
                # DELETE check needs statement scope, not whole file
                if name == "DELETE sans WHERE" and re.search(r"\bWHERE\b", stmt, re.I):
                    continue
                errors.append(f"{path}:{ln}: ERROR [{name}]: {msg}")
    for stmt, ln in split_statements(text):
        if re.search(r"\bCREATE\s+TABLE\b", stmt, re.I) and not re.search(
                r"PRIMARY\s+KEY", stmt, re.I):
            warnings.append(f"{path}:{ln}: WARN [no PRIMARY KEY]: "
                            "confirm intended")
    base, ext = os.path.splitext(path)
    has_down = (
        (base.endswith(".up") and os.path.exists(base[: -len(".up")] + ".down" + ext))
        or re.search(r"--\s*migrate:down", text, re.I) is not None
    )
    _ = upper  # reserved for future whole-file checks
    if not has_down:
        warnings.append(f"{path}:1: WARN [no down path]: "
                        "add a sibling *.down.sql or '-- migrate:down', or document forward-only")
    return errors, warnings


def main(argv):
    if "--help" in argv or "-h" in argv or len([a for a in argv if not a.startswith("-")]) == 0:
        print(__doc__.strip())
        return 0
    strict = "--strict" in argv
    files = [a for a in argv if not a.startswith("-")]
    all_errors, all_warnings = [], []
    for path in files:
        e, w = check_file(path)
        all_errors.extend(e)
        all_warnings.extend(w)
    for line in all_errors + all_warnings:
        print(line)
    failed = bool(all_errors) or (strict and bool(all_warnings))
    print(f"{'FAIL' if failed else 'PASS'}: {len(files)} file(s), "
          f"{len(all_errors)} error(s), {len(all_warnings)} warning(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
