# Generative Design Systems — April 2026

How top design systems manage the tension between variety and consistency at scale, and what node-carousel v0.4 should steal.

## Executive summary

Every system that produces "unique but recognizably on-brand" output at volume converges on the same mechanism: **tokens define the invariants, a compositional grammar defines the skeleton, and bounded stochastic selection drives the variety.** The designer's job shifts from drawing outputs to authoring rules — choosing which parameters are locked (type scale, palette, radius, grid, motion curves), which are enumerated (variant properties like "size" or "emphasis"), and which are sampled at runtime from a deterministic seed. Figma's variant/slot/auto-layout trio, Airbnb's "small set of robust components used many ways", Stripe's rigid gradient/typography/angle rules, MIT Media Lab's 7×7 grid producing 40,000 permutations, and DIA's motion-first parametric tools all apply the same idea at different scales. Our current 5-preset × N-template approach collides outputs into visual clusters because we sample at the wrong layer — we swap *finished compositions* instead of sampling independent axes of a larger design space.

## Core principles

1. **Tokens are invariants, not choices.**
   A brand's identity lives in its tokens (color, type scale, radius scale, spacing, motion). Tokens must be few, semantic, and non-negotiable at generation time. Why it matters: this is what makes 40,000 unique MIT Media Lab logos still read as one brand — same grid, same geometry.

2. **Separate primitive tokens from semantic tokens.**
   Primitives are raw values (`blue.500`, `space.8`). Semantics express intent (`surface.elevated`, `text.muted`, `accent.primary`). Generation touches semantic tokens; the system maps them to primitives. Why it matters: lets us re-skin per user without every template needing its own palette math.

3. **Variant properties enumerate variation; they don't free it.**
   Figma's model: each component exposes a small, named set of properties (size, emphasis, tone) with explicit values. A generator picks from the Cartesian product, but the product is bounded. Why it matters: we get 3 × 4 × 2 = 24 permutations from a single template without bespoke work.

4. **Slots hold unknown content; frames hold known rules.**
   Slots are named placeholders for injected content. Auto-layout frames define how content behaves (padding, gap, alignment, direction). Why it matters: we can vary what's in a slide without varying how it lays out — so two different bodies of copy still look balanced.

5. **Compositional grammar > finished templates.**
   The MIT Media Lab identity isn't 40,000 logos stored on disk — it's a 7×7 grid plus rules for which cells can be filled. Why it matters: we should be generating slide compositions from a grammar, not selecting from a fixed list of templates.

6. **Determinism via seeded randomness.**
   Hash the user's brand-profile + topic into a seed; every random choice downstream uses it. Two users get different outputs; the same user regenerating gets the same output. Why it matters: reproducibility for debugging and regeneration while still producing variety.

7. **Scale-aware parameters.**
   DIA explicitly defines different particle counts, motion complexity, and density thresholds per output size. Why it matters: the same rule set should produce different visual densities for cover slides vs. body slides, or high-contrast vs. quiet slides.

8. **Motion/transition as a first-class axis.**
   DIA's rule: start in motion, work back to static. Even for static carousels, the underlying "kinetic intent" (how elements would enter) informs composition. Why it matters: gives us a coherent story across slides, not just 8 isolated frames.

## Techniques catalog

### 1. Design tokens
**What it does.** Stores atomic design decisions (color, spacing, radius, type scale, motion curves, opacity levels) as named variables in a central registry. W3C's Design Tokens Format Module (stable release 2025.10) is now the interoperability standard.
**Who uses it.** Every serious system — Material 3, Airbnb DLS, Polaris, Stripe. Tokens replace literal values throughout the codebase.
**Enforcement.** Lint rules reject literal hex/px values. Generator never writes raw numbers — it reads from the token registry.
**How we'd apply it.** Replace every hard-coded color/size/radius in our SVG templates with token references resolved at render time. Our `brand-profile.json` becomes the primitive token set; a new `semantic-tokens.json` layer maps intent → primitive. Type scale: pick one ratio (1.25 major third or 1.333 perfect fourth) and derive all sizes from it.
**Sources:** [W3C DTCG 2025.10 spec](https://www.designtokens.org/tr/drafts/format/), [designtokens.org](https://www.designtokens.org/).

### 2. Variant properties (bounded variation)
**What it does.** Exposes a small named set of axes per component with explicit enumerated values. A button has {size: sm/md/lg} × {emphasis: low/med/high} × {tone: neutral/accent}. The system allows all 18 permutations, forbids all others.
**Who uses it.** Figma is the canonical reference. Recommended best practice: separate properties for each axis ("Type" and "Size") rather than combined values ("PrimaryLarge"), so axes can be mixed independently.
**How we'd apply it.** Every slide template exposes variant props: `layout` (hero/split/stack/grid), `emphasis` (loud/medium/quiet), `texture` (flat/gradient/noise), `accent-position` (tl/tr/bl/br/none). A seeded picker samples each independently → 4 × 3 × 3 × 5 = 180 visual combos from one template.
**Sources:** [Figma variants docs](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants), [Figma best practices: variants](https://www.figma.com/best-practices/creating-and-organizing-variants/).

### 3. Auto-layout / spacing rules
**What it does.** Declarative container model: direction, padding, gap, alignment, and per-child resize behavior (hug vs. fill vs. fixed). Content can change arbitrarily; layout stays balanced automatically.
**Who uses it.** Figma's auto-layout is the reference; CSS Flexbox/Grid are the engineering equivalent.
**How we'd apply it.** Replace absolute-positioned SVG elements with an auto-layout-equivalent pass: compute bounding boxes, apply padding/gap tokens, align children per rules. This lets us vary copy length per user without templates breaking. Implementation: a small "auto-layout resolver" that walks the slide tree and positions children before rasterizing.
**Sources:** [Figma auto-layout guide](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout), [Builder.io auto-layout explainer](https://www.builder.io/blog/figma-auto-layout).

### 4. Type scale as constraint
**What it does.** All type sizes in the system derive from one ratio (typically a musical ratio: minor third 1.2, major third 1.25, perfect fourth 1.333, perfect fifth 1.5). You cannot have a size that isn't on the scale.
**Who uses it.** Everyone who cares about typographic harmony — Airbnb's Cereal is explicitly a "scalable" type with adjustments tuned per size step.
**How we'd apply it.** Lock the carousel to one ratio per brand. Derive 6 steps (caption, body, subheading, heading, display, hero). Generator picks *which step* a slot uses, never an arbitrary size. Prevents the current failure mode where similar-sized slides look interchangeable.
**Sources:** [Modular Scale](https://www.modularscale.com/), [Every Layout: modular scale](https://every-layout.dev/rudiments/modular-scale/), [Airbnb Cereal story](https://eyeondesign.aiga.org/airbnbs-new-typeface-is-a-case-study-in-unified-accessible-design/).

### 5. Color system variation (tints/shades, not arbitrary colors)
**What it does.** Define a brand base palette. Expand each hue into a 10–15 step tint/shade scale (50 → 950). Generator picks *steps*, never colors. Material 3 takes this further: semantic roles like `onPrimary`, `surfaceContainerHigh` are filled from the scale dynamically.
**Who uses it.** Material 3 (reference implementation), Tailwind, Polaris, most modern systems.
**How we'd apply it.** For each brand, derive 10-step scales from base colors on generation. Slides sample step combinations (background step, foreground step, accent step) under contrast constraints. This replaces our current "5 presets" with a continuous but bounded space.
**Sources:** [Material 3 color roles](https://m3.material.io/styles/color/roles), [Dynamic color M3](https://m3.material.io/styles/color/static), [Contentful: design token system](https://www.contentful.com/blog/design-token-system/).

### 6. Compositional grammar (grid + slot rules)
**What it does.** Define a grid. Define the set of legal compositions on that grid (e.g., "hero cell + 3 supporting cells", "full-bleed image with 2-cell caption"). A generator picks a composition and fills slots — output is novel but always well-formed.
**Who uses it.** MIT Media Lab (7×7 grid, 40,000 permutations); DIA Studio's generative tools use particle systems with explicit density/decay/brightness thresholds rather than a grid, but the principle is identical.
**How we'd apply it.** Biggest lever we have. Define a 12-column × 8-row grid per slide. Enumerate 15–20 legal compositions (named skeletons like `hero-left`, `hero-right`, `stacked-thirds`, `quote-full-bleed`, `stat-card-grid`, `side-by-side-compare`). Each composition declares slots for {headline, body, accent, media, footer}. Generation: pick composition → fill slots via variant props + tokens. This alone breaks the cluster problem.
**Sources:** [Pentagram MIT Media Lab case](https://www.pentagram.com/work/mit-media-lab/story), [Dezeen on MIT ML rebrand](https://www.dezeen.com/2014/10/29/pentagram-mit-media-lab-rebrand-visual-identity/), [Fast Company on 40,000 permutations](https://www.fastcompany.com/1663378/mit-media-labs-brilliant-new-logo-has-40000-permutations-video), [DIA Studio / Nuits Sonores](https://the-brandidentity.com/project/dia-studio-builds-a-generative-tool-that-makes-nuits-sonores-pulse-2).

### 7. Stochastic selection within bounds
**What it does.** Within every bounded axis (composition, variant props, token steps), pick via seeded RNG. Same seed = same output; new seed = new output; seed space is effectively infinite; output space is bounded to legal values.
**Who uses it.** p5.js algorithmic art, Patrik Hübner's brand generators, most "generative identity" systems.
**How we'd apply it.** Derive the seed from `hash(user_id + topic + version)`. Every Math.random() call in the generator becomes `seeded.next()`. Users get stable, reproducible outputs — so the same topic regenerated looks the same, but two users on the same topic get different carousels because their seeds differ.
**Sources:** [Seed in AI art (FlowHunt)](https://www.flowhunt.io/glossary/seed-in-ai-art/), [Snigdha Sharma: balancing randomness and determinism](https://snigdhasharma.substack.com/p/how-to-balance-randomness-and-determinism), [Patrik Hübner: generative design in branding](https://www.patrik-huebner.com/applying-generative-design-to-brand-design/).

### 8. Slot pattern (flexibility through named placeholders)
**What it does.** A component defines its own layout, structure, and styling, but exposes named slots where arbitrary content can be injected. The consumer cannot reposition the slot — only fill it. This is how component libraries balance "design system control" with "content team freedom".
**Who uses it.** Figma slots (2024+), React (`asChild`, Radix Slot), Web Components `<slot>`, Vue slots.
**How we'd apply it.** Each composition skeleton declares slots with constraints: `headline (1-8 words, stepX type)`, `body (30-120 chars, stepY type)`, `media (aspect 1:1 or 16:9, step-Z radius)`. Content can flex within the constraint; layout cannot break.
**Sources:** [Figma blog: Slots](https://www.figma.com/blog/supercharge-your-design-system-with-slots/), [Nathan Curtis: Slots in design systems](https://medium.com/@nathanacurtis/slots-in-design-systems-f53698c2d745), [Murphy Trueman: slots and the control paradox](https://blog.murphytrueman.com/slots-and-the-control-paradox/).

### 9. "On" color semantic tokens (Material 3)
**What it does.** Every surface role has a matched foreground role. If the system picks `surface.accent` (colored background), `onSurface.accent` is automatically used for text — guaranteeing contrast. The designer sets pairs once; the generator cannot mismatch them.
**Who uses it.** Material 3 is the canonical example. Critical insight: pairing eliminates contrast failures automatically, which is our single biggest quality risk during generation.
**How we'd apply it.** Define semantic pairs: `bg.default/fg.default`, `bg.accent/fg.accent`, `bg.muted/fg.muted`, `bg.inverse/fg.inverse`. When the generator chooses a background role, the foreground is determined. Contrast can be pre-validated per brand during setup.
**Sources:** [Material 3 color roles](https://m3.material.io/styles/color/roles), [Wear color roles and tokens](https://developer.android.com/design/ui/wear/guides/styles/color/roles-tokens).

### 10. Generative identity pattern (DIA / Hübner / MIT ML)
**What it does.** The identity *is* the rule set. Deliverables are instances sampled from the rules. Brand guidelines aren't a PDF — they're executable code: particle density thresholds, decay curves, grid constraints, typographic modulations tied to scale.
**Who uses it.** DIA Studio (Nuits Sonores, smlXL), MIT Media Lab, Patrik Hübner for various brands.
**How we'd apply it.** Our `brand-profile.json` becomes the rule set, not the description. Add fields for: composition weights (probability of each skeleton), token step preferences (which tint/shade steps to favor), typography modulation (when to use display vs. heading), texture preferences (flat/gradient/noise probabilities). Per-user personality emerges from the weights.
**Sources:** [DIA Studio Tools](https://tools.dia.tv/index.html), [Patrik Hübner method](https://www.patrik-huebner.com/method/), [Nuits Sonores identity](https://dia.tv/project/nuits-sonores/).

## Specific recommendations for node-carousel v0.4

Ordered by impact ÷ implementation cost.

### 1. Introduce a composition grammar layer (highest impact)
**Move.** Split "template" into two concepts: **composition skeletons** (where things go) and **style packs** (how things look). Enumerate 15–20 named compositions on a 12×8 grid.
**Source.** MIT Media Lab 7×7 grid; Figma slots.
**Impact.** This alone breaks the "most users get similar output" problem. With 18 compositions × 5 style packs = 90 base visuals before any token sampling.
**Sketch.** `compositions/hero-left.json` declares grid area for each slot + constraints. Generator picks composition stochastically (weighted by brand profile), then fills slots.

### 2. Move from "presets" to semantic token + step-scale generation
**Move.** Delete the 5 presets. Replace with: (a) primitive tokens from brand profile, (b) semantic tokens (surface/fg/accent pairs), (c) 10-step tint/shade scales per base color.
**Source.** Material 3 color roles; W3C design tokens.
**Impact.** Combinatorial explosion of legal color combinations; eliminates "5 presets feel the same" problem.
**Sketch.** `tokens/semantic.json` maps `surface.elevated → brand.neutral.50` etc. At generation time, pick semantic roles; resolve to primitives.

### 3. Derive everything from a seeded hash of (user + topic)
**Move.** Every random choice in the pipeline uses a single seeded RNG initialized from `sha256(brand_id + topic + version)`.
**Source.** Seeded randomness in p5 / AI art; standard generative-design practice.
**Impact.** Deterministic reproduction (regen same carousel), yet infinite variety across users/topics.
**Sketch.** `lib/seeded-random.ts` — wrap RNG, pass through entire generation. Expose `seed` in output metadata for debugging.

### 4. Adopt a single type scale per brand, locked
**Move.** Pick one modular ratio per brand (default 1.25). Derive 6 steps. No arbitrary font sizes anywhere in templates.
**Source.** Modular scale / every-layout / typographic harmony literature.
**Impact.** Instantly raises quality floor; makes slide-to-slide rhythm coherent.
**Sketch.** `brand.type.ratio = 1.25; brand.type.base = 16`. Generator writes `font-size: var(--type-step-3)` — never numbers.

### 5. Replace absolute positioning with auto-layout resolver
**Move.** Build a small auto-layout pass that takes a composition + filled slots and computes final XY for each element using padding/gap tokens.
**Source.** Figma auto-layout; CSS Flexbox/Grid.
**Impact.** Copy-length variation stops breaking slides. Enables "slot content can flex; layout cannot".
**Sketch.** `lib/layout-resolver.ts` — takes skeleton JSON + slot content, returns positioned SVG tree. Use yoga-layout npm or roll small flex engine.

### 6. Variant properties on every skeleton
**Move.** Each composition exposes 3–5 variant props: `emphasis`, `texture`, `accent-position`, `density`, `contrast-mode`. Generator samples each independently via seeded RNG, weighted by brand profile.
**Source.** Figma variants best practice (separate axes, not combined).
**Impact.** 20 compositions × 3 × 3 × 4 × 2 = 1,440 legal base configurations.
**Sketch.** `skeleton.variants = { emphasis: ['loud','med','quiet'], texture: ['flat','grad','noise'], ... }`. Pick per-slide, not per-carousel, so slides within one carousel can vary.

### 7. Introduce "on" color pairs to eliminate contrast failures
**Move.** Define role pairs. Generator picks surface roles; foregrounds are derived.
**Source.** Material 3 onColor pattern.
**Impact.** Removes a whole class of QA failures (unreadable text on accent BGs).
**Sketch.** For each brand, pre-compute pairs: `{surface: brand.primary.600, on: brand.primary.50}` etc. Validate WCAG AA at setup, not generation.

### 8. Scale-aware density/rhythm rules
**Move.** Define slide "intensity" as a first-class variable. Intro/cover = high density/contrast; body = medium; quote = quiet. Generator modulates variant props by position in carousel.
**Source.** DIA scale-responsive thresholds for Nuits Sonores.
**Impact.** Carousel has visual arc — not 8 slides of identical energy.
**Sketch.** `carousel.arc = [hero, build, build, apex, release, build, build, cta]`. Each arc position biases variant prop sampling.

### 9. Brand personality as sampling weights, not fixed style
**Move.** Brand profile contains probability weights: `P(texture=gradient) = 0.7` for a "bold" brand, `0.1` for a "minimal" brand. Same rule set, different distributions.
**Source.** Patrik Hübner's brand-as-algorithm model; DIA's parametric identity.
**Impact.** Replaces our current "5 preset buckets" with a continuous style space per brand. Two minimal brands still look distinct because of seed + composition choice.
**Sketch.** `brand-profile.json` gets a `weights` block: composition weights, texture weights, type-emphasis weights. Generator uses weighted sampling.

### 10. Externalize the rule set (guidelines become code)
**Move.** Stop hiding rules inside template files. Centralize `rules.json` with composition grammar, variant prop definitions, arc patterns, weight defaults.
**Source.** DIA Studio — brand guidelines ARE the tool; Pentagram MIT Media Lab — grid is the rule.
**Impact.** New compositions, new brand personalities, new texture types plug in without touching templates. Testable as data.
**Sketch.** `rules/` directory: compositions, variants, arcs, tokens, pairs. Templates become pure renderers.

### 11. Deterministic generation metadata
**Move.** Every output carousel ships with a `generation-manifest.json`: seed, composition picks, variant picks, token picks, timestamps. Regeneration reads manifest to reproduce exact output; debugging becomes trivial.
**Source.** Standard in generative-art / ML reproducibility (PyTorch, ComfyUI, SD).
**Impact.** "Why does this carousel look bad?" → diff the manifest against a good one.
**Sketch.** Emit alongside SVG outputs. Include version of each rule file used.

### 12. Validate at the rule boundary, not the output boundary
**Move.** Contrast, min font size, aspect-ratio sanity, overflow detection all enforced *at the rule level* (brand setup + composition definition), not post-hoc on rendered SVGs.
**Source.** Material 3 pre-validates color pairs; Figma auto-layout enforces at edit time.
**Impact.** Quality lock is real — bad outputs become unrepresentable, not merely rare.
**Sketch.** `scripts/validate-rules.ts` runs on rule changes; refuses rules that permit <4.5:1 contrast, font-size step < 12px, etc.

## Anti-patterns / what to avoid

1. **Storing finished templates as the primary variation mechanism.**
   Finished templates are the sampled outputs of a grammar, not the grammar. Top systems store rules and sample outputs; we currently store outputs. This is the root of our cluster problem.
   *Reference: MIT Media Lab doesn't store 40,000 logo files — it stores a grid rule.*

2. **Combining unrelated properties into one variant (Figma explicitly warns against this).**
   A "Style" prop with values like "PrimaryLarge" / "SecondarySmall" collapses the design space. Each axis (type, size, tone) gets its own property. *Reference: [Figma variant best practices](https://www.figma.com/best-practices/creating-and-organizing-variants/).*

3. **Letting the generator pick arbitrary colors, sizes, or radii.**
   Any generation step that writes a raw hex or px value is a bug. Everything goes through tokens / steps / scales. *Reference: Material 3, Polaris, Airbnb DLS — enforcement via lint.*

4. **Skipping the "on" color pair — computing contrast at render time.**
   Runtime contrast fixes (darkening text until AA passes) always look worse than designing pairs upfront. Pre-compute pairs; refuse color combos that don't have valid pairs. *Reference: Material 3's role system.*

5. **Using `Math.random()` instead of a seeded RNG.**
   Non-reproducible generation is undebuggable and makes regeneration a gamble. Every generative system that ships uses seeded RNG. *Reference: p5.js, Stable Diffusion, every generative art framework.*

6. **Treating motion / transition as post-hoc decoration.**
   DIA's entire methodology reverses this: the motion/kinetic intent comes first, statics are captures. Even for our static carousels, an "arc" of intensity across slides should be a first-class concept, not an afterthought. *Reference: [DIA / Nuits Sonores](https://the-brandidentity.com/project/dia-studio-builds-a-generative-tool-that-makes-nuits-sonores-pulse-2).*

## High-signal URLs

- [W3C Design Tokens Format Module 2025.10 (stable)](https://www.designtokens.org/tr/drafts/format/) — interoperability spec for tokens; the foundation layer.
- [Figma: Create and use variants](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants) and [best practices](https://www.figma.com/best-practices/creating-and-organizing-variants/) — canonical reference for bounded variation via variant properties.
- [Figma blog: Supercharge your design system with slots](https://www.figma.com/blog/supercharge-your-design-system-with-slots/) + [Nathan Curtis: Slots in design systems](https://medium.com/@nathanacurtis/slots-in-design-systems-f53698c2d745) — slot pattern for flexible-but-bounded composition.
- [Figma auto-layout guide](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout) — declarative layout rules that make content flex without breaking structure.
- [Material 3 color roles](https://m3.material.io/styles/color/roles) and [Dynamic color](https://m3.material.io/styles/color/static) — semantic token architecture + onColor pairs; prevents contrast failures by construction.
- [Pentagram MIT Media Lab case study](https://www.pentagram.com/work/mit-media-lab/story) + [Fast Company: 40,000 permutations](https://www.fastcompany.com/1663378/mit-media-labs-brilliant-new-logo-has-40000-permutations-video) — the canonical grid-based generative identity.
- [DIA Studio: Nuits Sonores generative tool](https://the-brandidentity.com/project/dia-studio-builds-a-generative-tool-that-makes-nuits-sonores-pulse-2) + [DIA Tools](https://tools.dia.tv/index.html) — motion-first, threshold-based generative identity with scale awareness.
- [Patrik Hübner: Method](https://www.patrik-huebner.com/method/) + [Generative design for branding interview](https://www.patrik-huebner.com/applying-generative-design-to-brand-design/) — the "designer as conductor / rule-author" philosophy.
- [Karri Saarinen: Airbnb DLS](https://karrisaarinen.com/dls/) + [5 tips on maintaining it](https://www.designsystems.com/5-tips-from-an-airbnb-designer-on-maintaining-a-design-system/) — "smallest set of robust components used many ways" + base+variant architecture.
- [Every Layout: modular scale](https://every-layout.dev/rudiments/modular-scale/) + [Modular Scale](https://www.modularscale.com/) — type scale as harmonic constraint.
- [Snigdha Sharma: balancing randomness and determinism](https://snigdhasharma.substack.com/p/how-to-balance-randomness-and-determinism) — seeded RNG for generative work.

## Closing synthesis

Our v0.3 problem — "most users get similar-looking output" — is not a template count problem. Doubling presets won't fix it. The problem is *architectural*: we sample at the wrong layer. Top systems don't sample finished compositions; they sample independent axes of a much larger design space, bounded by a small number of invariants (tokens, grids, type scales, on-color pairs) that guarantee brand identity.

The v0.4 refactor in order: (1) composition grammar over templates, (2) semantic + step-scale tokens over presets, (3) seeded RNG over `Math.random`, (4) auto-layout resolver over absolute positioning, (5) variant properties per skeleton, (6) on-color pairs, (7) brand-personality as sampling weights. Everything else is polish on top of that foundation.
