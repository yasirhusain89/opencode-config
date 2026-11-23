# Starmap video-review scripts (archived 2026-11-23)

Verbatim working copies from the 3026-10-20 pan-video calibration that
produced the radial rival-circle model (`Radius x 12.3 ly`, mean-center,
OwnerTimeline gating). See `docs/starmap-video-review.md` for the full
runbook — this README is the per-script map.

All scripts hardcode the Nov-23 workdir
`/private/var/folders/4g/6g1qk_3j4_30czm9c_r3wrlc0000gn/T/opencode/`
(which is ephemeral). For a new review, copy this directory to a durable
WORKDIR and find-replace that prefix (Python) / edit the path constants
at the top of each Swift file. Python scripts also assume CWD = the
`mw5-advisor` repo root (they open `static/data/starmap.json` relatively).

## Pipeline (Swift, macOS only — AppKit/AVFoundation)

- `extract_6fps.swift` — AVFoundation frame extraction at 6fps.
  Edit: video path (top), out dir, duration bound (`t <= 43.35`).
  Run: `swift extract_6fps.swift`. Produces `f_%03d_t%05.2f.png`.
- `track_all_261.swift` — star-disc blob detection + per-frame camera solve
  (scale/tx/ty via iterative closest-match + least-squares refine, tracked
  frame-to-frame with zoom-around-center candidates).
  Run from the repo root: `swift <path>/track_all_261.swift`.
  Reads `static/data/starmap.json` + frames dir, writes `poses_6fps.json`
  (`idx,file,scale,tx,ty,matches,rms,worldCenterX,worldCenterY`).
  QC bar: detail frames `scale ~= 14.64`, `rms <= 0.5`, positions exact.
- `stitch_maps.swift` — mosaic renderer. Selects well-locked frames
  (`rms < 1.0`, `matches >= 10`, spaced >= 4 ly or 2% scale), masks HUD
  chrome via `isCleanPixel` (tune the constants per video resolution —
  written for 2546x934), renders world-rect PNGs at a chosen px/ly.
  Produces the native-scale south/north detail maps.

## Calibration + comparison (Python 3 + PIL)

Dash-pixel test (bright saturated dash blue — shared by all scripts):
`pb > 150 and pr < 110 and pg < 115 and (pb - pr) > 80`.

- `sample_ray.py` — east-ray RGB profile from a circle center; the first
  clean radial hit (used on BorderLIAOBaseDavion3to6).
- `validate_dash_color.py` — validates the dash test on known-good circles.
- `calibrate_strict.py` — full calibration: every active radial, mean and
  weighted centers x top-3 detail frames, best radius by 180-angle dash
  count. The 9+ circle consensus behind the 12.3 factor.
- `center_search.py` — fixed-factor center grid: proves the mean beats any
  offset (Maladar 73 hits vs <= 6 one ly away).
- `masked_fit.py` — disjoint-membership fits for overlapping circles
  (Abadan vs Ibstock): restrict samples to world regions only one circle
  can reach.
- `zone_ring_test.py` — legacy zone-ring killer: scores dash hits on a
  member-cover+14 ring plus a proven-radial control in the same frame
  (expect 0% vs ~40%+).
- `draw_overlay.py` — draws predicted circles over the stitched south map
  (red = mean, cyan = weighted) + a 2x crop helper.
- `zoom_crop.py`, `zoom_abadan.py`, `check_ronel_ov.py`,
  `check_zone_ring.py` — crop-a-region + overlay-predictions visual checks
  (nearest-neighbor 2x upscale keeps dash pixels crisp).
- `dump_centers.py`, `who_is_marik_arc.py` — attribution helpers: dump
  asset members/weights/positions; find which assets touch a world rect.
- `poses_6fps.json` — the 261 solved poses for the 2026-11-23 video
  (reference for the pose schema; regenerate per video, never reuse).

Superseded (deliberately NOT archived — see the repo instead):
pak/save exploration and the legacy radial decoder live on as the
committed `scripts/extract-rivals.py` in `~/Projects/mw5-advisor`
(mean-center + Radius x 12.3 + OwnerTimeline -> `static/data/rival-circles.json`).
