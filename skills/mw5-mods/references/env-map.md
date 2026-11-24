# MW5 environment map — this machine

Verified 2026-11-16/17 during the Load Save Loadout install session.
Re-verify if the external drive is renamed or the prefix moves.

## The live game install

```
/Volumes/YH-SanP2TB/SteamLibrary/steamapps/common/MechWarrior 5 Mercenaries
```

- Steam appid 784080; manifest at
  `/Volumes/YH-SanP2TB/SteamLibrary/steamapps/appmanifest_784080.acf`
  (the `steamapps/backups/` dir holds older manifest copies — ignore).
- Mods folder (the ONLY one that matters for Nexus mods):
  ```
  /Volumes/YH-SanP2TB/SteamLibrary/steamapps/common/MechWarrior 5 Mercenaries/MW5Mercs/Mods/
  ```
  Contains `modlist.json` (game-generated; backup before deleting).
- Incident 2026-11-17: Load Save Loadout 1.36 installed and verified
  (`mod.json` + `Paks/` + `Resources/` at depth 1), then DISABLED the
  same day — game 1.15.399 / DLC9 reworked the mechlab and the mod's
  stale `MechlabWidget.uasset` override caused GameThread
  access-violation crashes on weapon-slot clicks (while its Save path
  still worked — 15 loadouts written). No updated build exists; user
  migrated to YAML. See "Crash diagnostics" below.

## How the game actually runs

Windows Steam client under Wine, launched via Heroic. Wine prefixes
checked during discovery (in search order, all initially wrong for
MW5):

1. macOS Steam: `~/Library/Application Support/Steam/steamapps/` —
   has a second library configured at `/Volumes/Crucial X9/SteamLibrary`
   but that volume holds no MW5 and may be unmounted.
2. Heroic prefix clone: `~/Games/steam-1118-clone/` — holds a Windows
   Steam install with OTHER games (Hogwarts Legacy, Witcher 3) and the
   MW5 desktop shortcut (`steam://rungameid/784080`), but no MW5 files.
   Note `dosdevices/d:` → `/Volumes/dmg.W7q3Iy` (transient dmg mount).
3. Heroic default prefixes: `~/Games/Heroic/Prefixes/default/` —
   contains a `SteamHeroic` dir; no MW5 install found there either.
4. CrossOver bottles: `~/Library/Application Support/CrossOver/Bottles/`
   (Steam, Steam-Witcher, Zues) — near-empty Steam installs.

Conclusion: none of the prefixes contain the game files; the Wine Steam
client mounts the external library directly via `/Volumes/YH-SanP2TB`
(accessible inside Wine as `Z:\Volumes\YH-SanP2TB\...`). The
`appmanifest_784080.acf` backups under `steamapps/backups/` carry
`pre-launch` timestamps confirming launches from this library.

## Save data

- Rust parser (read-only, SHA-verified):
  ```
  cd ~/Projects/mw5-advisor/src-tauri
  cargo run --quiet --example pull_all -- --snapshot 301EF41A445FC5D10BDF84955ABB0B25
  ```
  Slot `301EF41A445FC5D10BDF84955ABB0B25` is the only discovered slot;
  ~30 saves, ~143 mechs in the latest (as of 2026-11-16,
  cbills ≈ 93.7M — re-pull, do not trust these numbers).
- Output → `static/dev-snapshot.json` (+ one-entry
  `static/dev-slots.json` for the dev web bridge). Both gitignored.

## Sandbox / path-guard notes

- `/Users/yasihusain/Downloads` is protected: shell reads AND copies
  are blocked. Give the user a `cp -r` command; verify the RESULT on
  the destination (the game volume is writable and readable).
- The game volume path contains spaces — always quote.
- Reference data lives in `~/Projects/mw5-advisor/static/data/`:
  `mechs.json` (tonnage/hardpoints/speed/hero per variant id),
  `weapons.json`, `ammo.json` (sourced rounds-per-ton only).

## Crash diagnostics (Wine prefix)

Crash dumps and mod-side data live in the Wine prefix, NOT the game
volume:

```
~/Games/Heroic/Prefixes/default/SteamHeroic/drive_c/users/crossover/AppData/Local/MW5Mercs/Saved/
```

- `Crashes/UE4CC-Windows-*/CrashContext.runtime-xml` — read
  `<ErrorMessage>` and `<PCallStack>`. Some contexts are UTF-16
  encoded (grep finds nothing): pipe through
  `iconv -f UTF-16LE -t UTF-8` first. Shipping builds strip symbols —
  the error line + which threads crashed is the diagnostic payload.
- `SavedLoadouts/InstantAction.json` — saved mech loadouts (Load Save
  Loadout format; YAML also reads it for experimental DerivedMech
  prespawn). Survives crashes; the file grows while the game runs, so
  re-read instead of trusting a cached count.
- Game version truth: `Mods/modlist.json` `gameVersion` (written by
  the game at launch). Steam manifest
  `steamapps/appmanifest_784080.acf` carries `LastPlayed` /
  `LastUpdated` unix timestamps (UTC) — correlate with dump mtimes.

## YAML stack facts (2026-11-17 migration)

- Yet Another Mechlab 0.99.4.2 — Nexus mod 459, Steam Workshop
  id 2549720490 (~7.3 GB; Workshop auto-updates and avoids the
  Downloads path-guard). Built for game 1.15.399 / DLC9 Patch 1.
- Bobbert's Mod Options — Nexus mod 537 ONLY (not on Workshop).
  Not a hard requirement, but YAML's settings/keybinds need it; loads
  LAST.
- MW5 Mod Compatibility Pack — Nexus mod 168 (v7.4 updated for DLC9;
  its Workshop copy can lag Nexus). Loads FIRST (lowest default load
  order). Recommended best practice even though not a hard YAML
  requirement.
- Keep default load orders; the only sanctioned exceptions are
  Compatibility Pack first, Mod Options last.
- YAML converts vanilla saves on first load ("Vanilla savegame
  conversion"); Simple Mechlab mode keeps internals vanilla-like.
  LSL's InstantAction.json saves are NOT imported into YAML's UI.

## Reference data facts (verified this session)

- User's weight groups for restricted drops: 25/30/35/40/45/50/55.
- Singleton scarcity in inventory: GuardianECM ×1, AMS ×1. Only
  ECM-capable owned mech: PXH-2 (CT slot). Load Save Loadout is
  incompatible with YAML (YAML ships its own save/load).
