// A project's page (prelude/project-landing-page): its work - what needs the
// person here, the designs in progress on their branches, and the rest of its
// designs - beside its setup: the app, and what the agent can read. Read
// afresh every time, since a turn, a build, a push or a merge may have
// changed any of it (R-8dz).
//
// The model is the shape of the design's states: times are prepared strings
// ("2 hours ago"), needs are oldest first for the view to show newest first,
// and each design's `stage` is prepared here for the filter and its pill.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { appOf, DEFAULT_STACK } from './app-config.js';
import { backlogOf } from './backlog.js';
import { buildable, gitState, mainBranch, remoteOf } from './branches.js';
import { PRELUDE_DIR, findDesign, listDesigns } from './designs.js';
import { folderId } from './folders.js';
import { ago, clip, needsOfProject, plain, sentences } from './home.js';
import { filterModel, isHosted, shellLayouts, unbuiltLayouts } from './host.js';
import { readHostConfig } from './hosts.js';
import { listSessions, readEntries } from './sessions.js';
import { readSnapshots } from './snapshots.js';
import { changedSinceApproved } from './workspace.js';

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
 * @property {boolean} pushed      pushed for a pull request
 * @property {PullRequest | null} [pullRequest]   its pull request, once pushed
 * @property {{ title: string, stopped: boolean } | null} building
 * @property {string[]} alsoChanges
 * @property {{ running: boolean, approved: boolean, url: string, open: string } | null} running
 * @property {{ from: string, unresolved: string[] } | null} merging
 * @property {string | null} finishError
 * @property {Updated} [updated]   what an update from main just did: given once, with the work's answer
 * @property {Story[]} stories
 *
 * @typedef {object} PullRequest   A pushed branch's pull request (R-t5w).
 * @property {'open' | 'merged'} state   merged once what was pushed is in main, however it got there
 * @property {string} when         when it was pushed, or merged: "3 days ago"
 * @property {number} since        commits made on the branch after it was pushed
 *
 * @typedef {object} Cleanup       What Prelude leaves to the person to tidy (Clean up, R-c3j).
 * @property {string} into         the main branch
 * @property {CleanupItem[]} items
 * @property {Record<string, boolean | string>} removed   what Clean up removed, by id
 *
 * @typedef {object} CleanupItem   A branch, worktree or folder Prelude doesn't tidy by itself.
 * @property {string} id
 * @property {'local' | 'origin'} where
 * @property {'pr-merged' | 'merged' | 'untouched' | 'unlisted' | 'leftover'} kind
 * @property {string} name         the branch, origin/ and all; a leftover's folder name
 * @property {string | null} [design]   the design's title, if known
 * @property {string | null} [path]     its worktree or folder; null for a branch alone
 * @property {string} when         "3 days ago": merged, made, or last committed to
 * @property {{ commits: number, files: string[] }} [since]   a merged pull request's commits since, and their files
 * @property {number} [ahead]      commits not in main
 * @property {number} [uncommitted]  files changed in its worktree and never committed
 * @property {boolean} [working]   the agent is working in it: it can't be picked (R-m2e)
 * @property {boolean} [safe]      all its work is in main, or nothing was done: picked to start with
 *
 * @typedef {object} Updated       What the last update from main brought in (R-u9d).
 * @property {string} from         the main branch's name
 * @property {number} files        how many files came in; none is "nothing new"
 *
 * @typedef {object} Design        A design not on a branch, and how far it's got.
 * @property {string} id
 * @property {string} title
 * @property {DesignKind} kind
 * @property {string | null} area
 * @property {number} [components]   the design system's
 * @property {number} [layouts]      the app shell's
 * @property {number} [layoutsBuilt] the shell's layouts the app has (none before it exists)
 * @property {number} pages          a shell's are its own, not its gallery's
 * @property {number} approved     none while it's changed since it was approved
 * @property {number} built
 * @property {'ready' | 'designing' | 'approved' | 'built'} stage
 * @property {boolean} [changedSinceApproved]  approved, then changed: to approve again before it's built
 * @property {string | null} changed   "yesterday"
 *
 * @typedef {object} App
 * @property {'none' | 'existing' | 'building' | 'on-branch' | 'built'} status
 * @property {string | null} stack
 * @property {string | null} path
 * @property {boolean} existing
 * @property {string | null} branch   the shell's, while the app is on it
 * @property {string | null} url      where to follow or check it
 * @property {Run} run
 *
 * @typedef {object} Run           How the app runs from here, and whether it is (runs.js; R-h2w).
 * @property {string | null} command  null until the app build, or the person, says
 * @property {string | null} url
 * @property {'stopped' | 'starting' | 'running' | 'failed'} state
 * @property {string | null} log      the last of its output, once it failed
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
 * @property {Cleanup} cleanup        none unless the work is read
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

/** How many components a design system has: its system/components/*.html. */
function componentsOf(dir) {
  try { return readdirSync(join(dir, 'system', 'components')).filter(file => file.endsWith('.html')).length; } catch { return 0; }
}

/**
 * A design's pages and how far they've got, as its Build page counts them (a
 * shell's gallery isn't built), and its stage: ready (approved pages not yet
 * built, once the app exists: R-r6b), designing (pages still to approve, or
 * none yet), approved, or built. Approval is the design's, all its pages at
 * once, so `approved` is all of them or none, and none once the design has
 * changed since it was approved (it's designing again). The design system has no pages,
 * so it's counted by its components, and is built once the app exists; the
 * shell's layouts count beside its own pages, built once they're ported
 * (unbuiltLayouts says which aren't).
 */
function progressOf(design, dir, appExists, ext) {
  const pages = isHosted(dir)
    ? backlogOf(dir).groups.filter(group => group.page && !(design.kind === 'shell' && group.page.view.startsWith('gallery/')))
    : [];
  const built = pages.filter(group => group.built).length;
  // A design changed since it was approved isn't approved as it is now.
  const changed = changedSinceApproved(dir);
  const approved = pages.length && readSnapshots(dir)?.size && !changed ? pages.length : 0;
  if (design.kind === 'system') {
    const components = componentsOf(dir);
    const stage = !components ? 'designing' : appExists ? 'built' : 'approved';
    return { components, pages: pages.length, approved, built, stage };
  }
  const shell = design.kind === 'shell' ? { layouts: shellLayouts(dir, ext).length, layoutsBuilt: 0 } : null;
  if (shell && appExists) shell.layoutsBuilt = shell.layouts - unbuiltLayouts(dir, ext).length;
  const total = pages.length + (shell?.layouts ?? 0), done = built + (shell?.layoutsBuilt ?? 0);
  const builds = design.kind === 'design' || design.kind === 'shell';
  const stage = total && done === total ? 'built'
    : builds && appExists && approved > built ? 'ready'
    : !pages.length || approved < pages.length ? 'designing'
    : 'approved';
  return { ...shell, pages: pages.length, approved, built, stage, ...(changed ? { changedSinceApproved: true } : {}) };
}

/**
 * The designs in progress on the project's branches, each as the page shows
 * it. `branchOf(entry, design)` is where the branch stands (main.js's
 * branchState), `storiesOf(entry, design)` its stories; `finishError` is
 * { id, message } when finishing that branch just failed, `updated`
 * { id, from, files } when it was just updated from main. `only` is one
 * branch's worktree id, for a page that shows just that one (Push's modal).
 * @returns {Branch[]}
 */
export function branchesOf(app, folder, { branchOf, storiesOf, finishError = null, updated = null, only = null, now = Date.now() }) {
  if (folder.branch) return [];
  const remote = remoteOf(folder.path);
  const onMain = listDesigns(folder.path);
  return app.branches.of(folder.id).filter(entry => !only || entry.id === only)
    // A fix (step 11) is found as a design, though it isn't listed with them.
    .map(entry => ({ entry, design: listDesigns(entry.path).find(design => design.id === entry.design) ?? onMain.find(design => design.id === entry.design) ?? findDesign(entry.path, entry.design.split('/'))?.design }))
    .filter(({ design }) => design)
    .sort((a, b) => a.design.id.localeCompare(b.design.id))
    .map(({ entry, design }) => {
      const state = branchOf(entry, design);
      // A build under way with no turn running has stopped, as Home says.
      const turning = app.turns.state({ id: entry.id, path: entry.path }, design, null).kind !== 'idle';
      // Open only until what was pushed is in main (R-t5w).
      let pull = null;
      if (entry.published) { try { pull = app.branches.pullRequest(entry, folder.path); } catch { pull = { state: 'open', at: entry.published.at, since: 0 }; } }
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
        pullRequest: pull && { state: pull.state, when: ago(pull.at, now), since: pull.since },
        building: entry.building ? { title: entry.building.title, stopped: !turning } : null,
        alsoChanges: state.alsoChanges ?? [],
        running: state.running ? { running: state.running.running, approved: state.running.approved, url: state.running.url, open: state.running.open } : null,
        merging: state.merging ? { from: state.merging.from, unresolved: state.merging.unresolved } : null,
        finishError: finishError?.id === entry.id ? finishError.message : null,
        ...(updated?.id === entry.id ? { updated: { from: updated.from, files: updated.files } } : {}),
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
 * What Clean up lists (branches.js's leftBehind), each with `working`: a
 * branch Prelude lists whose worktree the agent is in now can't be picked
 * (R-m2e). Empty for a branch's worktree, or a folder that isn't a repository.
 */
export function leftBehindOf(app, folder, { now = Date.now() } = {}) {
  if (folder.branch || gitState(folder.path) !== 'repository') return [];
  let items;
  try { items = app.branches.leftBehind(folder, { now }); } catch { return []; }
  return items.map(item => ({
    ...item,
    working: Boolean(item.entry) && app.turns.state({ id: item.entry, path: item.path }, { id: item.design }, null).kind !== 'idle',
  }));
}

/**
 * Clean up's model (R-c3j, R-9xk): what Prelude leaves to the person, each
 * with its design's title and times as words. `removed` is what Clean up just
 * removed, by id; `gone` the items as they were before, so the notice can say which.
 * @returns {Cleanup}
 */
export function cleanupOf(app, folder, { now = Date.now(), designs = [], removed = {}, gone = null } = {}) {
  const titleOf = (item) => {
    if (!item.design) return null;
    const listed = designs.find(design => design.id === item.design);
    if (listed) return listed.title;
    const entry = item.entry && app.branches.of(folder.id).find(candidate => candidate.id === item.entry);
    return (entry && findDesign(entry.path, item.design.split('/'))?.design?.title) ?? null;
  };
  const items = (gone ?? leftBehindOf(app, folder, { now })).map(item => ({
    // A branch Prelude lists is said by its design, which its line names.
    id: item.id, where: item.where, kind: item.kind, name: item.name, design: titleOf(item) ?? (item.entry ? item.name : null), path: item.path,
    when: item.at ? ago(item.at, now) : 'a while ago',
    ...(item.since ? { since: item.since } : {}),
    ahead: item.ahead, uncommitted: item.uncommitted, working: item.working, safe: item.safe,
  }));
  return { into: folder.branch ? 'main' : mainBranch(folder.path), items, removed };
}

/**
 * The project page's model. `parts` leaves out what a region doesn't show
 * (reading a hundred designs' progress for the work region would be slow):
 * { work: false } has no needs or branches, { designs: false } no designs.
 * `query` is the request's: ?q= and ?stage= filter the designs (R-2hx: a
 * design on a branch is in progress, not among them).
 * @returns {Project}
 */
export function projectOf(app, folder, { branchOf, storiesOf, query = {}, parts = {}, finishError = null, updated = null, appError = null, now = Date.now() }) {
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
    // Run from the project's own folder, so a branch's worktree has none.
    run: folder.branch ? { command: null, url: null, state: 'stopped', log: null } : app.runs.of(folder),
  };

  const ext = readHostConfig(folder.path)?.views ?? '.eta';
  const designs = withDesigns
    ? onMain.filter(design => !entries.some(entry => entry.design === design.id)).map(design => {
      const dir = dirOf(folder.path, design);
      const changed = latest([...listSessions(dir).map(session => session.updatedAt), design.createdAt]);
      return { ...refOf(design), ...progressOf(design, dir, config.built, ext), changed: changed ? ago(changed, now) : null };
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
    inProgress: work ? branchesOf(app, folder, { branchOf, storiesOf, finishError, updated, now }) : [],
    asked: work ? askedOf(app, folder, { now }) : [],
    designs,
    merged: folder.branch ? [] : app.branches.merged(folder.id).slice(0, 5)
      .map(note => ({ id: `${note.branch}@${note.at}`, branch: note.branch, into: note.into, when: ago(note.at, now) })),
    references: app.references.of(folder.id).map(reference => ({ id: referenceId(reference.path), name: reference.name, path: reference.path })),
    // In progress's Clean up… counts it, so it's read with the work.
    cleanup: work ? cleanupOf(app, folder, { now, designs: all }) : { into: 'main', items: [], removed: {} },
  };
  return filterModel(model, DESIGNS_FILTER, query);
}
