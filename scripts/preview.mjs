#!/usr/bin/env node
// preview.mjs — build preview.html that stacks all slide SVGs vertically.
//
// CLI:
//   node scripts/preview.mjs <slides-dir>

import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function buildHtml(slideFiles) {
  const objects = slideFiles
    .map(
      (f) =>
        `    <object class="slide" type="image/svg+xml" data="${f}"></object>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Carousel Preview</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #0a0a0a;
      color: #eaeaea;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      padding: 40px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 40px;
    }
    .slide {
      display: block;
      width: min(540px, 90vw);
      height: auto;
      aspect-ratio: 1080 / 1350;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
      border-radius: 8px;
      overflow: hidden;
      background: #111;
    }
    .meta {
      font-size: 13px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="meta">${slideFiles.length} slides</div>
${objects}
</body>
</html>
`;
}

function main() {
  const [, , slidesDirArg] = process.argv;
  if (!slidesDirArg) {
    console.error('Usage: node scripts/preview.mjs <slides-dir>');
    process.exit(1);
  }
  const dir = resolve(slidesDirArg);
  const files = readdirSync(dir)
    .filter((f) => /^slide-.*\.svg$/i.test(f))
    .sort(naturalSort);
  if (files.length === 0) {
    console.error(`No slide-*.svg files found in ${dir}`);
    process.exit(1);
  }
  const html = buildHtml(files);
  const outPath = join(dir, 'preview.html');
  writeFileSync(outPath, html, 'utf8');
  console.log(`\u2713 ${outPath}`);
}

main();
