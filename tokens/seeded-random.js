// SHA-256 of seed string → 32-bit integer → mulberry32 PRNG.
// Deterministic, fast, good distribution. Pure stdlib.
import { createHash } from 'node:crypto';

export function createRng(seedString) {
  const hash = createHash('sha256').update(String(seedString)).digest();
  let state = hash.readUInt32BE(0);

  function next() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    // Pick an index from a list, deterministically.
    pick: arr => arr[Math.floor(next() * arr.length)],
    // Pick a weighted entry. weights is [[value, weight], ...].
    pickWeighted: entries => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of entries) {
        if ((r -= w) <= 0) return v;
      }
      return entries[entries.length - 1][0];
    },
    // Float in [min, max).
    range: (min, max) => min + next() * (max - min),
    // Int in [min, max].
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
  };
}

// Build the canonical seed for a carousel.
export function buildSeed({ brandHandle, topic, version = 'v0.4' }) {
  return `${version}::${String(brandHandle).trim()}::${String(topic).trim()}`;
}
