# Starmap video review — video-to-map pipeline (runbook)

Validates the advisor star map against an in-game pan recording and fixes
immersion gaps. Established 2026-11-23 from the 3026-10-20 Avigait pan
(`Screen Recording 2026-11-23 at 11.44.39 AM.mov`, 2546x934, 43.35s,
261 frames at 6fps, detail zoom 14.64 px/ly, world-screen RMS <= 0.5px).
Scripts live in `skills/mw5-advisor/scripts/starmap-review/` (see its
`README.md`); the rival extractor is committed in the app repo as
`scripts/extract-rivals.py`.

## 0. Setup

- Fresh save in the web bridge (gitignored `static/dev-snapshot.json`):
  pull the save the video was recorded on so positions/date match.
- Durable WORKDIR, e.g. `~/mw5-map-review/<date>/` with `frames/`.
  The archived scripts hardcode the Nov-23 tmp workdir — copy them to
  WORKDIR and find-replace the
  `/private/var/.../T/opencode` prefix (Python) / path constants (Swift).
- App repo checkout at `~/Projects/mw5-advisor` (scripts assume CWD there
  for `static/data/starmap.json`). Needs: Xcode Swift toolchain, Python 3
  + PIL, `repak` at `~/.cargo/bin/repak`, game pak present.

## 1. Extract frames

`extract_6fps.swift`: set the video path, out dir, and duration bound;
`swift extract_6fps.swift`. Expect ~6fps x duration frames
(`f_%03d_t%05.2f.png`). 6fps is plenty — the camera moves slowly and
poses interpolate.

## 2. Solve per-frame camera poses

`track_all_261.swift` from the repo root:
`swift <review>/track_all_261.swift`. Blob-detects star discs, matches
against `static/data/starmap.json` systems, refines
`screen = (scale * wx + tx, -scale * wy + ty)` iteratively (5 passes,
9.0 -> 5.5px thresholds), tracks frame-to-frame with zoom-around-center
(scale 1273,467) candidates. Writes `poses_6fps.json`.

QC: detail frames should read `scale ~= 14.64 px/ly`, `rms <= 0.5`,
`matches >= 10`. Regional frames read `~5.69`. Reject/suspect anything
with `rms > 1.0`. Spot-check: project a named system (e.g. Maladar) into
2-3 frames and eyeball the dot.

## 3. Stitch detail maps

`stitch_maps.swift`: set world bounds + `outScale` (use the native
detail scale, 14.64, for 1:1 dash pixels), tune `isCleanPixel` to the
video's HUD chrome (top nav bar, edge waypoint tracks, right-side boxes —
values in the archive fit 2546x934). Renders the mosaic PNG(s).
Larger zoomed crops of regions of interest come from the same renderer
with tighter bounds.

## 4. Extract rival circles (pak, exact)

App repo: `python3 scripts/extract-rivals.py --pak "<pak>" --repak
~/.cargo/bin/repak` -> `static/data/rival-circles.json` (76 assets:
Radius, member systems+weights, full OwnerTimeline with parsed owners).
No save data involved — radials are pak + game-date facts.

## 5. Calibrate center + scale (the core proof)

Dash-pixel test everywhere:
`pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80`
(bright saturated dash blue; validated by `validate_dash_color.py`).

1. `sample_ray.py` on one obvious circle — expect a hard dash hit at the
   predicted radius (Maladar: 195px = 13.32ly on the east ray).
2. `calibrate_strict.py` — full sweep (mean vs weighted centers, top-3
   frames each, best radius by 180-angle dash count). Bar: 9+ circles
   agreeing on one factor (here: **12.3 ly per asset unit**).
3. `center_search.py` — fixed-factor center grid around the mean. Bar:
   the exact mean wins big (Maladar 73 vs <= 6 one ly off; Mandate 76).
   Weights do NOT move the center (weights-only centers score ~0).
4. `masked_fit.py` for overlaps — restrict samples to world halves only
   one circle can reach (Abadan/Ibstock). If both still claim the shared
   dashes, catalog it as a residual gap, not a model failure.

## 6. Kill or confirm the legacy zone rings

`zone_ring_test.py`: score dash hits on the member-cover+14 ring AND a
proven radial control in the same frame. Bar seen here: rings 0% (L_3_6
r70, D_13_14 r52) vs control ~42%. A 0-hit ring is a false model —
reattribute its systems to nearby radials (Capolla -> Liao12to13 at
5.3ly inside r14.2; Ronel -> Liao13to14) and suppress it in the app.

## 7. Visual overlays

`draw_overlay.py` (stitched map + predicted circles, red = mean,
cyan = weighted) and the `zoom_*` / `check_*` crop scripts (2x
nearest-neighbor keeps dash pixels crisp). Eyeball: predicted circle
through the dashes, label readable, no double-draw where suppressed.

## 8. Compare app vs video (checklist)

Positions (save systems land on video dots via poses), visuals (faction
region tint/gas, conflict-zone dark centers + pinstripe vs diagonal
rival hatch, dot scale), data (zone membership, conflict zones, rival
regions/owners on the game date). Record every delta in the visual
catalog (`tests/fixtures/starmap-visual/catalog.json`); residual gaps
from this round: shared Abadan/Ibstock dashes, one excess Ronel-area
arc, Talitha/Van Diemen trigger (needs an in-game hover naming a zone).

## 9. Land app fixes (per AGENTS.md: phase first, then commit)

Model (confirmed): radial circle = mean(member coords),
r = Radius x 12.3, drawn only when `rivalOwnerAt(circle, saveDay)` is
not "No owner" (regional/local tiers, owner name above the ring);
suppress the legacy zone ring where an active radial shares a member
system. No save-parser changes (radials are pak+date). Crest icons stay
deferred to the crest-plates task.

Then: `pnpm check`, new unit pins (`tests/starmap.spec.ts`), full
`starmap-visual` re-baseline (`--update-snapshots`, re-run clean;
`--workers=1`; isolated re-run before treating a failure as real —
the suite is load-flaky), catalog + `docs/plans/open-commits.md`
updates, one Conventional Commits group per feature (feat, then chore
re-baseline), push.
