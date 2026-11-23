"""Universal local semantic code index for OpenCode projects: ollama embeddings + sqlite-vec.

Works out-of-the-box in ANY project directory (auto-detects current git/project root,
auto-builds .semindex/index.db on first query or when stale >7 days, and writes
.semindex/.gitignore so git status stays clean in any repo without manual setup).

Usage:
    # From any project directory (universal command):
    uv run --with sqlite-vec python ~/.config/opencode/scripts/semantic_index.py query "concept" [-k 5]
    uv run --with sqlite-vec python ~/.config/opencode/scripts/semantic_index.py index [--root DIR]
    uv run --with sqlite-vec python ~/.config/opencode/scripts/semantic_index.py ensure [--gitnexus]
    uv run --with sqlite-vec python ~/.config/opencode/scripts/semantic_index.py status

    # Or via package.json wrappers:
    pnpm semantic:q "concept" -k 5
    npm run semantic:q -- "concept" -k 5

Environment:
    OLLAMA_URL             defaults to http://localhost:11434; non-localhost is refused unless
                           SEMANTIC_ALLOW_REMOTE=1 (source would leave this machine)
    SEMANTIC_ALLOW_REMOTE  set to 1 to knowingly allow a remote OLLAMA_URL
    SEMANTIC_MODEL         defaults to nomic-embed-text (768 dims)
    SEMANTIC_ROOT          optional override for target project root
    SEMANTIC_AUTO_INDEX    defaults to 1 (auto-build on query if missing or >7d stale)
    SEMANTIC_MAX_AGE_DAYS  defaults to 7 (staleness threshold for auto-refresh)

Per-project customization lives in <repo>/.semindex/config.json (committed):
    {"scan_exts": [...], "exclude_dirs": [...], "skip_files": [...],
     "max_file_bytes": 300000, "max_json_bytes": 25000}
Only specify keys that differ from the defaults above. Env vars
SEMANTIC_SCAN_EXTS / SEMANTIC_EXCLUDE_DIRS / SEMANTIC_SKIP_FILES
(comma-separated) and SEMANTIC_MAX_FILE_BYTES / SEMANTIC_MAX_JSON_BYTES
override both. Legacy per-repo scripts (fotoflow/scripts/semantic_index.py,
monartha/python/semantic_index.py) are thin delegates to this file.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import sqlite_vec

SCRIPT_REPO_ROOT = Path(__file__).resolve().parent.parent

# Defaults. Per-project customization lives in <repo>/.semindex/config.json
# (keys: scan_exts, exclude_dirs, skip_files, max_file_bytes, max_json_bytes)
# or via SEMANTIC_SCAN_EXTS (comma-separated), SEMANTIC_EXCLUDE_DIRS,
# SEMANTIC_SKIP_FILES, SEMANTIC_MAX_FILE_BYTES, SEMANTIC_MAX_JSON_BYTES env vars.
DEFAULT_SCAN_EXTS = {
    ".md",
    ".ts",
    ".tsx",
    ".svelte",
    ".js",
    ".mjs",
    ".cjs",
    ".rs",
    ".py",
    ".sql",
    ".sh",
    ".css",
    ".swift",
    ".json",
    ".jsonc",
    ".toml",
}
DEFAULT_EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "build",
    ".gitnexus",
    ".zvec-grep",
    ".semindex",
    ".svelte-kit",
    ".worktrees",
    ".idea",
    ".venv",
    ".check-tmp",
    "coverage",
    "test-results",
    "playwright-report",
    "storybook-static",
    "dist",
    "target",
    "data",
    "generated",
    "snapshots",
    "fixtures",
    "__pycache__",
}
DEFAULT_SKIP_FILES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "uv.lock",
    "dev-snapshot.json",
    "dev-slots.json",
}
# Back-compat aliases (pre-config-file constant names).
SCAN_EXTS = DEFAULT_SCAN_EXTS
EXCLUDE_DIRS = DEFAULT_EXCLUDE_DIRS
SKIP_FILES = DEFAULT_SKIP_FILES
MAX_FILE_BYTES = 300_000
MAX_JSON_BYTES = 25_000


def _csv_env(name: str) -> set[str] | None:
    raw = os.environ.get(name)
    if not raw:
        return None
    return {p.strip() for p in raw.split(",") if p.strip()}


def load_scan_config(root: Path) -> dict:
    """Merge defaults <- <root>/.semindex/config.json <- SEMANTIC_* env vars."""
    scan_exts = set(DEFAULT_SCAN_EXTS)
    exclude_dirs = set(DEFAULT_EXCLUDE_DIRS)
    skip_files = set(DEFAULT_SKIP_FILES)
    max_file_bytes = MAX_FILE_BYTES
    max_json_bytes = MAX_JSON_BYTES
    cfg_path = root / ".semindex" / "config.json"
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text())
            if isinstance(cfg.get("scan_exts"), list):
                scan_exts = {str(e) for e in cfg["scan_exts"]}
            if isinstance(cfg.get("exclude_dirs"), list):
                exclude_dirs = {str(d) for d in cfg["exclude_dirs"]}
            if isinstance(cfg.get("skip_files"), list):
                skip_files = {str(f) for f in cfg["skip_files"]}
            if isinstance(cfg.get("max_file_bytes"), (int, float)):
                max_file_bytes = int(cfg["max_file_bytes"])
            if isinstance(cfg.get("max_json_bytes"), (int, float)):
                max_json_bytes = int(cfg["max_json_bytes"])
        except (OSError, ValueError) as exc:
            log(f"warning: ignoring unreadable {cfg_path} ({exc})")
    if (v := _csv_env("SEMANTIC_SCAN_EXTS")) is not None:
        scan_exts = v
    if (v := _csv_env("SEMANTIC_EXCLUDE_DIRS")) is not None:
        exclude_dirs = v
    if (v := _csv_env("SEMANTIC_SKIP_FILES")) is not None:
        skip_files = v
    try:
        if os.environ.get("SEMANTIC_MAX_FILE_BYTES"):
            max_file_bytes = int(os.environ["SEMANTIC_MAX_FILE_BYTES"])
        if os.environ.get("SEMANTIC_MAX_JSON_BYTES"):
            max_json_bytes = int(os.environ["SEMANTIC_MAX_JSON_BYTES"])
    except ValueError as exc:
        raise SystemExit(f"error: invalid SEMANTIC_MAX_*_BYTES ({exc})")
    return {
        "scan_exts": scan_exts,
        "exclude_dirs": exclude_dirs,
        "skip_files": skip_files,
        "max_file_bytes": max_file_bytes,
        "max_json_bytes": max_json_bytes,
    }

CHUNK_LINES = 60
CHUNK_OVERLAP = 10
EMBED_BATCH = 32
DIMENSIONS = 768


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def resolve_repo_root(explicit_root: str | None = None) -> Path:
    raw = explicit_root or os.environ.get("SEMANTIC_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    cwd = Path.cwd().resolve()
    try:
        out = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip()).resolve()
    except OSError:
        pass
    return cwd if cwd.exists() else SCRIPT_REPO_ROOT


def db_path_for(root: Path) -> Path:
    return root / ".semindex" / "index.db"


def ensure_semindex_gitignore(root: Path) -> None:
    sem_dir = root / ".semindex"
    sem_dir.mkdir(parents=True, exist_ok=True)
    gi = sem_dir / ".gitignore"
    # Commit config.json (project-level scan customization); ignore the DB.
    # Migrate the old blanket "*" form which also hid config.json.
    want = "index.db\nindex.db-wal\nindex.db-shm\n"
    try:
        if not gi.exists() or gi.read_text() != want:
            gi.write_text(want)
    except OSError as exc:
        log(f"warning: cannot write {gi} ({exc})")


def ollama_url() -> str:
    return os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")


def model_name() -> str:
    return os.environ.get("SEMANTIC_MODEL", "nomic-embed-text")


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


def guard_remote_url() -> None:
    host = urlparse(ollama_url()).hostname or ""
    if host in LOCAL_HOSTS:
        return
    if os.environ.get("SEMANTIC_ALLOW_REMOTE") != "1":
        raise SystemExit(
            f"error: OLLAMA_URL={ollama_url()} is not localhost — source code would leave this "
            "machine. Set SEMANTIC_ALLOW_REMOTE=1 to allow intentionally."
        )
    log(f"warning: sending source code to remote ollama at {ollama_url()}")


def embed(texts: list[str]) -> list[list[float]]:
    req = urllib.request.Request(
        f"{ollama_url()}/api/embed",
        data=json.dumps({"model": model_name(), "input": texts}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read())
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"error: cannot reach ollama at {ollama_url()} ({exc}). Start it with: ollama serve"
        ) from exc
    embeddings = body.get("embeddings")
    if not embeddings or len(embeddings) != len(texts):
        raise SystemExit(
            f"error: ollama returned {len(embeddings or [])} embeddings for {len(texts)} inputs"
        )
    return embeddings


def connect_db(db_path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(db_path)
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    return db


def create_schema(db: sqlite3.Connection) -> None:
    db.execute(
        "CREATE TABLE chunks (id INTEGER PRIMARY KEY, path TEXT, start_line INTEGER, end_line INTEGER)"
    )
    db.execute("CREATE INDEX idx_chunks_path ON chunks(path)")
    db.execute(
        f"CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[{DIMENSIONS}])"
    )


def iter_files(root: Path, cfg: dict | None = None):
    cfg = cfg or load_scan_config(root)
    scan_exts = cfg["scan_exts"]
    exclude_dirs = cfg["exclude_dirs"]
    skip_files = cfg["skip_files"]
    max_file_bytes = cfg["max_file_bytes"]
    max_json_bytes = cfg["max_json_bytes"]
    for path in sorted(root.rglob("*")):
        try:
            if not path.is_file() or path.suffix not in scan_exts:
                continue
            rel_parts = set(path.relative_to(root).parts)
            if exclude_dirs & rel_parts:
                continue
            if path.name in skip_files:
                continue
            sz = path.stat().st_size
            if sz > max_file_bytes:
                continue
            if path.suffix == ".json" and sz > max_json_bytes:
                continue
            yield path
        except OSError:
            continue


def chunk_file(root: Path, path: Path) -> list[tuple[str, int, int]]:
    lines = path.read_text(errors="replace").splitlines()
    # Skip minified single-line blobs (>2000 chars on line 1)
    if len(lines) == 1 and len(lines[0]) > 2000:
        return []
    chunks = []
    step = CHUNK_LINES - CHUNK_OVERLAP
    for start in range(0, max(len(lines), 1), step):
        window = lines[start : start + CHUNK_LINES]
        if not any(line.strip() for line in window):
            continue
        rel = path.relative_to(root).as_posix()
        text = f"{rel}:{start + 1}-{start + len(window)}\n" + "\n".join(window)
        chunks.append((text, start + 1, start + len(window)))
    return chunks


def build_index(root: Path) -> None:
    guard_remote_url()
    started = time.time()
    db_path = db_path_for(root)
    ensure_semindex_gitignore(root)
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(db_path) + suffix)
        if p.exists():
            p.unlink()

    files = list(iter_files(root))
    all_chunks: list[tuple[Path, str, int, int]] = []
    for path in files:
        for text, start_line, end_line in chunk_file(root, path):
            all_chunks.append((path, text, start_line, end_line))

    log(f"indexing {len(all_chunks)} chunks from {len(files)} files in {root.name} with {model_name()}...")
    db = connect_db(db_path)
    create_schema(db)
    for batch_start in range(0, len(all_chunks), EMBED_BATCH):
        batch = all_chunks[batch_start : batch_start + EMBED_BATCH]
        embeddings = embed([text for _, text, _, _ in batch])
        cur = db.cursor()
        for (path, text, start_line, end_line), vector in zip(batch, embeddings):
            cur.execute(
                "INSERT INTO chunks(path, start_line, end_line) VALUES (?, ?, ?)",
                (path.relative_to(root).as_posix(), start_line, end_line),
            )
            chunk_id = cur.lastrowid
            cur.execute(
                "INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)",
                (chunk_id, sqlite_vec.serialize_float32(vector)),
            )
        db.commit()
        done = min(batch_start + EMBED_BATCH, len(all_chunks))
        log(f"  {done}/{len(all_chunks)} chunks ({time.time() - started:.1f}s)")
    db.close()
    log(
        f"done: {len(all_chunks)} chunks in {time.time() - started:.1f}s -> {db_path.relative_to(root)}"
    )


def index_needs_rebuild(db_path: Path, max_age_days: float) -> tuple[bool, str]:
    if not db_path.exists():
        return True, "missing"
    age_days = (time.time() - db_path.stat().st_mtime) / 86400.0
    if max_age_days > 0 and age_days > max_age_days:
        return True, f"stale ({age_days:.1f}d > {max_age_days:.0f}d)"
    try:
        db = connect_db(db_path)
        cnt = db.execute("SELECT count(*) FROM chunks").fetchone()[0]
        db.close()
        if cnt == 0:
            return True, "empty"
    except sqlite3.Error:
        return True, "corrupt"
    return False, f"fresh ({age_days:.1f}d)"


def cmd_index(args: argparse.Namespace) -> None:
    root = resolve_repo_root(getattr(args, "root", None))
    build_index(root)


def cmd_ensure(args: argparse.Namespace) -> None:
    root = resolve_repo_root(getattr(args, "root", None))
    db_path = db_path_for(root)
    # Always refresh .semindex/.gitignore (migrates the old blanket "*" form
    # so a committed config.json stays visible while index.db* stays ignored).
    ensure_semindex_gitignore(root)
    max_age = getattr(args, "max_age_days", float(os.environ.get("SEMANTIC_MAX_AGE_DAYS", "7")))
    needs, reason = index_needs_rebuild(db_path, max_age)
    if needs:
        log(f"[{root.name}] semantic index {reason} — building...")
        build_index(root)
    else:
        log(f"[{root.name}] semantic index {reason} — up to date")

    if getattr(args, "gitnexus", False):
        gn_bin = shutil.which("gitnexus")
        if gn_bin and (root / ".git").exists():
            gn_dir = root / ".gitnexus"
            gn_stale = not gn_dir.exists() or (
                max_age > 0 and ((time.time() - gn_dir.stat().st_mtime) / 86400.0) > max_age
            )
            if gn_stale:
                log(f"[{root.name}] running gitnexus analyze --index-only --name {root.name}...")
                subprocess.run(
                    [gn_bin, "analyze", "--index-only", "--name", root.name],
                    cwd=str(root),
                    check=False,
                )
                gn_gi = gn_dir / ".gitignore"
                if gn_dir.exists() and not gn_gi.exists():
                    gn_gi.write_text("*\n")
            else:
                log(f"[{root.name}] gitnexus index fresh — up to date")


def cmd_query(args: argparse.Namespace) -> None:
    guard_remote_url()
    root = resolve_repo_root(getattr(args, "root", None))
    db_path = db_path_for(root)
    auto_index = os.environ.get("SEMANTIC_AUTO_INDEX", "1") != "0"
    max_age = float(os.environ.get("SEMANTIC_MAX_AGE_DAYS", "7"))
    needs, reason = index_needs_rebuild(db_path, max_age if auto_index else 0)
    if needs:
        if auto_index:
            log(f"[{root.name}] semantic index {reason}; auto-building...")
            build_index(root)
        else:
            raise SystemExit(
                f"error: semantic index {reason} at {db_path}. Run: npm/pnpm run index:semantic"
            )

    db = connect_db(db_path)
    vector = embed([args.text])[0]
    rows = db.execute(
        """
        SELECT c.path, c.start_line, c.end_line, v.distance
        FROM vec_chunks v
        JOIN chunks c ON c.id = v.chunk_id
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance
        """,
        (sqlite_vec.serialize_float32(vector), args.k),
    ).fetchall()
    db.close()
    for rank, (path, start_line, end_line, distance) in enumerate(rows, 1):
        print(f"{rank}. {path}:{start_line}-{end_line}  (distance {distance:.3f})")
        snippet = read_snippet(root, path, start_line, min(end_line, start_line + 3))
        for line in snippet:
            print(f"   {line}")
    if not rows:
        print("no results")


def read_snippet(root: Path, path: str, start_line: int, end_line: int) -> list[str]:
    file_path = root / path
    try:
        lines = file_path.read_text(errors="replace").splitlines()
    except OSError:
        return ["   <unreadable>"]
    return [
        f"   {lines[i - 1].strip()[:120]}" for i in range(start_line, min(end_line, len(lines)) + 1)
    ]


def cmd_status(args: argparse.Namespace) -> None:
    root = resolve_repo_root(getattr(args, "root", None))
    db_path = db_path_for(root)
    if not db_path.exists():
        print(f"no index at {db_path.relative_to(root)} (root={root})")
        return
    age_days = (time.time() - db_path.stat().st_mtime) / 86400.0
    db = connect_db(db_path)
    chunks = db.execute("SELECT count(*) FROM chunks").fetchone()[0]
    files = db.execute("SELECT count(DISTINCT path) FROM chunks").fetchone()[0]
    db.close()
    print(
        f"{chunks} chunks across {files} files | {db_path.relative_to(root)} ({age_days:.1f}d old) | root {root.name} | model {model_name()}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Universal local semantic code index (ollama + sqlite-vec)")
    parser.add_argument("--root", help="Target project root directory (defaults to current git root / cwd)")
    sub = parser.add_subparsers(dest="command", required=True)

    p_idx = sub.add_parser("index", help="rebuild the index")
    p_idx.add_argument("--root", help="Target project root directory")
    p_idx.set_defaults(func=cmd_index)

    p_ens = sub.add_parser("ensure", help="auto-build or refresh index if missing/stale")
    p_ens.add_argument("--root", help="Target project root directory")
    p_ens.add_argument("--max-age-days", type=float, default=7.0)
    p_ens.add_argument("--gitnexus", action="store_true", help="Also ensure .gitnexus is indexed")
    p_ens.set_defaults(func=cmd_ensure)

    q = sub.add_parser("query", help="semantic search (auto-builds index if missing/stale)")
    q.add_argument("text")
    q.add_argument("-k", type=int, default=8)
    q.add_argument("--root", help="Target project root directory")
    q.set_defaults(func=cmd_query)

    p_st = sub.add_parser("status", help="index stats")
    p_st.add_argument("--root", help="Target project root directory")
    p_st.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
