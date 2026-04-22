// scripts/load-font.mjs — v0.7.1 B.2
// Font loader + base64 data-URI embedder for self-hosted fonts.
//
// Reads a font file from disk, enforces a hard size cap (500 KB) and a
// soft-warn threshold (250 KB), and emits a self-contained @font-face
// declaration with the font bytes inlined as a data: URI.
//
// Used by render-v0.4.mjs (B.3) so custom-font carousels ship without
// external requests — the SVG output is a portable single file.

import { readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const MAX_BYTES = 500 * 1024;
const WARN_BYTES = 250 * 1024;

const FORMAT_MAP = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
};

const MIME_MAP = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};

export function inferFontFormat(path) {
  const ext = extname(path).toLowerCase();
  if (!FORMAT_MAP[ext]) {
    throw new Error(`Unsupported font format: ${ext}. Expected .woff2, .woff, .ttf, or .otf`);
  }
  return FORMAT_MAP[ext];
}

export function loadFont(path) {
  const abs = resolve(path);
  const format = inferFontFormat(abs);
  const stats = statSync(abs);
  const warnings = [];
  if (stats.size > MAX_BYTES) {
    throw new Error(`Font file ${path} is ${Math.round(stats.size / 1024)}KB, exceeds 500KB limit`);
  }
  if (stats.size > WARN_BYTES) {
    warnings.push(`font ${path} is large (${Math.round(stats.size / 1024)}KB) — bloats every SVG`);
  }
  const buffer = readFileSync(abs);
  return { buffer, format, mime: MIME_MAP[format], size: stats.size, path: abs, warnings };
}

export function embedFontAsDataUri({ family, file, weight = 400, style = 'normal' }) {
  const loaded = loadFont(file);
  const base64 = loaded.buffer.toString('base64');
  return [
    '@font-face {',
    `  font-family: '${family}';`,
    `  src: url('data:${loaded.mime};base64,${base64}') format('${loaded.format}');`,
    `  font-weight: ${weight};`,
    `  font-style: ${style};`,
    `  font-display: swap;`,
    '}',
  ].join('\n');
}
