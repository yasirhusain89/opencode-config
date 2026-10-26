# MW5: Mercenaries — Game Advisor (v1 static guide)

Sources used:
- Mech stats / hardpoints: https://github.com/Kalbintion/MechWarrior5MercenariesData (`data/mechs.json` — fields: `name, model, ton, hero, speed, source [Core/Heroes/Kestrel], availability [year], hardpoints per location, armor/structure, salvage, value`)
- Rules / factions / quests / equipment / travel: https://www.sarna.net/wiki/MechWarrior_5:_Mercenaries + subpages `/Factions`, `/High_Reward_Quests`, `/Equipment`, `/Conflict_Zones`, `/Campaign_Missions`

Yes, the two combine well: Sarna tells you *where to go, who to work for, and what quest to take*; `mechs.json` tells you *whether the reward mech is actually good* (hardpoint layout, speed, upgrade slots, year-available, hero bonus).

## 1. Core loop you must play around

- **Two reputations:** Merc Reputation (1–15) gates campaign + High Reward Quests. Faction Standing (-5…+5 approx) gates negotiation points, shop prices, and salvage shares.
- **Standing matters for money:** high standing = more negotiation points + shop discount; low standing = expensive shops, worse payouts. Aborting contracts drops both.
- **Conflict Zones vs Industrial Hubs:** fight in red-outlined Conflict Zones (rep-labeled difficulty, e.g. Mercenary Row rep 3 → Draconis Badlands rep 13). Repair/refit in Industrial Hubs — Conflict Zones charge +30%…+300% and take +30%…+120% longer, sell damaged mechs, and have no pilots. Hub strings are where you hire pilots, buy clean mechs, and do refits.
- **Tiers:** weapons Tier 0–5 (higher = more damage, faster reload, less heat, longer range, faster projectile). Tier 6 = Clan tech, markets from ~3055 with *Shadow of Kerensky*. Jump Jets / MASC are Classes by weight, not tiers.
- **Tech dates are real:** e.g. Raven sightings ~3024 then buyable; Streak SRM-2 only after ~3035; LB-10X / Ultra AC/5 ~3035. `mechs.json: availability` encodes the same idea for chassis — filter by `availability <= current year`.
- **Campaign vs DLC structure:** main campaign missions are rep-gated (final `Crucible` = rep 15). DLC mini-campaigns are **time-gated**: Kestrel 3026, Rasalhague 3031, Dragon's Gambit 3038, Solaris ~3040, Kerensky 3049, Chaos 3055. Miss the transmission window = miss the DLC. High Reward Quests (HRQs) do **not** expire and don't need consecutive completion — unlike Multi-Mission Operations which do.

## 2. Travel path (clockwise, low → high rep)

Campaign Conflict Zones progress roughly clockwise: Federated Suns (low) → Liao/Marik → Steiner → Kurita/Draconis (high).

### Early (rep 1–6, ~3015–3022) — build core
1. Start Davion space: Mercenary Row (3) → Inferno's Wake (4) → Davion/Kurita Frontline (5).
2. Detour ASAP to **Valentina (Kurita space)** for the hidden free SLDF **Wolverine** — best early medium, carries you until heavies.
3. Grind to ~20–30M C-bills, 6 good pilots, 8–10 mechs with 2+ heavies before leaving early game. Favor **salvage over cash** in negotiations while you're mech-poor.
4. Shop in hubs, not zones. Early Terra / Steiner hubs are the best heavy-buying spots (see §4).
5. Do rep 3–6 HRQs as they unlock (Armed Robbery, Frontline Support, The Traitor, A Cunning Decoy) — they're static difficulty, good for training + cheap hero/rare parts.

Exit early game before ~3022 if you own DLCs — 3026+ gets dense.

### Mid (rep 6–11, ~3022–3035) — scale to assaults
1. Liao border (rep 7–8): Duchy of Tsitsang, Rashpur-Owens, Sian Commonality, Liao/Davion Border. This is where `Hazing of the Weak`, `No Pilot Left Behind`, `Errant Signal`, `Bow and Arrow` live.
2. Marik/Steiner border (rep 9–10): Commerce Hub, Marik/Liao Border, Duchy of Tamarind, Marik/Steiner Border. Buy **Battlemaster-1G, Stalker-3F, Atlas-RS** here (Steiner markets).
3. Aim by end of mid: 4–6 mediums, 4–6 heavies, ~8 assaults, 8 pilots, ~50M buffer. Keep **one fast light** (Firestarter/Jenner/Wolfhound/Assassin) for Infiltration missions — heavies get detected.
4. Finish main campaign ~3024 if possible, **before Kestrel Lancers (3026)** locks you into a tight multi-mission timetable with no time for big repairs.

### Late (rep 12–15, 3035+) — optimize + DLCs
1. Kurita high-rep zones: Lower-Class Kuritan Worlds (12), Rogue Cluster (12), Steiner/Kurita Border (12), Draconis Badlands / Drought Worlds / Graveyard (13), Comms Relay / Peripheral (14).
2. Post-campaign zones (13–15): Alarion Periphery, Outworlds Alliance Border, Rasalhague Outer Reaches, Taurian Corridor.
3. Run Cantina Jobs + Bounty Hunter rival intel in parallel — they give career quirks (sensor range, speed, cooldown) and rare rewards.
4. For DLC marathons (Kestrel / Rasalhague / Dragon's Gambit) bring **3 effective lances + 8–10 pilots** so damage/injury rotation doesn't stall you. Kestrel specifically: gaps only allow armor patching / light wounds. Put ECM mechs 4th to minimize damage, keep a jump-capable Highlander for Tikonov.

## 3. Quests to pick (HRQs — do these, skip the rest first pass)

All HRQs list C-bill + rep openly; the **hidden mech/equipment bonus** is the real prize. They don't scale — do them as soon as you qualify.

Must-do, in rep order:
- **Rep 3 Armed Robbery (IE):** Locust-3V + T2 medium lasers. Easy starter.
- **Rep 5 Frontline Support — pick ONE side:** Davion = Panther-9R + PPC; Kurita = Spider-5K + AC/10-BF + SRMs. Pick based on §4 faction plan; Kurita side slightly better loot early.
- **Rep 6 A Cunning Decoy (Avalon/Davion):** 1.25M + T3 LRM-5s. Pure money.
- **Rep 7 Industrial Espionage (Liao):** free Vindicator. Cheap heavy-medium filler.
- **Rep 8 Errant Signal (Liao):** Stalker-3F path — outfit with med lasers + SRM6; workhorse assault.
- **Rep 8 No Pilot Left Behind (Liao):** Battlemaster-1G — fast assault, great AI mech.
- **Rep 8 Bow and Arrow (Marik, Heroes DLC):** Archer Agincourt + 2× Charger-1A5. Agincourt is a top-3 missile boat; 1A5 is your fast mini-Atlas (note: ECM Ravens/Chargers *in* Kestrel can't be salvaged — get them here instead).
- **Rep 9 Hazing of the Weak (Sian, Heroes DLC):** the jackpot — Black Knight-6, Highlander-732B, Stalker-3Fb, Orion-YAJ. This single chain fixes your heavy/assault roster.
- **Rep 9 Operation Onoda (Rasalhague):** rep bridge to FRR +3 (needed later).
- **Rep 11 X Marks the Spot (Pirates, Heroes DLC):** Corsair-PVT (2× Gauss + Large SB + LRM10 build) + late Banshee-3P. Don't skip.
- **Rep 11 Stop the Launch (Steiner, Heroes DLC):** King Crab Carapace + T5 weapon cache. Tight schedule — prep first. Build: 4× AC/5-BF + 2× LRM10, AI fire-support sponge.
- **Rep 12 Rise of the Black Dragon / Crimson Crusade (Kurita):** Atlas-RS #2, Banshee-3P (PPC-X + med lasers), Dragon-Sidewinder. Finish your Atlas pair here.
- **Rep 13 Charity Case:** Banshee-3P → outfit with MASC V, LPL, med lasers.
- **Eyes on Democracy final (Independents):** Cataphract-0X + Raven-1X — your ECM pair for Kestrel and Clan content. Bring ECM to every Clan mission.

Choice quests (opposing factions — you only get one): Frontline Support Davion/Kurita, Invasion Support Kurita / Back Channel Deal (Davion), Defense Support Davion / Intriguing Offer (Kurita), Picking up the Pieces (farmers, Cicada + LRM) vs Picking at the Scraps (IE, cash + pulse lasers). Decide by §4 — don't flip-flop, standing losses hurt.

DLC campaigns (time-locked, prep before the year): Kestrel (3026, bring jump jets + depth), Rasalhague (3031, salvage Banshee-3S on Gunsberg), Dragon's Gambit (3038, Mauler-2P/MX90S + Otomo variants + LosTech caches), Solaris (Arena Fame for unlocks), Shadow of Kerensky (max cockpit armor — elementals headhunt; bring ECM + Gauss/heavy rifles; 64 kph+ mechs for long maps).

Arena Fame does **not** raise Merc level — don't grind arenas for rep.

## 4. Factions — support vs sacrifice

Mechanics: work *for* X = +standing with X and its subsidiaries, -standing with the target. Prices + negotiation points follow standing.

### Support (keep positive)
- **Independents (+3 minimum, +4 late) — NON-NEGOTIABLE.** Interstellar Expeditions (your main-campaign employer, missions 1–5, 8–11, 13–14, 16–21) is an Independent subsidiary. Low Independent standing cripples main-story payouts and options.
- **House Kurita (≥ +2, higher late).** Best late-game markets (Dragon, Hatamoto-Chi, Mauler, Charger-3K, Atlas-K/RS) + Deliverance + Dragon's Gambit + Black Dragon chains. Kurita space is where the endgame lives.
- **House Davion (≥ +2).** Best early markets + Kestrel Lancers employer + Victor, Zeus, Enforcer, JagerMech-A/DD. Davion/Kurita frontline is your early grinding home.
- **House Steiner (≥ +2, shop here).** Best assault shelves: Zeus-6S/6T/9S, Banshee-3S, Highlander-733 trio, Victor-9S, Battlemaster-1S. Stop the Launch + False Flag + Shadow Coup chains.
- **House Liao (+2 by rep 8).** Unlocks Hazing/Errant Signal/No Pilot chains + Raven-1X/3L/4X, Vindicator, Cataphract-0X/0XP, Stalker access. Cheap to please early, big payoff.
- **Free Rasalhague Republic (+3 from ~rep 10).** Required for Rasalhague DLC + late grind. Get it via Operation Onoda, not random contracts.

### Let deteriorate (acceptable losses)
- **Outlaws (Pirates/Bandits/Ronin/Black Dragon rebels):** no markets you need, no campaign employer. Dump standing freely — X Marks the Spot even farms them.
- **Periphery Realms (Magistracy/Taurian/Outworlds) except when a specific HRQ needs them:** Dire Circumstances / Tributes give one-off Marauder/Warhammer — take the mech, then ignore them.
- **Marik extremists / minor subsidiaries (DuraPaq, Gienah, Tamarind Mining):** no unique must-have chassis; sacrifice if a good Davion/Steiner contract targets them.
- **House Marik (neutral-to-cool is OK):** decent Archer/Orion/Marauder-3M markets but nothing you can't get via Steiner/Davion. Don't tank it on purpose (Bow and Arrow + Chasing Ghosts need access), but it's your flex faction — take hits here to protect Independent/Kurita/Davion/Steiner/Liao.
- **ComStar (Terra):** special case — only one system, but Terra hubs sell Star League tech (Crab-27/27SL, Black Knight-6/6B, Highlander-732/732B, King Crab-000B, Nightstar-9J). Don't burn it before you've shopped Terra in Campaign (20–70t pool) / Career (45–100t pool).
- **Rival mercs (optional):** farm intel for the Bounty Hunter (Head Hunting → Marauder-BH) but don't worry about their standing.

Rule of thumb for random contracts: check employer vs target first. Never take a contract *against* Independents / your current grind faction just because difficulty looks easy. Scout the system: pick contracts where employer = faction you're building, target = Outlaws/Periphery/Marik-subsidiary.

## 5. Best mechs (cross-checked vs `mechs.json` hardpoints)

How to verify in `mechs.json`: prefer high `upgrade_slots` (hero ≥8), `speed ≥64.8` for AI assaults (they get hit less), torso/arm energy+missile mixes for AI-friendly builds, and `availability <= your year`. `hero:true` = extra quirks/slots.

### Early game (light/medium)
- **Wolverine-6R (free, Valentina):** do this first. Fast, jumpy, good slots for the era.
- **Firestarter-H/S, Jenner-D, Wolfhound-1/1A, Panther-9R:** keep one. Firestarter for demolition (flamers+MGs chew buildings), Wolfhound/Panther for precision.
- **Blackjack-1/1DB/1DC, Centurion-A/AH/AL, Hunchback-4G/4H/4P, Crab-20, Kintaro-18:** best medium brawlers. Crab-20 (full energy, no ammo) is the AI-friendly pick.
- **Raven-1X (Liao/Davion shops or Eyes on Democracy):** not for damage — for ECM. One Raven changes Clan/Kestrel missions.

### Mid game (heavy — the real jump)
- **Archer-2S > 2R:** 2S adds torso SRMs; excellent AI LRM boat. Agincourt (Bow and Arrow) is the keeper.
- **Crusader-2R / 3D:** Agincourt-but-lighter; strip MGs for AI.
- **Black Knight-6B / 6:** 4× Med Pulse + 3× Med in arms + armor/heatsinks (strip one pulse from Valentina Wolverine). Best laser brawler.
- **Warhammer-6R, Marauder-3D/3R, Thunderbolt-5S/5SS, Orion-M/V/VA, Catapult-C1:** solid, but replace with below when possible.
- **Cataphract-0X:** ECM + armor; park 4th in Kestrel order to protect it.

### Late game (assault — live here)
- **Battlemaster-1G (×2):** 64.8 kph fast assault, ideal AI mech. 1G-S Otomo late replaces base.
- **Stalker-3F / 3Fb:** missile wall (2× Lge SB + med SB + SRM6 / 2× LRM10). 3Fb with PPC-X is elite.
- **Atlas-RS (×2, Deliverance + Black Dragon) → Atlas-D/K late → Atlas II (Romulus shop):** AC/5-BF + Large SB + SRM4/6. Backbone.
- **Banshee-3S (Crucible / Gunsberg) > 3P > 3E/3M:** fastest assault brawler; PPC-X + med lasers (3P) or full T5 loadout (3S). MASC V on 3P is meta.
- **Highlander-732B:** put 1 jump jet on for Tikonov/Kestrel, then cold-storage it.
- **King Crab-0000 → Carapace (Stop the Launch):** 4× AC/5-BF + LRM10; best AI damage sponge.
- **Corsair-PVT (X Marks the Spot):** 2× Gauss + Lge SB + LRM10; headshot machine.
- **Charger-1A5 (×2, Bow and Arrow):** 80t at assault speed; mini-Atlas that actually keeps up on long Clan maps.
- **Mauler-1R/MX90/2P, Longbow-0W/7Q, Nightstar-9J (Terra), Cyclops-11-A (CP):** specialist fire support / command. Cyclops-11-A's battle computer buff is worth one slot.
- **Avoid:** Banshee-3E (under-gunned for 95t), Charger-1A1 (peashooter), Catapult-A1 (all-missile, no backup), Awesome-8Q early (hot, slow).

AI tips: give AI high-armor, ammo-independent or long-range builds (Black Knight lasers, Archer LRMs, Carapace AC/5-BF). You drive the Gauss / headshot / ECM mech. Always max cockpit armor vs Clans.

## 6. Best equipment

- **Must-hoard:** Medium Short-Burst + Large Short-Burst lasers, PPC-X, AC/5-BF (and T4+ AC/10/20-BF), SRM6 (+Artemis when available), LRM15-ST / LRM20-Art, Double Heat Sinks (one per Cold Snap chain — grab it), ECM Suite, BAP, TAG/NARC for missile lances, MASC V / Supercharger for Banshee/Charger.
- **Ballistics:** AC/5-BF is the workhorse (range + DPS + low heat). UAC/5 + LB-10X Slug post-3035 replace singles. AC/20-BF for brawlers, Gauss / Heavy Rifles for Clan headshots (one per lance minimum vs Clans).
- **Energy:** SB lasers > standards (shorter burn, better AI accuracy). Pulse for lights/mediums, PPC-X for assaults (Stalker-3Fb, Banshee-3P builds above).
- **Missiles:** SRM4/6 for brawl, LRM10/15 for AI boats. Stream SRMs are smoother than standard. Infernos for heat-locking Clan mechs.
- **Support:** ECM on one mech every late/DLC mission (counters enemy ECM). AMS on missile-heavy defense/Warzone. Jump Jets by class (Class IV for 40–55t etc.) — one JJ on Highlander is mandatory for Tikonov.
- **Melee (Call to Arms+):** Hatchetman-3F + Medium Hatchet/Claw/Mace from Those in Need. Fun, but keep one ballistic/energy backup — pure melee struggles on Beachhead/Warzone.
- **Buy rule:** never buy T0–T1 if T3+ is available in a hub; strip T4/T5 from X Marks the Spot / Stop the Launch / Cold Snap rewards before selling the chassis.

## 7. Anything else that wins campaigns

- **Negotiation:** max salvage on hero-mech HRQs (headshot/kill the legged mech last so salvage cost drops), max cash + damage coverage on Warzone/Defense grind. Never abort — rep + standing hit isn't worth it; withdraw via dropship instead where allowed.
- **Pilots:** 6 good by mid, 8–10 by late (60 skill target). Injuries sideline DLC runs — rotate, don't wait.
- **Mech bays:** expand 12 → 40 (lease the 36). Cold-store niche mechs (Highlander post-Kestrel, lights pre-Infiltration) instead of selling heroes.
- **Cantina Jobs:** do passively — 5 tracks (Equipment/Mech Collector, Mech Hunter, Treasure Hunter, War Dog) give permanent quirks (speed, sensors, cooldown). Check every hub cantina.
- **Black Markets (purple):** check in Conflict Zones — sometimes cleaner than hub stock for LosTech/heroes. Rare-mech spawns ignore faction — always inspect.
- **LosTech shopping list:** Terra (ComStar), Romulus (Atlas II), Valentina (Wolverine), plus Starmap-flagged rare worlds. If it's between you and a quest target, stop.
- **Multi-mission survival:** bring spares, not repairs. Kestrel/Rasalhague/Dragon assume damage carries over.
- **Difficulty levers:** if stuck, Dragon's Gambit patch added granular options (ammo, repair time/cost, overtonnage penalties) — lowering repair cost beats lowering enemy skill for learning.
- **Saves:** hard save before 3026 (Kestrel branch), before each DLC year, and before every HRQ final (salvage rolls vary — save-scum Steiner shops for Battlemaster/Stalker pairs).
- **Co-op / lance control:** post-Kestrel patch lets you switch to AI lancemates + melee. Use it: park LRM boats, jump yourself behind assaults.

## 8. How to grow this into the interactive tool (next step)

`mechs.json` already has everything needed for filters: `availability <= year`, `ton` band, `hero`, `source` (DLC gate), `speed`, `upgrade_slots`, hardpoint counts per location. Join that with Sarna's Factions mech-market lists (which variants appear for Davion/Kurita/Liao/Marik/Steiner/Independents/ComStar-Terra) and HRQ reward table (§3) to answer "I'm rep 8 in Steiner space with 40M — buy or quest?" without re-reading wikis. That's the natural v2 after this static guide.

*Last verified against Sarna Oct 2026 revision + Kalbintion master `mechs.json`. Clan balance (Tier 6, 3049+) shifts fast — re-check equipment dates past 3050.*
