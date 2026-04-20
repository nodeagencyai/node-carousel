# Node Carousel Plugin — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a free, public Claude Code plugin that generates engaging Instagram SVG carousels from a topic prompt, driven entirely by Claude (no paid API dependencies), configured via `brand-profile.json`, shippable as a lead magnet.

**Architecture:** Template-first. 5 pre-built SVG slide templates (`title`, `bullet`, `stat`, `quote`, `cta`) with `{{PLACEHOLDERS}}`. Claude's job is: pick layouts per slide, fill placeholders with content, apply brand-profile values. Render via simple string substitution — no Gemini, no external SVG generation. Background options: solid color, brand gradient, or user-supplied image. PNG export via Puppeteer (optional — `preview.html` fallback).

**Tech Stack:**
- Claude Code plugin structure (`.claude-plugin/plugin.json`, `commands/`, `skills/`)
- Static SVG templates with Handlebars-style `{{PLACEHOLDERS}}`
- Node.js scripts only for rendering (no Python, no venv)
- `puppeteer` (optional, for PNG export)
- Google Fonts via `@import` in SVG `<style>` for typography portability

**Location:** `~/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel/`

**Constraints:**
- DO NOT touch `~/.claude/plugins/marketplaces/node-carousel-marketplace/plugins/carousel-plugin/` (existing `/carousel:*`)
- DO NOT touch `~/.claude/custom-plugins/tps-carousel/` (TPS pipeline)
- DO NOT touch `~/.claude/commands/tps-*.md` or `~/.claude/commands/carousel.md`
- Zero paid API dependencies (no OpenRouter, no Gemini, no API keys required at install)
- Must work zero-config after `/node-carousel:setup` wizard completes

---

## Phase 1: Plugin Skeleton

### Task 1: Initialize plugin directory structure

**Files:**
- Create: `~/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel/.claude-plugin/plugin.json`

**Step 1: Create directory tree**

```bash
PLUGIN_ROOT="$HOME/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"
mkdir -p "$PLUGIN_ROOT"/{.claude-plugin,commands,skills/carousel,templates,prompts,scripts,examples,docs/plans}
```

**Step 2: Write plugin.json**

```json
{
  "name": "node-carousel",
  "version": "0.1.0",
  "description": "Free Instagram carousel SVG generator for Claude Code. Template-first, brand-aware, no paid APIs.",
  "author": "Niek Huggers (Node — nodeagency.ai)",
  "license": "MIT",
  "homepage": "https://github.com/nodeagencyai/node-carousel"
}
```

**Step 3: Verify**

Run: `ls "$PLUGIN_ROOT"/.claude-plugin/plugin.json` → should exist
Run: `cat "$PLUGIN_ROOT"/.claude-plugin/plugin.json | python3 -m json.tool` → should parse valid JSON

**Step 4: Commit (after git init in Task 2)**

---

### Task 2: Initialize git repo + `.gitignore` + LICENSE

**Files:**
- Create: `~/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel/.gitignore`
- Create: `~/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel/LICENSE`

**Step 1: Git init**

```bash
cd "$HOME/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"
git init -b main
```

**Step 2: Write `.gitignore`**

```
node_modules/
output/
.DS_Store
*.local
.env
```

**Step 3: Write MIT LICENSE**

Standard MIT license text with:
- Copyright holder: `Niek Huggers / Node Agency`
- Year: `2026`

**Step 4: Initial commit**

```bash
git add .claude-plugin/plugin.json .gitignore LICENSE
git commit -m "chore: initialize node-carousel plugin skeleton"
```

**Verify:** `git log --oneline` shows one commit.

---

## Phase 2: Brand Profile Contract

### Task 3: Define the `brand-profile.json` schema

**Files:**
- Create: `templates/brand-profile.default.json` (template users can copy)
- Create: `docs/brand-profile-schema.md` (docs)

**Step 1: Write `templates/brand-profile.default.json`**

```json
{
  "brand": {
    "name": "Your Brand",
    "handle": "@yourbrand",
    "tone": "direct, confident, no fluff"
  },
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
      "gradient": {
        "from": "#0f0f0f",
        "to": "#29F2FE",
        "angle": 135
      },
      "imagePath": null
    },
    "dimensions": {
      "width": 1080,
      "height": 1350
    }
  }
}
```

**Step 2: Write schema doc `docs/brand-profile-schema.md`**

Document every field, its type, default, and acceptable values.

**Step 3: Commit**

```bash
git add templates/brand-profile.default.json docs/brand-profile-schema.md
git commit -m "feat: define brand-profile schema and default template"
```

---

## Phase 3: SVG Slide Templates

**Shared placeholders across all templates:**
- `{{WIDTH}}`, `{{HEIGHT}}` — dimensions
- `{{BG_COLOR}}`, `{{BG_IMAGE_HREF}}`, `{{BG_GRADIENT_FROM}}`, `{{BG_GRADIENT_TO}}`, `{{BG_GRADIENT_ANGLE}}`, `{{BG_TYPE}}`
- `{{COLOR_TEXT}}`, `{{COLOR_ACCENT}}`, `{{COLOR_MUTED}}`
- `{{FONT_DISPLAY}}`, `{{FONT_BODY}}`
- `{{BRAND_NAME}}`, `{{BRAND_HANDLE}}`
- `{{SLIDE_NUMBER}}`, `{{SLIDE_TOTAL}}`

**Each template embeds Google Fonts via `<style>@import</style>` for portability.**

### Task 4: Build `title` template

**Files:**
- Create: `templates/title.svg`

**Step 1: Write title template**

Structure:
- Full-bleed background (solid color OR gradient OR image)
- Centered headline at 1/3 from top, 88–120px display font
- Brand handle at bottom-center, 28px muted

Placeholders:
- `{{HEADLINE}}` (main text, 2–5 words)
- `{{KICKER}}` (optional small label above headline, e.g. "A THREAD")

**Step 2: Manual test**

Create `/tmp/test-title.svg` by manually substituting placeholders with real values. Open in browser: `open /tmp/test-title.svg`
Expected: readable headline, brand handle visible, background renders correctly.

**Step 3: Commit**

```bash
git add templates/title.svg
git commit -m "feat: add title slide template"
```

---

### Task 5: Build `bullet` template

**Files:**
- Create: `templates/bullet.svg`

**Step 1: Write bullet template**

Structure:
- Same background pattern
- Headline top-left or top-center, 56–72px display font
- 3–5 bullets below, arrow prefix `→`, 32–40px body font, generous line-height
- Slide counter bottom-right (`{{SLIDE_NUMBER}}/{{SLIDE_TOTAL}}`)

Placeholders:
- `{{HEADLINE}}`
- `{{BULLET_1}}` through `{{BULLET_5}}` (hide unused via empty string + conditional rendering in the generation script)

**Step 2: Manual test** (same pattern as Task 4)

**Step 3: Commit**

---

### Task 6: Build `stat` template

**Files:**
- Create: `templates/stat.svg`

**Step 1: Write stat template**

Structure:
- Huge centered number (e.g. "87%"), 240–320px display font, brand accent color
- Sub-label below, 40px body font
- Context sentence below that, 28px muted

Placeholders:
- `{{STAT_VALUE}}` (e.g. "87%", "3.2x", "$10M")
- `{{STAT_LABEL}}` (e.g. "of founders skip this step")
- `{{STAT_CONTEXT}}` (optional 1-line context)

**Step 2: Manual test**

**Step 3: Commit**

---

### Task 7: Build `quote` template

**Files:**
- Create: `templates/quote.svg`

**Step 1: Write quote template**

Structure:
- Large italic quote, 48–64px display font, accent-colored opening `"`
- Attribution line below, 28px muted, prefixed with `—`

Placeholders:
- `{{QUOTE_TEXT}}`
- `{{QUOTE_ATTRIBUTION}}`

**Step 2: Manual test**

**Step 3: Commit**

---

### Task 8: Build `cta` template

**Files:**
- Create: `templates/cta.svg`

**Step 1: Write CTA template**

Structure:
- Hook line top, 48px display font
- Call-to-action button (rounded rect, accent-colored fill, contrasting text), 40px body font
- Brand handle bottom-center

Placeholders:
- `{{CTA_HOOK}}` (e.g. "Want more like this?")
- `{{CTA_BUTTON}}` (e.g. "Follow for daily tips")
- `{{CTA_SUBTEXT}}` (optional one-liner under button)

**Step 2: Manual test**

**Step 3: Commit**

---

### Task 9: Build shared `_background.svg` snippet

**Files:**
- Create: `templates/_background.svg`

**Step 1: Write background snippet**

A reusable `<defs>` + `<rect>` block that handles all three background modes:
- `type=solid` → plain `<rect fill="{{BG_COLOR}}">`
- `type=gradient` → `<linearGradient>` def + `<rect fill="url(#bg-gradient)">`
- `type=image` → `<image href="{{BG_IMAGE_HREF}}" preserveAspectRatio="xMidYMid slice">`

The render script will include/exclude the appropriate branch based on `visual.background.type`.

**Step 2: Commit**

```bash
git commit -m "feat: add shared background template snippet"
```

---

## Phase 4: Render Script (pure Node.js, no deps)

### Task 10: Write `scripts/render.mjs` — template → SVG string

**Files:**
- Create: `scripts/render.mjs`

**Step 1: Write render function**

```javascript
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fill {{PLACEHOLDERS}} in a template string.
 * Missing keys render as empty string (no error).
 */
export function fillTemplate(templateStr, values) {
  return templateStr.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    values[key] !== undefined ? String(values[key]) : ''
  );
}

/**
 * Build the full slide SVG from template name + slide data + brand profile.
 */
export function renderSlide({ templateName, slideData, brand, slideNumber, slideTotal, pluginRoot }) {
  const templatePath = path.join(pluginRoot, 'templates', `${templateName}.svg`);
  const backgroundPath = path.join(pluginRoot, 'templates', '_background.svg');

  const template = fs.readFileSync(templatePath, 'utf8');
  const background = fs.readFileSync(backgroundPath, 'utf8');

  const bg = brand.visual.background;
  const values = {
    WIDTH: brand.visual.dimensions.width,
    HEIGHT: brand.visual.dimensions.height,
    BG_TYPE: bg.type,
    BG_COLOR: bg.color,
    BG_IMAGE_HREF: bg.imagePath || '',
    BG_GRADIENT_FROM: bg.gradient?.from || bg.color,
    BG_GRADIENT_TO: bg.gradient?.to || bg.color,
    BG_GRADIENT_ANGLE: bg.gradient?.angle ?? 135,
    COLOR_TEXT: brand.visual.colors.text,
    COLOR_ACCENT: brand.visual.colors.accent,
    COLOR_MUTED: brand.visual.colors.muted,
    FONT_DISPLAY: brand.visual.fonts.display,
    FONT_BODY: brand.visual.fonts.body,
    BRAND_NAME: brand.brand.name,
    BRAND_HANDLE: brand.brand.handle,
    SLIDE_NUMBER: slideNumber,
    SLIDE_TOTAL: slideTotal,
    ...slideData,
  };

  // Inject background into template's {{BACKGROUND}} slot
  const withBg = template.replace('{{BACKGROUND}}', fillTemplate(background, values));
  return fillTemplate(withBg, values);
}
```

**Step 2: Write CLI entry point**

```javascript
// Invocation: node render.mjs <brand-profile.json> <strategy.json> <output-dir>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [brandPath, strategyPath, outDir] = process.argv.slice(2);
  const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
  const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf8'));
  const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  fs.mkdirSync(outDir, { recursive: true });
  strategy.slides.forEach((slide, i) => {
    const svg = renderSlide({
      templateName: slide.template,
      slideData: slide.data,
      brand,
      slideNumber: i + 1,
      slideTotal: strategy.slides.length,
      pluginRoot,
    });
    const outPath = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.svg`);
    fs.writeFileSync(outPath, svg);
    console.log(`✓ ${outPath}`);
  });
}
```

**Step 3: Test**

Create fixture `test/fixtures/brand.json` and `test/fixtures/strategy.json`:

```json
// strategy.json
{
  "slides": [
    { "template": "title", "data": { "HEADLINE": "Test Carousel", "KICKER": "A GUIDE" } },
    { "template": "bullet", "data": { "HEADLINE": "Three things", "BULLET_1": "First", "BULLET_2": "Second", "BULLET_3": "Third" } }
  ]
}
```

Run: `node scripts/render.mjs test/fixtures/brand.json test/fixtures/strategy.json /tmp/render-test/`
Expected: `/tmp/render-test/slide-01.svg` and `/tmp/render-test/slide-02.svg` exist, open cleanly in browser, show correct content.

**Step 4: Commit**

```bash
git add scripts/render.mjs test/
git commit -m "feat: add SVG render script (template + strategy → slides)"
```

---

### Task 11: Write `scripts/preview.mjs` — generate preview.html

**Files:**
- Create: `scripts/preview.mjs`

**Step 1: Write preview generator**

Takes an output dir of slide SVGs, produces `preview.html` that lays them out vertically on a dark background using `<object type="image/svg+xml">` tags (NOT `<img>` — to preserve any future animations).

**Step 2: Test**

Run: `node scripts/preview.mjs /tmp/render-test/`
Expected: `/tmp/render-test/preview.html` exists, opens in browser, shows both test slides.

**Step 3: Commit**

```bash
git add scripts/preview.mjs
git commit -m "feat: add preview.html generator"
```

---

### Task 12: Write `scripts/export-png.mjs` — Puppeteer PNG export

**Files:**
- Create: `scripts/export-png.mjs`
- Create: `scripts/package.json` (for Puppeteer dep — keep scripts dir self-contained)

**Step 1: Write `scripts/package.json`**

```json
{
  "name": "node-carousel-scripts",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "puppeteer": "^22.0.0"
  }
}
```

**Step 2: Write `scripts/export-png.mjs`**

Loads each SVG, opens in Puppeteer at correct dimensions, waits for fonts to load, screenshots to PNG.

Key details:
- Set viewport to brand `dimensions.width × dimensions.height`
- `deviceScaleFactor: 2` for retina-quality output
- `await page.evaluateHandle('document.fonts.ready')` before screenshot
- Output PNG next to SVG with same basename

**Step 3: Test**

```bash
cd scripts && npm install
cd .. && node scripts/export-png.mjs /tmp/render-test/
```
Expected: `/tmp/render-test/slide-01.png` and `slide-02.png` exist at configured dimensions.

**Step 4: Commit**

```bash
git add scripts/package.json scripts/export-png.mjs
git commit -m "feat: add Puppeteer PNG export"
```

---

## Phase 5: Prompts (Claude's instructions)

### Task 13: Write `prompts/strategy-system.md`

**Files:**
- Create: `prompts/strategy-system.md`

**Step 1: Write the strategy system prompt**

Claude receives: brand-profile.json + user topic + (optional) reference research.
Claude produces: a `strategy.json` with an array of slides, each with `{ template, data }`.

Instructions must include:
- **Hook harder than you think.** First slide has 1 job: stop the scroll. Use a contrarian take, bold stat, or curiosity gap.
- **5–10 slides ideal.** 7 is the sweet spot for Instagram.
- **One idea per slide.** If two ideas fight, split into two slides.
- **Last slide is ALWAYS a `cta` template** (CTA Hook + Button + optional subtext).
- **Template selection rules:**
  - Slide 1 → `title`
  - Slides with 3+ parallel points → `bullet`
  - Slides with a number that lands → `stat`
  - Slides with an authority voice → `quote`
  - Slide N → `cta`
- **Voice matches `brand.tone` from brand-profile.json.**
- **No emojis, no hashtags in slide content.** Captions live outside the slides.
- **Sentence case, not Title Case. No em dashes — use commas.**

Include 2 worked examples.

**Step 2: Commit**

```bash
git add prompts/strategy-system.md
git commit -m "feat: add carousel strategy system prompt"
```

---

### Task 14: Write `prompts/caption-system.md`

**Files:**
- Create: `prompts/caption-system.md`

**Step 1: Write caption generator**

Claude receives: the strategy.json + brand-profile.json.
Claude produces: `caption.txt` in brand voice with:
- Hook sentence (matches slide 1's energy)
- 2–4 sentence body
- 1-line CTA at bottom
- Hashtag block (5–15 hashtags)

**Step 2: Commit**

---

## Phase 6: Commands

### Task 15: Write `/node-carousel:setup` command

**Files:**
- Create: `commands/setup.md`

**Step 1: Draft command behavior**

When invoked:
1. Check if `./brand-profile.json` already exists in user's CWD — if yes, ask "overwrite?" (default: no).
2. Run a conversational wizard: brand name, handle, tone. 3 color hex codes (background, text, accent). Font choices (default "Playfair Display" + "Inter"). Background type (solid / gradient / image). If image → ask for path.
3. Write `brand-profile.json` to CWD.
4. Generate a test slide (title) to `brand-preview/` so user can validate colors look right immediately.
5. Open the preview in browser.

**Step 2: Write the command markdown**

Full command file with `$ARGUMENTS` handling (if args provided, skip prompts where possible) and explicit step-by-step instructions to Claude.

**Step 3: Test manually**

In a fresh dir: `cd /tmp/setup-test && claude /node-carousel:setup`
Expected: `brand-profile.json` exists, values match what user entered, `brand-preview/slide-01.svg` renders in brand colors.

**Step 4: Commit**

```bash
git add commands/setup.md
git commit -m "feat: add /node-carousel:setup brand wizard"
```

---

### Task 16: Write `/node-carousel:generate` command

**Files:**
- Create: `commands/generate.md`

**Step 1: Draft command behavior**

When invoked with a topic:
1. Read `./brand-profile.json` (error if missing — "run /node-carousel:setup first").
2. Optionally do 1–2 WebSearches for real data/examples on the topic (user can say "no research" to skip).
3. Propose 2–3 angles, let user pick one.
4. Using `prompts/strategy-system.md`, produce `output/{slug}/strategy.json`.
5. Show strategy to user. Get OK.
6. Run `node scripts/render.mjs brand-profile.json output/{slug}/strategy.json output/{slug}/` to render SVGs.
7. Run `node scripts/preview.mjs output/{slug}/` to build preview.html.
8. Open preview in browser.
9. Using `prompts/caption-system.md`, write `output/{slug}/caption.txt`.

**Step 2: Write command markdown**

**Step 3: Manual test**

```bash
cd /tmp/setup-test && claude /node-carousel:generate 5 mistakes new founders make with AI
```
Expected: 7-ish SVG slides in `output/5-mistakes-new-founders-make-with-ai/`, preview.html renders cleanly, caption.txt exists.

**Step 4: Commit**

```bash
git add commands/generate.md
git commit -m "feat: add /node-carousel:generate topic-to-carousel command"
```

---

### Task 17: Write `/node-carousel:export` command

**Files:**
- Create: `commands/export.md`

**Step 1: Draft command behavior**

When invoked:
1. Find most recent `output/{slug}/` dir (OR accept slug as argument).
2. Check if `scripts/node_modules/puppeteer` exists.
   - If not: run `cd scripts && npm install puppeteer`. Warn about ~170MB download.
3. Run `node scripts/export-png.mjs output/{slug}/`
4. Report: `✓ 7 PNGs exported to output/{slug}/`.

Fallback mode (if Puppeteer install fails): print "Open preview.html in your browser, right-click each slide → Save As PNG" and open preview.html.

**Step 2: Write command markdown**

**Step 3: Manual test**

**Step 4: Commit**

---

## Phase 7: Examples

### Task 18: Generate example 1 — "5 signs your AI automation is over-engineered"

**Files:**
- Create: `examples/5-signs-overengineered/brand-profile.json` (Node brand)
- Create: `examples/5-signs-overengineered/output/slide-01.svg` through `slide-07.svg`
- Create: `examples/5-signs-overengineered/caption.txt`

**Step 1:** Set up Node-branded profile with gradient background (#0f0f0f → #29F2FE).

**Step 2:** Manually write a strong 7-slide strategy.json (use the worked example voice).

**Step 3:** Render slides via scripts.

**Step 4:** Screenshot the preview, include in README as a demo.

**Step 5:** Commit.

---

### Task 19: Generate example 2 — "The 2-minute CRM audit framework"

(Different brand profile — light-mode solid color, different font stack, shows tool flexibility.)

---

### Task 20: Generate example 3 — "Why your lead magnet isn't converting"

(Image-background brand profile — shows the image-upload path working.)

---

## Phase 8: Documentation

### Task 21: Write `README.md` (lead-magnet landing)

**Files:**
- Create: `README.md`

**Step 1: Write the README**

Structure:
- **Hook at top:** screenshot collage of the 3 example carousels
- **One-line pitch:** "Free Instagram carousel generator for Claude Code. Runs on your own Claude plan — no API keys, no paid services, no Figma."
- **"Why another carousel tool?"** — 3-bullet differentiation (Claude-native, template-first so it always works, brand-config in one file)
- **Install** — two paths:
  ```bash
  # Option 1: Clone
  git clone https://github.com/nodeagencyai/node-carousel ~/.claude/plugins/node-carousel
  # Option 2: Copy skills globally
  git clone https://github.com/nodeagencyai/node-carousel /tmp/nc && cp -r /tmp/nc/skills/* ~/.claude/skills/
  ```
- **Quick start** — 3 commands: `/node-carousel:setup` → `/node-carousel:generate <topic>` → `/node-carousel:export`
- **Configuration** — annotated `brand-profile.json` example
- **Templates catalogue** — preview each of the 5 templates
- **FAQ** — "Can I add my own templates?" "Does it work with Haiku/Sonnet?" "Can I use my own background image?"
- **Credits / contact**

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add lead-magnet README"
```

---

### Task 22: Write `docs/adding-templates.md`

Guide for community contribution — how to add a new template: placeholders schema, conventions, PR process.

**Commit:** `docs: add template contribution guide`

---

## Phase 9: Final QA + Ship

### Task 23: End-to-end smoke test

**Step 1: Simulate fresh install**

```bash
mkdir /tmp/nc-smoke && cd /tmp/nc-smoke
# Copy plugin into place
cp -r "$HOME/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel" ./plugin
# Fake a Claude Code session: manually exercise each command path
```

**Step 2: Run `/node-carousel:setup`** — verify brand-profile.json written correctly.

**Step 3: Run `/node-carousel:generate "test topic"`** — verify strategy, slides, preview, caption all produced.

**Step 4: Run `/node-carousel:export`** — verify PNGs produced at correct dimensions.

**Step 5: Visual check** — open each slide in browser + PNG in Finder Quick Look. Judge: does this look like something worth paying for? Would you post this?

**Step 6: Fix any issues found** — commit fixes.

---

### Task 24: Create GitHub repo + push

**Step 1: Create GitHub repo via `gh`**

```bash
cd "$HOME/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"
gh repo create nodeagencyai/node-carousel --public --source=. --description "Free Instagram carousel generator for Claude Code" --remote=origin
git push -u origin main
```

**Step 2: Configure repo**
- Add topics: `claude-code`, `plugin`, `instagram`, `carousel`, `svg`, `ai-tools`
- Enable issues
- Set README as default social preview image

**Step 3: Final commit on any README polish, push again.**

---

### Task 25: Tag v0.1.0 release

```bash
git tag -a v0.1.0 -m "v0.1.0 — initial public release"
git push --tags
gh release create v0.1.0 --title "v0.1.0 — Initial public release" --generate-notes
```

---

## Post-ship (not in V1 scope — backlog for V2)

- `/node-carousel:animate` — port SMIL animation catalog (text fade-in, bullet stagger, counter count-up). **DO NOT** copy the TPS music-specific ones (sequencer, sidechain curves) — those stay in the private TPS plugin.
- `/node-carousel:mp4` — Puppeteer frame-seek MP4 export. Keep Pro-tier-flavored.
- More templates: `timeline`, `comparison`, `checklist`, `carousel-cover`
- Gemini fallback for illustrative slides (opt-in, user brings their own API key)
- Community template marketplace

---

## Success Criteria (how we know V1 is done)

- [ ] Running `/node-carousel:setup` in a fresh dir creates a valid brand-profile.json in under 2 minutes of wizard.
- [ ] Running `/node-carousel:generate <topic>` produces 5–8 SVG slides that render cleanly in browser without visual bugs (text overflow, clipping, missing fonts).
- [ ] Running `/node-carousel:export` produces 1080×1350 PNGs suitable for direct Instagram upload.
- [ ] A stranger can follow the README, install the plugin, and produce a working carousel in under 10 minutes.
- [ ] All 3 example carousels render correctly in README preview on GitHub.
- [ ] Zero references to OpenRouter, Gemini, TPS, or any paid API in the public plugin code.
- [ ] Existing `/carousel:*` and `/tps-*` commands still work unchanged (smoke-test after ship).

---

## Notes for the executor

- **SVG is whitespace-sensitive inside `<text>` elements** — use `xml:space="preserve"` on any `<text>` where explicit whitespace matters, or strip whitespace in the template.
- **Font loading in Puppeteer is flaky without `document.fonts.ready`** — always await it before screenshot.
- **Template placeholders are `{{LIKE_THIS}}`** — uppercase with underscores, never spaces. Matches the regex in `fillTemplate`.
- **Test frequently with `open <file>.svg`** — browser rendering is the ground truth. Don't trust what the SVG looks like in a text editor.
- **Commit after every single task** — do not bundle. If a task fails midway, we want the last good state to be clear.
- **If a step blocks on a decision you can't make (e.g. which color for example 2's accent), stop and ask. Don't guess.**
