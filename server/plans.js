// A project's plans (prelude/coordinator): one change carried through
// several designs, builds and the architecture, in order. A plan is a folder
// of its own, prelude/plans/<id>/, holding plan.json: what the person asked
// for, the brief, and its steps as the agent drafted them. Where a step
// stands isn't kept here: it's worked out from git, approvals and sessions,
// as the backlog is (plans-page.js). A plan is drafted on a branch of its
// own, prelude/plan-<id> (R-q2x), written only by the plan's session.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLANS_DIR = 'plans';
const FILE = 'plan.json';

/**
 * @typedef {object} PlanWait     A step another waits for.
 * @property {string} id
 * @property {string} title
 * @property {'approved'} [until]  approved is enough: its own design, on the same branch (R-k4d)
 *
 * @typedef {object} PlanRef      What a prompt asks for from an earlier step, by description.
 * @property {string} asks
 * @property {string} from         the step's title
 * @property {string} [named]      what it became, once the step has started (R-f8d)
 *
 * @typedef {object} PlanStepFile A step as drafted.
 * @property {string} id
 * @property {string} title
 * @property {'discussion' | 'design' | 'build' | 'fix'} kind
 * @property {string} branch       prelude/<design>: the design it's in, and the branch it's worked on
 * @property {string} [owner]      a git identity, "Name <email>"; none: open to anyone (R-b8y)
 * @property {PlanWait[]} waitsFor
 * @property {string} doneWhen
 * @property {'push' | 'merge'} finish
 * @property {string} prompt
 * @property {PlanRef[]} refs
 * @property {string} [started]    when it started here (ISO)
 * @property {string} [session]    its session's address, once started here
 *
 * @typedef {object} PlanFile     prelude/plans/<id>/plan.json, and its id.
 * @property {string} id
 * @property {string} title        '' until the agent names it from the goal
 * @property {string} goal         what the person asked for, in their words
 * @property {string} brief        the brief every step's first message starts with
 * @property {'planning' | 'running' | 'paused' | 'done'} status
 * @property {boolean} mergeAlone  whether the plan may merge a finished step by itself, with no remote (R-p4h)
 * @property {string} createdAt    ISO
 * @property {string | null} startedAt   when the person started it (ISO)
 * @property {string | null} finishedAt
 * @property {PlanStepFile[]} steps
 */

const STATUSES = ['planning', 'running', 'paused', 'done'];

const slugOf = text => String(text ?? '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');

/** The id a new plan would get: its title's slug, or the goal's first words'. */
export function planIdOf({ title, goal }) {
  return slugOf(String(title ?? '').trim()) || slugOf(String(goal ?? '').trim().split(/\s+/).slice(0, 6).join(' ')) || 'plan';
}

/** A plan's folder in a folder (a project, or its plan's worktree). */
export const planDir = (folderPath, id) => join(folderPath, 'prelude', PLANS_DIR, id);

/** A plan as its file has it, with what a file left out filled in; null when there's none, or it can't be read. */
export function readPlan(folderPath, id) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(planDir(folderPath, id), FILE), 'utf8')); } catch { return null; }
  return {
    id,
    title: typeof raw.title === 'string' ? raw.title : '',
    goal: String(raw.goal ?? ''),
    brief: String(raw.brief ?? ''),
    status: STATUSES.includes(raw.status) ? raw.status : 'planning',
    mergeAlone: raw.mergeAlone === true,
    createdAt: raw.createdAt ?? null,
    startedAt: raw.startedAt ?? null,
    finishedAt: raw.finishedAt ?? null,
    steps: Array.isArray(raw.steps) ? raw.steps.map(step => ({ ...step, waitsFor: step.waitsFor ?? [], refs: step.refs ?? [] })) : [],
  };
}

/** Every plan in a folder, oldest first. */
export function listPlans(folderPath) {
  let entries;
  try { entries = readdirSync(join(folderPath, 'prelude', PLANS_DIR), { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isDirectory()).map(entry => readPlan(folderPath, entry.name)).filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Write a new plan: what should change, and its title if the person gave
 * one; its steps are drafted after, on its page. { plan } or
 * { errors: { field: message } }. A goal is required (routes.json).
 */
export function createPlan(folderPath, { id, title, goal, mergeAlone = false }) {
  if (!String(goal ?? '').trim()) return { errors: { goal: 'Say what should change, so the agent can draft the steps.' } };
  const dir = planDir(folderPath, id);
  if (existsSync(dir)) return { errors: { title: `prelude/${PLANS_DIR}/${id} already exists.` } };
  const plan = {
    title: String(title ?? '').trim(),
    goal: String(goal).trim(),
    brief: '',
    status: 'planning',
    mergeAlone: mergeAlone === true,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    steps: [],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILE), JSON.stringify(plan, null, 2) + '\n');
  return { plan: { id, ...plan } };
}
