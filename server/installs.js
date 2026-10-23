// Installing the app's Koda (D-k7v): the one place Prelude runs a package
// manager. Twice in an upgrade: in the upgrade fix's worktree, installing the
// version Prelude knows, and in the person's own folder once that fix is
// merged, installing the version the app's package.json now asks for.
//
// Every command is built here, never taken from the agent or a form: the
// project's package manager (by its lockfile), and `@kodalang/core` at a
// version, and nothing else. Each runs only once the person has seen it and
// said yes (the server's POSTs), with a time limit, its output kept. In the
// person's own folder it changes only node_modules: package.json and the
// lockfile already say what the merged upgrade asks for (R-q7w, R-n6t).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TIME_LIMIT_MS = 300000;
const LOG_LIMIT = 20000;
const LOG_SHOWN = 1500;   // the last of its output, when it fails
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PACKAGE = '@kodalang/core';

/** The package manager an app folder uses, by its lockfile there or at the repository's root: npm, pnpm or yarn. */
export function packageManagerOf(dir, root = dir) {
  for (const where of [dir, root]) {
    if (existsSync(join(where, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(where, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(where, 'package-lock.json'))) return 'npm';
  }
  return 'npm';
}

/**
 * The command that installs Koda at `version` in an app folder, or null for a
 * version that isn't one. In a fix (`checkout` false) it changes package.json
 * and the lockfile, which the fix commits; in the person's own folder only
 * node_modules: npm doesn't save, and pnpm and yarn install what the merged
 * lockfile already says.
 */
export function installCommand(dir, version, { root = dir, checkout = false } = {}) {
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  const manager = packageManagerOf(dir, root);
  if (manager === 'pnpm') return checkout ? 'pnpm install --frozen-lockfile' : `pnpm add ${PACKAGE}@${version}`;
  if (manager === 'yarn') return checkout ? 'yarn install --frozen-lockfile' : `yarn add ${PACKAGE}@${version}`;
  return checkout ? `npm install --no-save ${PACKAGE}@${version}` : `npm install ${PACKAGE}@${version}`;
}

/**
 * The installs under way or failed, one per app folder. `onChange(dir)` is
 * called when one ends, for the page to follow it (app-changed).
 */
export function createInstalls({ onChange = () => {} } = {}) {
  const installs = new Map();   // app folder -> { child, state: 'installing' | 'failed', command, log }

  const kill = entry => {
    if (!entry.child || entry.child.exitCode !== null || entry.child.signalCode !== null) return;
    if (process.platform === 'win32' && entry.child.pid) spawnSync('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], { windowsHide: true });
    else entry.child.kill();
  };

  return {
    command: installCommand,

    /** An app folder's install: { state, command, log }, `log` only once it failed; null when none is under way or failed. */
    of(dir) {
      const entry = dir ? installs.get(dir) : null;
      if (!entry) return null;
      return { state: entry.state, command: entry.command, log: entry.state === 'failed' ? entry.log.trim().slice(-LOG_SHOWN) : null };
    },

    /**
     * Install Koda at `version` in `dir`, as installCommand says, once the
     * person has approved that command. Resolves to { ok, log } when it ends;
     * one already installing there is answered with its own end. A failed one
     * stays, with its output, until it's run again or `clear`ed.
     */
    run(dir, version, { root = dir, checkout = false } = {}) {
      const current = installs.get(dir);
      if (current?.state === 'installing') return current.done;
      const command = installCommand(dir, version, { root, checkout });
      const entry = { child: null, state: 'installing', command, log: command ? `$ ${command}\n` : '', done: null };
      const append = chunk => { entry.log = (entry.log + chunk).slice(-LOG_LIMIT); };
      installs.set(dir, entry);
      entry.done = new Promise(resolve => {
        const ended = (ok, message = '') => {
          if (entry.state !== 'installing') return;
          clearTimeout(timer);
          append(message);
          if (ok) installs.delete(dir);
          else entry.state = 'failed';
          onChange(dir);
          resolve({ ok, log: entry.log });
        };
        const timer = setTimeout(() => { kill(entry); ended(false, `\n(the install took longer than ${TIME_LIMIT_MS / 60000} minutes, and was stopped)\n`); }, TIME_LIMIT_MS);
        if (!command) return ended(false, `${version} isn’t a version Prelude can install.\n`);
        const { PRELUDE_HOST: _host, ...env } = process.env;
        try {
          entry.child = spawn(command, { cwd: dir, shell: true, windowsHide: true, env });
        } catch (error) {
          return ended(false, `${error.message}\n`);
        }
        entry.child.stdout.on('data', append);
        entry.child.stderr.on('data', append);
        entry.child.on('error', error => ended(false, `\n${error.message}\n`));
        entry.child.on('exit', code => ended(code === 0, code === 0 ? '' : `\n(the install stopped${code === null ? '' : `, exit ${code}`})\n`));
      });
      return entry.done;
    },

    /** Forget a failed install, so its folder reads afresh. */
    clear(dir) {
      if (installs.get(dir)?.state !== 'installing') installs.delete(dir);
    },

    closeAll() {
      for (const entry of installs.values()) kill(entry);
      installs.clear();
    },
  };
}
