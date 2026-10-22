# Architecture - notes

Exploring a fourth kind of design, besides features, the design system and the
shell: **the project's architecture**, kept as files that agents read, and
shown to the team as a gallery, the way the design system is. Prelude's own
architecture (today in `CLAUDE.md` and `docs/plan.md`) is the sample data.

## Proposal (not yet agreed)

- **A design of `"kind": "architecture"`, one per project**, like the system
  and the shell. Its sessions shape it ("harvest it from the code").
- **`architecture/` holds the files agents read** (the system's `system/`):
  - `overview.md`: what the app is, its runtime pieces, its principles (rule,
    reason), the way guidelines.md does for the system;
  - `parts/<name>.md`: one per part (module or process), saying what it is
    responsible for, what it owns, what it may use, and its files;
  - `decisions/<id>.md`: one decision record per file (context, decision,
    consequences; proposed / accepted / superseded), ids random so branches
    merge cleanly;
  - `flows/<name>.md`: a request or job through the parts, step by step.
- **The gallery is for architects and developers**: an overview with a map
  of the parts, a page per part, the decision log, and the flows.
- **Agents use it**: design and build sessions read the principles and the
  parts they touch; a change that departs from them proposes a decision
  (as a rule is *proposed*) instead of drifting silently.

## Open questions

- Who renders the gallery: views over states that mirror the files (as built
  today), or Prelude reading `architecture/` directly (as `rules.js` reads
  RULES.md), so nothing is written twice?
- Markdown with a small header per file, or one JSON per part?
- Can drift be checked: a part's declared "may use" against the code's
  imports, as the screens are checked against snapshots?
- A map needs a diagram component the design system lacks.
