#!/usr/bin/env node
// run-fixture-tests.mjs — verify extract-brand-signals against the 3 fixtures.
//
// Usage:
//   node test/fixtures/scan-site-fixtures/run-fixture-tests.mjs
//
// No Puppeteer here — we feed the fixture HTML (with its inline <style>)
// directly into extractSignals and check detected fonts/colors/confidence.

import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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
import { brandfetch, normalizeBrandfetch, extractDomain } from '../../../scripts/brandfetch-client.mjs';
import { extractLogoFromSignals } from '../../../scripts/extract-logo.mjs';
import { parseViewBox } from '../../../scripts/render-v0.4.mjs';

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

  console.log(`\n=== ${passed}/${total} checks passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
