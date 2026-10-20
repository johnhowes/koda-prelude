// A build session's check (prelude/build): every screen of the design - each
// titled page and overlay, in each state - as the agent's last turn left it,
// against its approved screen. It runs each time a build turn ends, over the
// whole design, not only the page being built: a build can change shared
// parts (R-9xe). Kept with the session, so the page shows it after a restart:
//
//   sessions/<id>/check.json   { at, shots: [{ id, key, path, stateId, state, page, group, status, error? }] }
//
// A screen is 'matches', 'differs' (from its approved screen), 'fails' (it
// doesn't render) or, for the page being built, 'unbuilt' (its route is still
// the design's own view). Approving one as built saves that screen alone; the
// rest are still checked against the design (R-f6w).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { backlogOf } from './backlog.js';
import { listStates, readRoutes, readState, samplePaths } from './host.js';
import { sessionsDir } from './sessions.js';
import { snapshotName } from './snapshots.js';
import { whenWords } from './workspace.js';

/**
 * @typedef {object} Shot        One screen of the check: a page in a state.
 * @property {string} id
 * @property {string} group      the page of the design it belongs to (its Build page's title)
 * @property {string} page       the page or overlay's title
 * @property {string} state      the state's title
 * @property {'matches' | 'differs' | 'fails' | 'unbuilt'} status
 * @property {string} url
 * @property {string} [error]    why it doesn't render
 * @property {{ show?: string }} [$query]  Built, Approved or Differences
 *
 * @typedef {object} Check       The check, as the build session shows it.
 * @property {string} url
 * @property {string} at         "today at 09:52"
 * @property {Shot[]} shots      the page being built's, then the rest's that don't match
 * @property {{ matching: number, pages: number }} elsewhere  the rest that match, counted
 *
 * @typedef {object} BuildSession  A build session's page (build/session).
 * @property {string} id
 * @property {string} title
 * @property {string} url
 * @property {{ id: string, name: string, url: string }} folder  the project
 * @property {{ id: string, title: string, url: string }} design
 * @property {string} branch
 * @property {{ title: string, stories: number }} build  the page being built, and how many stories it has
 * @property {{ running: boolean, url: string, open: string, start: string, back: string } | null} app
 *   the app on this branch, with its own data; null with no design host to run it
 * @property {{ says: string } | null} status  what the agent is doing, while it works
 * @property {Check} check
 * @property {object[]} [entries]  the design's stand-in transcript; the app gives `chat`
 * @property {object} [chat]       the design page's chat (DesignPage, server/workspace.js)
 * @property {string} [live]       the session's channel
 */

const fileOf = (dir, sessionId) => join(sessionsDir(dir), sessionId, 'check.json');

/** The session's last check: { at, shots }, or null before its first. */
export function readCheck(dir, sessionId) {
  try { return JSON.parse(readFileSync(fileOf(dir, sessionId), 'utf8')); } catch { return null; }
}

export function writeCheck(dir, sessionId, check) {
  writeFileSync(fileOf(dir, sessionId), JSON.stringify(check, null, 2) + '\n');
}

/**
 * Every screen of the design, with what a check found (reviewDesign's
 * { failures, differ }), or - with no review, before the first turn ends -
 * as the build found it: the page being built's screens not built yet where
 * they're still the design's, and the rest as approved. `building` is the
 * group's title.
 */
export function screensOf(dir, building, review = null) {
  const routes = readRoutes(dir).filter(route => route.title);
  const groups = backlogOf(dir).groups;
  const groupOf = route => groups.find(group => group.routes.some(one => one.pattern === route.pattern))?.title ?? route.title;
  const shots = [];
  for (const state of listStates(dir)) {
    for (const { route, path } of samplePaths(routes, readState(dir, state))) {
      const name = snapshotName(path);
      const key = `${state.id}/${name}`;
      const group = groupOf(route);
      const failure = review?.failures.find(one => one.state === state.title && (one.path === path || one.path === `${path} (alone)`));
      const status = failure ? 'fails'
        : group === building && !route.ported ? 'unbuilt'
        : review?.differ.some(one => one.name === key) ? 'differs'
        : 'matches';
      shots.push({ id: `${state.id}~${name}`, key, path, stateId: state.id, state: state.title, page: route.title, group, status, ...(failure ? { error: failure.error } : {}) });
    }
  }
  return shots;
}

/**
 * The check as the page shows it: the page being built's screens, then the
 * rest of the design's that don't match, the others counted. `url` is the
 * check's address.
 */
export function checkView({ at, shots }, { url, building }) {
  const shot = one => ({ id: one.id, group: one.group, page: one.page, state: one.state, status: one.status, url: `${url}/${one.id}`, ...(one.error ? { error: one.error } : {}) });
  const others = shots.filter(one => one.group !== building);
  const matching = others.filter(one => one.status === 'matches');
  return {
    url,
    at: whenWords(at) ?? 'a while ago',
    shots: [...shots.filter(one => one.group === building), ...others.filter(one => one.status !== 'matches')].map(shot),
    elsewhere: { matching: matching.length, pages: new Set(others.map(one => one.page)).size },
  };
}

/** One screen, as its view shows it: null if the check has no such screen. */
export function shotView({ shots }, id, { url, query = {} }) {
  const one = shots.find(candidate => candidate.id === id);
  if (!one) return null;
  return { id: one.id, group: one.group, page: one.page, state: one.state, status: one.status, url: `${url}/${one.id}`, ...(one.error ? { error: one.error } : {}), $query: query };
}
