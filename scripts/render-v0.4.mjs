#!/usr/bin/env node
// render-v0.4.mjs — procedural carousel rendering.
// Samples variation axes from a seeded RNG; fills pattern templates with
// tokens + slide data. Determinism: same (brand, topic) → byte-identical SVGs.
//
// Module API:
//   renderCarousel({ brand, strategy, outputDir, pluginRoot })
//     → writes slide-NN.svg + _axes.json to outputDir
//
// CLI:
//   node scripts/render-v0.4.mjs <brand-profile.json> <strategy.json> <output-dir>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TYPE,
  letterSpacingForSize,
  lineHeightForSize,
  fontStack,
} from '../tokens/typography.js';
import { SPACING, opticalSpacing } from '../tokens/spacing.js';
import { CANVAS, GRID, COLS, ANCHORS } from '../tokens/grid.js';
import { buildColorRoles } from '../tokens/color-roles.js';
import { createRng, buildSeed } from '../tokens/seeded-random.js';
import { sampleCarouselAxes } from '../tokens/axes.js';
import {
  fillTemplate,
  escapeXml,
  escapeValues,
  fontUrl,
  buildBackgroundValues,
  renderBackground as renderBackgroundV03,
  renderDecorations,
  renderNumbering,
} from './shared-render.mjs';
import { getIcon } from '../tokens/icon-library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const MANIFEST = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, 'patterns', 'manifest.json'), 'utf8'),
);
const PATTERN_BY_ID = Object.fromEntries(MANIFEST.patterns.map((p) => [p.id, p]));

// v0.4 extends the v0.3 background enum with three additional types:
//   dot-grid, geometric-shapes, glow-sphere
// Shared-render.mjs still owns solid/gradient/mesh/radial/image so v0.3 stays
// frozen. v0.4-only types are rendered by `renderBackgroundV04` below.
// v0.4.3 adds `noise-gradient`.
const V04_BACKGROUND_TYPES = new Set([
  'dot-grid',
  'geometric-shapes',
  'glow-sphere',
  'noise-gradient',
]);
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// v0.4.3 — curated feTurbulence parameter sets for the 6 noise types.
// Each type maps to a distinct visual texture. baseFreq values were tuned by
// visual inspection on 1080x1350 canvases against dark backgrounds.
const NOISE_TYPE_CONFIG = {
  film:       { turbType: 'fractalNoise', baseFreq: 0.9,  octaves: 2, extra: '' },
  static:     { turbType: 'turbulence',   baseFreq: 0.55, octaves: 3, extra: '' },
  organic:    { turbType: 'fractalNoise', baseFreq: 0.35, octaves: 4, extra: '' },
  grit:       { turbType: 'fractalNoise', baseFreq: 1.3,  octaves: 3, extra: '' },
  'ink-wash': {
    turbType: 'fractalNoise',
    baseFreq: 0.25,
    octaves: 5,
    extra: '<feGaussianBlur stdDeviation="1.5"/>',
  },
  dither: {
    turbType: 'turbulence',
    baseFreq: 2.0,
    octaves: 1,
    extra: '<feComponentTransfer><feFuncA type="discrete" tableValues="0 0 0 0.8 0.8"/></feComponentTransfer>',
  },
};

const NOISE_TYPES = new Set(Object.keys(NOISE_TYPE_CONFIG));

/**
 * Resolve the noise config for a background. Accepts the new v0.4.3 `noise`
 * block or the legacy v0.4.2 `grain` block (mapped to `noise.type='film'`).
 *
 * Returns the normalized noise config { enabled, type, intensity, scale } or
 * `null` if no noise is configured / enabled.
 */
function resolveNoiseConfig(bg) {
  if (bg?.noise && typeof bg.noise === 'object') {
    return bg.noise;
  }
  if (bg?.grain && typeof bg.grain === 'object' && bg.grain.enabled === true) {
    // Legacy grain → film noise. Old baseFrequency becomes scale (where 0.9 is
    // the neutral baseline that produces identical output to v0.4.2 grain).
    return {
      enabled: true,
      type: 'film',
      intensity: bg.grain.intensity ?? 0.12,
      scale: (bg.grain.baseFrequency ?? 0.9) / 0.9,
    };
  }
  return null;
}

/**
 * Validate a brand profile for v0.4-specific extensions.
 *
 * Only validates the 3 NEW background types + grain (which v0.3 also handles but
 * we re-check defensively). Falls back to permissive "don't break existing
 * profiles" on missing/optional fields — everything has a sensible default.
 *
 * For `solid/gradient/mesh/radial/image`: v0.3 render.mjs owns that validation;
 * here we just skip — render-v0.4 may be called with v0.3-era brand profiles.
 */
export function validateBrand(brand) {
  const schemaRef = 'See docs/brand-profile-schema.md for the full schema.';
  const fail = (msg) => {
    throw new Error(`Invalid brand-profile.json: ${msg}. ${schemaRef}`);
  };
  if (!brand || typeof brand !== 'object') fail('expected an object');
  const bg = brand?.visual?.background;
  if (!bg || typeof bg !== 'object') return;

  // v0.4.3 — validate the optional `noise` block on ANY background type
  // (including v0.3 types like solid/gradient/mesh/radial/image). This is the
  // replacement for the old `grain` block.
  if (bg.noise !== undefined && bg.noise !== null) {
    if (typeof bg.noise !== 'object') fail('background.noise must be an object if present');
    const n = bg.noise;
    if (n.type !== undefined && !NOISE_TYPES.has(n.type)) {
      fail(`background.noise.type must be one of: ${[...NOISE_TYPES].join(', ')}`);
    }
    if (n.intensity !== undefined && (typeof n.intensity !== 'number' || !Number.isFinite(n.intensity) || n.intensity < 0 || n.intensity > 1)) {
      fail('background.noise.intensity must be a number between 0 and 1');
    }
    if (n.scale !== undefined && (typeof n.scale !== 'number' || !Number.isFinite(n.scale) || n.scale <= 0)) {
      fail('background.noise.scale must be a positive number');
    }
  }

  const type = bg.type;
  if (!V04_BACKGROUND_TYPES.has(type)) return; // v0.3 types handled elsewhere

  if (type === 'dot-grid') {
    // All optional. Validate shape if provided.
    const dg = bg.dotGrid;
    if (dg !== undefined && dg !== null) {
      if (typeof dg !== 'object') fail('background.dotGrid must be an object if present');
      if (dg.spacing !== undefined && (typeof dg.spacing !== 'number' || !Number.isFinite(dg.spacing) || dg.spacing <= 0)) {
        fail('background.dotGrid.spacing must be a positive number');
      }
      if (dg.dotSize !== undefined && (typeof dg.dotSize !== 'number' || !Number.isFinite(dg.dotSize) || dg.dotSize <= 0)) {
        fail('background.dotGrid.dotSize must be a positive number');
      }
      if (dg.dotColor !== undefined && (typeof dg.dotColor !== 'string' || !HEX_RE.test(dg.dotColor))) {
        fail('background.dotGrid.dotColor must be a hex string like "#29F2FE"');
      }
      if (dg.opacity !== undefined && (typeof dg.opacity !== 'number' || !Number.isFinite(dg.opacity) || dg.opacity < 0 || dg.opacity > 1)) {
        fail('background.dotGrid.opacity must be a number between 0 and 1');
      }
    }
  } else if (type === 'geometric-shapes') {
    // shapes is optional; when present must be array of shape objects.
    if (bg.shapes !== undefined && bg.shapes !== null) {
      if (!Array.isArray(bg.shapes)) fail('background.shapes must be an array if present');
      bg.shapes.forEach((s, i) => {
        if (!s || typeof s !== 'object') fail(`background.shapes[${i}] must be an object`);
        // v0.4.1 supports circles only; skip type check but require cx/cy/r numeric
        for (const key of ['cx', 'cy', 'r']) {
          if (s[key] !== undefined && typeof s[key] !== 'number' && typeof s[key] !== 'string') {
            fail(`background.shapes[${i}].${key} must be number or string`);
          }
        }
        if (s.fill !== undefined && typeof s.fill !== 'string') {
          fail(`background.shapes[${i}].fill must be a string`);
        }
      });
    }
  } else if (type === 'glow-sphere') {
    if (bg.glow !== undefined && bg.glow !== null) {
      if (typeof bg.glow !== 'object') fail('background.glow must be an object if present');
      const g = bg.glow;
      for (const key of ['from', 'to']) {
        if (g[key] !== undefined && (typeof g[key] !== 'string' || !HEX_RE.test(g[key]))) {
          fail(`background.glow.${key} must be a hex string`);
        }
      }
      if (g.opacity !== undefined && (typeof g.opacity !== 'number' || g.opacity < 0 || g.opacity > 1)) {
        fail('background.glow.opacity must be a number between 0 and 1');
      }
    }
  } else if (type === 'noise-gradient') {
    // v0.4.3 — noise baked into gradient via mix-blend-mode.
    if (bg.noiseGradient === undefined || bg.noiseGradient === null) {
      fail('background.noiseGradient is required when type === "noise-gradient"');
    }
    if (typeof bg.noiseGradient !== 'object') fail('background.noiseGradient must be an object');
    const ng = bg.noiseGradient;
    for (const key of ['from', 'to']) {
      if (ng[key] === undefined) fail(`background.noiseGradient.${key} is required (hex string)`);
      if (typeof ng[key] !== 'string' || !HEX_RE.test(ng[key])) {
        fail(`background.noiseGradient.${key} must be a hex string`);
      }
    }
    if (ng.angle !== undefined && (typeof ng.angle !== 'number' || !Number.isFinite(ng.angle))) {
      fail('background.noiseGradient.angle must be a number');
    }
    if (ng.noiseType !== undefined && !NOISE_TYPES.has(ng.noiseType)) {
      fail(`background.noiseGradient.noiseType must be one of: ${[...NOISE_TYPES].join(', ')}`);
    }
    if (ng.noiseIntensity !== undefined && (typeof ng.noiseIntensity !== 'number' || ng.noiseIntensity < 0 || ng.noiseIntensity > 1)) {
      fail('background.noiseGradient.noiseIntensity must be a number between 0 and 1');
    }
  }
}

/**
 * Build v0.4-specific background values for the 3 new types.
 * Returns token→value map to merge into baseValues before snippet fill.
 */
function buildV04BackgroundValues(brand, baseValues) {
  const bg = brand.visual?.background || {};
  const type = bg.type;
  const values = {};

  if (type === 'dot-grid') {
    const dg = bg.dotGrid || {};
    const spacing = dg.spacing ?? 40;
    values.DOT_GRID_SPACING = spacing;
    values.DOT_GRID_HALF_SPACING = spacing / 2;
    values.DOT_GRID_DOT_SIZE = dg.dotSize ?? 1.5;
    values.DOT_GRID_DOT_COLOR = dg.dotColor ?? baseValues.COLOR_ACCENT;
    values.DOT_GRID_DOT_OPACITY = dg.opacity ?? 0.25;
  } else if (type === 'geometric-shapes') {
    const shapes = Array.isArray(bg.shapes) ? bg.shapes : [];
    for (let i = 0; i < 5; i++) {
      const n = i + 1;
      const s = shapes[i];
      if (s) {
        values[`SHAPE_${n}_CX`] = s.cx ?? 0;
        values[`SHAPE_${n}_CY`] = s.cy ?? 0;
        values[`SHAPE_${n}_R`] = s.r ?? 0;
        values[`SHAPE_${n}_FILL`] = s.fill ?? 'none';
        values[`SHAPE_${n}_STROKE`] = s.stroke ?? 'none';
        values[`SHAPE_${n}_STROKE_WIDTH`] = s.strokeWidth ?? 0;
        values[`SHAPE_${n}_OPACITY`] = s.opacity ?? 0.4;
      } else {
        // Invisible defaults — shape renders but at opacity 0 / r=0
        values[`SHAPE_${n}_CX`] = 0;
        values[`SHAPE_${n}_CY`] = 0;
        values[`SHAPE_${n}_R`] = 0;
        values[`SHAPE_${n}_FILL`] = 'none';
        values[`SHAPE_${n}_STROKE`] = 'none';
        values[`SHAPE_${n}_STROKE_WIDTH`] = 0;
        values[`SHAPE_${n}_OPACITY`] = 0;
      }
    }
  } else if (type === 'glow-sphere') {
    const g = bg.glow || {};
    values.GLOW_CX = g.cx ?? '50%';
    values.GLOW_CY = g.cy ?? '-20%';
    values.GLOW_R = g.r ?? '80%';
    values.GLOW_FROM = g.from ?? baseValues.COLOR_ACCENT;
    values.GLOW_TO = g.to ?? bg.color ?? baseValues.SURFACE ?? '#000000';
    values.GLOW_OPACITY = g.opacity ?? 0.5;
  } else if (type === 'noise-gradient') {
    const ng = bg.noiseGradient || {};
    const noiseTypeName = ng.noiseType ?? 'organic';
    const noiseCfg = NOISE_TYPE_CONFIG[noiseTypeName] || NOISE_TYPE_CONFIG.organic;
    values.NG_FROM = ng.from ?? baseValues.COLOR_ACCENT;
    values.NG_TO = ng.to ?? bg.color ?? '#000000';
    values.NG_ANGLE = ng.angle ?? 135;
    values.NG_TURB_TYPE = noiseCfg.turbType;
    values.NG_BASE_FREQ = noiseCfg.baseFreq;
    values.NG_OCTAVES = noiseCfg.octaves;
    values.NG_INTENSITY = ng.noiseIntensity ?? 0.18;
  }

  return values;
}

/**
 * v0.4 background renderer.
 * Routes v0.4-only types through new snippets; delegates others to v0.3 path
 * in shared-render.mjs. Noise overlay is appended for both paths (v0.4.3+);
 * legacy grain config auto-maps to noise.type='film' via resolveNoiseConfig.
 */
function renderBackgroundV04({ brand, pluginRoot, baseValues }) {
  const bg = brand.visual?.background || {};
  const type = bg.type || 'solid';

  // v0.3 bg snippets (solid/gradient/mesh/radial/image) need placeholder values
  // like MESH_BLOB_N_CX, GRADIENT_ANGLE, IMAGE_HREF, etc. v0.3's render.mjs
  // computed these via buildBackgroundValues and passed them in baseValues.
  // v0.4's baseValues didn't include them — meaning v0.3-delegated backgrounds
  // (used by most presets) rendered with empty placeholders. Fix: merge them
  // into baseValues before delegating.
  baseValues = { ...baseValues, ...buildBackgroundValues(brand) };

  let out;
  let merged;

  if (!V04_BACKGROUND_TYPES.has(type)) {
    // Defer to v0.3 implementation for solid/gradient/mesh/radial/image.
    // shared-render's renderBackground handles its own grain overlay for
    // v0.3-era brand profiles (grain block only). We intentionally call it
    // WITHOUT grain so v0.4.3 `noise` config takes precedence — we re-apply
    // noise below via the unified resolveNoiseConfig path.
    //
    // Temporarily strip grain from the brand so renderBackgroundV03 doesn't
    // double-apply it when the v0.4.3 `noise` key is also present.
    const hasNoise = bg.noise !== undefined && bg.noise !== null;
    if (hasNoise) {
      const strippedBg = { ...bg };
      delete strippedBg.grain;
      const strippedBrand = {
        ...brand,
        visual: { ...brand.visual, background: strippedBg },
      };
      out = renderBackgroundV03({ brand: strippedBrand, pluginRoot, baseValues });
    } else {
      // Legacy grain config path — shared-render handles it natively.
      out = renderBackgroundV03({ brand, pluginRoot, baseValues });
      // When shared-render's built-in grain fires, we've already rendered the
      // noise. Skip the unified noise append below.
      merged = baseValues;
      return out;
    }
    merged = baseValues;
  } else {
    const fileMap = {
      'dot-grid': '_background-dot-grid.svg',
      'geometric-shapes': '_background-geometric-shapes.svg',
      'glow-sphere': '_background-glow-sphere.svg',
      'noise-gradient': '_background-noise-gradient.svg',
    };
    const path = join(pluginRoot, 'templates', fileMap[type]);
    const snippet = readFileSync(path, 'utf8');

    // Merge v0.4 bg values into baseValues so snippet placeholders resolve.
    const v04Values = buildV04BackgroundValues(brand, baseValues);
    merged = { ...baseValues, ...v04Values };
    const escaped = escapeValues(merged);
    out = fillTemplate(snippet, escaped);
  }

  // Noise overlay (v0.4.3) — resolveNoiseConfig accepts both the new
  // `background.noise` block AND legacy `background.grain` (auto-mapped to
  // noise.type='film'). For v0.3 types, legacy grain is handled by
  // renderBackgroundV03 itself (skipped above).
  const noise = resolveNoiseConfig(bg);
  if (noise && noise.enabled === true) {
    const noiseTypeName = noise.type ?? 'film';
    const cfg = NOISE_TYPE_CONFIG[noiseTypeName] || NOISE_TYPE_CONFIG.film;
    const scale = noise.scale ?? 1.0;
    const noisePath = join(pluginRoot, 'templates', '_noise-filter.svg');
    const noiseSnippet = readFileSync(noisePath, 'utf8');
    const noiseValues = {
      ...merged,
      NOISE_TURB_TYPE: cfg.turbType,
      NOISE_BASE_FREQ: cfg.baseFreq * scale,
      NOISE_OCTAVES: cfg.octaves,
      NOISE_EXTRA_FILTERS: cfg.extra,
      NOISE_INTENSITY: noise.intensity ?? 0.12,
    };
    // NOISE_EXTRA_FILTERS contains raw SVG markup — must not be escaped.
    const escapedNoise = escapeValues(noiseValues, ['NOISE_EXTRA_FILTERS']);
    out += fillTemplate(noiseSnippet, escapedNoise);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Icon system (v0.4.1) — curated library + optional AI-generated inline SVG
// ---------------------------------------------------------------------------

/**
 * Inline-icon SVG safe-bounds validator. Returns the (trusted) SVG content on
 * success or `null` on failure; on failure logs a warning — caller falls back
 * to empty icon slot.
 *
 * `maxBytes` is the upper size budget: 4KB for author-inline SVG (AI-generated,
 * never trusted), 8KB for user-provided files (trusted on-disk asset).
 */
function validateIconSvg(svg, maxBytes = 4000) {
  if (typeof svg !== 'string') {
    console.warn('\u26a0  Icon: svg must be a string — falling back to empty');
    return null;
  }
  if (svg.length > maxBytes) {
    console.warn(`\u26a0  Icon: SVG too large (${svg.length} bytes > ${maxBytes}) — falling back to empty`);
    return null;
  }
  const forbidden = /<\s*(script|foreignObject|image|iframe|style)\b/i;
  if (forbidden.test(svg)) {
    console.warn('\u26a0  Icon: contains forbidden element (script/foreignObject/image/iframe/style) — falling back to empty');
    return null;
  }
  const hexMatches = svg.match(/#[0-9a-fA-F]{6}\b/g);
  if (hexMatches && hexMatches.length) {
    console.warn(`\u26a0  Icon: uses hardcoded hex color(s) ${hexMatches.join(', ')} — must use currentColor. Falling back to empty`);
    return null;
  }
  return svg;
}

/**
 * Extract the inner content of an <svg>...</svg> wrapper — everything BETWEEN
 * the opening `<svg ...>` tag's closing `>` and the final `</svg>`. Used when
 * reading a user's SVG file from disk: the outer <svg> wrapper is stripped
 * because the pattern's <g color="..."> wrapper handles color + transform.
 *
 * Returns null on malformed input.
 */
function extractSvgInner(svgText) {
  const svgOpenIndex = svgText.indexOf('<svg');
  if (svgOpenIndex < 0) return null;
  const openTagEnd = svgText.indexOf('>', svgOpenIndex);
  const closeTagStart = svgText.lastIndexOf('</svg>');
  if (openTagEnd < 0 || closeTagStart < 0 || closeTagStart <= openTagEnd) {
    return null; // malformed
  }
  return svgText.substring(openTagEnd + 1, closeTagStart).trim();
}

/**
 * Read an SVG file relative to the strategy's directory, strip the outer <svg>
 * wrapper, validate with the user-file size budget, and return inner primitives.
 *
 * Returns null (and logs a warning) on any failure — caller falls back to
 * empty icon slot. Never throws.
 */
function loadIconFromFile(filePath, strategyDir) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    console.warn('\u26a0  Icon: file path must be a non-empty string — falling back to empty');
    return null;
  }
  const baseDir = strategyDir || process.cwd();
  const resolvedPath = resolve(baseDir, filePath);
  let text;
  try {
    text = readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    console.warn(`\u26a0  Icon: could not read file "${filePath}" (resolved: ${resolvedPath}): ${err.message} — falling back to empty`);
    return null;
  }
  const inner = extractSvgInner(text);
  if (inner === null) {
    console.warn(`\u26a0  Icon: file "${filePath}" is not a valid SVG (missing <svg>...</svg> wrapper) — falling back to empty`);
    return null;
  }
  // 8KB budget for user-provided files (vs 4KB for AI-inline)
  return validateIconSvg(inner, 8000);
}

// ---------------------------------------------------------------------------
// Logo slot (v0.4.2) — brand-wide logo on cover + CTA patterns
// ---------------------------------------------------------------------------

/**
 * Parse an SVG root's viewBox into its intrinsic width/height. Used to compute
 * a viewBox-aware scale factor so wide logos (e.g. 200x50 wordmarks extracted
 * from a site header) render proportionally instead of being stretched to a
 * square 24x24 assumption.
 *
 * Fallback = 24x24 (Lucide convention). This covers:
 *   - Logos with no viewBox attribute (we still wrap them in `<g transform>`
 *     and accept that width/height attrs on the source SVG may leak through).
 *   - Malformed viewBox values.
 *   - Legacy 24x24 icons that happen to round-trip correctly anyway.
 *
 * @param {string} svgText — raw SVG source
 * @returns {{ width: number, height: number }}
 */
export function parseViewBox(svgText) {
  if (typeof svgText !== 'string') return { width: 24, height: 24 };
  const m = svgText.match(/viewBox\s*=\s*["']([\d.\s-]+)["']/i);
  if (!m) return { width: 24, height: 24 };
  const parts = m[1].split(/\s+/).map(Number).filter(Number.isFinite);
  if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
    return { width: parts[2], height: parts[3] };
  }
  return { width: 24, height: 24 };
}

/**
 * Compute translate(x, y) + scale(s) for a source SVG placed in one of 4
 * canvas corners, sized to `size` px, inset by GRID.sideMargin from both edges
 * (matches cover-asymmetric kicker inset).
 *
 * `scale` is derived from the caller's viewBox so that the longest edge of the
 * logo fits to `size`. Callers that don't know the source viewBox can pass
 * `{ width: 24, height: 24 }` to get the legacy behavior.
 */
function logoTransform(position, size, canvasWidth, canvasHeight, viewBox = { width: 24, height: 24 }) {
  const margin = GRID.sideMargin; // 72 by default
  const longestEdge = Math.max(viewBox.width || 24, viewBox.height || 24);
  const scale = size / longestEdge;
  let x, y;
  switch (position) {
    case 'top-right':
      x = canvasWidth - margin - size;
      y = margin;
      break;
    case 'bottom-left':
      x = margin;
      y = canvasHeight - margin - size;
      break;
    case 'bottom-right':
      x = canvasWidth - margin - size;
      y = canvasHeight - margin - size;
      break;
    case 'top-left':
    default:
      x = margin;
      y = margin;
      break;
  }
  return { x, y, scale };
}

const LOGO_POSITIONS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

// Raster logo support (v0.6.1) — sites without a semantic header fall back to
// favicon (.ico/.png), which the SVG-only loadIconFromFile rejects. Accept
// raster files via an embedded <image href="data:..."> tag instead.
const RASTER_LOGO_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

// Cap embedded raster size at 512KB — favicon/PNG logos are typically <20KB, so
// anything larger is either a mistake or a content-filled hero image.
const RASTER_LOGO_MAX_BYTES = 512 * 1024;

function rasterLogoExtension(filePath) {
  const lower = filePath.toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex < 0) return null;
  const ext = lower.substring(dotIndex);
  return RASTER_LOGO_EXTENSIONS[ext] || null;
}

/**
 * Load a raster image file and return a data-URI string
 * (data:<mime>;base64,<b64>). Returns null (+ warns) on any failure.
 */
function loadRasterLogoDataUri(filePath, strategyDir, mimeType) {
  const baseDir = strategyDir || process.cwd();
  const resolvedPath = resolve(baseDir, filePath);
  let buf;
  try {
    buf = readFileSync(resolvedPath);
  } catch (err) {
    console.warn(`\u26a0  Logo: could not read raster file "${filePath}" (resolved: ${resolvedPath}): ${err.message} — falling back to empty`);
    return null;
  }
  if (buf.length > RASTER_LOGO_MAX_BYTES) {
    console.warn(`\u26a0  Logo: raster file too large (${buf.length} bytes > ${RASTER_LOGO_MAX_BYTES}) — falling back to empty`);
    return null;
  }
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

/**
 * Resolve the brand logo into a raw SVG `<g>` element, positioned per
 * brand.visual.logo.position and sized per brand.visual.logo.size.
 *
 * Two rendering paths:
 *   - SVG files: inlined as `<g>` children (currentColor stroke, inherits
 *     ON_SURFACE so it reads on any brand surface).
 *   - Raster files (.png/.jpg/.ico/.gif/.webp): embedded via `<image href=
 *     "data:...">` tag. Colors are baked into the raster so no currentColor
 *     handling applies.
 *
 * Returns '' if:
 *   - no logo configured (backward compat with v0.4.1 brand profiles)
 *   - file missing / unreadable
 *   - validation fails (same safe-bounds as icons — no hex, no script, ≤8KB
 *     for SVG; ≤512KB for raster)
 *
 * `strategyDir` is the base dir for relative file paths (same as icons).
 */
function resolveLogo(brand, strategyDir) {
  const logo = brand?.visual?.logo;
  if (!logo || typeof logo !== 'object' || !logo.file) return '';

  const rawPosition = typeof logo.position === 'string' ? logo.position : 'top-left';
  const position = LOGO_POSITIONS.has(rawPosition) ? rawPosition : 'top-left';
  if (!LOGO_POSITIONS.has(rawPosition)) {
    console.warn(`\u26a0  Logo: unknown position "${rawPosition}" — falling back to "top-left"`);
  }

  const rawSize = typeof logo.size === 'number' && logo.size > 0 ? logo.size : 48;

  // Raster path: emit <image> with data-URI. Bypasses SVG-only validator.
  const rasterMime = rasterLogoExtension(logo.file);
  if (rasterMime) {
    const dataUri = loadRasterLogoDataUri(logo.file, strategyDir, rasterMime);
    if (!dataUri) return '';
    const margin = GRID.sideMargin;
    let x, y;
    switch (position) {
      case 'top-right':
        x = CANVAS.width - margin - rawSize; y = margin; break;
      case 'bottom-left':
        x = margin; y = CANVAS.height - margin - rawSize; break;
      case 'bottom-right':
        x = CANVAS.width - margin - rawSize; y = CANVAS.height - margin - rawSize; break;
      case 'top-left':
      default:
        x = margin; y = margin; break;
    }
    // href (SVG2) is supported by all modern renderers including Playwright's
    // Chromium (used by export-png). xlink:href kept off to avoid having to
    // add xmlns:xlink to every pattern template root.
    return `<g aria-label="logo"><image href="${escapeXml(dataUri)}" x="${x}" y="${y}" width="${rawSize}" height="${rawSize}" preserveAspectRatio="xMidYMid meet"/></g>`;
  }

  // SVG path (original behavior): inline as <g> with currentColor stroke.
  const inner = loadIconFromFile(logo.file, strategyDir);
  if (!inner) return ''; // warning already logged

  // Re-read the raw SVG to parse its viewBox — loadIconFromFile returns only
  // the stripped inner content, so we can't pull viewBox out of that. Read
  // failures here (file vanished between calls, permissions race) fall back
  // to the 24x24 default, preserving legacy behavior.
  let viewBox = { width: 24, height: 24 };
  try {
    const baseDir = strategyDir || process.cwd();
    const rawSvg = readFileSync(resolve(baseDir, logo.file), 'utf8');
    viewBox = parseViewBox(rawSvg);
  } catch {
    // swallowed — loadIconFromFile already succeeded, so any error here is a
    // race. Fall back to 24x24 default (legacy behavior).
  }

  const geo = logoTransform(position, rawSize, CANVAS.width, CANVAS.height, viewBox);

  // Logo uses ON_SURFACE color so it reads on both light and dark brand
  // surfaces. Authors can override at CSS level by embedding fill/stroke in
  // their source SVG — but hardcoded hex is banned by validateIconSvg, so the
  // source must use currentColor like the icon library.
  const roles = buildColorRoles(brand.visual?.colors || {});
  return `<g aria-label="logo" color="${roles.ON_SURFACE}" transform="translate(${geo.x} ${geo.y}) scale(${geo.scale})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

/**
 * Resolve a single icon specifier to raw SVG primitives (or empty on miss).
 * Accepts `{ library: "shield" }`, `{ svg: "<path…/>" }`, `{ file: "./icon.svg" }`,
 * or null/undefined.
 *
 * `strategyDir` is used as the base for resolving relative file paths — it's
 * the directory of the strategy.json, not the render script. Omitted (null) in
 * CLI fallback → process.cwd() is used.
 */
function resolveOneIcon(spec, strategyDir) {
  if (!spec || typeof spec !== 'object') return '';
  if (spec.library) {
    const content = getIcon(spec.library);
    if (!content) {
      console.warn(`\u26a0  Icon: unknown library name "${spec.library}" — falling back to empty`);
      return '';
    }
    return content;
  }
  if (spec.file) {
    const safe = loadIconFromFile(spec.file, strategyDir);
    return safe ?? '';
  }
  if (spec.svg) {
    const safe = validateIconSvg(spec.svg);
    return safe ?? '';
  }
  return '';
}

/**
 * Resolve icon slots for a slide. Returns an object with raw SVG strings:
 *   { ICON, ICON_LEFT, ICON_RIGHT }
 *
 * For single-icon patterns (stat-dominant, cover-asymmetric):
 *   slide.icon = { library: "shield" }            → ICON populated
 *   slide.icon = { svg: "<path .../>" }           → ICON populated (validated)
 *   slide.icon = { file: "./icon.svg" }           → ICON populated (read + validated)
 *
 * For split-comparison (two icons):
 *   slide.icon = { left: {...}, right: {...} }    → ICON_LEFT / ICON_RIGHT
 *
 * Missing icons → empty string (template renders `<g>` with no children).
 *
 * `strategyDir` — directory of the strategy.json file. Relative `file:` paths
 * resolve against this base (so users drop icons into their own project,
 * not into node-carousel's install dir).
 */
function resolveIconSlots(slide, strategyDir) {
  const out = { ICON: '', ICON_LEFT: '', ICON_RIGHT: '' };
  const icon = slide?.icon;
  if (!icon || typeof icon !== 'object') return out;

  // Compound (left/right) form for split-comparison
  if (icon.left || icon.right) {
    out.ICON_LEFT = resolveOneIcon(icon.left, strategyDir);
    out.ICON_RIGHT = resolveOneIcon(icon.right, strategyDir);
    return out;
  }
  // Single-icon form
  out.ICON = resolveOneIcon(icon, strategyDir);
  return out;
}

// Fonts not available on Google Fonts — served by Fontshare instead.
// Map family name → Fontshare slug.
const FONTSHARE_FONTS = {
  'Satoshi': 'satoshi',
  'Cabinet Grotesk': 'cabinet-grotesk',
  'Clash Display': 'clash-display',
  'Clash Grotesk': 'clash-grotesk',
  'Supreme': 'supreme',
  'General Sans': 'general-sans',
  'Zodiak': 'zodiak',
  'Gambarino': 'gambarino',
};

/**
 * Build one or two @import lines for a brand's display + body fonts.
 * Emits separate imports when fonts come from different sources
 * (Google Fonts vs Fontshare), dedupes when display === body.
 * Returns the string ready to inline inside an SVG <style> block.
 */
function buildFontImports(fonts) {
  const importOf = (name) => {
    if (!name) return null;
    const slug = FONTSHARE_FONTS[name];
    if (slug) {
      return `@import url('https://api.fontshare.com/v2/css?f[]=${slug}@400,500,700,900&amp;display=swap');`;
    }
    const googleSlug = String(name).replace(/\s+/g, '+');
    return `@import url('https://fonts.googleapis.com/css2?family=${googleSlug}:wght@400;500;700;800&amp;display=swap');`;
  };
  const seen = new Set();
  const lines = [];
  for (const name of [fonts?.display, fonts?.body]) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const line = importOf(name);
    if (line) lines.push(line);
  }
  return lines.join('\n      ');
}

// ---------------------------------------------------------------------------
// Token value construction
// ---------------------------------------------------------------------------

/**
 * Build the complete token→value map for a single slide.
 *
 * Keys compiled from the 8 pattern SVGs + 8 verify fixtures. If a pattern
 * adds a new placeholder, add it here. Empty-string default for unused keys
 * on a given pattern is fine — `fillTemplate` handles undefined → ''.
 */
function buildTokenValues(brand, axes, slideNumber, slideTotal) {
  const fonts = brand.visual.fonts || {};
  const colors = brand.visual.colors || {};
  const brandMeta = brand.brand || {};
  const roles = buildColorRoles(colors);

  const centerX = Math.round(CANVAS.width / 2);
  const centerY = Math.round(CANVAS.height / 2);

  // Pattern-specific derived geometry — ported from the 8 verify fixtures.
  // Kept here (not in grid.js) because it's pattern-layout-specific.

  // list-bullet / list-numbered: row spacing differs between the two
  const ROW_SPACING_BULLET = 88;
  const ROW_SPACING_NUMBERED = 96;

  // cta-stacked: pill geometry
  const buttonWidth = 560;
  const buttonHeight = 112;
  const buttonX = Math.round((CANVAS.width - buttonWidth) / 2); // 260
  const buttonY = 816;
  const buttonRx = Math.round(buttonHeight / 2); // 56
  const buttonTextY = buttonY + Math.round(buttonHeight * 0.642); // 888
  const subtextY = buttonY + buttonHeight + 64; // 992
  const hookDY = Math.round(TYPE.headline * 1.18); // 104

  return {
    // Canvas
    WIDTH: CANVAS.width,
    HEIGHT: CANVAS.height,
    CENTER_X: centerX,
    CENTER_Y: centerY,

    // Grid
    COL_1_X: COLS[0],
    WIDTH_MINUS_MARGIN: CANVAS.width - GRID.sideMargin,
    WIDTH_MINUS_100: CANVAS.width - 100,  // v0.3 compat token for shared decorations
    CORNER_TR_X: CANVAS.width - 60,       // top-right corner inset for corner-marks
    CORNER_BL_Y_START: CANVAS.height - 100, // vertical arm start for bottom corners
    CORNER_BL_Y_END: CANVAS.height - 60,    // corner vertex for bottom corners

    // Anchors (from tokens/grid.js)
    ANCHOR_FLAG_TOP: ANCHORS.FLAG_TOP,
    ANCHOR_FLAG_BOTTOM: ANCHORS.FLAG_BOTTOM,
    ANCHOR_GOLDEN_UPPER: ANCHORS.GOLDEN_UPPER,
    ANCHOR_OPTICAL_CENTER: ANCHORS.OPTICAL_CENTER,
    ANCHOR_CENTER: ANCHORS.CENTER,
    ANCHOR_BODY_TOP: ANCHORS.BODY_TOP,
    ANCHOR_BODY_BOTTOM: ANCHORS.BODY_BOTTOM,
    ANCHOR_FOOTER_TOP: ANCHORS.FOOTER_TOP,
    ANCHOR_FOOTER_CENTER: ANCHORS.FOOTER_CENTER,
    ANCHOR_FOOTER_BOTTOM: ANCHORS.FOOTER_BOTTOM,

    // Cover-asymmetric / cover-centered derived
    ACCENT_RULE_Y: ANCHORS.FLAG_TOP + 24,
    ACCENT_RULE_X_END: COLS[0] + 120,
    HEADLINE_BOTTOM_Y: 820,
    KICKER_CENTERED_Y: ANCHORS.FLAG_TOP + 80,

    // list-bullet / list-numbered derived
    LIST_GROUP_Y: ANCHORS.BODY_TOP + 192, // 552
    ROW_SPACING_BULLET,
    ROW_SPACING_BULLET_2: ROW_SPACING_BULLET * 2,
    ROW_SPACING_BULLET_3: ROW_SPACING_BULLET * 3,
    ROW_SPACING_BULLET_4: ROW_SPACING_BULLET * 4,
    ROW_SPACING_NUMBERED,
    ROW_SPACING_NUMBERED_2: ROW_SPACING_NUMBERED * 2,
    ROW_SPACING_NUMBERED_3: ROW_SPACING_NUMBERED * 3,
    ROW_SPACING_NUMBERED_4: ROW_SPACING_NUMBERED * 4,

    // stat-dominant derived
    ANCHOR_STAT_Y: 600,
    ANCHOR_STAT_LABEL_Y: 704,
    ANCHOR_STAT_CONTEXT_Y: 776,

    // quote-pulled derived
    ANCHOR_QUOTE_Y: 520,
    QUOTE_DY: 72,
    ANCHOR_QUOTE_ATTRIB_Y: 832,

    // split-comparison derived
    LEFT_ZONE_CENTER_X: 270,
    RIGHT_ZONE_CENTER_X: 810,
    ANCHOR_ZONE_LABEL_Y: 440,
    ANCHOR_LINE_1_Y: 560,
    ANCHOR_LINE_2_Y: 648,
    ANCHOR_LINE_3_Y: 736,

    // cta-stacked derived
    ANCHOR_CTA_HOOK_Y: 520,
    HOOK_DY: hookDY,
    CTA_HOOK_LETTERSPACE: letterSpacingForSize(TYPE.headline),
    BUTTON_X: buttonX,
    BUTTON_Y: buttonY,
    BUTTON_WIDTH: buttonWidth,
    BUTTON_HEIGHT: buttonHeight,
    BUTTON_RX: buttonRx,
    ANCHOR_BUTTON_TEXT_Y: buttonTextY,
    ANCHOR_SUBTEXT_Y: subtextY,

    // Icon slot positions (v0.4.1). 24x24 viewBox at scale 1.5 = 36px, scale 1.67 = 40px.
    // Cover-asymmetric: inline with kicker (content-integrated). Was previously
    // top-right corner which read as chrome/branding rather than content. Now
    // the icon lives beside the kicker so it anchors the topic visually.
    ICON_KICKER_X: COLS[0],                             // 72  — aligned to kicker
    ICON_KICKER_Y: ANCHORS.FLAG_TOP - 72,               //  24 — 48px above kicker text
    // Stat-dominant: centered above stat-value. Stat baseline=600 (156px font →
    // text top ~y=475), so icon needs to clear that. y=380 gives a 90px gap
    // between icon-bottom (y=420) and stat-top.
    ICON_STAT_X: Math.round(CANVAS.width / 2) - 20,     // 520
    ICON_STAT_Y: 380,
    // Split-comparison: above each zone label at y=440. Zone centers 270/810, width 36 → cx-18
    ICON_LEFT_X: 270 - 18,
    ICON_RIGHT_X: 810 - 18,
    ICON_ZONE_Y: 376,

    // Type scale
    TYPE_MICRO: TYPE.micro,
    TYPE_BODY: TYPE.body,
    TYPE_BODY_LARGE: TYPE.bodyLarge,
    TYPE_LABEL: TYPE.label,
    TYPE_SUBHEAD: TYPE.subhead,
    TYPE_HEADLINE: TYPE.headline,
    TYPE_HERO: TYPE.hero,
    TYPE_STAT: TYPE.stat,

    // Letter-spacing / line-height derivations
    TITLE_LETTER_SPACING: letterSpacingForSize(TYPE.hero),
    TITLE_LINE_HEIGHT: lineHeightForSize(TYPE.hero),
    HEADLINE_DY: Math.round(TYPE.hero * lineHeightForSize(TYPE.hero)),
    TYPE_LETTERSPACE_STAT: letterSpacingForSize(TYPE.stat),
    SUBHEAD_LETTER_SPACING: letterSpacingForSize(TYPE.subhead),

    // Color roles
    SURFACE: roles.SURFACE,
    ON_SURFACE: roles.ON_SURFACE,
    SURFACE_MUTED: roles.SURFACE_MUTED,
    ACCENT: roles.ACCENT,
    ON_ACCENT: roles.ON_ACCENT,
    ACCENT_SECONDARY: roles.ACCENT_SECONDARY,
    SURFACE_TINT_5: roles.SURFACE_TINT_5,
    SURFACE_TINT_12: roles.SURFACE_TINT_12,
    SURFACE_TINT_20: roles.SURFACE_TINT_20,

    // Legacy color aliases (for shared-render background/numbering)
    COLOR_TEXT: colors.text ?? '#FFFFFF',
    COLOR_ACCENT: colors.accent ?? roles.ACCENT,
    COLOR_MUTED: colors.muted ?? roles.SURFACE_MUTED,
    BOTTOM_Y: CANVAS.height - 100,

    // Fonts
    FONT_DISPLAY: fonts.display || 'serif',
    FONT_BODY: fonts.body || 'sans-serif',
    FONT_DISPLAY_URL: fontUrl(fonts.display || ''),
    FONT_BODY_URL: fontUrl(fonts.body || ''),
    FONT_DISPLAY_STACK: fontStack(fonts.display || 'serif', 'serif'),
    FONT_BODY_STACK: fontStack(fonts.body || 'sans-serif', 'sans'),
    FONT_IMPORTS: buildFontImports(fonts),
    BG_COLOR: brand.visual.background?.color ?? roles.SURFACE,

    // Brand meta
    BRAND_NAME: brandMeta.name ?? '',
    BRAND_HANDLE: brandMeta.handle ?? '',

    // Slide meta
    SLIDE_NUMBER: slideNumber,
    SLIDE_TOTAL: slideTotal,
    SLIDE_NUMBER_PADDED: String(slideNumber).padStart(2, '0'),
    SLIDE_TOTAL_PADDED: String(slideTotal).padStart(2, '0'),
  };
}

// ---------------------------------------------------------------------------
// Axis effects
// ---------------------------------------------------------------------------

/**
 * Apply sampled axis effects to the slide value map.
 *
 * v0.4.0 initial release wires ONE axis effect: `emphasis`. The other axes
 * (density, composition, hierarchy, accentPlacement, decorationMix) are sampled
 * into `_axes.json` for observability but are not yet wired into output —
 * patterns carry their own layout. These become v0.4.1 extensions once we
 * have pattern variants per axis value.
 *
 * EMPHASIS handling notes:
 *   - Inlines the resolved accent hex directly into the tspan markup (not as
 *     a `{{ACCENT}}` placeholder). `fillTemplate` is a single-pass replace —
 *     placeholders inside inserted values are not re-resolved.
 *   - Head/tail text is XML-escaped; the surrounding tspan tags are raw markup.
 *   - The emphasized slot is added to `rawKeys` so `escapeValues` doesn't
 *     turn `<tspan>` into `&lt;tspan&gt;`.
 */
function applyAxisEffects(values, slide, axes) {
  const rawKeys = [];

  // Pick the primary headline slot for this pattern. Different patterns put
  // the headline in different slots:
  //   cover-asymmetric / cover-centered → HEADLINE_LINE_1
  //   list-bullet / list-numbered → HEADLINE
  //   cta-stacked → HOOK_LINE_1
  //   stat-dominant, quote-pulled, split-comparison → no headline emphasis
  //     (stat/quote carries its own accent already)
  const pattern = slide.pattern;
  let slotKey = null;
  if (pattern === 'cover-asymmetric' || pattern === 'cover-centered') {
    slotKey = 'HEADLINE_LINE_1';
  } else if (pattern === 'list-bullet' || pattern === 'list-numbered') {
    slotKey = 'HEADLINE';
  } else if (pattern === 'cta-stacked') {
    slotKey = 'HOOK_LINE_1';
  }

  const emphasis = axes.emphasis;

  // none / hero-only / middle-noun (deferred — needs NLP) → no change
  if (
    !slotKey ||
    !emphasis ||
    emphasis === 'none' ||
    emphasis === 'hero-only' ||
    emphasis === 'middle-noun'
  ) {
    return { rawKeys };
  }

  const original = values[slotKey];
  if (original === undefined || original === null || String(original).trim() === '') {
    return { rawKeys };
  }

  const text = String(original);
  const words = text.split(/\s+/);
  if (words.length < 2) {
    // Single word — emphasizing "the word" is visually identical to coloring
    // the whole line. Skip to keep output clean.
    return { rawKeys };
  }

  // Inline the already-resolved accent hex directly — fillTemplate is
  // single-pass, so `{{ACCENT}}` inside an inserted value would survive
  // unreplaced. values.ACCENT is the resolved hex from buildColorRoles.
  const accentHex = values.ACCENT;
  let head, tail;
  if (emphasis === 'first-word') {
    head = words[0];
    tail = words.slice(1).join(' ');
    values[slotKey] = `<tspan fill="${escapeXml(accentHex)}">${escapeXml(head)}</tspan> ${escapeXml(tail)}`;
  } else if (emphasis === 'last-word') {
    head = words.slice(0, -1).join(' ');
    tail = words[words.length - 1];
    values[slotKey] = `${escapeXml(head)} <tspan fill="${escapeXml(accentHex)}">${escapeXml(tail)}</tspan>`;
  }

  rawKeys.push(slotKey);
  return { rawKeys };
}

// ---------------------------------------------------------------------------
// Per-slide rendering
// ---------------------------------------------------------------------------

function renderPatternSlide({
  slide,
  slideNumber,
  slideTotal,
  brand,
  axes,
  rng,
  pluginRoot,
  strategyDir,
}) {
  const patternDef = PATTERN_BY_ID[slide.pattern];
  if (!patternDef) {
    const known = Object.keys(PATTERN_BY_ID).join(', ');
    throw new Error(
      `Unknown pattern "${slide.pattern}" on slide ${slideNumber}. Known patterns: ${known}`,
    );
  }

  const templatePath = join(pluginRoot, 'patterns', patternDef.template);
  const templateStr = readFileSync(templatePath, 'utf8');

  // Token values + per-slide data
  const tokenValues = buildTokenValues(brand, axes, slideNumber, slideTotal);
  const slideData = slide.data || {};
  const values = { ...tokenValues, ...slideData };

  // Derived per-slide values for list patterns: ARROW_N and ITEM_NUMBER_N
  // present only when corresponding ITEM_N has content, so empty bullets
  // don't leave orphan arrows/numbers.
  for (let i = 1; i <= 5; i++) {
    const item = values[`ITEM_${i}`];
    const hasContent =
      item !== undefined && item !== null && String(item).trim() !== '';
    values[`ARROW_${i}`] = hasContent ? '\u2192' : '';
    values[`ITEM_NUMBER_${i}`] = hasContent ? String(i).padStart(2, '0') : '';
  }

  // Axis effects (emphasis word highlighting). Mutates `values` in place and
  // returns the set of keys whose value is now raw SVG markup (so we don't
  // escape it in the template fill pass).
  const { rawKeys: axisRawKeys } = applyAxisEffects(values, slide, axes);

  // Background / decorations / numbering — shared-render expects v0.3-style
  // baseValues shape (has BOTTOM_Y, COLOR_ACCENT, etc. — see buildTokenValues).
  // v0.4 wraps renderBackground to also handle dot-grid/geometric-shapes/glow-sphere.
  const backgroundSvg = renderBackgroundV04({ brand, pluginRoot, baseValues: values });
  const decorationsSvg = renderDecorations({
    brand,
    slideData,
    pluginRoot,
    baseValues: values,
    slideNumber,
  });
  const numberingSvg = renderNumbering({
    brand,
    pluginRoot,
    baseValues: values,
    slideNumber,
    slideTotal,
  });

  // Icon slots — library lookup, validated inline SVG, or file on disk.
  // Empty if absent.
  const iconSlots = resolveIconSlots(slide, strategyDir);

  // Logo slot (v0.4.2) — brand-wide, rendered only on patterns that carry
  // a {{LOGO}} slot (cover-asymmetric, cover-centered, cta-stacked). Body
  // patterns have no {{LOGO}} placeholder so the value is simply ignored.
  const logoSvg = resolveLogo(brand, strategyDir);

  const finalValues = {
    ...values,
    BACKGROUND: backgroundSvg,
    DECORATIONS: decorationsSvg,
    NUMBERING: numberingSvg,
    LOGO: logoSvg,
    ...iconSlots,
  };

  // Escape everything EXCEPT raw-SVG / raw-CSS slots:
  //   BACKGROUND / DECORATIONS / NUMBERING / LOGO / ICON*: raw SVG markup.
  //   FONT_*_STACK: CSS font-family value with single quotes around the name
  //     (e.g. `'Instrument Serif', serif`). Escaping turns the quotes into
  //     `&apos;` which breaks CSS. Font names come from brand.visual.fonts
  //     which is author-controlled, not user input — safe to pass raw.
  //   axisRawKeys: emphasis-wrapped tspan markup.
  const rawKeys = [
    'BACKGROUND',
    'DECORATIONS',
    'NUMBERING',
    'LOGO',
    'ICON',
    'ICON_LEFT',
    'ICON_RIGHT',
    'FONT_DISPLAY_STACK',
    'FONT_BODY_STACK',
    'FONT_IMPORTS',
    ...axisRawKeys,
  ];
  const escaped = escapeValues(finalValues, rawKeys);
  return fillTemplate(templateStr, escaped);
}

// ---------------------------------------------------------------------------
// Carousel orchestration
// ---------------------------------------------------------------------------

export function renderCarousel({ brand, strategy, outputDir, pluginRoot = PLUGIN_ROOT, strategyDir = null }) {
  if (!strategy || typeof strategy !== 'object') {
    throw new Error('strategy must be an object with { topic, slides[] }');
  }
  if (typeof strategy.topic !== 'string' || !strategy.topic.trim()) {
    throw new Error('strategy.topic is required (used for deterministic seed)');
  }
  if (!Array.isArray(strategy.slides) || strategy.slides.length === 0) {
    throw new Error('strategy.slides must be a non-empty array');
  }
  if (!brand?.brand?.handle) {
    throw new Error('brand.brand.handle is required (used for deterministic seed)');
  }

  // v0.4-specific validation (background.dotGrid / shapes / glow).
  validateBrand(brand);

  const outAbs = resolve(outputDir);
  mkdirSync(outAbs, { recursive: true });

  const seed = buildSeed({ brandHandle: brand.brand.handle, topic: strategy.topic });
  const rng = createRng(seed);
  const axes = sampleCarouselAxes(rng);

  // Write axes profile as debugging aid.
  const axesPath = join(outAbs, '_axes.json');
  writeFileSync(
    axesPath,
    JSON.stringify({ seed, axes }, null, 2) + '\n',
    'utf8',
  );

  const slideTotal = strategy.slides.length;
  strategy.slides.forEach((slide, i) => {
    const slideNumber = i + 1;
    const svg = renderPatternSlide({
      slide,
      slideNumber,
      slideTotal,
      brand,
      axes,
      rng,
      pluginRoot,
      strategyDir,
    });
    const filename = `slide-${String(slideNumber).padStart(2, '0')}.svg`;
    const fullPath = join(outAbs, filename);
    writeFileSync(fullPath, svg, 'utf8');
    console.log(`\u2713 ${fullPath}`);
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [brandPath, strategyPath, outDir] = process.argv.slice(2);
  if (!brandPath || !strategyPath || !outDir) {
    console.error(
      'Usage: node scripts/render-v0.4.mjs <brand-profile.json> <strategy.json> <output-dir>',
    );
    process.exit(1);
  }
  let brand, strategy;
  try {
    brand = JSON.parse(readFileSync(resolve(brandPath), 'utf8'));
  } catch (err) {
    console.error(`\u2717 Failed to load brand: ${err.message}`);
    process.exit(1);
  }
  try {
    strategy = JSON.parse(readFileSync(resolve(strategyPath), 'utf8'));
  } catch (err) {
    console.error(`\u2717 Failed to load strategy: ${err.message}`);
    process.exit(1);
  }
  try {
    renderCarousel({
      brand,
      strategy,
      outputDir: resolve(outDir),
      pluginRoot: PLUGIN_ROOT,
      // Relative `icon.file` paths in strategy.json resolve against the
      // strategy file's directory (user's project), not the render script.
      strategyDir: dirname(resolve(strategyPath)),
    });
  } catch (err) {
    console.error(`\u2717 ${err.message}`);
    process.exit(1);
  }
}
