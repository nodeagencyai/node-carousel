#!/usr/bin/env node
// run-fixture-tests.mjs — verify extract-brand-signals against the 3 fixtures.
//
// Usage:
//   node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
//
// No Puppeteer here — we feed the fixture HTML (with its inline <style>)
// directly into extractSignals and check detected fonts/colors/confidence.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractSignals } from '../../../scripts/extract-brand-signals.mjs';
import { rankDiscoveredLinks, mergeSignals } from '../../../scripts/scan-site.mjs';
import { brandfetch, normalizeBrandfetch, extractDomain } from '../../../scripts/brandfetch-client.mjs';

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

  console.log(`\n=== ${passed}/${total} checks passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
