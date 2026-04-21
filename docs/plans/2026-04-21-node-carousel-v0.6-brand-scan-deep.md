# Node Carousel v0.6 — Brand Scan Deep

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade `/node-carousel:scan` from a single-page CSS parser to a genuinely world-class brand extraction system — multi-page crawl, logo extraction, Claude-vision screenshot analysis, brand voice + niche classification, delta-E color clustering, confidence calibration, and opt-in BrandFetch API integration.

**Architecture:**
1. Core scan stays zero-API (lead-magnet differentiator preserved)
2. Three new self-hosted improvements: multi-page crawl, logo extraction, Claude-vision analysis
3. Two new Claude-prompt-driven extractions: brand voice + niche classification
4. One opt-in paid-API integration: BrandFetch (BYOK free tier = 100 req/mo)
5. Synthesizer becomes the merge point that reconciles all signal sources with weighted confidence

**Tech stack:** Existing (Puppeteer + Node stdlib + Claude runtime multimodal Read tool) + optional BrandFetch HTTP client using Node's native `fetch()`. No new npm dependencies required.

**Constraints:**
- DO NOT break v0.5 scan behavior — v0.5 brand profiles and flows must continue working unchanged
- DO NOT touch render-v0.4.mjs, shared-render.mjs, patterns/, tokens/ — those are frozen feature surfaces
- DO NOT add npm dependencies — all new features use stdlib + existing Puppeteer
- BrandFetch stays opt-in — reading BRANDFETCH_API_KEY from env, never from config files
- Confidence scores must land in realistic ranges (0.4–0.9 on real sites; 1.0 reserved for "everything matched perfectly")

**Research inputs:**
- v0.5 known issues surfaced in project memory: text color role confusion, near-duplicate colors, JS-rendered leakage, single-sample bias, confidence over-counting
- BrandFetch Brand API docs (free tier confirmed at 100 req/mo)
- Delta-E CIE76 formula (simple RGB distance, no colorspace library needed)

---

## Phase A: Color quality + confidence calibration

Goal: fix v0.5's "1.0 confidence everywhere" and "near-duplicate colors in allColors" problems without changing any other behavior. Small, focused, low risk.

### Task A.1 — Delta-E CIE76 color clustering

**Files:**
- Modify: `scripts/extract-brand-signals.mjs` (existing)
- Test: add a new `test/fixtures/scan-site-fixtures/near-duplicate-colors.html` fixture

**Step 1: Add `deltaE76(hexA, hexB)` helper**

```javascript
// Inline, no external color library. CIE76 ΔE on RGB.
// Good enough for "are these two colors the same" at threshold ~10.
// True Lab conversion would be more accurate but costs more code.
function deltaE76(hexA, hexB) {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  // Simple RGB distance; Lab would be better but this is sufficient for dedup
  const dr = rgbA.r - rgbB.r;
  const dg = rgbA.g - rgbB.g;
  const db = rgbA.b - rgbB.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
```

Threshold: ΔE ≤ 12 = "same color for our purposes." This catches `#000000` + `#0A0A0A` (same near-black) without collapsing `#0A0A0A` + `#1A1A1A` (actually-distinct dark greys).

**Step 2: Cluster `allColors` array before returning**

```javascript
function clusterColors(colors, threshold = 12) {
  const clusters = [];
  for (const c of colors) {
    const existing = clusters.find(cluster => deltaE76(cluster[0], c) <= threshold);
    if (existing) existing.push(c);
    else clusters.push([c]);
  }
  // Return one representative per cluster — the first (most-frequent) one
  return clusters.map(cluster => cluster[0]);
}
```

Call this on the extracted `allColors` array before returning from `extractSignals()`.

**Step 3: Test fixture**

`test/fixtures/scan-site-fixtures/near-duplicate-colors.html`:
```html
<style>
  body { background: #0A0A0A; color: #FFFFFF; }
  .hero { background: #000000; }  /* ΔE ~10 from body bg */
  .card { background: #141414; }  /* ΔE ~20 from body bg — should NOT collapse */
  .accent { color: #29F2FE; }
  .accent-dim { color: #29F0FC; }  /* ΔE ~3 from accent — should collapse */
</style>
```

Expected `allColors` after clustering: 4 entries (near-black, distinct dark grey, white, cyan) — not 5.

**Step 4: Add to `run-fixture-tests.mjs`**

Assert `allColors.length === 4` for this fixture.

**Step 5: Commit**

```bash
git add scripts/extract-brand-signals.mjs test/fixtures/scan-site-fixtures/
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "fix(v0.6): delta-E color clustering to dedupe near-duplicates"
```

---

### Task A.2 — Confidence calibration

**Files:**
- Modify: `scripts/extract-brand-signals.mjs` — the confidence-scoring section

**Step 1: Analyze current scoring**

Current scoring is additive with no cap below 1.0. Every signal that fires adds points. Rewrite as a weighted proportion: points earned / points available.

**Step 2: New scoring formula**

```javascript
function scoreConfidence({
  hasBackground,      // 0 or 1 — found a dominant bg color
  hasText,            // 0 or 1
  hasAccent,          // 0 or 1
  hasDisplayFont,     // 0 or 1
  hasBodyFont,        // 0 or 1
  uniqueColors,       // number after clustering
  fontFaceCount,      // number of distinct font-family values found
  hasJsRenderedWarning, // 1 if site looks like it needs JS to render (capped penalty)
}) {
  // Core signals weighted. Max achievable: 100.
  let score = 0;
  if (hasBackground) score += 20;
  if (hasText) score += 15;
  if (hasAccent) score += 20;
  if (hasDisplayFont) score += 20;
  if (hasBodyFont) score += 15;

  // Bonus for "looks like a real designed brand" (2-5 distinct colors + 2-3 fonts)
  if (uniqueColors >= 2 && uniqueColors <= 6) score += 5;
  if (fontFaceCount >= 2 && fontFaceCount <= 4) score += 5;

  // Penalty for JS-heavy site (we may have missed dynamically-loaded styles)
  if (hasJsRenderedWarning) score = Math.round(score * 0.85);

  return Math.min(1.0, score / 100);
}
```

Realistic output: well-designed brand site with static CSS → 0.85–0.95. JS-heavy site → 0.6–0.8. Scrappy site with inline styles only → 0.5–0.7.

**Step 3: Update fixture tests with realistic expected confidences**

- `tech-dark.html`: 0.90 ± 0.05
- `editorial-cream.html`: 0.90 ± 0.05
- `agency-minimal.html`: 0.85 ± 0.05

Not all-1.0 anymore. Fixture tests become proper calibration guardrails.

**Step 4: Commit**

```bash
git commit -m "fix(v0.6): recalibrate confidence scoring — proportional, capped, JS-penalty"
```

---

## Phase B: Multi-page crawl

Goal: sample 3 pages (home + about + one more) to reduce single-sample bias. More signal, better detection.

### Task B.1 — Page discovery

**Files:**
- Modify: `scripts/scan-site.mjs`

**Step 1: Add `discoverPages(homepageHtml, baseUrl)` helper**

Extract internal links from homepage nav + footer. Rank them:
1. `/about`, `/about-us`, `/team` — priority 1 (brand voice lives here)
2. `/pricing`, `/plans` — priority 2 (CTAs live here)
3. `/blog`, `/journal`, `/writing` — priority 3 (content voice)
4. `/services`, `/what-we-do` — priority 4

Return up to 2 additional URLs (so total scan = 3 pages: home + 2 others).

**Step 2: Extend scan orchestration**

Current: scan homepage, write `scan.json`.
New: scan homepage → discover pages → scan each → merge signals.

New output shape:
```json
{
  "url": "https://nodeagency.ai",
  "pagesScanned": ["/", "/about", "/work"],
  "perPage": {
    "/": { fonts, colors, textSamples, ... },
    "/about": { ... },
    "/work": { ... }
  },
  "merged": {
    // existing top-level schema, merged across pages
  }
}
```

Merging rules:
- Fonts: most-common display + body across pages
- Colors: clustered across all pages' colors (ΔE clustering from Phase A)
- Text samples: concatenate `heroHeadline` from each page; keep individual `ctaCandidates`
- Warnings: union across pages

**Step 3: Cap at 3 pages + 20s total timeout**

Don't over-crawl. Three pages max, graceful fail on any one, keep what we got.

**Step 4: Fixture test**

Can't easily test multi-page with local fixtures — multi-page requires a running server. Create a minimal test that:
- Mocks Puppeteer's page.goto with fixture file paths
- Runs discoverPages on homepage fixture with inline nav links
- Asserts correct pages selected

OR skip fixture test and add a "smoke test" script `scripts/smoke-test-scan.mjs` that scans nodeagency.ai and prints the merged output (run manually, not in CI).

**Step 5: Commit**

```bash
git commit -m "feat(v0.6): multi-page crawl — home + 2 discovered pages, merged signals"
```

---

## Phase C: Logo extraction

Goal: detect and save the brand's logo so synthesizer can populate `brand.visual.logo.file`.

### Task C.1 — Logo detector

**Files:**
- Create: `scripts/extract-logo.mjs`
- Modify: `scripts/scan-site.mjs` to call it

**Step 1: Logo detection priority order**

1. **Inline SVG in header/nav** with class/id containing "logo" — highest fidelity, vector
2. **`<img alt="... logo ...">` in header/nav** — raster logo, still good
3. **Favicon** — `<link rel="icon">` or `/favicon.ico`
4. **apple-touch-icon** — usually higher-res than favicon
5. **og:image** — fallback but often marketing imagery, not logo

Return the first match. Save to `<output-dir>/logo.<svg|png|ico>`.

**Step 2: Implementation**

```javascript
export async function extractLogo(page, outputDir, baseUrl) {
  // 1. Try inline SVG
  const inlineSvg = await page.evaluate(() => {
    const candidates = document.querySelectorAll(
      'header svg[class*="logo" i], nav svg[class*="logo" i], [id*="logo" i] svg, [class*="logo" i]:not(a)'
    );
    for (const svg of candidates) {
      if (svg.getBoundingClientRect().width > 0) {
        return svg.outerHTML;
      }
    }
    return null;
  });
  if (inlineSvg) {
    writeFileSync(`${outputDir}/logo.svg`, inlineSvg);
    return { type: 'inline-svg', path: `${outputDir}/logo.svg` };
  }

  // 2. <img> in header/nav
  const imgUrl = await page.evaluate(() => {
    const candidates = document.querySelectorAll(
      'header img[alt*="logo" i], nav img[alt*="logo" i], header a[href="/"] img, [class*="logo" i] img'
    );
    for (const img of candidates) {
      if (img.src && !img.src.startsWith('data:')) return img.src;
    }
    return null;
  });
  if (imgUrl) {
    const buffer = await fetchBuffer(imgUrl);
    const ext = inferExtension(imgUrl);
    writeFileSync(`${outputDir}/logo.${ext}`, buffer);
    return { type: 'img', path: `${outputDir}/logo.${ext}`, sourceUrl: imgUrl };
  }

  // 3. Favicon / apple-touch-icon
  const favUrl = await page.evaluate((base) => {
    const link = document.querySelector(
      'link[rel="icon"][type="image/svg+xml"], link[rel="apple-touch-icon"], link[rel="icon"]'
    );
    if (link) return new URL(link.href, base).href;
    return new URL('/favicon.ico', base).href;
  }, baseUrl);
  try {
    const buffer = await fetchBuffer(favUrl);
    const ext = inferExtension(favUrl);
    writeFileSync(`${outputDir}/favicon.${ext}`, buffer);
    return { type: 'favicon', path: `${outputDir}/favicon.${ext}`, sourceUrl: favUrl };
  } catch (e) {
    return { type: 'none', warning: 'No logo found' };
  }
}
```

**Step 3: Wire into scan.json**

Add `logo: { type, path, sourceUrl? }` to the schema.

**Step 4: Test**

Scan nodeagency.ai manually. Confirm logo extracted. Open the saved file to visually verify it's actually a logo (not a hero image by mistake).

**Step 5: Commit**

```bash
git commit -m "feat(v0.6): logo extraction (inline SVG → img → favicon → apple-touch-icon)"
```

---

## Phase D: Claude-vision screenshot analysis

Goal: analyze the hero screenshot visually, not just via CSS. Catches the stuff CSS can't tell us — actual visual hierarchy, composition, whitespace treatment, illustration style.

### Task D.1 — Vision prompt

**Files:**
- Create: `prompts/screenshot-analysis.md`

**Step 1: Write the prompt**

Structure:
```markdown
# Screenshot Analysis Prompt

You are looking at a screenshot of a brand's homepage. Extract visual signals the CSS scan can't detect:

1. **Visual hierarchy** — where does the eye go first? What's biggest? What's second?
2. **Whitespace strategy** — tight / balanced / airy / editorial-spacious?
3. **Composition** — centered / asymmetric / grid-heavy / split-layout?
4. **Imagery style** — photography / illustration / 3D / abstract-shapes / type-only / mixed?
5. **Visual density** — sparse / moderate / dense / maximalist?
6. **Mood signals** — what does the site FEEL like (not just look like)?

## Process

1. Use the Read tool to load the screenshot (`hero.png` or `full.png`)
2. Look carefully — don't skim
3. For each signal above, note what you see + 1 sentence why

## Output schema

Write JSON to `<output-dir>/vision-analysis.json`:

```json
{
  "screenshot": "hero.png",
  "hierarchy": {
    "primary": "massive headline centered",
    "secondary": "muted subheadline below",
    "tertiary": "CTA button to the right"
  },
  "whitespace": "airy" | "balanced" | "tight" | "editorial-spacious",
  "composition": "centered" | "asymmetric-left" | "asymmetric-right" | "grid" | "split",
  "imagery": {
    "style": "photography" | "illustration" | "3d" | "abstract" | "type-only" | "mixed",
    "notes": "..."
  },
  "density": "sparse" | "moderate" | "dense" | "maximalist",
  "mood": ["editorial", "tech", "playful", "clinical", "bold", "warm", "cold", "premium", "scrappy"],
  "observations": "Free-form 2-3 sentence summary of what you noticed"
}
```

Don't invent details. If you can't tell, say "uncertain" and explain why.
```

**Step 2: Orchestrator integration**

`commands/scan.md` invokes Claude to read `prompts/screenshot-analysis.md`, look at hero.png, write `vision-analysis.json`. This happens at runtime inside the `/node-carousel:scan` command.

**Step 3: Commit**

```bash
git commit -m "feat(v0.6): Claude-vision screenshot analysis prompt (hierarchy / mood / imagery)"
```

---

## Phase E: Brand voice + niche classification

Goal: read the site's actual COPY (body text, headings, about page) and classify voice/tone/niche. CSS can't tell us this — copy can.

### Task E.1 — Copy extraction

**Files:**
- Modify: `scripts/scan-site.mjs` (add copy extraction)

**Step 1: Extract text content**

Beyond the existing `textSamples`, collect:
- All h1/h2/h3 content (full text, up to 20 headings)
- First 500 words of main content (from `<main>` or largest content block)
- CTA button texts
- Meta description

Add to scan.json as `textContent` field.

**Step 2: Commit**

```bash
git commit -m "feat(v0.6): expand text content extraction for voice analysis"
```

### Task E.2 — Voice + niche prompt

**Files:**
- Create: `prompts/voice-niche-analysis.md`

**Step 1: Write the prompt**

```markdown
# Voice + Niche Analysis Prompt

You are reading copy from a brand's website. Classify their voice and niche.

## Voice dimensions

For each, pick one:
- Register: **formal** / **casual** / **technical** / **conversational**
- Energy: **high** / **medium** / **low**
- Confidence: **authoritative** / **balanced** / **humble** / **playful**
- Style: **direct** / **editorial** / **marketing-speak** / **academic** / **builder-voice**
- Warmth: **cold** / **neutral** / **warm** / **intimate**

## Niche dimensions

- Industry: 3-5 word phrase (e.g. "AI automation for SMBs", "B2B design agency", "creator economy education platform")
- Audience: who they speak to (e.g. "startup founders", "enterprise buyers", "hobbyist developers")
- Product type: what they sell (SaaS, services, course, plugin, marketplace, etc.)

## Tone synthesis

Produce a single-line `tone` string for brand-profile.json. Max 8 words, no em-dashes.
Examples:
- "direct, builder-voice, no fluff"
- "warm, concrete, educational"
- "sharp, opinionated, no-BS"
- "clinical, premium, considered"

## Output schema

Write to `<output-dir>/voice-niche.json`:

```json
{
  "voice": {
    "register": "...",
    "energy": "...",
    "confidence": "...",
    "style": "...",
    "warmth": "...",
    "notes": "Free-form paragraph on voice nuance"
  },
  "niche": {
    "industry": "...",
    "audience": "...",
    "productType": "...",
    "notes": "..."
  },
  "tone": "single-line synthesis",
  "confidence": 0.8
}
```

Read from scan.json's `textContent`. Base analysis on ACTUAL copy quotes you can cite. Confidence < 0.5 if the copy is too sparse to classify.
```

**Step 2: Commit**

```bash
git commit -m "feat(v0.6): voice + niche classification prompt"
```

---

## Phase F: BrandFetch integration (opt-in BYOK)

Goal: for users with a BrandFetch API key (free tier available), augment self-hosted scan with authoritative brand data.

### Task F.1 — BrandFetch client

**Files:**
- Create: `scripts/brandfetch-client.mjs`

**Step 1: API contract**

BrandFetch Brand API: `https://api.brandfetch.io/v2/brands/<domain>`. Returns structured data:
- logos (SVG/PNG variants, sizes)
- colors (primary, secondary, accent hexes)
- fonts (family names)
- description
- company info (industry, employees, etc.)

**Step 2: Implementation**

```javascript
export async function brandfetch(domain, apiKey) {
  if (!apiKey) return { available: false, reason: 'no API key' };
  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return { available: false, reason: 'brand not in BrandFetch DB' };
    if (res.status === 429) return { available: false, reason: 'rate limited' };
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    return { available: true, data: normalizeBrandfetch(data) };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

function normalizeBrandfetch(data) {
  return {
    name: data.name,
    description: data.description,
    domain: data.domain,
    logos: data.logos?.map(l => ({
      type: l.type,          // 'icon' | 'logo' | 'symbol'
      format: l.formats?.[0]?.format,  // 'svg' | 'png'
      url: l.formats?.[0]?.src,
    })) ?? [],
    colors: data.colors?.map(c => ({
      hex: c.hex,
      type: c.type,          // 'accent' | 'dark' | 'light' | 'brand'
    })) ?? [],
    fonts: data.fonts?.map(f => ({ name: f.name, type: f.type })) ?? [],
    industries: data.company?.industries?.map(i => i.name) ?? [],
  };
}
```

**Step 3: Wire into scan.json**

- Check `process.env.BRANDFETCH_API_KEY`. If present, call the API with the scanned domain.
- Add `brandfetch: { available: bool, data?: {...} }` to scan.json.
- Never require the key — it's strictly augmentation.

**Step 4: Commit**

```bash
git commit -m "feat(v0.6): opt-in BrandFetch API client (BYOK via BRANDFETCH_API_KEY env)"
```

### Task F.2 — Document BrandFetch setup in README

**Files:**
- Modify: `README.md`

Add a small section under `/node-carousel:scan` docs:
```markdown
### Optional: BrandFetch API key (free tier = 100 scans/month)

For sharper brand data on well-known brands, set your BrandFetch API key:
```bash
export BRANDFETCH_API_KEY=your_key_here
```

Get a free key at https://brandfetch.com/developers. When set, scans augment self-hosted extraction with BrandFetch's curated logos, colors, and metadata. When not set, everything runs zero-API as before.
```

**Step 5: Commit**

```bash
git commit -m "docs(v0.6): BrandFetch setup instructions in README"
```

---

## Phase G: Synthesizer updates

Goal: feed all new signals into `prompts/brand-synthesis.md` so the final brand-profile.json benefits.

### Task G.1 — Expand synthesis inputs

**Files:**
- Modify: `prompts/brand-synthesis.md`

**Step 1: Document new inputs**

Synthesizer now consumes:
- scan.json (existing, now enriched)
- references.json (existing, optional)
- vision-analysis.json (new, always)
- voice-niche.json (new, always)
- BrandFetch data if available (new, optional)

**Step 2: Conflict resolution rules**

When sources disagree, priority order:
1. BrandFetch (when available — authoritative for logos + colors)
2. vision-analysis (authoritative for visual hierarchy + mood)
3. voice-niche (authoritative for tone)
4. references (authoritative for composition patterns if user provided)
5. scan (authoritative when nothing else available)

Document this in the synthesis prompt.

**Step 3: Updated preset-matching heuristic**

Re-weight preset-matching based on richer signals:
- Voice register "casual" + warmth "warm" → favor editorial-serif
- Voice style "builder-voice" + register "technical" → favor technical-mono
- Vision composition "asymmetric-left" + imagery "type-only" → favor display-serif-bold or cover-asymmetric pattern default
- Niche industry containing "dev tool" or "API" → technical-mono
- Niche industry containing "agency" or "studio" → neo-grotesk or utilitarian-bold

**Step 4: Logo mapping**

If scan or BrandFetch returned a logo, synthesizer should populate `visual.logo = { file: "<logo-path>", position: "top-right", size: 48 }` in the output brand-profile.json.

**Step 5: Commit**

```bash
git commit -m "feat(v0.6): synthesizer consumes vision + voice + BrandFetch signals"
```

---

## Phase H: Docs + ship

### Task H.1 — README update

Mark scan feature as enhanced. Document new signals extracted. Link to BrandFetch section.

### Task H.2 — Schema doc update

`docs/brand-profile-schema.md` — no schema changes expected (the scan outputs are pre-brand-profile, not in the final JSON), but document the `visual.logo` population path.

### Task H.3 — Version bump

`.claude-plugin/plugin.json` → `0.6.0`.

### Task H.4 — Smoke test

Real-URL scan of `nodeagency.ai` with full v0.6 pipeline:
1. Multi-page crawl (home + about + work)
2. Logo extracted (should find Node's `<svg>` in header)
3. Vision analysis (should describe dark mode, centered headline, clean composition)
4. Voice analysis (should detect "direct, builder-voice, no fluff" or similar)
5. BrandFetch (optional — set key and verify, or confirm graceful skip without)
6. Synthesizer output brand-profile.json should match user's hand-tuned version for nodeagency.ai with ≥ 0.85 confidence

### Task H.5 — Tag v0.6.0 + push

Same pattern as v0.4/v0.5. Ship.

---

## Success criteria

- [ ] Confidence on nodeagency.ai lands 0.85–0.95 (not 1.0)
- [ ] `allColors` has no ΔE<12 near-duplicates
- [ ] Multi-page crawl captures 3 pages (home + 2) or falls back gracefully
- [ ] Logo extracted as SVG (ideal) or PNG/ICO (acceptable)
- [ ] vision-analysis.json produced with all required fields populated
- [ ] voice-niche.json produced with tone string matching brand's actual voice
- [ ] BrandFetch optional — works with key, skips cleanly without
- [ ] Synthesizer produces a brand-profile.json that renders correctly through existing render-v0.4.mjs
- [ ] v0.5 brand profiles still render (no regressions)
- [ ] All existing v0.5 tests still pass
- [ ] New v0.6 tests added for color clustering, confidence calibration, multi-page merge

## Scope boundary — what's v0.6 vs v0.7+

**In v0.6 (this plan):**
- Multi-page crawl (home + 2 discovered)
- Logo extraction (inline SVG → img → favicon)
- Claude-vision screenshot analysis
- Brand voice + niche classification
- BrandFetch BYOK integration
- Delta-E color clustering
- Confidence calibration

**Deferred to v0.7+:**
- Archive.org snapshot comparison (brand evolution tracking)
- Instagram/social profile scraping (actual social content matching)
- Competitor intelligence (given niche, compare against top N brands)
- Accessibility validation (WCAG contrast ratios, palette auto-correction)
- Multi-URL batch scanning (scan 5 inspirational brands at once)
- OpenAI vision API integration (Claude runtime Read tool covers most cases; OpenAI would be a polish item)
- Deep image colour extraction (sampling hero photography colors, not just CSS)
- Font face file hosting detection (self-hosted custom fonts)
- Wordmark vs symbol vs logomark classification

## Parallelism opportunities

Phases A, C, F can run as parallel agents — they touch different files:
- A: `extract-brand-signals.mjs` + test fixtures
- C: new `extract-logo.mjs` + minor scan-site.mjs hook
- F: new `brandfetch-client.mjs` + minor scan-site.mjs hook

Phase B (multi-page crawl) must run first or coordinate with A/C — it touches scan-site.mjs structurally.

Phases D + E are prompt-writing only — can run parallel to anything.

Phase G (synthesizer update) must run AFTER A-F land — it reconciles all signals.

Phase H (ship) runs last.

Build order:
1. **Wave 1:** Phase B (multi-page scaffolding)
2. **Wave 2 parallel:** A + C + D + E + F (5 agents, no file overlap)
3. **Wave 3:** G (synthesizer consumes everything)
4. **Wave 4:** H (docs + ship)

Estimated total agent time: ~6 hours. Wall-clock with 5-parallel wave ≈ 2.5–3 hours.

## Process rules (non-negotiable)

1. **Visual verification before every commit** — especially logo extraction and vision analysis. Open the outputs, describe what you saw.
2. **Test real-URL scan of nodeagency.ai at Phase H** — before tagging, prove it works on a live site. Document the output in the ship commit.
3. **Zero new npm deps** — use stdlib `fetch()` for BrandFetch, existing Puppeteer for everything else.
4. **Keep core zero-API** — BrandFetch must be genuinely optional, graceful-skip, never blocking.
5. **Confidence reality check** — if any fixture test produces 1.0 confidence, the scoring is still over-counting. Target 0.85–0.95 for "great" sites, not perfect.
