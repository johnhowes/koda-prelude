// Running the app from a project's page (prelude/project-landing-page): the
// app a build made or connected, started from the project's own folder (its
// main branch) with a command and an address of its own, apart from the
// design host that renders designs (R-h2w).
//
// How it runs is the project's, in prelude/prelude.json, where the app build
// or connection writes it (R-p7c):
//
//   { "run": { "start": "npm start --prefix app", "url": "http://localhost:3100" } }
//
// Changed on the page, it's kept on this computer (runs.json in Prelude's
// home) and wins over the project's; the repository isn't touched. Started,
// the app opens in the browser once it answers at its address, and it's
// stopped, its whole tree, with Prelude (R-5tj).

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRELUDE_DIR } from './designs.js';
import { call } from './hosts.js';

const READY_TIMEOUT_MS = 180000;   // a first `dotnet run` builds before it listens
const LOG_LIMIT = 20000;
const LOG_SHOWN = 1500;            // the last of its output, when it fails
const LOCAL = ['localhost', '127.0.0.1', '[::1]'];

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** How the project says its app runs, from prelude/prelude.json: { command, url }, each null if unsaid. */
export function projectRunOf(folderPath) {
  let run;
  try { run = JSON.parse(readFileSync(join(folderPath, PRELUDE_DIR, 'prelude.json'), 'utf8'))?.run; } catch { run = null; }
  return { command: text(run?.start), url: text(run?.url) };
}

/** The port of a request's host:port, or null for one that isn't. */
const portOf = host => { try { return new URL(`http://${host}`).port || '80'; } catch { return null; } };

/** An address as it's kept: its origin, and its path if it has one. */
const addressOf = url => `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;

/**
 * What's wrong with how the app would run, by field: { command?, url? }, empty
 * when nothing is. The address is on this computer, and is neither the design
 * host's (`host`, its url) nor Prelude's own (`prelude`, its host:port).
 */
export function checkRun({ command, url }, { host = null, prelude = null } = {}) {
  const errors = {};
  if (!text(command)) errors.command = 'Say the command that starts the app.';
  if (!text(url)) {
    errors.url = 'Give the app an address of its own, such as http://localhost:3100.';
    return errors;
  }
  let address;
  try { address = new URL(text(url)); } catch { address = null; }
  if (!address || address.protocol !== 'http:') errors.url = 'Write the address as http://localhost and a port, such as http://localhost:3100.';
  else if (!LOCAL.includes(address.hostname)) errors.url = 'The app runs on this computer, so its address is localhost (or 127.0.0.1).';
  else if (host && address.origin === new URL(host).origin) errors.url = 'That’s the design host’s address: give the app one of its own.';
  else if (prelude && (address.port || '80') === portOf(prelude)) errors.url = 'That’s Prelude’s own port: give the app one of its own.';
  return errors;
}

/** Open an address in the person's browser. */
function openInBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* no browser to open: the card says where it runs */ }
}

/**
 * The apps run from here, one per project. `onChange` is called when one
 * starts answering, fails or stops on its own, for the page to follow it
 * (app-changed); `open` opens an address in the browser.
 */
export function createRuns({ home, onChange = () => {}, open = openInBrowser }) {
  const file = join(home, 'runs.json');
  const running = new Map();   // folder path -> { child, state: 'starting' | 'running' | 'failed', log, url }

  const readLocal = () => {
    try { return JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { return {}; }
  };

  // A shell started it, and `dotnet run`, `npm start` and their kind start
  // the app as a child of their own: take the whole tree down.
  const kill = entry => {
    if (!entry.child || entry.child.exitCode !== null || entry.child.signalCode !== null) return;
    if (process.platform === 'win32' && entry.child.pid) spawnSync('taskkill', ['/pid', String(entry.child.pid), '/t', '/f'], { windowsHide: true });
    else entry.child.kill();
  };

  const stop = folderPath => {
    const entry = running.get(folderPath);
    if (!entry) return;
    running.delete(folderPath);
    kill(entry);
  };

  return {
    /** How the project's app runs here: this computer's setting, or the project's. { command, url } */
    settingsOf(folder) {
      const local = readLocal()[folder.path];
      const project = projectRunOf(folder.path);
      return local ? { command: text(local.command), url: text(local.url) } : project;
    },

    /** Keep how it runs on this computer only (R-p7c). The address as checkRun passed it. */
    save(folder, { command, url }) {
      const all = readLocal();
      all[folder.path] = { command: text(command), url: addressOf(new URL(text(url))) };
      mkdirSync(home, { recursive: true });
      writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
    },

    /** The page's app.run: { command, url, state, log }, `log` only when it failed. */
    of(folder) {
      const { command, url } = this.settingsOf(folder);
      const entry = running.get(folder.path);
      const state = entry?.state ?? 'stopped';
      return { command, url, state, log: state === 'failed' ? entry.log.trim().slice(-LOG_SHOWN) : null };
    },

    /**
     * Start the project's app from its own folder, stopping a copy already
     * running, and another project's on the same address. Never as the design
     * host: no PRELUDE_HOST, and PORT is its own address's. `checks` are
     * checkRun's, for settings that came from the project.
     */
    start(folder, checks = {}) {
      stop(folder.path);
      const { command, url } = this.settingsOf(folder);
      const entry = { child: null, state: 'starting', log: command ? `$ ${command}\n` : '', url };
      const append = chunk => { entry.log = (entry.log + chunk).slice(-LOG_LIMIT); };
      running.set(folder.path, entry);
      const problem = Object.values(checkRun({ command, url }, checks))[0];
      if (problem) {
        entry.state = 'failed';
        append(`${problem}\n`);
        return entry;
      }
      for (const [path, other] of running) if (path !== folder.path && other.url === url) stop(path);
      const { PRELUDE_HOST: _host, ...env } = process.env;
      const port = new URL(url).port || '80';
      entry.child = spawn(command, { cwd: folder.path, shell: true, windowsHide: true, env: { ...env, PORT: port } });
      entry.child.stdout.on('data', append);
      entry.child.stderr.on('data', append);
      const ended = message => {
        if (running.get(folder.path) !== entry) return;
        append(message);
        // Stopped on its own once it answered, it's simply stopped; before, it failed.
        if (entry.state === 'running') running.delete(folder.path);
        else entry.state = 'failed';
        onChange(folder);
      };
      entry.child.on('error', error => ended(`\n${error.message}\n`));
      entry.child.on('exit', code => ended(`\n(the app stopped${code === null ? '' : `, exit ${code}`})\n`));

      // Running once anything answers at its address: then it opens.
      (async () => {
        const until = Date.now() + READY_TIMEOUT_MS;
        while (running.get(folder.path) === entry && entry.state === 'starting') {
          if (Date.now() > until) {
            append(`\n(nothing answered at ${url} within ${READY_TIMEOUT_MS / 1000}s)\n`);
            entry.state = 'failed';
            kill(entry);
            onChange(folder);
            return;
          }
          try {
            await call(url, { timeout: 2000 });
            if (running.get(folder.path) !== entry || entry.state !== 'starting') return;
            entry.state = 'running';
            open(url);
            onChange(folder);
            return;
          } catch { /* not listening yet */ }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      })();
      return entry;
    },

    stop(folder) {
      stop(folder.path);
    },

    closeAll() {
      for (const folderPath of [...running.keys()]) stop(folderPath);
    },
  };
}
