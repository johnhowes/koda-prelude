// What's left to build in a design (plan: step 7), derived each time from its
// routes and rules, never written down.
//
// A route is built once its view is the app's own (@app/, step 6d); a POST
// route once every view it names is. A rule is built once it isn't marked
// *proposed*. Work is grouped as a team would slice it into stories: each page
// with the overlays presented over it, the fragments under its URL and the
// forms posting there. "Copy as story" turns a group into Markdown for the
// team's tracker, which owns when and who; Prelude stores nothing about it.

import { readPostRoutes, readRoutes } from './host.js';
import { readRules } from './rules.js';

const slugOf = pattern => pattern.split('/').filter(Boolean).map(part => part.replace(/^:/, '').replace(/[^A-Za-z0-9-]+/g, '-')).join('-').toLowerCase() || 'home';

const postBuilt = post => [post.form, post.answer.view, ...post.answer.also.map(also => also.view)]
  .filter(Boolean)
  .every(view => view.startsWith('@app/'));

/**
 * The design's work, by page:
 * { groups: [{ key, slug, title, page, routes, posts, rules, built }], designWide: [rule] }.
 * Retired rules are left out.
 */
export function backlogOf(designDir) {
  const routes = readRoutes(designDir);
  const posts = readPostRoutes(designDir);
  const rules = readRules(designDir).filter(rule => !rule.retired);

  const pages = routes.filter(route => route.title && !route.over);
  const groups = pages.map(page => ({ key: page.pattern, slug: slugOf(page.pattern), title: page.title, page, routes: [page], posts: [], rules: [] }));
  const other = { key: '', slug: 'other', title: 'Other routes', page: null, routes: [], posts: [], rules: [] };
  // The page whose URL is the longest prefix of this one: /orders/:id/row is under /orders/:id.
  const under = pattern => groups
    .filter(group => pattern === group.key || pattern.startsWith(group.key === '/' ? '/' : `${group.key}/`))
    .sort((a, b) => b.key.length - a.key.length)[0] ?? other;

  for (const route of routes) {
    if (pages.includes(route)) continue;
    const group = route.over ? groups.find(g => g.key === route.over) ?? under(route.pattern) : under(route.pattern);
    group.routes.push(route);
  }
  for (const post of posts) under(post.pattern).posts.push(post);

  const designWide = [];
  for (const rule of rules) {
    const group = [...groups, other].find(g => rule.shownOn.some(place =>
      g.routes.some(route => route.pattern === place.route) || g.posts.some(post => `POST ${post.pattern}` === place.route)));
    (group ? group.rules : designWide).push(rule);
  }

  const all = other.routes.length || other.posts.length || other.rules.length ? [...groups, other] : groups;
  for (const group of all) {
    group.built = group.routes.every(route => route.ported) && group.posts.every(postBuilt) && !group.rules.some(rule => rule.proposed);
  }
  return { groups: all, designWide };
}

const listOf = parts => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '');

const answerOf = (answer, at) => {
  const parts = [];
  if (answer.redirect) parts.push(`redirects to \`${answer.redirect}\``);
  if (answer.view) parts.push(`answers with \`${at(answer.view)}\` for \`${answer.data || '(the whole state)'}\`${answer.event ? `, raising the \`${answer.event}\` event` : ''}`);
  else if (answer.event) parts.push(`raises the \`${answer.event}\` event`);
  for (const also of answer.also) {
    parts.push(also.view ? `refreshes \`${also.into.replace(/\?$/, '')}\` with \`${at(also.view)}\`` :`closes the \`${also.into.replace(/\?$/, '')}\``);
  }
  return parts.length ? listOf(parts) : 'answers with nothing to show';
};

const verbOf = post => ({
  update: `updates the record at \`${post.at}\` with the posted fields`,
  add: `adds a record to \`${post.at}\` from the posted fields`,
  remove: `removes the record at \`${post.at}\``,
})[post.verb];

/** A group as Markdown for a tracker: what it delivers, its acceptance criteria and its test cases. */
export function storyMarkdown({ design, designPath, group, designWide = [], states = [], approved = false }) {
  // A view as a path in the repository: the app's own, or the design's copy.
  const at = view => (view.startsWith('@app/') ? view.slice(5) : `${designPath}/views/${view}`);
  const lines = [`# ${group.title}: ${design.title}`, ''];
  lines.push(`Build ${group.page ? `the ${group.title} page` : 'these routes'} as designed in \`${designPath}/\`: its views, routes and states are the specification, and its states are the test fixtures.`, '');

  lines.push('## Delivers', '');
  for (const route of group.routes) {
    const what = route === group.page ? `**${route.title}** page`
      : route.over ? `**${route.title ?? route.pattern}**, in the \`${route.in}\` over \`${route.over}\``
      : route.title ? `**${route.title}**` : 'Fragment';
    lines.push(`- ${what} at \`${route.pattern}\` (\`${at(route.view)}\`${route.ported ? ', already ported' : ''})`);
  }
  for (const post of group.posts) lines.push(`- Form \`POST ${post.pattern}\`: ${verbOf(post)}`);
  lines.push('');

  lines.push('## Acceptance criteria', '');
  for (const post of group.posts) {
    if (post.require.length) {
      lines.push(`- \`POST ${post.pattern}\` refuses an empty ${post.require.map(name => `\`${name}\``).join(' or ')}: it answers 422 with ${post.form ? `\`${at(post.form)}\` showing what was typed and a message on each` : 'the missing fields'}, and changes nothing.`);
    }
    lines.push(`- \`POST ${post.pattern}\` ${verbOf(post)}, then ${answerOf(post.answer, at)}.`);
  }
  for (const rule of [...group.rules, ...designWide]) {
    const where = rule.shownOn.map(place => `\`${place.route}\`${place.state ? ` in ${place.state}` : ''}`).join(', ');
    lines.push(`- **${rule.id}.** ${rule.text}${where ? ` (shown on ${where})` : ''}${rule.proposed ? '' : ' (already built)'}`);
  }
  lines.push(approved
    ? `- Every page looks like its approved screen in \`${designPath}/snapshots/\`, in every state.`
    : `- Every page looks like the design, in every state.`);
  lines.push(`- \`npm run check\` passes once the routes point at the app's views.`, '');

  if (states.length) {
    lines.push('## Test cases', '', `One per state, from \`${designPath}/states/\`:`, '');
    for (const state of states) lines.push(`- **${state.title}** (\`${state.file}\`)`);
    lines.push('');
  }
  return lines.join('\n');
}
