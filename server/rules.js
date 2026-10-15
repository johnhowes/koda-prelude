// A design's rules (plan: step 7): prelude/<design>/RULES.md.
//
// Behaviour worth stating as a rule - what a person observes, in one plain
// sentence - beside the views, routes and states that already show most of
// it. A state can show a rule (the underwriter state shows what an
// underwriter sees); the rule says it's intended and general.
//
//   - **R-k3f.** Only an underwriter sees Edit on a funded loan's borrower.
//     *shown-on: /borrowers/:id/edit @ underwriter*
//   - **R-q8m.** Changing a borrower's email sends them a confirmation.
//     *proposed*
//   - ~~**R-2wd.** A borrower's status can't be changed once funded.~~
//     *retired: replaced by R-k3f*
//
// Ids are random, so two branches never both add R-7. "*proposed*" means not
// built yet; the commit that makes the rule true removes it. A retired rule is
// struck through and keeps its id. Nothing here blocks anything: the check
// only warns about a shown-on that points at nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULES_FILE = 'RULES.md';

const START = /^\s*[-*]\s+(~~)?\*\*(R-[A-Za-z0-9]+)\.\*\*\s*(.*)$/;
const MARKER = /^\*(shown-on|proposed|retired)(?::\s*(.*?))?\*$/i;

/** The rules in a RULES.md: [{ id, text, proposed, retired, shownOn: [{ route, state }], note }]. */
export function parseRules(markdown) {
  const rules = [];
  let rule = null;
  for (const raw of String(markdown).split(/\r?\n/)) {
    const start = raw.match(START);
    if (start) {
      rule = { id: start[2], text: '', proposed: false, retired: Boolean(start[1]), shownOn: [], note: null };
      rules.push(rule);
      addText(rule, start[3]);
      continue;
    }
    // A rule goes on over indented lines; a blank or unindented line ends it.
    const line = raw.trim();
    if (!line || !/^\s/.test(raw)) { rule = null; continue; }
    if (!rule) continue;
    const marker = line.match(MARKER);
    if (!marker) { addText(rule, line); continue; }
    const [, kind, value = ''] = marker;
    if (kind.toLowerCase() === 'proposed') { rule.proposed = true; rule.note = value || rule.note; }
    else if (kind.toLowerCase() === 'retired') { rule.retired = true; rule.note = value || rule.note; }
    else rule.shownOn.push(...value.split(',').map(place => place.trim()).filter(Boolean).map(place => {
      const [route, state = null] = place.split('@').map(part => part.trim());
      return { route, state: state || null };
    }));
  }
  return rules;
}

function addText(rule, text) {
  const clean = text.replace(/~~/g, '').trim();
  if (clean) rule.text = rule.text ? `${rule.text} ${clean}` : clean;
}

/** The design's rules, or [] when it has no RULES.md. */
export function readRules(designDir) {
  try { return parseRules(readFileSync(join(designDir, RULES_FILE), 'utf8')); } catch { return []; }
}

/**
 * What's wrong with the rules, as warnings: a duplicated id, or a shown-on
 * naming a route or a state the design doesn't have. [{ rule, warning }]
 *   routes: GET and POST patterns ("/orders/:id", "POST /orders/:id")
 *   states: [{ id, title }]
 */
export function ruleWarnings(rules, { routes, states }) {
  const warnings = [];
  const seen = new Set();
  const knownState = name => states.some(state => [state.id, state.title].some(known => known.toLowerCase() === name.toLowerCase()));
  for (const rule of rules) {
    if (seen.has(rule.id)) warnings.push({ rule: rule.id, warning: `${rule.id} is used by more than one rule.` });
    seen.add(rule.id);
    if (rule.retired) continue;
    for (const place of rule.shownOn) {
      if (!routes.includes(place.route)) warnings.push({ rule: rule.id, warning: `${rule.id} is shown on ${place.route}, which isn't a route of this design.` });
      if (place.state && !knownState(place.state)) warnings.push({ rule: rule.id, warning: `${rule.id} is shown in the "${place.state}" state, which this design doesn't have.` });
    }
  }
  return warnings;
}
