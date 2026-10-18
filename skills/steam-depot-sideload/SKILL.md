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
   bar trick after enabling it in Settings → Interface).

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

Then read it back without copy-pasting:

```bash
steamdepot.py appinfo --appid <appid>   # depots, buildid, installdir, DLC list
steamdepot.py licenses                  # package → apps → depots ('(0 in total)' = content rides in base depot)
```

Pick the depot whose manifest has a `gid` (the biggest one = game content).
`depotfromapp` entries are shared depots — nothing to download.

### 3. Download (human pastes, agent monitors)

```
@sSteamCmdForcePlatformType windows
download_depot <appid> <depotid>
```

```bash
monitor_depot.sh --watch 60   # or single-shot; state line says DOWNLOADING/COMPLETE/FAILED
```

On `Depot download complete : ... (manifest <GID>)` — note that GID, it goes
in the manifest. On timeout, just re-run the same command.

### 4. Assemble

```bash
assemble_install.sh --appid <appid> --depotid <depotid> \
  --installdir "<dir from appmanifest or steamdepot.py appinfo>"
```

Verifies every manifest-listed file exists (hard-fails otherwise), then moves
everything except `Manifest_*.txt` into `common/<installdir>/`, preserving any
existing content (DLC extras etc.).

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

### 6. Validate

In the **Windows** Steam client: Properties → Installed Files → **Verify
integrity of game files**. Nothing (or a few KB) downloading = manifest is
correct. Then launch via Heroic. DLC ownership shows in-game.

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
