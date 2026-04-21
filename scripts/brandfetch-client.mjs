// brandfetch-client.mjs — v0.7 Task C.2
//
// Opt-in BrandFetch API client (BYOK via BRANDFETCH_API_KEY env var).
//
// This is the ONE paid-API integration in node-carousel. The core scan stays
// zero-API — BrandFetch is strictly augmentation. If the env var is absent or
// empty, this module returns { available: false } WITHOUT hitting the network.
//
// API contract:
//   GET https://api.brandfetch.io/v2/brands/<domain>
//   Authorization: Bearer <apiKey>
//
// Returns structured brand data (logos, colors, fonts, description, industry).
//
// Security:
//   - fetch() is gated on apiKey presence — no-key path never touches the network.
//   - 10s timeout via AbortSignal.
//   - API key is NEVER logged or written to disk.
//   - Response is normalized — fields we don't care about are dropped.
//
// v0.7 C.2 — 24h local cache at ~/.cache/node-carousel/brandfetch-<domain>.json
//   - Free tier is 100 req/mo; re-scanning the same domain within a day burns
//     requests. Cache avoids that.
//   - Only successful (2xx) responses are cached. Errors/rate-limits/404s are
//     NEVER cached so a transient failure doesn't poison the next 24h.
//   - Cache TTL: 24 hours (mtime-based).
//   - Cache key: domain only — NOT the API key. The cache file contains the
//     normalized payload, never the key.
//   - Cache location is overridable via NODE_CAROUSEL_CACHE_DIR (for tests).
//   - cacheVersion field lets us invalidate old formats on future upgrades.

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 1;

/**
 * Resolve the cache directory. Honours NODE_CAROUSEL_CACHE_DIR env var if set,
 * otherwise falls back to ~/.cache/node-carousel.
 *
 * Computed at call time (not module-load time) so tests can override via env.
 *
 * @returns {string} absolute path to cache directory
 */
export function getCacheDir() {
  const override = process.env.NODE_CAROUSEL_CACHE_DIR;
  if (override && typeof override === 'string' && override.trim() !== '') {
    return override;
  }
  return join(homedir(), '.cache', 'node-carousel');
}

/**
 * Build the absolute path to the cache file for a given domain.
 *
 * @param {string} domain
 * @returns {string}
 */
function cachePathFor(domain) {
  // Domain is already URL-safe (hostname output) but be defensive: replace any
  // path separators or weirdness with underscores so we never escape the dir.
  const safe = String(domain).replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(getCacheDir(), `brandfetch-${safe}.json`);
}

/**
 * Read cached brand data for a domain. Returns null on miss, expired, wrong
 * version, or read/parse error. Best-effort — never throws.
 *
 * @param {string} domain
 * @returns {object|null} cached normalized payload or null
 */
export function readCache(domain) {
  if (!domain || typeof domain !== 'string') return null;
  try {
    const path = cachePathFor(domain);
    const stat = statSync(path);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || parsed.cacheVersion !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write normalized brand data to the cache. Best-effort — a failure to write
 * (permissions, full disk) is swallowed because the cache is purely an
 * optimisation.
 *
 * @param {string} domain
 * @param {object} data — normalized payload (as returned by normalizeBrandfetch)
 */
export function writeCache(domain, data) {
  if (!domain || typeof domain !== 'string') return;
  try {
    mkdirSync(getCacheDir(), { recursive: true });
    const payload = { cacheVersion: CACHE_VERSION, data };
    writeFileSync(cachePathFor(domain), JSON.stringify(payload));
  } catch {
    // cache is best-effort; ignore write errors
  }
}

/**
 * Extract the bare hostname from a URL. Subdomains are preserved (BrandFetch
 * likes specificity); only leading `www.` is stripped.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractDomain(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Normalize a raw BrandFetch v2 /brands/<domain> response into a compact shape.
 * Uses defensive optional chaining — any missing or malformed field yields
 * undefined/empty rather than throwing.
 *
 * @param {object} data — raw BrandFetch response body
 * @returns {object} normalized brand data
 */
export function normalizeBrandfetch(data) {
  if (!data || typeof data !== 'object') {
    return {
      name: undefined,
      description: undefined,
      domain: undefined,
      logos: [],
      colors: [],
      fonts: [],
      industries: [],
    };
  }
  return {
    name: data.name,
    description: data.description,
    domain: data.domain,
    logos: Array.isArray(data.logos)
      ? data.logos.map((l) => ({
          type: l?.type,                       // 'icon' | 'logo' | 'symbol'
          format: l?.formats?.[0]?.format,     // 'svg' | 'png'
          url: l?.formats?.[0]?.src,
        }))
      : [],
    colors: Array.isArray(data.colors)
      ? data.colors.map((c) => ({
          hex: c?.hex,
          type: c?.type,                       // 'accent' | 'dark' | 'light' | 'brand'
        }))
      : [],
    fonts: Array.isArray(data.fonts)
      ? data.fonts.map((f) => ({ name: f?.name, type: f?.type }))
      : [],
    industries: Array.isArray(data?.company?.industries)
      ? data.company.industries.map((i) => i?.name).filter(Boolean)
      : [],
  };
}

/**
 * Fetch brand data from BrandFetch for a given domain. BYOK — caller passes the
 * API key. Never throws; always returns { available: bool, data?, reason?, cached?, cacheVersion? }.
 *
 * No-key path short-circuits BEFORE any network call. Empty string is treated
 * as absent.
 *
 * Cache behaviour (v0.7 C.2):
 *   - Valid cache hit (within 24h, correct version) → returns cached payload
 *     with `cached: true`. No network call.
 *   - Miss / expired / wrong version → fetch from API. On 2xx success, write
 *     the normalized payload to cache and return with `cached: false`.
 *   - Non-2xx responses (404, 429, 5xx) and network errors are NEVER cached.
 *
 * @param {string|null} domain
 * @param {string|null|undefined} apiKey
 * @returns {Promise<{available: boolean, data?: object, reason?: string, cached?: boolean, cacheVersion?: number}>}
 */
export async function brandfetch(domain, apiKey) {
  // Treat missing, empty, or whitespace-only keys as absent. No network call.
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return { available: false, reason: 'no API key' };
  }
  if (!domain || typeof domain !== 'string') {
    return { available: false, reason: 'invalid domain' };
  }

  // Cache check — returns cached payload without touching the network.
  const cached = readCache(domain);
  if (cached && cached.data) {
    return {
      available: true,
      data: cached.data,
      cached: true,
      cacheVersion: CACHE_VERSION,
    };
  }

  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return { available: false, reason: 'brand not in BrandFetch DB' };
    if (res.status === 429) return { available: false, reason: 'rate limited' };
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
    const data = await res.json();
    const normalized = normalizeBrandfetch(data);
    // Only cache successful (2xx) responses.
    writeCache(domain, normalized);
    return {
      available: true,
      data: normalized,
      cached: false,
      cacheVersion: CACHE_VERSION,
    };
  } catch (e) {
    return { available: false, reason: e?.message || String(e) };
  }
}
