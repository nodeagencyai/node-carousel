#!/usr/bin/env node
// export-png.mjs — render each SVG in a directory to PNG via Puppeteer.
//
// CLI:
//   node scripts/export-png.mjs <slides-dir>
//
// Env:
//   CAROUSEL_SCALE         — deviceScaleFactor for retina output (default: 2)
//   CAROUSEL_FONT_WAIT_MS  — extra buffer after document.fonts.ready (default: 1500)

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function parseViewBox(svg) {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!m) return null;
  const parts = m[1].trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [, , w, h] = parts;
  return { width: Math.round(w), height: Math.round(h) };
}

function htmlWrap(svg, width, height) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { width: ${width}px; height: ${height}px; overflow: hidden; }
    svg { display: block; width: ${width}px; height: ${height}px; }
  </style>
</head>
<body>${svg}</body>
</html>`;
}

async function main() {
  const [, , slidesDirArg] = process.argv;
  if (!slidesDirArg) {
    console.error('Usage: node scripts/export-png.mjs <slides-dir>');
    process.exit(1);
  }

  const scale = Number(process.env.CAROUSEL_SCALE || 2);
  const fontWaitMs = Number(process.env.CAROUSEL_FONT_WAIT_MS || 1500);
  const dir = resolve(slidesDirArg);
  const files = readdirSync(dir)
    .filter((f) => /^slide-.*\.svg$/i.test(f))
    .sort(naturalSort);

  if (files.length === 0) {
    console.error(`No slide-*.svg files found in ${dir}`);
    process.exit(1);
  }

  // Lazy-import puppeteer so missing dep yields a clearer error, and
  // distinguish module-not-found from other import failures.
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('\u2717 puppeteer is not installed. Run: cd scripts && npm install');
    } else {
      console.error('\u2717 Failed to load puppeteer:', err && err.message ? err.message : err);
    }
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const failures = [];

  try {
    for (const file of files) {
      const svgPath = join(dir, file);
      const svg = readFileSync(svgPath, 'utf8');
      const vb = parseViewBox(svg) || { width: 1080, height: 1350 };

      let page;
      try {
        page = await browser.newPage();
        await page.setViewport({
          width: vb.width,
          height: vb.height,
          deviceScaleFactor: scale,
        });
        // 15s timeout per slide instead of the default 30s — fail fast on
        // blocked networks (Google Fonts, etc.) so we can continue to the
        // next slide rather than hanging the whole run.
        await page.setContent(htmlWrap(svg, vb.width, vb.height), {
          waitUntil: 'networkidle2',
          timeout: 15000,
        });

        // Best-effort font wait. document.fonts.ready can reject on some
        // pages; we log + continue rather than swallow silently.
        try {
          await page.evaluate(() => document.fonts.ready);
        } catch (err) {
          console.error(
            `\u26a0 ${file}: document.fonts.ready rejected (${err && err.message ? err.message : err}); continuing.`,
          );
        }
        await new Promise((r) => setTimeout(r, fontWaitMs));

        const pngPath = join(dir, `${basename(file, extname(file))}.png`);
        await page.screenshot({
          path: pngPath,
          type: 'png',
          omitBackground: false,
          clip: { x: 0, y: 0, width: vb.width, height: vb.height },
        });
        console.log(`\u2713 ${pngPath}`);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.error(`\u2717 ${file} failed: ${msg}`);
        failures.push({ file, error: msg });
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // ignore close errors
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} of ${files.length} slide(s) failed to export:`);
    for (const f of failures) {
      console.error(`  - ${f.file}: ${f.error}`);
    }
    process.exit(1);
  }
}

await main();
