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
5. **Console "N files" counts entries, not files.** The `Downloading depot
    292033 (57 files …)` line counted 57; the depot held 48 files + 9
    directories. Same for the shortfalls that look like incomplete downloads
    (154→121, 3→1): re-downloads, manifest parses, and merges all agreed the
    files were complete — directories explain the gap. Verify against the
    manifest file or depotcache parse, never the console number.
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
10. **Register what Steam's own manifest lists — not what licenses suggest.**
    `licenses_print` over-includes (language packs, un-deployed depots); the
    `config changed : updated depots` lines list update-touched depots, a
    different thing again. Procedure: write your best manifest, launch the
    Windows client once, quit it, and read back `InstalledDepots` — Steam
    reconciles the set from its own config every launch and reverts anything
    else. Feed it the *files* for ITS set; hand-editing the set is futile.
    (KH3 needed its two 0.0GB depots registered; Witcher needed three depots
    licenses didn't obviously flag — the read-back is what settled both.)
11. **Corrupted resume: `Assertion Failed ... same chunk requested twice`.**
    The depot's `state_<appid>_<depotid>.patch` + partial dir are wedged.
    Fix: quit Steam fully, then `steamdepot.py reset --appid N --depotid N`
    (deletes both), relaunch, re-run `download_depot` fresh. **False
    completes are the same file wearing a mask:** if the depot was assembled
    into the tree, the state file stays behind claiming everything is
    fetched — the next `download_depot` prints `Depot download complete`
    with 0B on disk. Same fix. `assemble_install.sh` now deletes the state
    file after a successful merge, and `monitor_depot.sh` flags
    complete-but-empty as `FALSE COMPLETE` with the exact reset command.
12. **Back up `common/<installdir>/` before assembling.** A same-volume `mv`
    is *supposed* to be atomic, but an unexplained loss once ate 64GB of a
    fresh depot mid-assemble. `cp -R` the target aside; delete the backup only
    after the Windows client verifies clean.
13. **A pinned old Windows client can NEVER download — plan around it, don't
    fight it.** Client `1726604483` (Sept 2024, last build compatible with this
    Heroic/Wine setup) fails 100% of chunk unpacks:
    `Failed unpacking chunk "<sha>" from ".../depot/<id>/chunk/..." (Unpack
    failed (c:<compressed>,u:0,...))` across all depots and CDN edges, zero
    successes ever in `content_log.txt` — while logins, prefetches, and
    metadata all work. Check the client version in the log's `Client version:`
    line before blaming the network. Consequence: the Windows client is a
    player/verifier only; every byte must arrive via the macOS console.
14. **Never let the old client run an update on an incomplete install.**
    Staging deletes/truncates files it intends to replace, then the unpack
    failure means replacements never arrive — one attempt ate 136 files
    (1.3GB), including the launch exe. Quarantine the install (keep Heroic
    quit / client offline) until macOS-side assembly + manifest diff show zero
    missing. **Both clients reconcile the shared library**: if the macOS
    client's `libraryfolders.vdf` also registers the external drive, it
    rewrites hand-patched manifests too (observed: depot set + counters
    reverted with only the mac client running). **The mac client reconciles
    continuously while it runs, not just at launch** — during a later
    download session it flipped two working manifests back to queued
    (`292030`: 4→6 + 44GB "update" to public, `784080`: 518→6) with no
    launch involved. Permanent fix: the mac client does NOT need the shared
    library (depot bytes go through the `steamapps` symlink redirect,
    rule 4) — unregister the external drive from the MAC client's
    `config/libraryfolders.vdf` (delete the external library block with the
    client quit, back it up first) and leave it registered only in the
    Windows prefix's `libraryfolders.vdf`. Until then, re-lock manifests
    (StateFlags 4/518 + zeroed counters) with ALL clients quit right before
    every Windows Steam launch. Do manifest surgery with all
    Steam clients quit, and re-read the manifest afterward to confirm.
15. **`BytesStaged`/`BytesToDownload` accounting names the gap exactly.**
    The staged byte count equals the uncompressed sizes of the missing depots
    summed to the byte (Witcher: `5357421741` =
    `4439952978+262696726+654772037`). Match it against per-depot sizes from
    `app_info_print` or the steamcmd.net API to identify which depots to fetch.
16. **`api.steamcmd.net/v1/info/<appid>` replaces most console reads.**
    Returns buildid per branch, every depot's manifest GIDs + sizes, the
    launch `"executable"`, `dlcappid` mapping, and language tags — no console
    paste needed, no log rotation risk (SteamDB 403s; this doesn't). Use the
    console only for `download_depot` itself.
17. **Exact missing-file list beats all guessing: parse `depotcache`.**
    The Windows prefix keeps `Steam/depotcache/<depot>_<gid>.manifest` for
    every configured depot. Format: 8-byte header, then protobuf FileMappings
    (f1 = backslash path, f2 = size, f3 = flags with 64 = directory; see
    `steamdepot.py depotcache_files`). `steamdepot.py verify --depotcache
    <manifest> --root <tree>` diffs any tree — fresh depot dir OR assembled
    `common/<installdir>/` — against it, reporting missing files and
    SIZE-MISMATCHES (0-byte husks, truncation, flaky-disk bitrot that changes
    size; same-size bitrot still needs Steam's own hash verify, rule 21).
    Sizes in the manifest also name a depot's true file count (rule 5's
    console numbers and even materialized counts can both be short).
18. **A shadow install in the prefix library overrides the real one — check
    before fetching a single byte.** If the client's Properties → Updates
    shows a Build ID / size / date that disagrees with your library manifest
    (Witcher: UI said 14504303 + 57GB + Jul 2025, manifest said 25773555),
    the client is reading a STALE `appmanifest_<appid>.acf` + empty dir
    skeleton in its OWN prefix library (`.../Steam/steamapps/`, the C: side)
    — failed updates leave these 0-byte husks behind — and validating the
    empty husk produces thousands of phantom "missing" files while the real
    install sits ignored. Fix with everything quit: move the stale manifest
    and husk aside (back up, don't delete), relaunch — the client discovers
    the real library manifest. Also glance at the prefix `common/` for other
    0-byte husks shadowing real installs.
19. **New game binaries may need newer Wine — test in a copied prefix.**
    Witcher 5.01 (Oct 2026 exes) page-faulted at one fixed address under GPT
    7.7-era AND GPT 3.0-3, with or without Steam running; Wine Staging 11.18
    booted the same binary to GPU init. When the binary is newer than the
    runner, climb the Wine ladder. Test in a `cp -R`'d prefix copy in /tmp
    (never the live prefix), and kill stray wineservers first:
    running two Wine versions against one prefix gives `version mismatch`
    plus misleading fallout (phantom "dll not found"). `wineserver -k` with
    that `WINEPREFIX` before switching.
    Notes: Gcenx macOS builds ship as `Wine Staging.app`, loader is
    `bin/wine` (no `wine64`); dxvk-macOS ships no `dxgi.dll` (its d3d11 warns
    `Adapter is not a DXVK adapter` but initializes anyway); the REDlauncher
    self-updater can eat its own exe (BackgroundPrefetch) leaving only
    config+logs — the prelauncher reinstalls it from the shipped `.msi` on
    next launch.
20. **The old client stages (deletes!) queued updates at launch — even
    offline.** A fresh launch reconciles the shared library: any app whose
    manifest says queued/started (`StateFlags` 6 or 38, even with 0 bytes to
    fetch) gets staged — files deleted FIRST, replacements fetched after
    (which fail per rule 13). Observed: one relaunch deleted an entire 40GB
    install (KH3) and flipped MW5's working 518 state back to 6. Defenses:
    keep manifests in non-queued states (`StateFlags 4` + zeroed counters, or
    MW5's proven 518 + zeros with its `ScheduledAutoUpdate` left intact), do
    ALL manifest surgery with every Steam client quit, and never press
    Play/Verify on a queued app. If a game was already emptied: park its
    manifest (rename aside so the client sees it uninstalled and won't touch
    the husk), re-download via mac, reassemble, restore the manifest.
    Residue of a staging pass: `downloading/` entries, `state_*.patch`
    files, and `.bak` manifests in `steamapps/`.
21. **Presence is not integrity: re-verify bytes, not just file lists.** On a
    flaky disk a file can be present, right-sized, and corrupt (bitrot after
    a hash-verified download). Symptom: a deterministic crash while loading
    one specific file (Witcher: Scaleform-init crash whenever
    `content/content0/cookedfinal.redscripts` loaded; hiding that one file
    reached the main menu, loading saves, music). Diagnose by hash, not
    size: fresh `download_depot` bytes vs tree bytes — same size but
    different SHA with valid headers still means corruption (here the two
    builds' files were identical for 5.5MB then fully diverged in the last
    1.1MB string table). Fix: `steamdepot.py reset` the depot and
    re-download (33GB to repair 6.6MB — it was the whole game). Keep depot
    caches until the game actually runs, and distrust presence-only `verify`
    when crash-hunting.
22. **Rolling back branches: take GIDs from a real prior install, and don't
    trust `-beta` on the mac console.** `download_depot <app> <depot> -beta
    <branch>` is silently ignored by the mac console (fetches public
    anyway — even with the mac client itself opted into the beta). Reliable
    path: switch branch in the Windows client (Properties → Betas), launch
    once so it discovers the branch server-side, then download with explicit
    manifest IDs: `download_depot <app> <depot> <gid>`. Sources for the GIDs,
    in order: a previous install's manifest (even a stale/shadow one — its
    `InstalledDepots` GIDs are real branch manifests), surviving
    `depotcache/<depot>_<gid>.manifest` non-public variants (other-branch
    builds the client kept), and the client's `config changed` line.
    Expect reorganization across branches: Witcher next-gen/4.04 deploys 29
    depots (vs public's 26) — including 19 DLC depots that CARRY bytes (not
    the public branch's 0.0GB placeholders) and a reorganized base
    (next-gen 292031: 2118 entries/33GB vs public 1777/52GB). Full 4.04 GID
    table is in the worked example below.
23. **Snapshot the Wine prefix before touching Wine versions; suspect the
    prefix when ALL games break at once.** Symptoms: every Steam game fails
    identically at launch (UE `Fatal error!` with `Unhandled Exception:
    0x20474343`, instant exits) while trees and manifests verify clean —
    right after mass process kills or client chaos. Diagnose: run one game's
    exe in a FRESH prefix under a known Wine (proves game + system fine) vs
    the live prefix (fails) — divergence convicts the prefix (wineserver /
    registry damage from `kill -9`, wedged 99%-CPU helpers). Fix: restore
    the pre-experiment backup — always `cp -R default
    default.pre-<change>-bak` BEFORE switching runners, restore by renaming
    with everything quit. Don't churn the Wine version chasing a prefix
    problem: the live Steam entry stays on GPT 3.0-3 + Esync/Msync throughout.
24. **Run `preflight.sh` (guard scan) before EVERY Windows Steam launch** —
    automatic once the Heroic wrapper is set: `launch_guard.sh` now
    auto-relocks first (rule 26's parent + idle child flags, since Steam
    requeues them on every launch) and refuses to run while any Steam client
    is alive. Its wrapper path lives in
    `~/Library/Application Support/heroic/GamesConfig/steam.json` →
    `steam.wrapperOptions`; verify a real launch wrote `CLEAR`/`BLOCKED` to
    `~/Library/Application Support/heroic/launch_guard.log` (no line = the
    field did not fire). The guard reads both manifest locations and warns —
    read-only — about
    anything a launch would act on: C:-side shadow manifests disagreeing
    with the Z: library (rule 18), and queued manifests on either side
    (`StateFlags` not 4/518 or nonzero BytesToDownload/BytesToStage) that
    would trigger staging deletes (rule 20), and now HARD-BLOCKS an absent or
    stub `228980` (rule 26) instead of calling it inert. It also caught a ghost queue
    this way (classic-Witcher parent app `228980`: queued 25MB on C: with no
    install dir anywhere). Do NOT park that one (rule 26) — an absent
    `228980` manifest is what the client replaced with a `StateFlags 2`
    stub, which then blocked every dependent game. `steamdepot.py manifest` also refuses to run while any Steam client
    is alive (`--force` overrides), and keeps timestamped history in
    `steamapps/backups/` (the single `.bak` gets clobbered and `/tmp` gets
    wiped — both burned us).
25. **A mixed-branch tree runs but stalls: verify PER DEPOT, and repair from
    `SteamDepotCache`.** Games whose depots were assembled across branches
    (e.g. Witcher 4.04 binaries over 5.01 assets) boot and play, then hang on
    a loading screen for any scene that streams new bundles — dialogue with a
    merchant, cutscenes — because the asset index (`content/metadata.store` /
    `metadata.censored.store`, `dlc/*/content/metadata.store`,
    `*.texture.cache`) belongs to the other build. Global "tree has N files"
    checks miss it. Run `steamdepot.py verify --depotcache
    <depotcache>/<depot>_<gid>.manifest --root common/<dir>` for EVERY depot
    in `InstalledDepots` (stat-only, seconds); mismatches name the exact bad
    file. Repair from `SteamDepotCache/content/app_<appid>/depot_<depot>/`
    when the download is still cached (it survives assembly — check before
    assuming a re-download); `metadata.censored.store` often equals
    `metadata.store` byte-for-byte at the same size, so the installed copy
    can fill it. Depots whose cache was emptied need a real
    `download_depot`.
26. **The shared-redist parent `228980` gates EVERY dependent game: keep it
    looking installed, or all of them show update and refuse to launch
    offline.** `228980` (Steamworks Common Redistributables) is the
    `depotfromapp` parent for `228989`/`228990` (KH3) and `228984`/`228985`/
    `228988`/`228990` (Witcher, MW5), declared in the CHILD's public appinfo —
    so it forms even when the child manifest is perfect. With an empty stub
    (`buildid 0`, `StateFlags 2`, `InstalledDepots {}`) the client logs
    `AppID 228980 state changed : Update Required,Shared Only`, then
    `Dependency added: parent 228980, child <app>, depot 22898x`, then each
    child reads `Update Required,Fully Installed` — even when the child's
    `buildid` equals public (KH3/MW5 were current) and its bytes are zero.
    Clicking PLAY shows **"An error occurred while launching this game:
    Downloads disabled"**. This is NOT a per-game problem: every dependent
    breaks at once. Diagnose: `grep -E "AppID 228980|Dependency added"`
    content_log, and `api.steamcmd.net/v1/info/228980` for the public
    buildid (`24098430`). Fix with all clients quit: write `228980` as
    installed — `StateFlags 4`, `Universe 1`, `installdir "Steamworks
    Shared"`, `buildid`/`TargetBuildID` `24098430`, `SizeOnDisk`
    `263949710`, counters zero, drop `FullValidateBefore/AfterNextUpdate`,
    `InstalledDepots` = 228983,228984,228985,228986,228987,228988,228989,
    228990 with GIDs from the client's own `depotcache`. The bytes are
    already there: `<prefix>/steamapps/common/Steamworks Shared` (~228MB,
    `_CommonRedist/{DotNet,DirectX,vcredist}`) — verify with
    `steamdepot.py verify --depotcache` per depot; `228989`'s three
    `vcredist/2022` files may be missing with no consequence. Never park
    this manifest (rule 24): absence is what produces the stub. After the
    fix, relock the children too (`StateFlags 4`/518, `TargetBuildID` =
    their buildid) since the gate leaves them queued. `preflight.sh
    --guard-only` (and the Heroic wrapper) now block BOTH the absent and the
    stub case, so this can't silently regress.

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

### 2. Discover the depot layout (usually no console needed)

```bash
steamdepot.py appinfo --api --appid <appid>   # buildid, depots+GIDs+sizes, launch exe, dlcappid (rule 16)
```
Prints the depot table plus a ready-to-paste `download_depot` block and the
`manifest` flags. Falls back to console reads only for branch (non-public)
GIDs or per-language `listofdlc` nuances:

```bash
curl -s https://api.steamcmd.net/v1/info/<appid>   # raw JSON when --api isn't enough
steamdepot.py licenses                  # package → apps → depots ('(0 in total)' = content rides in base depot)
```

Only fall back to console `licenses_print` / `app_info_print <appid>` when the
API is missing something (e.g. per-language `listofdlc` nuances). If you do:
read it back **promptly** — `console_log.txt` rotates on client restart,
taking the output with it. Parse (or save the relevant lines) before quitting
Steam.

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
  [--tolerant]      # flaky-disk mode: skip same-size files, log I/O failures
                    # and continue (exit 1 with failed list) instead of aborting
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
any mismatch aborts loudly instead of losing files. After a successful merge
the script deletes the depot's resume-state file (else the next
`download_depot` false-completes, rule 11); on I/O failure it keeps it so a
re-run resumes.

### 5. Write the appmanifest

```bash
steamdepot.py manifest --appid <appid> --library <external>/SteamLibrary \
  --installdir "<dir>" --name "<title>" --buildid <public buildid> \
  --depot <depotid>:<manifest GID>:<size from appinfo> \
  [--dlc-depot <depotid>:<GID>:<size>:<dlcappid>]
```

Patches in place (`.bak` plus timestamped `backups/`, preserves
`UserConfig`/`LastOwner`), refuses while any Steam client runs unless
`--force`, setting `StateFlags 4`, zeroing download counters, recording
`InstalledDepots`. Fresh installs also need `--lastowner <steamid64>` (copy
from any existing manifest, or the Windows Steam prefix's manifests). Expect
Steam to reconcile the depot *set* on next launch (rule 10) — the patch is a
bootstrap, not a contract. Run `preflight.sh` (rule 24) before that launch.

## Worked example — The Witcher 3 (2026-10-19, salvage + pinned client)

- Starting point: 62GB partial tree in `downloading/292030`, mid-update to
  build `25773555` (Patch 5.01, confirmed current via steamcmd.net — no new
  build underneath), Windows client pinned at Sept-2024 (rule 13) with 100%
  chunk-unpack failure.
- Wrote manifest from licenses (26 depots). Windows Steam rewrote the set on
  launch to its own 8 (`292031/292033/292034/292036/292044/310611/310613/
  310619` + DLC placeholders) — the read-back settled it (rule 10); the
  `config changed` lines had listed a different (update-touched) set.
- Its `BytesStaged 5357421741` equaled `292033+310611+310619` sizes to the
  byte (rule 15) — three depots never fetched. Downloaded all three plus
  re-downloads of three more via macOS (~6GB), merged, re-verified.
- One online update attempt by the old client deleted 136 files/1.3GB from
  the tree (rule 14) — restored from cache leftovers + re-downloads, then
  kept Heroic offline for all further verifies.
- `depotcache` manifest diff (rule 17) gave the exact per-depot missing list
  and confirmed each depot's true file count against console announces.
- **The actual root cause was a shadow install (rule 18).** The client's
  Properties → Updates showed Build `14504303` + 57GB + Jul 2025 while the
  library manifest said `25773555` — a stale `appmanifest_292030.acf` plus a
  0-byte dir skeleton in the prefix's own C: library was what the client
  validated (hence thousands of phantom "missing"), shadowing the complete
  111GB Z: install. Moving the stale manifest + husk aside with everything
  quit made the client discover the real install → **PLAY appeared, game
  launches**. All the byte-level work above was necessary but insufficient
   until the shadow was cleared — check for it FIRST next time (rule 18).

## Worked example — Witcher 3 rollback to 4.04 (next-gen branch, 2026-10-19)

- Goal: last-known-good 4.04 (user had 74h on it) after 5.01 binaries
  page-faulted under every available Wine. Strategy: branch rollback, not
  repair.
- Switched Betas → next-gen in the Windows client, launched once so it
  discovered the branch server-side (its `config changed` line + 34.75GB
  gap confirmed the branch move). mac-console `-beta next-gen` was
  IGNORED throughout (kept fetching public) — all six changed depots were
  fetched with explicit GIDs instead (rule 22).
- GID sources, in the order they paid off: the shadow install's manifest
  (a real 4.04 `InstalledDepots` with all 29 GIDs+sizes — the single most
  valuable artifact of the whole salvage), then surviving non-public
  `depotcache` variants for the six changed content depots.
- Next-gen 4.04 deploys 29 depots (public: 26). The 19 DLC depots carry
  real bytes (~12.5GB). Changed content depots: 292031
  `1714062795524118335` (2118 entries/33GB), 292032 `3490723872095446153`
  (201/367MB), 292034 `8082988454426507412` (3/60MB), 292036
  `3491360665020245284` (37/2.7GB), 292042 `99458089550221039` (5, both
  exes), 292044 `908607634780300143` (4/401MB), 310613 `2970969303001438150`
  (4/1GB). Unchanged across branches (reuse, don't re-fetch): 292033,
  310611, 310619 (single manifest variants). DLC depots: 370000
  `1458194560961361295`, 370001 `5979725543926398369`, 370002
  `484236434286524845`, 370003 `5453197123234356101`, 373950
  `7457326912183925734`, 373951 `1015260686331095979`, 376390
  `4380995726432289642`, 376391 `6437141662912268782`, 378640
  `5318422306227358494`, 378641 `4647447917504831785`, 378642
  `2210049775439183344`, 378643 `459508221271235268`, 378644
  `2928442289493234239`, 378645 `6056630807565191690`, 378646
  `7313260968752741219`, 378647 `6347498022277232982`, 378648
  `5677496677655330654` (9.1GB), 378649 `9216322386755119484`, 370009
  `3498696915194240584` (REDlauncher, 661MB — 4.04 launches via
  `redprelauncher.exe`, no login needed).
- Assembly: 2,859 files, zero missing across all 29 depots — but the game
  Scaleform-crashed on boot until ONE file was re-fetched:
  `content/content0/cookedfinal.redscripts` had bitrotted (same size,
  valid headers, 1.1MB tail divergence, different SHA vs fresh bytes).
  Hiding it reached the menu + save-load + music; the fresh copy fixed
  boot (rule 21). Merge order lesson: base first, DLC second, and a
  same-volume `mv` into an existing dir NESTS instead of replacing —
  verify layout after every move.
- Steam-side: manifest = shadow's `InstalledDepots` + `StateFlags 4` +
  zeroed counters + `BuildID 14504303`; launcher fallback flipped to
  `DirectX 11` in `launcher-configuration.json` so Steam's skipped-launcher
  launch runs `bin/x64/witcher3.exe` instead of the DX12 default.
  PLAY appeared, game boots to menu + gameplay frame under Wine 11.18 +
  DXVK (further than any other config: DX12 dead-ends on D3DMetal/DXMT,
  DX11 hits the M4 device-loss wall under sustained load — see
  troubleshooting).

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

**Launch guard (do this once):** the Steam (sideload) entry in Heroic →
Settings → Advanced → Wrapper command → paste
`<skill>/scripts/launch_guard.sh`. Every launch then: (1) refuses if any
Steam client is already alive (rule 1); (2) **auto-relocks** — rewrites our
three manifests to idle (`StateFlags 4`, or `518` preserved for MW5,
`TargetBuildID = buildid`, counters zero) and restores `228980` as
installed if it is missing or a stub (rules 20/26), backing each changed
file up under `steamapps/backups/`; (3) runs `preflight.sh --guard-only`
(scoped to our three appids on the Z: side — other games' queues there don't block; a queued/shadowed manifest of ANY app in the C: prefix library still blocks, since the client reads that side first — rule 18): CLEAR
proceeds to the real launch, BLOCKED pops a Mac alert and aborts with exit 1
before the client can stage anything. Self-test: `launch_guard.sh true`
(exit 0 = would launch); `launch_guard.sh` with no args stops after the
guard. This is the standing defense for rules 18/20/26 — no more relying on
remembering to check or to relock after Steam's per-launch requeue.

With a pinned old client (rule 13): verify in **Offline Mode** and read the
result from `content_log.txt` (`Validation: read N files missing and M files
corrupt`) — never let it attempt the download. If N > 0, diff the
`depotcache` manifests against the tree (rule 17) to name the missing files,
fetch them via macOS, merge, and verify again. Each verify–diff–fetch cycle
converges; the client's count is the scoreboard. **A full pass over a
~100GB tree is silent for a long time**: missing files fail fast (seconds),
but present files must all be read + hashed over USB — 0% with no log output
for up to ~45 minutes is normal. Don't cancel (it restarts the pass); the
`Validation: read ...` line is the finish marker.

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
| Steam shows Update for a sideloaded game (CONTENT SERVER UNREACHABLE) | FIRST check for a shadow install: compare Properties → Updates (Build ID/size/date) against your library manifest — mismatch means the client is reading a stale prefix-library manifest + empty husk, not your install (rule 18). Only then: unregistered depot (rule 10) or missing files (compare against backup). Read the Windows `content_log.txt` first: its prefetch line names the exact missing bytes |
| Verify says "All 0 files successfully validated" | Ambiguous — may mean it counted nothing (hand-written manifests lack per-file tracking). Treat as "no failures reported", not proof of a deep check |
| `Assertion Failed ... same chunk requested twice` | Wedged resume state → rule 11: quit Steam, `steamdepot.py reset`, relaunch, re-download |
| `Depot download complete` but cache empty / instant | False complete — stale state file survived an assemble → same fix: quit Steam, `reset`, re-download. `monitor_depot.sh` flags this automatically |
| Log shows doubled `steam://open/steam://open/...` URL | Normal logging quirk — the console tab still opens |
| No Play in menu / "Missing game executable" on launch | Exe path in the install dir doesn't match the launch config — check `app_info_print`'s `"executable"` or the dialog's exact expected path, restructure to match. Distinguish from a mere queued update (MW5 played fine with one queued) |
| Direct exe launch via Wine shows nothing | Attempted as a gate bypass: no DRM markers found, but no window and no error either — cause unresolved. Treat as unproven last resort, not part of the pipeline. If tried: user-side step, exe's own dir as cwd, one attempt at a time, kill after; never background-spam Wine processes |
| Client in Offline Mode | Play works offline for satisfied installs; queued updates are irrelevant until back online. Go Online only when ready to let queued updates attempt (they'll fail here — that's expected, not a regression) |
| `Failed unpacking chunk ... (Unpack failed (c:…,u:0,…))` on EVERY chunk, all depots/edges | Old client can't unpack current CDN chunks → rule 13. Don't retry, don't blame the network: quarantine the install, deliver all bytes via macOS. Confirm via the log's `Client version:` line |
| Tree lost files after a Windows update attempt | Expected with rule 13/14: staging deletes before failed replaces. Restore from cache leftovers (`assemble_install.sh` re-merge moves newly-missing files) or re-download; then keep Heroic offline until verified |
| Manifest edits keep getting reverted (depots re-added/removed, counters back) | Normal: Steam reconciles `InstalledDepots` from its own config each launch → rule 10. Stop editing the set; supply the files for its set instead |
| Verify count won't drop to zero and depots all check out | The staged-update plan may reference depots outside the deployed set — match `BytesStaged` against depot sizes (rule 15) to find them, and diff `depotcache` manifests vs the tree (rule 17) for the exact list |
| Steam deleted a whole game dir at launch (dir empty, mtime = launch time) | Staged a queued "update" (rule 20): the empty husk + 0-byte manifest still satisfy presence checks but the game is gone. Park the manifest, lock the others (`StateFlags 4`/518 + zeros, all clients quit), re-download via mac, reassemble, restore the manifest. Never Play/Verify a queued app |
| `Fatal error!` / `Unhandled Exception: 0x20474343` on EVERY Steam game, files verify clean | Live prefix damage (rule 23), not the games: run one exe in a fresh prefix — boots there = restore the prefix backup. Kill stray wine processes first (wedged 99%-CPU helpers fake the same symptom). Overlay-off changes nothing — skip that detour |
| Manifest edits revert on every launch (518→6, 4/0→6+gap) | A client is reconciling against you — usually the mac login-item Steam running alongside Heroic, or staging residue (`downloading/`, `.bak` manifests) re-triggering the queue. Quit ALL clients before surgery, clear residue, re-read after relaunch. If it still flips, delete the trigger (e.g. stale `ScheduledAutoUpdate`), not the symptom |
| Game boots to menu, renders one 3D frame, then hangs / device lost (Apple Silicon + DXVK-1.10.3) | `VK_ERROR_DEVICE_LOST` after descriptor-pool exhaustion — the 2023 DXVK-macOS build can't sustain gameplay load on M4 GPUs, and no newer macOS build exists. Lowest graphics settings only delay it. This is a wall, not a config error: pivot builds (5.x renderer) or wait for newer DXMT/GPT/CrossOver |
| Deterministic crash loading one file, hiding it reaches menu | Corrupt bytes, not engine (rule 21): hash tree file vs fresh download, reset + re-fetch the depot |
| PLAY shown, click gives "An error occurred while launching this game: Downloads disabled" while offline | Shared-redist parent `228980` is a stub (`Update Required,Shared Only`) and every dependent blocks on it → rule 26 |
| Game plays, but talking to an NPC / merchants / cutscenes show a loading screen every time | Mixed-branch tree: asset index and/or speech pack belong to the other build → per-depot verify + repair from `SteamDepotCache` (rule 25) |
