// extract-logo.mjs — v0.6 logo extractor.
//
// Detection priority order:
//   1. Inline SVG in header/nav with class/id containing "logo"
//   2. <img alt="... logo ..."> in header/nav (also header a[href="/"] img,
//      [class*="logo"] img)
//   3. Favicon / apple-touch-icon (<link rel="icon">, then /favicon.ico)
//
// Returns one of:
//   { type: 'inline-svg', path }
//   { type: 'img',        path, sourceUrl, crossOrigin? }
//   { type: 'favicon',    path, sourceUrl, crossOrigin? }
//   { type: 'none',       warning: 'No logo found' }
//
// extractLogo NEVER throws. All failure modes are non-fatal — the caller can
// safely `await extractLogo(...)` without a try/catch.
//
// Security:
//   - fetchBuffer only allows http(s) schemes (rejects data:, file:, javascript:).
//   - 10-second per-request timeout via AbortSignal.timeout.
//   - 2 MB cap — rejected up-front via Content-Length, or during streaming.
//   - Cross-origin fetches are allowed (CDN logos are common) but recorded on
//     the returned descriptor for the caller to surface as a warning.
//
// TODO(v0.7): Prefer apple-touch-icon when its size exceeds the favicon — right
// now we take whichever <link> appears first in the DOM, because the selector
// list is resolved with a single querySelector() and the SVG favicon branch
// sits in front of both.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse a URL and return its lowercased file extension from the pathname.
 * Defaults to 'png' for unknown/missing extensions. Only svg/png/ico/jpg/
 * jpeg/gif are considered recognizable.
 */
export function inferExtension(url) {
  let pathname = '';
  try {
    pathname = new URL(url).pathname || '';
  } catch {
    // Not a valid URL — try to pull the last segment by hand.
    pathname = String(url || '');
  }
  const lastSlash = pathname.lastIndexOf('/');
  const file = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
  const dot = file.lastIndexOf('.');
  if (dot < 0) return 'png';
  const ext = file.slice(dot + 1).toLowerCase();
  const clean = ext.split('?')[0].split('#')[0]; // strip accidental query/hash
  if (['svg', 'png', 'ico', 'jpg', 'jpeg', 'gif'].includes(clean)) return clean;
  return 'png';
}

/**
 * Fetch a URL as a Buffer, enforcing:
 *   - http(s) scheme only
 *   - 10 s timeout
 *   - 2 MB max size (via Content-Length pre-check AND streaming cap)
 *
 * Throws on: invalid scheme, non-2xx status, timeout, over-limit body.
 */
export async function fetchBuffer(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`invalid URL: ${url}`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`refusing non-http(s) scheme: ${parsed.protocol}`);
  }

  const res = await fetch(parsed.href, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${parsed.href}`);
  }

  // Pre-check Content-Length when present.
  const lenHeader = res.headers.get('content-length');
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > MAX_BYTES) {
      throw new Error(`response too large (${len} bytes > ${MAX_BYTES})`);
    }
  }

  // Stream and cap. We can't assume Content-Length is honest, so also count
  // bytes as they arrive and abort mid-stream if the cap is breached.
  const reader = res.body?.getReader?.();
  if (!reader) {
    // Fall back to arrayBuffer when the body isn't streamable (e.g. mocks).
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      throw new Error(`response too large (${ab.byteLength} bytes > ${MAX_BYTES})`);
    }
    return Buffer.from(ab);
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`response too large (${total}+ bytes > ${MAX_BYTES})`);
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks, total);
}

/**
 * Locate a logo on an already-loaded Puppeteer page and persist it into
 * `outputDir`. Never throws.
 *
 * @param {object} page       Puppeteer Page instance (or test double with
 *                            `.evaluate(fn, ...args)`).
 * @param {string} outputDir  Absolute directory path — assumed to exist.
 * @param {string} baseUrl    URL of the loaded page, used to resolve relative
 *                            href values and build the default /favicon.ico
 *                            fallback.
 */
export async function extractLogo(page, outputDir, baseUrl) {
  // ---- 1. Inline SVG in header/nav ----
  let inlineSvg = null;
  try {
    inlineSvg = await page.evaluate(() => {
      const candidates = document.querySelectorAll(
        'header svg[class*="logo" i], nav svg[class*="logo" i], [id*="logo" i] svg, [class*="logo" i] svg',
      );
      for (const svg of candidates) {
        const r = svg.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return svg.outerHTML;
        }
      }
      return null;
    });
  } catch (err) {
    // Page might be detached — fall through.
    inlineSvg = null;
  }
  if (inlineSvg && typeof inlineSvg === 'string' && inlineSvg.trim().length > 0) {
    const path = join(outputDir, 'logo.svg');
    try {
      writeFileSync(path, inlineSvg, 'utf8');
      return { type: 'inline-svg', path };
    } catch (err) {
      // Fall through to <img> path if disk write fails.
    }
  }

  // ---- 1b. Positional SVG fallback (JS-rendered sites) ----
  // Framer / Next.js / React sites often render the logo SVG inside a generic
  // <div> with no class="logo" marker. Fall back to ANY <svg> that's near
  // the top-left of the rendered page, within a plausible logo bounding box.
  // Filter out illustrations (too many paths) to avoid grabbing decorative art.
  let positionalSvg = null;
  let usedPositionalFallback = false;
  try {
    positionalSvg = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg'));
      for (const svg of svgs) {
        const r = svg.getBoundingClientRect();
        if (!(r.top < 200 && r.width > 20 && r.height > 20 && r.width < 400)) continue;
        // Reject illustrations (lots of paths → likely not a logo).
        const paths = svg.querySelectorAll('path');
        if (paths.length > 10) continue;
        return svg.outerHTML;
      }
      return null;
    });
  } catch {
    positionalSvg = null;
  }
  if (positionalSvg && typeof positionalSvg === 'string' && positionalSvg.trim().length > 0) {
    const path = join(outputDir, 'logo.svg');
    try {
      writeFileSync(path, positionalSvg, 'utf8');
      usedPositionalFallback = true;
      return {
        type: 'inline-svg',
        path,
        warning: "[logo] Used positional SVG fallback (no class='logo' marker found)",
      };
    } catch (err) {
      // Fall through to <img> path if disk write fails.
    }
  }

  // ---- 2. <img> in header/nav ----
  let imgUrl = null;
  try {
    imgUrl = await page.evaluate(() => {
      const candidates = document.querySelectorAll(
        'header img[alt*="logo" i], nav img[alt*="logo" i], header a[href="/"] img, [class*="logo" i] img',
      );
      for (const img of candidates) {
        if (img.src && !img.src.startsWith('data:')) return img.src;
      }
      return null;
    });
  } catch {
    imgUrl = null;
  }
  if (imgUrl) {
    try {
      const buffer = await fetchBuffer(imgUrl);
      const ext = inferExtension(imgUrl);
      const path = join(outputDir, `logo.${ext}`);
      writeFileSync(path, buffer);
      const crossOrigin = isCrossOrigin(imgUrl, baseUrl);
      const result = { type: 'img', path, sourceUrl: imgUrl };
      if (crossOrigin) result.crossOrigin = true;
      return result;
    } catch (err) {
      // Fall through to favicon.
    }
  }

  // ---- 3. Favicon / apple-touch-icon ----
  let favUrl = null;
  try {
    favUrl = await page.evaluate((base) => {
      const link = document.querySelector(
        'link[rel="icon"][type="image/svg+xml"], link[rel="apple-touch-icon"], link[rel="icon"], link[rel="shortcut icon"]',
      );
      if (link && link.href) {
        try {
          return new URL(link.getAttribute('href'), base).href;
        } catch {
          return link.href;
        }
      }
      try {
        return new URL('/favicon.ico', base).href;
      } catch {
        return null;
      }
    }, baseUrl);
  } catch {
    favUrl = null;
  }
  // Belt-and-braces default: if evaluate() returned null, still try the base
  // /favicon.ico path (the page might be detached but we can still fetch).
  if (!favUrl) {
    try {
      favUrl = new URL('/favicon.ico', baseUrl).href;
    } catch {
      return { type: 'none', warning: 'No logo found' };
    }
  }
  try {
    const buffer = await fetchBuffer(favUrl);
    const ext = inferExtension(favUrl);
    const path = join(outputDir, `favicon.${ext}`);
    writeFileSync(path, buffer);
    const crossOrigin = isCrossOrigin(favUrl, baseUrl);
    const result = { type: 'favicon', path, sourceUrl: favUrl };
    if (crossOrigin) result.crossOrigin = true;
    return result;
  } catch (err) {
    return { type: 'none', warning: 'No logo found' };
  }
}

function isCrossOrigin(candidate, baseUrl) {
  try {
    const a = new URL(candidate);
    const b = new URL(baseUrl);
    return a.host !== b.host;
  } catch {
    return false;
  }
}
