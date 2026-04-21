// brandfetch-client.mjs — v0.6 Task F.1
//
// Opt-in BrandFetch API client (BYOK via BRANDFETCH_API_KEY env var).
//
// This is the ONE paid-API integration in v0.6. The core scan stays zero-API —
// BrandFetch is strictly augmentation. If the env var is absent or empty, this
// module returns { available: false } WITHOUT hitting the network.
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
 * API key. Never throws; always returns { available: bool, data?, reason? }.
 *
 * No-key path short-circuits BEFORE any network call. Empty string is treated
 * as absent.
 *
 * @param {string|null} domain
 * @param {string|null|undefined} apiKey
 * @returns {Promise<{available: boolean, data?: object, reason?: string}>}
 */
export async function brandfetch(domain, apiKey) {
  // Treat missing, empty, or whitespace-only keys as absent. No network call.
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return { available: false, reason: 'no API key' };
  }
  if (!domain || typeof domain !== 'string') {
    return { available: false, reason: 'invalid domain' };
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
    return { available: true, data: normalizeBrandfetch(data) };
  } catch (e) {
    return { available: false, reason: e?.message || String(e) };
  }
}
