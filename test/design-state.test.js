import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createDesignState } from '../server/design-state.js';

const setup = () => {
  const published = [];
  const live = { publish: (channel, message) => published.push(`${channel} ${message}`) };
  return { state: createDesignState({ live }), published };
};

test('every change is announced on the design channel, numbered', () => {
  const { state, published } = setup();
  state.filesChanged('f/a');
  assert.equal(state.show('f/a', '02-pay'), true);
  const closed = state.windowOpened('f/a');
  assert.equal(state.windows('f/a'), 1);
  closed();
  assert.equal(state.windows('f/a'), 0);
  assert.deepEqual(published, ['design:f/a design-changed:1', 'design:f/a design-changed:2', 'design:f/a design-changed:3', 'design:f/a design-changed:4']);
});

test('showing the screen already on show is not news, including the first one before any pick', () => {
  const { state, published } = setup();
  assert.equal(state.show('f/a', '01-cart', { shown: '01-cart' }), false);
  assert.equal(state.current('f/a'), '01-cart');
  assert.equal(state.show('f/a', '01-cart'), false);
  assert.deepEqual(published, []);
  assert.equal(state.show('f/a', '02-pay', { shown: '01-cart' }), true);
  assert.equal(published.length, 1);
});
