# Architecture - notes

A fourth kind of design, besides features, the design system and the shell:
**the project's architecture**, kept as markdown files that agents read and
shown to the team on the project's Architecture pages, the way the design
system's gallery shows the system. Prelude's own architecture (from
`CLAUDE.md` and `docs/plan.md`) is the sample data.

This design is those pages: views at Prelude's own URLs
(`/f/:folder/architecture/…`), with states shaped as Prelude's model of the
files would be.

## Decided (2026-10-22, with the person)

- **A design of `"kind": "architecture"`, one per project** (R-p0j), like the
  system and the shell. Its sessions shape it ("draft it from the code").
- **Prelude reads the files itself**, as it reads RULES.md, so nothing is
  written twice (D-e8y in the sample). The real architecture design will
  have no states; this design's states stand in for what Prelude reads.
- **Markdown, a file per thing**, in the design's `architecture/` folder (as
  the system's is `system/`):
  - `overview.md`: a summary, the layers in order, the principles (title, why);
  - `parts/<id>.md`: a header (title, layer, kind: module / process / outside,
    `files` globs, `uses` part ids), then sections: Responsible for, Not its
    job, Owns;
  - `decisions/<id>.md`: a header (title, status, date, parts, supersedes),
    then Context, Decision, Consequences. Ids are `D-` + three random
    characters, so branches never clash;
  - `flows/<id>.md`: a title, a summary, numbered steps each starting with
    the part's id.
  Prelude prepares what's derived: each part's "used by", decisions and
  findings, and the map's layers.
- **Proposed decisions are accepted by merging** (R-7tq): an agent's
  proposal is reviewed with its branch, and Prelude marks it accepted at
  merge (as it clears a route's `from`).
- **Agents use it** (R-c2m, R-h9w): every design, build and fix prompt says
  to read the principles and the parts the change reaches, and to propose a
  decision rather than drift.
- **Drift check** (R-4vx, R-k5e; D-r0k in the sample): after every turn that
  changes code, read the changed files' imports (JavaScript first), map
  each file to its part by `files`, and report: a use the part doesn't say
  it may make (and a use of a layer above), a file no part names, and a
  named file that isn't there. Told to build and fix agents with their next
  message, as render failures are; shown on the overview and the part.
  `npm run check` runs it too.
- **Other stacks: small readers in Prelude, one per language, not the host**
  (recommended 2026-10-22, not yet agreed). The check has to run where no
  host is running (CI, `npm run check`), and a host runs only once approved.
  Each reader only lists what a file imports, line by line, with no
  compiler:
  - **where an import names a file** (JavaScript and TypeScript, Python, Go,
    Ruby, PHP): resolve it to the file, and the file to its part by `files`;
  - **where it names a namespace** (C#, Java, Kotlin): a part's header also
    says which namespaces it holds (`names: Spark.Servicing.*`), and a
    `using` or `import` is matched to the part holding that namespace;
    .NET's `ProjectReference`s in each `.csproj` are checked the same way,
    as a coarser use;
  - **a language with no reader**: its files are still checked for
    belonging to a part and for being there; uses aren't, and the check
    says so once.
  Exact answers through the host contract (an imports endpoint) only if a
  reader turns out to be too rough.

## Pages

- **Overview** (`/f/:folder/architecture`): summary, the map of parts by
  layer, principles; beside them the check, latest decisions, flows, and
  what agents do with it. Empty: "Draft it from the code…".
- **A part**: its job and what isn't, decisions, findings; may use, used
  by, owns, files.
- **Decisions**: search by id or title, filter by status; each opens in the
  drawer (context, decision, consequences, what it replaced, its parts).
- **A flow**: a table of steps, each in a part; the decisions behind it.

States: `01-typical`, `02-not-written` (no architecture design yet),
`03-drifted` (five findings). Event: `architecture-checked` refreshes the
check card.

Design system: added the **map** component (`.map`, layers of part boxes)
and the words architecture, part, decision, flow.

## Built (2026-10-22)

- **The overview, its check and the decision list** are the app's views
  (`server/views/architecture/`), answered in `server/main.js` from
  `server/architecture.js`, which reads the files and runs the check. The
  part, decision, flow and Decisions pages are still to build.
- **The files' format** is what `architecture.js` reads and the architecture
  design's agent is told (`architectureSection` in agent.js): a `# title`,
  then `key: value` header lines (a part's `layer`, `kind`, `short` for the
  map, `files`, `uses`; a decision's `status`, `date` as YYYY-MM-DD, `parts`,
  `supersedes`; a flow's `decisions`), then `## ` sections. Flow steps are
  `1. <part id>: <text>`; principles `- **Title.** Why.`
- **What the check expects to belong to a part**: code files under a folder a
  part's glob names (`server/views/**` covers `server/views/`, recursively),
  and files beside a file a part names (`server/main.js` covers `server/`'s own
  files, not its subfolders), so tests and tools aren't reported unless a part
  names something there. JavaScript and TypeScript imports only, so far.
- **The check after a turn** runs for build and fix sessions on a branch, over
  the files the turn changed outside `prelude/`; what doesn't match is a note
  in the chat and is told with the next message (`withFindings`). The project's
  last check is kept in memory, per folder, and read again when the folder's
  commit has moved. `architecture-checked` goes down the app's channel (`/live`).
- **New design** takes `?kind=architecture` (the empty page's "Draft it from
  the code…"): no other kind to pick, and no stack asked, since it's markdown.
- **Design sessions** may write in the architecture's folder, to propose a
  decision (R-h9w); build and fix sessions could already.

## Fixed: designing it shows it (2026-10-22)

From the fix "I added support for a project's architecture view…"
(prelude/fixes/i-added-support-for-a-project-s-architecture-view-a); the
person: it should behave like designing the design system.

- **The architecture design's session shows the overview beside the chat**,
  as the system's shows its gallery: the design surface frames this page for
  the session's folder (its branch's files), once overview.md is written.
  Its agent is told so (`architectureSection`), and to write the overview
  first.
- **Framed, the overview has no crumbs and no "Change it with the agent"**
  (`framed`): it's inside that design already. The app layout leaves its bar
  out (`bare`). The overview's states don't show it framed.
- **New design offers the architecture as a kind** while there's none, so
  it can be made without knowing the empty page's address.

## Fixed: its first session says how to begin (2026-10-22)

From the fix "I followed the architecture link from the project landing…"
(prelude/fixes/i-followed-the-architecture-link-from-the-project-landing).
"Draft it from the code…" opened a session offering a feature's starters
("Describe the feature", "Start from a sketch"), which left the person
unsure what to do. While nothing is written, the architecture's session
now offers one starter, **Draft it from the code** ("Draft the architecture
from the code."), and its intro says the page shows beside the chat once
the overview is written (`server/views/_starters.eta`).

## Open questions

- The project page's link to Architecture: the person will design it in
  "Project Landing Page".
- Should a design page show the parts its routes reach (via `@app/` files)?
  The person isn't sure yet.
- Can a principle carry a check of its own (e.g. "nothing outside the
  renderer imports eta")?
- The readers for other stacks (above): agreed, or the host after all?
- The part, decision, flow and Decisions pages aren't built, so their links
  in the framed overview lead nowhere yet, as on the page itself.
