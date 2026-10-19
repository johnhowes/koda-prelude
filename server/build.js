// The Build page (prelude/build): what a design changes in the app, page by
// page, and the stories the agent writes for them when someone asks (R-w3n).
//
// A page's changes are Prelude's own plain lines, for people: new pages and
// overlays by title, which screens look different in which states, forms
// counted, new rules and events by their words; never a route pattern. They
// are only what the app as it is now hasn't got (R-7qd, R-c9r): a changed
// page's increment (increment.js), a redesign of a page the app has, or, for
// a page the app hasn't got, the whole page, less what's already built.
// Design-wide rules and events are a page of their own, "Across the design".
//
// Stories are kept in the design, so they're on its branch, reviewed and
// merged with it (R-u6t):
//   stories/<page>/<n>-<slug>.md  one per story, as the agent wrote it or a person edited it
//   stories/<page>/split.md       why the agent split the page's story in two, if it did
//   stories/<page>/story.json     Prelude's: when it was written, and the page's change
//                                 then, so it can say it's out of date, and what changed (R-b5k)

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown } from '@kodalang/core';

import { whenWords } from './workspace.js';

/**
 * @typedef {object} Change      One thing a page changes, in a plain line.
 * @property {'screen' | 'document' | 'rule' | 'run'} icon
 * @property {string} text
 *
 * @typedef {object} OneStory    A story, as the agent wrote it or a person edited it.
 * @property {string} id         its number among the page's stories
 * @property {string} url
 * @property {string} title
 * @property {boolean} edited
 * @property {string} [editedBy] git's user name where it was saved
 * @property {string} [editedAt] "today at 09:14"
 * @property {string} markdown   what's copied
 * @property {string} html       what's shown: For developers folded away
 *
 * @typedef {object} Story       A page's stories.
 * @property {string} written    "today at 10:42"
 * @property {string | null} outOfDate  what changed in the design since it was written
 * @property {string | null} split      why it's in more than one, starting in lower case
 * @property {OneStory[]} stories
 *
 * @typedef {object} BuildGroup  A page still to build.
 * @property {string} id
 * @property {string} key        what Start a build session posts
 * @property {string} title
 * @property {'new' | 'changed' | 'to build'} kind
 * @property {string} url        its stories
 * @property {{ name: string, url: string }} folder
 * @property {{ title: string, url: string }} design
 * @property {boolean} writing   the agent is writing its story
 * @property {string} instruction  what the person asked of the last rewrite
 * @property {Change[]} changes
 * @property {{ title: string, url: string } | null} session  its newest build session
 * @property {Story | null} story
 *
 * @typedef {object} BuildPage   A design's Build page.
 * @property {string} id
 * @property {string} title
 * @property {{ id: string, name: string }} folder  the project
 * @property {string} base
 * @property {string | null} branch
 * @property {{ built: boolean, onBranch: boolean, stack: string, url: string }} app
 *   built: the project has an app; onBranch: this design's branch has it too
 * @property {boolean} approved
 * @property {{ group: string, title: string, session: { title: string, url: string } } | null} building
 * @property {boolean} writing   Write every story is under way
 * @property {string | null} updateUrl  Update from main
 * @property {BuildGroup[]} groups
 * @property {{ title: string }[]} unchanged  built, and not changed by this design
 */

/** The page that holds the design-wide rules and events. */
export const ACROSS = { key: '@across', slug: 'across', title: 'Across the design' };

const listOf = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '');
const lowerFirst = text => text.replace(/^./, c => c.toLowerCase());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const REGIONS = { modal: 'a dialog', drawer: 'a drawer', notice: 'a notice' };

/** A POST route is built once every view it names is the app's own (as backlog.js counts it). */
const postBuilt = post => [post.form, post.answer.view, ...post.answer.also.map(also => also.view)]
  .filter(Boolean)
  .every(view => view.startsWith('@app/'));

const rule = (word, item) => ({ icon: 'rule', text: `${word} rule ${item.id}: ${item.text}` });
const event = (word, item) => ({ icon: 'run', text: `${word}: when ${lowerFirst(item.title)}` });

/** "1 new form, 1 changed", "2 changed forms". */
function forms(added, changed, gone) {
  const parts = [];
  if (added) parts.push(plural(added, 'new form'));
  if (changed) parts.push(parts.length ? `${changed} changed` : plural(changed, 'changed form'));
  if (gone) parts.push(parts.length ? `${gone} gone` : `${plural(gone, 'form')} gone`);
  return parts.length ? [{ icon: 'document', text: parts.join(', ') }] : [];
}

/**
 * A page's changes. `change` is increment.js's for it when the app has the
 * page as main has it (only the change); without one, the page is described
 * whole, less what's built. A page redesigned from the app's own (`from`)
 * with nothing on main to compare with looks different in every state.
 * `titles` names routes by pattern, `stateTitle` states by id.
 * @returns {Change[]}
 */
export function changesOf({ group, change = null, states = [], titles = new Map(), stateTitle = id => id }) {
  const over = route => `New: ${route.title}, in ${REGIONS[route.in] ?? `the ${route.in}`} over ${titles.get(route.over) ?? 'its page'}`;
  const lines = [];
  if (!change) {
    for (const route of group.routes) {
      if (route.ported || !route.title) continue;
      if (route === group.page && route.from) lines.push({ icon: 'screen', text: `${route.title} looks different in ${states.length ? listOf(states.map(state => state.title)) : 'every state'}` });
      else if (route === group.page) lines.push({ icon: 'screen', text: `New page: ${route.title}` });
      else if (route.over) lines.push({ icon: 'screen', text: over(route) });
    }
    lines.push(...forms(group.posts.filter(post => !postBuilt(post)).length, 0, 0));
    lines.push(...group.rules.filter(item => item.proposed).map(item => rule('New', item)));
    lines.push(...(group.events ?? []).map(item => event('New', item)));
    return lines;
  }
  for (const route of change.newRoutes) {
    if (!route.title) continue;
    lines.push({ icon: 'screen', text: route.over ? over(route) : `New page: ${route.title}` });
  }
  // A refused form's screen is its form's change, counted below.
  const screens = change.screens.filter(screen => !screen.page.startsWith('POST '));
  for (const screen of screens) lines.push({ icon: 'screen', text: `${screen.page} looks different in ${listOf(screen.states.map(stateTitle))}` });
  for (const { route, what } of change.changedRoutes) {
    const label = route.title ?? null;
    if (label && !screens.some(screen => screen.page === label) && what.some(item => /view/.test(item))) lines.push({ icon: 'screen', text: `${label} looks different` });
    if (what.some(item => /search and filters/.test(item))) lines.push({ icon: 'document', text: `${label ?? 'A list'} can be searched and filtered in new ways` });
  }
  for (const route of change.removedRoutes) if (route.title) lines.push({ icon: 'screen', text: `${route.title} is gone` });
  lines.push(...forms(change.newPosts.length, change.changedPosts.length, change.removedPosts.length));
  // Only rules the app hasn't got: a rule that isn't proposed is built (R-c9r).
  lines.push(...change.rules.added.filter(item => item.proposed).map(item => rule('New', item)));
  lines.push(...change.rules.reworded.filter(item => item.proposed).map(item => rule('Reworded', item)));
  lines.push(...change.rules.retired.map(item => rule('Retired', item)));
  lines.push(...change.events.added.map(item => event('New', item)));
  lines.push(...change.events.changed.map(({ event: item }) => event('Changed', item)));
  lines.push(...change.events.removed.map(item => event('No longer', item)));
  return lines;
}

/**
 * Across the design's changes: the design-wide rules the app hasn't got, and
 * the server events no page claims. `wide` is increment.js's designWide, when
 * there's a branch to compare; else `rules` and `events` whole.
 * @returns {Change[]}
 */
export function acrossChanges({ wide = null, rules = [], events = [] }) {
  if (!wide) return [...rules.filter(item => item.proposed).map(item => rule('New', item)), ...events.map(item => event('New', item))];
  const said = new Set([...wide.rules.added, ...wide.rules.reworded].map(item => item.id));
  return [
    ...wide.rules.added.filter(item => item.proposed).map(item => rule('New', item)),
    ...wide.rules.reworded.filter(item => item.proposed).map(item => rule('Reworded', item)),
    ...wide.rules.retired.map(item => rule('Retired', item)),
    // A design-wide rule from main, still proposed, isn't built either.
    ...wide.all.filter(item => item.proposed && !said.has(item.id)).map(item => rule('New', item)),
    ...wide.events.added.map(item => event('New', item)),
    ...wide.events.changed.map(({ event: item }) => event('Changed', item)),
    ...wide.events.removed.map(item => event('No longer', item)),
  ];
}

/**
 * What a page's story is written from, as one short hash: its routes, forms,
 * rules and events, its views as they are, and its changes. A story written
 * from another is out of date (R-b5k).
 */
export function fingerprintOf({ dir, group, changes, ext = '.eta' }) {
  const text = view => {
    if (!view || view.startsWith('@app/')) return null;
    try { return readFileSync(join(dir, 'views', ...`${view}${ext}`.split('/')), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
  };
  // A view's own partials (include('./_row')) are part of it.
  const withPartials = view => {
    const own = text(view);
    if (own == null) return [];
    const folder = view.split('/').slice(0, -1).join('/');
    const partials = [...own.matchAll(/include\(\s*['"]\.\/([\w-]+)['"]/g)].map(match => text(folder ? `${folder}/${match[1]}` : match[1]));
    return [own, ...partials];
  };
  const views = [...group.routes.map(route => route.view), ...group.posts.flatMap(post => [post.form, post.answer.view])].filter(Boolean);
  const parts = {
    routes: group.routes.map(route => [route.pattern, route.view, route.data, route.title, route.over, route.in, route.from]),
    posts: group.posts.map(post => [post.pattern, post.verb, post.at, post.require, post.form, post.answer]),
    rules: group.rules.map(item => [item.id, item.text, item.proposed]),
    events: (group.events ?? []).map(item => [item.name, item.title, item.verb, item.at, item.send, item.push]),
    views: [...new Set(views)].flatMap(withPartials),
    changes: changes.map(line => line.text),
  };
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

const json = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const storiesDir = (dir, id) => join(dir, 'stories', id);
const storyFiles = at => {
  try { return readdirSync(at).filter(file => /^\d+-.*\.md$/i.test(file)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); } catch { return []; }
};

/** A story as the page shows it: its title left out (it's beside it), For developers folded away. */
export function storyHtml(markdown) {
  const body = String(markdown).replace(/\r\n/g, '\n').replace(/^\s*# .*\n+/, '').replace(/^## /gm, '### ');
  const fold = body.match(/^### For developers[ \t]*$/m);
  if (!fold) return renderMarkdown(body).html;
  const before = body.slice(0, fold.index);
  const after = body.slice(fold.index + fold[0].length);
  return `${renderMarkdown(before).html}<details class="disclosure"><summary>For developers</summary>${renderMarkdown(after).html}</details>`;
}

/** What changed since a story was written, from the page's changes then and now. */
function sinceOf(then, now) {
  const added = now.filter(text => !then.includes(text));
  const gone = then.filter(text => !now.includes(text));
  const parts = [...added, ...gone.map(text => `no longer: ${lowerFirst(text)}`)];
  return parts.length ? `Since then: ${parts.join('; ')}.` : 'Since then, the design of this page changed.';
}

/**
 * A page's stories, or null when none has been written (R-w3n). `url` is the
 * page's stories' address; `fingerprint` and `changes` are the page's now.
 * @returns {Story | null}
 */
export function readStory(dir, id, { url, fingerprint, changes }) {
  const at = storiesDir(dir, id);
  const files = storyFiles(at);
  if (!files.length) return null;
  const meta = json(join(at, 'story.json')) ?? {};
  const stories = files.map(file => {
    const number = file.match(/^\d+/)[0];
    const markdown = readFileSync(join(at, file), 'utf8').replace(/\r\n/g, '\n');
    const edited = meta.edited?.[number] ?? null;
    return {
      id: number,
      url: `${url}/story/${number}`,
      title: markdown.match(/^\s*# (.+)$/m)?.[1].trim() ?? file.replace(/^\d+-|\.md$/gi, '').replace(/-/g, ' '),
      edited: Boolean(edited),
      ...(edited ? { editedBy: edited.by ?? '', editedAt: whenWords(edited.at) ?? '' } : {}),
      markdown,
      html: storyHtml(markdown),
    };
  });
  let split = null;
  try { split = readFileSync(join(at, 'split.md'), 'utf8').trim().replace(/^split in (two|\w+):\s*/i, '') || null; } catch { /* one story */ }
  if (split) split = lowerFirst(split);
  let writtenAt = meta.writtenAt;
  if (!writtenAt) { try { writtenAt = statSync(join(at, files[0])).mtime.toISOString(); } catch { writtenAt = null; } }
  return {
    written: whenWords(writtenAt) ?? 'a while ago',
    outOfDate: meta.fingerprint && meta.fingerprint !== fingerprint ? sinceOf(meta.changes ?? [], changes.map(line => line.text)) : null,
    split: stories.length > 1 ? split : null,
    stories,
  };
}

/**
 * The agent writing pages' stories, one at a time per design, each its own
 * run of the agent, only when someone asks (R-w3n).
 *   write({ dir, cwd, designPath, references, jobs: [{ id, title, systemPrompt, fingerprint, changes }], all, onWritten })
 *   writing(dir, id)   whether a page's story is being written, or waits to be
 *   writingAll(dir)    whether Write every story is under way
 * onWritten(job) is called once each is written (or the agent gave up).
 */
export function createStoryWriter({ runner }) {
  const queues = new Map();   // design dir -> { jobs, current, all }

  const writing = (dir, id) => {
    const queue = queues.get(dir);
    return Boolean(queue && (queue.current?.id === id || queue.jobs.some(job => job.id === id)));
  };

  function next(dir) {
    const queue = queues.get(dir);
    const job = queue?.jobs.shift();
    if (!job) { queues.delete(dir); return; }
    queue.current = job;
    const at = storiesDir(dir, job.id);
    const writtenAt = new Date().toISOString();
    let turn;
    try {
      mkdirSync(at, { recursive: true });
      turn = runner.turn({
        cwd: job.cwd, sessionId: randomUUID(), resume: false,
        prompt: `Write the story for ${job.title}.`, systemPrompt: job.systemPrompt,
        designPath: job.designPath, references: job.references, mode: 'design', onEvent: () => {},
      });
    } catch (error) {
      turn = { done: Promise.resolve({ ok: false, error: String(error?.message ?? error) }) };
    }
    Promise.resolve(turn.done).catch(error => ({ ok: false, error: String(error?.message ?? error) })).then(result => {
      if (storyFiles(at).length) {
        writeFileSync(join(at, 'story.json'), JSON.stringify({ writtenAt, fingerprint: job.fingerprint, changes: job.changes.map(line => line.text), edited: {} }, null, 2) + '\n');
      } else {
        console.error(`The agent didn’t write the story for ${job.title}${result?.error ? `: ${result.error}` : '.'}`);
      }
      queue.current = null;
      try { job.onWritten?.(job); } catch (error) { console.error(error); }
      if (!queue.jobs.length) queue.all = false;
      next(dir);
    });
  }

  return {
    writing,
    writingAll: dir => Boolean(queues.get(dir)?.all),
    write({ dir, cwd, designPath, references = [], jobs, all = false, onWritten }) {
      let queue = queues.get(dir);
      if (!queue) { queue = { jobs: [], current: null, all: false }; queues.set(dir, queue); }
      const fresh = jobs.filter(job => !writing(dir, job.id));
      queue.jobs.push(...fresh.map(job => ({ ...job, cwd, designPath, references, onWritten })));
      if (all && (fresh.length || queue.current)) queue.all = true;
      if (!queue.current) next(dir);
    },
  };
}

/** Whether a page has a story written, without reading it. */
export const hasStory = (dir, id) => existsSync(storiesDir(dir, id)) && storyFiles(storiesDir(dir, id)).length > 0;
