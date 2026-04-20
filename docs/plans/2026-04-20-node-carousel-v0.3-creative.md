# Node Carousel v0.3 — Creative Freedom Within Locked Quality

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the "templated" feel by giving the strategy layer richer compositional vocabulary (variants + decorations + new slide types) while keeping every option pre-designed, tested, and brand-profile-driven.

**Architectural principle:** The AI never generates layouts. It picks from an expanded catalog of pre-designed options. Creative freedom lives in **which pieces are combined**, not in **drawing pixels**.

**Three layers of creative freedom (all shipping in v0.3):**
1. **Decorations (B)** — optional visual elements (corner marks, accent rules, number badges, pull-quote blocks) that attach to any template
2. **Composition variants (A)** — each main template gets 2–3 variants with different layouts but same data schema
3. **Creative slide types (C)** — new templates that break standard structure for variety beats

Plus:
4. **Variety rules** in strategy prompt — prevents 3-in-a-row same compositions, guides decoration use
5. **Visual verification protocol** — every template change requires opened-in-browser confirmation before commit (process fix from the previous overflow bug)

**Constraint:** Ship as v0.3.0 tag. Keep v0.2 scope intact (don't merge v0.3 features into existing v0.2 commits — stack cleanly).

**Reference:** `docs/research/2026-04-20-carousel-aesthetics.md` for aesthetic direction, `docs/plans/2026-04-20-node-carousel-v0.2-design.md` for v0.2 scope already shipped.

---

## Phase I — Decoration system (smallest work, fastest visible uplift)

Goal: Add 5 optional decorative elements that attach to any template. Brand profile sets defaults per preset; strategy.json can override per slide.

### Task I.1 — Extend brand-profile schema

**Files:**
- Modify: `templates/brand-profile.default.json`
- Modify: `docs/brand-profile-schema.md`

Add under `visual`:
```json
"decorations": {
  "cornerMarks": false,
  "accentRule": true,
  "numberBadges": false,
  "pullQuoteBlock": false,
  "oversizedMark": false
}
```

Defaults by preset:
- `editorial-serif`: accentRule, pullQuoteBlock
- `neo-grotesk`: accentRule (only)
- `technical-mono`: cornerMarks, numberBadges
- `display-serif-bold`: oversizedMark, pullQuoteBlock
- `utilitarian-bold`: cornerMarks

Also add strategy-level override support: `{ "template": "bullet", "decorations": ["numberBadges"], "data": {...} }`.

### Task I.2 — Decoration SVG snippets

**Files (create):**
- `templates/decorations/corner-marks.svg` — 4 small `L`-shaped brackets at corners (accent color, stroke-width 3, 40px long each arm)
- `templates/decorations/accent-rule.svg` — short horizontal line (120px × 3px, accent color, positioned below kicker at y=210)
- `templates/decorations/number-badge.svg` — oversized slide number in accent color, positioned as template-specific (for bullet: top-right corner, 180px, accent, muted opacity 0.2)
- `templates/decorations/pull-quote-block.svg` — colored rectangle behind a phrase (tagged via `{{PULL_QUOTE_TEXT}}`, `{{PULL_QUOTE_Y}}`)
- `templates/decorations/oversized-mark.svg` — huge decorative punctuation (`"` or `!` or `?`) as watermark in accent color at low opacity

Each snippet has its own placeholders; render.mjs fills them based on brand/slide context.

### Task I.3 — render.mjs decoration injection

- Compute enabled decorations per slide: brand-profile defaults merged with slide-level overrides
- For each enabled decoration, read snippet, fill placeholders, concatenate
- Inject into each template via new placeholder `{{DECORATIONS}}` (a single slot that holds all active decorations as SVG markup)

Add `{{DECORATIONS}}` placeholder to existing templates (`title`, `title-asymmetric`, `bullet`, `stat`, `quote`, `cta`) — positioned right after `{{BACKGROUND}}` so decorations render ABOVE bg but BELOW text.

### Task I.4 — Verify visually (PROTOCOL)

For each decoration:
1. Create test fixture with that single decoration enabled
2. Render a bullet slide
3. **OPEN IN BROWSER** and screenshot or describe the result
4. Confirm: decoration visible, doesn't overlap text, respects safe zones
5. Only commit after visual confirmation

**Commit:**
```
feat(v0.3): add 5 optional decoration types (corner marks, accent rules, number badges, pull-quote blocks, oversized marks)
```

---

## Phase J — Composition variants per template

Goal: Give Claude 2–3 compositionally-distinct variants per main template, so reusing "bullet" twice in a carousel doesn't look identical.

### Task J.1 — bullet variants

**Current:** `bullet.svg` — left-aligned headline, 5 bullets stacked.

**New variants:**
- `bullet-right.svg` — headline top-right, bullets right-aligned (flipped mirror)
- `bullet-numbered.svg` — oversized accent-colored numbers (01, 02, 03) as bullet markers instead of arrows
- `bullet-card.svg` — top half headline, bottom half is a color block with bullets inside (split visual composition)

Same data schema: `HEADLINE`, `BULLET_1`..`BULLET_5`.

### Task J.2 — stat variants

**Current:** `stat.svg` — huge centered number, label below, context below.

**New variants:**
- `stat-side-label.svg` — number on left, label block on right (horizontal split)
- `stat-oversized-context.svg` — smaller number (180px), oversized context paragraph below (ignores the "context is tiny" current approach)

Same data schema: `STAT_VALUE`, `STAT_LABEL`, `STAT_CONTEXT`.

### Task J.3 — quote variants

**Current:** `quote.svg` — left-aligned with oversized quote mark.

**New variants:**
- `quote-centered.svg` — fully centered, subtle quote mark below text
- `quote-minimal.svg` — just the quote text in accent-colored display font, tiny attribution in corner (no quote marks at all — typography does the work)

Same data schema: `QUOTE_LINE_1`..`4`, `QUOTE_ATTRIBUTION`.

### Task J.4 — cta variants

**Current:** `cta.svg` — hook + button + optional subtext.

**New variants:**
- `cta-minimal.svg` — just the hook and subtext, NO button (for "follow for more" style where action is passive)
- `cta-double.svg` — two CTA buttons side-by-side (e.g. "Follow" + "Save this")

Same data schema + optional `CTA_BUTTON_2` for double variant.

### Task J.5 — Strategy prompt update

**File:** `prompts/strategy-system.md`

Add variant guidance in template selection rules:
```
When using `bullet` twice in one carousel, pick different variants:
- `bullet` (classic left-aligned)
- `bullet-right` (right-aligned mirror — use sparingly, feels editorial)
- `bullet-numbered` (use when sequence/order matters — e.g. "Step 1, Step 2")
- `bullet-card` (use for a "contained" feel — rules/principles)

Same pattern for stat, quote, cta variants. Default to the classic version
unless a specific variant fits the content better.
```

Also add: "Never use the same template variant in 3+ consecutive slides. Alternate."

### Task J.6 — Verify each variant visually

Per variant:
1. Render a slide using that variant
2. Open in browser
3. Confirm composition is distinct from the default, text doesn't overflow
4. Commit only after visual confirmation

**Commits (atomic per template family):**
```
feat(v0.3): add bullet variants (bullet-right, bullet-numbered, bullet-card)
feat(v0.3): add stat variants (stat-side-label, stat-oversized-context)
feat(v0.3): add quote variants (quote-centered, quote-minimal)
feat(v0.3): add cta variants (cta-minimal, cta-double)
feat(v0.3): variant selection rules in strategy prompt
```

---

## Phase K — New creative slide types

Goal: 4 new template types that break the standard structure for variety. Strategy prompt adds them sparingly as "spice" slides.

### Task K.1 — oversized-number.svg

One number fills the whole canvas (400–500px, display font). Tiny caption (24px) bottom-left. Use for dramatic stats like "$10M" or "0".

Data: `HERO_NUMBER`, `CAPTION`.

### Task K.2 — split-screen.svg

Two ideas side-by-side with diagonal or vertical divider. Each side has its own label + content block. Use for "before/after" or "problem/solution" comparisons.

Data: `LABEL_LEFT`, `LABEL_RIGHT`, `CONTENT_LEFT_LINE_1`..`3`, `CONTENT_RIGHT_LINE_1`..`3`.

### Task K.3 — manifesto.svg

Pure typography, zero bullets or structure. One or two sentences in massive serif with a single word in accent color italic. Max 12 words total. Use for core beliefs / values / one-liner truths.

Data: `MANIFESTO_BEFORE_ACCENT`, `ACCENT_WORD`, `MANIFESTO_AFTER_ACCENT`.

Example rendered: "Most AI automation is *expensive* Zapier."

### Task K.4 — before-after.svg

Diagonal split (not vertical). Top-left triangle = "Before" state, bottom-right triangle = "After" state. Each has a label and one-line content. Accent color on the "After" side.

Data: `BEFORE_LABEL`, `BEFORE_LINE`, `AFTER_LABEL`, `AFTER_LINE`.

### Task K.5 — Strategy prompt update (use sparingly)

**File:** `prompts/strategy-system.md`

Add creative slide types section:
```
Creative slide types (use sparingly, max 1–2 per carousel):

- `oversized-number` — when a single number IS the point. The whole slide IS the number.
- `split-screen` — when two ideas demand direct comparison. Before/After, Us/Them, Problem/Solution.
- `manifesto` — when a single sentence is more powerful alone than as a quote or stat.
- `before-after` — transformation slides. Diagonal split creates more tension than vertical.

These are "spice" slides. They break the rhythm and create memorable moments.
Do NOT use more than 2 per carousel. Their power comes from scarcity.
```

### Task K.6 — Verify each creative type visually

Per new type, render a representative example and open in browser. Confirm composition feels genuinely distinct from text-centric templates.

**Commits:**
```
feat(v0.3): add oversized-number creative slide type
feat(v0.3): add split-screen creative slide type
feat(v0.3): add manifesto creative slide type
feat(v0.3): add before-after creative slide type
feat(v0.3): document creative slide types in strategy prompt
```

---

## Phase L — Strategy-level variety rules

Goal: Teach the strategy prompt to produce varied carousels automatically.

### Task L.1 — Variety rules in prompt

**File:** `prompts/strategy-system.md`

Add a "Variety rules" section after "Template selection rules":
```
## Variety rules (non-negotiable)

1. **Never 3 consecutive same-template slides.** If slides 2 and 3 are `bullet`, slide 4 must be a different template.
2. **Alternate variants when reusing a template type.** Slide 2 = `bullet` → slide 4 = `bullet-numbered` or `bullet-right`, not `bullet` again.
3. **Include 1 "spice" slide per carousel ≥6 slides.** Pick one creative type (oversized-number / split-screen / manifesto / before-after) and place it mid-deck (slide 3, 4, or 5) to break rhythm.
4. **Avoid all-asymmetric or all-centered.** Mix centered and asymmetric compositions across the deck.
5. **Decorations: budget 1–2 per slide max.** Two overlapping decorations (corner marks + oversized mark + pull quote) fight each other. Pick the one that makes the slide sing.
```

### Task L.2 — Worked examples showing variety

Add 1 fully worked example to strategy prompt showing a 7-slide carousel using:
- Slide 1: `title-asymmetric`
- Slide 2: `bullet-numbered`
- Slide 3: `stat`
- Slide 4: `manifesto` (the spice slide)
- Slide 5: `bullet-card`
- Slide 6: `quote-minimal`
- Slide 7: `cta`

Demonstrates variety rules in practice.

**Commit:**
```
feat(v0.3): variety rules + worked example in strategy prompt
```

---

## Phase M — Regenerate examples showcasing v0.3

Goal: Each of the 3 examples shows off different v0.3 features.

### Task M.1 — 5-signs-overengineered

- Keep technical-mono + mesh (from v0.2)
- Slide 1: `title-asymmetric` ✓ (already)
- Slide 2: `bullet-numbered` (show off the numbered variant)
- Slide 3: `manifesto` (spice slide — "Most AI automation is *expensive* Zapier.")
- Slide 4: `stat-side-label`
- Slide 5: `bullet-card`
- Slide 6: `quote-minimal`
- Slide 7: `cta`
- Decorations: corner-marks + number-badges

### Task M.2 — 2-minute-crm-audit

- Keep editorial-serif + grain (from v0.2)
- Slide 1: `title-asymmetric`
- Slide 2: `bullet` (classic — fits warm tone)
- Slide 3: `stat-oversized-context` (editorial context emphasis)
- Slide 4: `quote-centered`
- Slide 5: `bullet-right`
- Slide 6: `cta-minimal` (passive CTA fits educational tone)
- Decorations: accent-rule + pull-quote-block

### Task M.3 — why-your-lead-magnet-isnt-converting

- Keep display-serif-bold + mesh (from v0.2)
- Slide 1: `title-asymmetric`
- Slide 2: `bullet-card`
- Slide 3: `before-after` (spice — before vs after magnet changes)
- Slide 4: `manifesto`
- Slide 5: `cta-double`
- Decorations: oversized-mark + pull-quote-block

### Task M.4 — Visual verify each

Open preview.html for each and confirm:
- Variety is visible slide-to-slide
- Decorations feel intentional not cluttered
- No text overflow anywhere
- Carousel has visual rhythm

**Commits:** one per example.

---

## Phase N — Docs + version bump + ship prep

### Task N.1 — Update README

- Update template catalog — add all new variants + creative types
- Update Configuration section — document decorations field
- Update "What's planned" — remove v0.3 items, add v0.4 vision (responsive layouts, community template marketplace)
- Bump version references to 0.3.0

### Task N.2 — Update docs/adding-templates.md

Document how to add variants (file naming, strategy prompt hooks, decoration system integration).

### Task N.3 — Bump plugin.json to 0.3.0

### Task N.4 — Final smoke test

Render all 3 examples fresh. Open each preview.html. Confirm zero regressions from v0.2. Confirm all new features visible and working.

### Task N.5 — Tag v0.3.0

```bash
git tag -a v0.3.0 -m "v0.3.0 — Creative freedom: composition variants, decorations, creative slide types, variety rules"
```

PAUSE for user on GitHub push.

---

## Success criteria

- [ ] 5 decoration types exist, all render cleanly, all controllable per-slide and per-brand
- [ ] 9 new composition variants (3 bullet, 2 stat, 2 quote, 2 cta) all render without overflow
- [ ] 4 new creative slide types (oversized-number, split-screen, manifesto, before-after)
- [ ] Strategy prompt has variety rules + worked example
- [ ] 3 regenerated examples show genuine visual variety within each deck
- [ ] README + schemas updated to reflect v0.3
- [ ] plugin.json bumped to 0.3.0
- [ ] v0.2 brand profiles and existing behavior unchanged (backward compat)
- [ ] Every new template visually verified in browser before commit

## Process rules (from overflow-bug learning)

1. **No subagent commits template/visual work without explicit "opened in browser" verification step.** Grep-for-placeholders is not sufficient validation.
2. **Every new template includes a `test/fixtures/` entry** that exercises it with realistic content (including long text, special chars, edge cases).
3. **Visual check is narrative, not binary** — subagents must describe what they saw in the browser, not just say "it rendered."

## Build order

Ship incrementally. Niek verifies after each phase before moving on:

1. **Phase I** (decorations) — ~1 hr — biggest polish/effort ratio
2. **Phase J** (composition variants) — ~2 hrs — biggest "un-templated" impact
3. **Phase K** (new creative types) — ~1.5 hrs — variety tools
4. **Phase L** (variety rules in prompt) — ~30 min — ties it all together
5. **Phase M** (regenerate examples) — ~1 hr — proves the system works
6. **Phase N** (docs + ship prep) — ~30 min

Total: ~6–7 hours focused work, probably 2–3 sessions.
