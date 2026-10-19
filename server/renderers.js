// Sandboxed renderer processes, one per folder (renderer.js says why).
//
//   const renderers = createRenderers({ appRoot });
//   const html = await renderers.render(folderPath, { page, layout });
//
// Each folder's renderer may read only that folder and Prelude's own files
// (`appRoot`: Eta, the built-in layout). A render that takes too long kills its
// process, so a template that loops for ever can't hang Prelude; the next
// render starts a fresh one.

import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER = fileURLToPath(new URL('./renderer.js', import.meta.url));
const TIMEOUT_MS = 5000;

// Node 23.5+ calls it --permission; earlier versions, --experimental-permission.
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';

// Each path once: Node (23.1, at least) aborts at startup when --allow-fs-read
// names the same path twice, as it does when the folder is Prelude itself.
export function readPaths(...paths) {
  const key = path => {
    const resolved = resolve(path);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const seen = new Map();
  for (const path of paths) if (!seen.has(key(path))) seen.set(key(path), resolve(path));
  return [...seen.values()];
}

export function createRenderers({ appRoot }) {
  const processes = new Map();   // folder path -> { child, pending }

  const start = folderPath => {
    const child = fork(RENDERER, [], {
      execArgv: [PERMISSION_FLAG, ...readPaths(folderPath, appRoot).map(path => `--allow-fs-read=${path}`), '--disable-warning=ExperimentalWarning'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });
    const entry = { child, pending: new Map(), stderr: '' };
    child.stderr.on('data', chunk => { entry.stderr = (entry.stderr + chunk).slice(-2000); });
    child.on('message', ({ id, html, error }) => {
      const waiting = entry.pending.get(id);
      if (!waiting) return;
      entry.pending.delete(id);
      clearTimeout(waiting.timer);
      if (error !== undefined) waiting.reject(new Error(error));
      else waiting.resolve(html);
    });
    child.on('error', () => {});   // a failed send is reported through its callback
    child.on('exit', () => {
      if (processes.get(folderPath) === entry) processes.delete(folderPath);
      for (const waiting of entry.pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(`The renderer stopped. ${entry.stderr.trim().split('\n').slice(-2).join(' ')}`.trim()));
      }
      entry.pending.clear();
    });
    processes.set(folderPath, entry);
    return entry;
  };

  let next = 0;

  return {
    render(folderPath, job) {
      const entry = processes.get(folderPath) ?? start(folderPath);
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          entry.pending.delete(id);
          reject(new Error(`Rendering took longer than ${TIMEOUT_MS / 1000}s and was stopped.`));
          // Out of the pool first, so the next render starts a fresh process
          // rather than writing to this one as it dies.
          if (processes.get(folderPath) === entry) processes.delete(folderPath);
          entry.child.kill();
        }, TIMEOUT_MS);
        entry.pending.set(id, { resolve, reject, timer });
        entry.child.send({ id, ...job }, error => {
          if (!error || !entry.pending.has(id)) return;
          entry.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`The renderer couldn't be reached: ${error.message}`));
        });
      });
    },

    closeAll() {
      for (const { child } of processes.values()) child.kill();
      processes.clear();
    },
  };
}
