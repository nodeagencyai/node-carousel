#!/usr/bin/env node
// sample-pixels.mjs — pixel-level color extraction from hero screenshots (v0.8 A.1 + A.2).
//
// No new dependencies: uses Node's built-in `zlib.inflateSync` to decode the
// IDAT chunk of 1×1 PNGs that Puppeteer emits when we clip `page.screenshot`
// to a single pixel. We take a grid of ~13 samples across the hero and
// cluster near-duplicates via deltaE76 (imported from extract-brand-signals)
// to discover dominant colors + glow regions without leaving the Node
// runtime. Motivation: CSS-derived colors miss image/gradient backgrounds
// (TPS hero's flanking blue glow is baked into a background image, not CSS),
// so we supplement brandVariables with pixel-sampled dominants.
//
// Exports:
//   parsePngPixel(base64)             -> { r, g, b } | null
//   samplePixelsFromHero(page, vp?)   -> Array<{ x, y, rgb, hex }>
//   clusterDominantColors(samples, t?) -> Array<{ hex, count, role }>
//   detectGlow(samples)               -> { detected, color, position, confidence }
//
// See plan 2026-04-22-v0.8 A.1+A.2 for spec & rationale.

import zlib from 'node:zlib';
import { deltaE76 } from './extract-brand-signals.mjs';

// ---------------- Color helpers (local — keep module self-contained) ----------------

function rgbToHex({ r, g, b }) {
  const clamp = (v) => Math.max(0, Math.min(255, v | 0));
  const hex = (v) => clamp(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function hexToRgb(hex) {
  const s = String(hex).replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// HSL-style saturation in [0,1]: 0 = pure grey, 1 = fully saturated.
function saturation(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

// ---------------- 1. parsePngPixel ----------------

/**
 * Decode a 1×1 PNG (base64) into { r, g, b }.
 *
 * PNG structure: 8-byte signature, then length-prefixed typed chunks.
 * We skip the signature, scan chunks until IDAT, inflate its payload with
 * stdlib zlib, then read the first scanline: byte 0 is the filter type
 * (always 0 for a 1×1 image Puppeteer gives us), followed by RGB (or RGBA)
 * bytes. Returns null if the PNG is malformed (no IDAT found).
 */
export function parsePngPixel(base64) {
  const buf = Buffer.from(base64, 'base64');
  let offset = 8; // skip PNG signature
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      const data = buf.slice(offset + 8, offset + 8 + length);
      let inflated;
      try {
        inflated = zlib.inflateSync(data);
      } catch {
        return null;
      }
      // inflated[0] = filter type (0 for 1×1), then RGB bytes follow.
      if (inflated.length < 4) return null;
      return {
        r: inflated[1],
        g: inflated[2],
        b: inflated[3],
      };
    }
    offset += 8 + length + 4; // 4-byte length + 4-byte type + data + 4-byte CRC
  }
  return null;
}

// ---------------- 2. samplePixelsFromHero ----------------

/**
 * Build the 13-point sample grid. Separated so tests can inspect coordinates
 * without a live Puppeteer page.
 *
 * 9 points from a 3×3 grid at 25%/50%/75% + 4 corners at 10%/90% offsets =
 * 13 total (dead-center would be 50%/50% which is already in the grid).
 */
function buildSampleGrid(width, height) {
  const points = [];
  const gridFracs = [0.25, 0.5, 0.75];
  for (const fy of gridFracs) {
    for (const fx of gridFracs) {
      points.push({ x: Math.round(fx * width), y: Math.round(fy * height) });
    }
  }
  const corners = [
    [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9],
  ];
  for (const [fx, fy] of corners) {
    points.push({ x: Math.round(fx * width), y: Math.round(fy * height) });
  }
  return points;
}

/**
 * Sample 13 points from the hero viewport via Puppeteer's single-pixel
 * clipped screenshot. Returns `Array<{ x, y, rgb, hex }>`. Failures for
 * individual points are skipped (defensive — we'd rather return 12 points
 * than fail the whole scan because one screenshot call threw).
 */
export async function samplePixelsFromHero(page, viewport = { width: 1440, height: 900 }) {
  const points = buildSampleGrid(viewport.width, viewport.height);
  const out = [];
  for (const { x, y } of points) {
    let base64;
    try {
      base64 = await page.screenshot({
        clip: { x, y, width: 1, height: 1 },
        encoding: 'base64',
        type: 'png',
      });
    } catch {
      continue;
    }
    const rgb = parsePngPixel(base64);
    if (!rgb) continue;
    out.push({ x, y, rgb, hex: rgbToHex(rgb) });
  }
  return out;
}

// ---------------- 3. clusterDominantColors ----------------

/**
 * Cluster sample points by perceptual color distance (deltaE76) and assign
 * semantic roles:
 *   - Largest cluster         -> "background"
 *   - Most saturated (sat>=0.5, count>=2)  -> "accent"
 *   - Second most saturated  (lum>=0.5)    -> "glow"
 *   - Others                  -> null
 *
 * Returns `[{ hex, count, role }, ...]` sorted by count descending. The first
 * sample in each cluster is retained as the cluster's representative hex.
 */
export function clusterDominantColors(samples, threshold = 25) {
  if (!Array.isArray(samples) || samples.length === 0) return [];

  // Group samples by deltaE76 proximity. clusters: Array<{ hex, count }>
  const clusters = [];
  for (const s of samples) {
    if (!s || !s.hex) continue;
    const existing = clusters.find((c) => deltaE76(c.hex, s.hex) <= threshold);
    if (existing) {
      existing.count += 1;
    } else {
      clusters.push({ hex: s.hex, count: 1 });
    }
  }

  // Sort by count desc (stable: first-seen wins on ties via Array.sort stability).
  clusters.sort((a, b) => b.count - a.count);

  // Assign roles.
  const results = clusters.map((c) => ({ hex: c.hex, count: c.count, role: null }));
  if (results.length === 0) return results;

  // Largest cluster → background.
  results[0].role = 'background';

  // Most saturated cluster with saturation >= 0.5 AND count >= 2 → accent.
  // We only consider clusters that aren't already `background` so the
  // background-as-accent edge case can't steal the slot.
  const accentCandidates = results
    .slice(1)
    .filter((r) => r.count >= 2 && saturation(r.hex) >= 0.5)
    .sort((a, b) => saturation(b.hex) - saturation(a.hex));
  if (accentCandidates.length > 0) {
    accentCandidates[0].role = 'accent';
  }

  // Second most saturated (luminance >= 0.5) → glow. Picks from clusters not
  // already labelled. Tolerates missing candidates (1-cluster or mono cases).
  const glowCandidates = results
    .filter((r) => r.role === null && luminance(r.hex) >= 0.5)
    .sort((a, b) => saturation(b.hex) - saturation(a.hex));
  if (glowCandidates.length > 0) {
    glowCandidates[0].role = 'glow';
  }

  return results;
}

// ---------------- 4. detectGlow ----------------

/**
 * Detect a glow region in the sampled hero. A glow-eligible point is bright
 * AND saturated (lum >= 0.4 && sat >= 0.6). We need >= 2 eligible points to
 * call it detected — any fewer and we're likely looking at a stray CTA pixel.
 *
 * Position heuristic based on eligible point coordinates (as fractions of
 * viewport width/height — normalized per-sample so the same thresholds work
 * for any viewport size):
 *   - All x < 30%            → "left"
 *   - All x > 70%            → "right"
 *   - Mix of left + right    → "flanking"   (TPS hero signature)
 *   - Concentrated top (y<30) → "top-center"
 *   - Concentrated center    → "center"     (x,y both in [40%, 60%])
 *   - Otherwise              → "scattered"
 *
 * Confidence: `min(1.0, eligibleCount / 4)` — 4+ eligible points = 1.0.
 */
export function detectGlow(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { detected: false, color: null, position: null, confidence: 0 };
  }

  // Derive viewport extent from the samples themselves (max x,y observed).
  // This works because our grid always includes 90%-corner points, so max
  // values approximate the width/height closely enough for position binning.
  // Fall back to 1440×900 if we somehow get a single-point input.
  let maxX = 0;
  let maxY = 0;
  for (const s of samples) {
    if (typeof s?.x === 'number' && s.x > maxX) maxX = s.x;
    if (typeof s?.y === 'number' && s.y > maxY) maxY = s.y;
  }
  if (maxX === 0) maxX = 1440;
  if (maxY === 0) maxY = 900;

  const eligible = samples.filter((s) => {
    if (!s?.hex) return false;
    return luminance(s.hex) >= 0.4 && saturation(s.hex) >= 0.6;
  });

  if (eligible.length < 2) {
    return {
      detected: false,
      color: null,
      position: null,
      confidence: Math.min(1.0, eligible.length / 4),
    };
  }

  // Color: most common hex among eligible points.
  const hexCounts = new Map();
  for (const p of eligible) {
    hexCounts.set(p.hex, (hexCounts.get(p.hex) || 0) + 1);
  }
  const color = Array.from(hexCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];

  // Position classification.
  const fracs = eligible.map((p) => ({ fx: p.x / maxX, fy: p.y / maxY }));
  const allLeft = fracs.every((f) => f.fx < 0.3);
  const allRight = fracs.every((f) => f.fx > 0.7);
  const anyLeft = fracs.some((f) => f.fx < 0.3);
  const anyRight = fracs.some((f) => f.fx > 0.7);
  const allTop = fracs.every((f) => f.fy < 0.3);
  const allCenter = fracs.every(
    (f) => f.fx >= 0.4 && f.fx <= 0.6 && f.fy >= 0.4 && f.fy <= 0.6,
  );

  let position;
  if (allLeft) position = 'left';
  else if (allRight) position = 'right';
  else if (anyLeft && anyRight) position = 'flanking';
  else if (allTop) position = 'top-center';
  else if (allCenter) position = 'center';
  else position = 'scattered';

  return {
    detected: true,
    color,
    position,
    confidence: Math.min(1.0, eligible.length / 4),
  };
}

// Exposed for tests that want to reach into internals without re-implementing.
export const __testing = {
  buildSampleGrid,
  rgbToHex,
  hexToRgb,
  luminance,
  saturation,
};
