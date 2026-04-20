#!/usr/bin/env node
// export-png.mjs — render each SVG in a directory to PNG via Puppeteer.
//
// CLI:
//   node scripts/export-png.mjs <slides-dir>
//
// Env:
//   CAROUSEL_SCALE — deviceScaleFactor for retina output (default: 2)

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
  const dir = resolve(slidesDirArg);
  const files = readdirSync(dir)
    .filter((f) => /^slide-.*\.svg$/i.test(f))
    .sort(naturalSort);

  if (files.length === 0) {
    console.error(`No slide-*.svg files found in ${dir}`);
    process.exit(1);
  }

  // Lazy-require puppeteer so missing dep yields a clearer error.
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer'));
  } catch (err) {
    console.error(
      'puppeteer is not installed. Run `npm install` inside the `scripts/` directory first.',
    );
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const file of files) {
      const svgPath = join(dir, file);
      const svg = readFileSync(svgPath, 'utf8');
      const vb = parseViewBox(svg) || { width: 1080, height: 1350 };

      const page = await browser.newPage();
      await page.setViewport({
        width: vb.width,
        height: vb.height,
        deviceScaleFactor: scale,
      });
      await page.setContent(htmlWrap(svg, vb.width, vb.height), {
        waitUntil: 'networkidle0',
      });

      // Wait for fonts + small buffer for @import Google Fonts.
      try {
        await page.evaluate(() => document.fonts.ready);
      } catch {}
      await new Promise((r) => setTimeout(r, 500));

      const pngPath = join(
        dir,
        `${basename(file, extname(file))}.png`,
      );
      await page.screenshot({
        path: pngPath,
        type: 'png',
        omitBackground: false,
        clip: { x: 0, y: 0, width: vb.width, height: vb.height },
      });
      await page.close();
      console.log(`\u2713 ${pngPath}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
