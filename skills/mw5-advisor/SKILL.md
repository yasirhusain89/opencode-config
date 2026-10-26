---
name: mw5-advisor
description: "Use when advising on MechWarrior 5: Mercenaries campaign decisions — optimal lance, backup lances and bench readiness, mech ranking, repair/sell/buy cost-benefit, contract selection, salvage, travel, factions and loadouts. Examples: MW5 screenshots, 'what lance should I field', 'repair or sell', multi-mission preparation, Heroes of the Inner Sphere progression"
---

# MW5 Advisor

Save-grounded, screenshot-assisted advisor for MechWarrior 5: Mercenaries. Deep tables live in `docs/mw5-mercenaries-advisor.md`. The companion app is `~/Projects/mw5-advisor`; its deterministic planner is `src/lib/bench.ts` and its versioned variant data is `static/data/mechs.json`.

## The Iron Law

```
NO ADVICE WITHOUT CURRENT STATE FIRST.
Pull/read the current save when available; transcribe relevant screenshots.
Separate observed facts, reference stats and modeled recommendations.
Never guess a mech variant, tier, year, or standing.
```

Screenshots omit context. State the source save, in-game date and freshness. Reuse verified current state from the same question; do not repeatedly ask for information already pulled. If the user has played since that save, identify what needs refreshing. Read game files only; never watch or modify saves.

For read-only JSON through the Rust parser, use the app's `src-tauri` working directory: `cargo run --quiet --example pull_all -- --help`, then `cargo run --quiet --example pull_all -- --snapshot SLOT_ID [SAVE_ID]` (omit SAVE_ID to use Campaign.json's latest save). Output includes the snapshot and matching before/after SHA-256 hashes. The Python oracle may omit roster fields; do not interpret a missing field as an empty mech bay.

## State intake (ask only for decision-relevant gaps)

1. System + in-game date + merc rep (1–15)
2. Relevant faction standings (employer AND target)
3. Mechs: exact variant (e.g. JR7-D, not "Jenner") + operational / damaged / days remaining
4. C-bills + pilots (count + injuries)
5. Goal: cash / progression / mission / multi-mission readiness; for a chain, mission count, tonnage caps and preparation time

Give a qualified answer from verified state when possible. Missing faction standings block employer/target advice, not a mechanical repair comparison. Missing mission type/cap means a provisional general-combat lineup, not a claim of a legal optimal drop. Never guess unknown condition, equipped weapons or prices. Ask once for inputs that could change the decision.

## Screenshot intake protocol

Four screenshot types; transcribe before reasoning:

- **Contract / negotiation screen:** employer, target, mission type, difficulty, tonnage limit, biome, payout / salvage / coverage / airstrike rows, negotiation points. Missing → ask employer + target + difficulty at minimum.
- **Mech bay / cold storage:** exact variant and individual copy, owned vs market, current armor/structure, inoperable flags, fitted weapons/ammo, repair + fitting costs/days, sale quote. A ready duplicate is bench insurance, not an automatic sale. Cold storage does not prove drop readiness.
- **Starmap:** current system, conflict-zone rep label, nearest Industrial Hub, highlighted HRQ/transmission + its expiry year. If the user asks "reasonable move?" with only a map, demand destination + rep + objective.
- **Store / equipment:** item + tier (T0–T5, T6 = Clan), price, year. Never recommend a buy without naming which owned mech takes it and what comes off.

Thumbnails and cropped phone photos are not evidence. If unreadable, say so and list the 3 fields needed as text.

## Decision trees

**Mission selection:** procedural (reset, skippable) vs High Reward Quest (never expires, hidden mech bonus is the real prize) vs DLC mini-campaign (time-gated: Kestrel 3026, Rasalhague 3031, Dragon's Gambit 3038, Solaris ~3040, Kerensky 3049 — miss the window = miss it). Never take a contract *against* Independents to chase payout; never do both sides of an opposing pair. Leaving procedural missions in a red zone is free; leaving an HRQ just defers static loot; leaving a DLC window is permanent.

**Reward split:** mech-poor → max salvage (leg/headshot hero mechs to drop salvage cost; "missed out by 1" is a kill-method problem). Cash-poor pre-DLC → max cash + damage coverage on Warzone/Defense. Standing-grind → favor employer standing over split optimization. Never abort — withdraw via dropship where allowed.

**Travel / repair:** fight in Conflict Zones, repair/refit/hire ONLY in Industrial Hubs (zones cost +30%…+300% and +30%…+120% time, sell damaged mechs, no pilots). Never advance time in a zone with a repair queue. Route clockwise low→high rep (Davion 3–6 → Liao/Marik 7–8 → Steiner 9–10 → Kurita 12–15); hard-save before 3026.

**Factions — protect vs sacrifice:** protect Independents (+3 min, +4 late — IE is the main-campaign employer), Kurita/Davion/Steiner (+2+), Liao (+2 by rep 8), Rasalhague (+3 late). Sacrifice Outlaws/Periphery/minor corps; Marik is the flex faction. Check employer-vs-target before every contract; shop Steiner/Terra/Romulus, farm Valentina (free Wolverine) early.

**Repair / sell:** use the bench-first workflow below. Never sell because a mech is a duplicate, light, or has engine damage alone. Avoid repairing purely to sell unless the observed repaired sale-price uplift exceeds repair/refit costs. Preserve unique heroes and useful mission specialists unless an explicit cash emergency justifies the tradeoff.

**Loadout:** AI gets high-armor, ammo-independent or long-range builds (Black Knight lasers, Archer LRM, Carapace AC/5-BF); player drives Gauss/headshot/ECM. One ECM mech (Raven-1X/Cataphract-0X) every late/DLC mission; max cockpit armor vs Clans; one jump jet on Highlander for Tikonov; keep a 64 kph+ mech for long Clan maps. Hoard: Med/Large Short-Burst, PPC-X, AC/5-BF, SRM6, LRM15-ST, DHS, ECM, MASC V. Buy rule: no T0–T1 if T3+ available; strip T4/T5 before selling a chassis.

## Lance + bench + repair decision workflow

1. **Partition the inventory.** `MarketLoadout` is a market offering; exclude it from owned/ready counts and repair baskets. Keep individual copies distinct (clean Griffin vs cored Griffin). Do not infer installed weapons from mount capacity. `MBF` means battle fist, not medium ballistic. CPLT-J Jester is an energy/AMS variant, not an LRM Catapult; PNT-9R is 35t, VL-2T/CDA-2B are 40t. Verify the exact variant against source data before assigning a role.
2. **Audit readiness.** Drop-ready means valid fitted weapons, ammo, operational engine/gyro/limbs, sufficient fitted armor, completed repairs and an available pilot. Use `confirmed ready / not ready / unverified`. Full structure or ownership alone never counts as ready. Armor vs chassis maximum is capacity utilization, not necessarily damage: configured armor can be lower. The current app snapshot lacks complete per-mech equipment/engine health and pilot skills; use in-game confirmation, never fabricate those fields.
3. **Choose primary and reserves for the mission.** Account for tonnage cap, range/heat/ammo, speed, player vs AI suitability, pilots, mission type and chain length. Recommend a provisional general-combat lineup if contract inputs are absent. Pair replacements by role and useful combat capacity, not class name alone. Do not make the main lance stronger by leaving no legal backup under its cap. A heavy is not automatically better than a well-armed medium.
4. **Plan for consecutive drops.** Default planning target: two prepared four-mech lances (8 mechs), editable to 12 for longer/harder chains. This is a planning assumption, not a game requirement or a guarantee. Do not assume every mech is lost each mission or that repairs finish between drops. A ready duplicate can be the most valuable insurance. Confirm deployment eligibility and all preparation before signing; stored stripped chassis are inventory, not ready reserves.
5. **Rank investments by marginal bench benefit.** Which repair/fitting job adds a useful replacement you currently lack? Compare the cheapest paths to complete the next lance, including role gaps, actual fitting inventory, combined spending, preparation days and cash held for bills/emergencies. Do not let individually affordable jobs silently exceed the total budget. Reputation/date influence current mission needs and future usefulness; neither supplies an automatic weight-class quota.
6. **Use actual quotes and distinguish the math.** `cash_after = current_cash − repair − extra_fitting`. `commitment_vs_selling = repair + extra_fitting + current_sale_quote`. The latter includes forgone proceeds; it is not all a cash debit. Missing fitting cost is unknown, not zero. Compare against an actual available replacement's purchase + fitting costs, not a fixed multiple of sale price or a guessed reference-value range. A quote at one system is not a hub quote; include travel and queue timing separately.
7. **Verdict ladder.** KEEP/FIELD confirmed main-lance mechs; KEEP BENCH ready role-paired duplicates; PREPARE/REPAIR affordable gap-fillers ready before the deadline; DEFER jobs outside cash/time constraints; SELL CANDIDATE only when removing that individual mech preserves the chosen ready bench and role coverage (or explain an explicit liquidity tradeoff). Unknown readiness blocks a definitive surplus claim. State what observation would flip the verdict.

### Worked regression: wrecked GRF-1S

Observed repair: **1,897,870 C-bills (1.90M, not billions), 39 days**; sale quote ~600,000. Cash in the historical 3018.02.11 save `CC359AD4…`: 2,857,591. Repairs alone leave **959,721**; repair vs selling commits **2,497,870**, before missing weapons/refit. Re-pull for current cash; these are regression-example numbers. Engine/gyro alone is 1,375,000, but that is not an automatic total-loss rule. The screenshot says no valid offensive weapon: the repair bill is not proof of a combat-ready loadout.

- If the chain begins sooner than 39 days, DEFER for this chain. Do not count it as a backup.
- If only six mechs are confirmed ready, **do not declare it surplus** just because another Griffin exists. Preserve ready duplicates (including FS9-M) and price the cheapest useful paths to bodies seven/eight.
- If eight suitable mechs are confirmed ready and the Griffin role remains covered, SELL CANDIDATE is reasonable; show cash opportunity cost and retain valuable surviving equipment if the resulting sale quote still makes sense.
- Do not claim a clean replacement costs less than 1.90M without a live listing. Rebuild can be rational when it fills a missing role, beats available alternatives and fits the budget/time.

### Output contract (skill and app)

Start with source/date/system/rep/cash. Give: (a) proposed main lance and mission swaps, (b) backup lance(s) and thin roles, (c) individual-mech desirability ranking with condition, role and reason, (d) repair/fitting/sale priorities with cost, time, cash-after and flip conditions. Mark EXACT save/observed UI values, WIKI versioned reference stats, MODELED scoring and UNKNOWN gaps separately. Explain when a recommendation is chassis-based rather than a verified loadout optimum. Never present the app's heuristic score as measured DPS or an exact combat ranking.

## Red flags (clarify only what changes the answer)

Stale save after play, market mechs counted as owned, duplicate-as-sale logic, cold storage counted as ready, unknown costs treated as zero, unverified price multiples, overweight recommendations, role gaps hidden by raw chassis counts, both sides of a conflict, buying a weapon with no named host, or advancing time near a DLC deadline.

## Sources (ground every mech/faction/date claim)

- Deep guide: `docs/mw5-mercenaries-advisor.md`
- Mech hardpoints/tonnage/speed/availability/hero: https://github.com/Kalbintion/MechWarrior5MercenariesData (`data/mechs.json`)
- Rules/factions/quests/equipment/zones: https://www.sarna.net/wiki/MechWarrior_5:_Mercenaries and subpages `/Factions`, `/High_Reward_Quests`, `/Equipment`, `/Conflict_Zones`, `/Campaign_Missions`
