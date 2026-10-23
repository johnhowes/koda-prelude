import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The design system's menu is a popover (prelude/prelude-design-system,
// components/menu.html): a button that names its list with ko-for, and the
// list a popover with ko-as. The app's views and the shell's layouts are
// written in it, so none is still the details menu it replaced.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const views = dir => readdirSync(dir, { recursive: true })
  .filter(name => String(name).endsWith('.eta'))
  .map(name => ({ name: String(name), text: readFileSync(join(dir, String(name)), 'utf8') }));
const all = [...views(join(root, 'server', 'views')), ...views(join(root, 'prelude', 'prelude-shell', 'layouts'))];

test('every menu is the design system’s popover, not a details', () => {
  for (const { name, text } of all) {
    assert.doesNotMatch(text, /<details class="menu/, `${name}: a details menu`);
    assert.doesNotMatch(text, /ko-set="\w+\.open = false"/, `${name}: closes a menu as a details`);
    for (const list of text.match(/<\w+ class="menu-list"[^>]*>/g) ?? []) {
      const as = list.match(/ko-as="(\w+)"/)?.[1];
      assert.ok(as && / popover[ >]/.test(list), `${name}: ${list} is a named popover`);
      assert.ok(text.includes(`popovertarget ko-for="${as}"`), `${name}: a button opens ${as}`);
    }
  }
});

test('the desktop app closes Capture’s menu as a popover', () => {
  const desktop = readFileSync(join(root, 'server', 'public', 'desktop.js'), 'utf8');
  assert.doesNotMatch(desktop, /closest\('details'\)/);
  assert.match(desktop, /hidePopover\(\)/);
});
