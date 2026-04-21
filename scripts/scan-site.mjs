#!/usr/bin/env node
// scan-site.mjs — v0.6 multi-page scan infrastructure.
//
// CLI:
//   node scripts/scan-site.mjs <url> <output-dir>
//
// Produces (in <output-dir>):
//   - hero.png     — homepage viewport screenshot at 1440x900
//   - full.png     — homepage full-page screenshot at 1440 wide
//   - page.html    — homepage rendered HTML snapshot
//   - styles.css   — homepage aggregated CSS dump (stylesheets + computed styles)
//   - scan.json    — the brand-signals contract (multi-page shape, see below)
//
// scan.json shape (v0.6):
// {
//   url, scannedAt,
//   pagesScanned: ["/", "/about", "/work"],
//   perPage: { "/": { fonts, colors, meta, textSamples, warnings }, ... },
//   merged:  { fonts, colors, meta, textSamples, warnings, pageHeadlines },
//   // v0.5 backwards-compat mirror — merged.* also at top level:
//   fonts, colors, meta, textSamples, warnings,
//   screenshots: { hero, full }
// }
//
// Graceful failure modes:
//   - URL blocked by headless detection -> retry with headless=false, else
//     write partial scan.json with warning.
//   - Homepage navigation timeout (15s per page, ~45s total wall-clock) ->
//     write partial with warning.
//   - A discovered page fails -> warning, keep the rest.
//   - 404 / DNS fail on homepage -> scan.json with `error` field set; exit 0.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSignals, clusterColors } from './extract-brand-signals.mjs';
import { extractLogo } from './extract-logo.mjs';
import { brandfetch, extractDomain } from './brandfetch-client.mjs';

const PAGE_TIMEOUT_MS = 15000;       // per-page goto timeout
const TOTAL_WALL_CLOCK_MS = 45000;   // whole scan soft-cap (plan said 20s total, which is too tight with 3 pages; 15s/page x 3 + headroom)
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;
const MAX_DISCOVERED_PAGES = 2;      // home + 2 = 3 total
const MAX_CTA_CANDIDATES = 10;

function usage() {
  console.error('Usage: node scripts/scan-site.mjs <url> <output-dir> [--merge-with <existing-brand-profile.json>]');
  process.exit(1);
}

/**
 * Parse scan-site CLI argv. Accepts:
 *   - positional: <url> <output-dir>
 *   - optional:   --merge-with <path>
 *
 * Returns `{ url, outDir, mergeWithPath }` or null when required args are
 * missing. Exported-flavored: internal helper, but pure + deterministic so
 * tests can exercise it directly if needed.
 */
function parseArgv(argv) {
  const positional = [];
  let mergeWithPath = null;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--merge-with') {
      mergeWithPath = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (a && a.startsWith('--merge-with=')) {
      mergeWithPath = a.slice('--merge-with='.length) || null;
      continue;
    }
    positional.push(a);
  }
  const [urlArg, outArg] = positional;
  if (!urlArg || !outArg) return null;
  return { urlArg, outArg, mergeWithPath };
}

function normalizeUrl(input) {
  if (!input) return null;
  if (/^[a-z]+:\/\//i.test(input)) return input; // already has a scheme
  return `https://${input}`;
}

function writeScan(outDir, payload) {
  writeFileSync(join(outDir, 'scan.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// ---------------- Page discovery ----------------

// Priority rules: lower number = higher priority. See task plan.
const DISCOVERY_RULES = [
  { priority: 1, patterns: [/^\/about(\/|$|-us\b)/i, /^\/team\/?$/i] },
  { priority: 2, patterns: [/^\/pricing\/?$/i, /^\/plans\/?$/i] },
  { priority: 3, patterns: [/^\/blog(\/|$)/i, /^\/journal(\/|$)/i, /^\/writing(\/|$)/i] },
  { priority: 4, patterns: [/^\/services\/?$/i, /^\/what-we-do\/?$/i] },
];

/**
 * Score a single path against DISCOVERY_RULES. Returns the best (lowest) priority
 * found, or null if no rule matches.
 */
function scorePath(pathname) {
  for (const rule of DISCOVERY_RULES) {
    for (const re of rule.patterns) {
      if (re.test(pathname)) return rule.priority;
    }
  }
  return null;
}

/**
 * Pure helper: given an array of hrefs (absolute or relative), a base URL,
 * and a homepage path, return up to MAX_DISCOVERED_PAGES distinct paths
 * ranked by DISCOVERY_RULES priority. Exported implicitly so the fixture test
 * can exercise it without spinning up Puppeteer.
 */
export function rankDiscoveredLinks(hrefs, baseUrl, { max = MAX_DISCOVERED_PAGES } = {}) {
  const base = new URL(baseUrl);
  const basePath = base.pathname === '' ? '/' : base.pathname;
  const seen = new Map(); // path -> priority

  for (const raw of hrefs) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    // Reject non-http schemes, anchors, etc.
    if (/^(#|mailto:|tel:|javascript:)/i.test(trimmed)) continue;

    let abs;
    try {
      abs = new URL(trimmed, base);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (abs.host !== base.host) continue;

    let pathname = abs.pathname || '/';
    // Normalize trailing slash (except root) so "/about" and "/about/" merge.
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }
    // Skip the homepage itself.
    if (pathname === basePath || pathname === '/' || pathname === '') continue;

    const priority = scorePath(pathname);
    if (priority == null) continue;

    // Keep best (lowest) priority for a given path.
    const prev = seen.get(pathname);
    if (prev == null || priority < prev) seen.set(pathname, priority);
  }

  // Sort by priority ascending, then alphabetically as a deterministic tie-break.
  const ranked = Array.from(seen.entries())
    .sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
    .map(([path]) => path);

  return ranked.slice(0, max);
}

/**
 * Common nav-label heuristic for viewport-based fallback. Short lowercase
 * words that typically mark a navigation link in Framer/React/Next.js sites
 * where semantic <nav> / <header> wrappers may be absent.
 */
const NAV_LABEL_WORDS = new Set([
  'work', 'projects', 'portfolio', 'case studies', 'cases',
  'about', 'team', 'company',
  'pricing', 'plans',
  'contact', 'get in touch',
  'blog', 'journal', 'writing', 'insights', 'articles',
  'services', 'what we do', 'process', 'how it works',
  'features', 'product',
]);

/**
 * Score a link text for nav-likeness. Lower is better (treated like priority).
 * Short, lowercase, single-word or common-nav-label text wins over long URLs
 * or generic "Read more" strings.
 */
function scoreLinkText(text) {
  if (!text || typeof text !== 'string') return Infinity;
  const t = text.trim().toLowerCase();
  if (!t) return Infinity;
  // Generic junk — push to the bottom.
  if (/^(read more|learn more|view|see more|click here|more)$/i.test(t)) return 100;
  if (NAV_LABEL_WORDS.has(t)) return 1;
  // 1-3 word short phrases are likely nav labels.
  const wordCount = t.split(/\s+/).length;
  if (wordCount <= 2 && t.length <= 20) return 5;
  if (wordCount <= 3 && t.length <= 30) return 10;
  return 50;
}

/**
 * Pure helper: rank viewport-visible links (from fallback) by priority-path
 * rules first (/about etc.), then by link-text heuristic. Same {max} cap.
 * Exported for potential test use.
 */
export function rankViewportLinks(candidates, baseUrl, { max = MAX_DISCOVERED_PAGES } = {}) {
  const base = new URL(baseUrl);
  const basePath = base.pathname === '' ? '/' : base.pathname;
  // path -> { priority, textScore, text }
  const seen = new Map();

  for (const cand of candidates) {
    if (!cand || !cand.href) continue;
    const raw = String(cand.href).trim();
    if (!raw) continue;
    if (/^(#|mailto:|tel:|javascript:)/i.test(raw)) continue;

    let abs;
    try {
      abs = new URL(raw, base);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (abs.host !== base.host) continue;

    let pathname = abs.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '');
    }
    if (pathname === basePath || pathname === '/' || pathname === '') continue;

    const priority = scorePath(pathname); // null if not in DISCOVERY_RULES
    const textScore = scoreLinkText(cand.text);
    // Skip links that are neither a priority-path match nor a recognizable
    // nav label. textScore 50+ with null priority = long random link text.
    if (priority == null && textScore >= 50) continue;

    const prev = seen.get(pathname);
    const entry = { priority: priority ?? 99, textScore, text: cand.text || '' };
    if (!prev
      || entry.priority < prev.priority
      || (entry.priority === prev.priority && entry.textScore < prev.textScore)) {
      seen.set(pathname, entry);
    }
  }

  const ranked = Array.from(seen.entries())
    .sort((a, b) => {
      if (a[1].priority !== b[1].priority) return a[1].priority - b[1].priority;
      if (a[1].textScore !== b[1].textScore) return a[1].textScore - b[1].textScore;
      return a[0].localeCompare(b[0]);
    })
    .map(([path]) => path);

  return ranked.slice(0, max);
}

/**
 * Extract nav/footer hrefs from an already-loaded Puppeteer page, then rank.
 * Returns at most MAX_DISCOVERED_PAGES paths.
 *
 * Returns `{ paths, usedFallback }` so the caller can emit the viewport-
 * fallback warning when semantic selectors produced nothing.
 */
async function discoverPages(page, baseUrl) {
  let hrefs = [];
  try {
    hrefs = await page.evaluate(() => {
      const anchors = document.querySelectorAll(
        'header a[href], nav a[href], footer a[href]',
      );
      return Array.from(anchors)
        .map((a) => a.getAttribute('href'))
        .filter(Boolean);
    });
  } catch {
    hrefs = [];
  }
  const paths = rankDiscoveredLinks(hrefs, baseUrl);
  if (paths.length > 0) {
    return { paths, usedFallback: false };
  }

  // ---- Fallback: viewport-based scan ----
  // JS-rendered sites (Framer / Next.js / React) often render nav inside
  // generic <div>s with no <header>/<nav> semantics. Scan every <a href>
  // that's either near the top of the viewport (above-the-fold nav) or
  // near the top of the footer region (bottom nav).
  let candidates = [];
  try {
    candidates = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const vh = window.innerHeight || 900;
      const out = [];
      for (const a of anchors) {
        const r = a.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const topOfViewport = r.top >= 0 && r.top < 120;
        // Footer top 40px: last ~40px of the document's natural flow. We
        // approximate with any link whose bottom is within 40px of the
        // scrollable document's end.
        const docH = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        );
        const absBottom = r.bottom + window.scrollY;
        const nearFooter = docH - absBottom < 40 && r.height < vh;
        if (!topOfViewport && !nearFooter) continue;
        const href = a.getAttribute('href');
        if (!href) continue;
        // innerText is the visible text as rendered (drops hidden nodes).
        const text = (a.innerText || a.textContent || '').trim();
        out.push({ href, text });
      }
      return out;
    });
  } catch {
    candidates = [];
  }
  const fallbackPaths = rankViewportLinks(candidates, baseUrl);
  return { paths: fallbackPaths, usedFallback: true };
}

// ---------------- Per-page scanning ----------------

/**
 * Scan a single page with an already-open Puppeteer Page instance.
 * `isHomepage` controls whether we write screenshots + html + css to disk.
 */
async function scanPage({ page, url, outDir, isHomepage, warnings }) {
  let response;
  try {
    response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: PAGE_TIMEOUT_MS,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    if (/Navigation timeout/i.test(msg) || /timeout/i.test(msg)) {
      warnings.push(`navigation timeout for ${url}: continuing with partial content (${msg})`);
    } else {
      return { ok: false, reason: `navigation_failed: ${msg}` };
    }
  }

  if (response && !response.ok() && response.status() !== 304) {
    warnings.push(`HTTP ${response.status()} for ${url} — page may be partial`);
  }

  // Give fonts/JS a moment to settle
  try {
    await page.evaluate(() => document.fonts && document.fonts.ready);
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 600));

  // Only the homepage writes its assets to disk (screenshots / html / css).
  // Track screenshot success so the caller can surface null paths when they fail
  // (see Issue 4 in the B.1 code review — don't publish paths to files that
  // don't exist on disk).
  let heroOk = false;
  let fullOk = false;
  let heroPath = null;
  let fullPath = null;
  if (isHomepage) {
    heroPath = join(outDir, 'hero.png');
    fullPath = join(outDir, 'full.png');
    try {
      await page.screenshot({
        path: heroPath,
        type: 'png',
        clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
      heroOk = true;
    } catch (err) {
      warnings.push(`hero screenshot failed: ${err?.message || err}`);
    }
    try {
      await page.screenshot({ path: fullPath, type: 'png', fullPage: true });
      fullOk = true;
    } catch (err) {
      warnings.push(`full screenshot failed: ${err?.message || err}`);
    }
  }

  // After a goto timeout the frame may be detached — calling page.content()
  // or page.evaluate() then throws "Execution context was destroyed" which
  // would bubble up to attemptScan's catch and mark the whole scan runtime_failed.
  // Instead, degrade gracefully: empty html + empty CSS bundle. extractSignals
  // handles empty input already and will produce null-ish signals, which then
  // triggers the empty-extraction retry in main() (see Issue 1).
  let html = '';
  try {
    html = await page.content();
  } catch (err) {
    warnings.push(`page.content() failed: ${err?.message || err}`);
  }

  let cssBundle = {
    stylesheetsText: [],
    body: '',
    h1: '',
    button: '',
    rootVars: '',
    byContext: {
      header: null,
      nav: null,
      h1: null,
      body: null,
      button: null,
      logo: null,
      kicker: null,
      displayEl: null,
    },
  };
  try {
    cssBundle = await page.evaluate(() => {
      const out = {
        stylesheetsText: [],
        body: '',
        h1: '',
        button: '',
      };

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          for (const rule of Array.from(rules)) {
            if (rule.cssText) out.stylesheetsText.push(rule.cssText);
          }
        } catch {
          // Cross-origin stylesheets throw — skip.
        }
      }

      const snapshotStyle = (el) => {
        if (!el) return '';
        const cs = getComputedStyle(el);
        const props = [
          'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
          'color', 'background-color', 'fill', 'stroke',
          'border-color', 'border-radius',
          'padding', 'margin',
        ];
        return props.map((p) => `${p}: ${cs.getPropertyValue(p)};`).join(' ');
      };

      out.body = snapshotStyle(document.body);
      out.h1 = snapshotStyle(document.querySelector('h1'));
      out.button = snapshotStyle(document.querySelector('button, a.btn, [role="button"]'));

      // v0.7 A.2 — Per-context font extraction. Capture computed styles for
      // 8 named contexts so extractSignals can build a fonts.byContext map.
      // Each slot is explicit `null` when the selector found no element, so
      // downstream can distinguish "checked and nothing found" from "didn't
      // try". When an element exists but has no font-family override, its
      // snapshotStyle returns the inherited (body's) font — that's expected
      // and means no context-specific override was declared.
      const byContext = {
        header: null,
        nav: null,
        h1: null,
        body: null,
        button: null,
        logo: null,
        kicker: null,
        displayEl: null,
      };

      // Safe querySelector — some selectors might throw on certain edge cases
      // (invalid attribute syntax etc.); we wrap each independently so one
      // failure doesn't lose the rest.
      const safeQuery = (selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      };

      const headerEl = safeQuery('header');
      const navEl = safeQuery('nav');
      const h1El = document.querySelector('h1');
      const buttonEl = document.querySelector('a.btn, button, [role="button"]');
      // Exclude SVG because getComputedStyle on SVGElements is less useful
      // for font-family and .logo is commonly a wrapper div/span.
      const logoEl = safeQuery('.logo, [class*="logo" i]:not(svg):not(img)');
      const kickerEl = safeQuery('.kicker, [class*="kicker" i]');
      const displayElNode = safeQuery('[class*="display" i]');

      byContext.header = snapshotStyle(headerEl) || null;
      byContext.nav = snapshotStyle(navEl) || null;
      byContext.h1 = snapshotStyle(h1El) || null;
      byContext.body = snapshotStyle(document.body) || null;
      byContext.button = snapshotStyle(buttonEl) || null;
      byContext.logo = snapshotStyle(logoEl) || null;
      byContext.kicker = snapshotStyle(kickerEl) || null;
      byContext.displayEl = snapshotStyle(displayElNode) || null;

      out.byContext = byContext;

      const rootStyle = getComputedStyle(document.documentElement);
      const rootVars = [];
      for (let i = 0; i < rootStyle.length; i += 1) {
        const name = rootStyle.item(i);
        if (name.startsWith('--')) {
          const val = rootStyle.getPropertyValue(name).trim();
          rootVars.push(`${name}: ${val};`);
        }
      }
      out.rootVars = rootVars.join('\n');

      return out;
    });
  } catch (err) {
    warnings.push(`CSS bundle extraction failed: ${err?.message || err}`);
  }

  const cssDump = [
    '/* --- stylesheets --- */',
    cssBundle.stylesheetsText.join('\n'),
    '',
    '/* --- computed body --- */',
    `body { ${cssBundle.body} }`,
    '/* --- computed h1 --- */',
    `h1 { ${cssBundle.h1} }`,
    '/* --- computed button --- */',
    `button { ${cssBundle.button} }`,
    '',
    '/* --- root custom properties --- */',
    `:root { ${cssBundle.rootVars} }`,
  ].join('\n');

  if (isHomepage) {
    writeFileSync(join(outDir, 'page.html'), html, 'utf8');
    writeFileSync(join(outDir, 'styles.css'), cssDump, 'utf8');
  }

  const signals = extractSignals({
    html,
    computedStyles: {
      body: cssBundle.body,
      h1: cssBundle.h1,
      button: cssBundle.button,
      cssDump,
      byContext: cssBundle.byContext || null,
    },
    url,
  });

  return {
    ok: true,
    signals,
    screenshotPaths: {
      hero: heroOk ? heroPath : null,
      full: fullOk ? fullPath : null,
    },
  };
}

// ---------------- Profile merge (v0.7 A.1) ----------------

/**
 * Deep-merge two brand-profile-shaped objects with "existing wins per leaf key"
 * precedence. Returns a fresh object; inputs are not mutated.
 *
 * Algorithm:
 *   - If either side is null/undefined, return the other.
 *   - Non-object (or array) `existing` wins whole — we never per-index merge
 *     arrays (e.g. `tags`, `allColors`) because partial overlays would change
 *     semantics unpredictably.
 *   - For plain-object `existing`: start from `derived` as the base, then walk
 *     `existing`'s keys. If a key's existing value is another plain object,
 *     recurse. Otherwise, the existing value wins IFF it's not null and not an
 *     empty string. Explicit `null` or `""` in existing is treated as "let
 *     derived fill this slot" — users can wipe an inherited value by setting
 *     it to null.
 *
 * Why "existing wins": the user's hand-tuned `brand-profile.json` represents
 * their real social identity. The scan is an approximation of their marketing
 * site. When they differ, the user is right.
 *
 * Idempotency: same inputs produce byte-identical outputs — we iterate
 * `Object.keys(existing)` deterministically and spread `derived` once.
 *
 * Exported for unit testing (see
 * `test/fixtures/scan-site-fixtures/run-fixture-tests.mjs`). The scan script
 * itself does NOT apply mergeProfile — it only records the raw existing
 * profile in `scan.json.mergeWith` and leaves the merge to the synthesizer
 * prompt (which follows the algorithm documented in
 * `prompts/brand-synthesis.md`).
 */
export function mergeProfile(existing, derived) {
  if (existing == null) return derived;
  if (derived == null) return existing;
  if (typeof existing !== 'object' || Array.isArray(existing)) return existing;
  if (typeof derived !== 'object' || Array.isArray(derived)) {
    // derived isn't a mergeable object — existing (an object) wins by default.
    return existing;
  }
  const out = { ...derived };
  for (const key of Object.keys(existing)) {
    const ev = existing[key];
    if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
      // Recurse into nested objects — per-leaf precedence.
      out[key] = mergeProfile(ev, derived?.[key]);
    } else if (ev != null && ev !== '') {
      // Scalar (or array) in existing wins, but only when it's a real value.
      // Explicit null / empty string = "let derived fill this."
      out[key] = ev;
    }
    // else: leave derived's value in place (including when derived lacks the key).
  }
  return out;
}

// ---------------- Merging ----------------

/**
 * Merge per-page signals into a single "merged" object whose shape matches
 * v0.5's top-level schema (fonts/colors/meta/textSamples/warnings).
 *
 * Inputs: `perPage` is an object keyed by pathname -> signals object.
 * `homepagePath` identifies which page's values to prefer for singletons
 * (meta, heroHeadline, background/text/accent tie-breakers).
 */
export function mergeSignals(perPage, homepagePath) {
  const paths = Object.keys(perPage);
  const home = perPage[homepagePath] || perPage[paths[0]];

  // --- Fonts: most-common display + body; homepage wins on ties. ---
  // WHY the split sources: We want homepage's source to win when the homepage
  // uses a given family, regardless of paths-iteration order. Previously the
  // "source" field was set in whatever order paths happened to be visited,
  // which worked only because attemptScan inserts homepage first. We now track
  // homepageSource and nonHomepageSource separately and resolve at pick time,
  // so reordering paths can never silently invert source attribution.
  const voteFont = (field, sourceField) => {
    const counts = new Map(); // family -> { count, homepageSource, nonHomepageSource, homepageHit }
    for (const p of paths) {
      const s = perPage[p];
      const fam = s?.fonts?.[field];
      if (!fam) continue;
      const src = s.fonts[sourceField] || 'unknown';
      const prev = counts.get(fam) || {
        count: 0,
        homepageSource: null,
        nonHomepageSource: null,
        homepageHit: false,
      };
      prev.count += 1;
      if (p === homepagePath) {
        prev.homepageHit = true;
        prev.homepageSource = src;
      } else if (prev.nonHomepageSource == null) {
        prev.nonHomepageSource = src;
      }
      counts.set(fam, prev);
    }
    if (counts.size === 0) {
      return { family: home?.fonts?.[field] || null, source: home?.fonts?.[sourceField] || 'unknown' };
    }
    // Sort: count desc, then homepageHit (true first), then alpha
    const sorted = Array.from(counts.entries()).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      if (a[1].homepageHit !== b[1].homepageHit) return a[1].homepageHit ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
    const [winnerFamily, winnerEntry] = sorted[0];
    // Homepage's source wins if homepage used this family; otherwise fall back
    // to any non-homepage source we observed, else 'unknown'.
    const source = winnerEntry.homepageSource
      ?? winnerEntry.nonHomepageSource
      ?? 'unknown';
    return { family: winnerFamily, source };
  };

  const display = voteFont('display', 'displaySource');
  const body = voteFont('body', 'bodySource');

  const allFontFaces = [];
  const seenFaces = new Set();
  for (const p of paths) {
    const faces = perPage[p]?.fonts?.allFontFaces || [];
    for (const f of faces) {
      const key = typeof f === 'string' ? f : JSON.stringify(f);
      if (seenFaces.has(key)) continue;
      seenFaces.add(key);
      allFontFaces.push(f);
    }
  }

  // v0.7 A.2 — merge fonts.byContext across pages. Homepage wins per-slot
  // (a site's header/logo font is a whole-site identity decision; the
  // homepage is the canonical surface for it). Non-homepage pages fill in
  // gaps only when the homepage value is null, in case the home template
  // lacks a given element that sub-pages use consistently.
  const mergedByContext = {};
  const byContextKeys = new Set();
  for (const p of paths) {
    const bc = perPage[p]?.fonts?.byContext;
    if (bc && typeof bc === 'object') {
      for (const k of Object.keys(bc)) byContextKeys.add(k);
    }
  }
  // Order: homepage first, then others, so homepage populates each slot first.
  const byContextOrder = [
    homepagePath,
    ...paths.filter((p) => p !== homepagePath),
  ].filter((p) => perPage[p]);
  for (const k of byContextKeys) mergedByContext[k] = null;
  for (const p of byContextOrder) {
    const bc = perPage[p]?.fonts?.byContext;
    if (!bc || typeof bc !== 'object') continue;
    for (const k of byContextKeys) {
      if (mergedByContext[k] == null && bc[k] != null) {
        mergedByContext[k] = bc[k];
      }
    }
  }

  const fonts = {
    display: display.family,
    body: body.family,
    displaySource: display.source,
    bodySource: body.source,
    allFontFaces,
    byContext: mergedByContext,
  };

  // --- Colors ---
  // Per-page allColors are already ΔE-clustered inside extractSignals, but
  // across pages we can still get near-dups (page A: #0A0A0A, page B: #000000).
  // Union them (cheap equality dedup first to shrink the input), then run
  // clusterColors again to collapse cross-page near-duplicates. Homepage
  // colors come first so they win as cluster representatives.
  const unionedColors = [];
  const seenColors = new Set();
  const orderedPaths = [
    homepagePath,
    ...paths.filter((p) => p !== homepagePath),
  ].filter((p) => perPage[p]);
  for (const p of orderedPaths) {
    for (const c of perPage[p]?.colors?.allColors || []) {
      const key = typeof c === 'string' ? c.toLowerCase() : JSON.stringify(c);
      if (seenColors.has(key)) continue;
      seenColors.add(key);
      unionedColors.push(c);
    }
  }
  const allColors = clusterColors(unionedColors);
  const colors = {
    background: home?.colors?.background ?? null,
    text: home?.colors?.text ?? null,
    accent: home?.colors?.accent ?? null,
    allColors,
    confidence: home?.colors?.confidence ?? 0,
  };

  // --- Meta: homepage wins. ---
  const meta = home?.meta || { title: null, description: null, ogImage: null };

  // --- Text samples ---
  const pageHeadlines = {};
  for (const p of paths) {
    pageHeadlines[p] = perPage[p]?.textSamples?.heroHeadline ?? null;
  }
  const ctaSeen = new Set();
  const ctaCandidates = [];
  for (const p of paths) {
    for (const c of perPage[p]?.textSamples?.ctaCandidates || []) {
      const key = typeof c === 'string' ? c.trim().toLowerCase() : JSON.stringify(c);
      if (!key || ctaSeen.has(key)) continue;
      ctaSeen.add(key);
      ctaCandidates.push(c);
      if (ctaCandidates.length >= MAX_CTA_CANDIDATES) break;
    }
    if (ctaCandidates.length >= MAX_CTA_CANDIDATES) break;
  }
  const textSamples = {
    heroHeadline: home?.textSamples?.heroHeadline ?? null,
    heroSubheadline: home?.textSamples?.heroSubheadline ?? null,
    ctaCandidates,
    pageHeadlines,
  };

  // --- Text content (v0.6 Task E.1) ---
  // headings: concat across all pages (homepage first), dedupe, cap at 30.
  // mainText + metaDescription: homepage wins (per-page copies live inside perPage).
  // ctas: concat across all pages, dedupe, cap at 15.
  const MAX_HEADINGS = 30;
  const MAX_CTAS = 15;
  const headingsSeen = new Set();
  const mergedHeadings = [];
  const ctasSeen = new Set();
  const mergedCtas = [];
  for (const p of orderedPaths) {
    const tc = perPage[p]?.textContent;
    if (!tc) continue;
    for (const h of tc.headings || []) {
      if (typeof h !== 'string') continue;
      const key = h.trim();
      if (!key || headingsSeen.has(key)) continue;
      headingsSeen.add(key);
      mergedHeadings.push(h);
      if (mergedHeadings.length >= MAX_HEADINGS) break;
    }
    for (const c of tc.ctas || []) {
      if (typeof c !== 'string') continue;
      const key = c.trim().toLowerCase();
      if (!key || ctasSeen.has(key)) continue;
      ctasSeen.add(key);
      mergedCtas.push(c);
      if (mergedCtas.length >= MAX_CTAS) break;
    }
    if (mergedHeadings.length >= MAX_HEADINGS && mergedCtas.length >= MAX_CTAS) break;
  }
  const textContent = {
    headings: mergedHeadings,
    mainText: home?.textContent?.mainText ?? '',
    ctas: mergedCtas,
    metaDescription: home?.textContent?.metaDescription ?? '',
  };

  // --- Warnings: tag non-homepage warnings with page path. ---
  const warnings = [];
  for (const p of paths) {
    const ws = perPage[p]?.warnings || [];
    if (p === homepagePath) {
      warnings.push(...ws);
    } else {
      for (const w of ws) warnings.push(`${p}: ${w}`);
    }
  }

  return { fonts, colors, meta, textSamples, textContent, warnings };
}

// ---------------- Orchestration ----------------

/**
 * Scan the homepage + up to MAX_DISCOVERED_PAGES more pages using ONE browser.
 * Returns { ok, payload | reason }. Payload contains pagesScanned/perPage/merged.
 */
async function attemptScan({ puppeteer, url, outDir, headless, warnings }) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    return { ok: false, reason: `launch_failed: ${err?.message || err}` };
  }

  const startedAt = Date.now();
  const timeLeft = () => TOTAL_WALL_CLOCK_MS - (Date.now() - startedAt);

  try {
    const homepagePage = await browser.newPage();
    let screenshotPaths = { hero: null, full: null };
    try {
      await homepagePage.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      );
      await homepagePage.setViewport({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        deviceScaleFactor: 1,
      });

      // Scan homepage first — this is the only page required for success.
      const homepagePath = (() => {
        try {
          const p = new URL(url).pathname || '/';
          return p === '' ? '/' : p;
        } catch {
          return '/';
        }
      })();

      const homeResult = await scanPage({
        page: homepagePage,
        url,
        outDir,
        isHomepage: true,
        warnings,
      });

      if (!homeResult.ok) {
        return { ok: false, reason: homeResult.reason };
      }

      screenshotPaths = homeResult.screenshotPaths || { hero: null, full: null };

      // Logo extraction runs once, on the homepage — the logo almost always
      // lives in the header or masthead and rarely differs across sub-pages.
      // extractLogo is engineered to never throw; we still wrap defensively so
      // future refactors can't turn a logo failure into a whole-scan abort.
      let logo = { type: 'none', warning: 'No logo found' };
      try {
        logo = await extractLogo(homepagePage, outDir, url);
      } catch (err) {
        warnings.push(`logo extraction failed: ${err?.message || err}`);
        logo = { type: 'none', warning: 'No logo found' };
      }
      if (logo?.crossOrigin && logo?.sourceUrl) {
        warnings.push(`logo fetched cross-origin from ${logo.sourceUrl}`);
      }
      if (logo?.warning && typeof logo.warning === 'string' && logo.warning.startsWith('[logo]')) {
        warnings.push(logo.warning);
      }

      const perPage = {};
      perPage[homepagePath] = homeResult.signals;

      // Discover additional pages from the already-loaded homepage.
      let discovered = [];
      let discoveryUsedFallback = false;
      try {
        const result = await discoverPages(homepagePage, url);
        discovered = result.paths;
        discoveryUsedFallback = result.usedFallback;
      } catch (err) {
        warnings.push(`page discovery failed: ${err?.message || err}`);
      }
      if (discoveryUsedFallback && discovered.length > 0) {
        warnings.push('[page-discovery] Fell back to viewport-based link scanning (no semantic nav found)');
      }

      // Scan each discovered page (one tab at a time; serial keeps memory sane
      // and respects the wall-clock budget naturally).
      for (const path of discovered) {
        if (timeLeft() < PAGE_TIMEOUT_MS) {
          warnings.push(`skipping ${path}: total scan budget exhausted`);
          break;
        }
        const absUrl = new URL(path, url).toString();
        const subPage = await browser.newPage();
        try {
          await subPage.setUserAgent(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          );
          await subPage.setViewport({
            width: VIEWPORT_WIDTH,
            height: VIEWPORT_HEIGHT,
            deviceScaleFactor: 1,
          });
          const sub = await scanPage({
            page: subPage,
            url: absUrl,
            outDir,
            isHomepage: false,
            warnings,
          });
          if (sub.ok) {
            perPage[path] = sub.signals;
          } else {
            warnings.push(`${path}: scan failed (${sub.reason}) — continuing`);
          }
        } catch (err) {
          warnings.push(`${path}: unexpected error (${err?.message || err}) — continuing`);
        } finally {
          try { await subPage.close(); } catch { /* ignore */ }
        }
      }

      const pagesScanned = Object.keys(perPage);
      const merged = mergeSignals(perPage, homepagePath);

      // Append any navigation-level warnings accumulated in the `warnings`
      // array into merged.warnings so they surface to the consumer.
      merged.warnings = [...merged.warnings, ...warnings.filter((w) => !merged.warnings.includes(w))];

      // Mirror the logo descriptor into merged so downstream consumers that
      // only look at `merged.*` (ignoring the top-level backwards-compat
      // mirror) still see it.
      merged.logo = logo;

      // --- v0.6 Task F.1: BrandFetch (opt-in, BYOK) ---
      // Strictly augmentation. If BRANDFETCH_API_KEY is unset/empty, the
      // client short-circuits without touching the network.
      const apiKey = process.env.BRANDFETCH_API_KEY;
      const bfDomain = extractDomain(url);
      const brandfetchResult = await brandfetch(bfDomain, apiKey);
      merged.brandfetch = brandfetchResult;

      const payload = {
        url,
        scannedAt: new Date().toISOString(),
        pagesScanned,
        perPage,
        merged,
        // v0.5 backwards-compat mirror — merged.* fields at top level.
        fonts: merged.fonts,
        colors: merged.colors,
        meta: merged.meta,
        textSamples: merged.textSamples,
        textContent: merged.textContent,
        warnings: merged.warnings,
        // Only surface paths for screenshots that actually wrote to disk;
        // writing heroPath/fullPath unconditionally pointed consumers at
        // nonexistent files when page.screenshot() threw.
        screenshots: {
          hero: screenshotPaths.hero,
          full: screenshotPaths.full,
        },
        logo,
        brandfetch: brandfetchResult,
      };

      return { ok: true, payload };
    } finally {
      // Symmetric with subPage cleanup. `browser.close()` below would reap
      // this page too, but explicit close is cheap insurance against future
      // refactors that keep the browser alive (e.g. reuse across attempts).
      try { await homepagePage.close(); } catch { /* ignore */ }
    }
  } catch (err) {
    return { ok: false, reason: `runtime_failed: ${err?.message || err}` };
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }
}

async function main() {
  const parsed = parseArgv(process.argv);
  if (!parsed) usage();
  const { urlArg, outArg, mergeWithPath } = parsed;

  const url = normalizeUrl(urlArg);
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });

  const scannedAt = new Date().toISOString();

  // --- v0.7 A.1: --merge-with existing brand profile ---
  // Load early so we can fail fast on bad paths/JSON BEFORE spinning up
  // Puppeteer (which is the expensive part). If the file is missing or
  // invalid JSON we emit an error scan.json and bail — same pattern as the
  // puppeteer-missing failure mode below.
  let mergeWith = null;
  if (mergeWithPath) {
    const abs = resolve(mergeWithPath);
    let raw;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch (err) {
      const msg = `--merge-with: cannot read ${abs} (${err?.code || err?.message || err})`;
      console.error(`\u2717 ${msg}`);
      writeScan(outDir, {
        url,
        scannedAt,
        error: msg,
        warnings: [msg],
        pagesScanned: [],
        perPage: {},
        merged: null,
        screenshots: { hero: null, full: null },
        logo: { type: 'none', warning: 'No logo found' },
      });
      process.exit(0);
      return;
    }
    let content;
    try {
      content = JSON.parse(raw);
    } catch (err) {
      const msg = `--merge-with: ${abs} is not valid JSON (${err?.message || err})`;
      console.error(`\u2717 ${msg}`);
      writeScan(outDir, {
        url,
        scannedAt,
        error: msg,
        warnings: [msg],
        pagesScanned: [],
        perPage: {},
        merged: null,
        screenshots: { hero: null, full: null },
        logo: { type: 'none', warning: 'No logo found' },
      });
      process.exit(0);
      return;
    }
    mergeWith = { sourcePath: abs, content };
  }

  // Lazy-import puppeteer with a clear error when missing.
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch (err) {
    const msg = err?.code === 'ERR_MODULE_NOT_FOUND'
      ? 'puppeteer is not installed. Run: cd scripts && npm install'
      : `failed to load puppeteer: ${err?.message || err}`;
    console.error(`\u2717 ${msg}`);
    writeScan(outDir, {
      url,
      scannedAt,
      error: msg,
      warnings: [msg],
      pagesScanned: [],
      perPage: {},
      merged: null,
      screenshots: { hero: null, full: null },
      logo: { type: 'none', warning: 'No logo found' },
    });
    process.exit(0);
    return;
  }

  const warnings = [];

  // First attempt: headless
  let result = await attemptScan({ puppeteer, url, outDir, headless: true, warnings });

  // Decide whether to retry headful. Two triggers:
  //   (a) the attempt aborted hard (navigation_failed / launch_failed) — same
  //       as before.
  //   (b) the attempt returned ok:true but produced a useless extraction
  //       (no background color AND no display font) — this is the shape of
  //       bot-block / CAPTCHA / heavy-JS-with-no-CSS pages that silently pass
  //       through to scan.json as all-nulls.
  //   (c) all homepage warnings point at navigation problems (timeout/HTTP).
  const shouldRetryHeadful = (() => {
    if (!result.ok) {
      return /navigation_failed|launch_failed/.test(result.reason || '');
    }
    const merged = result.payload?.merged;
    if (!merged) return false;
    const emptyExtraction = merged.colors?.background == null
      && merged.fonts?.display == null;
    if (emptyExtraction) return true;
    // All homepage warnings indicate navigation issues (heuristic: every
    // warning mentions navigation/timeout/HTTP).
    const homeWarnings = merged.warnings || [];
    if (homeWarnings.length > 0) {
      const navRe = /navigation|timeout|HTTP \d{3}|page\.content|CSS bundle/i;
      const allNav = homeWarnings.every((w) => navRe.test(w));
      if (allNav) return true;
    }
    return false;
  })();

  if (shouldRetryHeadful) {
    const reason = result.ok
      ? 'empty extraction (no background color and no display font detected)'
      : result.reason;
    warnings.push(`first attempt produced no usable signals (${reason}); retrying with headful browser`);
    try {
      const retry = await attemptScan({ puppeteer, url, outDir, headless: false, warnings });
      // Only swap in the retry result if it's better. "Better" = ok AND has at
      // least one of background/display populated. Otherwise keep the first
      // attempt (which may still have partial data we don't want to discard).
      if (retry.ok) {
        const r = retry.payload?.merged;
        const retryHasSignal = r && (r.colors?.background != null || r.fonts?.display != null);
        if (retryHasSignal || !result.ok) {
          result = retry;
        }
      } else if (!result.ok) {
        result = retry;
      }
    } catch (err) {
      warnings.push(`headful retry also failed: ${err?.message || err}`);
    }
  }

  if (result.ok) {
    // v0.7 A.1: attach raw existing brand profile so the synthesizer can apply
    // mergeProfile(existing, derived). scan.json itself does NOT apply the
    // merge — it just records the source so the user can inspect what the
    // scan alone would have produced.
    if (mergeWith) {
      result.payload.mergeWith = mergeWith;
    }
    writeScan(outDir, result.payload);
    console.log(`\u2713 scan.json written to ${outDir}`);
    if (mergeWith) {
      console.log(`  merge-with: ${mergeWith.sourcePath}`);
    }
    console.log(`  pages:      ${result.payload.pagesScanned.join(', ')}`);
    console.log(`  background: ${result.payload.merged.colors.background}`);
    console.log(`  text:       ${result.payload.merged.colors.text}`);
    console.log(`  accent:     ${result.payload.merged.colors.accent}`);
    console.log(`  display:    ${result.payload.merged.fonts.display} (${result.payload.merged.fonts.displaySource})`);
    console.log(`  body:       ${result.payload.merged.fonts.body} (${result.payload.merged.fonts.bodySource})`);
    console.log(`  confidence: ${result.payload.merged.colors.confidence}`);
    const logoDesc = result.payload.logo
      ? (result.payload.logo.type === 'none'
        ? 'none'
        : `${result.payload.logo.type} → ${result.payload.logo.path}`)
      : 'none';
    console.log(`  logo:       ${logoDesc}`);
    const bf = result.payload.brandfetch;
    if (bf) {
      if (bf.available && bf.data) {
        const nLogos = bf.data.logos?.length ?? 0;
        const mColors = bf.data.colors?.length ?? 0;
        console.log(`  brandfetch: available (${nLogos} logos, ${mColors} colors)`);
      } else {
        console.log(`  brandfetch: ${bf.reason || 'unavailable'}`);
      }
    }
    if (result.payload.merged.warnings.length) {
      console.log(`  warnings:   ${result.payload.merged.warnings.length}`);
      for (const w of result.payload.merged.warnings) console.log(`    - ${w}`);
    }
    process.exit(0);
    return;
  }

  // Total failure — write an error scan.json but DO NOT crash the caller.
  console.error(`\u2717 scan failed: ${result.reason}`);
  const emptySignals = {
    fonts: { display: null, body: null, displaySource: 'unknown', bodySource: 'unknown', allFontFaces: [], byContext: {} },
    colors: { background: null, text: null, accent: null, allColors: [], confidence: 0 },
    meta: { title: null, description: null, ogImage: null },
    textSamples: { heroHeadline: null, heroSubheadline: null, ctaCandidates: [], pageHeadlines: {} },
    textContent: { headings: [], mainText: '', ctas: [], metaDescription: '' },
    warnings: [...warnings, result.reason],
  };
  const failureLogo = { type: 'none', warning: 'No logo found' };
  emptySignals.logo = failureLogo;
  const failureBrandfetch = { available: false, reason: 'scan failed' };
  emptySignals.brandfetch = failureBrandfetch;
  const failurePayload = {
    url,
    scannedAt,
    error: result.reason,
    pagesScanned: [],
    perPage: {},
    merged: emptySignals,
    fonts: emptySignals.fonts,
    colors: emptySignals.colors,
    meta: emptySignals.meta,
    textSamples: emptySignals.textSamples,
    textContent: emptySignals.textContent,
    warnings: emptySignals.warnings,
    screenshots: { hero: null, full: null },
    logo: failureLogo,
    brandfetch: failureBrandfetch,
  };
  if (mergeWith) {
    // Even on total scan failure, preserve mergeWith so downstream tooling
    // (e.g. a manual-fallback synthesizer) can still apply the user's
    // hand-tuned profile.
    failurePayload.mergeWith = mergeWith;
  }
  writeScan(outDir, failurePayload);
  process.exit(0);
}

// Only run main() when invoked as a CLI, so test files can import helpers
// (rankDiscoveredLinks) without triggering a scan.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
