import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { areaSegments, createDesign, groupByArea, listDesigns, slugify } from '../server/designs.js';

const folder = () => mkdtempSync(join(tmpdir(), 'prelude-designs-'));

test('slugify makes kebab-case ids', () => {
  assert.equal(slugify('Sign Up & Invite!'), 'sign-up-invite');
  assert.equal(slugify('  Café crème '), 'cafe-creme');
  assert.equal(slugify('!!!'), '');
  assert.deepEqual(areaSegments('Onboarding / New Users\\'), ['onboarding', 'new-users']);
});

test('a folder with no prelude/ has no designs', () => {
  assert.deepEqual(listDesigns(folder()), []);
});

test('creating a design writes design.json, with or without an area', () => {
  const root = folder();
  const a = createDesign(root, { title: 'Billing redesign', area: '' });
  const b = createDesign(root, { title: 'Sign up', area: 'Onboarding' });

  assert.equal(a.design.id, 'billing-redesign');
  assert.equal(b.design.id, 'onboarding/sign-up');
  const meta = JSON.parse(readFileSync(join(root, 'prelude', 'onboarding', 'sign-up', 'design.json'), 'utf8'));
  assert.equal(meta.title, 'Sign up');
  assert.ok(meta.createdAt);

  const designs = listDesigns(root);
  assert.deepEqual(designs.map(d => [d.id, d.area, d.title]), [
    ['billing-redesign', '', 'Billing redesign'],
    ['onboarding/sign-up', 'onboarding', 'Sign up'],
  ]);
  assert.deepEqual(groupByArea(designs).map(g => g.area), ['', 'onboarding']);
});

test('the scan stops at a design and skips reserved and hidden folders', () => {
  const root = folder();
  createDesign(root, { title: 'Checkout' });
  // Something inside a design that happens to have a design.json is not a design.
  mkdirSync(join(root, 'prelude', 'checkout', 'sessions', 'x'), { recursive: true });
  writeFileSync(join(root, 'prelude', 'checkout', 'sessions', 'x', 'design.json'), '{}');
  mkdirSync(join(root, 'prelude', 'design-system', 'components'), { recursive: true });
  writeFileSync(join(root, 'prelude', 'design-system', 'design.json'), '{}');
  mkdirSync(join(root, 'prelude', '.cache', 'thing'), { recursive: true });
  writeFileSync(join(root, 'prelude', '.cache', 'thing', 'design.json'), '{}');

  assert.deepEqual(listDesigns(root).map(d => d.id), ['checkout']);
});

test('a design.json without a title falls back to the folder name', () => {
  const root = folder();
  mkdirSync(join(root, 'prelude', 'hand-made'), { recursive: true });
  writeFileSync(join(root, 'prelude', 'hand-made', 'design.json'), 'not json');
  assert.equal(listDesigns(root)[0].title, 'hand-made');
});

test('refusals: empty, reserved, duplicate, and a design inside a design', () => {
  const root = folder();
  assert.ok(createDesign(root, { title: '  ' }).errors.title);
  assert.ok(createDesign(root, { title: '???' }).errors.title);
  assert.ok(createDesign(root, { title: 'Design System' }).errors.title);
  assert.ok(createDesign(root, { title: 'X', area: 'sessions' }).errors.area);

  createDesign(root, { title: 'Sign up', area: 'onboarding' });
  assert.match(createDesign(root, { title: 'Sign up', area: 'onboarding' }).errors.title, /already exists/);
  assert.match(createDesign(root, { title: 'Step two', area: 'onboarding/sign-up' }).errors.area, /can't contain/);
  // An area that already holds designs can't itself become a design.
  assert.match(createDesign(root, { title: 'Onboarding' }).errors.title, /already exists/);
});
