#!/usr/bin/env node
// run-fixture-tests.mjs — verify extract-brand-signals against the 3 fixtures.
//
// Usage:
//   node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
//
// No Puppeteer here — we feed the fixture HTML (with its inline <style>)
// directly into extractSignals and check detected fonts/colors/confidence.

import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractSignals } from '../../../scripts/extract-brand-signals.mjs';
import {
  rankDiscoveredLinks,
  mergeSignals,
  mergeProfile,
  parseArgv,
  VALID_PRESETS,
  ArgvError,
  acquireLock,
  computeScreenshotOptions,
  printUsage,
} from '../../../scripts/scan-site.mjs';
import { brandfetch, normalizeBrandfetch, extractDomain, readCache, writeCache, getCacheDir } from '../../../scripts/brandfetch-client.mjs';
import { extractLogoFromSignals } from '../../../scripts/extract-logo.mjs';
import { parseViewBox, buildScannedBackground } from '../../../scripts/render-v0.4.mjs';
import { parsePreferences, validatePreferences, DEFAULTS } from '../../../scripts/preferences.mjs';
import { loadFont, embedFontAsDataUri, inferFontFormat } from '../../../scripts/load-font.mjs';
import { parsePngPixel, clusterDominantColors, detectGlow } from '../../../scripts/sample-pixels.mjs';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES = [
  {
    file: 'tech-dark.html',
    label: 'tech-dark (Node-style)',
    expect: {
      displayFamily: 'Satoshi',
      displaySource: 'fontshare',
      bodyFamily: 'Inter',
      bodySource: 'google',
      background: '#0A0A0A',
      accent: '#C9FF4E',
      textLuminanceLight: true, // text is light against dark bg
      // Perfect synthetic fixture: all 5 core signals + both diversity bonuses
      // fire → caps at 1.0. Min is the real guardrail against regressions.
      confidenceMin: 0.85,
      confidenceMax: 1.0,
    },
  },
  {
    file: 'editorial-cream.html',
    label: 'editorial-cream',
    expect: {
      displayFamily: 'Instrument Serif',
      displaySource: 'google',
      bodyFamily: 'Inter',
      bodySource: 'google',
      background: '#F4EDE0',
      accent: '#C0623F',
      textLuminanceLight: false, // dark ink on cream
      confidenceMin: 0.85,
      confidenceMax: 1.0,
    },
  },
  {
    file: 'agency-minimal.html',
    label: 'agency-minimal',
    expect: {
      displayFamily: 'Geist',
      displaySource: 'google',
      bodyFamily: 'Geist',
      bodySource: 'google',
      background: '#FFFFFF',
      accent: '#2B5BFF',
      textLuminanceLight: false,
      // Single-font brand: fonts-diversity bonus doesn't fire → naturally
      // lands at 0.95 (not 1.0). Narrower band than the other two fixtures.
      confidenceMin: 0.80,
      confidenceMax: 0.95,
    },
  },
];

function confidenceInRange(actual, min, max) {
  return typeof actual === 'number' && actual >= min && actual <= max;
}

function luminance(hex) {
  const s = hex.replace('#', '');
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function check(label, cond, detail) {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`  ${tag}: ${label}${detail ? ` — ${detail}` : ''}`);
  return cond ? 1 : 0;
}

async function main() {
  let total = 0;
  let passed = 0;

  for (const fx of FIXTURES) {
    console.log(`\n=== ${fx.label} ===`);
    const html = readFileSync(join(__dirname, fx.file), 'utf8');

    // Simulate what scan-site.mjs passes: html + a "computedStyles" blob that
    // roughly mirrors what page.evaluate returns. Here we just stuff the
    // <style> contents into cssDump so the extractor can see the declarations.
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const cssDump = styleMatch ? styleMatch[1] : '';

    // Emulate the body/h1 computed style by reading the first declarations
    // from the fixture CSS that target those selectors. This is intentionally
    // simple; we're just giving the extractor a realistic "first choice".
    const grabSelector = (selector) => {
      const re = new RegExp(`(^|\\})\\s*${selector}\\s*\\{([^}]+)\\}`, 'i');
      const m = cssDump.match(re);
      return m ? m[2] : '';
    };

    const bodyDecl = grabSelector('html, body') || grabSelector('body');
    const h1Decl = grabSelector('h1, h2, h3') || grabSelector('h1, h2, \\.serif') || grabSelector('h1');
    const buttonDecl = grabSelector('\\.btn-primary') || grabSelector('\\.btn');

    const signals = extractSignals({
      html,
      computedStyles: {
        body: bodyDecl,
        h1: h1Decl,
        button: buttonDecl,
        cssDump,
      },
      url: `file://${fx.file}`,
    });

    const { fonts, colors } = signals;

    total += 6;
    passed += check(`display font = ${fx.expect.displayFamily}`, fonts.display === fx.expect.displayFamily, `got ${fonts.display}`);
    passed += check(`display source = ${fx.expect.displaySource}`, fonts.displaySource === fx.expect.displaySource, `got ${fonts.displaySource}`);
    passed += check(`body font = ${fx.expect.bodyFamily}`, fonts.body === fx.expect.bodyFamily, `got ${fonts.body}`);
    passed += check(`body source = ${fx.expect.bodySource}`, fonts.bodySource === fx.expect.bodySource, `got ${fonts.bodySource}`);
    passed += check(`background = ${fx.expect.background}`, colors.background === fx.expect.background, `got ${colors.background}`);
    passed += check(`accent = ${fx.expect.accent}`, colors.accent === fx.expect.accent, `got ${colors.accent}`);

    total += 2;
    const textIsLight = colors.text ? luminance(colors.text) > 0.5 : false;
    passed += check(
      `text contrasts with bg (light text? ${fx.expect.textLuminanceLight})`,
      textIsLight === fx.expect.textLuminanceLight,
      `got text=${colors.text} (lum ${colors.text ? luminance(colors.text).toFixed(2) : 'n/a'})`,
    );
    passed += check(
      `confidence in [${fx.expect.confidenceMin}, ${fx.expect.confidenceMax}]`,
      confidenceInRange(colors.confidence, fx.expect.confidenceMin, fx.expect.confidenceMax),
      `got ${colors.confidence}`,
    );

    // --- v0.6 Task E.1 — textContent extraction ---
    const tc = signals.textContent || {};
    total += 1;
    passed += check(
      'textContent.headings has ≥1 entry',
      Array.isArray(tc.headings) && tc.headings.length >= 1,
      `got ${tc.headings ? tc.headings.length : 'none'}: ${JSON.stringify((tc.headings || []).slice(0, 3))}`,
    );

    // tech-dark is the richest fixture with a full <main> block — sanity
    // check that mainText actually picks up meaningful copy. We don't assert
    // this on every fixture because voice analysis consumes mainText at
    // runtime and doesn't require deterministic strings.
    if (fx.file === 'tech-dark.html') {
      total += 1;
      passed += check(
        'textContent.mainText is non-empty on tech-dark',
        typeof tc.mainText === 'string' && tc.mainText.length > 20,
        `got ${(tc.mainText || '').slice(0, 80)}${(tc.mainText || '').length > 80 ? '…' : ''}`,
      );
    }

    console.log(`\n  --- sample output ---`);
    console.log(`  ${JSON.stringify({
      fonts: { display: fonts.display, body: fonts.body, displaySource: fonts.displaySource, bodySource: fonts.bodySource },
      colors: { background: colors.background, text: colors.text, accent: colors.accent, confidence: colors.confidence },
      meta: signals.meta,
      heroHeadline: signals.textSamples.heroHeadline,
      ctaCandidates: signals.textSamples.ctaCandidates,
      warnings: signals.warnings,
    }, null, 2).replace(/\n/g, '\n  ')}`);
  }

  // ---- ΔE color clustering (v0.6 Task A.1) ----
  console.log(`\n=== near-duplicate-colors (ΔE clustering) ===`);
  {
    const html = readFileSync(join(__dirname, 'near-duplicate-colors.html'), 'utf8');
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const cssDump = styleMatch ? styleMatch[1] : '';
    const signals = extractSignals({
      html,
      computedStyles: { body: '', h1: '', button: '', cssDump },
      url: 'file://near-duplicate-colors.html',
    });
    total += 1;
    passed += check(
      'allColors clustered to 4 (near-dups collapsed, distinct colors survive)',
      signals.colors.allColors.length === 4,
      `got ${signals.colors.allColors.length}: ${JSON.stringify(signals.colors.allColors)}`,
    );
  }

  // ---- rankDiscoveredLinks tests (v0.6 multi-page crawl scaffolding) ----
  console.log(`\n=== rankDiscoveredLinks (v0.6) ===`);
  const base = 'https://example.com';

  // Case 1: typical nav with about + pricing + blog + services
  {
    const hrefs = [
      '/',
      '/about',
      '/pricing',
      '/blog',
      '/services',
      '/login',            // unmatched - should be dropped
      '#hero',             // anchor - dropped
      'mailto:a@b.com',    // scheme - dropped
      'https://twitter.com/x', // external - dropped
    ];
    const ranked = rankDiscoveredLinks(hrefs, base);
    total += 2;
    passed += check(
      'ranked returns 2 paths',
      ranked.length === 2,
      `got ${ranked.length}: ${JSON.stringify(ranked)}`,
    );
    passed += check(
      'priority 1 (/about) comes first, priority 2 (/pricing) second',
      ranked[0] === '/about' && ranked[1] === '/pricing',
      `got ${JSON.stringify(ranked)}`,
    );
  }

  // Case 2: /about-us variant + /team both priority 1 — dedup + top 2
  {
    const hrefs = ['/about-us', '/team', '/pricing', '/services'];
    const ranked = rankDiscoveredLinks(hrefs, base);
    total += 1;
    const bothPriority1 = ranked.includes('/about-us') && ranked.includes('/team');
    passed += check(
      'both priority-1 paths selected (about-us + team) before lower priorities',
      bothPriority1 && ranked.length === 2,
      `got ${JSON.stringify(ranked)}`,
    );
  }

  // Case 3: no matches -> empty array, never crashes
  {
    const hrefs = ['/login', '/signup', '/dashboard', '#x'];
    const ranked = rankDiscoveredLinks(hrefs, base);
    total += 1;
    passed += check(
      'returns [] when no priority paths present',
      Array.isArray(ranked) && ranked.length === 0,
      `got ${JSON.stringify(ranked)}`,
    );
  }

  // Case 4: absolute URLs from the same host are accepted; external hosts rejected
  {
    const hrefs = [
      'https://example.com/about',
      'https://example.com/pricing',
      'https://other.com/about',
    ];
    const ranked = rankDiscoveredLinks(hrefs, base);
    total += 1;
    passed += check(
      'absolute same-host URLs normalized; cross-host rejected',
      ranked.length === 2 && ranked[0] === '/about' && ranked[1] === '/pricing',
      `got ${JSON.stringify(ranked)}`,
    );
  }

  // Case 5: duplicates are deduped
  {
    const hrefs = ['/about', '/about', '/about/', '/blog', '/blog'];
    const ranked = rankDiscoveredLinks(hrefs, base);
    total += 1;
    const aboutCount = ranked.filter((p) => p.startsWith('/about')).length;
    passed += check(
      'duplicates deduped (only one /about variant kept per path)',
      aboutCount <= 1 && ranked.includes('/blog'),
      `got ${JSON.stringify(ranked)}`,
    );
  }

  // ---- mergeSignals iteration-order safety (Issue 3 regression guard) ----
  console.log(`\n=== mergeSignals order-independence (v0.6) ===`);
  {
    // Build two perPage objects with IDENTICAL content but different insertion
    // order. The merged font source MUST still come from the homepage in both.
    const homepageSignals = {
      fonts: { display: 'Satoshi', displaySource: 'fontshare', body: 'Inter', bodySource: 'google', allFontFaces: [] },
      colors: { background: '#000', text: '#fff', accent: '#f00', allColors: [], confidence: 0.8 },
      meta: { title: 'home', description: null, ogImage: null },
      textSamples: { heroHeadline: 'Home', heroSubheadline: null, ctaCandidates: [] },
      warnings: [],
    };
    // Subpage uses the SAME family but reports a different source (e.g.
    // inferred differently). Homepage's source must win.
    const aboutSignals = {
      fonts: { display: 'Satoshi', displaySource: 'unknown', body: 'Inter', bodySource: 'unknown', allFontFaces: [] },
      colors: { background: '#000', text: '#fff', accent: '#f00', allColors: [], confidence: 0.5 },
      meta: { title: 'about', description: null, ogImage: null },
      textSamples: { heroHeadline: 'About', heroSubheadline: null, ctaCandidates: [] },
      warnings: [],
    };

    const homeFirst = { '/': homepageSignals, '/about': aboutSignals };
    const homeSecond = { '/about': aboutSignals, '/': homepageSignals };

    const mergedA = mergeSignals(homeFirst, '/');
    const mergedB = mergeSignals(homeSecond, '/');

    total += 2;
    passed += check(
      'mergeSignals: homepage-first iteration preserves fontshare source',
      mergedA.fonts.displaySource === 'fontshare',
      `got ${mergedA.fonts.displaySource}`,
    );
    passed += check(
      'mergeSignals: homepage-second iteration ALSO preserves fontshare source (order-independent)',
      mergedB.fonts.displaySource === 'fontshare',
      `got ${mergedB.fonts.displaySource}`,
    );
  }

  // ---- v0.6 Task F.1 — BrandFetch client ----
  console.log(`\n=== brandfetch-client (v0.6) ===`);

  // Case 1: extractDomain edge cases — www. stripped, subdomain kept, port + path + trailing slash handled.
  {
    total += 5;
    passed += check(
      'extractDomain: https://nodeagency.ai/about → nodeagency.ai',
      extractDomain('https://nodeagency.ai/about') === 'nodeagency.ai',
      `got ${extractDomain('https://nodeagency.ai/about')}`,
    );
    passed += check(
      'extractDomain: https://www.vercel.com → vercel.com (www stripped)',
      extractDomain('https://www.vercel.com') === 'vercel.com',
      `got ${extractDomain('https://www.vercel.com')}`,
    );
    passed += check(
      'extractDomain: https://blog.stripe.com → blog.stripe.com (subdomain preserved)',
      extractDomain('https://blog.stripe.com') === 'blog.stripe.com',
      `got ${extractDomain('https://blog.stripe.com')}`,
    );
    passed += check(
      'extractDomain: https://example.com:8080/ → example.com (port + trailing slash)',
      extractDomain('https://example.com:8080/') === 'example.com',
      `got ${extractDomain('https://example.com:8080/')}`,
    );
    passed += check(
      'extractDomain: invalid input → null (no throw)',
      extractDomain('not a url') === null && extractDomain(null) === null && extractDomain('') === null,
      `got ${JSON.stringify([extractDomain('not a url'), extractDomain(null), extractDomain('')])}`,
    );
  }

  // Case 2: normalizeBrandfetch on a realistic fixture response.
  {
    const sample = {
      name: 'Vercel',
      description: 'Develop. Preview. Ship.',
      domain: 'vercel.com',
      logos: [
        {
          type: 'logo',
          formats: [{ format: 'svg', src: 'https://cdn.brandfetch.io/vercel.com/w/400/h/400/logo' }],
        },
        { type: 'icon', formats: [] },
      ],
      colors: [
        { hex: '#000000', type: 'dark' },
        { hex: '#FFFFFF', type: 'light' },
      ],
      fonts: [{ name: 'Inter', type: 'title' }],
      company: {
        industries: [{ name: 'Developer Tools' }],
      },
    };
    const norm = normalizeBrandfetch(sample);
    total += 6;
    passed += check(
      'normalizeBrandfetch: name + description + domain',
      norm.name === 'Vercel' && norm.description === 'Develop. Preview. Ship.' && norm.domain === 'vercel.com',
      `got name=${norm.name} desc=${norm.description} domain=${norm.domain}`,
    );
    passed += check(
      'normalizeBrandfetch: 2 logos (svg logo + empty-formats icon) with defensive optional chaining',
      norm.logos.length === 2
        && norm.logos[0].type === 'logo'
        && norm.logos[0].format === 'svg'
        && norm.logos[0].url === 'https://cdn.brandfetch.io/vercel.com/w/400/h/400/logo'
        && norm.logos[1].type === 'icon'
        && norm.logos[1].format === undefined
        && norm.logos[1].url === undefined,
      `got ${JSON.stringify(norm.logos)}`,
    );
    passed += check(
      'normalizeBrandfetch: 2 colors with hex + type',
      norm.colors.length === 2
        && norm.colors[0].hex === '#000000' && norm.colors[0].type === 'dark'
        && norm.colors[1].hex === '#FFFFFF' && norm.colors[1].type === 'light',
      `got ${JSON.stringify(norm.colors)}`,
    );
    passed += check(
      'normalizeBrandfetch: 1 font (Inter / title)',
      norm.fonts.length === 1 && norm.fonts[0].name === 'Inter' && norm.fonts[0].type === 'title',
      `got ${JSON.stringify(norm.fonts)}`,
    );
    passed += check(
      'normalizeBrandfetch: industries extracted (Developer Tools)',
      Array.isArray(norm.industries) && norm.industries.length === 1 && norm.industries[0] === 'Developer Tools',
      `got ${JSON.stringify(norm.industries)}`,
    );
    // Handle empty/malformed input without throwing.
    const emptyNorm = normalizeBrandfetch({});
    passed += check(
      'normalizeBrandfetch: empty object → empty arrays (no throw)',
      Array.isArray(emptyNorm.logos) && emptyNorm.logos.length === 0
        && Array.isArray(emptyNorm.colors) && emptyNorm.colors.length === 0
        && Array.isArray(emptyNorm.fonts) && emptyNorm.fonts.length === 0
        && Array.isArray(emptyNorm.industries) && emptyNorm.industries.length === 0,
      `got ${JSON.stringify(emptyNorm)}`,
    );
  }

  // Case 3: brandfetch() with no API key must return {available:false} WITHOUT touching the network.
  {
    // null key
    const r1 = await brandfetch('vercel.com', null);
    // undefined key
    const r2 = await brandfetch('vercel.com', undefined);
    // empty string
    const r3 = await brandfetch('vercel.com', '');
    // whitespace-only
    const r4 = await brandfetch('vercel.com', '   ');
    // null domain + null key
    const r5 = await brandfetch(null, null);
    total += 5;
    passed += check(
      'brandfetch(domain, null) → {available:false, reason:"no API key"}',
      r1.available === false && r1.reason === 'no API key',
      `got ${JSON.stringify(r1)}`,
    );
    passed += check(
      'brandfetch(domain, undefined) → {available:false, reason:"no API key"}',
      r2.available === false && r2.reason === 'no API key',
      `got ${JSON.stringify(r2)}`,
    );
    passed += check(
      'brandfetch(domain, "") → {available:false, reason:"no API key"}',
      r3.available === false && r3.reason === 'no API key',
      `got ${JSON.stringify(r3)}`,
    );
    passed += check(
      'brandfetch(domain, "   ") → {available:false, reason:"no API key"}',
      r4.available === false && r4.reason === 'no API key',
      `got ${JSON.stringify(r4)}`,
    );
    passed += check(
      'brandfetch(null, null) → {available:false} without throwing',
      r5.available === false && typeof r5.reason === 'string',
      `got ${JSON.stringify(r5)}`,
    );
  }

  // ---- v0.7 Task C.2 — BrandFetch 24h local cache ----
  console.log(`\n=== brandfetch cache (v0.7 C.2) ===`);
  {
    // Use a tmpdir so tests never touch ~/.cache/node-carousel.
    const tmpCache = mkdtempSync(join(tmpdir(), 'bf-cache-test-'));
    const prevEnv = process.env.NODE_CAROUSEL_CACHE_DIR;
    process.env.NODE_CAROUSEL_CACHE_DIR = tmpCache;
    try {
      // Case 1: getCacheDir() honours NODE_CAROUSEL_CACHE_DIR override.
      total += 1;
      passed += check(
        'getCacheDir: NODE_CAROUSEL_CACHE_DIR override honoured',
        getCacheDir() === tmpCache,
        `got ${getCacheDir()}`,
      );

      // Case 2: readCache on missing file → null (no throw).
      total += 1;
      passed += check(
        'readCache: missing file → null',
        readCache('nope.example.com') === null,
        `got non-null`,
      );

      // Case 3: writeCache → readCache round-trip returns the payload.
      const payload = {
        name: 'Vercel',
        description: 'Frontend cloud',
        domain: 'vercel.com',
        logos: [{ type: 'logo', format: 'svg', url: 'https://cdn/vercel.svg' }],
        colors: [{ hex: '#000000', type: 'dark' }],
        fonts: [{ name: 'Inter', type: 'title' }],
        industries: ['Developer Tools'],
      };
      writeCache('vercel.com', payload);
      const roundtrip = readCache('vercel.com');
      total += 2;
      passed += check(
        'writeCache + readCache: round-trip payload matches',
        roundtrip && roundtrip.data && roundtrip.data.name === 'Vercel'
          && roundtrip.data.colors[0].hex === '#000000',
        `got ${JSON.stringify(roundtrip)}`,
      );
      passed += check(
        'writeCache: cacheVersion stamped on written payload',
        roundtrip && roundtrip.cacheVersion === 1,
        `got ${roundtrip?.cacheVersion}`,
      );

      // Case 4: expired cache (mtime > 24h old) → readCache returns null.
      //   We simulate expiry by using fs.utimesSync to push mtime 25h back.
      const { utimesSync } = await import('node:fs');
      const expiredPath = join(tmpCache, 'brandfetch-expired.example.com.json');
      writeFileSync(expiredPath, JSON.stringify({ cacheVersion: 1, data: { name: 'Stale' } }));
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      utimesSync(expiredPath, old, old);
      total += 1;
      passed += check(
        'readCache: expired file (mtime >24h) → null',
        readCache('expired.example.com') === null,
        `expected null for expired cache`,
      );

      // Case 5: wrong cacheVersion → readCache returns null (forward compat).
      const wrongVerPath = join(tmpCache, 'brandfetch-wrongver.example.com.json');
      writeFileSync(wrongVerPath, JSON.stringify({ cacheVersion: 999, data: { name: 'Future' } }));
      total += 1;
      passed += check(
        'readCache: mismatched cacheVersion → null',
        readCache('wrongver.example.com') === null,
        `expected null for wrong cacheVersion`,
      );

      // Case 6: brandfetch() hits cache on second call without network.
      //   Pre-seed the cache, then call brandfetch with a fake key. The call
      //   should return cached:true immediately (no network — fake key would
      //   otherwise produce a non-ok response).
      writeCache('cached.example.com', {
        name: 'Cached',
        description: undefined,
        domain: 'cached.example.com',
        logos: [],
        colors: [],
        fonts: [],
        industries: [],
      });
      const hit = await brandfetch('cached.example.com', 'fake-key-would-401');
      total += 3;
      passed += check(
        'brandfetch: valid cache hit → available:true',
        hit.available === true,
        `got ${JSON.stringify(hit)}`,
      );
      passed += check(
        'brandfetch: valid cache hit → cached:true',
        hit.cached === true,
        `got cached=${hit.cached}`,
      );
      passed += check(
        'brandfetch: valid cache hit → data.name from cache',
        hit.data && hit.data.name === 'Cached',
        `got ${hit.data?.name}`,
      );
    } finally {
      // Clean up: restore env + remove tmp dir.
      if (prevEnv === undefined) delete process.env.NODE_CAROUSEL_CACHE_DIR;
      else process.env.NODE_CAROUSEL_CACHE_DIR = prevEnv;
      rmSync(tmpCache, { recursive: true, force: true });
    }
  }

  // ---- v0.7 Task A.1 — mergeProfile helper ----
  console.log(`\n=== mergeProfile (v0.7 A.1) ===`);

  // Case 1: existing display font wins; body comes from derived (existing missing).
  {
    const existing = { visual: { fonts: { display: 'JetBrains Mono' } } };
    const derived = { visual: { fonts: { display: 'Inter', body: 'Inter' } } };
    const merged = mergeProfile(existing, derived);
    total += 2;
    passed += check(
      'mergeProfile: existing fonts.display (JetBrains Mono) beats derived (Inter)',
      merged.visual.fonts.display === 'JetBrains Mono',
      `got ${merged.visual?.fonts?.display}`,
    );
    passed += check(
      'mergeProfile: derived fonts.body (Inter) flows through when existing has no body',
      merged.visual.fonts.body === 'Inter',
      `got ${merged.visual?.fonts?.body}`,
    );
  }

  // Case 2: when existing has no accent, scan's accent flows through.
  {
    const existing = { visual: { colors: { background: '#0f0f0f', text: '#FFFFFF' } } };
    const derived = { visual: { colors: { background: '#FFFFFF', accent: '#00BB7F' } } };
    const merged = mergeProfile(existing, derived);
    total += 2;
    passed += check(
      'mergeProfile: per-leaf merge — existing background wins',
      merged.visual.colors.background === '#0f0f0f',
      `got ${merged.visual?.colors?.background}`,
    );
    passed += check(
      'mergeProfile: per-leaf merge — derived accent fills gap when existing has none',
      merged.visual.colors.accent === '#00BB7F',
      `got ${merged.visual?.colors?.accent}`,
    );
  }

  // Case 3: existing logo.file wins — scan's extracted logo is ignored.
  {
    const existing = { visual: { logo: { file: '/user/assets/my-logo.svg', position: 'top-left', size: 48 } } };
    const derived = { visual: { logo: { file: '/tmp/scan/logo-inline.svg', position: 'top-right', size: 48 } } };
    const merged = mergeProfile(existing, derived);
    total += 2;
    passed += check(
      'mergeProfile: existing logo.file wins over scan-extracted logo',
      merged.visual.logo.file === '/user/assets/my-logo.svg',
      `got ${merged.visual?.logo?.file}`,
    );
    passed += check(
      'mergeProfile: existing logo.position wins too (per-leaf)',
      merged.visual.logo.position === 'top-left',
      `got ${merged.visual?.logo?.position}`,
    );
  }

  // Case 4: existing brand.tone wins over voice-niche-derived tone.
  {
    const existing = { brand: { tone: 'direct, builder-voice, no fluff' } };
    const derived = { brand: { name: 'Node', tone: 'helpful, warm, customer-first' } };
    const merged = mergeProfile(existing, derived);
    total += 2;
    passed += check(
      'mergeProfile: existing brand.tone wins over voice-niche derived tone',
      merged.brand.tone === 'direct, builder-voice, no fluff',
      `got ${merged.brand?.tone}`,
    );
    passed += check(
      'mergeProfile: derived brand.name flows through when existing has no name',
      merged.brand.name === 'Node',
      `got ${merged.brand?.name}`,
    );
  }

  // Case 5: null/undefined/empty-string in existing does NOT block derived.
  {
    const existing = { visual: { colors: { background: null, accent: '' } } };
    const derived = { visual: { colors: { background: '#FFFFFF', accent: '#00BB7F' } } };
    const merged = mergeProfile(existing, derived);
    total += 2;
    passed += check(
      'mergeProfile: explicit null in existing lets derived fill the slot',
      merged.visual.colors.background === '#FFFFFF',
      `got ${merged.visual?.colors?.background}`,
    );
    passed += check(
      'mergeProfile: empty string in existing lets derived fill the slot',
      merged.visual.colors.accent === '#00BB7F',
      `got ${merged.visual?.colors?.accent}`,
    );
  }

  // Case 6: null inputs don't throw; arrays stay as-is (not deep-merged).
  {
    total += 3;
    passed += check(
      'mergeProfile(null, derived) returns derived',
      (() => {
        const d = { x: 1 };
        return mergeProfile(null, d) === d;
      })(),
      '',
    );
    passed += check(
      'mergeProfile(existing, null) returns existing',
      (() => {
        const e = { x: 1 };
        return mergeProfile(e, null) === e;
      })(),
      '',
    );
    // Arrays preserved as-is (existing wins whole array when present).
    {
      const existing = { tags: ['a', 'b'] };
      const derived = { tags: ['c'], other: 'ok' };
      const merged = mergeProfile(existing, derived);
      passed += check(
        'mergeProfile: arrays in existing win whole (not per-index merge)',
        Array.isArray(merged.tags) && merged.tags.length === 2 && merged.tags[0] === 'a',
        `got ${JSON.stringify(merged.tags)}`,
      );
    }
  }

  // ---- v0.7 Task A.2 — Per-context font extraction ----
  console.log(`\n=== fonts.byContext (v0.7 A.2) ===`);

  // Feed extractSignals a pre-built computedStyles.byContext object — this
  // mirrors what scan-site.mjs's page.evaluate returns after the A.2 patch.
  // Pure-object input keeps the test fast and avoids the brittle CSS-grep
  // setup the HTML fixtures need.
  {
    const byContext = {
      header: 'font-family: "JetBrains Mono", monospace; font-size: 14px;',
      nav: 'font-family: "Inter", sans-serif; font-size: 14px;',
      h1: 'font-family: "Inter", sans-serif; font-size: 48px;',
      body: 'font-family: "Inter", sans-serif; font-size: 16px;',
      button: 'font-family: "JetBrains Mono", monospace; font-size: 14px;',
      logo: 'font-family: "JetBrains Mono", monospace; font-size: 18px;',
      kicker: 'font-family: "JetBrains Mono", monospace; font-size: 12px;',
      displayEl: null,
    };
    const signals = extractSignals({
      html: '<h1>Test</h1>',
      computedStyles: {
        body: 'font-family: "Inter", sans-serif;',
        h1: 'font-family: "Inter", sans-serif;',
        button: 'font-family: "JetBrains Mono", monospace;',
        cssDump: '',
        byContext,
      },
      url: 'file://byContext-test',
    });

    total += 5;
    passed += check(
      'fonts.byContext is an object',
      signals.fonts && typeof signals.fonts.byContext === 'object' && signals.fonts.byContext !== null,
      `got ${JSON.stringify(signals.fonts?.byContext)}`,
    );
    passed += check(
      'fonts.byContext.header = "JetBrains Mono"',
      signals.fonts.byContext.header === 'JetBrains Mono',
      `got ${signals.fonts.byContext.header}`,
    );
    passed += check(
      'fonts.byContext.h1 = "Inter"',
      signals.fonts.byContext.h1 === 'Inter',
      `got ${signals.fonts.byContext.h1}`,
    );
    passed += check(
      'fonts.byContext.kicker = "JetBrains Mono" (Node-style kicker chips)',
      signals.fonts.byContext.kicker === 'JetBrains Mono',
      `got ${signals.fonts.byContext.kicker}`,
    );
    // displayEl was null input → should come through as explicit null
    // so downstream can distinguish "checked" from "not checked."
    passed += check(
      'fonts.byContext.displayEl = null (explicit, from null input)',
      signals.fonts.byContext.displayEl === null,
      `got ${signals.fonts.byContext.displayEl}`,
    );
  }

  // Edge: generic-only declaration (sans-serif) → firstFamily returns null.
  // Ensures we don't pollute byContext with generic CSS fallbacks.
  {
    const byContext = {
      header: 'font-family: sans-serif;',
      nav: null,
      h1: 'font-family: "Inter", sans-serif;',
      body: 'font-family: "Inter", sans-serif;',
      button: null,
      logo: null,
      kicker: null,
      displayEl: null,
    };
    const signals = extractSignals({
      html: '<h1>Test</h1>',
      computedStyles: {
        body: 'font-family: "Inter", sans-serif;',
        h1: 'font-family: "Inter", sans-serif;',
        button: '',
        cssDump: '',
        byContext,
      },
      url: 'file://byContext-generic-test',
    });
    total += 2;
    passed += check(
      'fonts.byContext.header = null when declaration is generic-only (sans-serif)',
      signals.fonts.byContext.header === null,
      `got ${signals.fonts.byContext.header}`,
    );
    passed += check(
      'fonts.byContext.h1 = "Inter" (real family picked over generic fallback)',
      signals.fonts.byContext.h1 === 'Inter',
      `got ${signals.fonts.byContext.h1}`,
    );
  }

  // No byContext passed at all — should still produce an empty object,
  // not undefined, so downstream can always iterate/read safely.
  {
    const signals = extractSignals({
      html: '<h1>Test</h1>',
      computedStyles: {
        body: 'font-family: "Inter", sans-serif;',
        h1: 'font-family: "Inter", sans-serif;',
        button: '',
        cssDump: '',
      },
      url: 'file://byContext-missing-test',
    });
    total += 1;
    passed += check(
      'fonts.byContext = {} when computedStyles.byContext absent (defensive)',
      signals.fonts && typeof signals.fonts.byContext === 'object'
        && signals.fonts.byContext !== null
        && Object.keys(signals.fonts.byContext).length === 0,
      `got ${JSON.stringify(signals.fonts?.byContext)}`,
    );
  }

  // ---- v0.7 Task A.3 — CSS variable brand-color extraction ----
  console.log(`\n=== colors.brandVariables (v0.7 A.3) ===`);

  // Case 1: all three common brand vars declared in :root, distinct hex values.
  // Assert the structured map captures {brand, primary, accent} → normalized hex.
  {
    const cssDump = ':root { --brand: #29F2FE; --primary: #0B8AEE; --accent: #5EE9B5; }';
    const signals = extractSignals({
      html: '<h1>Test</h1>',
      computedStyles: {
        body: '', h1: '', button: '', cssDump,
      },
      url: 'file://brandvars-basic',
    });
    const bv = signals.colors.brandVariables || {};
    total += 1;
    passed += check(
      'brandVariables captures {brand, primary, accent} as normalized hex',
      bv.brand === '#29F2FE' && bv.primary === '#0B8AEE' && bv.accent === '#5EE9B5',
      `got ${JSON.stringify(bv)}`,
    );
  }

  // Case 2: non-color values (e.g. `--brand: bold`, `--text: var(--foo)`) are
  // silently dropped. Only values that normalize to a real hex survive.
  {
    const cssDump = ':root { --brand: bold; --primary: var(--foo); --accent: #FF00AA; }';
    const signals = extractSignals({
      html: '<h1>Test</h1>',
      computedStyles: {
        body: '', h1: '', button: '', cssDump,
      },
      url: 'file://brandvars-invalid',
    });
    const bv = signals.colors.brandVariables || {};
    total += 1;
    passed += check(
      'brandVariables drops non-color values (bold, var(...)); keeps valid hex',
      bv.brand === undefined && bv.primary === undefined && bv.accent === '#FF00AA',
      `got ${JSON.stringify(bv)}`,
    );
  }

  // Case 3: multi-key suffixes (e.g. `--accent-dark`, `--accent-light`,
  // `--brand-color-1`) are captured with hyphens preserved + lowercased.
  {
    const cssDump = ':root { --accent-dark: #000000; --accent-light: #FFFFFF; --BRAND-Color-1: #FF0000; }';
    const signals = extractSignals({
      html: '<h1>Test</h1>',
      computedStyles: {
        body: '', h1: '', button: '', cssDump,
      },
      url: 'file://brandvars-multikey',
    });
    const bv = signals.colors.brandVariables || {};
    total += 1;
    passed += check(
      'brandVariables preserves multi-key names (accent-dark, accent-light, brand-color-1), lowercased',
      bv['accent-dark'] === '#000000'
        && bv['accent-light'] === '#FFFFFF'
        && bv['brand-color-1'] === '#FF0000',
      `got ${JSON.stringify(bv)}`,
    );
  }

  // ---- v0.7 Task A.4 — --preset force flag (parseArgv) ----
  console.log(`\n=== parseArgv --preset (v0.7 A.4) ===`);

  // Case 1: valid preset parses + exposes forcedPreset.
  {
    const result = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset', 'technical-mono']);
    total += 3;
    passed += check(
      'parseArgv: returns non-null when positionals + --preset both supplied',
      result !== null,
      `got ${JSON.stringify(result)}`,
    );
    passed += check(
      'parseArgv: forcedPreset === "technical-mono"',
      result && result.forcedPreset === 'technical-mono',
      `got ${result?.forcedPreset}`,
    );
    passed += check(
      'parseArgv: positionals preserved (urlArg + outArg) alongside --preset',
      result && result.urlArg === 'https://example.com' && result.outArg === '/tmp/out',
      `got url=${result?.urlArg} out=${result?.outArg}`,
    );
  }

  // Case 2: invalid preset throws ArgvError — listing all 6 valid names.
  {
    let threw = false;
    let thrownMessage = '';
    let thrownType = null;
    try {
      parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset', 'bogus-preset']);
    } catch (err) {
      threw = true;
      thrownMessage = err?.message || '';
      thrownType = err?.constructor?.name || null;
    }
    total += 3;
    passed += check(
      'parseArgv: unknown preset name throws',
      threw,
      threw ? `threw "${thrownMessage}"` : 'did not throw',
    );
    passed += check(
      'parseArgv: error is ArgvError (exit-friendly, not a generic Error)',
      thrownType === 'ArgvError',
      `got ${thrownType}`,
    );
    passed += check(
      'parseArgv: error message includes "Unknown preset" and lists all 6 valid names',
      thrownMessage.includes('Unknown preset')
        && VALID_PRESETS.every((p) => thrownMessage.includes(p)),
      `got "${thrownMessage}"`,
    );
  }

  // Case 3: case-insensitive normalization.
  {
    const upper = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset', 'TECHNICAL-MONO']);
    const mixed = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset', 'Technical-Mono']);
    const padded = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset', '  satoshi-tech  ']);
    total += 3;
    passed += check(
      'parseArgv: uppercase --preset TECHNICAL-MONO → normalized to "technical-mono"',
      upper && upper.forcedPreset === 'technical-mono',
      `got ${upper?.forcedPreset}`,
    );
    passed += check(
      'parseArgv: mixed-case --preset Technical-Mono → normalized to "technical-mono"',
      mixed && mixed.forcedPreset === 'technical-mono',
      `got ${mixed?.forcedPreset}`,
    );
    passed += check(
      'parseArgv: whitespace trimmed — "  satoshi-tech  " → "satoshi-tech"',
      padded && padded.forcedPreset === 'satoshi-tech',
      `got "${padded?.forcedPreset}"`,
    );
  }

  // Case 4 (bonus): --preset with no value errors; --preset=<value> form works;
  // absent --preset returns forcedPreset === null; combo with --merge-with works.
  {
    // No value after --preset (end of argv)
    let missingValThrew = false;
    try {
      parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset']);
    } catch (err) {
      missingValThrew = err instanceof ArgvError;
    }

    // --preset followed by another flag (still "no value")
    let nextFlagThrew = false;
    try {
      parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset', '--merge-with', '/x']);
    } catch (err) {
      nextFlagThrew = err instanceof ArgvError;
    }

    // --preset=<value> form
    const eqForm = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--preset=neo-grotesk']);

    // Absent flag
    const noFlag = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out']);

    // Combo with --merge-with
    const combo = parseArgv(['node', 'scan-site.mjs', 'https://example.com', '/tmp/out', '--merge-with', '/p.json', '--preset', 'editorial-serif']);

    total += 5;
    passed += check(
      'parseArgv: --preset with no following value throws ArgvError',
      missingValThrew,
      missingValThrew ? 'threw' : 'did not throw',
    );
    passed += check(
      'parseArgv: --preset followed by another --flag throws (treats as missing value)',
      nextFlagThrew,
      nextFlagThrew ? 'threw' : 'did not throw',
    );
    passed += check(
      'parseArgv: --preset=neo-grotesk equals form works',
      eqForm && eqForm.forcedPreset === 'neo-grotesk',
      `got ${eqForm?.forcedPreset}`,
    );
    passed += check(
      'parseArgv: forcedPreset === null when --preset absent',
      noFlag && noFlag.forcedPreset === null,
      `got ${noFlag?.forcedPreset}`,
    );
    passed += check(
      'parseArgv: --merge-with + --preset combine without conflict',
      combo
        && combo.forcedPreset === 'editorial-serif'
        && combo.mergeWithPath === '/p.json',
      `got preset=${combo?.forcedPreset} mergeWith=${combo?.mergeWithPath}`,
    );
  }

  // ---- v0.7 Task B.1 — Concurrency lock on outDir (audit I1) ----
  console.log(`\n=== acquireLock (v0.7 B.1) ===`);

  // Case 1: basic acquire + release.
  {
    const dir = mkdtempSync(join(tmpdir(), 'carousel-lock-1-'));
    try {
      const release = acquireLock(dir);
      const lockPath = join(dir, '.scan.lock');
      total += 2;
      passed += check(
        'acquireLock: .scan.lock exists after acquire',
        existsSync(lockPath),
        '',
      );
      passed += check(
        'acquireLock: returns a release function',
        typeof release === 'function',
        `got ${typeof release}`,
      );
      release();
      total += 1;
      passed += check(
        'acquireLock: .scan.lock gone after release()',
        !existsSync(lockPath),
        '',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Case 2: double-acquire fails cleanly (without releasing first).
  {
    const dir = mkdtempSync(join(tmpdir(), 'carousel-lock-2-'));
    try {
      const release = acquireLock(dir);
      let threw = false;
      let msg = '';
      try {
        acquireLock(dir);
      } catch (err) {
        threw = true;
        msg = err?.message || '';
      }
      total += 2;
      passed += check(
        'acquireLock: second call on same outDir throws',
        threw,
        threw ? `threw "${msg.slice(0, 80)}..."` : 'did not throw',
      );
      passed += check(
        'acquireLock: error message includes "Scan already in progress" + lock path',
        msg.includes('Scan already in progress') && msg.includes('.scan.lock'),
        `got "${msg}"`,
      );
      release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Case 3: release allows re-acquire.
  {
    const dir = mkdtempSync(join(tmpdir(), 'carousel-lock-3-'));
    try {
      const r1 = acquireLock(dir);
      r1();
      let reacquired = false;
      let err2;
      try {
        const r2 = acquireLock(dir);
        reacquired = typeof r2 === 'function';
        r2();
      } catch (err) {
        err2 = err;
      }
      total += 1;
      passed += check(
        'acquireLock: re-acquire succeeds after release',
        reacquired && !err2,
        err2 ? `threw ${err2.message}` : 'ok',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Case 4: stale lock auto-cleanup (PID that almost certainly isn't a running process).
  // We pick 99999999 — above the typical PID_MAX (4_194_304 on Linux, 99_998 on macOS).
  // process.kill(huge_pid, 0) returns ESRCH and acquireLock treats the lock as stale.
  {
    const dir = mkdtempSync(join(tmpdir(), 'carousel-lock-4-'));
    try {
      const lockPath = join(dir, '.scan.lock');
      writeFileSync(lockPath, `99999999\n2020-01-01T00:00:00.000Z\n`, 'utf8');
      let release;
      let err;
      // Capture stderr written by the stale-lock warning so it doesn't
      // pollute the test output when the check passes.
      const origErr = process.stderr.write.bind(process.stderr);
      let capturedStderr = '';
      process.stderr.write = (chunk, ...rest) => {
        capturedStderr += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
      };
      try {
        release = acquireLock(dir);
      } catch (e) {
        err = e;
      } finally {
        process.stderr.write = origErr;
      }
      total += 3;
      passed += check(
        'acquireLock: stale lock (dead pid) is auto-reclaimed',
        typeof release === 'function' && !err,
        err ? `threw ${err.message}` : 'reclaimed',
      );
      passed += check(
        'acquireLock: stale cleanup writes stderr warning naming the dead pid',
        capturedStderr.includes('cleaned stale lock') && capturedStderr.includes('99999999'),
        `got "${capturedStderr.trim()}"`,
      );
      passed += check(
        'acquireLock: new lock content replaces the stale one',
        existsSync(lockPath) && readFileSync(lockPath, 'utf8').split('\n')[0] === String(process.pid),
        `got pid line "${existsSync(lockPath) ? readFileSync(lockPath, 'utf8').split('\n')[0] : 'no file'}"`,
      );
      if (typeof release === 'function') release();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- v0.7 Task B.2 — Full-page screenshot size cap (audit I2) ----
  console.log(`\n=== computeScreenshotOptions (v0.7 B.2) ===`);

  // Case 1: small page (well under 8000px) → fullPage: true, not clipped.
  {
    const plan = computeScreenshotOptions(2500);
    total += 3;
    passed += check(
      'computeScreenshotOptions(2500): options.fullPage === true',
      plan.options && plan.options.fullPage === true,
      `got ${JSON.stringify(plan.options)}`,
    );
    passed += check(
      'computeScreenshotOptions(2500): clipped === false',
      plan.clipped === false,
      `got ${plan.clipped}`,
    );
    passed += check(
      'computeScreenshotOptions(2500): options.clip is absent (no clip on short pages)',
      plan.options && plan.options.clip === undefined,
      `got ${JSON.stringify(plan.options.clip)}`,
    );
  }

  // Case 2: exactly at the 8000px boundary → still fullPage (strictly-greater check).
  {
    const plan = computeScreenshotOptions(8000);
    total += 2;
    passed += check(
      'computeScreenshotOptions(8000): boundary case is fullPage (strict >)',
      plan.options && plan.options.fullPage === true,
      `got ${JSON.stringify(plan.options)}`,
    );
    passed += check(
      'computeScreenshotOptions(8000): clipped === false at exact boundary',
      plan.clipped === false,
      `got ${plan.clipped}`,
    );
  }

  // Case 3: just over boundary → clipped with correct dimensions.
  {
    const plan = computeScreenshotOptions(8001);
    total += 4;
    passed += check(
      'computeScreenshotOptions(8001): clipped === true',
      plan.clipped === true,
      `got ${plan.clipped}`,
    );
    passed += check(
      'computeScreenshotOptions(8001): options.clip = {x:0, y:0, width:1440, height:8000}',
      plan.options
        && plan.options.clip
        && plan.options.clip.x === 0
        && plan.options.clip.y === 0
        && plan.options.clip.width === 1440
        && plan.options.clip.height === 8000,
      `got ${JSON.stringify(plan.options.clip)}`,
    );
    passed += check(
      'computeScreenshotOptions(8001): options.fullPage is absent when clipping',
      plan.options && plan.options.fullPage === undefined,
      `got ${JSON.stringify(plan.options.fullPage)}`,
    );
    passed += check(
      'computeScreenshotOptions(8001): original = 8001 echoed back for warning',
      plan.original === 8001,
      `got ${plan.original}`,
    );
  }

  // Case 4: very tall page (20000px) → clipped, options.type === 'png'.
  {
    const plan = computeScreenshotOptions(20000);
    total += 3;
    passed += check(
      'computeScreenshotOptions(20000): clipped === true on very tall page',
      plan.clipped === true,
      `got ${plan.clipped}`,
    );
    passed += check(
      'computeScreenshotOptions(20000): options.type === "png"',
      plan.options && plan.options.type === 'png',
      `got ${plan.options?.type}`,
    );
    passed += check(
      'computeScreenshotOptions(20000): clip height capped at 8000 regardless of input',
      plan.options && plan.options.clip && plan.options.clip.height === 8000,
      `got ${plan.options?.clip?.height}`,
    );
  }

  // ---- v0.7 Task B.4 — extractLogo fixture coverage (audit I4) ----
  // Drives the pure `extractLogoFromSignals` core with synthetic signals that
  // mirror what `collectLogoSignals(page, baseUrl)` would return for each of
  // the 4 HTML fixtures. No Puppeteer, no DOM — the fixtures exist as
  // human-readable references; the signal extraction is hand-rolled below so
  // we can run this on CI without a browser.
  console.log(`\n=== extractLogo fixtures (v0.7 B.4) ===`);

  const logoFixturesDir = join(__dirname, '..', 'logo-fixtures');

  // Tiny regex-backed HTML → signals translator. Intentionally minimal: the
  // production collector uses real DOM selectors; here we just need enough
  // fidelity to emulate what each fixture's DOM would surface.
  const htmlToSignals = (html, baseUrl) => {
    // Branch 1: inline SVG whose opening tag carries class="...logo..." and
    // sits inside <header> or <nav>. Case-insensitive.
    let inlineSvg = null;
    const headerMatch = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)
      || html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
    if (headerMatch) {
      const svgInHeader = headerMatch[1].match(/<svg\b[^>]*class=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<\/svg>/i);
      if (svgInHeader) inlineSvg = svgInHeader[0];
    }

    // Branch 1b: positional SVG (anywhere, top of page, small). We don't
    // emulate getBoundingClientRect — none of our fixtures exercise this
    // branch, so we leave it null. (Added as a future hook.)
    const positionalSvg = null;

    // Branch 2: <img alt~="logo"> inside header/nav, or header a[href="/"] img,
    // or [class*="logo"] img. We just look for any <img> tag with alt
    // containing "logo" anywhere in the doc (our fixtures only put one there).
    let imgUrl = null;
    const imgMatch = html.match(/<img\b[^>]*alt=["'][^"']*logo[^"']*["'][^>]*>/i);
    if (imgMatch) {
      const srcMatch = imgMatch[0].match(/\bsrc=["']([^"']+)["']/i);
      if (srcMatch && srcMatch[1] && !srcMatch[1].startsWith('data:')) {
        imgUrl = srcMatch[1];
      }
    }

    // Branch 3: <link rel="icon"|"shortcut icon"|"apple-touch-icon" href="...">
    let favUrl = null;
    const linkMatch = html.match(/<link\b[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i);
    if (linkMatch) {
      const hrefMatch = linkMatch[0].match(/\bhref=["']([^"']+)["']/i);
      if (hrefMatch && hrefMatch[1]) {
        try {
          favUrl = new URL(hrefMatch[1], baseUrl).href;
        } catch {
          favUrl = hrefMatch[1];
        }
      }
    }

    return { inlineSvg, positionalSvg, imgUrl, favUrl };
  };

  // Shared dummy fetch — returns a small Buffer; never hits the network.
  const dummyFetch = async () => Buffer.from('FAKE_IMAGE_BYTES');

  // --- Case 1: inline-svg-logo.html → type:'inline-svg', SVG written to disk ---
  {
    const html = readFileSync(join(logoFixturesDir, 'inline-svg-logo.html'), 'utf8');
    const signals = htmlToSignals(html, 'https://example.com/');
    const outDir = mkdtempSync(join(tmpdir(), 'carousel-logo-1-'));
    try {
      const result = await extractLogoFromSignals(signals, outDir, 'https://example.com/', { fetchFn: dummyFetch });
      total += 4;
      passed += check(
        'inline-svg fixture → type === "inline-svg"',
        result && result.type === 'inline-svg',
        `got ${JSON.stringify(result)}`,
      );
      passed += check(
        'inline-svg fixture → logo.svg written to outputDir',
        typeof result.path === 'string' && existsSync(result.path) && result.path.endsWith('logo.svg'),
        `got path=${result?.path}`,
      );
      const written = result.path && existsSync(result.path) ? readFileSync(result.path, 'utf8') : '';
      passed += check(
        'inline-svg fixture → written file contains class="site-logo"',
        written.includes('class="site-logo"'),
        `got ${written.slice(0, 60)}...`,
      );
      // v0.7 B.5: class-match inline-svg is the preferred branch → fallback: false
      passed += check(
        'inline-svg fixture → fallback === false (class-match is preferred branch)',
        result.fallback === false,
        `got fallback=${result?.fallback}`,
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  // --- Case 2: img-logo.html → type:'img', sourceUrl matches, cross-origin flagged ---
  {
    const html = readFileSync(join(logoFixturesDir, 'img-logo.html'), 'utf8');
    const signals = htmlToSignals(html, 'https://mycompany.com/');
    const outDir = mkdtempSync(join(tmpdir(), 'carousel-logo-2-'));
    try {
      const result = await extractLogoFromSignals(signals, outDir, 'https://mycompany.com/', { fetchFn: dummyFetch });
      total += 4;
      passed += check(
        'img fixture → type === "img"',
        result && result.type === 'img',
        `got ${JSON.stringify(result)}`,
      );
      passed += check(
        'img fixture → sourceUrl === "https://example.com/logo.png"',
        result.sourceUrl === 'https://example.com/logo.png',
        `got ${result?.sourceUrl}`,
      );
      passed += check(
        'img fixture → crossOrigin flag set (example.com !== mycompany.com)',
        result.crossOrigin === true,
        `got ${result?.crossOrigin}`,
      );
      // v0.7 B.5: img branch is still priority 2, no earlier branch was
      // skipped; fallback: false.
      passed += check(
        'img fixture → fallback === false (alt=logo match is preferred branch)',
        result.fallback === false,
        `got fallback=${result?.fallback}`,
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  // --- Case 3: favicon-only.html → type:'favicon', fallback:true ---
  // v0.7 B.5: reaching the favicon branch means inline-svg + img both missed,
  // so the descriptor now carries fallback: true. The synthesizer uses this
  // to downgrade logo confidence and write source: "favicon-fallback".
  {
    const html = readFileSync(join(logoFixturesDir, 'favicon-only.html'), 'utf8');
    const signals = htmlToSignals(html, 'https://example.com/');
    const outDir = mkdtempSync(join(tmpdir(), 'carousel-logo-3-'));
    try {
      const result = await extractLogoFromSignals(signals, outDir, 'https://example.com/', { fetchFn: dummyFetch });
      total += 3;
      passed += check(
        'favicon-only fixture → type === "favicon"',
        result && result.type === 'favicon',
        `got ${JSON.stringify(result)}`,
      );
      passed += check(
        'favicon-only fixture → sourceUrl resolves to https://example.com/favicon.ico',
        result.sourceUrl === 'https://example.com/favicon.ico',
        `got ${result?.sourceUrl}`,
      );
      passed += check(
        'favicon-only fixture → fallback === true (reached after inline-svg + img missed)',
        result.fallback === true,
        `got fallback=${result?.fallback}`,
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  // --- Case 4: no-logo.html → type:'none' (all branches fail) ---
  // The favicon branch still tries /favicon.ico as a belt-and-braces default;
  // we reject it via a fetchFn that throws. That exercises the final "none"
  // fallthrough path — the real production behavior when the network is
  // unreachable or the server 404s /favicon.ico.
  {
    const html = readFileSync(join(logoFixturesDir, 'no-logo.html'), 'utf8');
    const signals = htmlToSignals(html, 'https://example.com/');
    const rejectFetch = async () => { throw new Error('simulated network failure'); };
    const outDir = mkdtempSync(join(tmpdir(), 'carousel-logo-4-'));
    try {
      const result = await extractLogoFromSignals(signals, outDir, 'https://example.com/', { fetchFn: rejectFetch });
      total += 2;
      passed += check(
        'no-logo fixture → type === "none" when favicon fetch fails',
        result && result.type === 'none',
        `got ${JSON.stringify(result)}`,
      );
      passed += check(
        'no-logo fixture → warning message present',
        typeof result.warning === 'string' && result.warning.includes('No logo found'),
        `got warning=${result?.warning}`,
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  // ---- v0.7 Task B.7 — printUsage (--help / -h) ----
  console.log(`\n=== printUsage (v0.7 B.7) ===`);
  {
    const out = printUsage();
    total += 5;
    passed += check(
      'printUsage: returns a non-empty string',
      typeof out === 'string' && out.length > 0,
      `got ${typeof out}, length=${typeof out === 'string' ? out.length : 'n/a'}`,
    );
    passed += check(
      'printUsage: includes "Usage:" synopsis',
      out.includes('Usage: node scripts/scan-site.mjs'),
      '',
    );
    passed += check(
      'printUsage: mentions --merge-with',
      out.includes('--merge-with'),
      '',
    );
    passed += check(
      'printUsage: mentions --preset with at least one preset name',
      out.includes('--preset') && out.includes('technical-mono'),
      '',
    );
    passed += check(
      'printUsage: documents BRANDFETCH_API_KEY env var',
      out.includes('BRANDFETCH_API_KEY'),
      '',
    );
  }

  // ---- v0.7 Task C.1 — parseViewBox (logo viewBox-aware scaling) ----
  console.log(`\n=== parseViewBox (v0.7 C.1) ===`);
  {
    const wide = parseViewBox('<svg viewBox="0 0 100 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h100v24H0z"/></svg>');
    total += 1;
    passed += check(
      'parseViewBox: "0 0 100 24" → {width:100, height:24}',
      wide.width === 100 && wide.height === 24,
      `got ${JSON.stringify(wide)}`,
    );

    const wider = parseViewBox('<svg viewBox="0 0 200 50"><g/></svg>');
    total += 1;
    passed += check(
      'parseViewBox: "0 0 200 50" → {width:200, height:50}',
      wider.width === 200 && wider.height === 50,
      `got ${JSON.stringify(wider)}`,
    );

    const none = parseViewBox('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
    total += 1;
    passed += check(
      'parseViewBox: no viewBox attr → 24x24 default (backwards compat)',
      none.width === 24 && none.height === 24,
      `got ${JSON.stringify(none)}`,
    );

    const square = parseViewBox('<svg viewBox="0 0 24 24"><path/></svg>');
    total += 1;
    passed += check(
      'parseViewBox: "0 0 24 24" → {width:24, height:24} (legacy icon)',
      square.width === 24 && square.height === 24,
      `got ${JSON.stringify(square)}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Preferences parser — Task A.1 for v0.7.1
  // Covers parsePreferences() + validatePreferences() from scripts/preferences.mjs
  // ────────────────────────────────────────────────────────────────────
  {
    console.log('\n=== preferences parser (v0.7.1 A.1) ===');

    // Test 1: empty input returns defaults
    const empty = parsePreferences({});
    total += 1;
    passed += check(
      'empty returns defaults',
      empty.density === 'standard'
        && empty.visualStyle === 'match-scan'
        && empty.contentWeight === 'balanced'
        && empty.moodOverride === 'match-scan'
        && empty.logoPlacement === 'top-right'
        && Array.isArray(empty.warnings)
        && empty.warnings.length === 0
        && empty.customNotes && Object.keys(empty.customNotes).length === 0,
      `got ${JSON.stringify(empty)}`,
    );

    // Test 2: canonical enum values pass through
    const canonical = parsePreferences({
      density: 'minimalist',
      visualStyle: 'paper',
      contentWeight: 'text-heavy',
    });
    total += 1;
    passed += check(
      'canonical values preserved',
      canonical.density === 'minimalist'
        && canonical.visualStyle === 'paper'
        && canonical.contentWeight === 'text-heavy'
        && canonical.warnings.length === 0,
      `got ${JSON.stringify(canonical)}`,
    );

    // Test 3: "Custom: foo" escape captured as customNotes
    const custom = parsePreferences({ density: 'Custom: tight-but-breathable' });
    total += 1;
    passed += check(
      'custom escape captured',
      custom.density === 'custom'
        && custom.customNotes.density === 'tight-but-breathable',
      `got ${JSON.stringify(custom)}`,
    );

    // Test 4: unknown enum falls back to default + warning
    const invalid = parsePreferences({ density: 'explosive' });
    total += 1;
    passed += check(
      'unknown falls back to default with warning',
      invalid.density === 'standard'
        && invalid.warnings.some((w) => w === 'density: unknown value "explosive"'),
      `got ${JSON.stringify(invalid)}`,
    );

    // Test 5: validation rejects non-string scalar
    const nonStringErrs = validatePreferences({ density: 123 });
    total += 1;
    passed += check(
      'validatePreferences rejects non-string scalar',
      nonStringErrs.length > 0,
      `got ${JSON.stringify(nonStringErrs)}`,
    );

    // Test 6: case-insensitive enum matching
    const upper = parsePreferences({ density: 'MINIMALIST' });
    total += 1;
    passed += check(
      'case-insensitive: MINIMALIST → minimalist',
      upper.density === 'minimalist' && upper.warnings.length === 0,
      `got density=${upper.density} warnings=${JSON.stringify(upper.warnings)}`,
    );

    // Test 7: leading/trailing whitespace is trimmed
    const padded = parsePreferences({ density: '  minimalist  ' });
    total += 1;
    passed += check(
      'whitespace trimmed: "  minimalist  " → minimalist',
      padded.density === 'minimalist' && padded.warnings.length === 0,
      `got density=${padded.density} warnings=${JSON.stringify(padded.warnings)}`,
    );

    // Test 8: custom escape with extra whitespace trims inner note
    const paddedCustom = parsePreferences({ density: '  Custom:   my note  ' });
    total += 1;
    passed += check(
      'custom with extra whitespace: captures "my note" trimmed',
      paddedCustom.density === 'custom'
        && paddedCustom.customNotes.density === 'my note',
      `got ${JSON.stringify(paddedCustom)}`,
    );

    // Test 9: null input returns all defaults, no crash
    const nullPrefs = parsePreferences(null);
    total += 1;
    passed += check(
      'null input → defaults, no crash',
      nullPrefs.density === DEFAULTS.density
        && nullPrefs.visualStyle === DEFAULTS.visualStyle
        && nullPrefs.warnings.length === 0,
      `got ${JSON.stringify(nullPrefs)}`,
    );

    // Test 9b: undefined input also safe
    const undefPrefs = parsePreferences(undefined);
    total += 1;
    passed += check(
      'undefined input → defaults, no crash',
      undefPrefs.density === DEFAULTS.density
        && undefPrefs.logoPlacement === DEFAULTS.logoPlacement
        && undefPrefs.warnings.length === 0,
      `got ${JSON.stringify(undefPrefs)}`,
    );

    // Test 10: empty string treated as absent (default, no warning)
    const emptyStr = parsePreferences({ density: '', visualStyle: 'paper' });
    total += 1;
    passed += check(
      'empty string treated as absent (no warning, keeps default)',
      emptyStr.density === 'standard'
        && emptyStr.visualStyle === 'paper'
        && emptyStr.warnings.length === 0,
      `got ${JSON.stringify(emptyStr)}`,
    );

    // Test 11: customNotes key on input does NOT get iterated as a preference
    //   (only DEFAULTS keys are walked — customNotes / warnings are output-only)
    const roundtripInput = { density: 'dense', customNotes: { density: 'prev' } };
    const roundtrip = parsePreferences(roundtripInput);
    total += 1;
    passed += check(
      'customNotes on input is not parsed as a preference field',
      roundtrip.density === 'dense'
        // customNotes should be a fresh object populated by this parse run
        // (which had no Custom: escapes), so no 'density' note should exist
        && roundtrip.customNotes.density === undefined
        && roundtrip.warnings.length === 0,
      `got ${JSON.stringify(roundtrip)}`,
    );

    // Test 12: validatePreferences flags unknown top-level key
    const unknownKeyErrs = validatePreferences({ density: 'standard', foobar: 'nope' });
    total += 1;
    passed += check(
      'validatePreferences flags unknown top-level key',
      unknownKeyErrs.some((e) => e === 'unknown key: foobar'),
      `got ${JSON.stringify(unknownKeyErrs)}`,
    );

    // Test 13: validatePreferences passes for valid prefs
    const okErrs = validatePreferences({
      density: 'minimalist',
      visualStyle: 'paper',
      contentWeight: 'balanced',
    });
    total += 1;
    passed += check(
      'validatePreferences: empty errors for valid input',
      okErrs.length === 0,
      `got ${JSON.stringify(okErrs)}`,
    );

    // Test 14: validatePreferences rejects non-object top-level
    const nonObjErrs = validatePreferences('not an object');
    total += 1;
    passed += check(
      'validatePreferences rejects non-object top-level',
      nonObjErrs.length > 0 && nonObjErrs[0] === 'preferences must be an object',
      `got ${JSON.stringify(nonObjErrs)}`,
    );
  }

  // ============================================================
  // load-font (v0.7.1 B.2)
  // ============================================================
  {
    console.log(`\n=== load-font (v0.7.1 B.2) ===`);

    // inferFontFormat — extension detection
    total += 1;
    passed += check('woff2 detected', inferFontFormat('/tmp/foo.woff2') === 'woff2');

    total += 1;
    passed += check('ttf detected', inferFontFormat('/tmp/foo.ttf') === 'truetype');

    total += 1;
    passed += check('otf detected', inferFontFormat('/tmp/foo.otf') === 'opentype');

    total += 1;
    passed += check('woff detected', inferFontFormat('/tmp/foo.woff') === 'woff');

    total += 1;
    passed += check(
      'uppercase extension works',
      inferFontFormat('/tmp/FOO.WOFF2') === 'woff2',
    );

    total += 1;
    passed += check(
      'unknown extension throws',
      (() => { try { inferFontFormat('/tmp/foo.pdf'); return false; } catch { return true; } })(),
    );

    // loadFont — happy path (tiny fixture file)
    const fixturePath = join(__dirname, '..', 'custom-fonts', 'test-font.woff2');
    const loaded = loadFont(fixturePath);

    total += 1;
    passed += check('loaded returns buffer', Buffer.isBuffer(loaded.buffer));

    total += 1;
    passed += check('format populated', loaded.format === 'woff2');

    total += 1;
    passed += check('mime populated', loaded.mime === 'font/woff2');

    total += 1;
    passed += check('no size warning on tiny', loaded.warnings.length === 0);

    // loadFont — medium file triggers warning (generate + clean up)
    const medPath = '/tmp/test-font-med.woff2';
    writeFileSync(medPath, Buffer.alloc(260 * 1024, 0));
    try {
      const med = loadFont(medPath);
      total += 1;
      passed += check(
        'size warning at 260KB',
        med.warnings.some((w) => w.includes('large')),
      );
    } finally {
      try { unlinkSync(medPath); } catch {}
    }

    // loadFont — over cap rejected (generate + clean up)
    const bigPath = '/tmp/test-font-big.woff2';
    writeFileSync(bigPath, Buffer.alloc(600 * 1024, 0));
    try {
      let threw = false;
      let msg = '';
      try {
        loadFont(bigPath);
      } catch (err) {
        threw = true;
        msg = err.message;
      }
      total += 1;
      passed += check(
        'rejects >500KB',
        threw && msg.includes('500'),
        `threw=${threw} msg="${msg}"`,
      );
    } finally {
      try { unlinkSync(bigPath); } catch {}
    }

    // embedFontAsDataUri — custom weight/style
    const css = embedFontAsDataUri({
      family: 'Test',
      file: fixturePath,
      weight: 700,
      style: 'normal',
    });

    total += 1;
    passed += check('emits @font-face', css.includes('@font-face'));

    total += 1;
    passed += check('emits font-family', css.includes("font-family: 'Test'"));

    total += 1;
    passed += check('emits weight', css.includes('font-weight: 700'));

    total += 1;
    passed += check('emits base64 data URI', css.includes('data:font/woff2;base64,'));

    total += 1;
    passed += check('emits format hint', css.includes("format('woff2')"));

    total += 1;
    passed += check('emits font-display swap', css.includes('font-display: swap'));

    // embedFontAsDataUri — default weight/style
    const cssDefault = embedFontAsDataUri({ family: 'Foo', file: fixturePath });

    total += 1;
    passed += check('default weight 400', cssDefault.includes('font-weight: 400'));

    total += 1;
    passed += check('default style normal', cssDefault.includes('font-style: normal'));
  }

  // ---- v0.7.1 Task A.2 — --ask flag pass-through (parseArgv) ----
  console.log(`\n=== --ask flag (v0.7.1 A.2) ===`);

  // Case 1: --ask before positionals → askPreferences=true, url+out parsed.
  {
    const result = parseArgv(['node', 'scan-site.mjs', '--ask', 'https://example.com', './out']);
    total += 3;
    passed += check(
      'parseArgv: --ask before positionals returns non-null',
      result !== null,
      `got ${JSON.stringify(result)}`,
    );
    passed += check(
      'parseArgv: askPreferences === true when --ask passed (leading)',
      result && result.askPreferences === true,
      `got ${result?.askPreferences}`,
    );
    passed += check(
      'parseArgv: positionals preserved (urlArg + outArg) alongside --ask',
      result && result.urlArg === 'https://example.com' && result.outArg === './out',
      `got url=${result?.urlArg} out=${result?.outArg}`,
    );
  }

  // Case 2: no --ask → askPreferences defaults to false.
  {
    const result = parseArgv(['node', 'scan-site.mjs', 'https://example.com', './out']);
    total += 2;
    passed += check(
      'parseArgv: askPreferences === false by default (flag absent)',
      result && result.askPreferences === false,
      `got ${result?.askPreferences}`,
    );
    passed += check(
      'parseArgv: askPreferences is a strict boolean (not undefined)',
      result && typeof result.askPreferences === 'boolean',
      `typeof askPreferences = ${typeof result?.askPreferences}`,
    );
  }

  // Case 3: --ask + --merge-with coexist without conflict.
  {
    const result = parseArgv(['node', 'scan-site.mjs', '--ask', '--merge-with', './p.json', 'https://example.com', './out']);
    total += 3;
    passed += check(
      'parseArgv: --ask + --merge-with both set askPreferences and mergeWithPath',
      result
        && result.askPreferences === true
        && result.mergeWithPath === './p.json',
      `ask=${result?.askPreferences} merge=${result?.mergeWithPath}`,
    );
    passed += check(
      'parseArgv: positionals still parse when both flags + positionals mixed',
      result && result.urlArg === 'https://example.com' && result.outArg === './out',
      `got url=${result?.urlArg} out=${result?.outArg}`,
    );
    passed += check(
      'parseArgv: forcedPreset still null when --ask+--merge-with passed without --preset',
      result && result.forcedPreset === null,
      `got ${result?.forcedPreset}`,
    );
  }

  // Case 4: --ask at trailing position (after positionals) still works.
  {
    const result = parseArgv(['node', 'scan-site.mjs', 'https://example.com', './out', '--ask']);
    total += 2;
    passed += check(
      'parseArgv: --ask at trailing position → askPreferences === true',
      result && result.askPreferences === true,
      `got ${result?.askPreferences}`,
    );
    passed += check(
      'parseArgv: positionals intact when --ask trails',
      result && result.urlArg === 'https://example.com' && result.outArg === './out',
      `got url=${result?.urlArg} out=${result?.outArg}`,
    );
  }

  // Case 5 (bonus): triple-combo --ask + --merge-with + --preset.
  {
    const result = parseArgv([
      'node', 'scan-site.mjs',
      '--ask',
      '--merge-with', './p.json',
      '--preset', 'neo-grotesk',
      'https://example.com', './out',
    ]);
    total += 1;
    passed += check(
      'parseArgv: --ask + --merge-with + --preset all coexist',
      result
        && result.askPreferences === true
        && result.mergeWithPath === './p.json'
        && result.forcedPreset === 'neo-grotesk'
        && result.urlArg === 'https://example.com'
        && result.outArg === './out',
      `got ${JSON.stringify(result)}`,
    );
  }

  // ------------------------------------------------------------------
  // === pixel sampling + glow (v0.8 A) ===
  // ------------------------------------------------------------------
  console.log(`\n=== pixel sampling + glow (v0.8 A) ===`);

  // Build a valid 1×1 PNG in memory (RGB, no alpha). Uses the same stdlib
  // zlib pipeline parsePngPixel will reverse, so this exercises the full
  // encode→decode roundtrip. CRCs are zeroed out — PNG decoders generally
  // tolerate that, and parsePngPixel doesn't validate CRC.
  function make1x1Png(r, g, b) {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: length=13, type=IHDR, 1×1 RGB 8-bit, no interlace
    const ihdrData = Buffer.from([
      0, 0, 0, 1, // width = 1
      0, 0, 0, 1, // height = 1
      8,          // bit depth
      2,          // color type 2 = RGB (truecolor, no alpha)
      0, 0, 0,    // compression, filter, interlace
    ]);
    const ihdr = Buffer.concat([
      Buffer.from([0, 0, 0, 13]),
      Buffer.from('IHDR'),
      ihdrData,
      Buffer.from([0, 0, 0, 0]), // CRC placeholder
    ]);
    const rawData = Buffer.from([0, r, g, b]); // filter byte 0, then RGB
    const idatData = zlib.deflateSync(rawData);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(idatData.length, 0);
    const idat = Buffer.concat([
      lenBuf,
      Buffer.from('IDAT'),
      idatData,
      Buffer.from([0, 0, 0, 0]), // CRC placeholder
    ]);
    const iend = Buffer.from([
      0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    return Buffer.concat([sig, ihdr, idat, iend]).toString('base64');
  }

  // -------- parsePngPixel (6) --------
  {
    const px = parsePngPixel(make1x1Png(255, 0, 0));
    total += 1;
    passed += check(
      'parsePngPixel: red PNG → {r:255,g:0,b:0}',
      px && px.r === 255 && px.g === 0 && px.b === 0,
      `got ${JSON.stringify(px)}`,
    );
  }
  {
    const px = parsePngPixel(make1x1Png(0, 255, 0));
    total += 1;
    passed += check(
      'parsePngPixel: green PNG → {r:0,g:255,b:0}',
      px && px.r === 0 && px.g === 255 && px.b === 0,
      `got ${JSON.stringify(px)}`,
    );
  }
  {
    const px = parsePngPixel(make1x1Png(0, 0, 255));
    total += 1;
    passed += check(
      'parsePngPixel: blue PNG → {r:0,g:0,b:255}',
      px && px.r === 0 && px.g === 0 && px.b === 255,
      `got ${JSON.stringify(px)}`,
    );
  }
  {
    const px = parsePngPixel(make1x1Png(0, 0, 0));
    total += 1;
    passed += check(
      'parsePngPixel: black PNG → {r:0,g:0,b:0}',
      px && px.r === 0 && px.g === 0 && px.b === 0,
      `got ${JSON.stringify(px)}`,
    );
  }
  {
    const px = parsePngPixel(make1x1Png(255, 255, 255));
    total += 1;
    passed += check(
      'parsePngPixel: white PNG → {r:255,g:255,b:255}',
      px && px.r === 255 && px.g === 255 && px.b === 255,
      `got ${JSON.stringify(px)}`,
    );
  }
  {
    // Malformed: only the 8-byte PNG signature — no IDAT chunk at all.
    const sigOnly = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
    const px = parsePngPixel(sigOnly);
    total += 1;
    passed += check(
      'parsePngPixel: malformed PNG (no IDAT) → null',
      px === null,
      `got ${JSON.stringify(px)}`,
    );
  }

  // -------- clusterDominantColors (5) --------
  {
    // 5 samples all near #0A0A0A → single cluster, role=background.
    const samples = Array.from({ length: 5 }, (_, i) => ({
      x: i, y: i, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 },
    }));
    const out = clusterDominantColors(samples);
    total += 1;
    passed += check(
      'clusterDominantColors: 5 samples #0A0A0A → 1 cluster, role=background',
      out.length === 1 && out[0].count === 5 && out[0].role === 'background',
      `got ${JSON.stringify(out)}`,
    );
  }
  {
    // 3 dark + 2 saturated blue + 1 white → dark=background, blue=accent.
    const samples = [
      { x: 0, y: 0, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
      { x: 1, y: 1, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
      { x: 2, y: 2, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
      { x: 3, y: 3, hex: '#2B5BFF', rgb: { r: 43, g: 91, b: 255 } },
      { x: 4, y: 4, hex: '#2B5BFF', rgb: { r: 43, g: 91, b: 255 } },
      { x: 5, y: 5, hex: '#FFFFFF', rgb: { r: 255, g: 255, b: 255 } },
    ];
    const out = clusterDominantColors(samples);
    const bg = out.find((c) => c.role === 'background');
    const accent = out.find((c) => c.role === 'accent');
    total += 1;
    passed += check(
      'clusterDominantColors: mixed dark+blue+white → background=dark, accent=blue',
      bg && bg.hex === '#0A0A0A' && accent && accent.hex === '#2B5BFF',
      `got ${JSON.stringify(out)}`,
    );
  }
  {
    const out = clusterDominantColors([]);
    total += 1;
    passed += check(
      'clusterDominantColors: empty array → empty output',
      Array.isArray(out) && out.length === 0,
      `got ${JSON.stringify(out)}`,
    );
  }
  {
    // 4 grey background + 2 high-sat blue → accent assigned to blue (count>=2, sat>=0.5).
    const samples = [
      { x: 0, y: 0, hex: '#888888', rgb: { r: 136, g: 136, b: 136 } },
      { x: 1, y: 1, hex: '#888888', rgb: { r: 136, g: 136, b: 136 } },
      { x: 2, y: 2, hex: '#888888', rgb: { r: 136, g: 136, b: 136 } },
      { x: 3, y: 3, hex: '#888888', rgb: { r: 136, g: 136, b: 136 } },
      { x: 4, y: 4, hex: '#1A4EFF', rgb: { r: 26, g: 78, b: 255 } },
      { x: 5, y: 5, hex: '#1A4EFF', rgb: { r: 26, g: 78, b: 255 } },
    ];
    const out = clusterDominantColors(samples);
    const accent = out.find((c) => c.role === 'accent');
    total += 1;
    passed += check(
      'clusterDominantColors: high-sat blue (count>=2) → role=accent',
      accent && accent.hex === '#1A4EFF',
      `got ${JSON.stringify(out)}`,
    );
  }
  {
    // Only grey clusters — no cluster should be tagged accent (all sat<0.12).
    const samples = [
      { x: 0, y: 0, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
      { x: 1, y: 1, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
      { x: 2, y: 2, hex: '#888888', rgb: { r: 136, g: 136, b: 136 } },
      { x: 3, y: 3, hex: '#888888', rgb: { r: 136, g: 136, b: 136 } },
    ];
    const out = clusterDominantColors(samples);
    const hasAccent = out.some((c) => c.role === 'accent');
    total += 1;
    passed += check(
      'clusterDominantColors: low-sat grey clusters → no accent assigned',
      !hasAccent,
      `got ${JSON.stringify(out)}`,
    );
  }

  // -------- detectGlow (5) --------
  {
    // 4 bright saturated points at flanking positions (left + right).
    // On a 1440×900-shaped grid, x<0.3 of max and x>0.7 of max = flanking.
    const samples = [
      { x: 144, y: 450, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 144, y: 900, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 1296, y: 450, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 1296, y: 900, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
    ];
    const g = detectGlow(samples);
    total += 1;
    passed += check(
      'detectGlow: 4 bright saturated flanking points → detected + position=flanking + confidence=1.0',
      g.detected && g.position === 'flanking' && g.confidence === 1.0 && g.color === '#4FA8FF',
      `got ${JSON.stringify(g)}`,
    );
  }
  {
    // All dark → no eligible points, not detected.
    const samples = Array.from({ length: 13 }, (_, i) => ({
      x: i * 100, y: i * 60, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 },
    }));
    const g = detectGlow(samples);
    total += 1;
    passed += check(
      'detectGlow: all dark points → detected=false',
      g.detected === false,
      `got ${JSON.stringify(g)}`,
    );
  }
  {
    // 1 eligible point only → below threshold (>=2).
    const samples = [
      { x: 144, y: 450, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      ...Array.from({ length: 12 }, (_, i) => ({
        x: (i + 1) * 100, y: (i + 1) * 60, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 },
      })),
    ];
    const g = detectGlow(samples);
    total += 1;
    passed += check(
      'detectGlow: only 1 eligible point → detected=false (threshold >=2)',
      g.detected === false,
      `got ${JSON.stringify(g)}`,
    );
  }
  {
    // 3 eligible points all on left side (x < 30% of max).
    // maxX will be 200 (last point), so 30% of 200 = 60. All three at x<=40 qualify as "left".
    const samples = [
      { x: 20, y: 100, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 30, y: 300, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 40, y: 500, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 200, y: 800, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
    ];
    const g = detectGlow(samples);
    total += 1;
    passed += check(
      'detectGlow: 3 eligible points all at left → position=left',
      g.detected && g.position === 'left',
      `got ${JSON.stringify(g)}`,
    );
  }
  {
    // 2 eligible points concentrated at center (40-60% on both axes).
    // maxX=1000, maxY=1000 → center band = [400,600] on each axis.
    const samples = [
      { x: 500, y: 500, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 550, y: 450, hex: '#4FA8FF', rgb: { r: 79, g: 168, b: 255 } },
      { x: 1000, y: 1000, hex: '#0A0A0A', rgb: { r: 10, g: 10, b: 10 } },
    ];
    const g = detectGlow(samples);
    total += 1;
    passed += check(
      'detectGlow: 2 eligible points at center grid → position=center',
      g.detected && g.position === 'center',
      `got ${JSON.stringify(g)}`,
    );
  }

  // === scanned background rendering (v0.8 C.2) ===
  console.log(`\n=== scanned background rendering (v0.8 C.2) ===`);

  {
    // Baseline: just baseColor → emits base rect, no defs, no overlays.
    const out = buildScannedBackground({ scanned: { baseColor: '#000000' } }, 'test');
    total += 1;
    passed += check(
      'baseColor only → emits base rect with solid fill',
      out.includes('<rect width="100%" height="100%" fill="#000000"/>')
        && !out.includes('<defs>'),
      `got ${out.slice(0, 120)}…`,
    );
  }
  {
    // Missing baseColor → warning comment + fallback to bg.color solid.
    const out = buildScannedBackground({ color: '#111111', scanned: {} }, 'test');
    total += 1;
    passed += check(
      'missing baseColor → warning comment + fallback solid',
      out.includes('warning: scanned-bg missing baseColor')
        && out.includes('fill="#111111"'),
      `got ${out.slice(0, 160)}…`,
    );
  }
  {
    // Gradient sub-object → <linearGradient> with from/to stops.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#070708',
        gradient: { from: '#070708', to: '#0F1F3A', angle: 180 },
      },
    }, 'test');
    total += 1;
    passed += check(
      'gradient → emits <linearGradient> with from/to stops',
      out.includes('<linearGradient')
        && out.includes('stop-color="#070708"')
        && out.includes('stop-color="#0F1F3A"')
        && out.includes('<defs>'),
      `got ${out.slice(0, 200)}…`,
    );
  }
  {
    // Starfield low density → ~30 circles.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'starfield', density: 'low', color: '#FFFFFF', opacity: 0.3 }],
      },
    }, 'test');
    const circleCount = (out.match(/<circle /g) || []).length;
    total += 1;
    passed += check(
      'starfield density=low → 30 circles',
      circleCount === 30,
      `got ${circleCount} circles`,
    );
  }
  {
    // Starfield high density → ~180 circles.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'starfield', density: 'high', color: '#FFFFFF' }],
      },
    }, 'test');
    const circleCount = (out.match(/<circle /g) || []).length;
    total += 1;
    passed += check(
      'starfield density=high → 180 circles',
      circleCount === 180,
      `got ${circleCount} circles`,
    );
  }
  {
    // Vortex flanking → TWO radialGradient defs (left + right mirrored).
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'vortex', position: 'flanking', color: '#2767F6', radius: 140, opacity: 0.2 }],
      },
    }, 'test');
    const radialCount = (out.match(/<radialGradient /g) || []).length;
    total += 1;
    passed += check(
      'vortex position=flanking → 2 radialGradient defs',
      radialCount === 2,
      `got ${radialCount} radialGradient defs`,
    );
  }
  {
    // Blob with blur → emits radialGradient + filter + fill with filter.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'blob', cx: '15%', cy: '50%', r: '30%', color: '#2767F6', opacity: 0.18, blur: 60 }],
      },
    }, 'test');
    total += 1;
    passed += check(
      'blob with blur → emits radialGradient + filter + filtered rect',
      out.includes('<radialGradient')
        && out.includes('<filter')
        && out.includes('<feGaussianBlur')
        && /fill="url\(#blob-\d+\)" filter="url\(#blob-blur-\d+\)"/.test(out),
      `got ${out.slice(0, 240)}…`,
    );
  }
  {
    // Grain paper texture → feTurbulence baseFrequency=0.6.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#FFFFFF',
        overlays: [{ type: 'grain', textureType: 'paper', intensity: 0.08 }],
      },
    }, 'test');
    total += 1;
    passed += check(
      'grain textureType=paper → feTurbulence baseFrequency=0.6 numOctaves=3',
      out.includes('<feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3"'),
      `got ${out.slice(0, 240)}…`,
    );
  }
  {
    // Unknown overlay type → warning comment, renders rest, does NOT crash.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'nonesuch' }, { type: 'starfield', density: 'low' }],
      },
    }, 'test');
    total += 1;
    passed += check(
      'unknown overlay type → warning comment + rest still renders',
      out.includes('warning: unknown overlay type nonesuch')
        && (out.match(/<circle /g) || []).length === 30,
      `got ${out.slice(0, 300)}…`,
    );
  }
  {
    // Glow present + position=flanking → 2 mirrored glow circles + 2 filters.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        glow: { present: true, color: '#4A90E8', radius: 80, position: 'flanking', opacity: 0.4 },
      },
    }, 'test');
    const circleCount = (out.match(/<circle /g) || []).length;
    const filterCount = (out.match(/<filter /g) || []).length;
    total += 1;
    passed += check(
      'glow present + flanking → 2 mirrored glow circles + 2 filters',
      circleCount === 2 && filterCount === 2
        && out.includes('fill="#4A90E8"'),
      `got ${circleCount} circles, ${filterCount} filters`,
    );
  }
  {
    // Glow present=false → no glow circle emitted.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        glow: { present: false, color: '#4A90E8', position: 'center' },
      },
    }, 'test');
    const circleCount = (out.match(/<circle /g) || []).length;
    total += 1;
    passed += check(
      'glow.present=false → no glow circle',
      circleCount === 0,
      `got ${circleCount} circles`,
    );
  }
  {
    // Seeded determinism: same seed → identical output.
    const recipe = {
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'starfield', density: 'low', color: '#FFFFFF' }],
      },
    };
    const a = buildScannedBackground(recipe, 'determinism-seed');
    const b = buildScannedBackground(recipe, 'determinism-seed');
    const c = buildScannedBackground(recipe, 'different-seed');
    total += 1;
    passed += check(
      'seeded determinism: same seed → byte-identical; different seed → differs',
      a === b && a !== c,
      `a===b? ${a === b}  a!==c? ${a !== c}`,
    );
  }
  {
    // Vortex with missing color → warning comment, no crash.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#000000',
        overlays: [{ type: 'vortex', position: 'center' }],
      },
    }, 'test');
    total += 1;
    passed += check(
      'vortex missing color → warning comment',
      out.includes('warning: vortex missing color'),
      `got ${out.slice(0, 200)}…`,
    );
  }
  {
    // Full cosmic-dark recipe — integration smoke, check expected element counts.
    const out = buildScannedBackground({
      scanned: {
        baseColor: '#070708',
        gradient: { from: '#070708', to: '#0F1F3A', angle: 180 },
        overlays: [
          { type: 'starfield', density: 'low', color: '#FFFFFF', opacity: 0.15 },
          { type: 'vortex', position: 'top-center', color: '#2767F6', opacity: 0.2, radius: 140 },
          { type: 'blob', cx: '15%', cy: '50%', r: '30%', color: '#2767F6', opacity: 0.18, blur: 60 },
          { type: 'blob', cx: '85%', cy: '50%', r: '30%', color: '#2767F6', opacity: 0.18, blur: 60 },
        ],
        glow: { present: true, color: '#4A90E8', radius: 80, position: 'flanking', opacity: 0.4 },
      },
    }, 'cosmic-dark::v0.8');
    const radialCount = (out.match(/<radialGradient /g) || []).length;
    const linearCount = (out.match(/<linearGradient /g) || []).length;
    const circleCount = (out.match(/<circle /g) || []).length;
    total += 1;
    passed += check(
      'full cosmic-dark recipe → 1 linearGrad + 3 radialGrad (1 vortex + 2 blobs) + 32 circles (30 stars + 2 glows)',
      linearCount === 1 && radialCount === 3 && circleCount === 32,
      `got linear=${linearCount} radial=${radialCount} circles=${circleCount}`,
    );
  }

  console.log(`\n=== ${passed}/${total} checks passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
