// Home (prelude/landing-page): what needs the person across their recent
// projects, and what's in each - read afresh from the projects every time,
// since a turn, a build or a push may have changed any of them.
//
// The model is the shape of the design's states: times are prepared strings
// ("4 minutes ago"), and needs are kept in the order they arrived, oldest
// first, for the view to show newest first.
//
// What needs the person (R-n4v):
//   question      the newest session's last turn ended asking something (its
//                 last words end with "?"); until they answer
//   finished      a turn ended; until they open its session, or for a week (R-8hc)
//   stopped       a build under way on a branch, with no turn running
//   to-build      approved pages the app doesn't have yet
//   pull-request  a branch pushed for review; until it's merged (R-w2k)
// A design the agent is working on needs nothing yet: that's in the bar.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { appOf } from './app-config.js';
import { backlogOf } from './backlog.js';
import { PRELUDE_DIR, listDesigns } from './designs.js';
import { refuseFolder } from './folders.js';
import { isHosted, readRoutes } from './host.js';
import { listSessions, readEntries } from './sessions.js';
import { SNAPSHOTS_DIR } from './snapshots.js';
import { sessionKey } from './turns.js';
import { render } from './views.js';

/**
 * @typedef {'question' | 'stopped' | 'finished' | 'to-build' | 'pull-request'} NeedKind
 *
 * @typedef {object} Need       Something waiting on the person.
 * @property {string} id
 * @property {NeedKind} kind
 * @property {string} projectId
 * @property {string} project   the project's name
 * @property {string} design    the design's title
 * @property {string} says
 * @property {string} when      "4 minutes ago"
 * @property {string} url       where it's answered; a pull request's is on the Git server
 *
 * @typedef {object} InProgress A design being worked on, on its branch.
 * @property {string} title
 * @property {string} where     how it stands: "Build stopped"
 * @property {string} url
 *
 * @typedef {object} Project    A recent project. Until its contents are read,
 *                              or once its folder has gone, only the first four.
 * @property {string} id
 * @property {string} name
 * @property {string} path
 * @property {boolean} [missing]          its folder isn't there any more (R-h9b)
 * @property {string | null} [stack]
 * @property {number} [designs]
 * @property {string} [changed]           "2 minutes ago"
 * @property {InProgress[]} [inProgress]
 *
 * @typedef {object} Home
 * @property {Need[]} needs       oldest first
 * @property {Project[]} projects the most recently changed first (R-t7e)
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The app's one live channel (server-sent events): its key, and where layouts open it. */
export const APP_CHANNEL = 'app';
export const APP_LIVE = '/live';

/**
 * Which sessions the person has opened, and when: { "<folder>/<design>/<session>": iso }.
 * On this machine only (<home>/seen.json), like the recent list.
 */
export function createSeen(home) {
  const file = join(home, 'seen.json');
  const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')) ?? {}; } catch { return {}; } };
  return {
    all: read,
    mark(key, at = new Date().toISOString()) {
      const all = read();
      all[key] = at;
      // A turn seen over a week ago has left Needs you anyway.
      for (const [other, when] of Object.entries(all)) if (!(Date.parse(when) > Date.now() - WEEK)) delete all[other];
      mkdirSync(home, { recursive: true });
      writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
    },
  };
}

/** "just now", "4 minutes ago", "yesterday", "2 months ago". */
export function ago(iso, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60000);
  const count = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (!Number.isFinite(minutes)) return 'a while ago';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return count(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return count(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return count(days, 'day');
  if (days < 365) return count(Math.floor(days / 30), 'month');
  return count(Math.floor(days / 365), 'year');
}

const latest = times => times.filter(Boolean).reduce((a, b) => (b > a ? b : a), '');
const mtime = path => { try { return statSync(path).mtime.toISOString(); } catch { return null; } };

// The agent's words as one plain line, and a sentence of them, cut short.
const plain = text => String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
const sentences = text => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const clip = (text, length) => (text.length <= length ? text : `${text.slice(0, length - 1).replace(/\s+\S*$/, '')}…`);

/**
 * A project's designs, each where it's worked on: its branch's worktree if it
 * has one (step 9), else the project's own folder.
 * [{ design, dir, at: { id, path }, entry }], `at` being the folder its pages are under.
 */
function worksOf(app, folder) {
  const dirOf = (path, design) => join(path, PRELUDE_DIR, ...design.id.split('/'));
  const works = new Map(listDesigns(folder.path).map(design => [design.id, { design, dir: dirOf(folder.path, design), at: folder, entry: null }]));
  for (const entry of app.branches.of(folder.id)) {
    const design = listDesigns(entry.path).find(candidate => candidate.id === entry.design);
    if (design) works.set(design.id, { design, dir: dirOf(entry.path, design), at: { id: entry.id, path: entry.path }, entry });
  }
  return [...works.values()].map(work => ({ ...work, sessions: listSessions(work.dir) }));
}

/** When something last changed in a design: a session, its branch, a push. */
const changedAt = work => latest([
  ...work.sessions.map(session => session.updatedAt),
  work.design.createdAt,
  work.entry?.createdAt,
  work.entry?.published?.at,
]);

/** The pages of a hosted design, as its Build page counts them (a shell's gallery isn't built). */
const pagesOf = work => {
  const gallery = view => work.design.kind === 'shell' && view.startsWith('gallery/');
  return readRoutes(work.dir).filter(route => route.title && !route.over && !gallery(route.view)).length;
};

/** What waits on the person in one design. Internal needs carry `at` (iso) for ordering. */
function needsOfWork(app, project, work, { running, seen, now }) {
  const { design, dir, at, entry, sessions } = work;
  const base = { projectId: project.id, project: project.name, design: design.title };
  const needs = [];

  // A pull request stays until it's merged; a merged branch is tidied away.
  if (entry?.published) {
    let merged = false;
    try { merged = app.branches.status(entry).merged; } catch { /* git couldn't say: still open */ }
    if (!merged) {
      needs.push({
        ...base, id: `pull-request:${entry.id}`, kind: 'pull-request', at: entry.published.at,
        says: entry.published.pr ? `Pushed ${entry.branch}. Its pull request is waiting for a review.` : `Pushed ${entry.branch}, for a pull request.`,
        url: entry.published.pr ?? `/f/${project.id}`,
      });
    }
  }
  if (running) return needs;

  // A build under way with no turn running has stopped, for the person to say what next.
  if (entry?.building) {
    const session = sessions.find(candidate => candidate.build);
    const check = session && readEntries(dir, session.id).findLast(item => item.type === 'check');
    const failing = check?.failures?.length ?? 0;
    needs.push({
      ...base, id: `stopped:${entry.id}`, kind: 'stopped', at: session?.updatedAt ?? entry.createdAt,
      says: failing ? `The build stopped: ${failing === 1 ? '1 page doesn’t' : `${failing} pages don’t`} render in the app.` : `The build of ${entry.building.title} stopped before it finished.`,
      url: `/f/${project.id}/d/${design.id}/build`,
    });
    return needs;
  }

  // Approved pages the app doesn't have yet, once there's an app to build them into.
  if ((design.kind === 'design' || design.kind === 'shell') && isHosted(dir) && appOf(at.path).built) {
    const approvedAt = mtime(join(dir, SNAPSHOTS_DIR));
    const left = approvedAt ? backlogOf(dir).groups.filter(group => !group.built && !(design.kind === 'shell' && (!group.page || group.page.view.startsWith('gallery/')))).length : 0;
    if (left) {
      needs.push({
        ...base, id: `to-build:${at.id}:${design.id}`, kind: 'to-build', at: approvedAt, pages: left,
        says: `${left === 1 ? '1 page is' : `${left} pages are`} approved and ready to build.`,
        url: `/f/${project.id}/d/${design.id}/build`,
      });
    }
  }

  // Turns that ended: the newest session's may have asked something, and any
  // from the last week the person hasn't opened since.
  sessions.forEach((session, index) => {
    if (index > 0 && !(Date.parse(session.updatedAt) > now - WEEK)) return;
    const entries = readEntries(dir, session.id);
    const turn = entries.findLast(item => item.type === 'turn');
    if (!turn || turn.stopped) return;
    const ended = entries.lastIndexOf(turn);
    if (entries.slice(ended).some(item => item.type === 'user')) return;
    const words = plain(entries.slice(0, ended).findLast(item => item.type === 'text')?.text);
    const key = sessionKey(at, design, session.id);
    const url = `/f/${at.id}/d/${design.id}/sessions/${session.id}`;
    if (index === 0 && turn.ok && /\?["'”’)\]]*$/.test(words)) {
      needs.push({ ...base, id: `question:${key}`, kind: 'question', at: turn.at, says: `The agent asks: ${clip(sentences(words).at(-1), 220)}`, url });
      return;
    }
    if ((seen[key] && seen[key] >= turn.at) || !(Date.parse(turn.at) > now - WEEK)) return;
    const says = !turn.ok ? 'The agent’s turn ended with an error.'
      : words ? `The agent finished its turn: ${clip(sentences(words)[0], 160)}`
      : 'The agent finished its turn.';
    needs.push({ ...base, id: `finished:${key}`, kind: 'finished', at: turn.at, says, url });
  });
  return needs;
}

/** How a design on its branch stands, in a few words. */
function whereOf(work, running, needs) {
  if (running) return 'The agent is working on it';
  const of = kind => needs.find(need => need.kind === kind);
  if (of('question')) return 'The agent is asking you';
  if (of('stopped')) return 'Build stopped';
  if (of('pull-request')) return 'Pull request open';
  if (of('to-build')) return `${of('to-build').pages} ${of('to-build').pages === 1 ? 'page' : 'pages'} to build`;
  if (of('finished')) return 'Turn finished';
  const pages = isHosted(work.dir) ? pagesOf(work) : 0;
  if (!pages) return 'Being designed';
  const count = `${pages} ${pages === 1 ? 'page' : 'pages'}`;
  return mtime(join(work.dir, SNAPSHOTS_DIR)) ? `${count}, approved` : `${count}, none approved yet`;
}

/** One recent project: { project, needs, changedAt }. */
function readProject(app, folder, { contents, seen, now, tidy }) {
  const project = { id: folder.id, name: folder.name, path: folder.path };
  if (refuseFolder(folder.path)) return { project: { ...project, missing: true }, needs: [], changedAt: '' };
  // A pull request merged on the Git server: fetching and tidying finds it.
  if (contents && app.branches.of(folder.id).some(entry => entry.published)) {
    try { tidy(folder); } catch { /* the remote couldn't be reached: as it was */ }
  }
  const works = worksOf(app, folder);
  const changed = latest(works.map(changedAt)) || folder.openedAt;
  if (!contents) return { project, needs: [], changedAt: changed };

  const needs = [];
  const inProgress = [];
  for (const work of works) {
    const running = app.turns.state(work.at, work.design, null).kind !== 'idle';
    const mine = needsOfWork(app, project, work, { running, seen, now });
    needs.push(...mine);
    if (work.entry) inProgress.push({ title: work.design.title, where: whereOf(work, running, mine), url: `/f/${folder.id}/d/${work.design.id}`, at: changedAt(work) });
  }
  inProgress.sort((a, b) => b.at.localeCompare(a.at));
  return {
    project: {
      ...project,
      stack: appOf(folder.path).stack,
      designs: works.length,
      changed: ago(changed, now),
      inProgress: inProgress.map(({ title, where, url }) => ({ title, where, url })),
    },
    needs,
    changedAt: changed,
  };
}

/**
 * The home page's model. Without `contents`, only the recent projects' names
 * and folders (cheap: the page arrives at once, and its regions read the rest).
 * `tidy(folder)` fetches a project's remote and tidies its merged branches.
 * @returns {Home}
 */
export function homeOf(app, { contents = true, now = Date.now(), tidy = () => {} } = {}) {
  const seen = contents ? app.seen.all() : {};
  const read = app.folders.recent().map(folder => readProject(app, folder, { contents, seen, now, tidy }));
  // The most recently changed first; a folder that has gone, last.
  read.sort((a, b) => (Boolean(a.project.missing) - Boolean(b.project.missing)) || b.changedAt.localeCompare(a.changedAt));
  const needs = read.flatMap(item => item.needs).sort((a, b) => a.at.localeCompare(b.at));
  return {
    needs: needs.map(({ id, kind, projectId, project, design, says, at, url }) => ({ id, kind, projectId, project, design, says, when: ago(at, now), url })),
    projects: read.map(item => item.project),
  };
}

/**
 * What waits on the person in one project, for its own page (R-v7q): Home's
 * needs, for that project alone, oldest first (the view shows newest first).
 * [{ id, kind, design, says, when, url }]
 */
export function needsOfProject(app, folder, { now = Date.now() } = {}) {
  const seen = app.seen.all();
  const project = { id: folder.id, name: folder.name, path: folder.path };
  const needs = worksOf(app, folder).flatMap(work =>
    needsOfWork(app, project, work, { running: app.turns.state(work.at, work.design, null).kind !== 'idle', seen, now }));
  return needs.sort((a, b) => a.at.localeCompare(b.at))
    .map(({ id, kind, design, says, at, url }) => ({ id, kind, design, says, when: ago(at, now), url }));
}

/** How many things wait on the person, for the bar (R-z3g): kept until something changes. */
export function waitingOf(app) {
  if (app.waiting == null) {
    try { app.waiting = homeOf(app).needs.length; } catch { return 0; }
  }
  return app.waiting;
}

/**
 * Something changed in Prelude: say so down the app's channel, so the home
 * page's regions reload (R-p6r), and push the bar's count afresh. Sent once
 * the request that changed it is answered, never holding it up.
 */
export function tell(app, { needs = false, projects = false }) {
  if (needs) app.waiting = null;
  setImmediate(() => {
    if (!app.live.listening(APP_CHANNEL)) return;
    try {
      if (needs) app.live.publish(APP_CHANNEL, 'needs-changed');
      if (projects) app.live.publish(APP_CHANNEL, 'projects-changed');
      if (needs) app.live.publish(APP_CHANNEL, `<div ko-into="waiting">${render('./_waiting', { needsYou: waitingOf(app) }).trim()}</div>`);
    } catch (error) { console.error(error); }
  });
}
