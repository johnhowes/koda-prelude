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
- **R-r6b.** A design under Designs says it's ready to build when it has approved pages not yet built, and only once the project's app exists.
  *shown-on: /f/:project @ typical*
- **R-h2w.** Once the app is built, it can be run from the project's own folder with a command and address of its own, never the design host's, and the Run button always shows the command it runs, so clicking it is the approval.
  *shown-on: /f/:project @ typical*
  *proposed*
- **R-p7c.** Building or connecting the app sets how it runs from here, so a newly built app can be run without setting anything; a command changed on this page applies on this computer only.
  *shown-on: /f/:project @ typical*
  *proposed*
- **R-5tj.** The app run from here opens in the browser once it answers at its address, and stops when Prelude quits.
  *proposed*
- **R-u9d.** Updating a branch from main brings in every commit it's counted behind, and says beside the branch how many files came in, or that there was nothing new.
  *shown-on: /f/:project @ large-project*
  *proposed*
- **R-f0c.** Merged lately shows the project's last five merged branches.
  *shown-on: /f/:project @ typical*
