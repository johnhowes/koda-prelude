import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { appDirOf, findKoda, kodaOf } from '../server/app-config.js';
import { createInstalls, installCommand, packageManagerOf } from '../server/installs.js';
import { kodaModelOf, newerVersion } from '../server/project.js';

const folderWith = files => {
  const root = mkdtempSync(join(tmpdir(), 'prelude-installs-'));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
};

// A child process that ends as told, recording how it was started.
const fakeSpawn = (code = 0) => {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = null;
    child.kill = () => {};
    calls.push({ command, args, options, child });
    if (code !== null) setImmediate(() => { child.stdout.emit('data', 'added 1 package\n'); child.emit('exit', code); });
    return child;
  };
  return { spawn, calls };
};

test('the package manager is chosen by the lockfile, the app folder first', () => {
  assert.equal(packageManagerOf(folderWith({ 'package.json': '{}' })), 'npm');
  assert.equal(packageManagerOf(folderWith({ 'pnpm-lock.yaml': '' })), 'pnpm');
  assert.equal(packageManagerOf(folderWith({ 'yarn.lock': '' })), 'yarn');
  const root = folderWith({ 'yarn.lock': '', 'app/package-lock.json': '{}' });
  assert.equal(packageManagerOf(join(root, 'app'), root), 'npm');
  const monorepo = folderWith({ 'pnpm-lock.yaml': '', 'app/package.json': '{}' });
  assert.equal(packageManagerOf(join(monorepo, 'app'), monorepo), 'pnpm');
});

test('the app folder is prelude.json’s app path, and needs a package.json', () => {
  const root = folderWith({ 'prelude/prelude.json': { app: { path: 'app' } }, 'app/package.json': '{}' });
  assert.equal(appDirOf(root), join(root, 'app'));
  assert.equal(appDirOf(folderWith({ 'package.json': '{}' })) !== null, true);
  assert.equal(appDirOf(folderWith({ 'README.md': '' })), null);
  assert.equal(appDirOf(folderWith({ 'prelude/prelude.json': { app: { path: '../elsewhere' } } })), null);
});

test('the app’s Koda: what’s installed, what package.json asks for, the worktree first', () => {
  const koda = version => JSON.stringify({ name: '@kodalang/core', version, exports: { '.': './src/koda.js' } });
  const checkout = folderWith({
    'prelude/prelude.json': { app: { path: 'app' } },
    'app/package.json': { dependencies: { '@kodalang/core': '0.1.4' } },
    'app/node_modules/@kodalang/core/package.json': koda('0.1.4'),
  });
  assert.deepEqual(kodaOf(checkout), {
    installed: { path: join(checkout, 'app', 'node_modules', '@kodalang', 'core'), entry: './src/koda.js', version: '0.1.4' },
    wanted: '0.1.4',
  });
  // A fresh worktree has no node_modules: the checkout's is found instead.
  const worktree = folderWith({ 'prelude/prelude.json': { app: { path: 'app' } }, 'app/package.json': { dependencies: { '@kodalang/core': '0.1.5' } } });
  assert.deepEqual(kodaOf(worktree), { installed: null, wanted: '0.1.5' });
  assert.equal(findKoda([worktree, checkout]).version, '0.1.4');
  // Installed at the root of a monorepo.
  const hoisted = folderWith({ 'package.json': { devDependencies: { '@kodalang/core': '0.1.5' } }, 'node_modules/@kodalang/core/package.json': koda('0.1.5') });
  assert.equal(kodaOf(hoisted).installed.version, '0.1.5');
  // An app without Koda.
  assert.equal(kodaOf(folderWith({ 'package.json': { dependencies: { express: '4.0.0' } } })), null);
  assert.equal(findKoda([folderWith({ 'README.md': '' })]), null);
});

test('the command installs only Koda, at an exact version', () => {
  assert.equal(installCommand('npm', '0.2.0').text, 'npm install --save-exact @kodalang/core@0.2.0');
  assert.equal(installCommand('npm', '0.2.0', { save: false }).text, 'npm install --no-save @kodalang/core@0.2.0');
  assert.equal(installCommand('pnpm', '0.2.0-beta.1').text, 'pnpm add --save-exact @kodalang/core@0.2.0-beta.1');
  assert.equal(installCommand('yarn', '1.0.0').text, 'yarn add --exact @kodalang/core@1.0.0');
  for (const version of ['^0.2.0', 'latest', '0.2.0 left-pad', '0.2.0 && echo hi', '']) {
    assert.throws(() => installCommand('npm', version), /exact version/);
  }
  assert.throws(() => installCommand('bun', '0.2.0'), /doesn’t install with bun/);
});

test('an install runs only in the project’s folder or its own worktrees, once approved', async () => {
  const checkout = folderWith({ 'package.json': '{}', 'package-lock.json': '{}' });
  const worktree = folderWith({ 'package.json': '{}', 'package-lock.json': '{}' });
  const stranger = folderWith({ 'package.json': '{}' });
  const folder = { id: 'f1', path: checkout };
  const branches = { of: id => (id === 'f1' ? [{ path: worktree }] : []) };
  const { spawn, calls } = fakeSpawn(0);
  const installs = createInstalls({ branches, spawn });

  assert.match(installs.plan({ folder, where: stranger, version: '0.2.0' }).error, /only in the project’s own folder/);
  assert.match(installs.plan({ folder, where: worktree, version: '^0.2.0' }).error, /exact version/);

  const { install } = installs.plan({ folder, where: worktree, version: '0.2.0' });
  assert.equal(install.state, 'waiting');
  assert.equal(install.command, 'npm install --save-exact @kodalang/core@0.2.0');
  assert.equal(calls.length, 0, 'nothing runs before the person approves');

  const done = await installs.approve(install.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cwd, worktree);
  assert.deepEqual(calls[0].args, ['install', '--save-exact', '@kodalang/core@0.2.0']);
  assert.equal(done.state, 'done');
  assert.match(done.log, /\$ npm install --save-exact @kodalang\/core@0\.2\.0\nadded 1 package/);

  const inCheckout = installs.plan({ folder, version: '0.2.0' }).install;
  assert.equal(inCheckout.command, 'npm install --no-save @kodalang/core@0.2.0', 'the checkout’s package.json and lockfile stay as merged');
  installs.decline(inCheckout.id);
  assert.equal(installs.status(inCheckout.id), null);
  await assert.rejects(installs.approve(inCheckout.id), /no install waiting/);
});

test('the app card offers an upgrade, then the install once it’s merged', () => {
  const koda = version => JSON.stringify({ name: '@kodalang/core', version, main: './src/koda.js' });
  const project = (wanted, installed) => folderWith({
    'package.json': { dependencies: { '@kodalang/core': wanted } },
    'package-lock.json': '{}',
    'node_modules/@kodalang/core/package.json': koda(installed),
  });
  const cardOf = (path, entries = []) => {
    const installs = createInstalls({ branches: { of: () => entries }, spawn: fakeSpawn(0).spawn });
    return kodaModelOf({ koda: { version: '0.1.5' }, installs }, { id: 'f3', path }, entries);
  };

  const behind = cardOf(project('0.1.4', '0.1.4'));
  assert.deepEqual(behind.upgrade, { version: '0.1.5', command: 'npm install --save-exact @kodalang/core@0.1.5' });
  assert.equal(behind.install, null);

  const upgrading = cardOf(project('0.1.4', '0.1.4'), [{ id: 'w1', path: 'elsewhere', branch: 'prelude/fix-upgrade-koda-to-0-1-5', design: 'fixes/upgrade-koda-to-0-1-5' }]);
  assert.equal(upgrading.upgrade, null);
  assert.deepEqual(upgrading.upgrading, { branch: 'prelude/fix-upgrade-koda-to-0-1-5', url: '/f/w1/d/fixes/upgrade-koda-to-0-1-5' });

  const merged = cardOf(project('0.1.5', '0.1.4'));
  assert.equal(merged.upgrade, null);
  assert.deepEqual(merged.install, { version: '0.1.5', command: 'npm install --no-save @kodalang/core@0.1.5' });

  const current = cardOf(project('0.1.5', '0.1.5'));
  assert.equal(current.upgrade, null);
  assert.equal(current.install, null);

  assert.equal(newerVersion('0.1.5', '0.1.4'), true);
  assert.equal(newerVersion('0.2.0', '0.10.0'), false);
  assert.equal(newerVersion('1.0.0', '1.0.0-beta.1'), true);
});

test('a failed install says so, and one that takes too long is stopped', async () => {
  const checkout = folderWith({ 'package.json': '{}' });
  const folder = { id: 'f2', path: checkout };
  const branches = { of: () => [] };

  const failing = createInstalls({ branches, spawn: fakeSpawn(1).spawn });
  const failed = await failing.approve(failing.plan({ folder, version: '0.2.0' }).install.id);
  assert.equal(failed.state, 'failed');
  assert.match(failed.log, /the install failed, exit 1/);

  const hanging = createInstalls({ branches, spawn: fakeSpawn(null).spawn, timeoutMs: 20 });
  const stopped = await hanging.approve(hanging.plan({ folder, version: '0.2.0' }).install.id);
  assert.equal(stopped.state, 'failed');
  assert.match(stopped.log, /no end within/);
});
