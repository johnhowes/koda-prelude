// Koda's skills, copied from the installed @kodalang/core into .claude/skills/,
// where an agent working here loads them. Runs after every npm install
// (postinstall), so upgrading Koda is changing its version and installing;
// npm run skills does it by hand. test/skills.test.js fails until the copies
// match.

import { cpSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(dirname(fileURLToPath(import.meta.resolve('@kodalang/core/package.json'))), '.claude', 'skills');
const to = join(here, '..', '.claude', 'skills');

for (const name of readdirSync(from)) {
  cpSync(join(from, name), join(to, name), { recursive: true });
  console.log(`${name}: copied`);
}
