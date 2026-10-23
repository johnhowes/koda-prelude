// A project's plans as their pages show them (prelude/coordinator): each
// plan from its file (plans.js), on its own branch while it's drafted and in
// main once started, and each step where it stands. That's worked out, not
// stored (NOTES.md, decision 4): from the step's branch, here or pushed by
// someone else, what main has, the design's approvals and the turn running.

import { join } from 'node:path';

import { visualsArchitecture } from './architecture.js';
import { backlogOf } from './backlog.js';
import { PRELUDE_DIR, findDesign } from './designs.js';
import { PLANS_DIR, listPlans, planDir, readPlan } from './plans.js';
import { branchTip, gitIdentity, gitState, isIn, landedAfter, mainTip, remoteOf } from './branches.js';
import { listSessions, readEntries } from './sessions.js';
import { readSnapshots } from './snapshots.js';
import { presentEntry } from './views.js';
import { changedSinceApproved, startedWords, whenWords } from './workspace.js';

/**
 * @typedef {import('./plans.js').PlanWait} PlanWait
 * @typedef {import('./plans.js').PlanRef} PlanRef
 *
 * @typedef {'planned' | 'waiting' | 'open' | 'handed' | 'elsewhere' | 'working' | 'asking' | 'ready' | 'approved' | 'pushed' | 'stopped' | 'merged'} StepState
 *
 * @typedef {object} PlanStep      A step, where it stands.
 * @property {string} id
 * @property {string} title
 * @property {'discussion' | 'design' | 'build' | 'fix'} kind
 * @property {string} url          the step, in the drawer over its plan
 * @property {string} branch
 * @property {string} [session]    its session, once it started here
 * @property {string} [owner]      "Name <email>"; none: open to anyone
 * @property {PlanWait[]} waitsFor
 * @property {string} doneWhen
 * @property {'push' | 'merge'} finish
 * @property {StepState} state
 * @property {string} [says]       where it stands, in a sentence
 * @property {string} [started]    when, in words
 * @property {string} prompt
 * @property {PlanRef[]} refs
 * @property {{ prompt?: string }} [$errors]   A step's prompt, as refused (R-m3k)
 *
 * @typedef {object} PlanPiece     A piece of the agent's message: words, or a visual (views.js).
 * @property {'text' | 'flow' | 'map' | 'drawing' | 'unread'} kind
 * @property {string} [html]
 * @property {object} [flow]
 * @property {object} [map]
 *
 * @typedef {object} PlanEntry     An entry in the plan's session.
 * @property {'user' | 'tool' | 'text' | 'note' | 'parts'} type
 * @property {string} [message]
 * @property {string} [name]
 * @property {string} [summary]
 * @property {string} [html]
 * @property {PlanPiece[]} [pieces]
 * @property {string} [says]
 * @property {string} [when]
 * @property {boolean} [failed]
 * @property {object} [map]        parts: the parts a merged step changed, on the map (R-u3t)
 *
 * @typedef {object} PlanRemote
 * @property {string} name
 * @property {string} host
 *
 * @typedef {object} Plan
 * @property {string} id
 * @property {string} title
 * @property {{ id: string, name: string }} project
 * @property {string} me           who's at this computer, "Name <email>"
 * @property {'planning' | 'running' | 'paused' | 'done'} status
 * @property {PlanRemote | null} remote
 * @property {boolean} mergeAlone
 * @property {string} created      in words
 * @property {string} [finished]   in words
 * @property {string} [session]    the plan's own session
 * @property {string} branch
 * @property {string} goal
 * @property {string} brief
 * @property {{ state: 'idle' | 'working', entries: PlanEntry[] }} chat
 * @property {PlanStep[]} steps
 * @property {string} [to]         where the message box posts, as refused
 * @property {{ message?: string, brief?: string }} [$errors]   a message or the brief, as refused
 *
 * @typedef {object} ProjectPlans  Plans' model: the project, with its plans, oldest first.
 * @property {string} id
 * @property {string} name
 * @property {string} path
 * @property {PlanRemote | null} remote
 * @property {Plan[]} plans
 *
 * @typedef {ProjectPlans & { title?: string, goal?: string, $errors?: { goal?: string } }} NewPlan
 *   New plan's model: the project, and the fields as refused.
 */

const HOSTS = { github: 'GitHub', azure: 'Azure DevOps', other: 'its Git server' };

/** States a step is in once it has started, here or elsewhere: the notice says when one gets there. */
const STARTED = new Set(['elsewhere', 'working', 'asking', 'ready', 'approved', 'pushed', 'stopped']);
export const hasStarted = state => STARTED.has(state);

/** "Today 12:31", "Yesterday 15:40", "23 Oct 12:31". */
const momentWords = iso => (iso ? startedWords(iso).replace(', ', ' ') : '');

/** Whether two git identities are one person: by email, else as written. */
const emailOf = identity => identity?.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? null;
export const samePerson = (a, b) => Boolean(a && b) && (emailOf(a) && emailOf(b) ? emailOf(a) === emailOf(b) : a === b);
export const firstName = identity => String(identity ?? '').split(' <')[0].split(' ')[0];

/** The design a step works in: prelude/<design> is its branch. */
export const designOf = step => String(step.branch ?? '').replace(/^prelude\//, '');

/** Whether a design's screens are approved, and it hasn't changed since (R-a5r). */
function approvedAsItIs(designDir) {
  const snapshots = readSnapshots(designDir);
  return Boolean(snapshots?.size) && !changedSinceApproved(designDir);
}

/**
 * Each step of a plan where it stands, in the plan's order. A step that
 * hasn't started starts once every step it waits for is merged (or approved,
 * for a design on its own branch: R-k4d), with these held back:
 *   - every step, while the plan is paused; one already working carries on (R-c7n)
 *   - a build, until its design's screens are approved as they are now (R-a5r)
 * A step held back says why. Merged means in the main line, the remote's once
 * fetched: by the branch's tip (with work of its own), or (the branch tidied
 * away) by what landed under its design since it could start. A step that
 * stops, or isn't finished, holds back only the steps that wait for it
 * (R-v2j). One of this person's that's ready has `start`: it starts here, and
 * only here (R-s6t), which the server does.
 */
function workedSteps(app, folder, plan, { me, repo }) {
  const byId = new Map(plan.steps.map(step => [step.id, step]));
  const main = repo ? mainTip(repo) : null;
  const planStart = Date.parse(plan.startedAt ?? '') || 0;
  /** @type {Map<string, { state: StepState, says?: string, mergedAt?: number, start?: boolean }>} */
  const worked = new Map();

  const work = (step, seen = new Set()) => {
    if (worked.has(step.id)) return worked.get(step.id);
    if (seen.has(step.id)) return { state: 'waiting' };   // a loop never starts
    seen.add(step.id);
    const result = workOut(step, seen);
    worked.set(step.id, result);
    return result;
  };

  const workOut = (step, seen) => {
    if (plan.status === 'planning') return { state: 'planned' };
    const waits = step.waitsFor.map(wait => ({ wait, of: byId.get(wait.id) ? work(byId.get(wait.id), seen) : null }));
    const met = ({ wait, of }) => of?.state === 'merged' || (wait.until === 'approved' && of?.state === 'approved');
    const waiting = waits.filter(one => !met(one));
    // When it could start: the plan started, and what it waits for merged.
    const readyAt = Math.max(planStart, ...waits.filter(({ wait }) => wait.until !== 'approved').map(({ of }) => of?.mergedAt ?? 0));
    const designId = designOf(step);
    const entry = app.branches.forDesign(folder.id, designId);
    const tip = repo ? branchTip(repo, step.branch) : null;
    // A branch just made from main, with nothing of its own yet, isn't merged work.
    const ownWork = tip && !(entry && tip.local && tip.sha === entry.base);

    if (repo && main && planStart && !waiting.length) {
      if (ownWork && tip.at > readyAt && isIn(repo, tip.sha, main)) return { state: 'merged', mergedAt: tip.at, says: 'Merged into main.' };
      const landed = !tip ? landedAfter(repo, `${PRELUDE_DIR}/${designId}`, readyAt) : null;
      if (landed) return { state: 'merged', mergedAt: landed, says: 'Merged into main.' };
    }

    // Started here, by the plan: its branch's worktree, and its turn.
    if (entry && step.started) {
      const dir = join(entry.path, PRELUDE_DIR, ...designId.split('/'));
      const design = findDesign(entry.path, designId.split('/'))?.design;
      if (entry.published) {
        let pull = null;
        try { pull = app.branches.pullRequest(entry, folder.path); } catch { /* open, as far as anyone knows */ }
        if (pull?.state !== 'merged') return { state: 'pushed', says: 'Pushed for a pull request. The plan goes on once it’s merged.' };
      }
      if (step.kind === 'design' && approvedAsItIs(dir)) {
        // Its build carries on on this branch: approved is done (R-k4d).
        const shared = plan.steps.some(other => other.waitsFor.some(wait => wait.id === step.id && wait.until === 'approved'));
        return shared ? { state: 'approved', says: 'Approved. Its build carries on on this branch.' } : { state: 'ready', says: 'Its screens are approved: ready to finish.' };
      }
      if (design && app.turns.state({ id: entry.id, path: entry.path }, design, null).kind !== 'idle') return { state: 'working' };
      if (entry.building) return { state: 'stopped', says: 'Its build stopped. Send it a message in the build to carry on.' };
      // A build covers its design's every page, one at a time: done once each is built.
      if (step.kind === 'build') {
        const groups = backlogOf(dir).groups;
        if (groups.length && groups.every(group => group.built)) return { state: 'ready', says: 'Every page is built and checked: ready to finish.' };
      }
      return { state: 'asking' };
    }
    // Started on someone else's computer: their branch is pushed (R-r3z).
    if (tip && !tip.local && tip.at > planStart) {
      return { state: 'elsewhere', says: `${samePerson(step.owner, me) ? 'You are' : `${firstName(step.owner) || 'Someone'} is`} working on it on another computer: its branch is pushed.` };
    }

    if (waiting.length) return { state: 'waiting' };
    // Held back (R-c7n): nothing new starts while the plan is paused.
    if (plan.status === 'paused') return { state: 'waiting', says: 'The plan is paused: it starts once you carry on.' };
    // Held back (R-a5r): a build starts only from approved screens.
    if (step.kind === 'build') {
      const designEntry = app.branches.forDesign(folder.id, designId);
      const dir = join(designEntry?.path ?? folder.path, PRELUDE_DIR, ...designId.split('/'));
      if (!approvedAsItIs(dir)) return { state: 'waiting', says: 'Its design changed since its screens were approved: it starts once they’re approved again.' };
    }
    if (!step.owner) return { state: 'open' };
    if (!samePerson(step.owner, me)) return { state: 'handed', says: `Ready. It starts when ${firstName(step.owner)} next opens Prelude; it’s in their Needs you.` };
    // Ours, and ready: it starts here now (R-s6t). Until it has, it's waiting.
    return { state: 'waiting', says: 'Starting here: what it waits for is done.', start: true };
  };

  return plan.steps.map(step => ({ step, ...work(step) }));
}

/** A step as its pages show it (PlanStep). */
export function stepModel(folder, plan, step, { state, says }) {
  return {
    id: step.id,
    title: step.title,
    kind: step.kind,
    url: `/f/${folder.id}/plans/${plan.id}/steps/${step.id}`,
    branch: step.branch,
    ...(step.session ? { session: step.session } : {}),
    ...(step.owner ? { owner: step.owner } : {}),
    waitsFor: step.waitsFor,
    doneWhen: step.doneWhen ?? '',
    finish: step.finish === 'merge' ? 'merge' : 'push',
    state,
    ...(says ? { says } : {}),
    ...(step.started ? { started: momentWords(step.started) } : {}),
    prompt: step.prompt ?? '',
    refs: step.refs,
  };
}

/**
 * An entry of the plan's session as its transcript shows it: the person's
 * words, the agent's (with the visuals it drew, R-w5c), what it read, and
 * Prelude's notes as the plan runs (R-d6m), the parts a merged step changed
 * on the map among them (R-u3t). Results, checks and turns that ended well
 * show nothing. `architecture` gives what visuals are drawn with.
 */
function planEntry(entry, architecture) {
  const when = momentWords(entry.at);
  const at = when ? { when } : {};
  if (entry.type === 'user') return [{ type: 'user', message: String(entry.text ?? '') }];
  if (entry.type === 'text') {
    const shown = presentEntry(entry, { architecture: architecture() });
    return [{ type: 'text', html: shown.html, pieces: shown.pieces }];
  }
  if (entry.type === 'tool') return [{ type: 'tool', name: entry.name, summary: entry.summary ?? '' }];
  if (entry.type === 'note') return [{ type: 'note', says: String(entry.text ?? ''), ...at, ...(entry.failed ? { failed: true } : {}) }];
  if (entry.type === 'parts') {
    const shown = presentEntry(entry, { architecture: architecture() });
    return shown.type === 'parts' ? [{ type: 'parts', says: String(entry.says ?? ''), ...at, map: shown.map }] : [{ type: 'note', says: String(entry.says ?? shown.text), ...at }];
  }
  if (entry.type === 'turn' && !entry.ok && !entry.stopped) return [{ type: 'note', says: entry.error ?? 'The agent stopped with an error.', ...at, failed: true }];
  return [];
}

/**
 * The plan's session, where the person and the agent shape it (NOTES.md,
 * decision 7): the first in the plan's sessions/, read where the plan is
 * kept on this computer (`home`: its branch's worktree, or the project).
 */
export const planSessionOf = dir => listSessions(dir).at(-1) ?? null;

/** The plan's session as the turns know it: a design of its own, prelude/plans/<id>. */
export const planDesign = plan => ({ id: `${PLANS_DIR}/${plan.id}`, title: plan.title || 'A new plan', kind: 'plan' });

/**
 * A project's plans as they are kept on this computer, each step where it
 * stands: those in main, and those on their own branches, the branch's copy
 * over main's. Each is { plan (its file), home (the folder its file and
 * session are in here), entry (its branch, if it has one here), branch,
 * worked: [{ step (as drafted), state, says, start }] }, oldest first.
 */
export function planRuns(app, folder) {
  const repo = gitState(folder.path) === 'repository' ? folder.path : null;
  const me = gitIdentity(folder.path);
  const plans = new Map(listPlans(folder.path).map(plan => [plan.id, { plan, home: folder, entry: null, branch: `prelude/plan-${plan.id}` }]));
  if (!folder.branch) {
    for (const entry of app.branches.of(folder.id).filter(candidate => candidate.design.startsWith(`${PLANS_DIR}/`))) {
      const plan = readPlan(entry.path, entry.design.slice(PLANS_DIR.length + 1));
      if (plan) plans.set(plan.id, { plan, home: { id: entry.id, path: entry.path, branch: entry }, entry, branch: entry.branch });
    }
  }
  return [...plans.values()]
    .sort((a, b) => String(a.plan.createdAt).localeCompare(String(b.plan.createdAt)))
    .map(run => ({ ...run, me, repo, worked: workedSteps(app, folder, run.plan, { me, repo }) }));
}

/**
 * A project's plans, each where it stands (planRuns), as the pages show
 * them: the model of Plans, and of a plan's page.
 * @returns {ProjectPlans}
 */
export function plansOf(app, folder) {
  const project = { id: folder.id, name: folder.branch?.parentName ?? folder.name };
  const found = gitState(folder.path) === 'repository' && remoteOf(folder.path);
  const remote = found ? { name: 'origin', host: HOSTS[found.host] ?? HOSTS.other } : null;
  // Visuals are drawn with the project's architecture, read once, and only if a message has one.
  let drawnWith;
  const architecture = () => (drawnWith ??= visualsArchitecture(app, folder));
  return {
    ...project,
    path: folder.path,
    remote,
    plans: planRuns(app, folder).map(({ plan, home, branch, me, worked }) => {
      const dir = planDir(home.path, plan.id);
      const session = planSessionOf(dir);
      return {
        id: plan.id,
        title: plan.title,
        project,
        me,
        status: plan.status,
        remote,
        mergeAlone: plan.mergeAlone,
        created: momentWords(plan.createdAt),
        ...(plan.finishedAt ? { finished: whenWords(plan.finishedAt) ?? '' } : {}),
        branch,
        goal: plan.goal,
        brief: plan.brief,
        chat: {
          state: app.turns.busy(home, planDesign(plan)) ? 'working' : 'idle',
          entries: session ? readEntries(dir, session.id).flatMap(entry => planEntry(entry, architecture)) : [],
        },
        steps: worked.map(({ step, state, says }) => stepModel(folder, plan, step, { state, says })),
      };
    }),
  };
}
