# Node Carousel v0.7 — Brand Authorship

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the "website brand != carousel brand" gap surfaced during v0.6 verification — let users bring existing brand identity into the scan pipeline so the synthesizer augments rather than overwrites, and harden the audit-surfaced Important items into production-grade polish.

**Architecture:**
1. Preserve v0.6 zero-API core (lead-magnet pitch intact)
2. Add three user-directed scan modes: `--merge-with <profile>` (existing profile wins), `--preset <name>` (force preset choice), interactive candidate picker deferred to v0.7.1
3. Upgrade detection: per-context font extraction (header/nav/h1/body/buttons separately), CSS variable brand-color extraction (`--brand`, `--primary`, `--accent`)
4. Ship v0.6 audit Important items as production hardening (concurrency lock, screenshot size cap, doc refresh, fixture coverage, fallback clarity, CLI hygiene)
5. Render-pipeline polish: viewBox-aware logo scaling + BrandFetch local cache

**Tech stack:** Existing (Puppeteer + Node stdlib + Claude runtime multimodal Read tool). No new npm dependencies required. Uses Node's native `fs.promises.writeFile` with `wx` flag for lock files.

**Constraints (non-negotiable):**
- DO NOT break v0.6.1 — all existing scan outputs + brand-profile shapes must remain valid
- DO NOT touch render-v0.4.mjs, shared-render.mjs, patterns/, tokens/ — frozen surfaces (exception: viewBox scaling in C.1)
- DO NOT add npm deps
- BrandFetch stays opt-in (no regression on BYOK behavior)
- `--merge-with` must be idempotent (re-running with same inputs produces byte-identical output)
- Preserve the paper-aesthetic editorial-serif preset output — Niek's validated "engaging already" regression test

**Research inputs:**
- v0.6 verification transcript: Niek's hand-tuned profile (`examples/5-signs-overengineered/brand-profile.json`) uses JetBrains Mono display + `#29F2FE` cyan accent + noise-gradient — scan picked Inter + `#00BB7F` green + mesh. Same site, two brand identities.
- Audit REVIEW.md: 7 Important items (I1-I7) + 5 Minor items (M1-M5) still open post-v0.6.1.

---

## Phase A: Brand authorship — user-directed scan modes

Goal: give users three escape hatches when scan-and-synthesize misfires because their carousel brand diverges from their website surface.

### Task A.1 — `--merge-with <existing-profile>` flag

**Files:**
- Modify: `scripts/scan-site.mjs` (CLI arg parsing + mergeProfile helper)
- Modify: `prompts/brand-synthesis.md` (merge semantics)
- Modify: `commands/scan.md` (usage docs)
- Test: `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`

**Step 1: Write failing tests for merge semantics**

Add test cases asserting:
- `mergeProfile(existing, scan)` where existing has `fonts.display: "JetBrains Mono"` produces `JetBrains Mono` (existing wins)
- When existing has no `visual.colors.accent`, scan's accent flows through
- When existing has `visual.logo.file` pointing at user asset, scan's extracted logo is ignored
- When existing has `brand.tone` string, voice-niche's tone is ignored
- Field-level precedence, not whole-object — existing's colors win per-key (background from existing, accent from scan if existing doesn't specify)

**Step 2: Run tests to verify they fail**

```
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
```
Expected: FAIL with "mergeProfile is not defined"

**Step 3: Add `mergeProfile(existingProfile, scanDerivedProfile)` helper to `scripts/scan-site.mjs`**

Strategy: deep merge with "existing wins per leaf key." Preserve arrays as-is.

```javascript
function mergeProfile(existing, derived) {
  if (existing == null) return derived;
  if (derived == null) return existing;
  if (typeof existing !== 'object' || Array.isArray(existing)) return existing;
  const out = { ...derived };
  for (const key of Object.keys(existing)) {
    if (existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) {
      out[key] = mergeProfile(existing[key], derived?.[key]);
    } else if (existing[key] != null && existing[key] !== '') {
      out[key] = existing[key];
    }
  }
  return out;
}
```

**Step 4: Wire `--merge-with <path>` CLI flag**

Parse the flag, read the file after scan completes. Pass both existing + derived to synthesis stage via scan.json's new `mergeWith` field.

**Step 5: Document merge semantics in brand-synthesis.md**

Add a new section "Phase 0 — Merge with existing profile (if `--merge-with` was used)" before the source-priority section. Explain: existing non-null fields win, scan-derived fills gaps. Conflict resolution inside merged regions uses existing-wins.

**Step 6: Run tests to verify they pass**

Expected: PASS 57/57 (+ 4 new merge tests)

**Step 7: Smoke test end-to-end**

```
rm -rf /tmp/v07-merge-test
node scripts/scan-site.mjs https://nodeagency.ai /tmp/v07-merge-test --merge-with examples/5-signs-overengineered/brand-profile.json
```

Verify the resulting scan.json's merged-profile section has `fonts.display: "JetBrains Mono"` + `colors.accent: "#29F2FE"` + `background.type: "noise-gradient"` (all from existing) while scan-only fields (scannedAt, pagesScanned, warnings) are fresh.

**Step 8: Commit**

```
git add scripts/scan-site.mjs prompts/brand-synthesis.md commands/scan.md test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7): --merge-with flag — existing brand-profile fields win over scan-derived"
```

---

### Task A.2 — Per-context font extraction

**Files:**
- Modify: `scripts/scan-site.mjs` (page.evaluate captures multi-context computed styles)
- Modify: `scripts/extract-brand-signals.mjs` (expose fonts.byContext)
- Modify: `prompts/brand-synthesis.md` (prefer header/logo font for display)
- Test: `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`

**Step 1: Write failing test**

Fixture HTML with inline `<style>` that sets different font-family for header/nav/h1/body/button. Assert `signals.fonts.byContext = {header: "JetBrains Mono", nav: "Inter", h1: "Inter", body: "Inter", button: "JetBrains Mono"}`.

**Step 2: Add multi-context computed style capture**

In `scan-site.mjs`, extend the existing `page.evaluate` block that grabs body/h1/button computed styles. Add: `header`, `nav`, `a.btn`, `.logo` (if present), `.kicker`, `[class*="display"]`. Return structured object.

Pass these to extract-brand-signals.mjs via `computedStyles.byContext`.

**Step 3: Expose fonts.byContext in extractSignals return**

Existing `fonts.display` + `fonts.body` stay as convenience top-level fields (populated from `h1` and `body` respectively — same as v0.6). Add `fonts.byContext = {header, nav, h1, body, button, logo}` alongside.

**Step 4: Synthesizer heuristic**

In `prompts/brand-synthesis.md`: when picking `visual.fonts.display` for the brand-profile, prefer `fonts.byContext.header` or `fonts.byContext.logo` if present AND they differ from `fonts.byContext.h1` — because header/logo fonts are more "brand identity" than body-aligned h1.

Also: vision-analysis.json's observations often describe the display font style ("large sans-serif" vs "mono-styled"). If vision description contains "mono" / "technical" / "code-like" AND a mono font appears in `fonts.byContext.*`, prefer that mono font for display.

**Step 5: Run tests**

**Step 6: Smoke test**

Re-scan nodeagency.ai WITHOUT --merge-with. Check scan.json's `fonts.byContext` — should expose JetBrains Mono in at least one context (probably in kicker chips or code).

**Step 7: Commit**

```
git add scripts/scan-site.mjs scripts/extract-brand-signals.mjs prompts/brand-synthesis.md test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7): per-context font extraction — synthesizer prefers header/logo font for display"
```

---

### Task A.3 — CSS variable brand-color extraction

**Files:**
- Modify: `scripts/extract-brand-signals.mjs` (extractBrandVariables helper)
- Modify: `prompts/brand-synthesis.md` (brandVariables authoritative)
- Test: `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`

**Step 1: Write failing test**

Fixture HTML with `:root { --brand: #29F2FE; --primary: #0B8AEE; --accent: #29F2FE; }`. Assert `signals.colors.brandVariables = {brand: "#29F2FE", primary: "#0B8AEE", accent: "#29F2FE"}`.

**Step 2: Implement `extractBrandVariables(cssText)`**

```javascript
function extractBrandVariables(cssText) {
  const vars = {};
  const re = /--(brand[a-z-]*|primary[a-z-]*|accent[a-z-]*|bg[a-z-]*|fg[a-z-]*|text[a-z-]*)\s*:\s*([^;}{]+?)(?=[;}])/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const name = m[1].toLowerCase();
    const normalized = normalizeColor(m[2].trim());
    if (normalized) vars[name] = normalized;
  }
  return vars;
}
```

Add `colors.brandVariables = extractBrandVariables(cssDump)` to the `extractSignals` return.

**Step 3: Synthesizer uses brandVariables as authoritative accent**

In `prompts/brand-synthesis.md`, update accent picking: if `colors.brandVariables.brand` OR `.primary` OR `.accent` is set, prefer that over frequency-ranked accent. Document the priority explicitly.

**Step 4: Run tests**

**Step 5: Smoke test — re-scan a site with known `--brand` declaration (e.g. Vercel, Stripe)**

Verify `colors.brandVariables` is populated.

**Step 6: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7): CSS variable brand-color extraction — --brand/--primary/--accent authoritative"
```

---

### Task A.4 — `--preset <name>` force flag

**Files:**
- Modify: `scripts/scan-site.mjs` (CLI arg)
- Modify: `prompts/brand-synthesis.md` (skip preset matching when forced)
- Modify: `commands/scan.md` (usage)

**Step 1: Add CLI parsing**

Parse `--preset <name>` flag. Validate against 6 known preset names (editorial-serif, neo-grotesk, technical-mono, display-serif-bold, utilitarian-bold, satoshi-tech). Error if unknown.

**Step 2: Write `forcedPreset` into scan.json**

Add `forcedPreset: "technical-mono"` at top level of scan.json when flag used. Synthesizer reads this and short-circuits preset matching — the forced preset becomes `visual.preset` directly.

**Step 3: Update brand-synthesis.md**

Add section: "If `scan.forcedPreset` is set, use it as `visual.preset` directly. Skip the weighted-signal matching entirely. Still run all other overrides (colors, fonts, logo, tone) as normal." Document the 6 valid names.

**Step 4: Smoke test**

```
node scripts/scan-site.mjs https://nodeagency.ai /tmp/v07-preset-forced --preset technical-mono
```

Confirm scan.json has `forcedPreset: "technical-mono"`.

**Step 5: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7): --preset <name> force flag — skip synthesizer's weighted-signal matching"
```

---

### Task A.5 — Interactive candidate picker (DEFERRED to v0.7.1)

Explicitly deferred. Complex terminal UI for interactive confirmation after synthesis. Covered by A.1 + A.4 for the v0.7 user — they can `--merge-with` or `--preset` to bypass bad auto-picks. Add a one-line mention in commands/scan.md that interactive mode is planned for v0.7.1.

---

## Phase B: v0.6 audit Important items

Goal: ship the 7 Important items from the v0.6 audit as production hardening.

### Task B.1 — Concurrency lock on outDir (audit I1)

**Files:**
- Modify: `scripts/scan-site.mjs`

**Step 1: Write test**

Spawn two scan-site subprocesses in parallel writing to the same outDir. Expected: the second one errors cleanly with "scan already in progress, lock at /path/.scan.lock"; exit code non-zero.

**Step 2: Implement lock acquisition**

```javascript
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function acquireLock(outDir) {
  const lockPath = join(outDir, '.scan.lock');
  try {
    writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}\n`, { flag: 'wx' });
    return () => { try { unlinkSync(lockPath); } catch {} };
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`Scan already in progress at ${lockPath}. Delete the lock file if the previous scan crashed.`);
    }
    throw err;
  }
}
```

Wrap the main scan flow; release lock in finally AND on SIGINT.

**Step 3: Smoke test**

Two parallel scans to same outDir — second errors. No partial corruption.

**Step 4: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "fix(v0.7): scan-site.mjs acquires .scan.lock per outDir (I1)"
```

---

### Task B.2 — Full-page screenshot size cap (audit I2)

**Files:**
- Modify: `scripts/scan-site.mjs` (scanPage screenshot block)

**Step 1: Implement**

Cap fullPage screenshot at `height: 8000` px. Puppeteer's `page.screenshot({fullPage: true})` doesn't accept a max-height flag, so switch to `clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: Math.min(bodyHeight, 8000) }`. Get `bodyHeight` via `page.evaluate(() => Math.min(document.body.scrollHeight, document.documentElement.scrollHeight))`.

If clipped, push a warning: `"[screenshot] full.png clipped at 8000px (original ${bodyHeight}px)"`.

**Step 2: Smoke test**

Scan a long marketing page (e.g. https://stripe.com/payments). Confirm `full.png < 10MB` and warning fires when site >8000px tall.

**Step 3: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "fix(v0.7): cap full-page screenshot at 8000px (I2)"
```

---

### Task B.3 — `docs/adding-templates.md` refresh (audit I3)

**Files:**
- Modify: `docs/adding-templates.md`

**Step 1: Read current state**

Lines 7, 82, 135, 163 reference `scripts/render.mjs` + `templates/<name>.svg`. This is v0.3 architecture. Current (v0.4+) uses `scripts/render-v0.4.mjs` + `patterns/<name>.svg` + `patterns/manifest.json`.

**Step 2: Rewrite**

Update all references. Add a note at top: "Templates are now called 'patterns' in v0.4+. The old v0.3 template system is frozen and not extended." Include correct pattern registration: add SVG to `patterns/`, add entry to `patterns/manifest.json`, add strategy guidance to `prompts/strategy-system.md`.

**Step 3: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "docs(v0.7): refresh adding-templates.md for v0.4+ patterns architecture (I3)"
```

---

### Task B.4 — extractLogo fixture coverage (audit I4)

**Files:**
- Create: `test/fixtures/logo-fixtures/inline-svg-logo.html`
- Create: `test/fixtures/logo-fixtures/img-logo.html`
- Create: `test/fixtures/logo-fixtures/favicon-only.html`
- Create: `test/fixtures/logo-fixtures/no-logo.html`
- Modify: `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`

**Step 1: Refactor or mock page**

Simplest: refactor `extractLogo` to accept a pre-parsed HTML string instead of Puppeteer page. Then unit-test against parsed fixtures.

OR: write a thin mock-page shim that returns canned `page.evaluate` outputs for each fixture.

**Step 2: Write 4 tests**

Each fixture tests a different branch: inline-svg wins, img wins when no inline-svg, favicon wins when no header-img, `{type: 'none'}` when all fail.

**Step 3: Run tests + commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "test(v0.7): extractLogo fixture coverage for all 4 fallback branches (I4)"
```

---

### Task B.5 — `extract-logo.mjs` fallback flag (audit I5)

**Files:**
- Modify: `scripts/extract-logo.mjs`
- Modify: `scripts/scan-site.mjs` (CLI output)
- Modify: `prompts/brand-synthesis.md`

**Step 1: Add `fallback: boolean` to return descriptor**

When `extractLogo` returns `type: 'favicon'` AFTER trying inline-svg + img and getting nothing, set `fallback: true`. When inline-svg or img wins on first try, `fallback: false`.

**Step 2: CLI output line**

Update scan-site.mjs log to: `logo: inline-svg (real logo)` or `logo: favicon (fallback — no real logo found on page)`.

**Step 3: Synthesizer behavior**

In brand-synthesis.md: if `logo.fallback === true`, treat as LOW confidence for logo. Mention in brand-profile output as `visual.logo.source: "favicon-fallback"` (new optional field). Downstream render logic unchanged.

**Step 4: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "fix(v0.7): flag favicon logos as fallback so synthesizer treats them with lower confidence (I5)"
```

---

### Task B.6 — Confidence threshold user guide (audit I6)

**Files:**
- Create: `docs/confidence-guide.md`
- Modify: `commands/scan.md` (link to guide)
- Modify: `README.md` (link to guide)

**Step 1: Write `docs/confidence-guide.md`**

Plain-English guide listing:
- **0.85-1.0 ("great")** — scan confidently detected your brand; synthesizer's output should be close to right. Tune colors if needed.
- **0.65-0.85 ("good")** — scan caught most signals; review fonts + accent color before publishing. Consider `--merge-with` your existing profile.
- **0.45-0.65 ("iffy")** — scan is missing signal. Strongly recommend `--merge-with` or `--preset`. Check warnings array.
- **< 0.45 ("bail")** — scan failed. Run `/node-carousel:setup` wizard instead.

Include a decision tree flow: read confidence → apply actions.

**Step 2: Link from commands/scan.md after the scan runs**

The CLI output currently prints `confidence: 0.9`. Append: `See docs/confidence-guide.md for what to do at your confidence level.`

**Step 3: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "docs(v0.7): confidence threshold user guide (I6)"
```

---

### Task B.7 — `--help` on scan-site.mjs (audit I7)

**Files:**
- Modify: `scripts/scan-site.mjs`

**Step 1: Implement**

Add `--help` / `-h` detection at the top of main(). Print usage with all flags + env vars + examples. Exit 0.

Examples block should show:
- vanilla scan
- --merge-with usage
- --preset usage
- BRANDFETCH_API_KEY env var mention

**Step 2: Smoke test**

```
node scripts/scan-site.mjs --help
```

**Step 3: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "feat(v0.7): --help / -h on scan-site.mjs (I7)"
```

---

## Phase C: Render-quality polish

Goal: the two Minor items that affect visible output quality.

### Task C.1 — Logo viewBox-aware scaling (audit M1)

**Files:**
- Modify: `scripts/render-v0.4.mjs` (resolveLogo function, scale computation)

**Step 1: Read current**

`render-v0.4.mjs:469-474` does `scale = size / 24` assuming 24x24 viewBox. Real logos are rarely 24x24 — scan-extracted SVGs from headers are often 100x24 or 200x50.

**Step 2: Implement viewBox parsing**

```javascript
function parseViewBox(svgText) {
  const m = svgText.match(/viewBox\s*=\s*["']([\d.\s-]+)["']/i);
  if (!m) return { width: 24, height: 24 };
  const parts = m[1].split(/\s+/).map(Number);
  if (parts.length === 4) return { width: parts[2], height: parts[3] };
  return { width: 24, height: 24 };
}
```

Then: `scale = size / Math.max(viewBox.width, viewBox.height)` — this fits the logo's longest edge to the requested `size` (default 48).

**Step 3: Test**

Render with Niek's hand-tuned profile (editorial-serif paper preset) — paper-aesthetic regression test. Logo should be visible, not tiny + not overflowing.

**Step 4: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "fix(v0.7): logo scaling respects source viewBox — longest edge = brand.visual.logo.size (M1)"
```

---

### Task C.2 — BrandFetch local cache (audit M5)

**Files:**
- Modify: `scripts/brandfetch-client.mjs`

**Step 1: Implement**

Cache responses to `~/.cache/node-carousel/brandfetch-<domain>.json` for 24h. On cache hit within TTL, return cached normalized payload without network call. On cache miss or expiry, fetch + write.

```javascript
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = join(homedir(), '.cache', 'node-carousel');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readCache(domain) {
  try {
    const path = join(CACHE_DIR, `brandfetch-${domain}.json`);
    const age = Date.now() - statSync(path).mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(domain, data) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, `brandfetch-${domain}.json`), JSON.stringify(data));
  } catch {
    // cache is best-effort
  }
}
```

Wire into `brandfetch()` — read cache first, fetch on miss.

**Step 2: Test**

Run two scans of the same domain within a minute. Second one should report `brandfetch.cached: true` without network call.

**Step 3: Commit**

```
git -c user.email=niek@nodeagency.ai -c user.name="Niek Huggers" commit -m "fix(v0.7): BrandFetch 24h local cache at ~/.cache/node-carousel/ (M5)"
```

---

## Phase D: Ship v0.7.0

### Task D.1 — Regression battery

**Files:** None (just running)

Commands:
```
cd "/Users/niekhuggers/Dropbox/Niek/Node Agency/04 - Fun Builds/node-carousel"

# Fixtures
node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs

# Scan 1: Node with --merge-with (Niek's use case)
rm -rf /tmp/v07-ship-node
node scripts/scan-site.mjs https://nodeagency.ai /tmp/v07-ship-node --merge-with examples/5-signs-overengineered/brand-profile.json

# Scan 2: Vercel vanilla (semantic site)
rm -rf /tmp/v07-ship-vercel
node scripts/scan-site.mjs https://vercel.com /tmp/v07-ship-vercel

# Scan 3: Forced preset
rm -rf /tmp/v07-ship-forced
node scripts/scan-site.mjs https://nodeagency.ai /tmp/v07-ship-forced --preset technical-mono

# Scan 4: Long page (screenshot cap test)
rm -rf /tmp/v07-ship-long
node scripts/scan-site.mjs https://stripe.com/payments /tmp/v07-ship-long

# Paper-aesthetic regression render (Niek's winning output)
rm -rf /tmp/v07-ship-paper
node scripts/render-v0.4.mjs examples/2-minute-crm-audit/brand-profile.json examples/2-minute-crm-audit/strategy.json /tmp/v07-ship-paper
node scripts/preview.mjs /tmp/v07-ship-paper
```

Verify in report:
- Fixtures (57+ target, actual count depends on how many A/B tests add)
- --merge-with Node: brand-profile has JetBrains Mono + cyan (not Inter + green)
- --merge-with doesn't corrupt existing hand-tuned values
- Forced preset honored in output
- Screenshot cap fires on Stripe if >8000px
- Lock contention correctly errors
- Paper render still looks right (open preview + describe)

### Task D.2 — README v0.7 callout

**Files:**
- Modify: `README.md`

Update the "Quick start" block to show `--merge-with` and `--preset` flags. Add one paragraph explaining when carousel brand differs from website brand (reference Niek's own pattern as an example).

Refresh the "What's planned (v0.6)" section to "What's new (v0.7)" — move v0.7 items into "What's new (v0.7)" bullets.

### Task D.3 — Version bump

**Files:**
- Modify: `.claude-plugin/plugin.json` → `"version": "0.7.0"`
- Modify: `scripts/package.json` → `"version": "0.7.0"`

### Task D.4 — Tag + push

Commands (user approves after regression battery passes):
```
git tag -a v0.7.0 -m "v0.7.0 — Brand Authorship"
git push origin main
git push origin v0.7.0
gh release create v0.7.0 --title "v0.7.0 — Brand Authorship" --notes "..."
```

DO NOT push automatically.

---

## Success criteria

- [ ] `--merge-with` on nodeagency.ai with Niek's hand-tuned profile produces brand-profile.json with JetBrains Mono display + `#29F2FE` cyan accent + noise-gradient bg (not scan-picked Inter/green/mesh)
- [ ] `--preset technical-mono` on nodeagency.ai produces brand-profile with `visual.preset: "technical-mono"` regardless of auto-match score
- [ ] Per-context fonts populated: scan.json has `fonts.byContext.{header, nav, h1, body, button}`
- [ ] CSS variable brand colors captured in `colors.brandVariables`
- [ ] Concurrent scans to same outDir: second errors cleanly with lock message
- [ ] Screenshot cap: long pages produce `full.png < 10MB` with clipping warning
- [ ] Logo viewBox scaling: visual check renders logos at correct size regardless of source viewBox
- [ ] BrandFetch 24h cache: second identical-domain scan reports `cached: true` without network
- [ ] Paper-aesthetic render (`editorial-serif` preset) still looks right — no regression from v0.6.1
- [ ] All existing fixture tests pass + new fixtures for merge-profile, per-context-fonts, brand-vars, logo branches
- [ ] 2-minute visual check on preview.html for v0.7 rendered carousels

## Scope boundary — what's v0.7 vs v0.7.1+

**In v0.7 (this plan):**
- `--merge-with` flag
- `--preset` flag
- Per-context font extraction
- CSS variable brand-color extraction
- .scan.lock concurrency
- Screenshot size cap (8000px)
- Logo viewBox-aware scaling
- BrandFetch 24h cache
- extractLogo fixture coverage
- Fallback flag on favicon logos
- docs/confidence-guide.md
- docs/adding-templates.md refresh
- --help CLI hygiene
- README v0.7 callout

**Deferred to v0.7.1+:**
- Interactive candidate picker after synthesis (complex terminal UI)
- Archive.org snapshot comparison (brand evolution tracking)
- Instagram/social profile scraping (actual social content matching)
- Competitor intelligence (given niche, compare against top N brands)
- Accessibility validation (WCAG contrast ratios, palette auto-correction)
- Multi-URL batch scanning
- Deep image color extraction from hero photography
- Wordmark vs symbol vs logomark classification
- Bundled grunge texture PNGs (long-deferred since v0.4)
- Broader icon library 30 → 100+ (long-deferred since v0.4)
- Gemini-generated AI backgrounds (long-deferred since v0.4)
- Tables + bar-chart patterns (long-deferred since v0.4)

## Parallelism opportunities

- Phase A tasks A.1 (scan-site.mjs CLI), A.2 (extract-brand-signals.mjs fonts), A.3 (extract-brand-signals.mjs colors), A.4 (scan-site.mjs CLI) share some files. Run A.1 first (scaffolds the --merge-with plumbing), then A.2 + A.3 parallel (different functions in extract-brand-signals), then A.4 (small CLI add).
- Phase B tasks B.3 (docs), B.4 (tests), B.6 (docs) are all isolated files — parallel-safe.
- Phase B tasks B.1 (scan-site.mjs main flow), B.2 (scan-site.mjs screenshot), B.5 (extract-logo.mjs + scan-site.mjs + synthesizer), B.7 (scan-site.mjs CLI) touch scan-site.mjs — serialize.
- Phase C tasks C.1 (render-v0.4.mjs) + C.2 (brandfetch-client.mjs) are independent — parallel.

Build order:
1. **Wave 1:** A.1 (merge-with scaffold)
2. **Wave 2 parallel:** A.2 + A.3 + B.3 + B.4 + B.6 + C.2 (6 agents, no file overlap)
3. **Wave 3:** A.4 + B.1 + B.2 + B.5 + B.7 (scan-site.mjs serial) + C.1 (render-v0.4.mjs, independent)
4. **Wave 4:** D — ship

Estimated total: ~8 hours of agent work. Wall-clock with 6-parallel wave 2 ≈ 3-4 hours.

## Process rules (non-negotiable)

1. **Paper-aesthetic regression render at every phase gate** — editorial-serif preset with noise-gradient grit on cream is Niek's validated "engaging" recipe. Open `examples/2-minute-crm-audit/` preview at end of each phase to confirm no visual regression.
2. **Real-URL test with --merge-with at Phase A completion** — before Phase B, confirm the Niek use case (JetBrains Mono + cyan) actually materializes in rendered output.
3. **Zero new npm deps** — stdlib only.
4. **BrandFetch stays opt-in** — cache behavior must not activate without API key present.
5. **Backwards compat check at each commit** — existing hand-tuned brand-profiles (`examples/*/brand-profile.json`) must render byte-identically on v0.7 renderer as they did on v0.6.1.
6. **Lock file cleanup** — any scan that writes .scan.lock must delete it on normal exit AND on SIGINT. Use `process.on('SIGINT', cleanup)`.
