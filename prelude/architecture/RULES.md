# Rules: Architecture

- **R-p0j.** A project has one architecture at most, as it has one design system and one app shell.
  *proposed*
- **R-c2m.** Every design, build and fix agent reads the architecture's principles, and the parts its change reaches, before it changes anything.
  *shown-on: /f/:folder/architecture*
  *proposed*
- **R-h9w.** An agent whose change would go against the architecture proposes a decision on its branch, rather than making the change without saying so.
  *proposed*
- **R-7tq.** A proposed decision is accepted when the branch that proposed it is merged into main, and agents on other branches don't see it before then.
  *shown-on: /f/:folder/architecture/decisions/:decision*
  *proposed*
- **R-4vx.** After every turn that changes code, the changed files are checked against the architecture, and a build or fix agent is told what doesn't match with its next message.
  *shown-on: /f/:folder/architecture @ drifted*
  *proposed*
- **R-k5e.** A part may use the parts its file says it may, in its own layer or below it; any other use is reported, and so is a file no part names or a named file that isn't there.
  *shown-on: /f/:folder/architecture/parts/:part @ drifted*
  *proposed*
- **R-w8d.** Decisions are listed newest first.
  *shown-on: /f/:folder/architecture/decisions*
  *proposed*
