#!/usr/bin/env node
// extract-brand-signals.mjs — pure-JS parser for fonts/colors/meta/text-samples.
//
// Called by scan-site.mjs with html + computedStyles + url. Returns the
// brand-signals JSON (minus screenshots, which scan-site fills in).
//
// No Playwright/Puppeteer dependency here — this file is pure HTML/CSS parsing
// so the logic can be unit-tested against local fixtures without a browser.
//
// Output schema (documented at top for the synthesizer agent):
// {
//   url, scannedAt,
//   fonts: { display, body, displaySource, bodySource, allFontFaces },
//   colors: { background, text, accent, allColors, confidence },
//   meta:   { title, description, ogImage },
//   textSamples: { heroHeadline, heroSubheadline, ctaCandidates },
//   warnings: [...]
// }

// -------- Font classification whitelists --------
const FONTSHARE_FAMILIES = new Set([
  'satoshi',
  'cabinet grotesk',
  'clash display',
  'clash grotesk',
  'supreme',
  'general sans',
  'zodiak',
  'gambarino',
  'switzer',
]);

const GOOGLE_FAMILIES = new Set([
  'inter',
  'roboto',
  'open sans',
  'lato',
  'poppins',
  'montserrat',
  'playfair display',
  'instrument serif',
  'dm serif display',
  'jetbrains mono',
  'space grotesk',
  'geist',
  'manrope',
  'archivo',
  'archivo black',
  'source sans pro',
  'source serif pro',
  'source code pro',
  'fira sans',
  'fira code',
]);

// -------- Helpers --------

function stripQuotes(s) {
  return String(s).trim().replace(/^['"]+|['"]+$/g, '').trim();
}

/**
 * Strip CSS fallbacks and quotes from a font-family declaration.
 * Accepts either:
 *   - a bare family list ("Satoshi", "Inter", sans-serif)
 *   - a full declaration block (font-family: "Satoshi", ...; color: #fff;)
 *     in which case we'll pull the font-family property first.
 */
// Generic / fallback CSS font families — these are NOT real brand typefaces,
// so they should be excluded from primary font selection AND from the
// typographic-diversity bonus in scoreConfidence.
const GENERIC_FONT_FAMILIES = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont',
]);

function isGenericFontFamily(family) {
  if (!family) return true;
  return GENERIC_FONT_FAMILIES.has(String(family).toLowerCase());
}

function firstFamily(value) {
  if (!value) return null;
  let src = String(value);
  // If it looks like a declaration block, isolate the font-family property.
  if (/font-family\s*:/i.test(src)) {
    const m = src.match(/font-family\s*:\s*([^;}{]+)/i);
    if (m) src = m[1];
  }
  const raw = src.split(',')[0];
  const cleaned = stripQuotes(raw);
  // Reject generic CSS families as primary.
  if (isGenericFontFamily(cleaned)) return null;
  return cleaned || null;
}

function classifyFontSource(family) {
  if (!family) return 'unknown';
  const key = family.toLowerCase();
  if (FONTSHARE_FAMILIES.has(key)) return 'fontshare';
  if (GOOGLE_FAMILIES.has(key)) return 'google';
  return 'unknown';
}

/** Parse every font-family declaration found anywhere in the given CSS text. */
function extractAllFontFaces(cssText) {
  if (!cssText) return [];
  const results = new Set();
  const re = /font-family\s*:\s*([^;}{]+)[;}]/gi;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const list = m[1].split(',');
    for (const part of list) {
      const fam = stripQuotes(part);
      if (fam && fam.length < 80) results.add(fam);
    }
  }
  return [...results];
}

// ---------- Color helpers ----------

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r, g, b) {
  const hex = (n) => clamp255(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/**
 * Normalize any CSS color string to #RRGGBB. Returns null on non-opaque or
 * unrecognized. Handles: #rgb, #rrggbb, rgb(r,g,b), rgba(r,g,b,a).
 */
function normalizeColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'none' || s === 'currentcolor' || s === 'inherit') return null;

  // #rgb short form
  if (/^#[0-9a-f]{3}$/.test(s)) {
    const r = parseInt(s[1] + s[1], 16);
    const g = parseInt(s[2] + s[2], 16);
    const b = parseInt(s[3] + s[3], 16);
    return rgbToHex(r, g, b);
  }
  // #rrggbb
  if (/^#[0-9a-f]{6}$/.test(s)) return s.toUpperCase();
  // #rrggbbaa — drop alpha channel if present
  if (/^#[0-9a-f]{8}$/.test(s)) {
    const a = parseInt(s.slice(7, 9), 16);
    if (a < 16) return null; // near-fully transparent
    return s.slice(0, 7).toUpperCase();
  }

  // rgb() / rgba()
  const rgbMatch = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/);
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    if (a !== undefined && Number(a) < 0.1) return null; // near-transparent
    return rgbToHex(Number(r), Number(g), Number(b));
  }

  // Named CSS colors — short whitelist of the common ones.
  const named = {
    black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000',
    blue: '#0000FF', yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF',
    gray: '#808080', grey: '#808080', silver: '#C0C0C0',
  };
  if (named[s]) return named[s];

  return null;
}

function hexToRgb(hex) {
  const s = hex.replace('#', '');
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/**
 * ΔE CIE76 over raw RGB. No external color library. True Lab conversion would
 * be more accurate but costs more code — raw RGB Euclidean distance is good
 * enough for "are these two colors the same?" in the brand-signal dedup path.
 *
 * Calibration reference (RGB distances):
 *   #000000 vs #0A0A0A → 17.3  (near-black pair — should collapse)
 *   #0A0A0A vs #3A3A3A → 83.1  (distinct dark greys — should NOT collapse)
 *   #29F2FE vs #29F0FC →  2.8  (same cyan, rounding drift — should collapse)
 *
 * Threshold 20 lands between 17.3 (collapse) and 83.1 (distinct): catches
 * near-duplicates without merging actually-different colors. The plan comment
 * said 12 + #141414, but that combo is mathematically unseparable (#141414 and
 * #0A0A0A are the same distance apart as #0A0A0A and #000000); threshold 20
 * with a #3A3A3A "distinct" exemplar is what the fixture actually asserts.
 */
export function deltaE76(hexA, hexB) {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  const dr = rgbA.r - rgbB.r;
  const dg = rgbA.g - rgbB.g;
  const db = rgbA.b - rgbB.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Collapse near-duplicate hex colors using deltaE76. Greedy single-pass:
 * each color joins the first cluster whose representative is within threshold,
 * else starts a new cluster. The first-seen color of each cluster becomes its
 * representative — callers should pass colors sorted by importance/frequency
 * descending so the most-dominant color survives.
 */
export function clusterColors(colors, threshold = 20) {
  const clusters = [];
  for (const c of colors) {
    const existing = clusters.find((cluster) => deltaE76(cluster[0], c) <= threshold);
    if (existing) existing.push(c);
    else clusters.push([c]);
  }
  return clusters.map((cluster) => cluster[0]);
}

/** Perceived luminance in [0,1]. */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** HSL-style saturation in [0,1]. 0 = greyscale, 1 = fully saturated. */
function saturation(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function isNearGreyscale(hex) {
  return saturation(hex) < 0.12;
}

/**
 * Scrape every usable color value out of the CSS/HTML blobs.
 * Includes property values (color/background-color/fill/stroke), CSS custom
 * properties (--color-*, --bg-*, --accent*, --brand*), and inline style
 * attribute values inside the HTML.
 */
function extractColorValues(cssText, html) {
  const colors = [];
  const push = (val) => {
    const norm = normalizeColor(val);
    if (norm) colors.push(norm);
  };

  const sources = [cssText || '', html || ''];
  for (const source of sources) {
    // property: value;
    const propRe = /(background-color|background|color|fill|stroke|border-color|outline-color)\s*:\s*([^;}{]+?)(?=[;}])/gi;
    let propMatch;
    while ((propMatch = propRe.exec(source)) !== null) {
      const value = propMatch[2].trim();
      // Skip shorthand background that isn't a pure color.
      if (propMatch[1].toLowerCase() === 'background') {
        if (/url\(|gradient|image/i.test(value)) continue;
      }
      if (/url\(/i.test(value)) continue;
      // Value may itself contain space-separated tokens — try each.
      for (const tok of value.split(/\s+(?![^(]*\))/)) {
        push(tok.trim());
      }
    }

    // CSS custom properties for brand/accent/bg/color.
    const varRe = /--(?:color[^:]*|bg[^:]*|accent[^:]*|brand[^:]*|fg[^:]*|primary[^:]*|text[^:]*)\s*:\s*([^;}{]+?)(?=[;}])/gi;
    let varMatch;
    while ((varMatch = varRe.exec(source)) !== null) {
      push(varMatch[1].trim());
    }
  }

  // Bare hex occurrences in the HTML body (e.g. attribute colors).
  const hexRe = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
  let hexMatch;
  while ((hexMatch = hexRe.exec(html || '')) !== null) {
    push(hexMatch[0]);
  }

  return colors;
}

function rankColors(colors) {
  const counts = new Map();
  for (const c of colors) counts.set(c, (counts.get(c) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color, count]) => ({ color, count }));
}

/** Extract the first declared color for a given property from a CSS block. */
function firstDeclaredColor(cssBlock, property) {
  if (!cssBlock) return null;
  const re = new RegExp(`\\b${property}\\s*:\\s*([^;}{]+?)(?=[;}]|$)`, 'i');
  const m = cssBlock.match(re);
  if (!m) return null;
  const value = m[1].trim();
  // Property may have multiple space-separated tokens (e.g. border: 1px solid #fff).
  for (const tok of value.split(/\s+(?![^(]*\))/)) {
    const norm = normalizeColor(tok.trim());
    if (norm) return norm;
  }
  return null;
}

/**
 * Given a ranked list, decide {background, text, accent}.
 *
 * Optional hints let scan-site.mjs pass the body's computed background-color
 * and color directly, which is far more reliable than frequency ranking for
 * sites where accent/text colors are repeated more often than the background.
 *
 * Strategy:
 * - Background: prefer hintedBackground if present; else the most common
 *   near-extreme (very dark <0.15 or very light >0.85); else the dominant color.
 * - Text: prefer hintedText; else the most common greyscale color that
 *   contrasts with background.
 * - Accent: highest-saturation, non-greyscale color in the top frequencies.
 */
function pickRoles(ranked, hints = {}) {
  if (ranked.length === 0) {
    return { background: null, text: null, accent: null };
  }

  const topN = ranked.slice(0, 30);

  let background;
  if (hints.background) {
    background = hints.background;
  } else {
    const darkCandidate = topN.find((x) => luminance(x.color) < 0.15);
    const lightCandidate = topN.find((x) => luminance(x.color) > 0.85);
    if (darkCandidate && (!lightCandidate || darkCandidate.count >= lightCandidate.count)) {
      background = darkCandidate.color;
    } else if (lightCandidate) {
      background = lightCandidate.color;
    } else {
      background = topN[0].color;
    }
  }

  const bgLum = luminance(background);

  // Validate hintedText against background contrast. A hinted text color (from
  // the body's computed `color:` value) can be nonsense — e.g. a near-white
  // color on a white background where page-level text is actually styled by a
  // different rule. If the luminance delta is too small, the hint is broken
  // and we fall through to greyscale-ranked detection.
  const HINT_CONTRAST_THRESHOLD = 0.3;
  const hintedTextIsUsable =
    hints.text
    && hints.text !== background
    && Math.abs(luminance(hints.text) - bgLum) >= HINT_CONTRAST_THRESHOLD;

  let text;
  if (hintedTextIsUsable) {
    text = hints.text;
  } else {
    const textCandidate = topN
      .filter((x) => x.color !== background && isNearGreyscale(x.color))
      .sort((a, b) => {
        const dA = Math.abs(luminance(a.color) - bgLum);
        const dB = Math.abs(luminance(b.color) - bgLum);
        if (Math.abs(dA - dB) < 0.1) return b.count - a.count;
        return dB - dA;
      })[0];
    text = textCandidate?.color || (bgLum < 0.5 ? '#FFFFFF' : '#000000');
  }

  const accentCandidates = topN
    .filter((x) => !isNearGreyscale(x.color) && x.color !== background && x.color !== text)
    .map((x) => ({ ...x, sat: saturation(x.color) }))
    .sort((a, b) => {
      const sA = a.sat * Math.log(a.count + 1);
      const sB = b.sat * Math.log(b.count + 1);
      return sB - sA;
    });
  const accent = accentCandidates[0]?.color || null;

  return { background, text, accent };
}

/**
 * Weighted, proportional confidence in the overall brand extraction.
 *
 * Core color + font signals sum to 90 points; small bonuses for looking
 * like a real designed brand (distinct-but-not-too-many colors/fonts) add
 * up to 10. We cap at 1.0 and apply a 0.85x penalty for JS-rendered sites
 * where we may have missed dynamically-loaded styles.
 *
 * Realistic output:
 *   - well-designed brand site with static CSS → 0.85–0.95
 *   - JS-heavy site                             → 0.6–0.8
 *   - scrappy site with inline styles only     → 0.5–0.7
 */
function scoreConfidence({
  hasBackground,
  hasText,
  hasAccent,
  hasDisplayFont,
  hasBodyFont,
  uniqueColors,
  fontFaceCount,
  hasJsRenderedWarning,
}) {
  let score = 0;
  if (hasBackground) score += 20;
  if (hasText) score += 15;
  if (hasAccent) score += 20;
  if (hasDisplayFont) score += 20;
  if (hasBodyFont) score += 15;

  // Bonus: "looks like a real designed brand" — 2-6 distinct colors + 2-4 fonts.
  if (uniqueColors >= 2 && uniqueColors <= 6) score += 5;
  if (fontFaceCount >= 2 && fontFaceCount <= 4) score += 5;

  // Penalty: JS-heavy sites may have styles we couldn't see.
  if (hasJsRenderedWarning) score = Math.round(score * 0.85);

  return Math.min(1.0, Math.round(score) / 100);
}

// ---------- Meta & text-sample parsing ----------

function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function getAttr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return null;
  return m[1] || m[2] || m[3] || null;
}

function extractMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  let description = null;
  let ogImage = null;

  const metaRe = /<meta\b[^>]*>/gi;
  let metaMatch;
  while ((metaMatch = metaRe.exec(html)) !== null) {
    const tag = metaMatch[0];
    const name = (getAttr(tag, 'name') || '').toLowerCase();
    const property = (getAttr(tag, 'property') || '').toLowerCase();
    const content = getAttr(tag, 'content');
    if (!content) continue;
    if (!description && (name === 'description' || property === 'og:description')) {
      description = decodeEntities(content);
    }
    if (!ogImage && property === 'og:image') {
      ogImage = content;
    }
  }
  return { title, description, ogImage };
}

function extractFirstTag(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? stripTags(m[1]) : null;
}

/**
 * Extract rich text content for downstream voice/niche analysis (v0.6 Task E.1).
 *
 * Shape:
 *   {
 *     headings: string[],       // up to 20 h1/h2/h3 texts in DOM order
 *     mainText: string,          // first 500 words of <main> or largest content block
 *     ctas: string[],            // button + short-anchor text, up to 60 chars
 *     metaDescription: string,   // meta[name=description] content (or empty string)
 *   }
 *
 * Deliberately duplicates some of what textSamples.ctaCandidates captures —
 * the voice-analysis prompt consumes textContent in isolation and shouldn't
 * have to stitch multiple fields together.
 */
function extractTextContent(html) {
  if (!html) {
    return { headings: [], mainText: '', ctas: [], metaDescription: '' };
  }

  // --- headings ---
  const headings = [];
  const headingRe = /<(h[123])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hMatch;
  while ((hMatch = headingRe.exec(html)) !== null) {
    const txt = stripTags(hMatch[2]);
    if (txt) headings.push(txt);
    if (headings.length >= 20) break;
  }

  // --- mainText ---
  // Strategy: first try <main>; if missing/empty, look for <article>; then a
  // div whose class contains content|main|article|body; finally the whole
  // <body> minus header/nav/footer noise.
  const extractBlockText = (blockHtml) => {
    if (!blockHtml) return '';
    // Strip header/nav/footer/script/style before flattening.
    const scrubbed = blockHtml
      .replace(/<(script|style|noscript|header|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    return stripTags(scrubbed);
  };

  let mainText = '';
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) {
    mainText = extractBlockText(mainMatch[1]);
  }
  if (!mainText) {
    const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) mainText = extractBlockText(articleMatch[1]);
  }
  if (!mainText) {
    // Find all divs whose class hints at content/main/article/body and pick
    // the one with the longest flattened text. Case-insensitive match handles
    // CSS-module-mangled names like "CssModules_mainContent__abc123".
    const divRe = /<div\b[^>]*class\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi;
    let divMatch;
    let bestLen = 0;
    let bestText = '';
    const classRe = /content|main|article|body/i;
    while ((divMatch = divRe.exec(html)) !== null) {
      if (!classRe.test(divMatch[1])) continue;
      const txt = extractBlockText(divMatch[2]);
      if (txt.length > bestLen) {
        bestLen = txt.length;
        bestText = txt;
      }
    }
    mainText = bestText;
  }
  if (!mainText) {
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) mainText = extractBlockText(bodyMatch[1]);
  }

  if (mainText) {
    const words = mainText.split(/\s+/).filter(Boolean).slice(0, 500);
    mainText = words.join(' ');
  }

  // --- ctas ---
  const ctaSet = new Set();
  const ctaRes = [
    /<button\b[^>]*>([\s\S]*?)<\/button>/gi,
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi,
  ];
  for (const re of ctaRes) {
    let match;
    while ((match = re.exec(html)) !== null) {
      const txt = stripTags(match[1]);
      if (!txt) continue;
      if (txt.length < 3 || txt.length > 60) continue;
      if (/^https?:\/\//i.test(txt)) continue;
      ctaSet.add(txt);
    }
  }
  const ctas = [...ctaSet];

  // --- metaDescription ---
  const meta = extractMeta(html);
  const metaDescription = meta.description || '';

  return { headings, mainText, ctas, metaDescription };
}

function extractTextSamples(html) {
  const heroHeadline = extractFirstTag(html, 'h1');
  // heroSubheadline: first <h2>, else first <p> with >40 chars
  let heroSubheadline = extractFirstTag(html, 'h2');
  if (!heroSubheadline) {
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch;
    while ((pMatch = pRe.exec(html)) !== null) {
      const txt = stripTags(pMatch[1]);
      if (txt.length > 40) {
        heroSubheadline = txt;
        break;
      }
    }
  }

  // CTA candidates: <button> + <a> inner text.
  const ctas = new Set();
  const tagRes = [
    /<button\b[^>]*>([\s\S]*?)<\/button>/gi,
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi,
  ];
  for (const re of tagRes) {
    let match;
    while ((match = re.exec(html)) !== null) {
      const txt = stripTags(match[1]);
      if (!txt) continue;
      if (txt.length < 3 || txt.length > 40) continue;
      if (/^https?:\/\//i.test(txt)) continue;
      ctas.add(txt);
    }
  }
  const ctaCandidates = [...ctas].sort((a, b) => a.length - b.length).slice(0, 5);

  return { heroHeadline, heroSubheadline, ctaCandidates };
}

// ---------- JS-rendered warning heuristic ----------

function detectJsRendered(html) {
  const warnings = [];
  if (/<script[^>]*type=["']module["']/i.test(html)) {
    warnings.push('JS-rendered content; some styles may be computed-only');
    return warnings;
  }
  if (/data-reactroot|__NEXT_DATA__|ng-version|v-app|__NUXT__|data-sveltekit/i.test(html)) {
    warnings.push('JS-rendered content; some styles may be computed-only');
  }
  return warnings;
}

// ---------- Public entrypoint ----------

/**
 * @param {{ html: string, computedStyles?: { body?: string, h1?: string, button?: string, cssDump?: string }, url: string }} input
 */
export function extractSignals(input) {
  const { html = '', computedStyles = {}, url } = input;
  const cssDump = computedStyles.cssDump || '';

  const warnings = [];

  // --- fonts ---
  const allFontFaces = extractAllFontFaces([html, cssDump].join('\n'));

  // Display = h1's computed font-family, falling back to first font-family in the CSS.
  let displayFamily = firstFamily(computedStyles.h1);
  if (!displayFamily) displayFamily = allFontFaces[0] || null;

  // Body = body's computed font-family, falling back to button's, then any.
  let bodyFamily = firstFamily(computedStyles.body);
  if (!bodyFamily) bodyFamily = firstFamily(computedStyles.button) || allFontFaces[0] || null;

  const fonts = {
    display: displayFamily,
    body: bodyFamily,
    displaySource: classifyFontSource(displayFamily),
    bodySource: classifyFontSource(bodyFamily),
    allFontFaces,
  };

  // --- colors ---
  const rawColors = extractColorValues(
    [cssDump, computedStyles.body, computedStyles.h1, computedStyles.button].filter(Boolean).join('\n'),
    html,
  );
  const ranked = rankColors(rawColors);
  // Cluster near-duplicate colors (e.g. #000000 + #0A0A0A) using ΔE CIE76.
  // `ranked` is frequency-desc, so the first color in each cluster is the
  // most-frequent representative — we keep that and drop the rest.
  const allColors = clusterColors(ranked.map((x) => x.color));

  // Use body's computed background-color / color as strong hints — these are
  // far more reliable than frequency ranking on sites where text/accent colors
  // are declared on many selectors.
  const hintedBg = firstDeclaredColor(computedStyles.body, 'background-color')
    || firstDeclaredColor(computedStyles.body, 'background');
  const hintedText = firstDeclaredColor(computedStyles.body, 'color');

  const roles = pickRoles(ranked, { background: hintedBg, text: hintedText });

  // Detect JS-rendered hint before scoring so confidence can apply the penalty.
  const jsRenderedWarnings = detectJsRendered(html);
  const hasJsRenderedWarning = jsRenderedWarnings.length > 0;

  // Count only "real" (named) font families toward the diversity bonus —
  // generic CSS fallbacks (sans-serif, system-ui, -apple-system, etc.) don't
  // represent a designer's typographic palette, so including them inflates
  // confidence on sites that only declare one or two real fonts.
  const brandedFontCount = allFontFaces.filter((f) => !isGenericFontFamily(f)).length;

  const confidence = scoreConfidence({
    hasBackground: roles.background ? 1 : 0,
    hasText: roles.text ? 1 : 0,
    hasAccent: roles.accent ? 1 : 0,
    hasDisplayFont: fonts.display ? 1 : 0,
    hasBodyFont: fonts.body ? 1 : 0,
    uniqueColors: allColors.length,
    fontFaceCount: brandedFontCount,
    hasJsRenderedWarning: hasJsRenderedWarning ? 1 : 0,
  });

  const colors = {
    background: roles.background,
    text: roles.text,
    accent: roles.accent,
    allColors,
    confidence,
  };

  // --- meta ---
  const meta = extractMeta(html);

  // --- text samples ---
  const textSamples = extractTextSamples(html);

  // --- text content (v0.6 Task E.1 — for voice/niche analysis) ---
  const textContent = extractTextContent(html);

  // --- warnings ---
  warnings.push(...jsRenderedWarnings);
  if (!fonts.display) warnings.push('Could not detect display font');
  if (!fonts.body) warnings.push('Could not detect body font');
  if (!colors.background) warnings.push('Could not detect background color');
  if (!colors.accent) warnings.push('Could not detect accent color');

  return {
    url,
    scannedAt: new Date().toISOString(),
    fonts,
    colors,
    meta,
    textSamples,
    textContent,
    warnings,
  };
}

// Named helpers (exported for fixture tests)
export const __testing = {
  normalizeColor,
  luminance,
  saturation,
  rankColors,
  pickRoles,
  classifyFontSource,
  firstFamily,
  extractAllFontFaces,
  extractMeta,
  extractTextSamples,
  extractTextContent,
  scoreConfidence,
  deltaE76,
  clusterColors,
};
