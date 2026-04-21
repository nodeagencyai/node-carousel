# Screenshot Analysis Prompt

You are looking at a hero screenshot of a brand's homepage. A CSS scan has
already extracted fonts, colors, and meta — your job is to catch the visual
signals CSS can't see. Composition, whitespace, hierarchy, and mood aren't in
the stylesheet; they're in the pixels.

The `/node-carousel:scan` command invokes you after `scripts/scan-site.mjs`
has dropped `hero.png` (above-the-fold, 1440px wide) and `full.png` (full
page) into the scan directory. You analyze `hero.png` and write
`vision-analysis.json` alongside it.

## Your process

1. Use the `Read` tool to load `<scan-output-dir>/hero.png`. Claude Code's
   `Read` is multimodal — you will actually see the image. If `hero.png` is
   missing or unreadable, fall back to `<scan-output-dir>/full.png`.
2. Look carefully. Spend attention — this is the only visual pass.
3. Only describe what's in the pixels. Do NOT infer from the URL, the brand
   name, or what you know about the company. You are not the CSS scan; don't
   re-detect fonts or hex codes.
4. For each of the six signals below, note what you see and one sentence of
   why. Then write `<scan-output-dir>/vision-analysis.json`.

## Six signals (and why they matter)

1. **Visual hierarchy** — where does the eye go first, second, third? The
   synthesizer uses this to pick which pattern leads (cover-asymmetric vs.
   cover-centered, stat-dominant vs. quote-pulled).
2. **Whitespace strategy** — how much empty space surrounds primary elements?
   This maps to preset density and slide padding.
3. **Composition** — is the layout centered, asymmetric, grid, or split? This
   maps directly to `composition.dominantPatterns` in the profile.
4. **Imagery style** — photography, illustration, 3D, abstract shapes,
   type-only, or mixed? This informs background.type and decoration choices.
5. **Visual density** — sparse, moderate, dense, or maximalist? Separate from
   whitespace — this is about how much *stuff* is on the page, not how much
   air around it.
6. **Mood signals** — what does it FEEL like? Feel is not look. A
   tight-serif editorial and a loud-neon tech brand can both be "premium"
   but the mood words diverge.

## Calibration

Use these rough thresholds to stay consistent. "Uncertain" is a valid answer
for any enum when the signal is genuinely ambiguous — say so and explain.

- **whitespace**
  - `tight` — <20% of the viewport is empty (content-dense, edge-to-edge)
  - `balanced` — 20-45% empty (typical marketing site)
  - `airy` — 45-65% empty (confident brands with room to breathe)
  - `editorial-spacious` — >65% empty (one massive headline, nothing else)

- **composition**
  - `centered` — hero elements align to a vertical centerline
  - `asymmetric-left` / `asymmetric-right` — hero headline or key element
    weighted clearly to one side
  - `grid` — visible 2+ column structure in the hero
  - `split` — two side-by-side regions (often text / image or text / product)

- **density**
  - `sparse` — 1-3 primary elements visible (headline + CTA, maybe a mark)
  - `moderate` — 4-7 elements (headline, sub, CTA, nav, one visual)
  - `dense` — 8-15 elements (content-rich landing, feature previews)
  - `maximalist` — 15+ (editorial site, homepage-as-magazine)

- **mood** — pick 1-3 from:
  `editorial`, `tech`, `playful`, `clinical`, `bold`, `warm`, `cold`,
  `premium`, `scrappy`. Multiple allowed when they genuinely coexist (e.g.
  `bold` + `premium`). Don't pick all of them — that's noise.

- **imagery.style**
  - `photography` — real photos dominate
  - `illustration` — hand-drawn / vector illustration
  - `3d` — rendered 3D objects, ray-traced, Blender-y
  - `abstract` — gradient blobs, geometric shapes, meshes, non-representational
  - `type-only` — pure typography, no imagery in the hero
  - `mixed` — two or more of the above in the hero

## Output contract

Write valid JSON to `<scan-output-dir>/vision-analysis.json`. Fields:

- `screenshot` — filename you actually analyzed (`"hero.png"` or `"full.png"`).
- `hierarchy` — object with `primary`, `secondary`, `tertiary` strings.
  Describe what each is (type, position, size), not WHY. If only 1-2
  elements exist, set the unused slot to `null` (not `"uncertain"`).
- `whitespace` — one of `tight` | `balanced` | `airy` | `editorial-spacious`
  | `uncertain`.
- `composition` — one of `centered` | `asymmetric-left` | `asymmetric-right`
  | `grid` | `split` | `uncertain`.
- `imagery` — object:
  - `style` — one of `photography` | `illustration` | `3d` | `abstract`
    | `type-only` | `mixed` | `uncertain`.
  - `notes` — 1 sentence on what you saw.
- `density` — one of `sparse` | `moderate` | `dense` | `maximalist`
  | `uncertain`.
- `mood` — array of 1-3 strings from the mood list above. Empty array if
  truly ambiguous.
- `observations` — 2-3 sentence free-form summary. This is where nuance the
  enums can't capture goes.

Example shape:

```json
{
  "screenshot": "hero.png",
  "hierarchy": {
    "primary": "massive serif headline, centered, fills ~60% of width",
    "secondary": "single-line subheadline in muted grey below",
    "tertiary": "small terracotta CTA button bottom-right"
  },
  "whitespace": "airy",
  "composition": "centered",
  "imagery": {
    "style": "type-only",
    "notes": "No photography or illustration in the hero — headline carries the whole viewport."
  },
  "density": "sparse",
  "mood": ["editorial", "premium"],
  "observations": "Confident editorial brand. Hero is one headline and nothing else — the whitespace IS the design. CTA is deliberately understated."
}
```

## Do NOT

- Invent details from the URL, brand name, or industry. You only know what's
  in the pixels.
- Re-detect fonts or hex colors — that's the CSS scan's job. If the
  screenshot shows the brand uses Instrument Serif, don't say "Instrument
  Serif" — say "large serif display". Let the CSS scan name it.
- Write anything other than `vision-analysis.json` to the scan directory.
- Pick every mood word. 1-3 is the contract; more = noise.
- Skip the `observations` field — that's where the synthesizer picks up
  nuance the enums flatten out.
- Guess when uncertain. `"uncertain"` is a valid value for every enum field
  and is more useful than a confident wrong answer.
