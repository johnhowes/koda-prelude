// Installing the app's Koda (D-k7v).
//
// The one place Prelude runs a package manager: in a fix's worktree, to
// upgrade the app's Koda to Prelude's version, and in the person's own
// checkout once that upgrade is merged, since node_modules isn't in git and
// the checkout keeps the old Koda otherwise.
//
// The fence lives here, and nowhere else:
//   - the command is built here, never from anything the agent wrote: the
//     project's package manager (by its lockfile), install, @kodalang/core at
//     an exact version, and no other package
//   - only in the project's own folder or a worktree branches made for it
//   - only once the person has seen the command and approved it: install
//     scripts are code from outside the project, as a host is
//   - a time limit, and the output kept for the chat
//
// In a worktree the install saves the exact version to package.json and the
// lockfile, which the fix commits. In the checkout npm installs without
// saving, so only node_modules changes; pnpm and yarn have no such flag, and
// write back the version the merge already put there.

import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { appOf } from './app-config.js';

export const PACKAGE = '@kodalang/core';
const TIMEOUT_MS = 5 * 60 * 1000;
const LOG_LIMIT = 20000;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const same = (a, b) => {
  const norm = path => resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/** The app's folder in a checkout or worktree: prelude.json's app path, else its root. Null if it has no package.json. */
export function appDirOf(root) {
  const path = appOf(root).path;
  const dir = path ? resolve(root, path) : resolve(root);
  if (dir !== resolve(root) && !dir.startsWith(resolve(root) + sep)) return null;
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

/** The package manager the app uses, by its lockfile (in the app's folder, then the root): npm, pnpm or yarn. */
export function packageManagerOf(appDir, root = appDir) {
  for (const dir of [appDir, root]) {
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(dir, 'package-lock.json'))) return 'npm';
  }
  return 'npm';
}

/**
 * The install's command: { command, args, text }. `save` (a worktree) writes the
 * exact version to package.json and the lockfile; without it (the checkout),
 * npm leaves them alone. Throws for anything but an exact version.
 */
export function installCommand(manager, version, { save = true } = {}) {
  if (!EXACT.test(String(version))) throw new Error(`“${version}” isn’t an exact version of Koda.`);
  const spec = `${PACKAGE}@${version}`;
  const args = {
    npm: ['install', save ? '--save-exact' : '--no-save', spec],
    pnpm: ['add', '--save-exact', spec],
    yarn: ['add', '--exact', spec],
  }[manager];
  if (!args) throw new Error(`Prelude doesn’t install with ${manager}.`);
  return { command: manager, args, text: [manager, ...args].join(' ') };
}

/**
 * Installs, each waiting for the person's approval before it runs.
 *   branches - which worktrees Prelude made for a folder (branches.of)
 *   spawn    - for tests; node's own otherwise
 */
export function createInstalls({ branches, spawn = nodeSpawn, timeoutMs = TIMEOUT_MS }) {
  const installs = new Map();   // id -> { id, folderId, where, appDir, version, command, state, log, child, done }

  const stop = entry => {
    if (!entry.child?.pid) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], { windowsHide: true });
    else entry.child.kill();
  };

  const view = entry => entry && {
    id: entry.id, where: entry.where, version: entry.version, command: entry.command.text,
    state: entry.state, log: entry.log,
  };

  return {
    /**
     * An install of Koda `version` in `where` (the folder's own path or one of its
     * worktrees), waiting for approval: { install } with the command to show, or { error }.
     */
    plan({ folder, where = folder.path, version }) {
      const inCheckout = same(where, folder.path);
      if (!inCheckout && !branches.of(folder.id).some(entry => same(entry.path, where))) {
        return { error: 'Prelude installs only in the project’s own folder or a branch it made for it.' };
      }
      const appDir = appDirOf(where);
      if (!appDir) return { error: 'The app has no package.json to install Koda into.' };
      let command;
      try { command = installCommand(packageManagerOf(appDir, where), version, { save: !inCheckout }); } catch (error) { return { error: error.message }; }
      const entry = { id: randomBytes(6).toString('hex'), folderId: folder.id, where, appDir, version, command, state: 'waiting', log: '', child: null, done: null };
      installs.set(entry.id, entry);
      return { install: view(entry) };
    },

    /** The person approved an install's command: run it. Resolves with the install once it's finished. */
    approve(id) {
      const entry = installs.get(id);
      if (!entry) return Promise.reject(new Error('There’s no install waiting for that.'));
      if (entry.state !== 'waiting') return entry.done ?? Promise.resolve(view(entry));
      const append = chunk => { entry.log = (entry.log + chunk).slice(-LOG_LIMIT); };
      append(`$ ${entry.command.text}\n`);
      entry.state = 'running';
      entry.done = new Promise(resolveDone => {
        let timer = null;
        const finish = (state, note) => {
          if (entry.state !== 'running') return;
          clearTimeout(timer);
          if (note) append(`\n${note}\n`);
          entry.state = state;
          entry.child = null;
          resolveDone(view(entry));
        };
        // npm, pnpm and yarn are .cmd files on Windows, which only a shell runs.
        // Every argument is one this file built, so the shell sees nothing else.
        try {
          entry.child = spawn(entry.command.command, entry.command.args, { cwd: entry.appDir, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
          return finish('failed', `(it didn’t start: ${error.message})`);
        }
        timer = setTimeout(() => { stop(entry); finish('failed', `(stopped: no end within ${timeoutMs / 1000}s)`); }, timeoutMs);
        entry.child.stdout?.on('data', append);
        entry.child.stderr?.on('data', append);
        entry.child.on('error', error => finish('failed', `(it didn’t start: ${error.message})`));
        entry.child.on('exit', code => finish(code === 0 ? 'done' : 'failed', code === 0 ? null : `(the install failed${code === null ? '' : `, exit ${code}`})`));
      });
      return entry.done;
    },

    /** The person turned an install down. */
    decline(id) {
      const entry = installs.get(id);
      if (entry?.state === 'waiting') installs.delete(id);
    },

    /** An install, as the chat shows it: { id, where, version, command, state, log }, or null. */
    status(id) {
      return view(installs.get(id)) ?? null;
    },

    /** A folder's installs, newest last. */
    of(folderId) {
      return [...installs.values()].filter(entry => entry.folderId === folderId).map(view);
    },

    closeAll() {
      for (const entry of installs.values()) if (entry.state === 'running') stop(entry);
    },
  };
}
