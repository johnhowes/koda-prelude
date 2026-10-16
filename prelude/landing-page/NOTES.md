# Landing Page - notes

Prelude's home page (`/`), today `server/views/_home.eta`: an "Open a project"
form and a list of recent projects (name and path only). This design turns it
into a dashboard across the person's projects.

## Proposed (not yet agreed)

The page answers "what needs me, and where was I?", across every recent project:

1. **Needs you**: what's waiting on the person, wherever it is: a design whose
   screens are ready to build, a branch pushed and waiting on its pull request,
   a build that stopped, and maybe an agent turn that finished while they were
   away or is waiting on an approval.
2. **Projects**: the recent projects as a list, each with its path, how much is
   in progress, the app's stack and when it last changed.
3. **Open a project**: shrinks to a button and a compact form at the top; it
   stays the whole page when there are no projects yet.

What's running now stays in the bar (the shell already shows it).

## Open questions

- Cross-project, or should the home page stay a picker and leave work to each
  project's page (which already has "In progress")?
- Should "Needs you" include finished turns and approvals? The shell has the
  same open question for its agent status.
- Cost: today the home page knows only names and paths. A dashboard means the
  server reads each recent project's branches on every visit.
- How many projects does a person usually have? It decides list or cards.
