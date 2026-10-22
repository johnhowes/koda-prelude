# Rules: Project Landing Page

- **R-v7q.** A project's Needs you lists the same things Home does, for that project alone, newest first, and isn't shown when nothing needs the person there.
  *shown-on: /f/:project @ typical*
- **R-2hx.** A design with a branch is listed under In progress and not under Designs; once its branch is finished, it's listed under Designs again.
  *shown-on: /f/:project @ typical*
- **R-k4n.** Pushing a branch is always asked first, saying which branch goes to which remote, and nothing is pushed until the person says yes.
  *shown-on: /f/:project/branches/:branch/publish @ typical*
- **R-8dz.** The page's work and its app follow what happens elsewhere without a reload: a turn, a build, a push or a merge changes them as it happens, and they're read again every five minutes for what Prelude can't see, such as a pull request merged on the Git server.
- **R-wm3.** New design offers the design system and the app shell as kinds only until the project has one of each.
  *shown-on: /f/:project/designs/new @ new-project*
- **R-r6b.** A design under Designs says it's ready to build when it has approved pages not yet built, and only once the project's app exists. A design that changed since it was approved isn't ready: it says it changed, until it's approved again.
  *shown-on: /f/:project @ typical*
- **R-h2w.** Once the app is built, it can be run from the project's own folder with a command and address of its own, never the design host's, and the Run button always shows the command it runs, so clicking it is the approval.
  *shown-on: /f/:project @ typical*
- **R-p7c.** Building or connecting the app sets how it runs from here, so a newly built app can be run without setting anything; a command changed on this page applies on this computer only.
  *shown-on: /f/:project @ typical*
- **R-5tj.** The app run from here opens in the browser once it answers at its address, and stops when Prelude quits.
- **R-u9d.** Updating a branch from main brings in every commit it's counted behind, and says beside the branch how many files came in, or that there was nothing new.
  *shown-on: /f/:project @ large-project*
- **R-f0c.** Merged lately shows the project's last five merged branches.
  *shown-on: /f/:project @ typical*
- **R-t5w.** A branch's pull request shows as open only until what was pushed is in main, however it was merged, squashed included; a branch whose work is all in main is tidied up by itself, and one with commits since says how many.
  *shown-on: /f/:project @ typical*
- **R-c3j.** Clean up lists what Prelude won't tidy by itself, each with why it's there, and removes only what the person picks; it starts with only those whose work is all in main, or with nothing done, picked.
  *shown-on: /f/:project/cleanup @ typical*
- **R-9xk.** Branches on the remote are listed apart in Clean up, with a warning that others can see them, and are never picked to start with.
  *shown-on: /f/:project/cleanup @ typical*
- **R-m2e.** A branch or worktree the agent is working in can't be picked in Clean up, and a branch with nothing done is listed only once it's a week old.
- **R-w8p.** Any branch in progress can be discarded unfinished, without merging it or opening a pull request, after a question that says what goes with it (a design never merged goes altogether); its copy on the remote goes only if the person ticks it, and Discard isn't offered while the agent is working on the branch.
  *shown-on: /f/:project/branches/:branch/discard @ typical*
- **R-x4b.** A project's design system and architecture can be read from its page without opening a design, each once it has something in it; the app shell isn't offered there.
  *shown-on: /f/:project @ typical*
