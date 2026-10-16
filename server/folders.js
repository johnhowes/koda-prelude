// The folders Prelude has opened, remembered on this machine only.
//
// People see each as a project (plan: "Project, folder, app"); the code, the
// URLs and folders.json keep calling it a folder.
//
// A folder is named in URLs by a short id derived from its path, so a path
// never appears in a URL. The list lives in <home>/folders.json - a machine-local
// convenience, never anything a design depends on (plan: ground rule 1).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const KEEP = 20;

export function canonical(path) {
  try { return realpathSync.native(resolve(path)); } catch { return resolve(path); }
}

export function folderId(path) {
  const normal = canonical(path);
  const key = process.platform === 'win32' ? normal.toLowerCase() : normal;
  return createHash('sha256').update(key).digest('hex').slice(0, 10);
}

/** A path as a person typed or pasted it: Explorer's "Copy as path" adds quotes. */
export function cleanPath(input) {
  return String(input ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
}

/** Why this path can't be opened, or null if it can. */
export function refuseFolder(path) {
  if (path === '') return 'Enter the path of a folder.';
  let stat;
  try { stat = statSync(path); } catch { return 'There is no folder at that path.'; }
  if (!stat.isDirectory()) return 'That path is a file, not a folder.';
  return null;
}

export function createFolders(home) {
  const file = join(home, 'folders.json');

  const read = () => {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
  };
  const write = list => {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
  };

  return {
    recent: read,

    get(id) {
      return read().find(folder => folder.id === id) ?? null;
    },

    /**
     * Put the folder at the top of the recent list and return it. The path is
     * stored in its canonical form: on Windows a short name (JOHNHO~1) would
     * otherwise stop the agent's path-scoped permissions from matching the
     * long paths its tools use.
     */
    open(path) {
      const full = canonical(path);
      const folder = { id: folderId(full), path: full, name: basename(full) || full, openedAt: new Date().toISOString() };
      write([folder, ...read().filter(other => other.id !== folder.id)].slice(0, KEEP));
      return folder;
    },

    forget(id) {
      write(read().filter(folder => folder.id !== id));
    },
  };
}

/**
 * Reference folders: other folders on this machine the agent may read while
 * working in a folder - another repository whose CSS a design system starts
 * from, say. Paths on this machine, so they live in <home>/references.json,
 * keyed by folder id, and never in the folder itself.
 */
export function createReferences(home) {
  const file = join(home, 'references.json');

  const read = () => {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const write = all => {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  };

  return {
    /** The folder's reference folders: [{ path, name }], in the order added. */
    of(folderId) {
      return (read()[folderId] ?? []).map(path => ({ path, name: basename(path) || path }));
    },

    /** Add one. Returns an error message instead when it can't be added. */
    add(folder, input) {
      const value = cleanPath(input);
      const refused = refuseFolder(value);
      if (refused) return { error: refused };
      const path = canonical(value);
      const key = p => (process.platform === 'win32' ? p.toLowerCase() : p);
      if (key(path) === key(folder.path)) return { error: 'That’s the project’s own folder. The agent can always read it.' };
      const all = read();
      const list = all[folder.id] ?? [];
      if (list.some(p => key(p) === key(path))) return { error: 'The agent can already read that folder.' };
      all[folder.id] = [...list, path];
      write(all);
      return { path };
    },

    remove(folderId, path) {
      const all = read();
      all[folderId] = (all[folderId] ?? []).filter(p => p !== path);
      if (all[folderId].length === 0) delete all[folderId];
      write(all);
    },
  };
}
