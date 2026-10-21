#!/bin/bash
# launch_guard.sh — Heroic "wrapper command" for the Windows Steam entry.
# Runs before Steam exists, so it can safely relock our three sideloaded
# manifests and re-establish the shared-redist parent 228980 (rules 20/26),
# then runs the manifest guard (rules 18/20/26) and blocks the launch with a
# popup when something is still wrong, else execs the real launch command
# Heroic passed as arguments.
#
# Heroic setup: Steam (sideload) entry → Settings → Advanced → Wrapper
# command → paste the full path of this file. Leave "Run with wrapper"
# semantics to Heroic: it calls `this-file <real launch command...>`.
#
# Scope: our three sideloaded apps on the Z: side (2552450 KH3, 292030 Witcher,
# 784080 MW5) — other apps' queues there are normal Steam business and don't
# block. A queued/shadowed manifest of ANY app in the C: prefix library still
# blocks, since the client reads that side first (rule 18).
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPS="2552450 292030 784080"
EXTERNAL="${STEAM_EXTERNAL:-/Volumes/YH-SanP2TB}"
ZLIB="$EXTERNAL/SteamLibrary/steamapps"
CPREFIX="$HOME/Games/Heroic/Prefixes/default/SteamHeroic/drive_c/Program Files (x86)/Steam"
LOG="$HOME/Library/Application Support/heroic/launch_guard.log"

log() { # append a timestamped verdict line + the guard's output
  { echo "=== $(date '+%Y-%m-%d %H:%M:%S') $1"; echo "$2"; } >> "$LOG" 2>/dev/null || true
}

steam_alive() { # relocking is only safe with every Steam client quit
  pgrep -f "Steam/steam.exe" >/dev/null 2>&1 && return 0
  pgrep -f "Steam.app/Contents/MacOS/steam_osx" >/dev/null 2>&1 && return 0
  return 1
}

relock() { # idempotent: idle flags + TargetBuildID=buildid, 228980 installed
  python3 - "$ZLIB" "$CPREFIX" <<'PY'
import os, re, shutil, sys, time

zlib, cprefix = sys.argv[1], sys.argv[2]
apps = ("2552450", "292030", "784080")
bk = os.path.join(zlib, "backups")
ts = time.strftime("%Y%m%d-%H%M%S")
changed = []

PARENT = '''"AppState"
{
	"appid"		"228980"
	"Universe"		"1"
	"LauncherPath"		"C:\\\\Program Files (x86)\\\\Steam\\\\steam.exe"
	"name"		"Steamworks Common Redistributables"
	"StateFlags"		"4"
	"installdir"		"Steamworks Shared"
	"LastUpdated"		"%s"
	"LastPlayed"		"0"
	"SizeOnDisk"		"263949710"
	"StagingSize"		"0"
	"buildid"		"24098430"
	"LastOwner"		"76561199135402914"
	"UpdateResult"		"0"
	"BytesToDownload"		"0"
	"BytesDownloaded"		"0"
	"BytesToStage"		"0"
	"BytesStaged"		"0"
	"TargetBuildID"		"24098430"
	"AutoUpdateBehavior"		"0"
	"AllowOtherDownloadsWhileRunning"		"0"
	"ScheduledAutoUpdate"		"0"
	"InstalledDepots"
	{
		"228983"
		{
			"manifest"		"8124929965194586177"
			"size"		"19265607"
		}
		"228984"
		{
			"manifest"		"2547553897526095397"
			"size"		"13742505"
		}
		"228985"
		{
			"manifest"		"3966345552745568756"
			"size"		"13699237"
		}
		"228986"
		{
			"manifest"		"8782296191957114623"
			"size"		"29759921"
		}
		"228987"
		{
			"manifest"		"4302102680580581867"
			"size"		"29664201"
		}
		"228988"
		{
			"manifest"		"6645201662696499616"
			"size"		"29212173"
		}
		"228989"
		{
			"manifest"		"5753583882400741046"
			"size"		"25674515"
		}
		"228990"
		{
			"manifest"		"1829726630299308803"
			"size"		"102931551"
		}
	}
	"InstallScripts"
	{
		"228983"		"_CommonRedist\\\\vcredist\\\\2010\\\\installscript.vdf"
		"228984"		"_CommonRedist\\\\vcredist\\\\2012\\\\installscript.vdf"
		"228985"		"_CommonRedist\\\\vcredist\\\\2013\\\\installscript.vdf"
		"228986"		"_CommonRedist\\\\vcredist\\\\2015\\\\installscript.vdf"
		"228987"		"_CommonRedist\\\\vcredist\\\\2017\\\\installscript.vdf"
		"228988"		"_CommonRedist\\\\vcredist\\\\2019\\\\installscript.vdf"
		"228990"		"_CommonRedist\\\\DirectX\\\\Jun2010\\\\installscript.vdf"
	}
	"UserConfig"
	{
	}
	"MountedConfig"
	{
	}
}
'''

def field(s, k):
    m = re.search(r'"%s"[ \t]+"([^"]*)"' % k, s)
    return m.group(1) if m else None

def setf(s, k, v):
    return re.sub(r'("%s"[ \t]+)"[^"]*"' % k, lambda m: m.group(1) + '"%s"' % v, s, count=1)

def backup(p, tag):
    os.makedirs(bk, exist_ok=True)
    shutil.copy2(p, os.path.join(bk, "%s.%s-%s.bak" % (os.path.basename(p), tag, ts)))

def relock_app(path):
    s = open(path, encoding="utf-8", errors="surrogateescape").read()
    orig = s
    sf, bid = field(s, "StateFlags"), field(s, "buildid")
    if not bid:
        return
    for k, v in (("StateFlags", "518" if sf == "518" else "4"),
                 ("TargetBuildID", bid),
                 ("BytesToDownload", "0"), ("BytesDownloaded", "0"),
                 ("BytesToStage", "0"), ("BytesStaged", "0")):
        if field(s, k) is not None:
            s = setf(s, k, v)
    if s != orig:
        backup(path, "pre-launch")
        open(path, "w", encoding="utf-8", errors="surrogateescape").write(s)
        changed.append(os.path.basename(path))

def ensure_parent():
    p = os.path.join(cprefix, "steamapps", "appmanifest_228980.acf")
    need = True
    if os.path.isfile(p):
        s = open(p, encoding="utf-8", errors="surrogateescape").read()
        need = field(s, "buildid") in (None, "0") or field(s, "StateFlags") == "2" \
               or s.count('"manifest"') == 0
    if need:
        if os.path.isfile(p):
            backup(p, "pre-launch-stub")
        open(p, "w", encoding="utf-8", errors="surrogateescape").write(
            PARENT % int(time.time()))
        changed.append("appmanifest_228980.acf (restored as installed)")

for app in apps:
    p = os.path.join(zlib, "appmanifest_%s.acf" % app)
    if os.path.isfile(p):
        relock_app(p)
ensure_parent()
print("relock: " + (", ".join(changed) if changed else "all manifests already idle"))
PY
}

if [[ $# -eq 0 ]]; then
  echo "usage: launch_guard.sh <command...>" >&2
  echo "self-test: launch_guard.sh true   (relocks, then exits 0 if guard clear)" >&2
fi

if steam_alive; then
  OUT="  BLOCK: a Steam client is already running — relock/launch would fight it (rule 1).
         Quit mac Steam and Heroic's Windows Steam, then launch again."
  echo "$OUT"
  log "BLOCKED" "$OUT"
  /usr/bin/osascript -e 'display alert "Steam launch blocked" message "Another Steam client is already running. Quit mac Steam and the Windows Steam client, then launch again." as critical' 2>/dev/null || true
  exit 1
fi

RELOCK="$(relock 2>&1)"
echo "$RELOCK"

OUT="$("$SCRIPT_DIR/preflight.sh" --guard-only --apps "$APPS" 2>&1)"
STATUS=$?
echo "$OUT"
if [[ $STATUS -eq 0 ]]; then
  log "CLEAR" "$RELOCK
$OUT"
  [[ $# -eq 0 ]] && exit 0
  exec "$@"
else
  log "BLOCKED" "$RELOCK
$OUT"
  /usr/bin/osascript -e 'display alert "Steam launch blocked" message "A sideloaded manifest is still shadowed/queued, or the shared-redist parent 228980 could not be restored (every game would refuse to launch offline). Ask your agent to inspect it." as critical' 2>/dev/null || true
  echo "launch_guard: BLOCKED — manifest guard failed, not launching." >&2
  exit 1
fi
