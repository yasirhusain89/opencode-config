---
name: mw5-mods
description: Use when installing, debugging, or removing MechWarrior 5 Mercenaries mods on this machine (Nexus downloads, MW5Mercs Mods folder, Load Save Loadout), when MW5 mods don't show up in the in-game Mods list, when pulling the MW5 save for loadout planning, or when generating mechlab loadout templates for tonnage-restricted drops. Pairs with the mw5-advisor skill, which owns campaign/loadout decision rules.
---

# Skill: mw5-mods

Install, debug, and exploit MechWarrior 5: Mercenaries mods on this
machine (macOS + Wine/Steam), and run the mod-assisted loadout-template
workflow (save pull → roster/inventory analysis → mechlab templates).

Pairs with `mw5-advisor` — campaign rules, bench/repair verdicts and
faction logic live there. This skill covers everything mod-related:
environment discovery, Nexus installs, visibility debugging, the
`pull_all` data loop, and Load Save Loadout template generation.

## Iron Law

```
NEVER install or edit Mods/ while the game is running.
Verify mod.json placement BEFORE any relaunch.
Never count inventory by unique ids alone — entries carry a `count` field.
```

MW5 only scans `Mods/` at launch; hot-loading does not exist. A mod
copied while the game runs will be invisible until full quit + relaunch.

## 1. Environment discovery (do NOT free-search)

This machine runs Windows Steam under Wine via Heroic/CrossOver. The
game is NOT in macOS Steam libraries. Exact paths, prefix locations and
known pitfalls live in `references/env-map.md` — read it first, every
time. Free-searching `~/Library/Application Support/Steam` or `~/Games`
wasted six tool calls before the install was located (documented
failure, 2026-11-16 session). Do not repeat it.

Quick orientation if env-map is stale: the live install is on an
external SteamLibrary volume; Wine prefixes live under `~/Games/` and
`~/Library/Application Support/CrossOver/Bottles/`. Confirm the
appmanifest (`appmanifest_784080.acf`) before trusting any path.

## 2. Installing a Nexus mod

1. Quit the game fully (check with the user; do not assume).
2. User downloads `Manual download` from Nexus (login required).
   Note file size — MW5 UI mods are typically <1 MB.
3. Downloads folder is path-guard protected: do NOT try to read or copy
   from it. Give the user an exact `cp -r` command with quoted paths and
   ask them to run it.
4. Placement rule — `mod.json` must sit EXACTLY one level under `Mods/`:
   ```
   .../MW5Mercs/Mods/LoadSaveLoadout/mod.json     ← correct
   .../MW5Mercs/Mods/LoadSaveLoadout/LoadSaveLoadout/mod.json  ← broken
   ```
5. After the user copies, YOU verify with `ls` on the Mods path before
   telling them to relaunch (see env-map for the path).
6. User enables: Main Menu → Mods → tick the mod → restart if prompted.
7. Verify in-game: mechlab shows the mod's UI (for Load Save Loadout:
   Save/Load Loadout buttons on an UNDAMAGED mech).

## 3. Mods not showing (debug tree)

Ask which symptom, then branch — do not guess:

- **Empty Mods list** → placement problem. Check: (a) correct Mods
  folder (there are TWO on Steam installs — Workshop content and the
  manual `MW5Mercs/Mods`; Nexus files go only in the manual one),
  (b) double-nested folder or unzipped `.zip`, (c) `mod.json` present
  at depth 1. Last resort: backup then delete `Mods/modlist.json`,
  relaunch — the game rebuilds it.
- **Mod listed but blank/unnamed entry** → zip not extracted properly /
  `mod.json` missing at expected depth.
- **Mod listed + enabled but no in-game effect** → game not fully
  restarted after enabling, or mod conflicts with another mechlab mod
  (Load Save Loadout is INCOMPATIBLE with YAML — YAML already ships
  this feature).
- **Game crashes when clicking in a modded screen** (mechlab weapon-slot
  clicks, access-violation dumps on the GameThread) → stale UI asset:
  a UI mod built for an older game version overrides a vanilla UI file
  the patch has since reworked. Compare the mod's `mod.json`
  `gameVersion` against the game's current `Mods/modlist.json`
  `gameVersion`; confirm via `Saved/Crashes/` dumps in the Wine prefix
  (env-map → Crash diagnostics). Documented incident (2026-11-17):
  Load Save Loadout 1.36 (2024-03, built for game 1.1.x) crashed the
  game on weapon-slot clicks under game 1.15.399 / DLC9 — no updated
  build exists (author dormant); YAML 0.99.4.2+ is the actively
  maintained replacement with built-in Save/Load Loadout.

## 4. Data pull for loadout planning

The advisor app's Rust parser is the save oracle (read-only, hashed):

```
cd ~/Projects/mw5-advisor/src-tauri
cargo run --quiet --example pull_all            # validate every save
cargo run --quiet --example pull_all -- --snapshot SLOT_ID [SAVE_ID]
```

- Omit SAVE_ID → latest save in slot. Slot id for this campaign:
  see env-map.
- Redirect pretty JSON to `static/dev-snapshot.json` (gitignored, live
  save data). A matching `static/dev-slots.json` (one entry) enables
  the dev web bridge per repo AGENTS.md. Re-dump after any play
  session — the bridge holds exactly one save.
- The snapshot's `weapons` and `equipment` arrays are AGGREGATE rows:
  `{id, count, health_state}`. Sum by base type after stripping
  variant suffixes (`_Lvl0..5`, `_Stream`, `_Artemis`, `_Burst`,
  `_Auto`, `_SolidSlug`, size words). Documented failure: reading one
  row per id and reporting "x1 GuardianECM" when later re-aggregation
  showed the same `count` pattern held for weapons (164× MediumLaser
  across level variants). Count fields are the truth.
- `mechs[].variant` joins to `static/data/mechs.json` by `id` for
  `ton`, `class`, `speed`, `hardpoints`, `hero`.

## 5. Loadout-template workflow (Load Save Loadout)

Input: the user's weight groups (currently 25/30/35/40/45/50/55) for
tonnage-restricted drops. For each group:

1. **Roster scan**: group owned mechs by tonnage from the snapshot.
   Note `loadout_type` — `ColdStorageLoadout` means stripped/needs
   refit; `MarketLoadout` is a market offering, NOT owned.
2. **Hardpoint fit**: pick the variant whose hardpoints match the role;
   cite the hardpoint string. Legend:
   `ME/LE/SE` energy, `MB/LB/SB` ballistic, `SM/MM/LM` missile,
   `MH` mixed medium, `SLA` small laser, `MBF` battle fist (melee),
   `JJ*` jump jets, `ECM/AMS/AP/EH` equipment slots. `?` = unknown —
   say so, never assume.
3. **Inventory fit**: every recommended weapon/ammo/equipment line gets
   a have-vs-need table from the aggregated inventory. Flag scarcity
   (singleton equipment like Guardian ECM) explicitly.
4. **Scarcity routing**: for singleton gear (ECM, AMS), scan the whole
   owned roster for hardpoint-compatible hosts before assigning. If
   exactly one host exists, the gear goes there or sits unused — say
   which and let the user decide.
5. **Template names**: emit a save-name list, one per weight class
   (pattern `NNt_VARIANT_ROLE`, e.g. `45t_PXH-2_PPC_ML_ECM_JJ`).
6. **Mechlab steps**: build on an undamaged mech → Save Loadout with
   that name (works in both Load Save Loadout and YAML's built-in
   Save/Load Loadout). Save is disabled on damaged mechs; load strips
   weapons, resets armor, pulls from inventory and auto-repairs;
   missing tiers load as destroyed placeholders (swap manually). Stock
   default is always loadable — good for cold-storage rebuilds.
   Traits/quirks/upgrades are NOT saved.

## 6. Grounding recommendations

Precedence (inherited from mw5-advisor): observed save/UI > Sarna >
Kalbintion data repo > local scrapes. Additions for mods:

- Sarna's MW5 factions page omits some DLC/hero variants (FS9-M is
  absent there but present in the user's save). A Sarna gap is not
  evidence of absence — check the save first.
- Label every recommendation: SOURCED (cite URL) vs LOCAL-DB
  (mechs.json hardpoints) vs MODELED (judgment). Reddit fetches often
  return empty (auth wall) — cite the thread title via search result,
  don't fabricate quotes.
- Community sentiment is a tiebreaker, not a rule: Phoenix Hawk is
  "hard pass" on r/Mechwarrior5 yet the user's only ECM host is PXH-2 —
  roster constraints beat generic tier lists.

## Red flags

Installing while the game runs; nested mod folders; counting inventory
by unique id; treating `MarketLoadout` as owned; recommending a weapon
the roster can't mount; assigning singleton ECM/AMS without a
host-scan; citing Sarna for variants the save contradicts; presenting
MODELED hardpoint fits as game-verified.
