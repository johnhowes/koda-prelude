// Sessions: one conversation with the agent, contributing to one design.
//
//   prelude/<design>/sessions/<yyyymmdd-hhmm>-<rand>/
//     session.json       { title, claudeSessionId, started, startedAt, updatedAt }
//     transcript.jsonl   one entry per line, append-only
//
// Session folders are named so two people in two branches never collide, and
// the transcript is only ever appended to, so committed sessions merge cleanly
// (plan: ground rule 8).

import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_ID = /^\d{8}-\d{4}-[a-z0-9]{4}$/;

export const isSessionId = id => SESSION_ID.test(id);

export function newSessionId(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const rand = [...randomBytes(4)].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  return `${stamp}-${rand}`;
}

/** A title from the first message: its first line, cut at a word near 60 characters. */
export function titleFrom(message) {
  const line = String(message).trim().split(/\r?\n/)[0].trim();
  if (line.length <= 60) return line || 'Untitled session';
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trim()}…`;
}

export function sessionsDir(designDir) {
  return join(designDir, 'sessions');
}

/**
 * A new session. `build` ({ group, title }) makes it a build session (step
 * 9): it builds that group of its design, on the design's branch.
 */
export function createSession(designDir, { title, build = null }) {
  const id = newSessionId();
  const dir = join(sessionsDir(designDir), id);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta = { title, claudeSessionId: randomUUID(), started: false, startedAt: now, updatedAt: now, ...(build ? { build } : {}) };
  writeFileSync(join(dir, 'session.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(dir, 'transcript.jsonl'), '');
  return { id, ...meta };
}

export function readSession(designDir, id) {
  if (!isSessionId(id)) return null;
  try {
    const meta = JSON.parse(readFileSync(join(sessionsDir(designDir), id, 'session.json'), 'utf8'));
    return { id, ...meta };
  } catch {
    return null;
  }
}

export function updateSession(designDir, id, changes) {
  const current = readSession(designDir, id);
  if (!current) return null;
  const { id: _, ...meta } = { ...current, ...changes, updatedAt: new Date().toISOString() };
  writeFileSync(join(sessionsDir(designDir), id, 'session.json'), JSON.stringify(meta, null, 2) + '\n');
  return { id, ...meta };
}

/** Every session of a design, newest first. */
export function listSessions(designDir) {
  let names;
  try { names = readdirSync(sessionsDir(designDir)); } catch { return []; }
  return names
    .map(name => readSession(designDir, name))
    .filter(Boolean)
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** A design's build sessions by the group each builds: the newest of each. */
export function buildSessions(designDir) {
  const byGroup = new Map();
  for (const session of listSessions(designDir)) {
    if (session.build && !byGroup.has(session.build.group)) byGroup.set(session.build.group, session);
  }
  return byGroup;
}

export function appendEntry(designDir, id, entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(join(sessionsDir(designDir), id, 'transcript.jsonl'), line + '\n');
}

/** The transcript's entries, from index `from` on. Unreadable lines are skipped. */
export function readEntries(designDir, id, from = 0) {
  let text;
  try { text = readFileSync(join(sessionsDir(designDir), id, 'transcript.jsonl'), 'utf8'); } catch { return []; }
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn line; skip it */ }
  }
  return entries.slice(from);
}
