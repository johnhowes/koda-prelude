// Designs, found in a folder's prelude/ directory.
//
// A design is any folder under prelude/ that contains a design.json. Folders
// above a design are areas: they have no file of their own and nothing else
// knows they exist. Designs don't nest, so the scan stops at the first
// design.json on each path. A design's id is its path relative to prelude/,
// with forward slashes (plan: "Designs, features and areas").
//
// Two kinds of design are special, one of each per folder, and designs in
// every other way (plan: steps 5 and 6):
//   "kind": "system" - the folder's design system: a system/ folder of
//                      tokens, components and guidelines the others link;
//   "kind": "shell"  - the app's shell: the layouts the others render in.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PRELUDE_DIR = 'prelude';

// Names inside prelude/ that are never areas or designs.
const RESERVED = new Set(['sessions', 'screens', 'node_modules']);

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Onboarding / Sign up" -> ["onboarding", "sign-up"]; empty segments dropped. */
export function areaSegments(area) {
  return String(area ?? '').split(/[\\/]+/).map(slugify).filter(Boolean);
}

/** The id a new design would get: its area's segments and its title's slug. */
export const designIdOf = ({ title, area }) => [...areaSegments(area), slugify(String(title ?? '').trim())].join('/');

export const SPECIAL_KINDS = { system: 'a design system', shell: 'an app shell' };
const kindOf = meta => (Object.hasOwn(SPECIAL_KINDS, meta.kind) ? meta.kind : 'design');

/** The folder's design of a special kind, if it has one (the first, should there be two). */
export function findKind(folderPath, kind) {
  return listDesigns(folderPath).find(design => design.kind === kind) ?? null;
}

export const findSystem = folderPath => findKind(folderPath, 'system');
export const findShell = folderPath => findKind(folderPath, 'shell');

function readDesign(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'design.json'), 'utf8')); } catch { return {}; }
}

/** Every design in the folder, sorted by id. */
export function listDesigns(folderPath) {
  const root = join(folderPath, PRELUDE_DIR);
  const found = [];

  const walk = (dir, segments) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || RESERVED.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const here = [...segments, entry.name];
      if (existsSync(join(path, 'design.json'))) {
        const meta = readDesign(path);
        found.push({
          id: here.join('/'),
          slug: entry.name,
          area: segments.join('/'),
          title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : entry.name,
          kind: kindOf(meta),
          createdAt: meta.createdAt ?? null,
        });
      } else {
        walk(path, here);
      }
    }
  };

  walk(root, []);
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Split URL segments into the design they name and what follows it:
 * ["onboarding", "sign-up", "sessions", "x"] -> { design, rest: ["sessions", "x"] }.
 * Designs don't nest, so the first folder with a design.json is the design.
 */
export function findDesign(folderPath, segments) {
  const root = join(folderPath, PRELUDE_DIR);
  for (let i = 1; i <= segments.length; i++) {
    const here = segments.slice(0, i);
    if (here.some(s => s === '' || s === '.' || s === '..' || s.startsWith('.') || RESERVED.has(s))) return null;
    const dir = join(root, ...here);
    if (existsSync(join(dir, 'design.json'))) {
      const meta = readDesign(dir);
      const design = {
        id: here.join('/'),
        slug: here.at(-1),
        area: here.slice(0, -1).join('/'),
        title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : here.at(-1),
        kind: kindOf(meta),
        createdAt: meta.createdAt ?? null,
      };
      return { design, dir, rest: segments.slice(i) };
    }
  }
  return null;
}

/** The designs grouped by area, designs with no area first. */
export function groupByArea(designs) {
  const groups = new Map();
  for (const design of designs) {
    if (!groups.has(design.area)) groups.set(design.area, []);
    groups.get(design.area).push(design);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([area, items]) => ({ area, designs: items }));
}

/**
 * Create a design. Returns { design } or { errors: { field: message } }.
 * Refuses a design inside another design, and a folder that already exists.
 */
export function createDesign(folderPath, { title, area, kind = 'design' }) {
  const cleanTitle = String(title ?? '').trim();
  const slug = slugify(cleanTitle);
  const segments = areaSegments(area);
  const errors = {};

  if (cleanTitle === '') errors.title = 'Give the design a title.';
  else if (slug === '') errors.title = 'The title needs at least one letter or digit.';
  else if (RESERVED.has(slug)) errors.title = `"${slug}" is reserved. Choose another title.`;

  const reservedArea = segments.find(segment => RESERVED.has(segment));
  if (reservedArea) errors.area = `"${reservedArea}" is reserved. Choose another area.`;

  const special = Object.hasOwn(SPECIAL_KINDS, kind) ? kind : null;
  const existing = special && findKind(folderPath, special);
  if (existing) errors.kind = `This project already has ${SPECIAL_KINDS[special]}: "${existing.title}".`;

  if (Object.keys(errors).length > 0) return { errors };

  const root = join(folderPath, PRELUDE_DIR);
  for (let i = 1; i <= segments.length; i++) {
    if (existsSync(join(root, ...segments.slice(0, i), 'design.json'))) {
      return { errors: { area: `"${segments.slice(0, i).join('/')}" is a design, and designs can't contain other designs.` } };
    }
  }

  const id = [...segments, slug].join('/');
  const dir = join(root, ...segments, slug);
  if (existsSync(dir)) return { errors: { title: `prelude/${id} already exists.` } };

  mkdirSync(dir, { recursive: true });
  const meta = { title: cleanTitle, ...(special ? { kind: special } : {}), createdAt: new Date().toISOString() };
  writeFileSync(join(dir, 'design.json'), JSON.stringify(meta, null, 2) + '\n');
  return { design: { id, slug, area: segments.join('/'), kind: kindOf(meta), ...meta } };
}
