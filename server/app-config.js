// The folder's app (plan: step 8), as prelude/prelude.json records it:
//
//   { "app": { "stack": "Node, Express, Eta and Koda", "path": "app" },
//     "host": { ... } }
//
// "stack" is chosen once, the first time a design is created (or a build
// started) in a folder with no app: the default, or a stack the person
// describes. "path" is set by the app build, once the app exists; with it,
// and its design host (hosts.js), feature builds can start. A folder that
// already had a design host before step 8 (the Razor demo) has an app.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { PRELUDE_DIR } from './designs.js';

export const DEFAULT_STACK = 'Node, Express, Eta and Koda';

function read(folderPath) {
  try { return JSON.parse(readFileSync(join(folderPath, PRELUDE_DIR, 'prelude.json'), 'utf8')) ?? {}; } catch { return {}; }
}

/**
 * Where the folder's app stands: { stack, custom, built, path }.
 *   stack  - the chosen stack, or null before anyone chose
 *   custom - a stack other than the default: its app (and design host) must be
 *            built before designing, since views are written in its language
 *   built  - the app exists: the app build recorded its path, or the folder
 *            had a design host of its own
 *   existing - the person said the project already has an app (plan, 8b):
 *            it's connected, not built, and its stack is described from the code
 */
export function appOf(folderPath) {
  const config = read(folderPath);
  const app = config.app && typeof config.app === 'object' ? config.app : {};
  const stack = typeof app.stack === 'string' && app.stack.trim() ? app.stack.trim() : null;
  const hasHost = Boolean(config.host && typeof config.host.start === 'string');
  const path = typeof app.path === 'string' && app.path.trim() ? app.path.trim() : null;
  const existing = app.existing === true;
  return {
    stack: stack ?? (hasHost ? 'the app’s own (it has a design host)' : null),
    custom: Boolean(stack && stack !== DEFAULT_STACK),
    built: Boolean(path) || (hasHost && !stack && !existing),
    path,
    existing,
  };
}

/**
 * The app's own files, by the URL the app serves them at, for an app connected
 * without a design host (plan, 8b): prelude.json's "app.assets", such as
 * { "/static/": "server/public/" }. Each folder is inside the repository, never
 * the repository itself or its .git. [{ prefix, root }], the longest prefix first.
 */
export function appAssets(folderPath) {
  const assets = read(folderPath).app?.assets;
  if (!assets || typeof assets !== 'object') return [];
  const repo = resolve(folderPath);
  return Object.entries(assets)
    .filter(([prefix, dir]) => /^\/[^\s]*\/$/.test(prefix) && !prefix.startsWith('/_prelude/') && typeof dir === 'string' && dir.trim())
    .map(([prefix, dir]) => ({ prefix, root: resolve(repo, dir) }))
    .filter(({ root }) => root.startsWith(repo + sep) && !root.slice(repo.length + 1).split(sep).some(part => part.startsWith('.')))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

export const KODA = '@kodalang/core';

const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** The app's folder in a checkout or worktree: prelude.json's app path, else its root. Null if it has no package.json. */
export function appDirOf(root) {
  const path = appOf(root).path;
  const top = resolve(root);
  const dir = path ? resolve(top, path) : top;
  if (dir !== top && !dir.startsWith(top + sep)) return null;
  return readJson(join(dir, 'package.json')) ? dir : null;
}

/**
 * The app's Koda (D-k7v) in a checkout or worktree: what's installed in the
 * app's node_modules (or the root's), and what its package.json asks for.
 * { installed: { path, entry, version } | null, wanted: string | null }, or
 * null when the app doesn't use Koda.
 */
export function kodaOf(root) {
  const appDir = appDirOf(root);
  if (!appDir) return null;
  const manifest = readJson(join(appDir, 'package.json'));
  const wanted = manifest?.dependencies?.[KODA] ?? manifest?.devDependencies?.[KODA] ?? null;
  let installed = null;
  for (const dir of [appDir, resolve(root)]) {
    const path = join(dir, 'node_modules', ...KODA.split('/'));
    const own = readJson(join(path, 'package.json'));
    if (own?.version) {
      const entry = typeof own.exports?.['.'] === 'string' ? own.exports['.'] : typeof own.main === 'string' ? own.main : 'src/koda.js';
      installed = { path, entry, version: own.version };
      break;
    }
  }
  return wanted || installed ? { installed, wanted: typeof wanted === 'string' ? wanted : null } : null;
}

/** The first of `roots` (a worktree, then its project's checkout) with the app's Koda installed: { path, entry, version }, or null. */
export function findKoda(roots) {
  for (const root of roots) {
    const found = kodaOf(root)?.installed;
    if (found) return found;
  }
  return null;
}

/** Record that the project already has an app, to be connected rather than built (plan, 8b). */
export function markExisting(folderPath) {
  const config = read(folderPath);
  const app = config.app && typeof config.app === 'object' ? config.app : {};
  // A stack chosen before is a guess about an app that wasn't there: the connection describes the real one.
  const { stack, ...rest } = app;
  config.app = { ...rest, existing: true };
  mkdirSync(join(folderPath, PRELUDE_DIR), { recursive: true });
  writeFileSync(join(folderPath, PRELUDE_DIR, 'prelude.json'), JSON.stringify(config, null, 2) + '\n');
  return appOf(folderPath);
}

/** Record the folder's stack in prelude/prelude.json, keeping everything else there. */
export function chooseStack(folderPath, stack) {
  const config = read(folderPath);
  config.app = { ...(config.app && typeof config.app === 'object' ? config.app : {}), stack: String(stack).trim() || DEFAULT_STACK };
  mkdirSync(join(folderPath, PRELUDE_DIR), { recursive: true });
  writeFileSync(join(folderPath, PRELUDE_DIR, 'prelude.json'), JSON.stringify(config, null, 2) + '\n');
  return appOf(folderPath);
}
