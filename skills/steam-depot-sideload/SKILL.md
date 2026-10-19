---
name: steam-depot-sideload
description: Use ONLY when installing a Windows-only Steam game on macOS that the Windows Steam client (Heroic/Wine, runner=sideload) cannot download itself — download depots via the macOS Steam console (download_depot), store them on an external drive, assemble the install, and write the appmanifest so the Windows client registers it. Triggers "steam game won't download", "windows-only game on mac", "download_depot", "session replaced", "no connection" depot failure, "appmanifest", "sideload steam game", "heroic steam".
---

# Steam depot sideload (mac download → Windows play)

Pipeline: **macOS Steam console** downloads Windows depots to an external drive →
files assembled into the shared SteamLibrary → hand-written `appmanifest_<appid>.acf`
→ Windows Steam (Heroic/Wine) sees the game as installed.

Windows-only Steam games never appear in macOS Steam's library UI, and Heroic's
Windows Steam often cannot download (CDN/auth failures). The macOS client CAN
download Windows depots once forced — that is the whole trick.

## Hard rules (each one cost a debugging session)

1. **One Steam client logged in at a time.** Heroic's Windows Steam steals the
   session: the macOS client logs off with `Session Replaced` and does NOT
   auto-reconnect. Symptom: `Failed to initialize depot ... (No connection)`.
   Fix: quit Heroic + all `wine64-preloader`/`SteamHeroic` processes, fully
   restart macOS Steam, verify `RecvMsgClientLogOnResponse() : 'OK'` is the
   newest connection_log entry. Never launch Heroic mid-download.
2. **`@sSteamCmdForcePlatformType windows` — NO `=` sign.** With `=` the convar
   becomes the literal string `= windows` and depot auth breaks.
3. **`download_depot` takes TWO args**: `download_depot <appid> <depotid>`.
   One arg just prints usage. Each depot is a separate command.
4. **Redirect depot writes off the main drive first.** `download_depot` writes
   to `Steam.AppBundle/Steam/Contents/MacOS/steamapps/content/app_<id>/…` —
   inside the app bundle on the main disk by default (this is how 62GB of
   orphaned cache ended up there once). Symlink that path to
   `<external>/SteamDepotCache` — `preflight.sh` does this and refuses to
   clobber a real directory.
5. **Console "N files" ≠ manifest file count.** The `Downloading depot 784081
   (961 files …)` line counted 961; the depot's real content list
   (`Manifest_NonUFSFiles_Win64.txt`) had 874. Verify against the manifest
   file, never the console number.
6. **Paid campaign DLC often has NO depot of its own.** `licenses_print` shows
   `(0 in total)` depots for such packages and the DLC's `app_info_print` has
   no `"depots"` section. The content ships inside the base depot
   (`"hasdepotsindlc" "1"` on the base app) and is gated by license at
   runtime. Check the downloaded base depot for DLC-named files before hunting
   per-DLC depot IDs that do not exist.
7. **Timeouts are resumable, not fatal.** Re-run the same `download_depot`
   command; Steam resumes the partially-written files (verified: a 106GB .pak
   resumed mid-file). Run `caffeinate -i` during long downloads.
 8. **The agent cannot type into Steam's console** (no assistive access for
    osascript). The human pastes commands; the agent reads
    `~/Library/Application Support/Steam/logs/console_log.txt` — command OUTPUT
    is echoed there, the commands themselves are not.
 9. **Open the console** with `open "steam://open/console"` (or Steam → the URL
    bar trick after enabling it in Settings → Interface). The log always shows
    the URL doubled (`ExecuteSteamURL: "steam://open/steam://open/console"`) —
    harmless, the tab still opens.
10. **Register EVERY depot that has a public manifest — even "0.0GB" ones.**
    MW5 got away with skipping shared/no-manifest depots, but KH3's two 0.0GB
    depots (which DO have manifest GIDs) made Windows Steam demand an "update"
    it could never fetch. Rule of thumb: skip only `depotfromapp` (shared) and
    no-public-manifest depots; download + register everything else, no matter
    how small.
11. **Corrupted resume: `Assertion Failed ... same chunk requested twice`.**
    The depot's `state_<appid>_<depotid>.patch` + partial dir are wedged.
    Fix: quit Steam fully, then `steamdepot.py reset --appid N --depotid N`
    (deletes both), relaunch, re-run `download_depot` fresh.
12. **Back up `common/<installdir>/` before assembling.** A same-volume `mv`
    is *supposed* to be atomic, but an unexplained loss once ate 64GB of a
    fresh depot mid-assemble. `cp -R` the target aside; delete the backup only
    after the Windows client verifies clean.

## Key paths

| What | Path |
|---|---|
| macOS Steam dir | `~/Library/Application Support/Steam` |
| Depot-cache symlink target | `Steam.AppBundle/Steam/Contents/MacOS/steamapps` → `<external>/SteamDepotCache` |
| Downloaded depots land in | `<external>/SteamDepotCache/content/app_<appid>/depot_<depotid>/` |
| Console output log | `~/Library/Application Support/Steam/logs/console_log.txt` |
| Session state log | `~/Library/Application Support/Steam/logs/connection_log.txt` |
| Shared game library | `<external>/SteamLibrary/steamapps/` (both clients read it) |
| Windows Steam (Heroic prefix) | `~/Games/Heroic/Prefixes/default/SteamHeroic/drive_c/Program Files (x86)/Steam` — its `libraryfolders.vdf` registers `Z:\Volumes\<external>\SteamLibrary` |
| Heroic launch options | `--no-gui --no-sandbox "heroic://launch?appName=steam&runner=sideload"` |

## Workflow

All scripts live in this skill's `scripts/`; `steamdepot.py` subcommands do
log parsing, verification, and manifest writing. `preflight.sh` defaults to
`/Volumes/YH-SanP2TB`; override with `--external` or `STEAM_EXTERNAL`.

### 1. Preflight

```bash
preflight.sh --kill-heroic          # or --check-only to just report
```

Kills Heroic/Wine, warns if the session was kicked, creates the redirect
symlink, reports disk space.

### 2. Discover the depot layout (human pastes into console)

```
licenses_print          → what the account owns, and which depots each package grants
app_info_print <appid>  → name, oslist, public buildid, depots + manifest GIDs + sizes, listofdlc
```

Then read it back without copy-pasting — **promptly**: `console_log.txt`
rotates on client restart, taking the `app_info_print`/`licenses_print`
output with it. Parse (or save the relevant lines) before quitting Steam.

```bash
steamdepot.py appinfo --appid <appid>   # depots, buildid, installdir, DLC list
steamdepot.py licenses                  # package → apps → depots ('(0 in total)' = content rides in base depot)
```

List every depot on the app that has a public manifest `gid` — the biggest is
the game content, but small ones (even "0.0GB") are required too (rule 10).
`depotfromapp` entries are shared depots — nothing to download. Download each
needed depot with its own `download_depot <appid> <depotid>` command; several
can be in flight and `monitor_depot.sh` reports per-depot status.

### 3. Download (human pastes, agent monitors)

```
@sSteamCmdForcePlatformType windows
download_depot <appid> <depotid>
```

```bash
monitor_depot.sh --watch 60   # per-depot lines: latest event + on-disk size
```

On `Depot download complete : ... (manifest <GID>)` — note that GID, it goes
in the manifest. On timeout, just re-run the same command. On the `same chunk
requested twice` assertion, do the rule-11 reset instead of retrying.

### 4. Assemble

```bash
cp -R "common/<installdir>" "<external>/<game>-backup-$(date +%Y%m%d)"  # rule 12
assemble_install.sh --appid <appid> --depotid <depotid> \
  --installdir "<dir from appmanifest or steamdepot.py appinfo>" \
  [--no-manifest]   # only if the depot ships no Manifest_*.txt (else hard-fails)
```

Verifies every manifest-listed file exists (or does a structural sanity check
with `--no-manifest`: file count, total size, entry-point `.exe` present), then
places the depot tree **verbatim** under `common/<installdir>/` (depot-relative
paths map 1:1 — a depot top dir named same as the installdir NESTS by design).
**Ground truth for nesting is the launch exe path**: `app_info_print`'s
`"executable"` (e.g. `KINGDOM HEARTS III\Binaries\Win64\...exe` means the exe
lives at `<installdir>/KINGDOM HEARTS III/Binaries/...`, nested), or a
"Missing game executable" dialog, which prints the exact expected path.
Merging a same-named dir flat (as an early script version did) breaks the
launch. Deeper collisions (two depots contributing to the same dir) recurse;
identical file paths across depots overwrite with a loud `OVERWRITE (overlap)`
warning naming both sizes — assemble order decides the winner, `content_log`
decides who's right. Every move is asserted (source gone + dest present) —
any mismatch aborts loudly instead of losing files.

### 5. Write the appmanifest

```bash
steamdepot.py manifest --appid <appid> --library <external>/SteamLibrary \
  --installdir "<dir>" --name "<title>" --buildid <public buildid> \
  --depot <depotid>:<manifest GID>:<size from appinfo> \
  [--dlc-depot <depotid>:<GID>:<size>:<dlcappid>]
```

Patches in place (backs up `.bak`, preserves `UserConfig`/`LastOwner`),
setting `StateFlags 4`, zeroing download counters, recording `InstalledDepots`.
Fresh installs also need `--lastowner <steamid64>` (copy from any existing
manifest, or the Windows Steam prefix's manifests).

**Verify the assembled tree BEFORE writing the manifest** — `.exe` present,
sane file count and size vs the download. The manifest is trivially rewritable;
a mangled install dir is not (rule 12). `manifest` in patch mode *replaces*
the whole `InstalledDepots` block, so when adding depots later, re-pass ALL
of them (`--depot` is repeatable) plus `--buildid`.

**Verify the depot tree is stable before assembling too**: if the `complete`
line hasn't printed yet, wait — moving files mid-flush corrupts the install.
Size + file count matching the expected download is the ground truth (rule 5).

### 6. Validate

In the **Windows** Steam client: Properties → Installed Files → **Verify
integrity of game files**. Nothing (or a few KB) downloading = manifest is
correct. Then launch via Heroic. DLC ownership shows in-game.

If a stale update stays queued after the files are fixed (client holds it in
`StateFlags` — e.g. `38` = installed + update-paused — plus scheduler state):
fully quit the Windows Steam client, set `StateFlags` back to `4` in the
shared `appmanifest_<appid>.acf`, relaunch. Steam recomputes the queue from
the files on startup; with everything satisfied the queue clears and PLAY
appears. Check `content_log.txt` afterward to confirm no new prefetch.

## Worked example — MechWarrior 5 (2026-10-18)

- `app_info_print 784080` → depot `784081`, public manifest
  `7031484150434950645`, size 119.7GB / download 46.7GB, buildid `25504623`,
  installdir `MechWarrior 5 Mercenaries`.
- `licenses_print` → base pkg `236580` grants depot `784081`; six campaign-DLC
  packages showed `(0 in total)` depots → all campaign content was inside
  `784081` (36 DLC movie files confirmed in the downloaded tree). **No DLC
  downloads were needed.**
- Download 874 files → verified 874/874 → assembled 113GB into
  `common/MechWarrior 5 Mercenaries/` (merged with existing `DigitalExtras/`)
  → patched manifest → Windows Steam verify passed → launched via Heroic.

## Worked example — Kingdom Hearts III + Re Mind (2026-10-18)

- App `2552450`: content depot `2552452` (71.8GB on disk, manifest
  `924501402764314992`) + two 0.0GB depots `2552453`/`2552454` WITH manifests.
  Registering only the big depot made Windows Steam demand an un-fetchable
  "update" (rule 10) — all three depots went into `InstalledDepots`.
- This depot ships **no `Manifest_*.txt`** → `verify` has no file list;
  `assemble_install.sh --no-manifest` does structural sanity + `.exe` check.
- First assemble lost 64GB (`Engine/` + `Binaries/`) on the flaky disk and
  the recovery initially "fixed" the nesting the wrong way (merging the
  depot's same-named dir flat). The `Missing game executable` dialog gave the
  true layout: depot trees install **verbatim**, same-named top dir nests by
  design. Lesson codified in step 4: the launch exe path is ground truth.
  Script now asserts every move and aborts loudly instead of losing files.
- A mid-download `same chunk requested twice` assertion needed the rule-11
  reset (quit Steam → `steamdepot.py reset` → relaunch → re-download).
- Depots `2552453` and `2552454` ship **different files to the same path**
  (`Content/Movies/{en,ja}/Copyright.mp4`, ~4.6MB vs ~1.6MB each). Steam
  resolves the collision itself: `content_log.txt` shows
  `config changed : removed depots 2552454` plus the winner's exact demand
  (`7668192 bytes to download, 9266913 bytes to stage` = 2552453's full
  content). So the rule is **Steam's pick wins, not numeric order** —
  read the log, place the winner's bytes, don't guess.
- **The Windows client's own logs are the decisive diagnostic** and readable
  from macOS:
  `~/Games/Heroic/Prefixes/default/SteamHeroic/drive_c/Program Files (x86)/Steam/logs/content_log.txt`
  shows per-app state changes, prefetch byte counts, depot removals, and CDN
  auth results. Check it before theorizing about an update queue.
- **Unhealthy disk caution.** Bad sectors cause silent file loss, empty dir
  shells, wedged state files, and hung commands — several "script mysteries"
  traced back to the disk, not the script. On a suspect drive: no tree-wide
  `find`/`du` scans, no bulk copies; small targeted I/O only, timeouts on
  everything, verify each write individually (size check, not full re-read),
  and keep the `common/<installdir>/` backup until the Windows client verifies
  clean. Never run repair tools unasked.
- Endgame: `Missing game executable` → restructured to the dialog's exact path
  → `StateFlags 38 → 4` with Steam closed → relaunch recomputed a clean queue
  → **PLAY appeared and the game runs**. Keep the backup until this point;
  delete it after to reclaim the space.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `Failed to initialize depot ... (No connection)` | Session kicked by Heroic's Windows Steam → rule 1 |
| `Failed updating depot ... (Connection timeout)` | Transient → re-run same command, it resumes |
| `download_depot` prints usage string | Missing the appid arg → rule 3 |
| Convar echo shows `"= windows"` | Used `=` → rule 2 |
| Depot writes filling main drive | Redirect symlink missing → preflight.sh |
| Fewer files than console claimed | Normal → rule 5, verify against manifest |
| DLC missing in-game | Check licenses + base-depot content first → rule 6 |
| Steam UI shows Install instead of Play | appmanifest missing/wrong in the *shared* library, or the Windows client's `libraryfolders.vdf` lacks that library → check both clients' `steamapps/` |
| Steam shows Update for a sideloaded game (CONTENT SERVER UNREACHABLE) | A depot you own isn't registered in `InstalledDepots` (rule 10) — or files are missing from `common/<installdir>/` (compare against backup). Add the depot(s), verify the tree, re-patch manifest. Read the Windows `content_log.txt` first: its prefetch line names the exact missing bytes |
| Verify says "All 0 files successfully validated" | Ambiguous — may mean it counted nothing (hand-written manifests lack per-file tracking). Treat as "no failures reported", not proof of a deep check |
| `Assertion Failed ... same chunk requested twice` | Wedged resume state → rule 11: quit Steam, `steamdepot.py reset`, relaunch, re-download |
| Log shows doubled `steam://open/steam://open/...` URL | Normal logging quirk — the console tab still opens |
| No Play in menu / "Missing game executable" on launch | Exe path in the install dir doesn't match the launch config — check `app_info_print`'s `"executable"` or the dialog's exact expected path, restructure to match. Distinguish from a mere queued update (MW5 played fine with one queued) |
| Direct exe launch via Wine shows nothing | Attempted as a gate bypass: no DRM markers found, but no window and no error either — cause unresolved. Treat as unproven last resort, not part of the pipeline. If tried: user-side step, exe's own dir as cwd, one attempt at a time, kill after; never background-spam Wine processes |
| Client in Offline Mode | Play works offline for satisfied installs; queued updates are irrelevant until back online. Go Online only when ready to let queued updates attempt (they'll fail here — that's expected, not a regression) |
