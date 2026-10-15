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
import { join } from 'node:path';

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
 */
export function appOf(folderPath) {
  const config = read(folderPath);
  const app = config.app && typeof config.app === 'object' ? config.app : {};
  const stack = typeof app.stack === 'string' && app.stack.trim() ? app.stack.trim() : null;
  const hasHost = Boolean(config.host && typeof config.host.start === 'string');
  const path = typeof app.path === 'string' && app.path.trim() ? app.path.trim() : null;
  return {
    stack: stack ?? (hasHost ? 'the app’s own (it has a design host)' : null),
    custom: Boolean(stack && stack !== DEFAULT_STACK),
    built: Boolean(path) || (hasHost && !stack),
    path,
  };
}

/** Record the folder's stack in prelude/prelude.json, keeping everything else there. */
export function chooseStack(folderPath, stack) {
  const config = read(folderPath);
  config.app = { ...(config.app && typeof config.app === 'object' ? config.app : {}), stack: String(stack).trim() || DEFAULT_STACK };
  mkdirSync(join(folderPath, PRELUDE_DIR), { recursive: true });
  writeFileSync(join(folderPath, PRELUDE_DIR, 'prelude.json'), JSON.stringify(config, null, 2) + '\n');
  return appOf(folderPath);
}
