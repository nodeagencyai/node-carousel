# Node Carousel v0.2 — Design Upgrade Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade node-carousel's visual output from "works" to "premium free tool" by adding grain filters, mesh/radial gradients, a voice-first setup wizard with 5 aesthetic presets, asymmetric title layouts, and configurable slide numbering.

**Architecture:** Extend the existing template-first pipeline. No pipeline rewrites — new capabilities arrive as new `background.type` values, new optional flags on `brand-profile.json`, new template variants, and a smarter setup command that writes a good brand profile without the user having to know design. Backward-compatible: existing v0.1 brand profiles still render correctly.

**Tech Stack:** SVG `<filter feTurbulence>` for grain, pure SVG radial gradient + blurred ellipses for mesh. All logic in `render.mjs` (no new deps). Wizard presets live in `prompts/setup-presets.md`.

**Reference:** `docs/research/2026-04-20-carousel-aesthetics.md` — full taxonomy, specific creators, SVG techniques.

**Constraints:**
- DO NOT touch anything outside `node-carousel/`
- DO NOT break v0.1 brand profiles (backward-compatible schema extensions only)
- Zero new external dependencies — pure SVG/Node stdlib only
- Every new feature testable via render.mjs end-to-end

---

## Phase A: Extend brand-profile schema (backward-compatible)

### Task 1: Update schema doc + default template

**Files:**
- Modify: `templates/brand-profile.default.json`
- Modify: `docs/brand-profile-schema.md`

**Step 1: Add new optional fields to default brand profile**

Extended `visual` object:
```json
{
  "visual": {
    "colors": {
      "background": "#0f0f0f",
      "text": "#FFFFFF",
      "accent": "#29F2FE",
      "accentSecondary": "#0B8AEE",
      "muted": "#999999"
    },
    "fonts": {
      "display": "Playfair Display",
      "body": "Inter"
    },
    "background": {
      "type": "solid",
      "color": "#0f0f0f",
      "gradient": { "from": "#0f0f0f", "to": "#29F2FE", "angle": 135 },
      "mesh": {
        "blobs": [
          { "cx": "20%", "cy": "30%", "r": "45%", "color": "#29F2FE", "opacity": 0.35 },
          { "cx": "80%", "cy": "70%", "r": "55%", "color": "#0B8AEE", "opacity": 0.4 },
          { "cx": "50%", "cy": "50%", "r": "35%", "color": "#6B3FA0", "opacity": 0.25 }
        ]
      },
      "radial": {
        "center": "50% 30%",
        "from": "#29F2FE",
        "to": "#0f0f0f",
        "stops": [0.2, 0.8]
      },
      "imagePath": null,
      "grain": {
        "enabled": false,
        "intensity": 0.12,
        "baseFrequency": 0.9
      }
    },
    "numbering": {
      "style": "fraction-mono",
      "position": "bottom-right"
    },
    "dimensions": { "width": 1080, "height": 1350 }
  }
}
```

Allowed values:
- `background.type`: `"solid"` | `"gradient"` | `"mesh"` | `"radial"` | `"image"`
- `numbering.style`: `"fraction-mono"` | `"dot"` | `"bar"` | `"none"`
- `numbering.position`: `"bottom-right"` | `"bottom-center"` | `"top-right"`

**Step 2: Document every new field** in `docs/brand-profile-schema.md` — types, defaults, acceptable values, visual effect description.

**Step 3: Verify**

```bash
python3 -m json.tool templates/brand-profile.default.json > /dev/null
```

**Step 4: Commit**

```bash
git add templates/brand-profile.default.json docs/brand-profile-schema.md
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.2): extend brand-profile schema with mesh/radial/grain/numbering"
```

---

## Phase B: New background types

### Task 2: Add mesh gradient background snippet

**Files:**
- Create: `templates/_background-mesh.svg`

**Step 1: Write the mesh background**

Technique: 3–5 large blurred `<circle>` elements over a base fill. The `<defs><filter>` applies a heavy blur. Each blob's cx/cy/r/color/opacity come from `brand.background.mesh.blobs`.

Since SVG doesn't natively support dynamic-length arrays in pure template substitution, render up to 5 blobs with placeholders `{{MESH_BLOB_N_*}}` where unused blobs render with `opacity="0"`.

```xml
<defs>
  <filter id="mesh-blur" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="120" />
  </filter>
</defs>
<rect x="0" y="0" width="{{WIDTH}}" height="{{HEIGHT}}" fill="{{BG_COLOR}}"/>
<g filter="url(#mesh-blur)">
  <circle cx="{{MESH_BLOB_1_CX}}" cy="{{MESH_BLOB_1_CY}}" r="{{MESH_BLOB_1_R}}" fill="{{MESH_BLOB_1_COLOR}}" opacity="{{MESH_BLOB_1_OPACITY}}"/>
  <circle cx="{{MESH_BLOB_2_CX}}" cy="{{MESH_BLOB_2_CY}}" r="{{MESH_BLOB_2_R}}" fill="{{MESH_BLOB_2_COLOR}}" opacity="{{MESH_BLOB_2_OPACITY}}"/>
  <circle cx="{{MESH_BLOB_3_CX}}" cy="{{MESH_BLOB_3_CY}}" r="{{MESH_BLOB_3_R}}" fill="{{MESH_BLOB_3_COLOR}}" opacity="{{MESH_BLOB_3_OPACITY}}"/>
  <circle cx="{{MESH_BLOB_4_CX}}" cy="{{MESH_BLOB_4_CY}}" r="{{MESH_BLOB_4_R}}" fill="{{MESH_BLOB_4_COLOR}}" opacity="{{MESH_BLOB_4_OPACITY}}"/>
  <circle cx="{{MESH_BLOB_5_CX}}" cy="{{MESH_BLOB_5_CY}}" r="{{MESH_BLOB_5_R}}" fill="{{MESH_BLOB_5_COLOR}}" opacity="{{MESH_BLOB_5_OPACITY}}"/>
</g>
```

**Step 2: Extend `render.mjs` to select this snippet + populate blob placeholders**

In `render.mjs`:
- Add `"mesh"` to the background snippet selection switch
- Convert `%` strings (e.g. `"20%"`) to pixel values based on WIDTH/HEIGHT for cx/cy, or keep as-is if SVG accepts (SVG `<circle cx="20%">` does work in viewBox coords — verify first)
- For unused blobs (fewer than 5 in config), set placeholders to defaults that render invisibly: `cx="0" cy="0" r="0" fill="#000" opacity="0"`

**Step 3: Test**

Create `test/fixtures/brand-mesh.json` with `background.type: "mesh"` and 3 blobs. Run:
```bash
node scripts/render.mjs test/fixtures/brand-mesh.json test/fixtures/strategy.json /tmp/mesh-test/
open /tmp/mesh-test/slide-01.svg
```
Confirm: smooth blurred blobs, no hard edges, colors blend softly.

**Step 4: Commit**

```bash
git add templates/_background-mesh.svg scripts/render.mjs test/fixtures/brand-mesh.json
git commit -m "feat(v0.2): add mesh gradient background type"
```

---

### Task 3: Add radial gradient background snippet

**Files:**
- Create: `templates/_background-radial.svg`

**Step 1: Write radial background**

```xml
<defs>
  <radialGradient id="bg-radial" cx="{{RADIAL_CX}}" cy="{{RADIAL_CY}}" r="{{RADIAL_R}}">
    <stop offset="{{RADIAL_STOP_FROM}}" stop-color="{{RADIAL_FROM}}"/>
    <stop offset="{{RADIAL_STOP_TO}}" stop-color="{{RADIAL_TO}}"/>
  </radialGradient>
</defs>
<rect x="0" y="0" width="{{WIDTH}}" height="{{HEIGHT}}" fill="url(#bg-radial)"/>
```

**Step 2: Extend render.mjs** — parse `brand.background.radial.center` (e.g. `"50% 30%"`) into cx/cy; default stops to `[0.2, 0.8]` if omitted.

**Step 3: Test** — fixture + render + visual check for Apple-keynote vignette feel.

**Step 4: Commit**

---

### Task 4: Add grain filter (works on ALL background types)

**Files:**
- Modify: ALL 5 background snippets (`_background-solid.svg`, `_background-gradient.svg`, `_background-mesh.svg`, `_background-radial.svg`, `_background-image.svg`)
- Modify: `scripts/render.mjs`

**Step 1: Define the grain filter as a shared snippet**

Create `templates/_grain-filter.svg`:
```xml
<defs>
  <filter id="grain-filter" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="{{GRAIN_BASE_FREQ}}" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 {{GRAIN_INTENSITY}} 0"/>
  </filter>
</defs>
<rect x="0" y="0" width="{{WIDTH}}" height="{{HEIGHT}}" filter="url(#grain-filter)" pointer-events="none"/>
```

**Step 2: In render.mjs**

When `brand.background.grain.enabled === true`:
- Append the grain filter snippet to the background SVG (after the base fill but before template body)
- Populate `GRAIN_BASE_FREQ` (default `0.9`) and `GRAIN_INTENSITY` (default `0.12`)
- If disabled, skip entirely

This needs care: the grain is a SEPARATE layer on top of the existing background snippet. So the background snippet in the final SVG becomes: `[existing-background-snippet] + [grain-filter-snippet]` when grain is on.

**Step 3: Test**

Create `test/fixtures/brand-grain.json` with `background.grain.enabled: true` and existing solid background. Render. Open. Confirm: visible film-grain texture over the background, text still readable.

Also test grain over each other background type (gradient, mesh, radial).

**Step 4: Commit**

```bash
git commit -m "feat(v0.2): add grain filter overlay (works on all background types)"
```

---

## Phase C: Voice-first setup wizard with 5 presets

### Task 5: Define the 5 aesthetic presets

**Files:**
- Create: `prompts/setup-presets.md`
- Create: `templates/presets/editorial-serif.json`
- Create: `templates/presets/neo-grotesk.json`
- Create: `templates/presets/technical-mono.json`
- Create: `templates/presets/display-serif-bold.json`
- Create: `templates/presets/utilitarian-bold.json`

**Step 1: Write `prompts/setup-presets.md`**

Document each preset with:
- Name + 2-sentence description
- Brand voice this fits (e.g. "editorial-serif = for AI/fintech/productivity/creator brands; warm, considered, premium")
- Brand voice this DOESN'T fit
- Font pairing
- Default color palette (4-5 hex codes)
- Default background treatment (type + grain + mesh params if applicable)
- Example reference brands

**Step 2: Write each preset as a complete `brand-profile.json`**

Each preset file is a full valid brand profile the wizard can copy + modify. Name/handle/tone get overridden by user input, but every visual decision defaults from the preset.

Example `templates/presets/editorial-serif.json`:
```json
{
  "brand": { "name": "", "handle": "", "tone": "" },
  "visual": {
    "colors": {
      "background": "#F8F5F0",
      "text": "#1A1A1A",
      "accent": "#C84B31",
      "accentSecondary": "#9B3D27",
      "muted": "#6B6B6B"
    },
    "fonts": {
      "display": "Instrument Serif",
      "body": "Inter"
    },
    "background": {
      "type": "solid",
      "color": "#F8F5F0",
      "grain": { "enabled": true, "intensity": 0.08, "baseFrequency": 0.9 }
    },
    "numbering": { "style": "fraction-mono", "position": "bottom-right" },
    "dimensions": { "width": 1080, "height": 1350 }
  }
}
```

Do the same for the other 4 presets. Reference the research doc for specific parameters.

**Step 3: Commit**

```bash
git add prompts/setup-presets.md templates/presets/
git commit -m "feat(v0.2): add 5 aesthetic presets (voice-first setup)"
```

---

### Task 6: Rewrite `/node-carousel:setup` to use voice-first flow

**Files:**
- Modify: `commands/setup.md`

**Step 1: Restructure the wizard**

NEW wizard flow:

1. **Round 1 — Brand voice (THE cascade question)**
   Ask one question with 5 options:
   > What's the voice of your content? Pick what resonates:
   > - **(A) Editorial serif** — warm, considered, premium. (Vercel, Linear, Lenny Rachitsky, AI-first brands)
   > - **(B) Neo-grotesk** — clean, modern, confident. (Stripe, Framer, Cal.com, SaaS/design)
   > - **(C) Technical mono** — precise, developer-facing, systems. (Vercel v0, Supabase, Replit)
   > - **(D) Display serif bold** — high-contrast editorial. (New York Times, bold media, statement brands)
   > - **(E) Utilitarian bold** — condensed display + stark. (Swiss-minimal, bold agencies)
   >
   > Not sure? (A) is the safest default.

   Load the matching preset as the starting point.

2. **Round 2 — Brand identity (text only, no design)**
   - Brand name
   - Social handle
   - Tone description (one line)

3. **Round 3 — Color override (optional)**
   Show the preset's color palette visually (in text: hex + rough color name). Ask: "Colors look right? Want to swap the accent?"
   - If yes: ask for new accent hex
   - If "use mine": ask for all 4 (bg, text, accent, muted)
   - If no input: use preset defaults

4. **Round 4 — Background style**
   Show preset's default, offer overrides:
   > Background: `<preset default>`. Change?
   > - (A) Keep default
   > - (B) Solid color
   > - (C) Subtle gradient (2-color, diagonal)
   > - (D) Mesh gradient (modern, soft — Stripe/Framer style)
   > - (E) Radial vignette (Apple keynote style)
   > - (F) Upload image (path needed)

5. **Round 5 — Grain**
   > Add film-grain texture? Gives slides an analog/editorial feel, subtracts "AI-generated" look.
   > - (Y) Yes (default for editorial/serif presets)
   > - (N) No (default for technical/utilitarian presets)

6. **Round 6 — Slide numbering**
   > How should slide counters look?
   > - (A) Minimal dot (•)
   > - (B) Fraction in monospace (03/08) — default
   > - (C) Progress bar
   > - (D) None

**Step 2: Write the brand-profile.json with the merged config**

Start from the selected preset, overlay user's brand identity, overlay any color/bg/grain/numbering overrides.

**Step 3: Generate a 2-slide brand preview**

Unchanged from v0.1 — render a title + bullet slide showing the final config.

**Step 4: Commit**

```bash
git add commands/setup.md
git commit -m "feat(v0.2): voice-first setup wizard with 5 aesthetic presets"
```

---

## Phase D: Title template with asymmetric layout option

### Task 7: Add asymmetric title variant

**Files:**
- Create: `templates/title-asymmetric.svg`
- Modify: `prompts/strategy-system.md`
- Modify: `scripts/render.mjs` (minor — ensure it finds `title-asymmetric.svg` when strategy specifies it)

**Step 1: Design asymmetric title template**

Instead of centered headline, the asymmetric version:
- Kicker top-left (small, uppercase, tracking)
- Headline bottom-left or bottom-right, heavy, asymmetric alignment
- Brand handle opposite corner from headline
- Generous empty space on the "other" side of the canvas

```xml
<svg ...>
  {{BACKGROUND}}
  <text x="100" y="180" class="kicker">{{KICKER}}</text>
  <text x="100" y="{{HEADLINE_Y}}" class="headline-asymmetric">
    <tspan x="100" dy="0">{{HEADLINE_LINE_1}}</tspan>
    <tspan x="100" dy="110">{{HEADLINE_LINE_2}}</tspan>
  </text>
  <text x="{{WIDTH_MINUS_100}}" y="{{BOTTOM_Y}}" class="handle" text-anchor="end">{{BRAND_HANDLE}}</text>
</svg>
```

`HEADLINE_Y` default: `height * 0.6` (so headline sits in the lower 40% of canvas — ragged-bottom feel).

**Step 2: Update strategy prompt**

In `prompts/strategy-system.md`, add guidance:
```
Template selection rules:
- Slide 1 → `title` (centered, classic) OR `title-asymmetric` (ragged-left, editorial, premium feel — prefer this when brand voice is "editorial-serif" or "utilitarian-bold")
```

**Step 3: Test + commit**

---

## Phase E: Configurable slide numbering

### Task 8: Extract slide numbering into its own shared snippet

**Files:**
- Create: `templates/_numbering-fraction-mono.svg`
- Create: `templates/_numbering-dot.svg`
- Create: `templates/_numbering-bar.svg`
- Modify: existing templates (`bullet.svg`, `stat.svg`, `quote.svg`) to use `{{NUMBERING}}` placeholder instead of hardcoded counter
- Modify: `scripts/render.mjs` to select and inject the right numbering snippet

**Step 1: Write the 3 numbering snippets**

`_numbering-fraction-mono.svg`:
```xml
<text x="{{WIDTH_MINUS_100}}" y="{{BOTTOM_Y}}" class="counter-mono" text-anchor="end">{{SLIDE_NUMBER_PADDED}} / {{SLIDE_TOTAL_PADDED}}</text>
```

`_numbering-dot.svg`:
```xml
<g transform="translate({{CENTER_X}}, {{BOTTOM_Y}})">
  <!-- Render N dots, active one at slideNumber position is filled, others are outlined -->
  <!-- This needs render.mjs to generate the dots dynamically — see implementation below -->
</g>
```

`_numbering-bar.svg`:
```xml
<rect x="100" y="{{BOTTOM_Y}}" width="{{WIDTH_MINUS_200}}" height="4" fill="{{COLOR_MUTED}}" opacity="0.3"/>
<rect x="100" y="{{BOTTOM_Y}}" width="{{PROGRESS_WIDTH}}" height="4" fill="{{COLOR_ACCENT}}"/>
```

**Step 2: Dynamic dot generation in render.mjs**

For the dot style, render.mjs builds the dots at render time:
```js
function buildDotsNumbering(slideNumber, slideTotal, centerX, bottomY, accent, muted) {
  const spacing = 24;
  const totalWidth = (slideTotal - 1) * spacing;
  const startX = centerX - totalWidth / 2;
  let dots = '';
  for (let i = 1; i <= slideTotal; i++) {
    const cx = startX + (i - 1) * spacing;
    const filled = i === slideNumber;
    dots += `<circle cx="${cx}" cy="${bottomY}" r="4" fill="${filled ? accent : 'none'}" stroke="${muted}" stroke-width="${filled ? 0 : 2}" />`;
  }
  return dots;
}
```

**Step 3: Update existing templates**

Replace hardcoded counter line in `bullet.svg`, `stat.svg`, `quote.svg` with `{{NUMBERING}}`.

The `title.svg` and `cta.svg` templates should NOT show numbering (slide 1 and slide N are anchors, not counted mid-deck).

**Step 4: Test all 4 styles + commit**

---

## Phase F: Regenerate examples

### Task 9: Rebuild the 3 examples with v0.2 aesthetics

Re-run each example through the new pipeline with upgraded brand profiles:

**`examples/5-signs-overengineered/`:**
- Voice preset: **technical-mono** (Vercel v0 feel matches "builder-voice, no fluff")
- Background: `mesh` with cyan/blue blobs on near-black
- Grain: `enabled: true, intensity: 0.1`
- Numbering: `fraction-mono`
- Title: `title-asymmetric` (ragged-left)

**`examples/2-minute-crm-audit/`:**
- Voice preset: **editorial-serif**
- Background: solid cream with grain
- Grain: `enabled: true, intensity: 0.08`
- Numbering: `fraction-mono`
- Keep colors from v0.1

**`examples/why-your-lead-magnet-isnt-converting/`:**
- Voice preset: **display-serif-bold**
- Background: `mesh` with deep purple + magenta + yellow blobs
- Grain: `enabled: true, intensity: 0.12`
- Numbering: `bar` (progress bar for the dramatic feel)

For each:
1. Rewrite `brand-profile.json` with v0.2 fields
2. Re-render all slides
3. Regenerate preview.html
4. Visually verify — open in browser, compare to v0.1 versions
5. Commit: `examples: regenerate <slug> with v0.2 aesthetics`

---

## Phase G: Documentation update

### Task 10: Update README + schema docs + screenshot references

**Files:**
- Modify: `README.md`
- Modify: `docs/brand-profile-schema.md`
- Modify: `docs/adding-templates.md` (add notes on numbering placeholder)

**Step 1: README updates**
- Update the 3 hero images at the top (SVG paths unchanged — the SVGs are regenerated in place)
- Add a "Presets" section showing the 5 voice presets with one-line descriptions
- Update "Configuration" section to document new fields (grain, mesh, radial, numbering)
- Update "What's planned" — move items done in v0.2 to completed, add new v0.3 targets
- Bump version callouts from "v0.1.0" to "v0.2.0"

**Step 2: Schema doc updates** — just add the new fields

**Step 3: Adding-templates doc** — add `{{NUMBERING}}` placeholder to the required placeholders list for mid-deck templates

**Step 4: Commit**

```bash
git add README.md docs/
git commit -m "docs(v0.2): update README + schemas with new aesthetic features"
```

---

## Phase H: Version bump + ship

### Task 11: Bump version to 0.2.0

**Files:**
- Modify: `.claude-plugin/plugin.json`

Change `"version": "0.1.0"` → `"version": "0.2.0"`.

### Task 12: Final smoke test

Re-run Phase 9 from v0.1 plan (end-to-end check):
- All 3 examples render cleanly
- No unfilled placeholders
- All background types work
- Grain toggle works on every type
- Numbering styles all render
- Existing v0.1 brand profiles still work (backward compat)

### Task 13: Tag v0.2.0

```bash
git tag -a v0.2.0 -m "v0.2.0 — Design upgrade: grain, mesh gradients, voice-first wizard, asymmetric titles"
```

Then PAUSE for user decision on whether to push to GitHub.

---

## Success criteria

- [ ] All 5 background types (`solid`, `gradient`, `mesh`, `radial`, `image`) render correctly
- [ ] Grain filter works on every background type
- [ ] 5 aesthetic presets exist and cascade correctly through setup wizard
- [ ] Asymmetric title template renders cleanly and is selected by strategy prompt when appropriate
- [ ] All 4 numbering styles (`fraction-mono`, `dot`, `bar`, `none`) render
- [ ] All 3 examples regenerated with v0.2 aesthetics — each showcasing different preset
- [ ] README reflects v0.2 feature set
- [ ] `.claude-plugin/plugin.json` bumped to `0.2.0`
- [ ] v0.1 brand profiles still render correctly (backward compat)
- [ ] Zero new external dependencies

---

## Backward-compatibility promise

Any v0.1 `brand-profile.json` must still render correctly. Every v0.2 field is optional with sensible defaults:
- Missing `grain`? → `enabled: false`
- Missing `numbering`? → `fraction-mono`, `bottom-right`
- Missing `mesh`/`radial`? → not used unless `type` points to them
- `type: "solid"` or `type: "gradient"` or `type: "image"` → works identically to v0.1

Implementation implication: defensive defaulting in `render.mjs` and `validateBrand()` must pass a v0.1 profile untouched.
