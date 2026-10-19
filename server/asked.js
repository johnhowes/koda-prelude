// Asked lately (prelude/fix-something): the conversations about a project
// that have no branch yet - questions, and problems not yet fixed. One is a
// fix without its branch (kind "fix", id "fixes/<slug>"), so its sessions are
// a design's, but it's kept on this computer, like drafts, never in the
// project's repository (R-2qz):
//
//   <home>/asked/<folder>/<slug>/
//     fix.json       { title, createdAt }
//     sessions/      as a design's (sessions.js)
//
// Fixed on a branch, it moves into prelude/fixes/<slug>/ on the branch, its
// sessions with it, and leaves Asked lately for In progress (R-x8d).

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRELUDE_DIR } from './designs.js';
import { FIXES_DIR, FIX_FILE, fixSlug } from './fixes.js';
import { listSessions } from './sessions.js';

const isSlug = slug => /^[a-z0-9][a-z0-9-]*$/.test(String(slug)) && slug !== 'new';

export function createAsked({ home }) {
  const rootOf = folder => join(home, 'asked', folder.id);
  const dirOf = (folder, slug) => join(rootOf(folder), slug);
  const readMeta = dir => { try { return JSON.parse(readFileSync(join(dir, FIX_FILE), 'utf8')) ?? {}; } catch { return null; } };
  const recordOf = (folder, slug, meta) => ({
    id: `${FIXES_DIR}/${slug}`,
    slug,
    area: '',
    title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : slug,
    kind: 'fix',
    createdAt: meta.createdAt ?? null,
    dir: dirOf(folder, slug),
  });

  const find = (folder, slug) => {
    if (!isSlug(slug)) return null;
    const meta = readMeta(dirOf(folder, slug));
    return meta ? recordOf(folder, slug, meta) : null;
  };

  return {
    dirOf,
    find,

    /** A project's conversations with no branch, newest first: by their last session, else when they started. */
    list(folder) {
      let names;
      try { names = readdirSync(rootOf(folder)); } catch { return []; }
      const touched = record => listSessions(record.dir)[0]?.updatedAt ?? record.createdAt ?? '';
      return names
        .map(name => find(folder, name))
        .filter(Boolean)
        .map(record => ({ ...record, updatedAt: touched(record) }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },

    /**
     * A new conversation, named from its first words (R-m5c): a slug unique
     * among `taken` (the fixes on main and on every branch) and those kept here.
     * { fix, dir }, or { errors: { message } }.
     */
    create(folder, { title, taken = new Set() }) {
      const name = String(title ?? '').trim();
      const here = new Set([...taken, 'new', ...this.list(folder).map(record => record.slug)]);
      const slug = fixSlug(name, here);
      if (!slug) return { errors: { message: 'Say what you want to ask, in a few words.' } };
      const dir = dirOf(folder, slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, FIX_FILE), JSON.stringify({ title: name, createdAt: new Date().toISOString() }, null, 2) + '\n');
      return { fix: find(folder, slug), dir };
    },

    /** Rename a conversation; its slug, and so its address, stays. */
    rename(folder, slug, title) {
      const record = find(folder, slug);
      if (!record) return null;
      const meta = { ...readMeta(record.dir), title: String(title).trim() };
      writeFileSync(join(record.dir, FIX_FILE), JSON.stringify(meta, null, 2) + '\n');
      return find(folder, slug);
    },

    /**
     * Fix a conversation on its branch (R-x8d): its fix.json and sessions move
     * into prelude/fixes/<slug>/ in the branch's worktree, with the title it's
     * given, and it's no longer kept here. The caller commits the branch.
     * { fix, dir } (dir: on the branch), or null if there's no such conversation.
     */
    moveOnto(folder, slug, worktreePath, { title = null } = {}) {
      const record = find(folder, slug);
      if (!record) return null;
      const target = join(worktreePath, PRELUDE_DIR, FIXES_DIR, slug);
      mkdirSync(target, { recursive: true });
      if (existsSync(join(record.dir, 'sessions'))) cpSync(join(record.dir, 'sessions'), join(target, 'sessions'), { recursive: true });
      const meta = { title: String(title ?? '').trim() || record.title, createdAt: record.createdAt };
      writeFileSync(join(target, FIX_FILE), JSON.stringify(meta, null, 2) + '\n');
      if (!existsSync(join(target, 'NOTES.md'))) {
        writeFileSync(join(target, 'NOTES.md'), `# Fix: ${meta.title}\n\nWhat's wrong, the cause, what changed, and what to check - written as the fix goes.\n`);
      }
      rmSync(record.dir, { recursive: true, force: true });
      return { fix: { ...record, title: meta.title, dir: target }, dir: target };
    },
  };
}
