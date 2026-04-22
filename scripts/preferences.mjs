// scripts/preferences.mjs — pure parser + validator for v0.7.1 carousel preferences.
//
// Shape:
//   parsePreferences(input) -> { ...DEFAULTS, customNotes, warnings }
//   validatePreferences(input) -> string[]  (empty array = valid)
//
// Canonical enum values pass through (case-insensitive, trimmed).
// Unknown values fall back to the default + emit a warning.
// "Custom: <free text>" escapes set the field to 'custom' and stash the
// trimmed text under customNotes[<key>] for the synthesizer to read.
//
// No Puppeteer, no I/O — pure JS so the questionnaire can shell it anywhere.

export const DEFAULTS = {
  density: 'standard',
  visualStyle: 'match-scan',
  contentWeight: 'balanced',
  moodOverride: 'match-scan',
  logoPlacement: 'top-right',
};

const ENUMS = {
  density: ['minimalist', 'standard', 'dense'],
  visualStyle: ['gradient', 'paper', 'geometric', 'photo', 'mesh', 'match-scan'],
  contentWeight: ['text-heavy', 'balanced', 'icon-heavy'],
  moodOverride: ['playful', 'premium', 'clinical', 'scrappy', 'editorial', 'match-scan'],
  logoPlacement: ['top-right', 'top-left', 'bottom-right', 'none'],
};

export function parsePreferences(input) {
  const out = { ...DEFAULTS, customNotes: {}, warnings: [] };
  if (!input || typeof input !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    const raw = input[key];
    if (raw == null || raw === '') continue;
    if (typeof raw !== 'string') {
      out.warnings.push(`${key}: non-string input ignored`);
      continue;
    }
    const customMatch = raw.match(/^\s*custom\s*:\s*(.+)$/i);
    if (customMatch) {
      out[key] = 'custom';
      out.customNotes[key] = customMatch[1].trim();
      continue;
    }
    const normalized = raw.toLowerCase().trim();
    if (ENUMS[key].includes(normalized)) {
      out[key] = normalized;
    } else {
      out.warnings.push(`${key}: unknown value "${raw}"`);
    }
  }
  return out;
}

export function validatePreferences(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push('preferences must be an object');
    return errors;
  }
  for (const [key, val] of Object.entries(input)) {
    if (!(key in DEFAULTS) && key !== 'customNotes' && key !== 'warnings') {
      errors.push(`unknown key: ${key}`);
    }
    if (val != null && typeof val !== 'string' && typeof val !== 'object') {
      errors.push(`${key}: must be string or object`);
    }
  }
  return errors;
}
