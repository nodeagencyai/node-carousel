# Vision Fingerprint Prompt

You are looking at a hero screenshot of a brand's homepage — again. But this
pass is different from `screenshot-analysis.md`.

That prompt produces *abstract* tags: hierarchy, whitespace, composition,
imagery, density, mood. Six enum classifications the synthesizer uses to
route the brand to one of the six presets. Useful, but lossy — "cosmic-dark"
and "editorial-paper" both collapse into `mood: ["bold", "premium"]` plus
`imagery: "abstract"`, and the renderer can't reconstruct the actual visuals
from those labels.

This prompt produces *structured measurements*: specific color stops, overlay
positions, effect parameters, element coordinates. The synthesizer's
scan-first branch (Phase 0.75) and the renderer's SVG compositor consume
these directly — no enum lookup table, no preset remap. If you say the
vortex glow is at `top-center` with `#3A7BE8` at `opacity 0.55`, the
renderer draws that vortex at that position in that color at that opacity.

Both prompts run on every scan. Screenshot-analysis still routes mood to
presets. Vision-fingerprint augments with measurements for brands that need
pixel-close reproduction (scanned backgrounds, flanking 3D renders, film
grain, etc). They are complementary, not redundant.

## Your process

1. Use the `Read` tool to load `<scan-output-dir>/hero.png`. Claude Code's
   `Read` is multimodal — you will actually see the image. If `hero.png` is
   missing or unreadable, fall back to `<scan-output-dir>/full.png`. If both
   are missing, write a low-confidence fingerprint (see Anti-invention rule
   below) and stop.
2. Also read `<scan-output-dir>/scan.json` and pull `colors.sampled` for
   context — the pixel-sampled palette is your source of truth for specific
   hex values. Don't re-invent colors; prefer those the CSS scan already
   extracted when they match what you see.
3. Extract the four categories below. Be precise where you can see precisely;
   emit `null` or `"uncertain"` where you can't.
4. Write `<scan-output-dir>/vision-fingerprint.json`.

## What to extract

### 1. Background composition

Classify the background `type` into exactly one of:

- `flat` — single solid color, no gradient, no overlays
- `linear-gradient` — visible directional color transition, straight angle
- `radial-gradient` — color radiates from a point (often center or top)
- `mesh-blobs` — 2+ soft blurred color blobs (Stripe-style), no starfield
- `textured` — grain / noise / paper texture dominates (Lenny's-style)
- `photographic` — real photograph or render fills the background
- `cosmic-dark` — dark base + starfield + vortex/nebula (TPS / Linear-style)

Then record the measurements that recreate it:

- `base` — the dominant background hex. For gradients, this is the darkest
  stop or the base before overlays sit on top.
- `gradient` — `{ from, to, angle, stops? }` for linear/radial, else `null`.
  Angle is 0-360 degrees (0 = bottom-to-top, 90 = left-to-right).
- `overlays` — array of structured overlay objects (see schema below).
  Empty array if `type: "flat"`.

### 2. Focal element positioning

For each distinct focal element, record its role and coordinates:

- `role` — one of `headline`, `cta`, `decorative-3d`, `decorative-illustration`,
  `decorative-photo`
- `x`, `y` — position as percentage 0-100 of hero dimensions (0,0 = top-left,
  100,100 = bottom-right). Estimate the element's visual center.
- `size` — one of `small`, `medium`, `large` (rough visual weight)
- `widthPct` — element width as % of hero width, or `null` if ambiguous
- `description` — 1 sentence on what it is, or `null` if trivial

Only log elements that matter to reproduction. A nav bar isn't a focal
element; a flanking 3D render is.

### 3. Effect parameters

- `glow.present` — is any element clearly glowing / radiating color?
- `glow.color` — hex of the glow, pulled from the glow halo not the source
- `glow.radius` — rough blur radius in pixels (20 = tight, 80 = flanking-blob
  scale, 160 = whole-vortex scale)
- `glow.position` — where on the hero the glow centers (`top-center`,
  `flanking`, `bottom-left`, etc)

- `blur.present` — any element deliberately blurred?
- `blur.elements` — 1 sentence on which elements are blurred

- `grain.present` — film grain / paper noise / ink texture present?
- `grain.textureType` — `film` | `digital` | `paper` | `ink`
- `grain.intensity` — 0 to 0.25. Subtle paper grain ~ 0.05-0.08; heavy film
  grain ~ 0.15-0.20. Above 0.25 is rare and usually reads as noise, not
  texture — cap at 0.25.

### 4. Color atmosphere

Three 1-word classifications:

- `temperature` — `warm` (orange/red/yellow-leaning), `neutral` (greys, off-blacks),
  `cool` (blue/teal-leaning), `icy` (cyan + white + near-zero saturation)
- `contrast` — `high` (bright on dark or dark on bright, crisp separation),
  `medium` (default), `low` (hazy, low separation, dust-tone-on-cream)
- `vibrancy` — `muted` (desaturated), `balanced` (default), `saturated`
  (rich but natural), `electric` (neon / oversaturated / high-gamut)

## Output schema

Write valid JSON to `<scan-output-dir>/vision-fingerprint.json`:

```json
{
  "background": {
    "type": "cosmic-dark | flat | linear-gradient | radial-gradient | mesh-blobs | textured | photographic",
    "base": "#HEX",
    "gradient": {
      "from": "#HEX",
      "to": "#HEX",
      "angle": 0,
      "stops": [[0, "#HEX"], [100, "#HEX"]]
    },
    "overlays": [
      { "type": "starfield", "density": "low | medium | high", "opacity": 0 },
      { "type": "vortex", "position": "top-center | center | left | right | flanking", "color": "#HEX", "opacity": 0, "blur": 0 },
      { "type": "blob", "cx": "50%", "cy": "50%", "r": "30%", "color": "#HEX", "opacity": 0 },
      { "type": "grain", "textureType": "film | digital | paper | ink", "intensity": 0 }
    ]
  },
  "focalElements": [
    {
      "role": "headline | cta | decorative-3d | decorative-illustration | decorative-photo",
      "x": 50,
      "y": 50,
      "size": "small | medium | large",
      "widthPct": 60,
      "description": "..."
    }
  ],
  "effects": {
    "glow": { "present": false, "color": null, "radius": null, "position": null },
    "blur": { "present": false, "elements": null },
    "grain": { "present": false, "textureType": null, "intensity": null }
  },
  "atmosphere": {
    "temperature": "warm | neutral | cool | icy",
    "contrast": "high | medium | low",
    "vibrancy": "muted | balanced | saturated | electric"
  },
  "confidence": 0.85,
  "observations": "2-3 sentence summary of what you saw — nuance the schema can't hold."
}
```

Omit the `gradient` block (set to `null`) when `type` is `flat`, `textured`,
`mesh-blobs`, `photographic`, or `cosmic-dark`. Include it only when there's
a genuine continuous color transition.

`overlays` is an array of mixed shapes — the renderer pattern-matches on
`type` per element. A `cosmic-dark` hero typically has 3-4 overlays
(starfield + vortex + 1-2 blobs); a `textured` hero typically has 1 (grain);
a `flat` hero has 0.

## Calibration examples

### Example 1 — TPS cosmic-dark hero

Dark near-black base. Subtle starfield scattered across upper two-thirds.
A large soft blue vortex/nebula glow centered at top, bleeding down. Two
chunky 3D-rendered blue shapes flanking the center — one at ~15% from
left, one at ~85% from left, each ~18% of hero width. Centered headline
in large display sans, white. Small white-on-blue rounded CTA button
below.

```json
{
  "background": {
    "type": "cosmic-dark",
    "base": "#070708",
    "gradient": null,
    "overlays": [
      { "type": "starfield", "density": "low", "opacity": 0.35 },
      { "type": "vortex", "position": "top-center", "color": "#3A7BE8", "opacity": 0.55, "blur": 160 },
      { "type": "blob", "cx": "15%", "cy": "50%", "r": "22%", "color": "#3A7BE8", "opacity": 0.4 },
      { "type": "blob", "cx": "85%", "cy": "50%", "r": "22%", "color": "#3A7BE8", "opacity": 0.4 }
    ]
  },
  "focalElements": [
    { "role": "headline", "x": 50, "y": 42, "size": "large", "widthPct": 60, "description": "Centered display-sans headline in white" },
    { "role": "cta", "x": 50, "y": 62, "size": "small", "widthPct": 12, "description": "Pill-shaped CTA button, white text on blue" },
    { "role": "decorative-3d", "x": 15, "y": 55, "size": "large", "widthPct": 18, "description": "Chunky 3D-rendered blue shape, left flank" },
    { "role": "decorative-3d", "x": 85, "y": 55, "size": "large", "widthPct": 18, "description": "Chunky 3D-rendered blue shape, right flank" }
  ],
  "effects": {
    "glow": { "present": true, "color": "#3A7BE8", "radius": 80, "position": "flanking" },
    "blur": { "present": false, "elements": null },
    "grain": { "present": false, "textureType": null, "intensity": null }
  },
  "atmosphere": {
    "temperature": "cool",
    "contrast": "high",
    "vibrancy": "electric"
  },
  "confidence": 0.85,
  "observations": "Cosmic-dark aesthetic — deep near-black base with a cool blue vortex bleeding from top-center and two symmetric 3D renders flanking the headline. High-contrast electric-cool atmosphere. Starfield is subtle, density low. Blue glow is the signature signal — it carries the vortex plus both flanking blobs."
}
```

### Example 2 — Lenny's Newsletter-style paper editorial

Warm cream background, very subtle paper grain. One centered serif headline,
medium-large, dark ink color. No imagery in hero, no blobs, no glow. A
small muted CTA link below the headline.

```json
{
  "background": {
    "type": "textured",
    "base": "#F4EDE0",
    "gradient": null,
    "overlays": [
      { "type": "grain", "textureType": "paper", "intensity": 0.08 }
    ]
  },
  "focalElements": [
    { "role": "headline", "x": 50, "y": 48, "size": "large", "widthPct": 70, "description": "Centered serif display headline in dark ink" },
    { "role": "cta", "x": 50, "y": 65, "size": "small", "widthPct": 15, "description": "Small muted CTA link, no button chrome" }
  ],
  "effects": {
    "glow": { "present": false, "color": null, "radius": null, "position": null },
    "blur": { "present": false, "elements": null },
    "grain": { "present": true, "textureType": "paper", "intensity": 0.08 }
  },
  "atmosphere": {
    "temperature": "warm",
    "contrast": "medium",
    "vibrancy": "muted"
  },
  "confidence": 0.9,
  "observations": "Editorial-paper aesthetic — cream base with subtle paper grain, serif headline carries the whole hero, no decorative elements. Warm, muted, quiet. The grain is the only overlay and it's deliberately subtle (~0.08)."
}
```

## Calibration guidance per dimension

**cosmic-dark vs mesh-blobs** — both have soft color patches on a background,
but cosmic has discrete point-light stars + a large vortex bleeding from
one edge, while mesh has 3-4 blurred blobs at roughly equal weight with no
points. If you see stars, it's cosmic. If the color patches feel evenly
distributed with no single dominant glow, it's mesh.

**linear-gradient vs radial-gradient** — linear has a clear *direction*;
radial has a clear *center*. If color transitions on a diagonal or vertical
axis with parallel bands, linear. If color emanates outward from a point
(often brighter at center, darkening at edges), radial.

**textured vs flat** — textured has visible grain, noise, or paper fiber at
close inspection. Flat is genuinely uniform color. When in doubt, check the
near-corner regions — grain shows there first.

**glow radius** — use the halo, not the source. A tight button glow is
~20px. A flanking decorative blob is ~80px. A whole-hero vortex bleed is
~160px. These are rough reference points, not fencepost thresholds.

**grain intensity** — 0.05-0.08 is subtle paper (Lenny's-style, you almost
don't notice). 0.10-0.15 is visible but not noisy. 0.15-0.20 is heavy film
grain. 0.25 is the ceiling — above that it reads as noise, not texture.

**temperature: cool vs icy** — cool is blue-teal-leaning with normal
saturation. Icy is cyan + white with very low saturation, like a frost or
glacier aesthetic. If the blues feel warm-blue (electric, vivid), it's cool;
if they feel pale and desaturated, it's icy.

**contrast** — measure visually: if foreground elements pop off the
background with no effort to read, `high`. If they read clearly but don't
pop, `medium`. If the palette feels hazy / low-separation (dust-tone on
cream, light grey on white), `low`.

## Anti-invention rule

Any field you can't measure with confidence → emit `null` (where the schema
allows it) or `"uncertain"` (where it doesn't), and note the ambiguity in
`observations`.

Specifically:

- If you can't tell linear from radial → `background.type: "flat"` or
  `"textured"` whichever is closer, and note "gradient direction unclear"
  in observations.
- If a focal element is ambiguous (might be headline, might be decorative
  text) → pick the more conservative role and drop confidence.
- If the overlay count is unclear → err fewer, not more. A missed overlay
  is recoverable; a fabricated overlay renders as a visual bug.
- If both `hero.png` and `full.png` are missing → write the whole
  fingerprint with `confidence: 0.1`, every enum `"uncertain"` where
  allowed, `background.type: "flat"`, empty `overlays`, empty `focalElements`,
  and explain in `observations`.

`confidence` is your honest summary of how close your fingerprint is to
the actual pixels. Calibrate:

- 0.85-0.95: you could describe the hero in detail and a renderer would
  reproduce it recognizably.
- 0.65-0.80: the broad strokes are right but one or two details are
  uncertain.
- 0.40-0.60: you classified the background type but specifics are guesses.
- 0.10-0.30: something went wrong (image missing, image unreadable,
  content behind a login wall). The synthesizer treats this tier as
  "fall back to preset".

## Do NOT

- Infer from the URL, brand name, or industry. You only know what's in
  `hero.png` and `colors.sampled`.
- Re-detect fonts — that's the CSS scan's job. Focal element descriptions
  say "display serif" not "Instrument Serif".
- Invent overlays to look thorough. An empty `overlays` array is correct
  when the hero is flat.
- Fabricate gradient stops. If you can't see a gradient, `gradient: null`.
- Write anything other than `vision-fingerprint.json` to the scan directory.
- Skip the `observations` field — that's where nuance the schema flattens
  out gets captured.
- Confidently emit precise measurements when you aren't confident. Low
  confidence + null fields beats high confidence + wrong numbers — the
  synthesizer falls back gracefully, the renderer doesn't.
