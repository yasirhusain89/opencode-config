# MW5: Mercenaries — Advisor Deep Tables & Rules

Curated mechanics, verified formulas and key reference tables backing `SKILL.md`.
Full per-tier weapon scrape lives in the app (`~/Projects/mw5-advisor/static/data/weapons.json`, meta dated 2026-11-01, source = this same Sarna page); full chassis list in `static/data/mechs.json` + the Kalbintion repo. This doc holds only what advising decisions actually use, plus the gap/drift log.

Skill layout: `SKILL.md` (workflow) → this doc (tables/mechanics) → `scripts/mw5save.py` (save parser).

## 0. Source precedence and provenance

1. **Observed save / UI screenshot** — always wins for the player's actual copy.
2. **Sarna `/Equipment`** — exception: where Sarna explicitly flags the in-game display as wrong (Stream ROF, §1), the wiki's file-derived value wins.
3. **Kalbintion repo** (`github.com/Kalbintion/MechWarrior5MercenariesData`) — chassis hardpoints/armor/availability, EC-track-only upgrade pool. Data lags patches; `"source": "Core"` style tags hint at scrape vintage.
4. **App scrapes** — trusted only with their `meta.fetched` date.

Never reconcile a conflict silently; log it in §14 and label the number used (EXACT / WIKI / MODELED / UNKNOWN).

Provenance stamps used below:
- Sarna `MechWarrior_5:_Mercenaries/Equipment` revision `oldid=1504241`, edited 2026-10-13 (re-check the revision ID when refreshing).
- Sarna `MechWarrior_5:_Mercenaries/Cantinas` revision `oldid=1509747`, edited 2026-10-14.
- Sarna `MechWarrior_5:_Mercenaries` main page (career system, contract rules, mission types; re-check revision when refreshing).
- MW5 official game manual (`https://static.mw5mercs.com/docs/MW5Mercs_Game%20Manual.pdf`) — pilot skills, injury/death triggers, cold-storage stripping.
- MW5 official news, 2023-01-17 free-update details (`mw5mercs.com/news/2023/01/76-free-game-update-details`) — active 'Mech roster 12→40 bays, 4 free + 36 leased, first 8 subsidized.
- Kalbintion repo `master` fetch 2026-11 session (`data/mechs.json`, `data/upgrades.json`, `data/weapons.json`, `data/defs.json`, `data/salvage_costs.csv`).
- In-session UI observations: Atlas AS7-RS upgrade screen, 2026-11.

## 1. Verified combat math

- `DPS = damage × ROF/60` (per volley); `HPS = heat × ROF/60` (same convention as the UI).
- Sustain: overheat time `= capacity / (HPS − cooling)` when HPS > cooling; a rotation is "heat-neutral" when HPS ≤ cooling.
- **Heat model (MODELED — reconciles exactly on Atlas AS7-RS):** `cooling = (10 engine-internal + external sinks) × sink efficiency`; `capacity = 40 + Σ external sink capacity`. Check: (10+8)×0.1 = 1.8/s ✓; 40+8×1 = 48 ✓.
- **Stream-variant ROF: the in-game display is wrong.** Sarna (Missile Weapons notes): "LRM and SRM Stream variants Rate of Fire values indicated in-game are incorrect as they do not account for the delay between missiles. The true values have been calculated from the information in the game's files." Use the wiki's Stream-table ROF for sustain math; the UI number overstates Stream ROF by ~15–25% (worked example: LRM 15 ST+Art T5 — UI 18.18, true 14.815). Non-stream launchers and ballistics/energy are unaffected.
- **Tier system** (Sarna main page): quality rank T0–T5 (+ T6 = Clan tech, 3055+). Tonnage never changes with tier; each step up buys more damage, faster reload, less heat per cycle, better long-range accuracy, and higher projectile velocity.
- **`+% damage` upgrades/upkeep do not change heat or ammo count** → `+% damage per ammo ton` and strictly better damage-per-heat. **`−% cooldown` raises the burst ceiling, not heat-capped sustain** (firing faster also burns heat and ammo faster).
- UI `TOTAL WEAPON DAMAGE` = Σ weapon volley damage **+ melee fist damage** (Atlas: 7.2+10.5+10.5+7.5+25.2 = 60.9, + 2×30 MBF = 120.9 → shown 121 ✓).
- Ammo (rounds-per-ton, all EXACT): LRM 440/t (incl. Artemis shells at the same 440/t, +1t launcher weight) from Kalbintion `weapons.json` Equipment; in-game mechlab bin tooltips transcribed 2026-11-16: SRM 320/t, AC10 40/t, AC20 20/t, AC5 80/t, AC2 200/t, LB10X 40/t, MG 5200/t, AMS 2000/t, Gauss 26/t, Light Rifle 34/t, Medium Rifle 22/t, Heavy Rifle 12/t, Medium Chem Laser 220/t. App `static/data/ammo.json` (`ammo-v8`) carries exactly these rows; Small/Large Chem Laser are `null` by user choice, all other families (other LB-X, etc.) stay `null` until transcribed — never guessed.
- Structure multipliers (Sarna notes): machine guns ≈7× damage to structures (their ROF counts ammo burn; damage is per-second), small lasers 4×, flamer 2× (flamer heat is per-second — modeled). Inferno rounds deal heat damage, not hull damage.
- Missile `spread %` values are in game files but not displayed in-game (Sarna note); stacking across Stream + Artemis + NARC/TAG + upgrades is **assumed multiplicative, unverified**.

## 2. Variant pinning (method + worked example)

Pin family+variant+tier by exact match on damage / heat / ROF / range / projectile speed against a per-tier row. Worked example (AS7-RS, 2026-11 session):

| UI stat | Pinned row |
|---|---|
| AC/5-BF 7.2 / 0.41 / 56.93 / 713m | T4 Imperator-A (velocity mismatch 1,265 vs 1,092.5 — open, §14) |
| PPC ×2 10.5 / 7.6 / 12.31 / 966m / 1,092 | T2 Lord's Light — exact |
| LRM 5 7.5 / 1.53 / 16.67 / 1,035 / 250 | T4 Longbow, plain (Stream would show 15.584/1.44) |
| LRM 15 ST+ART 25.2 / 3.38 / 280 | T5 Simpson (Stream+Artemis) — dmg/heat/proj exact; ROF/range drift §14 |

Sustained table for that loadout (Stream ROF corrected to 14.815):

| Weapon | DPS | HPS |
|---|---|---|
| AC/5-BF T4 | 6.83 | 0.39 |
| PPC T2 ×2 | 4.31 | 3.12 |
| LRM 5 T4 | 2.08 | 0.43 |
| LRM 15 ST+Art T5 | 6.22 | 0.83 |
| **Full rotation** | **19.45** | **4.77** → +2.97/s net, caps ~16s |
| **No-PPC rotation** | **15.13** | **1.66** → +0.14/s ≈ heat-neutral |

PPC = 22% of DPS but 65% of heat; LRMs = 55% of sustainable DPS. Sustain lives in AC+LRMs; PPCs are alpha/heat sinks of the build.

Chassis cross-check (Kalbintion + app `mechs.json`, AS7-RS): 100t, 48.6 km/h, armor 626 / structure 315 (UI 313 — drift §14), 6 upgrade slots, availability 3015, hero=false. Hardpoint decode legend: `E`=energy, `LE`=large energy, `MB`=medium ballistic, `SM/LM`=small/large missile, `EH`=energy hardpoint (CT), `MBF`=medium battle fist (melee 30 dmg — Kalbintion Melee). AS7-RS: `ra/la 1LE+1MBF, rt 1MB, lt 1SM+1LM, ct 2EH`. Hardpoints are mount **capacity**, never installed weapons; unmounted `1LE` arm slots are free capacity, not stripped gear.

## 3. Heat sinks (Sarna §Heat Sinks, verified vs UI)

| Type | Tons | Capacity | Efficiency | Resilience | Equip slots | Available |
|---|---|---|---|---|---|---|
| Single Heat Sink | 1 | 1 | 0.1 | 80 | 1 | always |
| Double Heat Sink | 1 | 2 | 0.2 | 75 | 3 | 3040-01-01 |
| Clan Double Heat Sink | 1 | 2 | 0.2 | 75 | 2 | 3055 |

UI shows per-sink `CAPACITY` and `EFFICIENCY` directly (Atlas: 8× SHS → CAPACITY 1, EFFICIENCY 0.1 ✓). DHS swap math (MODELED): 8 SHS→8 DHS on Atlas = cooling (10+8×0.2)=2.6/s, cap 40+16=56, but needs 24 free equipment slots (3/sink) — likely partial fit; check slot count before promising a full swap.

## 4. Spread & guidance stackables (missile accuracy)

Per-variant spread reductions (Sarna table headers; LRM spread at family level, SRM at 75m):

| Family | Stream | +Artemis IV | Stream+Art IV |
|---|---|---|---|
| LRM 5 | −10% | −33% | −40% |
| LRM 10 | −10% | −30% | −37% |
| LRM 15 | −10% | −28% | −34.5% |
| SRM 6 | −20% | −25% | −46.5% |

- **Artemis IV**: +1t launcher weight, no damage/ROF/heat change (verified LRM 10 rows); available 3035-01-01.
- **Hotloaded** LRMs: shorter range (e.g. LRM 15 T5 937.5 vs 1,125) but **no minimum range**.
- **NARC**: −10% LRM spread, all tiers; available 3035-01-01. **TAG**: −2.5%…−25% by tier 0–5 (T5 −25%), available 3033-01-01.
- **Tighter Missile Clusters** (mech upgrade, UI-observed): −7.5% missile spread, 1 slot.
- **ECM (defensive)**: raises *hostile* LRM spread +10% (EW) / +20% (Guardian), cuts hostile Streak tracking −10/−20%, hostile accuracy −20% (−45% Black Market), sensor shielding −20%.
- Stacking order across these layers: **UNKNOWN** (multiplicative assumed). Cite the layered %s, don't multiply silently in advice.

## 5. Mech upgrade slots (chassis-specific: 5–10 in data; Atlas 6)

Kalbintion `upgrades.json` = the **Equipment Collector career track** (verified exact against Sarna `/Cantinas`, oldid=1509747, incl. slots/costs/days — every row matches the EC block of the full pool in §8). **§8 is the single source of truth for blueprint rows**; this section covers slot mechanics and the UI cross-check only. Each career level unlocks a Blueprint; installing it on a mech consumes the chassis's upgrade slots, C-bills and refit days — **costs are the 100-ton reference; lighter chassis pay less (20t = 30% of listed, scaling up with tonnage)**. The in-game shop groups items by category (DEFENSE/FIREPOWER/…).

Slot count is a **chassis stat, not a global cap** — app `mechs.json` `upgrade_slots` spans **5–10** across 480 chassis (stock ARC-2R / AWS-8Q / BNC-3S / DV-6M = 5; heroes ASN-DD, CDA-X5, CN9-YLW, PNT-KK, RVN-H, VND-1SIB, ZEU-SA3, ZEU-SK = 10; Atlas AS7-RS = 6, UI-confirmed 2/6 used). Never assume 6 when planning a fit; read the chassis entry.

UI-observed DEFENSE (2026-11): Refined Armor I +2.5% armor (1 slot), Fortified Internal Structure I +5% internal structure (1 slot). UI-observed FIREPOWER: Enhanced Energy Output II +10% energy damage (2), Faster Projectiles I +7.5% ballistic range/velocity (1), Damage Tuning +5% weapon damage (2), Shorter Burn Time (1), Tighter Missile Clusters (1). Cross-verified exact vs Sarna `/Cantinas` + Kalbintion, with track/level/cost(100t)/refit-days: Refined Armor I (EC L5, 750k/15d) · Fortified Internal Structure I (MH L2, 500k/10d) · Shorter Burn Time (EC L4, 300k/8d) · Damage Tuning (MC L4, 1,000k/20d) · Enhanced Energy Output II (MC L6, 600k/12d) · Faster Projectiles I (MH L3, 250k/6d) · Tighter Missile Clusters (MH L4, 300k/8d).

Upgrade-selection math (heat/ammo-aware, worked on AS7-RS §2): rank `+% damage` (same heat) > spread reduction on the dominant ammo weapon > 1-slot range/velocity filler > `−% cooldown` (ceiling-only). The pool also carries **heat-management blueprints** — Heat Containment I/II (+5/+10% capacity, MC L3 / MH L10), Faster Cooling (+5% dissipation, TH L4), Reduced Heat Spikes (−5% heat generation, MC L10), Weapon Heat Transfer (−5% all weapon heat, TH L10, 2 slots), and per-family heat cuts (MC L5/L7/L9, TH L5/L9). Evaluate `+Δcapacity / +Δcooling` against the rotation's net HPS before assuming damage% wins on a heat-limited chassis. Armor/structure %s multiply the *allocated* pool (608×1.025 = 623.2 ✓ UI arrow; 313×1.05 = 328.65 ✓).

## 6. Curated weapon tables (Sarna oldid=1504241)

Full families live in the app scrape; these are the advising-critical ones. Format: T | tons | dmg | ROF | heat | range | proj speed (| spread).

**PPC** (7t): 0|10/10/9.6/736/832 · 1|10/12/8/920/1,040 · 2|10.5/12.308/7.6/966/1,092 · 3|11.4/12.632/7.2/1,012/1,144 · 4|12.5/13.043/6.8/1,058/1,196 · 5|14/14.118/6.2/1,150/1,300
**PPC-X** (7t, spread@120m): 0|19.2/20/8.4/600/832/8.4 · 1|24/24/7/600/1,040/7 · 2|25.2/24.615/6.65/600/1,092/6.825 · 3|27.6/25.263/6.51/600/1,164.8/6.755 · 4|30/26.374/6.16/600/1,196/6.65 · 5|32.88/28.916/6.02/600/1,196/6.65
**ER PPC** (7t): 0|10/10/14.4/1,200/1,316 · 1|10/12/12/1,500/1,646 · 2|10.5/12.308/10.45/1,575/1,728 · 3|11.4/12.632/9.9/1,650/1,810 · 4|12.5/13.043/9.35/1,725/1,892 · 5|14/14.118/8.525/1,875/2,057 · 6|19.5/16/10.075/2,025/2,057 (6t)
**AC/5 Burst-Fire** (8t, spread@350m 1.6): 0|6/40.323/0.624/496/760 · 1|6/48.387/0.48/620/950 · 2|6.3/50.934/0.456/651/997.5 · 3|6.6/53.763/0.432/682/1,045 · 4|7.2/56.926/0.408/713/1,092.5 · 5|7.8/64.516/0.372/775/1,187.5
**LRM 15** (7t): 0|18/13.636/5.4/720/160 · 1|18/15/4.5/900/200 · 2|19.08/15.385/4.275/945/212 · 3|20.7/15.789/4.05/990/230 · 4|22.5/16.667/3.825/1,035/250 · 5|25.2/18.182/3.375/1,125/280
**LRM 15 Stream** (−10% spread, *true ROF per §1*): 1|12.632 · 2|12.903 · 3|13.187 · 4|13.793 · 5|14.815 (dmg/heat/range = plain row)
**LRM 15 Stream+Art IV** (−34.5% spread, 8t): ROF as Stream row; T5 = 25.2/14.815/3.375/1,125/280
**SRM 6** (3t, spread@75m 5): 0|14.4/16.043/4.32/216/320 · 1|14.4/17.647/3.6/270/400 · 2|15.264/18.576/3.42/283.5/420 · 3|15.84/19.608/3.24/297/440 · 4|18/20.761/3.06/310.5/460 · 5|20.16/23.529/2.7/337.5/500 · 6|20.16/23.529/2.7/337.5/500 (1.5t)
**SRM 6 Stream** (−20%, spread 4): T2 15.264/27.905/3.6 · T5 20.16/41.29/3.6 (Stream ROF true values)
**SRM 6 +Art** (−25%, spread 3.75, 4t): ROF/dmg/heat = plain row
**SRM 6 Stream+Art** (−46.5%, spread 2.67, 4t): T5 20.16/32.653/2.7/337.5/500
**SRM 6 Inferno** (3t, spread 6, 4.5 heat-dmg): T0 10.8/16.043/5.4 · T5 15.12/23.529/3.375
**Medium Laser Short-Burst** (1t): 0|3.5/16.238/1.8/324 · 1|3.5/19.355/1.5/405 · 2|3.675/19.934/1.425/425.25 · 3|3.85/20.548/1.35/445.5 · 4|4.2/21.299/1.275/465.75 · 5|4.55/23.211/1.125/506.25
**Large Laser Short-Burst** (5t): 0|7/11.707/4.92/540 · 1|7/13.953/4.1/675 · 2|7.35/14.371/3.895/708.75 · 3|7.7/14.815/3.69/742.5 · 4|8.4/15.357/3.485/776.25 · 5|9.1/16.736/3.075/843.75

Availability gates (readily available dates): TAG 3033 · NARC, MASC, Artemis IV, Ultra AC/5, LB 10-X 3035-01-01 · pulse lasers + ER weapons 3037 · DHS, AMS, Gauss 3040-01-01 · Beagle/BM probe, Guardian ECM 3045-01-01 · Clan T6 tech 3055.

## 7. Sensor / EW / support equipment

- **ECM** (disrupt mode range | hostile LRM spread | hostile accuracy): EW Countermeasures 3.5t, 160m, +10%, −20% (from 3025) · Black Market Countermeasures 2t, 5m, +80%, −45% (from 3025) · Guardian ECM 1.5t, 220m, +20%, −20% (from 3045) · Clan ECM 1t = Guardian stats (3055). All: shielding −20%, suppression −35%. Mounts ONLY in dedicated `1ECM` hardpoints (gap #27).
- **Active probes**: EW 3.5t +15% sensor, 325m no-LOS, −60% ECM distortion (3025) · Beagle 1.5t +25%/450m/−85% (3045) · BM probe 1.5t +25%/550m/−75% (3045) · Clan 1t = Beagle stats (3055); mounts ONLY in dedicated `1AP` hardpoints (OBSERVED save + UI 2026-11-16, gap #27) — never a generic equipment slot.
- **AMS** (0.5t, from 3040): 3.15/s@160m (T0) → 6.125/s@250m (T5), 300m (T6).
- **Targeting computer** (from 3055; weight w = slots): sensor +10…+22% (w1–7), projectile speed +5…+35%, laser range +4…+10%.
- **MASC** (from 3035; 90–100t class = Mk V): MASC V 5t +50% speed/+380% accel/+170% decel/+30% turn; Supercharger Mk V 7.5t +50%/+400% (no turn/brake boost).
- **Jump jets** (burn 3.5s, vel 8.5): Class V 20–35t 0.5t · IV 40–55t 0.5t · III 60–75t 1t · II 80–85t 1t · I 90–100t 2t.
- Melee: ROF exists in files, not displayed; fists are class-scaled (Medium Battle Fist 30 dmg via Kalbintion Melee; reconcile UI TOTAL WEAPON DAMAGE with fists, §1).

## 8. Career system & upgrade blueprints (Sarna `/Cantinas`, oldid=1509747)

- Cantinas exist in every Industrial Hub and Conflict Zone; unlocked at **Reputation 4** via the "Old Friend" HRQ (Markson). Jobs **never expire** and stay active once accepted; **no penalty for canceling** a job.
- Jobs pay C-bills, equipment, Outlaws/Company reputation, and advance one of five **Career Reputations**: Equipment Collector (EC), 'Mech Collector (MC), 'Mech Hunter (MH), Treasure Hunter (TH), War Dog (WD).
- Each career level unlocks an **Upgrade Blueprint** — installable per-mech into the chassis's upgrade slots (§5, §8 below). Costs are the **100-ton reference** (20t mech = 30% of listed, scaling up with tonnage).
- Treasure Hunter jobs locate items from a fixed ~39-item list (AgroMech parts, encrypted transmissions, caches, consumer goods…) found via markers in procedural missions.

Full blueprint pool (Sl = slots, kCb = cost in thousands of C-bills, d = refit days, all at 100t reference):

| Track | Lvl | Blueprint | Sl | kCb | d | Effect |
|---|---|---|---|---|---|---|
| EC | 1 | Longer Burn Time | 1 | 75 | 4 | +15% jump-jet burn |
| EC | 2 | Anchor Turn I | 1 | 250 | 6 | +7.5% turn speed |
| EC | 3 | Accurate Focusing Arrays I | 1 | 250 | 6 | +7.5% energy range/velocity |
| EC | 4 | Shorter Burn Time | 1 | 300 | 8 | −7.5% laser duration |
| EC | 5 | Refined Armor I | 1 | 750 | 15 | +2.5% armor |
| EC | 6 | Improved Range | 2 | 800 | 10 | +10% weapon range/velocity |
| EC | 7 | Expanded Sensor Range II | 2 | 150 | 6 | +20% sensor range |
| EC | 8 | Faster Projectiles II | 2 | 500 | 10 | +15% ballistic range/velocity |
| EC | 9 | Condensed Cycle Time II | 2 | 500 | 10 | −10% energy cooldown |
| EC | 10 | Faster Weapon Cycling | 2 | 800 | 10 | −7.5% weapon cooldown |
| MC | 1 | Condensed Cycle Time I | 1 | 250 | 6 | −5% energy cooldown |
| MC | 2 | Superior Detonation I | 1 | 300 | 8 | +5% ballistic damage |
| MC | 3 | Heat Containment I | 1 | 250 | 6 | +5% heat capacity |
| MC | 4 | Damage Tuning | 2 | 1,000 | 20 | +5% weapon damage |
| MC | 5 | Missile Exhaust Venting I | 1 | 750 | 15 | −2.5% missile heat |
| MC | 6 | Enhanced Energy Output II | 2 | 600 | 12 | +10% energy damage |
| MC | 7 | Ballistic Heat Transfer II | 2 | 1,500 | 30 | −5% ballistic heat |
| MC | 8 | Potent Warheads II | 2 | 600 | 12 | +10% missile damage |
| MC | 9 | Reduced Power Consumption II | 2 | 1,500 | 30 | −5% energy heat |
| MC | 10 | Reduced Heat Spikes | 1 | 2,000 | 40 | −5% heat generation |
| MH | 1 | Rapid Jump Jet Recharge | 1 | 100 | 5 | +20% JJ refuel rate |
| MH | 2 | Fortified Internal Structure I | 1 | 500 | 10 | +5% internal structure |
| MH | 3 | Faster Projectiles I | 1 | 250 | 6 | +7.5% ballistic range/velocity |
| MH | 4 | Tighter Missile Clusters | 1 | 300 | 8 | −7.5% missile spread |
| MH | 5 | Enhanced Energy Output I | 1 | 300 | 8 | +5% energy damage |
| MH | 6 | Ballistic Heat Transfer I | 1 | 750 | 15 | −2.5% ballistic heat |
| MH | 7 | Responsive Movement II | 2 | 300 | 8 | +20% accel/decel |
| MH | 8 | Aerodynamic Hull II | 2 | 500 | 10 | +15% missile range/velocity |
| MH | 9 | Quick Ammo Feed II | 2 | 500 | 10 | −10% ballistic cooldown |
| MH | 10 | Heat Containment II | 2 | 500 | 10 | +10% heat capacity |
| TH | 1 | Aerodynamic Hull I | 1 | 250 | 6 | +7.5% missile range/velocity |
| TH | 2 | Quick Ammo Feed I | 1 | 250 | 6 | −5% ballistic cooldown |
| TH | 3 | Potent Warheads I | 1 | 300 | 8 | +5% missile damage |
| TH | 4 | Faster Cooling | 1 | 1,000 | 20 | +5% heat dissipation |
| TH | 5 | Reduced Power Consumption I | 1 | 750 | 15 | −2.5% energy heat |
| TH | 6 | Faster Missile Reload II | 2 | 500 | 10 | −10% missile cooldown |
| TH | 7 | Refined Armor II | 2 | 1,500 | 30 | +5% armor |
| TH | 8 | Superior Detonation II | 2 | 600 | 12 | +10% ballistic damage |
| TH | 9 | Missile Exhaust Venting II | 2 | 1,500 | 30 | −5% missile heat |
| TH | 10 | Weapon Heat Transfer | 2 | 2,000 | 40 | −5% weapon heat |
| WD | 1 | Expanded Sensor Range I | 1 | 75 | 4 | +10% sensor range |
| WD | 2 | Target Lock Retention | 1 | 75 | 4 | +25% lock retention + lose-lock time |
| WD | 3 | Jump Jet Thrust | 1 | 100 | 5 | +15% JJ acceleration |
| WD | 4 | Responsive Movement I | 1 | 150 | 5 | +10% accel/decel |
| WD | 5 | Torso Twist Speed | 1 | 750 | 15 | +20% torso twist speed |
| WD | 6 | Faster Missile Reload I | 1 | 250 | 6 | −5% missile cooldown |
| WD | 7 | Anchor Turn II | 2 | 500 | 10 | +15% turn speed |
| WD | 8 | Fortified Internal Structure II | 2 | 1,000 | 20 | +10% internal structure |
| WD | 9 | Accurate Focusing Arrays II | 2 | 500 | 10 | +15% energy range/velocity |
| WD | 10 | Boosted Top Speed | 1 | 1,500 | 25 | +15% top speed |

Worked read from the 2026-11 Atlas screenshot (MODELED): equipped FIS I ⇒ MH ≥ L2; Refined Armor I ⇒ EC ≥ L5; visible shop items imply MC ≥ L4–L6 (Damage Tuning, EEO II), MH ≥ L3–L4 (Faster Projectiles I, TMC), EC ≥ L4 (Shorter Burn Time). On a 100t Atlas the previously recommended fill therefore costs: Damage Tuning 1,000k/20d + Tighter Missile Clusters 300k/8d + Faster Projectiles I 250k/6d = 1.55M and ~34 refit days (check budget/queue vs SKILL.md workflow step 5/6).

## 9. Contract economics (Sarna main page)

- Negotiation rows: **payment / salvage / coverage / airstrikes**. Base reward and available negotiation points scale with **overall Reputation + Standing with the offering faction**.
- **Abort** any standard contract → Standing + Reputation drop. **Campaign missions cannot be aborted (game over).** **Multiple Mission Operations:** aborting any one mission fails the entire chain outright + severe Reputation penalty — chains pay big cash/salvage for that risk.
- Coverage = damage insurance on repairs; payout formula UNKNOWN. Airstrike volume is negotiated in-contract (HotIS+); other support types UNKNOWN.
- Drop-tonnage limits (EXACT when the save carries them): the board contract's `ScenarioDetails.AllowedTonnage` is the per-contract limit — verified on live saves (arena TeamCombat_medium diff 86 → 220t matching the in-game TONNAGE LIMIT; Beachhead diff 87 → 400t; quest False Flag → 360t; FreeForAll_Heavy → 75t; HardcoreArena → 100t). Procedural difficulty→tonnage community tables are a fallback only: arena bouts use format weight-class caps and quests carry fixed per-quest limits, so never apply the procedural table to them. The companion app renders save-exact `Nt` vs modeled `≤Nt M` (procedural only) vs `—` (check in-game).
- Multi-mission leg counts (EXACT): the longest parallel per-leg array inside `MultipleMissionDisplayInfo` (`MissionTypes` / `MissionDurations` / `MissionWeather`) is the op count — verified 2 for the in-game "2 MISSION OPERATION" (Free-for-All open), 3 for a 3-leg assassination op, 0 (empty arrays) for singles. Parser note: `MissionTypes` elements are `TextProperty` FText with `StringTableEntry` history (type 11, `table:key`), decoded as array elements with no per-element Size header.
- Standing also prices the market (§11). Reward-split strategy lives in SKILL.md; this section is the rule layer.

## 10. Mission types (Sarna main page; planning notes are advisor judgment)

| Type | Gate | Rule | Planning note |
|---|---|---|---|
| Arena | Solaris Showdown | FFA/Duel/Lance Duel/Pairs/Exhibition; weight classes; Fame → Prestige rewards | Found in Industrial Hubs + Solaris VII/Galatea/Outreach; bring tonnage-legal builds |
| Assassination | core | kill named target(s), then extract | Targets are highly skilled, in good repair — expect a fight |
| Battlefield | Kestrel Lancers | infinite attacker waves; defenders in GOOD condition; withdraw after minimum | Leaving after minimum is the money math |
| Beachhead | HotIS | drop-pod LZ capture, hold the marked zone | Destroy artillery (shells you) + orbital sensors (enable employer reinforcements) |
| Defense | core | multi-wave facility defense | **Your own damage to the objective counts against its health** — mind splash/collateral |
| Demolition | core | destroy a facility | Defenders not strictly necessary; extract after damage goal |
| Garrison Duty | Kestrel Lancers | enhanced Defense, more good-condition defenders, higher tempo | Sustained AI builds shine |
| Guerrilla Warfare | Chaos Reign | concurrent Assassination/Raid/Demolition on one map | May evac after first objective; pushing on raises damage risk |
| Infiltration | Rise of Rasalhague | recon tasks while avoiding detection | Lights are harder to spot; brief window to kill spotters before alarm; stealth bonus |
| Objective Raid | Kestrel Lancers | recover salvage crates from raid targets | Cargo math, not pure destruction |
| Raid | core | destroy structures per site | Defenders optional; speed favors lights/mediums |
| Scorched Earth | Kestrel Lancers | heavy demolition + high-tempo reinforcements | Plan the withdrawal |
| Targeted Kill | Kestrel Lancers | kill a heavily defended target + recover its crate | Kill-method planning (leg/headshot) pays salvage |
| Warzone | core | infinite waves at a nav point; minimum kills then free extraction | Staying = bonus money at rising damage risk |
| Multiple Mission Operation | core | consecutive missions, days apart, no heal/repair time between | Rotate mechs + pilots; abort = whole chain fails + severe rep |
| High Reward Quest | core | prescripted multi-mission chains across systems, non-consecutive | Hero mechs/pilots/rare loot; time can be taken |
| Campaign Mission | core | story missions | Cannot abort |

## 11. Market & standing economy (Sarna main page)

- **Standing prices the market:** favorable factions discount all purchases, hostile factions mark them up (magnitude UNKNOWN). Standing also drives negotiation quality (§9).
- Faction-specific stock: mechs common in one faction are rare elsewhere (e.g. Victor in FedSuns space); shop inside the right faction's territory. Availability gates: Streak SRMs only after 3035 (SSRM-2 only at first); app `mechs.json` `availability_year` + `borders.json` era maps.
- Conflict-zone markets: reduced selection, damaged mechs, no pilots — hubs remain the refit/shopping anchors (routing rules in SKILL.md).
- LosTech and Hero-mech worlds are highlighted on the Starmap.
- App `economy.json` zone markups {hub 0 / minor .25 / conflict .5 / deep 1.0} are **editable assumptions**, not verified rates. Sell math always uses in-game quotes, never reference multiples (app rule).
- **Mech bay capacity (roster, not lance):** the Leopard has **4 free active bays**; the active roster can lease up to **36 more (40 total)**, billed **quarterly per bay**, with the first 8 leased bays heavily subsidized by Interstellar Expeditions (official 2023-01-17 free-update notes, shipped with Rise of Rasalhague). Any mech in an active bay is eligible for deployment and repair orders. **Cold storage costs no quarterly upkeep but strips all weapons, equipment and upgrades** (manual) — the fitted-upgrade investment is lost on storage (re-install cost/time UNKNOWN). Bench planning therefore counts active bays only; cold storage is inventory, never a ready reserve.

## 12. Pilots (MW5 official game manual + Sarna `/Characters` + app data)

- Six skills, each with current level + potential max; the skill bar = Σcurrent/Σmax; skills grow **after missions, based on performance** (give a pilot ballistics to train Ballistic, etc.):
  - **Ballistic / Energy / Missile** — each raises damage dealt with that weapon category.
  - **Shielding** — reduces the damage the pilot's mech takes in combat.
  - **Heat Management** — raises the mech's heat capacity **and** dissipation.
  - **Evasion** — dodge.
- Hiring: Barracks → Pilot Hire tab; hires appear **only in Industrial Hub systems**; one-time hire cost + **quarterly salary**; dismiss anytime.
- **Injury triggers (manual):** head hit; destruction of any torso; destruction of both legs; ammo explosion. **Death triggers (manual):** head destroyed; CT destroyed. The player commander is immune; injured pilots can't deploy until healed; killed pilots leave the roster after the mission.
- **Traits** (SoK free update 2025-08): 'Mech affinities (mobility bonus while crewing the matching chassis — one-chassis scope; since the 2026-10 patch the bonus set differs per chassis, read in-game), weapon expertise (masters: +10% dmg / −10% CD / +10% range+vel; specialists +5% dmg), economic traits (noble/patriot/criminal/hate/sponsor), **negative traits** (drawbacks that reduce hire cost + salary — cheap pilots may be cheap for a reason). App `pilot_traits.json` catalogs 184 trait assets (DLC9-era, fetched 2026-10-31); `pilot_trait_notes.json` carries per-trait effect notes (184/184; community KGeddon sheet + Nexus #144 + official patch notes).
- **Academies** (SoK): sim-pod quick training → multi-year graduate programs (Nagelring etc.); grant XP, skill-cap increases, and trait chances. Factions run themed academies (e.g. NAIS speed/ballistic/missile flavor per community sheets).
- **Hero pilots** (SoK): bespoke or random, skills capped at 60, hero traits, "Elite Pilot Available" callouts in hubs; re-recruitable if dismissed. Scripted reward pilots (base game/DLC) tabled at Sarna `/Characters` (e.g. Sam Hagel 50/60 Precise/Laser Specialist/Unbreakable; Morgan Trensky 53/60 Bulwark/SRM Specialist/Survivor; Valten Ryder 52/60 AC/10 Master).
- COMMUNITY (unverified): AI quality tracks rank — Majors ≈ Elite AI, start appearing ~rep 13; target 60/60 + Elite; enemy AI tiers Green/Regular/Veteran/Elite scale accuracy and aggression.

## 13. Component damage model (manual-verified + community)

- **Verified (manual):** pilot death = head or CT destroyed; pilot injury = head hit, any torso destroyed, both legs destroyed, ammo explosion. Per-location armor/structure pools: app `mech_locations.json` (location sums verified at build).
- **COMMUNITY (unverified):** mech loss = CT / head / both legs destroyed; destroyed arm or leg transfers incoming damage to the side torso at a reduced rate (~75%), then to CT; losing a side torso takes its arm with it.
- Engine/gyro damage is **repairable in vanilla** (see GRF-1S regression: engine+gyro 1.375M repair line) — "3 engine crits = destroyed" is a modded-rules concept (YAML/Merctech); never import mod rules into vanilla advice.
- Storage practice (community, popular): keep ammo away from CT — ammo explosion is a verified injury trigger regardless of placement.
- UNKNOWN: vanilla crit system (no TT-style crit table found in sources so far), heat shutdown behavior at cap, armor-points-per-ton conversion, salvage parts-to-assemble math.

## 14. Gap & drift log (append-only; cite instead of silently picking)

| # | Finding | Status |
|---|---|---|
| 1 | Kalbintion `upgrades.json` lists only the Equipment Collector career track (10 quirk tiers, HotIS); quirks from the other four Career Reputations (Enhanced Energy Output, Damage Tuning, Tighter Missile Clusters, Faster Projectiles I, Fortified Internal Structure) are absent | repo partial — UI is the source for shop upgrades; tier = career gate (inferred) |
| 2 | Kalbintion `weapons.json` is truncated/malformed JSON (ends mid-object); missing PPC, AC/5-BF, LRM 5, LRM 15-ST/+Art rows | repo partial — use app scrape or Sarna |
| 3 | Stream-variant ROF displayed in UI is wrong (no inter-missile delay); Sarna file-derived ROF is truth | RESOLVED per Sarna note — use wiki ROF for Stream math |
| 4 | AC/5-BF T4 projectile speed: UI 1,265 m/s vs Sarna 1,092.5 | OPEN — doesn't affect upgrade ranking |
| 5 | LRM 15 ST+Art T5 range: UI 1,252 vs Sarna 1,125 | OPEN |
| 6 | Atlas AS7-RS structure: UI 313 vs data 315 | OPEN — immaterial |
| 7 | Ammo per ton: only LRM 440/t verified; AC/SRM unknown | RESOLVED 2026-11-16 — mechlab bin tooltips transcribed: SRM 320/t, AC10 40/t, AC20 20/t, AC5 80/t, AC2 200/t, LB10X 40/t, MG 5200/t, AMS 2000/t, Gauss 26/t, Light/Medium/Heavy Rifle 34/22/12/t, Medium Chem Laser 220/t. App `static/data/ammo.json` (`ammo-v8`) carries exactly these; Small/Large Chem Laser `null` by user choice, other families `null` until transcribed |
| 8 | Spread-stacking formula (Stream × Artemis × NARC/TAG × upgrades) | UNKNOWN — assumed multiplicative |
| 9 | Heat model (10 engine internal + external)×eff; capacity 40+Σcap | MODELED — exact on one chassis, unverified elsewhere |
| 10 | Kalbintion chassis data tagged `source: Core` may predate DLC/patch stat changes | OPEN — prefer UI for owned mechs |
| 11 | Standing market discount/markup magnitude | UNKNOWN — direction only (Sarna) |
| 12 | Damage-coverage payout formula | UNKNOWN |
| 13 | Limb→torso damage transfer ≈75% | COMMUNITY — unverified |
| 14 | Mech-loss conditions (CT/head/both legs) | COMMUNITY — manual only pins pilot injury/death |
| 15 | Pilot AI type hidden; Majors ≈ Elite AI, appear ~rep 13 | COMMUNITY |
| 16 | Heat shutdown behavior at cap; armor pts/ton; vanilla crit system; salvage assembly math | UNKNOWN |
| 17 | Upgrade slots are chassis-specific (app `mechs.json`: 5–10; Atlas AS7-RS 6, UI-confirmed 2/6) — this doc previously claimed a global max of 6 | CORRECTED 2026-11-14 — never assume 6; read the chassis entry |
| 18 | Cold storage strips weapons/equipment/upgrades (manual); whether re-installing blueprints costs C-bills + refit days again | UNKNOWN — warn before storing upgraded mechs |
| 19 | Store mech offers: prices are runtime-computed and NOT persisted (spiked 2026-11-14 on save `39147267…`: `CBillUnitPrice` covers weapons+equipment only); `MarketItemMech` wrappers sit inside `MechLoadoutWrappers` with `ColdStorageLoadout` type, so store offers are not separable from owned cold storage by the current parse | RESOLVED (intake contract) — the app's purchase advisor (`src/lib/purchase.ts`) transcribes offers from the store screen (OBSERVED-UI: variant + discounted price + stock loadout line) and pairs them with save-exact context; stock loadouts DO persist in the offer blob (weapons verifiable in binary) but price never does |
| 20 | BattleMaster 'Mech Affinity chip (OBSERVED-UI 2026-11-15, Pilot Hire screen, DLC9-era): "+10% Top Speed, +10% Torso Twist Speed, +10% Turn Speed, +10% Sensor Range" — differs from KGeddon baseline (top/reverse/torso/turn, no sensors) | RESOLVED for BLR — confirms 2026-10 per-chassis diversification; UI chip is precedence. App override: `VERIFIED_TRAIT_NOTES.Affinity_BattleMaster_Chassis_PilotTrait` + `static/data/pilot_trait_notes.json` BattleMaster entry now carry the observed set; `crew.ts` why-text reads "mobility/sensor bonus" |
| 21 | Pilot hire pricing: save `hiring_cost`/`salary` are BASE values; UI adds a trait premium labeled "HIRING COSTS/SALARY INCREASED DUE TO PILOT TRAITS" (Pearson 2026-11-15: save 434,918/19,107 → UI 478,410/21,018, exactly ×1.10 on both) | RESOLVED 2026-11-16 — premium is +10% per trait, exact to the C-bill on all samples (Crowell 0 traits ×1.00, Pearson/Pettit 1 trait ×1.10 on cost and salary, Kemp 2 traits ×1.20; save 301EF41 + roster screenshot). App prices it: `hireAdvice` scales the steep check by ×(1+0.1×traits) and flags the adjusted quote; hire-table tooltips state the rule |
| 22 | Pilot skill exp→level: save stores per-skill `exp`+`cap`; UI levels of the four hire candidates match thresholds 0/260/975/1980/3422/5072/6962/8874/11250/14110 → 1–10 (12/12 skills), but owned pilot Franco Missile (exp 3675, cap 4) would map to 5>cap | RESOLVED 2026-11-16 — not an anomaly: displayed = min(computed, cap), so computed L5 capped to 4 reads "4/4" exactly. App `levelText` already implements this (cap-truncated ranges read exact). New 3024 hire block tightens app uppers to T4 1980 / T6 5072 / T7 6962 / T8 8874 / T9 11250 / T10 14110; all 19 VERIFIED_CARDS (3024 roster Kemp/Pettit confirm with no further change) still resolve |
| 23 | Patriot_Davion chip reads "FEDERATED SUNS PATRIOT" (OBSERVED-UI 2026-11-16, Kemp roster card) vs catalog label "House Davion Patriot" | RESOLVED (label only) — screenshot wins per protocol; app `VERIFIED_TRAIT_LABELS` maps it, same pattern as Criminal_Kurita |
| 24 | Pettit (save trait Patriot_Liao) chip truncated "FEDERATION PAT…" (OBSERVED-UI 2026-11-16, roster card) — full text unreadable, cannot confirm the Liao-side label | OPEN — needs a clearer crop of Pettit's trait chip; do not assert the Liao label from this screenshot |
| 25 | Per-level skill magnitudes (damage per Ballistic/Energy/Missile level, DR per Shielding level, capacity/dissipation per Heat level, miss-chance per Evasion level) | UNKNOWN — never published by PGI; manual/IGN state directions only; 2021-06 Steam thread asking exactly this ("does 1 point = +1%?") produced no numbers; community "10/10 = max damage multiplier" (Toki) is unquantified. App `crew.ts` lvl/10 alignment is an explicit heuristic, not measured |
| 26 | DLC numbering drift: app `src/lib/format.ts:78` + `src/lib/datapack-client.ts:148` label `DLC6` = "Shadow of Kerensky", but mw5mercs.com/dlc + Wikipedia release order give DLC6 = Solaris Showdown (14.03.24), DLC7 = Shadow of Kerensky (03.09.25), DLC8 = Chaos Reign (3055), DLC9 = Ashes and Ascension (3058). Save `301EF41…83279DF0…` registers `DLC.DLC1–DLC.DLC6` with Solaris arena content live (Arena board missions + SolarisSponsors/SolarisArms/VEST/… standings), corroborating DLC6 = Solaris Showdown | OPEN (label only) — tracked-objective names rendered through `format.ts` for DLC6 arcs will mislabel Solaris content as "Shadow of Kerensky"; fix the map to DLC6: "Solaris Showdown", DLC7: "Shadow of Kerensky" (and add DLC3: "Call to Arms", DLC8/9) before trusting objective/quest labels. DLC-ownership gating for this save is DLC1–6 = HotIS + Kestrel + Call to Arms + Rasalhague + Dragon's Gambit + Solaris |
| 27 | ECM/BAP mounting: Kalbintion hardpoint data has dedicated EW tags (28 chassis carry `1ECM`, 13 carry `1AP`; VL-2P, RVN-1X/RVN-3L, QKD-4P, CTF-0X/0XP, ZEU-SA3, BLR-1P, SHC-B carry both). Every observed save placement coincides with a tag (PXH-2 Guardian in its `1ECM` CT; TBT-LG BAP in its `1AP` LT), and the player reports the lab shows no ECM/probe mount on their other 25 active mechs (OBSERVED-UI 2026-11-16) — contradicts this doc's §7 "fits any slot via Valid Only toggle" | RESOLVED 2026-11-16 — EW items are dedicated-hardpoint-gated (`1ECM`/`1AP`); §7 corrected, advisor parseHardpoints/capabilitiesOf now parse the tags and warn on homeless loose EW gear. Player fleet check (save 68DBB676, 3024.09.16): 0 of 83 owned variants carry `1AP` (loose BM_Arena_ActiveProbe homeless); only `PXH-2` carries `1ECM` |
| 29 | Salvage `InstalledWeapons` parse gap: `fitted_weapons` collected `Option<Vec>` atomically, so one hand-actuator/"None" placeholder slot nulled the whole list on all 9 salvage mechs (live screen save `301EF41…6F613043…`, 33 shares). Salvage `WeaponData` nests the id (`WeaponId.ID.PrimaryAssetName` — bench shape is flat) but `deep` search covered both; the placeholder was the sole failure. Bench-only unit tests never carried actuator slots, so it never surfaced | RESOLVED 2026-11-16 — parser skips placeholder/unreadable entries (missing/unparseable `InstalledWeapons` still → null, empty → []); `fitted_equipment` hardened the same way. Verified on the live save: MAD-2R parses to 5 fitted weapons (2× PPC_Lvl4 ✓, 2× ML SB Lvl4 ✓, AC5 Auto Lvl4 damaged) + 5 fitted DHS. Salvage advisor (`src/lib/salvage.ts`) now emits Fitted weapons/equipment + pre-gate Rarity evidence per mech and the claims section renders a fitted-gear strip |
| 30 | Board tonnage modeling over-applied: app modeled arena + quest rows from the procedural difficulty table (TEAM COMBAT MEDIUM diff 86 modeled ≤400t vs in-game 220t) | RESOLVED 2026-11-22 — `ScenarioDetails.AllowedTonnage` verified as the exact per-contract field on live saves (TeamCombat_medium 220, Beachhead_002 400, False Flag quest 360, FreeForAll_Heavy 75, HardcoreArena 100). `BoardMission.max_tonnage` / `num_missions` now parse save-exact; UI renders exact `Nt`, procedural fallback `≤Nt M`, arena/quest-without-field `—` (check in-game) |
| 31 | Multi-mission op count had no save source; `MultipleMissionDisplayInfo` fell back to Raw (array scalar of type `TextProperty`) | RESOLVED 2026-11-22 — parser gains `TextProperty` array elements (`parse_ftext_unbounded`) + `StringTableEntry` FText history (type 11, `table:key`). Leg count = longest parallel per-leg array (`MissionTypes` / `MissionDurations` / `MissionWeather`): 2 = "2 MISSION OPERATION", 3 = 3-leg assassination op, 0 = single |
| 32 | `static/data/ammo.json` meta drift: README cited `ammo-v7`, live file is `ammo-v8` (same verified rows) | RESOLVED 2026-11-22 — README updated to `ammo-v8`; Small/Large Chem Laser stay `null` by user choice |
| 28 | Raw-standing → negotiation-bonus bands: two community tables conflicted (2022 r/MW5 36-pt bands +5/164 +4/128 +3/92 +2/56 +1/20 −1/−20 −2/−56 −3/−92 vs 20-pt bands 100/80/60/40/20). OBSERVED-UI 2026-11-16 Factions tab settles it: Steiner 191=HERO/+5 (prior save 160=HONORED/+4, so the +4/+5 break is inside (160,191]), Independents 139=HONORED/+4, Marik −59=DISLIKED/−2, Outlaws −44 & Periphery −45=SUSPICIOUS/−1, Davion 0/Kurita −5/Liao −8=INDIFFERENT/+0 — 7 points all fit the 36-pt table; the 20-pt table is refuted (it predicts 139→HERO, −44→−2) | RESOLVED for 0/±1/±2/+4/+5 bands — app `static/data/standing_tiers.json` (tiers-v1) + `standingTierFor`, per-tier `verified` flags. OPEN: +1 name (Table A "RECOGNIZED" vs Faction Standing Tweaks "Respected"), +2/+3/−3 names unobserved, −4/−5 names+thresholds unknown (symmetric extension encoded, UI renders tier-unverified) |
| 33 | Same-house Noble stacking: assumed additive (+5% per pilot). OBSERVED-UI 2026-11-23 Perkasie (HOUSE DAVION Industrial Hub): roster holds 2x Noble_Davion (Givens roster + Bright hired after save `4574B953…`), market footer shows single line "HOUSE DAVION NOBLE 5% OFF ALL PURCHASES", starmap chip "PURCHASES -5%" — no 10% | RESOLVED for market discount — duplicate same-house Nobles do NOT stack (one instance counts). OPEN: payout-bonus stacking (2x Noble payout, Noble+Con Artist+Patriot payout combos) still unverified — needs contract negotiation screenshot with bonus breakdown; save `4574B953…` predates Bright hire (Bright still `source: hire`), so re-pull after a new save to confirm roster state |

Refresh protocol: re-fetch the Sarna `/Equipment` and `/Cantinas` pages (note new `oldid`s here) and the main page; re-scrape the Kalbintion repo master; update the app `static/data` `meta.fetched` dates; append new drifts to this table with date.
