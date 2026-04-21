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
      confidenceMin: 0.7,
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
      confidenceMin: 0.5,
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
      confidenceMin: 0.5,
    },
  },
];

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
      `confidence >= ${fx.expect.confidenceMin}`,
      colors.confidence >= fx.expect.confidenceMin,
      `got ${colors.confidence}`,
    );

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

  console.log(`\n=== ${passed}/${total} checks passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
