// Fixes (plan, step 11): one problem in a project, worked on in sessions,
// outside any one design. A fix lives in prelude/fixes/<slug>/ - fix.json (its
// title, when it started), NOTES.md (what was wrong and what changed) and its
// sessions/ - and on its own branch, prelude/fix-<slug>, which is finished like
// a design's. In the server a fix is looked up as a design of kind "fix" with
// the id "fixes/<slug>", so its page, sessions, turns and branch are a design's;
// it has no screens, states or Build page.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRELUDE_DIR, slugify } from './designs.js';

export const FIXES_DIR = 'fixes';
export const FIX_FILE = 'fix.json';

/** The design-shaped record of a fix: { id: "fixes/<slug>", slug, area: '', title, kind: 'fix', createdAt }. */
function fixRecord(slug, meta) {
  return {
    id: `${FIXES_DIR}/${slug}`,
    slug,
    area: '',
    title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : slug,
    kind: 'fix',
    createdAt: meta.createdAt ?? null,
  };
}

function readFix(dir) {
  try { return JSON.parse(readFileSync(join(dir, FIX_FILE), 'utf8')) ?? {}; } catch { return null; }
}

/** The fixes in a folder (a project or a branch's worktree), newest first. */
export function listFixes(folderPath) {
  const root = join(folderPath, PRELUDE_DIR, FIXES_DIR);
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ slug: entry.name, meta: readFix(join(root, entry.name)) }))
    .filter(({ meta }) => meta)
    .map(({ slug, meta }) => fixRecord(slug, meta))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/**
 * A fix by URL segments ["fixes", "<slug>", ...rest], as findDesign answers
 * for a design: { design, dir, rest }, or null.
 */
export function findFix(folderPath, segments) {
  const [area, slug, ...rest] = segments;
  if (area !== FIXES_DIR || !slug || slug.startsWith('.') || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const dir = join(folderPath, PRELUDE_DIR, FIXES_DIR, slug);
  const meta = readFix(dir);
  return meta ? { design: fixRecord(slug, meta), dir, rest } : null;
}

/** A slug for a new fix's title, not among `taken` (slugs in use, here or on branches). */
export function fixSlug(title, taken = new Set()) {
  const base = slugify(title);
  if (!base) return null;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Start a fix in a folder: its folder and fix.json, with the given slug or one
 * made unique among the fixes there. { fix, dir } or { errors: { title } }.
 */
export function createFix(folderPath, { title, slug: wanted = null }) {
  const name = String(title ?? '').trim();
  if (!name) return { errors: { title: 'Say what’s wrong, in a few words.' } };
  const root = join(folderPath, PRELUDE_DIR, FIXES_DIR);
  const taken = new Set(listFixes(folderPath).map(fix => fix.slug));
  const slug = wanted && !taken.has(wanted) ? wanted : fixSlug(name, taken);
  if (!slug) return { errors: { title: 'The title needs at least one letter or digit.' } };
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const meta = { title: name, createdAt: new Date().toISOString() };
  writeFileSync(join(dir, FIX_FILE), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(dir, 'NOTES.md'), `# Fix: ${name}\n\nWhat's wrong, the cause, what changed, and what to check - written as the fix goes.\n`);
  return { fix: fixRecord(slug, meta), dir };
}
