// Asked lately (prelude/fix-something): the conversations about a project
// that have no branch yet - questions, and problems not yet fixed. One is a
// fix without its branch (kind "fix", id "fixes/<slug>"), so its sessions are
// a design's, but it's kept on this computer, like drafts, never in the
// project's repository (R-2qz):
//
//   <home>/asked/<folder>/<slug>/
//     fix.json       { title, createdAt, named }   named: renamed by the person (R-m5c)
//     sessions/      as a design's (sessions.js)
//
// Fixed on a branch, it moves into prelude/fixes/<slug>/ on the branch, its
// sessions with it, and leaves Asked lately for In progress (R-x8d).

import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRELUDE_DIR } from './designs.js';
import { FIXES_DIR, FIX_FILE, fixSlug } from './fixes.js';
import { listSessions, sessionsDir, updateSession } from './sessions.js';

/** The slug of the page that starts a conversation: never one's own. */
export const NEW_SLUG = 'new';

const isSlug = slug => /^[a-z0-9][a-z0-9-]*$/.test(String(slug)) && slug !== NEW_SLUG;

export function createAsked({ home }) {
  const rootOf = folder => join(home, 'asked', folder.id);
  const dirOf = (folder, slug) => join(rootOf(folder), slug);
  const readMeta = dir => { try { return JSON.parse(readFileSync(join(dir, FIX_FILE), 'utf8')) ?? {}; } catch { return null; } };
  const writeMeta = (dir, meta) => writeFileSync(join(dir, FIX_FILE), JSON.stringify(meta, null, 2) + '\n');
  // Design-shaped, as fixes.js has a fix; `kept` says it's on this computer,
  // and `dir` is where.
  const recordOf = (folder, slug, meta) => ({
    id: `${FIXES_DIR}/${slug}`,
    slug,
    area: '',
    title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : slug,
    kind: 'fix',
    createdAt: meta.createdAt ?? null,
    kept: true,
    dir: dirOf(folder, slug),
  });

  const find = (folder, slug) => {
    if (!isSlug(slug)) return null;
    const meta = readMeta(dirOf(folder, slug));
    return meta ? recordOf(folder, slug, meta) : null;
  };

  const list = folder => {
    let names;
    try { names = readdirSync(rootOf(folder)); } catch { return []; }
    const touched = record => listSessions(record.dir)[0]?.updatedAt ?? record.createdAt ?? '';
    return names
      .map(name => find(folder, name))
      .filter(Boolean)
      .map(record => ({ ...record, updatedAt: touched(record) }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  };

  return {
    dirOf,
    find,

    /** A project's conversations with no branch, newest first: by their last session, else when they started. */
    list,

    /** The page that starts one, as a conversation with no sessions: /f/<project>/d/fixes/new. */
    fresh(folder) {
      return { ...recordOf(folder, NEW_SLUG, { title: 'Ask or fix' }), dir: dirOf(folder, `.${NEW_SLUG}`) };
    },

    /**
     * A new conversation, named from its first words (R-m5c): a slug unique
     * among `taken` (the fixes on main and on every branch) and those kept here.
     * { fix }, or { error }.
     */
    create(folder, { title, taken = new Set() }) {
      const name = String(title ?? '').trim();
      const slug = fixSlug(name, new Set([...taken, NEW_SLUG, ...list(folder).map(record => record.slug)]));
      if (!slug) return { error: 'Say what you want to ask, in a few words.' };
      mkdirSync(dirOf(folder, slug), { recursive: true });
      writeMeta(dirOf(folder, slug), { title: name, createdAt: new Date().toISOString(), named: false });
      return { fix: find(folder, slug) };
    },

    /** Rename a conversation: the person's name from now on (R-m5c). Its slug, and so its address, stays. */
    rename(folder, slug, title) {
      const record = find(folder, slug);
      if (!record) return null;
      writeMeta(record.dir, { ...readMeta(record.dir), title: String(title).trim(), named: true });
      return find(folder, slug);
    },

    /**
     * Fix a conversation on its branch (R-x8d): its fix.json and sessions move
     * into prelude/fixes/<slug>/ in the branch's worktree - `slug` being the
     * fix's, from its name - with that name, and it's no longer kept here. The
     * paths its transcripts name move with it. The agent's own conversation
     * stays where it began (Claude keeps it by folder), so each session starts
     * the agent afresh on the branch, told to read what was said (`carried`).
     * The caller commits the branch. { fix, dir } (on the branch), or null.
     */
    moveOnto(folder, from, worktreePath, { title = null, slug = from } = {}) {
      const record = find(folder, from);
      if (!record) return null;
      const target = join(worktreePath, PRELUDE_DIR, FIXES_DIR, slug);
      mkdirSync(target, { recursive: true });
      if (existsSync(sessionsDir(record.dir))) cpSync(sessionsDir(record.dir), sessionsDir(target), { recursive: true });
      const was = `${PRELUDE_DIR}/${FIXES_DIR}/${from}/`;
      for (const session of listSessions(target)) {
        const file = join(sessionsDir(target), session.id, 'transcript.jsonl');
        if (slug !== from && existsSync(file)) writeFileSync(file, readFileSync(file, 'utf8').split(was).join(`${PRELUDE_DIR}/${FIXES_DIR}/${slug}/`));
        if (session.started) updateSession(target, session.id, { claudeSessionId: randomUUID(), started: false, carried: true });
      }
      const old = readMeta(record.dir) ?? {};
      const name = String(title ?? '').trim() || record.title;
      writeMeta(target, { title: name, createdAt: record.createdAt, named: Boolean(old.named) || name !== record.title });
      if (!existsSync(join(target, 'NOTES.md'))) {
        writeFileSync(join(target, 'NOTES.md'), `# Fix: ${name}\n\nWhat's wrong, the cause, what changed, and what to check - written as the fix goes.\n`);
      }
      rmSync(record.dir, { recursive: true, force: true });
      return { fix: { ...record, id: `${FIXES_DIR}/${slug}`, slug, title: name, kept: false, dir: target }, dir: target };
    },
  };
}
