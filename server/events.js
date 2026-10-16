// Server events (plan, 6e): what a design's server says on its own, declared in
// the design's events.json, sent from the design bar down a live channel the
// preview opens at /_prelude/live.
//
//   { "needs-changed": { "title": "A pull request needs review",
//                        "add": "needs", "with": { ... },
//                        "send": "needs-changed",
//                        "push": [ { "into": "notice?", "view": "home/_notice", "data": "needs/:new" } ] } }
//
// An event may change the state's data (a POST verb at a data path, with the
// fields in "with"), then sends an event in Koda's message format ("send"),
// markup for regions ("push"), or both.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const EVENTS_FILE = 'events.json';

/** The URL a design's pages open their channel at, on the design's own origin. */
export const LIVE_PATH = '/_prelude/live';

/** The design's events: [{ name, title, verb, at, with, send, push: [{ into, view, data }] }]. */
export function readEvents(designDir) {
  let table;
  try { table = JSON.parse(readFileSync(join(designDir, EVENTS_FILE), 'utf8')); } catch { return []; }
  return parseEvents(table);
}

/** The events in an events.json table; one with nothing to send is left out. */
export function parseEvents(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  const events = [];
  for (const [name, event] of Object.entries(table)) {
    if (!/^[A-Za-z][\w.-]*$/.test(name) || !event || typeof event !== 'object') continue;
    const verb = ['update', 'add', 'remove'].find(key => typeof event[key] === 'string') ?? null;
    const push = Array.isArray(event.push)
      ? event.push.filter(part => part && typeof part.into === 'string')
        .map(part => ({ into: part.into, view: typeof part.view === 'string' ? part.view : null, data: typeof part.data === 'string' ? part.data : '' }))
      : [];
    const send = typeof event.send === 'string' && event.send.trim() ? event.send.trim() : null;
    if (!send && push.length === 0) continue;
    events.push({
      name,
      title: typeof event.title === 'string' && event.title.trim() ? event.title.trim() : name,
      verb,
      at: verb ? event[verb] : null,
      with: event.with && typeof event.with === 'object' && !Array.isArray(event.with) ? event.with : {},
      send,
      push,
    });
  }
  return events;
}

/**
 * The live channels: one per design, every window showing it listening
 * (server-sent events). join() keeps a response open; send() writes each
 * message to every window of that design.
 */
export function createChannels() {
  const open = new Map();   // design key -> Set of responses
  return {
    join(key, req, res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-koda': '1' });
      res.write(': open\n\n');
      if (!open.has(key)) open.set(key, new Set());
      open.get(key).add(res);
      req.on('close', () => open.get(key)?.delete(res));
    },
    /** Write messages (strings) to every window of a design. Returns how many windows heard. */
    send(key, messages) {
      const listeners = open.get(key) ?? new Set();
      for (const res of listeners) {
        for (const message of messages) res.write(`${String(message).split('\n').map(line => `data: ${line}`).join('\n')}\n\n`);
      }
      return listeners.size;
    },
    listening: key => open.get(key)?.size ?? 0,
    closeAll() { for (const set of open.values()) for (const res of set) res.end(); open.clear(); },
  };
}
