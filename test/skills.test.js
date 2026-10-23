// The Koda skills in .claude/skills/ must match the installed @kodalang/core.
// npm install copies them (postinstall); if this fails anyway, run
// `npm run skills` and read what changed.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const installed = join(dirname(fileURLToPath(import.meta.resolve('@kodalang/core/package.json'))), '.claude', 'skills');
const copied = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills');

for (const name of readdirSync(installed)) {
  test(`${name} matches the installed Koda`, () => {
    const want = readFileSync(join(installed, name, 'SKILL.md'), 'utf8');
    const have = readFileSync(join(copied, name, 'SKILL.md'), 'utf8');
    assert.equal(have, want);
  });
}
