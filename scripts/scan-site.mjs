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

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSignals, clusterColors } from './extract-brand-signals.mjs';

const PAGE_TIMEOUT_MS = 15000;       // per-page goto timeout
const TOTAL_WALL_CLOCK_MS = 45000;   // whole scan soft-cap (plan said 20s total, which is too tight with 3 pages; 15s/page x 3 + headroom)
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;
const MAX_DISCOVERED_PAGES = 2;      // home + 2 = 3 total
const MAX_CTA_CANDIDATES = 10;

function usage() {
  console.error('Usage: node scripts/scan-site.mjs <url> <output-dir>');
  process.exit(1);
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
 * Extract nav/footer hrefs from an already-loaded Puppeteer page, then rank.
 * Returns at most MAX_DISCOVERED_PAGES paths.
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
    return [];
  }
  return rankDiscoveredLinks(hrefs, baseUrl);
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

  let cssBundle = { stylesheetsText: [], body: '', h1: '', button: '', rootVars: '' };
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

  const fonts = {
    display: display.family,
    body: body.family,
    displaySource: display.source,
    bodySource: body.source,
    allFontFaces,
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

  return { fonts, colors, meta, textSamples, warnings };
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

      const perPage = {};
      perPage[homepagePath] = homeResult.signals;

      // Discover additional pages from the already-loaded homepage.
      let discovered = [];
      try {
        discovered = await discoverPages(homepagePage, url);
      } catch (err) {
        warnings.push(`page discovery failed: ${err?.message || err}`);
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
        warnings: merged.warnings,
        // Only surface paths for screenshots that actually wrote to disk;
        // writing heroPath/fullPath unconditionally pointed consumers at
        // nonexistent files when page.screenshot() threw.
        screenshots: {
          hero: screenshotPaths.hero,
          full: screenshotPaths.full,
        },
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
  const [, , urlArg, outArg] = process.argv;
  if (!urlArg || !outArg) usage();

  const url = normalizeUrl(urlArg);
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });

  const scannedAt = new Date().toISOString();

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
    writeScan(outDir, result.payload);
    console.log(`\u2713 scan.json written to ${outDir}`);
    console.log(`  pages:      ${result.payload.pagesScanned.join(', ')}`);
    console.log(`  background: ${result.payload.merged.colors.background}`);
    console.log(`  text:       ${result.payload.merged.colors.text}`);
    console.log(`  accent:     ${result.payload.merged.colors.accent}`);
    console.log(`  display:    ${result.payload.merged.fonts.display} (${result.payload.merged.fonts.displaySource})`);
    console.log(`  body:       ${result.payload.merged.fonts.body} (${result.payload.merged.fonts.bodySource})`);
    console.log(`  confidence: ${result.payload.merged.colors.confidence}`);
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
    fonts: { display: null, body: null, displaySource: 'unknown', bodySource: 'unknown', allFontFaces: [] },
    colors: { background: null, text: null, accent: null, allColors: [], confidence: 0 },
    meta: { title: null, description: null, ogImage: null },
    textSamples: { heroHeadline: null, heroSubheadline: null, ctaCandidates: [], pageHeadlines: {} },
    warnings: [...warnings, result.reason],
  };
  writeScan(outDir, {
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
    warnings: emptySignals.warnings,
    screenshots: { hero: null, full: null },
  });
  process.exit(0);
}

// Only run main() when invoked as a CLI, so test files can import helpers
// (rankDiscoveredLinks) without triggering a scan.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
