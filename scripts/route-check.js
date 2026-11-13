'use strict';

/**
 * Dev tool: every sidebar entry must have a real route, otherwise the menu
 * link lands on the workspace "not found" screen. Run: `npm run check:routes`
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const menuSource = fs.readFileSync(path.join(ROOT, 'src', 'config', 'menu.js'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf8');

const items = [...menuSource.matchAll(/to: '(\/[a-z-]+(?:\/[a-z-]+)?)'/g)].map((m) => m[1]);
const unique = [...new Set(items)].sort();

// The route tree is read by matching the literal path attributes per role block.
function routesForRole(role) {
  const start = appSource.indexOf(`path="/${role}"`);
  if (start === -1) return [];
  const end = appSource.indexOf('<Route path="/"', start);
  const block = appSource.slice(start, end === -1 ? appSource.length : end);
  return [...block.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
}

const byRole = {};
for (const role of ['admin', 'office', 'teacher', 'student']) byRole[role] = routesForRole(role);

let failed = 0;
console.log('--- sidebar links vs routes ---------------------------------------------');

for (const role of Object.keys(byRole)) {
  const links = [...new Set([...menuSource.matchAll(/to: '(\/[a-z-]+\/[a-z-]+)'/g)]
    .map((m) => m[1])
    .filter((to) => to.startsWith(`/${role}/`)))];

  for (const link of links) {
    const [, rest] = link.split(`/${role}/`);
    const route = rest.replace('/', '');
    const ok = byRole[role].includes(route);
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ok   ' : 'MISS '} ${role}: ${link} -> path="${route}"`);
  }
}

console.log(`\n${failed === 0 ? 'EVERY SIDEBAR LINK HAS A ROUTE' : `${failed} LINK(S) WITHOUT A ROUTE`}`);
process.exit(failed === 0 ? 0 : 1);
