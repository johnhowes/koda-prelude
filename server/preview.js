// The design surface's side of the server: a design's screens, the prelude/
// folder's files served as they are, and a watch on a design's folder that
// says when they change.
//
// The files are served exactly as written, at /f/<folder>/p/<path in
// prelude/>, so relative links - between screens, to ../styles.css, to the
// folder's design system - work here and on any static host (plan: ground
// rule 7). They are served on an origin of their own (preview.localhost, see
// main.js), not sandboxed: a sandboxed screen loses localStorage and
// same-origin fonts, which real prototypes use.

import { createReadStream, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** "01-sign-up.html" -> "Sign up": the fallback when a screen has no <title>. */
export function screenName(file) {
  const words = file.replace(/\.html$/i, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : file;
}

/** The design's screens, in file-name order: { id, file, title }. */
export function listScreens(designDir) {
  let files;
  try { files = readdirSync(join(designDir, 'screens')); } catch { return []; }
  return files
    .filter(file => /\.html$/i.test(file) && !file.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(file => {
      let title = null;
      try {
        const head = readFileSync(join(designDir, 'screens', file), 'utf8').slice(0, 4000);
        title = head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1].trim() || null;
      } catch { /* unreadable; use the name */ }
      return { id: file.replace(/\.html$/i, ''), file, title: title ?? screenName(file) };
    });
}

/**
 * Serve a file from a folder's prelude/ directory. Never a design's sessions/
 * (transcripts aren't for showing), never a dotfile, never anything outside.
 */
export function servePreludeFile(res, root, rel, send) {
  const parts = rel.split('/');
  if (parts.some(p => p === '' || p === 'sessions' || p.startsWith('.'))) return send(404);
  const file = normalize(join(root, ...parts));
  if (!file.startsWith(root + sep)) return send(404);
  let stat;
  try { stat = statSync(file); } catch { stat = null; }
  if (!stat?.isFile()) return send(404);
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}

/**
 * Watches on design folders, shared by everyone looking at the same design and
 * closed when the last one leaves. Changes under sessions/ (the transcript,
 * written all the time) are ignored; the rest are batched.
 */
export function createWatches({ debounceMs = 150 } = {}) {
  const watches = new Map();   // key -> { watcher, count, timer }

  return {
    acquire(key, dir, onChange) {
      let entry = watches.get(key);
      if (!entry) {
        entry = { count: 0, timer: null, watcher: null };
        try {
          entry.watcher = watch(dir, { recursive: true }, (_, name) => {
            const path = String(name ?? '').replace(/\\/g, '/');
            if (path === 'sessions' || path.startsWith('sessions/')) return;
            clearTimeout(entry.timer);
            entry.timer = setTimeout(onChange, debounceMs);
          });
          entry.watcher.on('error', () => {});
        } catch { /* no watch, no live reload; Refresh still works */ }
        watches.set(key, entry);
      }
      entry.count++;
      return () => {
        if (--entry.count > 0) return;
        clearTimeout(entry.timer);
        entry.watcher?.close();
        watches.delete(key);
      };
    },
  };
}
