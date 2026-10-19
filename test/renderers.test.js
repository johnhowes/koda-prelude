import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRenderers, readPaths } from '../server/renderers.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));

test('the renderer is allowed each path once', () => {
  assert.deepEqual(readPaths(appRoot, appRoot), [resolve(appRoot)]);
  assert.deepEqual(readPaths(appRoot + '/', appRoot), [resolve(appRoot)], 'a trailing separator is the same path');
  if (process.platform === 'win32') assert.equal(readPaths(appRoot.toUpperCase(), appRoot.toLowerCase()).length, 1, 'case is the same path on Windows');
  assert.deepEqual(readPaths(appRoot, resolve(appRoot, 'server')), [resolve(appRoot), resolve(appRoot, 'server')], 'a folder inside stays');
});

test('a design in Prelude’s own folder renders: the folder and Prelude are one path', async () => {
  const renderers = createRenderers({ appRoot });
  try {
    const html = await renderers.render(appRoot, { page: { views: resolve(appRoot, 'server/views/host'), template: 'layout', data: { body: '<p>Here</p>', layout: {} } } });
    assert.match(html, /<p>Here<\/p>/);
  } finally {
    renderers.closeAll();
  }
});
