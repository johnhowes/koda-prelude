// A project's design system, to read (prelude/design-system-page): its
// gallery, the screens its design session shows, in a page of the app, as
// the architecture has its own (architecture.js). The gallery stays on the
// preview origin, in a frame, as every screen is: it's the agent's HTML. It's
// framed from /f/<folder>/r/, the preview's files to read, so following a
// link in it doesn't move a session's screen as /p/ would.

import { join } from 'node:path';

import { PRELUDE_DIR, findSystem, listDesigns } from './designs.js';
import { listScreens } from './preview.js';

/**
 * @typedef {object} SystemScreen  A screen of the gallery, as the page picks it.
 * @property {string} id
 * @property {string} title
 * @property {string} url           this page, showing it
 * @property {boolean} current
 *
 * @typedef {object} SystemPage    The Design System page's model.
 * @property {{ id: string, name: string }} project
 * @property {{ title: string, url: string } | null} design   null before there's one
 * @property {SystemScreen[]} screens
 * @property {{ title: string, src: string } | null} frame     the screen on show; null with none
 */

/**
 * Where a folder's design system is: in this folder or, for a project whose
 * system is still on its own branch, in that branch's worktree.
 * { design, at } - `at` the folder or branch entry it's in - or null.
 */
export function findSystemOf(app, folder) {
  const here = findSystem(folder.path);
  if (here) return { design: here, at: folder };
  if (folder.branch) return null;
  for (const entry of app.branches.of(folder.id)) {
    const design = listDesigns(entry.path).find(candidate => candidate.id === entry.design && candidate.kind === 'system');
    if (design) return { design, at: entry };
  }
  return null;
}

/**
 * The Design System page's model, for a folder: its gallery's screens, the
 * one ?screen= picks (the first otherwise) framed from `origin`, the preview
 * origin.
 * @returns {SystemPage}
 */
export function systemOf(app, folder, { query = {}, origin }) {
  const project = { id: folder.id, name: folder.branch?.parentName ?? folder.name };
  const found = findSystemOf(app, folder);
  if (!found) return { project, design: null, screens: [], frame: null };
  const { design, at } = found;
  const all = listScreens(join(at.path, PRELUDE_DIR, ...design.id.split('/')));
  const shown = all.find(screen => screen.id === query.screen) ?? all[0];
  return {
    project,
    design: { title: design.title, url: `/f/${folder.id}/d/${design.id}` },
    screens: all.map(screen => ({ id: screen.id, title: screen.title, url: `/f/${folder.id}/system?screen=${encodeURIComponent(screen.id)}`, current: screen === shown })),
    // Read (/r/), not shown (/p/): following its links moves no session's screen.
    frame: shown ? { title: shown.title, src: `${origin}/f/${at.id}/r/${design.id}/screens/${encodeURIComponent(shown.file)}` } : null,
  };
}
