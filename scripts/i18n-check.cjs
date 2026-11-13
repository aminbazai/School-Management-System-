'use strict';

/**
 * Checks that both language files hold the same keys and that every literal
 * t('...') used in the renderer exists.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function flat(obj, prefix = '', out = {}) {
  for (const key of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      flat(obj[key], full, out);
    } else {
      out[full] = obj[key];
    }
  }
  return out;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const en = flat(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/en.json'), 'utf8')));
const ur = flat(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/ur.json'), 'utf8')));
const enKeys = Object.keys(en);
const urKeys = Object.keys(ur);

let problems = 0;

const missingInUr = enKeys.filter((k) => !(k in ur));
const extraInUr = urKeys.filter((k) => !(k in en));
const untranslated = enKeys.filter((k) => k in ur && en[k] === ur[k]);

console.log(`en keys: ${enKeys.length} | ur keys: ${urKeys.length}`);
if (missingInUr.length) {
  problems += 1;
  console.log(`MISSING IN UR (${missingInUr.length}): ${missingInUr.join(', ')}`);
}
if (extraInUr.length) {
  problems += 1;
  console.log(`EXTRA IN UR (${extraInUr.length}): ${extraInUr.join(', ')}`);
}
if (untranslated.length) {
  problems += 1;
  console.log(`NOT TRANSLATED (${untranslated.length}): ${untranslated.join(', ')}`);
}

const used = new Set();
for (const file of walk(path.join(ROOT, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) {
    used.add(match[1]);
  }
}
const missing = [...used].filter((key) => !enKeys.includes(key));
if (missing.length) {
  problems += 1;
  console.log(`t() KEYS MISSING (${missing.length}): ${missing.join(', ')}`);
}

if (problems === 0) console.log('ALL I18N CHECKS PASSED');
process.exit(problems === 0 ? 0 : 1);
