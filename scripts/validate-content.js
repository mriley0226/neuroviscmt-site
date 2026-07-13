#!/usr/bin/env node
/*
 * validate-content.js
 * --------------------
 * Guardrail that scans content.json for DUPLICATE entries in the CMS-editable
 * lists (testimonials, pricing, FAQ, credentials, research) before the site is
 * allowed to deploy.
 *
 * Why this exists:
 *   The Decap/Netlify CMS uses "list" widgets. It is one click to accidentally
 *   duplicate a testimonial or pricing card. The homepage renders whatever is in
 *   content.json verbatim, so a duplicate in the data becomes a duplicate on the
 *   live site. This script is run as part of the Netlify build (and in CI); if it
 *   finds a duplicate it exits non-zero, which FAILS THE DEPLOY and keeps the
 *   duplicate off the live site.
 *
 * Usage:
 *   node scripts/validate-content.js                # validates ./content.json
 *   node scripts/validate-content.js path/to.json   # validates a specific file
 *
 * Exit codes:
 *   0  clean
 *   1  duplicates (or other blocking problems) found
 *   2  could not read / parse the file
 *
 * Zero dependencies — runs on any stock Node (>=14).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(process.cwd(), 'content.json');

/* ----------------------------------------------------------------------------
 * Which lists to check, and what makes two entries "the same".
 *
 * Each collection defines one or more `keys` sets. Entries whose values match on
 * ALL fields of a key set are treated as duplicates. Using a few key sets lets us
 * catch both exact copies and the more common "same card, tiny edit" case.
 * -------------------------------------------------------------------------- */
const COLLECTIONS = [
  {
    label: 'Testimonials',
    // path into the JSON object
    path: ['testimonials'],
    keys: [
      { name: 'identical quote + name', fields: ['name', 'quote'] },
      { name: 'same client name', fields: ['name'], severity: 'warn' },
      { name: 'near-identical quote', fields: ['quote'], severity: 'warn', loose: true },
    ],
    display: (t) => `"${t.name}" — ${String(t.quote || '').slice(0, 50)}…`,
  },
  {
    label: 'Pricing packages',
    path: ['pricing'],
    keys: [
      { name: 'same sessions label', fields: ['sessions'] },
      { name: 'near-identical sessions label', fields: ['sessions'], severity: 'warn', loose: true },
    ],
    display: (p) => `${p.sessions} — ${p.price} (${p.timeframe})`,
  },
  {
    label: 'FAQ',
    path: ['faq'],
    keys: [
      { name: 'same question', fields: ['question'] },
      { name: 'near-identical question', fields: ['question'], severity: 'warn', loose: true },
    ],
    display: (f) => String(f.question || '').slice(0, 70),
  },
  {
    label: 'Credentials',
    path: ['about', 'credentials'],
    keys: [
      { name: 'identical credential', fields: ['__value__'] },
    ],
    display: (c) => String(c).slice(0, 70),
  },
  {
    label: 'Research articles',
    path: ['research'],
    keys: [
      { name: 'same URL', fields: ['url'] },
      { name: 'same title', fields: ['title'] },
    ],
    display: (r) => `${r.title} — ${r.url}`,
  },
];

/* ---------- helpers ---------- */

function norm(v) {
  // Strict normalization (used for BLOCKING checks): trim, collapse whitespace,
  // lowercase. Near-zero false positives — two entries only match if they are
  // effectively the same text.
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normLoose(v) {
  // Loose normalization (used for WARN-only checks): additionally strip all
  // punctuation, emoji, and non-alphanumerics. Catches "6 Sessions" vs
  // "6 Sessions." vs "6  sessions ✨" — flags them for a human, never blocks.
  return String(v == null ? '' : v)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

function keyOf(item, fields, normalizer) {
  const n = normalizer || norm;
  // For a list of plain strings (credentials), field is the special __value__.
  return fields
    .map((f) => (f === '__value__' ? n(item) : n(item && item[f])))
    .join(' ¦ ');
}

function getPath(obj, segments) {
  return segments.reduce((acc, s) => (acc == null ? acc : acc[s]), obj);
}

/* ---------- run ---------- */

let raw;
try {
  raw = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.error(`✖ Could not read ${file}: ${e.message}`);
  process.exit(2);
}

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`✖ ${path.basename(file)} is not valid JSON: ${e.message}`);
  console.error('  A malformed file would also break the live site — fix the JSON and re-save.');
  process.exit(2);
}

const problems = []; // blocking
const warnings = []; // non-blocking

for (const col of COLLECTIONS) {
  const list = getPath(data, col.path);
  if (!Array.isArray(list)) continue; // collection absent — nothing to check

  for (const keydef of col.keys) {
    const seen = new Map(); // key -> first index it appeared at
    const normalizer = keydef.loose ? normLoose : norm;
    list.forEach((item, idx) => {
      const k = keyOf(item, keydef.fields, normalizer);
      if (k === '' || k === ' ¦ ') return; // ignore fully-empty entries here
      if (seen.has(k)) {
        const firstIdx = seen.get(k);
        const msg =
          `${col.label}: entry #${idx + 1} duplicates #${firstIdx + 1} ` +
          `(${keydef.name})\n` +
          `      → ${col.display(item)}`;
        if (keydef.severity === 'warn') warnings.push(msg);
        else problems.push(msg);
      } else {
        seen.set(k, idx);
      }
    });
  }
}

/* ---------- report ---------- */

const rel = path.relative(process.cwd(), file) || file;

if (warnings.length) {
  console.log('\n⚠  Warnings (not blocking):');
  warnings.forEach((w) => console.log('   • ' + w));
}

if (problems.length) {
  console.error(`\n✖ Duplicate content detected in ${rel} — deploy blocked.\n`);
  problems.forEach((p) => console.error('   • ' + p));
  console.error(
    '\n  How to fix: open the CMS, remove the duplicate entr' +
      (problems.length > 1 ? 'ies' : 'y') +
      ' listed above, and click Publish again.\n'
  );
  process.exit(1);
}

console.log(`✓ ${rel}: no duplicate testimonials, pricing, FAQ, credentials, or research entries.`);
process.exit(0);
