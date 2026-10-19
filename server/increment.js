// The increment (plan: step 10): what a design's branch changes, compared with
// the same design on the main branch where the branch left it - derived each
// time, never stored.
//
// Per group (backlog.js), it says whether the group is new (not on main at
// all), changed, or unchanged, and for a changed group only what differs:
// routes and forms added, changed or removed; views changed; the shape of
// their data; which pages' approved screens changed, in which states; rules
// new, reworded or retired; and the states the change shows up in. A story
// (backlog.js) and a build session's instructions (agent.js) are made from it,
// so neither restates the existing page.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { backlogOf } from './backlog.js';
import { filesAt, textAt } from './branches.js';
import { parseEvents } from './events.js';
import { listStates, lookup, parsePostRoutes, parseRoutes, readPostRoutes, readRoutes, samplePaths } from './host.js';
import { parseRules, readRules } from './rules.js';
import { readSnapshots, snapshotName } from './snapshots.js';

const json = text => { try { return JSON.parse(text); } catch { return null; } };

/** What a route is, for comparing: everything but its pattern. */
const routeShape = route => JSON.stringify([route.view, route.data, route.title, route.over, route.in, route.list, route.search, route.match]);
const postShape = post => JSON.stringify([post.verb, post.at, post.require, post.form, post.answer]);

/** A value's fields, as paths: "borrower.name", "notes[].body". */
function shapeOf(value, prefix = '', into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) shapeOf(item, `${prefix}[]`, into);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key.startsWith('$')) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      into.add(path);
      shapeOf(inner, path, into);
    }
  }
  return into;
}

/** The fields a route's data has, across every state. */
function dataShape(route, routes, states) {
  const shape = new Set();
  for (const dataset of states.values()) {
    const sample = samplePaths([route], dataset)[0];
    if (sample) shapeOf(lookup(dataset, route.data, sample.params), '', shape);
    else if (!route.data.includes(':')) shapeOf(lookup(dataset, route.data, {}), '', shape);
  }
  return shape;
}

/** The snapshot names a route's pages are kept under, per state id: Map(state -> [name]). */
function screenNames(route, states, post = false) {
  const names = new Map();
  for (const [stateId, dataset] of states) {
    const sample = samplePaths([route], dataset)[0];
    if (sample) names.set(stateId, [snapshotName(sample.path, { post })]);
  }
  return names;
}

/** The longest-prefix page key for a URL, among the groups: as backlog.js groups. */
function groupKeyFor(pattern, keys) {
  return keys.filter(key => key && (pattern === key || pattern.startsWith(key === '/' ? '/' : `${key}/`))).sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * A design's increment against a baseline commit (null: no baseline, so
 * everything is new). `designDir` is the design on its branch, `repo` the
 * repository, `ext` the views' extension.
 * { designNew, groups: Map(key -> change), removedGroups: [title], designWide: { rules } }
 * where change = { status: 'new' | 'changed' | 'unchanged', summary, newRoutes,
 * changedRoutes: [{ route, what: [text] }], removedRoutes, newPosts,
 * changedPosts, removedPosts, shape: [{ pattern, gained, lost }],
 * screens: [{ page, states }], rules: { added, reworded, retired },
 * events: { added, changed: [{ event, what }], removed }, states, statesNew,
 * builtBefore: the page was the app's own on main }.
 * designWide also has { events }: the design-wide events, compared the same way.
 */
export function incrementOf({ repo, base, designId, designDir, ext = '.eta' }) {
  const prefix = `prelude/${designId}/`;
  const baseFiles = base ? filesAt(repo, base, prefix) : new Map();
  const at = rel => (baseFiles.has(rel) ? textAt(repo, base, prefix + rel) : null);
  const designNew = !baseFiles.has('design.json');

  const routes = readRoutes(designDir);
  const posts = readPostRoutes(designDir);
  const baseTable = json(at('routes.json'));
  const baseRoutes = parseRoutes(baseTable);
  const basePosts = parsePostRoutes(baseTable);

  const states = new Map(listStates(designDir).map(state => [state.id, json(readFileSync(join(designDir, 'states', state.file), 'utf8')) ?? {}]));
  const baseStates = new Map([...baseFiles.keys()]
    .filter(rel => /^states\/[^/]+\.json$/i.test(rel))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(rel => [rel.slice(7, -5).replace(/^\d+[-_ ]*/, '') || rel, json(at(rel)) ?? {}]));
  const statesNew = [...states.keys()].filter(id => !baseStates.has(id));
  const statesGone = [...baseStates.keys()].filter(id => !states.has(id));

  const snapshots = readSnapshots(designDir) ?? new Map();
  const baseSnapshots = new Map([...baseFiles.keys()]
    .filter(rel => /^snapshots\/[^/]+\/[^/]+\.html$/i.test(rel))
    .map(rel => [rel.slice(10, -5), (at(rel) ?? '').replace(/\r\n/g, '\n')]));

  const viewText = (dir, view) => {
    if (!view || view.startsWith('@app/')) return null;
    const file = join(dir, 'views', ...`${view}${ext}`.split('/'));
    return existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  };
  const baseViewText = view => (view && !view.startsWith('@app/') ? (at(`views/${view}${ext}`) ?? null)?.replace(/\r\n/g, '\n') ?? null : null);

  const rules = readRules(designDir);
  const baseRules = new Map(parseRules(at('RULES.md') ?? '').map(rule => [rule.id, rule]));

  const { groups, designWide, events: eventsWide } = backlogOf(designDir);
  const keys = groups.map(group => group.key);

  // Server events (6e), against the baseline's events.json. One that's gone
  // goes with the page whose views it pushed into, as backlog.js places events.
  const baseEvents = new Map(parseEvents(json(at('events.json'))).map(event => [event.name, event]));
  const nowEvents = new Set([...groups.flatMap(group => group.events ?? []), ...(eventsWide ?? [])].map(event => event.name));
  const viewsOf = group => [...group.routes.map(route => route.view), ...group.posts.flatMap(post => [post.form, post.answer.view, ...post.answer.also.map(also => also.view)])].filter(Boolean);
  const goneEvents = [...baseEvents.values()].filter(event => !nowEvents.has(event.name));
  const placeGone = event => groups.find(group => event.push.some(part => part.view && viewsOf(group).includes(part.view)))?.key ?? null;
  const compareEvents = (now, gone) => {
    const out = { added: [], changed: [], removed: gone };
    for (const event of now) {
      const before = baseEvents.get(event.name);
      if (!before) { out.added.push(event); continue; }
      const what = eventDifferences(before, event);
      if (what.length) out.changed.push({ event, what });
    }
    return out;
  };
  const changes = new Map();
  const claimedRules = new Set();

  for (const group of groups) {
    const change = {
      status: 'unchanged', newRoutes: [], changedRoutes: [], removedRoutes: [], newPosts: [], changedPosts: [], removedPosts: [],
      shape: [], screens: [], rules: { added: [], reworded: [], retired: [] }, events: { added: [], changed: [], removed: [] }, states: [], statesNew: [],
    };
    const screenStates = new Set();

    for (const route of group.routes) {
      const before = baseRoutes.find(candidate => candidate.pattern === route.pattern);
      if (!before) { change.newRoutes.push(route); continue; }
      const what = [];
      if (routeShape(before) !== routeShape(route)) {
        if (before.view !== route.view) what.push(route.from ? `its view is being redesigned (${route.from.slice(5)})` : `its view is now ${route.view}`);
        if (before.data !== route.data) what.push(`its data is now "${route.data}" (was "${before.data}")`);
        if (before.title !== route.title) what.push(`its title is now "${route.title}"`);
        if (before.over !== route.over || before.in !== route.in) what.push(route.over ? `it's an overlay in "${route.in}" over ${route.over}` : 'it’s a page of its own now');
        if (JSON.stringify([before.list, before.search, before.match]) !== JSON.stringify([route.list, route.search, route.match])) what.push('its search and filters changed');
      } else if (viewText(designDir, route.view) !== baseViewText(route.view)) {
        what.push(`its view changed (${route.view})`);
      }
      if (!what.length) continue;
      change.changedRoutes.push({ route, what });
      // The shape of its data, across the states: only where its view changed,
      // since a view that didn't change shows nothing new (and a route whose
      // data is the whole dataset sees every change to it).
      const now = dataShape(route, routes, states);
      const was = dataShape(before, baseRoutes, baseStates);
      const gained = [...now].filter(path => !was.has(path));
      const lost = [...was].filter(path => !now.has(path));
      if (gained.length || lost.length) change.shape.push({ pattern: route.pattern, gained, lost });
    }
    for (const before of baseRoutes) {
      if (!routes.some(route => route.pattern === before.pattern) && groupKeyFor(before.pattern, keys) === group.key) change.removedRoutes.push(before);
    }

    for (const post of group.posts) {
      const before = basePosts.find(candidate => candidate.pattern === post.pattern);
      if (!before) { change.newPosts.push(post); continue; }
      if (postShape(before) === postShape(post)) continue;
      const what = [];
      if (before.verb !== post.verb || before.at !== post.at) what.push(`it now ${post.verb}s ${post.at}`);
      if (JSON.stringify(before.require) !== JSON.stringify(post.require)) what.push(post.require.length ? `it now requires ${post.require.join(', ')}` : 'it no longer requires anything');
      if (before.form !== post.form) what.push(`its form is now ${post.form}`);
      if (JSON.stringify(before.answer) !== JSON.stringify(post.answer)) what.push('its answer changed');
      change.changedPosts.push({ post, what });
    }
    for (const before of basePosts) {
      if (!posts.some(post => post.pattern === before.pattern) && groupKeyFor(before.pattern, keys) === group.key) change.removedPosts.push(before);
    }

    // Which pages' approved screens changed, in which states.
    const pages = [
      ...group.routes.map(route => ({ route, label: route.title ?? route.pattern, post: false })),
      ...group.posts.filter(post => post.require.length).map(post => ({ route: { ...post, data: post.at }, label: `POST ${post.pattern} (refused)`, post: true })),
    ];
    const differs = new Map();
    for (const { route, label, post } of pages) {
      const changedIn = [];
      for (const [stateId, names] of screenNames(route, states, post)) {
        for (const name of names) {
          const key = `${stateId}/${name}`;
          if (snapshots.has(key) && baseSnapshots.has(key) && snapshots.get(key) !== baseSnapshots.get(key)) changedIn.push(stateId);
          else if (snapshots.has(key) && !baseSnapshots.has(key) && baseRoutes.some(r => r.pattern === route.pattern) && !statesNew.includes(stateId)) changedIn.push(stateId);
        }
      }
      if (changedIn.length) differs.set(route, { label, post, states: [...new Set(changedIn)] });
    }
    // An overlay's screen holds the page beneath it: where that page differs,
    // and the overlay's own route didn't change, the difference is the page's.
    const differsAt = pattern => [...differs].find(([route, found]) => !found.post && route.pattern === pattern)?.[1].states ?? [];
    for (const [route, { label, post, states: changedIn }] of differs) {
      const own = post || !route.over || change.changedRoutes.some(c => c.route.pattern === route.pattern)
        ? changedIn : changedIn.filter(state => !differsAt(route.over).includes(state));
      if (own.length) { change.screens.push({ page: label, states: own }); own.forEach(state => screenStates.add(state)); }
    }

    // Rules shown on this group's routes.
    const patterns = new Set([...group.routes.map(route => route.pattern), ...group.posts.map(post => `POST ${post.pattern}`)]);
    for (const rule of rules) {
      const before = baseRules.get(rule.id);
      // A retired rule may have lost its shown-on: it was shown where it was.
      const places = rule.shownOn.length || !rule.retired ? rule.shownOn : before?.shownOn || [];
      if (!places.some(place => patterns.has(place.route))) continue;
      claimedRules.add(rule.id);
      if (rule.retired && before && !before.retired) change.rules.retired.push(rule);
      else if (rule.retired) continue;
      else if (!before) change.rules.added.push(rule);
      else if (before.text !== rule.text) change.rules.reworded.push(rule);
    }

    change.events = compareEvents(group.events ?? [], goneEvents.filter(event => placeGone(event) === group.key));

    // The states it shows up in: where its screens changed, the new ones, or
    // those its changed rules are shown in.
    const ruleStates = [...change.rules.added, ...change.rules.reworded].flatMap(rule => rule.shownOn.map(place => place.state).filter(Boolean));
    change.statesNew = statesNew;
    change.states = [...new Set([...screenStates, ...statesNew, ...ruleStates])];

    const pageNew = designNew || (group.page && !baseRoutes.some(route => route.pattern === group.page.pattern));
    const anything = change.newRoutes.length || change.changedRoutes.length || change.removedRoutes.length || change.newPosts.length
      || change.changedPosts.length || change.removedPosts.length || change.shape.length || change.screens.length
      || change.rules.added.length || change.rules.reworded.length || change.rules.retired.length
      || change.events.added.length || change.events.changed.length || change.events.removed.length;
    change.status = pageNew ? 'new' : anything ? 'changed' : 'unchanged';
    // Whether the app had the page as main has it: then the change is all
    // that's new to the app; else main's unbuilt page is new to it too.
    change.builtBefore = Boolean(group.page && baseRoutes.find(route => route.pattern === group.page.pattern)?.ported);
    change.summary = summaryOf(group, change);
    changes.set(group.key, change);
  }

  // Rules not shown on any group, and pages that are gone altogether.
  const wide = { added: [], reworded: [], retired: [] };
  for (const rule of rules) {
    if (claimedRules.has(rule.id)) continue;
    const before = baseRules.get(rule.id);
    if (rule.retired && before && !before.retired) wide.retired.push(rule);
    else if (rule.retired) continue;
    else if (!before) wide.added.push(rule);
    else if (before.text !== rule.text) wide.reworded.push(rule);
  }
  const removedGroups = baseRoutes.filter(route => route.title && !route.over && !routes.some(now => now.pattern === route.pattern)).map(route => route.title);
  const events = compareEvents(eventsWide ?? [], goneEvents.filter(event => placeGone(event) === null));
  return { designNew, groups: changes, removedGroups, statesGone, designWide: { rules: wide, events, all: designWide } };
}

/** What differs between two versions of an event: [text]. */
function eventDifferences(before, now) {
  const what = [];
  if (before.title !== now.title) what.push(`it's now "${now.title}"`);
  if (before.verb !== now.verb || before.at !== now.at || JSON.stringify(before.with) !== JSON.stringify(now.with)) {
    what.push(now.verb ? `it now ${now.verb === 'add' ? `adds a record to ${now.at}` : now.verb === 'update' ? `updates ${now.at}` : `removes ${now.at}`}` : 'it no longer changes the data');
  }
  if (before.send !== now.send) what.push(now.send ? `it sends ${now.send}` : 'it no longer sends an event');
  if (JSON.stringify(before.push) !== JSON.stringify(now.push)) what.push(now.push.length ? `it pushes ${now.push.map(part => part.view ? `${part.view} into ${part.into}` : `nothing into ${part.into}`).join(', ')}` : 'it no longer pushes markup');
  return what;
}

/** "Edit borrower gains a notes field; R-q8m is new; its screen changed in Typical." */
function summaryOf(group, change) {
  const parts = [];
  for (const route of change.newRoutes) parts.push(`new ${route.title ? `“${route.title}”` : route.pattern}`);
  for (const post of change.newPosts) parts.push(`a new form, POST ${post.pattern}`);
  for (const { route, what } of change.changedRoutes) parts.push(`${route.title ?? route.pattern}: ${what.join(', ')}`);
  for (const { post, what } of change.changedPosts) parts.push(`POST ${post.pattern}: ${what.join(', ')}`);
  for (const { pattern, gained, lost } of change.shape) {
    if (gained.length) parts.push(`${pattern}'s data gains ${gained.slice(0, 4).join(', ')}${gained.length > 4 ? ', …' : ''}`);
    if (lost.length) parts.push(`${pattern}'s data loses ${lost.slice(0, 4).join(', ')}${lost.length > 4 ? ', …' : ''}`);
  }
  for (const route of change.removedRoutes) parts.push(`${route.title ?? route.pattern} goes`);
  for (const post of change.removedPosts) parts.push(`POST ${post.pattern} goes`);
  for (const rule of change.rules.added) parts.push(`${rule.id} is new`);
  for (const rule of change.rules.reworded) parts.push(`${rule.id} is reworded`);
  for (const rule of change.rules.retired) parts.push(`${rule.id} is retired`);
  for (const event of change.events.added) parts.push(`a new event, ${event.name}`);
  for (const { event } of change.events.changed) parts.push(`the ${event.name} event changes`);
  for (const event of change.events.removed) parts.push(`the ${event.name} event goes`);
  if (!parts.length && change.screens.length) parts.push(`${change.screens.map(screen => screen.page).join(', ')} looks different`);
  return parts.join('; ');
}
