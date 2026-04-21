#!/usr/bin/env node
// prepare-references.mjs — validate a directory of user-provided reference
// carousels and emit a manifest for Claude to consume at command runtime.
//
// This script does NOT analyze images. Image analysis happens at
// /node-carousel:scan time via Claude's multimodal Read tool. This script
// just lists + validates files so the command has a stable input.
//
// CLI:
//   node scripts/prepare-references.mjs <references-dir> <output-dir>
//
// Writes:
//   <output-dir>/references-manifest.json
//
// Rules:
//   - Accepts .png, .jpg, .jpeg (case-insensitive).
//   - Caps at 5 files. If more, keeps the 5 most recently modified.
//   - Skips files >10MB (too large to comfortably send to the model).
//   - Warns (does not fail) on files where width cannot be sniffed or where
//     sniffed width is <400px.
//   - If the references dir is missing, exits non-zero with a clear error.
//   - If the references dir has zero eligible files, writes a manifest with
//     ready:false and referenceCount:0. This is not a hard error — the
//     calling command can decide to skip the reference-analysis step.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const MAX_REFERENCES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const MIN_USEFUL_WIDTH = 400;
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);

function isImageFile(name) {
  return IMAGE_EXTS.has(extname(name).toLowerCase());
}

// Minimal image dimension sniffing. We don't want a dependency just for this,
// so we parse the first few bytes of PNG/JPEG headers. Returns null when we
// can't confidently determine width — callers should treat null as "unknown".
function sniffImageWidth(filePath) {
  let fd;
  try {
    const buf = readFileSync(filePath);
    // PNG: 8-byte signature, then IHDR chunk. Width is big-endian uint32 at offset 16.
    if (
      buf.length >= 24 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    ) {
      return buf.readUInt32BE(16);
    }
    // JPEG: scan for SOF0/SOF2 marker (0xFFC0 or 0xFFC2). Width is 2 bytes big-endian
    // at marker offset + 7.
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF markers we care about: C0, C1, C2, C3 (skip C4/C8/CC which aren't SOF)
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
          return buf.readUInt16BE(offset + 7);
        }
        // Segment length follows marker: 2 bytes big-endian, includes itself.
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function fail(msg, code = 1) {
  console.error(`prepare-references: ${msg}`);
  process.exit(code);
}

function main() {
  const [, , refsDirArg, outDirArg] = process.argv;
  if (!refsDirArg || !outDirArg) {
    fail('Usage: node scripts/prepare-references.mjs <references-dir> <output-dir>');
  }

  const refsDir = resolve(refsDirArg);
  const outDir = resolve(outDirArg);

  if (!existsSync(refsDir)) {
    fail(`references dir does not exist: ${refsDir}`);
  }
  const refsStat = statSync(refsDir);
  if (!refsStat.isDirectory()) {
    fail(`references path is not a directory: ${refsDir}`);
  }

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const warnings = [];
  let entries;
  try {
    entries = readdirSync(refsDir, { withFileTypes: true });
  } catch (err) {
    fail(`could not read references dir: ${err.message}`);
  }

  // Collect candidate image files with mtime for ordering.
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isImageFile(entry.name)) continue;
    const abs = join(refsDir, entry.name);
    let stat;
    try {
      stat = statSync(abs);
    } catch (err) {
      warnings.push(`${entry.name}: could not stat (${err.message}); skipped`);
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      warnings.push(`${entry.name} was ${(stat.size / 1024 / 1024).toFixed(1)}MB (>10MB limit); skipped`);
      continue;
    }
    candidates.push({ abs, name: entry.name, mtimeMs: stat.mtimeMs, size: stat.size });
  }

  // Sort by most-recent mtime, then truncate.
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let selected = candidates;
  if (candidates.length > MAX_REFERENCES) {
    const dropped = candidates.slice(MAX_REFERENCES).map((c) => c.name);
    warnings.push(
      `found ${candidates.length} images; truncated to ${MAX_REFERENCES} most-recent. Dropped: ${dropped.join(', ')}`,
    );
    selected = candidates.slice(0, MAX_REFERENCES);
  }

  // Sniff dimensions and warn on small images.
  for (const c of selected) {
    const width = sniffImageWidth(c.abs);
    if (width === null) {
      warnings.push(`${c.name}: could not sniff image width; ensure it's a valid PNG/JPEG`);
    } else if (width < MIN_USEFUL_WIDTH) {
      warnings.push(`${c.name}: width ${width}px is below recommended ${MIN_USEFUL_WIDTH}px; analysis may be low-fidelity`);
    }
  }

  const manifest = {
    referenceCount: selected.length,
    files: selected.map((c) => c.abs),
    warnings,
    ready: selected.length > 0,
  };

  const manifestPath = join(outDir, 'references-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // Human-readable summary on stderr so the command can still pipe stdout.
  console.error(`prepare-references: wrote ${manifestPath}`);
  console.error(`  referenceCount: ${manifest.referenceCount}`);
  console.error(`  ready: ${manifest.ready}`);
  if (warnings.length > 0) {
    console.error('  warnings:');
    for (const w of warnings) console.error(`    - ${w}`);
  }
  if (!manifest.ready) {
    console.error(
      '  note: no eligible reference images found. The calling command can skip reference analysis.',
    );
  }
}

main();
