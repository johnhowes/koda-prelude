// A project's page (prelude/project-landing-page): its work - what needs the
// person here, the designs in progress on their branches, and the rest of its
// designs - beside its setup: the app, and what the agent can read. Read
// afresh every time, since a turn, a build, a push or a merge may have
// changed any of it (R-8dz).
//
// The model is the shape of the design's states: times are prepared strings
// ("2 hours ago"), needs are oldest first for the view to show newest first,
// and each design's `stage` is prepared here for the filter and its pill.

import { join } from 'node:path';

import { appOf, DEFAULT_STACK } from './app-config.js';
import { backlogOf } from './backlog.js';
import { buildable, gitState, remoteOf } from './branches.js';
import { PRELUDE_DIR, findDesign, listDesigns } from './designs.js';
import { folderId } from './folders.js';
import { ago, clip, needsOfProject, plain, sentences } from './home.js';
import { filterModel, isHosted } from './host.js';
import { listSessions, readEntries } from './sessions.js';
import { readSnapshots } from './snapshots.js';

/**
 * @typedef {import('./home.js').NeedKind} NeedKind
 * @typedef {'design' | 'system' | 'shell' | 'fix'} DesignKind
 *
 * @typedef {object} Need          Something waiting on the person here.
 * @property {string} id
 * @property {NeedKind} kind
 * @property {string} design       the design's title
 * @property {string} says
 * @property {string} when         "25 minutes ago"
 * @property {string} url          where it's answered; a pull request's is on the Git server
 *
 * @typedef {object} DesignRef
 * @property {string} id
 * @property {string} title
 * @property {DesignKind} kind
 * @property {string | null} area
 *
 * @typedef {object} Story         A group of the design's work on its branch.
 * @property {string} title
 * @property {'new' | 'changed'} kind
 * @property {'built' | 'to-build' | 'building'} state
 * @property {string} summary
 * @property {string} story        the story to copy, in full
 * @property {string | null} session   its build session's URL
 *
 * @typedef {object} Branch        A design in progress, on its branch.
 * @property {string} id           the branch's worktree id
 * @property {DesignRef} design
 * @property {string} url          the design's page
 * @property {string} buildUrl
 * @property {string} finish       /f/<project>/branches/<id>, where its forms post
 * @property {string} branch
 * @property {string} into
 * @property {'passing' | 'failing' | 'waiting' | 'unchecked'} check
 * @property {number} failures
 * @property {number} behind
 * @property {boolean} worked
 * @property {{ name: string, pulls: string | null } | null} remote
 * @property {boolean} pushed      pushed for a pull request, not merged yet
 * @property {{ title: string, stopped: boolean } | null} building
 * @property {string[]} alsoChanges
 * @property {{ running: boolean, approved: boolean, url: string, open: string } | null} running
 * @property {{ from: string, unresolved: string[] } | null} merging
 * @property {string | null} finishError
 * @property {Story[]} stories
 *
 * @typedef {object} Design        A design not on a branch, and how far it's got.
 * @property {string} id
 * @property {string} title
 * @property {DesignKind} kind
 * @property {string | null} area
 * @property {number} pages
 * @property {number} approved
 * @property {number} built
 * @property {'ready' | 'designing' | 'approved' | 'built'} stage
 * @property {string | null} changed   "yesterday"
 *
 * @typedef {object} App
 * @property {'none' | 'existing' | 'building' | 'on-branch' | 'built'} status
 * @property {string | null} stack
 * @property {string | null} path
 * @property {boolean} existing
 * @property {string | null} branch   the shell's, while the app is on it
 * @property {string | null} url      where to follow or check it
 *
 * @typedef {object} Merged
 * @property {string} id
 * @property {string} branch
 * @property {string} into
 * @property {string} when
 *
 * @typedef {object} Reference
 * @property {string} id
 * @property {string} name
 * @property {string} path
 *
 * @typedef {object} Asked         A conversation about the project with no branch yet (asked.js).
 * @property {string} id           its slug
 * @property {string} title
 * @property {string} url          its page, /f/<project>/d/fixes/<slug>
 * @property {'working' | 'asking' | 'answered'} state
 * @property {string | null} says  the agent's last line, if it's said anything
 * @property {string} when         "Started 2 minutes ago", "yesterday"
 *
 * @typedef {object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} path
 * @property {'repository' | 'none' | 'inside' | 'missing'} git
 * @property {boolean} canBuild
 * @property {string | null} appError
 * @property {App} app
 * @property {string} defaultStack
 * @property {{ id: string, title: string } | null} system
 * @property {{ id: string, title: string } | null} shell
 * @property {Need[]} needs           oldest first
 * @property {Branch[]} inProgress
 * @property {Asked[]} asked          newest first
 * @property {Design[]} designs      as ?q= and ?stage= leave them
 * @property {Merged[]} merged        the last five (R-f0c)
 * @property {Reference[]} references
 */

/** How the page's route filters its designs: by ?q= (title or area) and ?stage=, as routes.json says. */
const DESIGNS_FILTER = { list: 'designs', search: { q: ['title', 'area'] }, match: { stage: 'stage' } };

const latest = times => times.filter(Boolean).reduce((a, b) => (b > a ? b : a), '');
const refOf = design => ({ id: design.id, title: design.title, kind: design.kind, area: design.area || null });
const dirOf = (path, design) => join(path, PRELUDE_DIR, ...design.id.split('/'));

/** A reference folder's id, for the URL that stops reading it: short, from its path. */
export const referenceId = path => folderId(path);

/** Where a remote's pull requests are listed, on the web: its own page for one pushed. */
function pullsOf(remote) {
  const web = remote.url.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git$/, '');
  if (!/^https?:/.test(web)) return null;
  return remote.host === 'github' ? `${web}/pulls` : remote.host === 'azure' ? `${web}/pullrequests` : web;
}

/**
 * A design's pages and how far they've got, as its Build page counts them (a
 * shell's gallery isn't built), and its stage: ready (approved pages not yet
 * built, once the app exists: R-r6b), designing (pages still to approve, or
 * none yet), approved, or built. Approval is the design's, all its pages at
 * once, so `approved` is all of them or none.
 */
function progressOf(design, dir, appExists) {
  const pages = isHosted(dir)
    ? backlogOf(dir).groups.filter(group => group.page && !(design.kind === 'shell' && group.page.view.startsWith('gallery/')))
    : [];
  const built = pages.filter(group => group.built).length;
  const approved = pages.length && readSnapshots(dir)?.size ? pages.length : 0;
  const builds = design.kind === 'design' || design.kind === 'shell';
  const stage = pages.length && built === pages.length ? 'built'
    : builds && appExists && approved > built ? 'ready'
    : !pages.length || approved < pages.length ? 'designing'
    : 'approved';
  return { pages: pages.length, approved, built, stage };
}

/**
 * The designs in progress on the project's branches, each as the page shows
 * it. `branchOf(entry, design)` is where the branch stands (main.js's
 * branchState), `storiesOf(entry, design)` its stories; `finishError` is
 * { id, message } when finishing that branch just failed.
 * @returns {Branch[]}
 */
export function branchesOf(app, folder, { branchOf, storiesOf, finishError = null }) {
  if (folder.branch) return [];
  const remote = remoteOf(folder.path);
  const onMain = listDesigns(folder.path);
  return app.branches.of(folder.id)
    // A fix (step 11) is found as a design, though it isn't listed with them.
    .map(entry => ({ entry, design: listDesigns(entry.path).find(design => design.id === entry.design) ?? onMain.find(design => design.id === entry.design) ?? findDesign(entry.path, entry.design.split('/'))?.design }))
    .filter(({ design }) => design)
    .sort((a, b) => a.design.id.localeCompare(b.design.id))
    .map(({ entry, design }) => {
      const state = branchOf(entry, design);
      // A build under way with no turn running has stopped, as Home says.
      const turning = app.turns.state({ id: entry.id, path: entry.path }, design, null).kind !== 'idle';
      return {
        id: entry.id,
        design: refOf(design),
        url: state.url,
        buildUrl: `${state.url}/build`,
        finish: `/f/${folder.id}/branches/${entry.id}`,
        branch: entry.branch,
        into: state.into,
        check: state.check,
        failures: state.failures,
        behind: state.behind,
        worked: state.worked,
        remote: remote ? { name: 'origin', pulls: entry.published?.pr ?? pullsOf(remote) } : null,
        pushed: Boolean(entry.published),
        building: entry.building ? { title: entry.building.title, stopped: !turning } : null,
        alsoChanges: state.alsoChanges ?? [],
        running: state.running ? { running: state.running.running, approved: state.running.approved, url: state.running.url, open: state.running.open } : null,
        merging: state.merging ? { from: state.merging.from, unresolved: state.merging.unresolved } : null,
        finishError: finishError?.id === entry.id ? finishError.message : null,
        stories: storiesOf(entry, design),
      };
    });
}

/**
 * Asked lately: the conversations kept on this computer (asked.js), newest
 * first. One with a branch is in progress instead, so it isn't here (R-x8d).
 * Each is working while a turn runs, asking when its newest session's turn
 * ended on a question (as Needs you reads one), and answered otherwise.
 * @returns {Asked[]}
 */
export function askedOf(app, folder, { now = Date.now() } = {}) {
  if (folder.branch || !app.asked) return [];
  const branched = new Set(app.branches.of(folder.id).map(entry => entry.design));
  return app.asked.list(folder).filter(record => !branched.has(record.id)).map(record => {
    const session = listSessions(record.dir)[0] ?? null;
    const entries = session ? readEntries(record.dir, session.id) : [];
    const words = plain(entries.findLast(item => item.type === 'text')?.text);
    const turn = entries.findLast(item => item.type === 'turn');
    const working = app.turns.state(folder, record, null).kind !== 'idle';
    const asking = !working && turn?.ok && entries.lastIndexOf(turn) === entries.length - 1 && /\?["'”’)\]]*$/.test(words);
    return {
      id: record.slug,
      title: record.title,
      url: `/f/${folder.id}/d/${record.id}`,
      state: working ? 'working' : asking ? 'asking' : 'answered',
      says: words ? clip(sentences(words).at(-1), 220) : null,
      when: working ? `Started ${ago(session?.startedAt ?? record.createdAt, now)}` : ago(record.updatedAt ?? record.createdAt, now),
    };
  });
}

/**
 * The project page's model. `parts` leaves out what a region doesn't show
 * (reading a hundred designs' progress for the work region would be slow):
 * { work: false } has no needs or branches, { designs: false } no designs.
 * `query` is the request's: ?q= and ?stage= filter the designs (R-2hx: a
 * design on a branch is in progress, not among them).
 * @returns {Project}
 */
export function projectOf(app, folder, { branchOf, storiesOf, query = {}, parts = {}, finishError = null, appError = null, now = Date.now() }) {
  const { work = true, designs: withDesigns = true } = parts;
  const entries = folder.branch ? [] : app.branches.of(folder.id);
  const onMain = listDesigns(folder.path);
  const onBranches = entries
    .filter(entry => !onMain.some(design => design.id === entry.design))
    .map(entry => listDesigns(entry.path).find(design => design.id === entry.design))
    .filter(Boolean);
  const all = [...onMain, ...onBranches];
  const system = all.find(design => design.kind === 'system') ?? null;
  const shell = all.find(design => design.kind === 'shell') ?? null;

  const config = appOf(folder.path);
  const shellEntry = shell ? entries.find(entry => entry.design === shell.id) ?? null : null;
  const onShell = shellEntry ? appOf(shellEntry.path) : null;
  const status = config.built ? 'built'
    : onShell?.built ? 'on-branch'
    : shellEntry?.building?.group === '@app' ? 'building'
    : config.existing ? 'existing'
    : 'none';
  const appModel = {
    status,
    stack: config.stack ?? onShell?.stack ?? null,
    path: status === 'built' ? config.path : status === 'on-branch' ? onShell.path : null,
    existing: config.existing,
    branch: status === 'building' || status === 'on-branch' ? shellEntry.branch : null,
    url: status === 'building' ? `/f/${folder.id}/d/${shell.id}/build` : status === 'on-branch' ? `/f/${folder.id}/d/${shell.id}` : null,
  };

  const designs = withDesigns
    ? onMain.filter(design => !entries.some(entry => entry.design === design.id)).map(design => {
      const dir = dirOf(folder.path, design);
      const changed = latest([...listSessions(dir).map(session => session.updatedAt), design.createdAt]);
      return { ...refOf(design), ...progressOf(design, dir, config.built), changed: changed ? ago(changed, now) : null };
    })
    : [];

  const model = {
    id: folder.id,
    name: folder.name,
    path: folder.path,
    git: gitState(folder.path),
    canBuild: !folder.branch && buildable(folder.path),
    appError,
    app: appModel,
    defaultStack: DEFAULT_STACK,
    system: system && { id: system.id, title: system.title },
    shell: shell && { id: shell.id, title: shell.title },
    needs: work ? needsOfProject(app, folder, { now }) : [],
    inProgress: work ? branchesOf(app, folder, { branchOf, storiesOf, finishError }) : [],
    asked: work ? askedOf(app, folder, { now }) : [],
    designs,
    merged: folder.branch ? [] : app.branches.merged(folder.id).slice(0, 5)
      .map(note => ({ id: `${note.branch}@${note.at}`, branch: note.branch, into: note.into, when: ago(note.at, now) })),
    references: app.references.of(folder.id).map(reference => ({ id: referenceId(reference.path), name: reference.name, path: reference.path })),
  };
  return filterModel(model, DESIGNS_FILTER, query);
}
