#!/usr/bin/env node
// scan-site.mjs — v0.5 scan infrastructure.
//
// CLI:
//   node scripts/scan-site.mjs <url> <output-dir>
//
// Produces (in <output-dir>):
//   - hero.png     — viewport screenshot at 1440x900
//   - full.png     — full-page screenshot at 1440 wide
//   - page.html    — rendered HTML snapshot
//   - styles.css   — aggregated CSS dump (stylesheets + computed styles)
//   - scan.json    — the brand-signals contract (see extract-brand-signals.mjs)
//
// Uses Puppeteer (already bundled via scripts/package.json). The repo's
// existing export-png.mjs uses the same import pattern.
//
// Graceful failure modes:
//   - URL blocked by headless detection -> retry with headless=false, else
//     write partial scan.json with warning.
//   - Timeout (30s max) -> write partial with warning.
//   - 404 / DNS fail     -> write scan.json with `error` field set; exit 0.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { extractSignals } from './extract-brand-signals.mjs';

const TIMEOUT_MS = 30000;
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

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

/** Attempt a scan with the given launch opts. Returns { ok, partial, reason }. */
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

  try {
    const page = await browser.newPage();

    // Set a realistic UA so sites that block headless UAs still render.
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    );

    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    });

    let response;
    try {
      response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: TIMEOUT_MS,
      });
    } catch (err) {
      const msg = err?.message || String(err);
      // networkidle2 can time out on heavy sites even when DOM is usable.
      if (/Navigation timeout/i.test(msg) || /timeout/i.test(msg)) {
        warnings.push(`navigation timeout: continuing with partial content (${msg})`);
      } else {
        return { ok: false, reason: `navigation_failed: ${msg}` };
      }
    }

    if (response && !response.ok() && response.status() !== 304) {
      warnings.push(`HTTP ${response.status()} — page may be partial`);
    }

    // Give fonts/JS a moment to settle
    try {
      await page.evaluate(() => document.fonts && document.fonts.ready);
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 600));

    // --- Screenshots ---
    const heroPath = join(outDir, 'hero.png');
    const fullPath = join(outDir, 'full.png');
    try {
      await page.screenshot({
        path: heroPath,
        type: 'png',
        clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
    } catch (err) {
      warnings.push(`hero screenshot failed: ${err?.message || err}`);
    }
    try {
      await page.screenshot({ path: fullPath, type: 'png', fullPage: true });
    } catch (err) {
      warnings.push(`full screenshot failed: ${err?.message || err}`);
    }

    // --- HTML dump ---
    const html = await page.content();
    writeFileSync(join(outDir, 'page.html'), html, 'utf8');

    // --- Aggregated CSS + computed styles on body/h1/button ---
    const cssBundle = await page.evaluate(() => {
      const out = {
        stylesheetsText: [],
        body: '',
        h1: '',
        button: '',
      };

      // Inline/linked stylesheets that are same-origin readable.
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

      // Also capture root CSS custom properties — these often hold brand tokens.
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

    writeFileSync(join(outDir, 'styles.css'), cssDump, 'utf8');

    // --- Extract brand signals ---
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

    // Merge warnings and fill screenshot paths.
    signals.warnings = [...(signals.warnings || []), ...warnings];
    signals.screenshots = { hero: heroPath, full: fullPath };

    return { ok: true, payload: signals };
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
      screenshots: { hero: null, full: null },
    });
    process.exit(0);
    return;
  }

  const warnings = [];

  // First attempt: headless
  let result = await attemptScan({ puppeteer, url, outDir, headless: true, warnings });

  // If the page failed to navigate entirely (e.g. blocked), retry headed.
  if (!result.ok && /navigation_failed|launch_failed/.test(result.reason || '')) {
    warnings.push(`first attempt failed (${result.reason}); retrying with headful browser`);
    try {
      result = await attemptScan({ puppeteer, url, outDir, headless: false, warnings });
    } catch (err) {
      warnings.push(`headful retry also failed: ${err?.message || err}`);
    }
  }

  if (result.ok) {
    writeScan(outDir, result.payload);
    console.log(`\u2713 scan.json written to ${outDir}`);
    console.log(`  background: ${result.payload.colors.background}`);
    console.log(`  text:       ${result.payload.colors.text}`);
    console.log(`  accent:     ${result.payload.colors.accent}`);
    console.log(`  display:    ${result.payload.fonts.display} (${result.payload.fonts.displaySource})`);
    console.log(`  body:       ${result.payload.fonts.body} (${result.payload.fonts.bodySource})`);
    console.log(`  confidence: ${result.payload.colors.confidence}`);
    if (result.payload.warnings.length) {
      console.log(`  warnings:   ${result.payload.warnings.length}`);
      for (const w of result.payload.warnings) console.log(`    - ${w}`);
    }
    process.exit(0);
    return;
  }

  // Total failure — write an error scan.json but DO NOT crash the caller.
  console.error(`\u2717 scan failed: ${result.reason}`);
  writeScan(outDir, {
    url,
    scannedAt,
    error: result.reason,
    warnings: [...warnings, result.reason],
    screenshots: { hero: null, full: null },
    fonts: { display: null, body: null, displaySource: 'unknown', bodySource: 'unknown', allFontFaces: [] },
    colors: { background: null, text: null, accent: null, allColors: [], confidence: 0 },
    meta: { title: null, description: null, ogImage: null },
    textSamples: { heroHeadline: null, heroSubheadline: null, ctaCandidates: [] },
  });
  process.exit(0);
}

await main();
