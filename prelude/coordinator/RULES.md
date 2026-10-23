# Rules: Coordinator

- **R-s6t.** A step starts by itself on its owner’s computer, and only there, once every step it waits for is merged into main, with its branch brought up to date with main first; a design or discussion starts with the plan sending its first message, and the rest of that session is its owner’s.
  *shown-on: /f/:project/plans/:plan*
  *proposed*
- **R-f8d.** When a step starts, its session’s first message is the plan’s brief and then its prompt, with each thing it asks for from earlier steps named as those steps actually made it.
  *shown-on: /f/:project/plans/:plan/steps/:step @ build-stopped*
  *proposed*
- **R-m3k.** A step’s prompt can be changed until the step starts, and not after.
  *shown-on: /f/:project/plans/:plan/steps/:step @ planning*
  *proposed*
- **R-p4h.** A plan never pushes: a step ready to finish waits for the person to push it, or to merge it when the project has no remote, unless they’ve let the plan merge by itself.
  *shown-on: /f/:project/plans/:plan @ build-stopped*
  *proposed*
- **R-v2j.** A step that stops, or isn’t finished, holds back only the steps that wait for it; the others carry on.
  *shown-on: /f/:project/plans/:plan @ build-stopped*
  *proposed*
- **R-c7n.** Pausing a plan stops steps that haven’t started from starting; steps already working carry on.
  *proposed*
- **R-h9w.** Nothing in a plan starts until the person starts it, after the agent has drafted its steps.
  *shown-on: /f/:project/plans/:plan @ planning*
  *proposed*
- **R-a5r.** A build starts only from approved screens: a design changed after it was approved holds back its build until it’s approved again.
  *proposed*
- **R-n7b.** Each build covers one design, on that design’s branch; a build that uses code another build makes waits for that build to be merged.
  *shown-on: /f/:project/plans/:plan @ build-stopped*
  *proposed*
- **R-k4d.** A design that one person has with its build, and that no other step needs before it’s built, is built on its own branch once approved, and the two go into main together; otherwise the design is finished first, through a pull request when its build is someone else’s, and built on a new branch.
  *shown-on: /f/:project/plans/:plan @ build-stopped*
  *proposed*
- **R-q2x.** A plan is drafted on a branch of its own; starting it puts it into main (through a pull request when the project has a remote), so everyone on the project sees it, and a later change to it goes into main the same way.
  *shown-on: /f/:project/plans/:plan @ typical*
  *proposed*
- **R-b8y.** A step may have an owner, one of the people who have committed to the project, or be open to anyone; an open step that’s ready waits in everyone’s Needs you until someone claims it, and then it’s theirs.
  *shown-on: /f/:project/plans/:plan @ handed-on*
  *proposed*
- **R-r3z.** Someone else’s step shows as much as the remote tells: ready for them, in progress once its branch is pushed, a pull request open, merged; how their session is going shows only on their computer.
  *shown-on: /f/:project/plans/:plan @ handed-on*
  *proposed*
- **R-d6m.** What happens as a plan runs (a step starting, a pull request merged, a build stopping) is said in the plan’s session, and the agent is told it with the next message.
  *shown-on: /f/:project/plans/:plan @ build-stopped*
  *proposed*
- **R-w5c.** In a plan’s session the agent draws as in any session: a map of the parts the plan reaches when it drafts or changes the plan, and a flow when it explains why one step waits for another; a few lines of text when that’s enough.
  *shown-on: /f/:project/plans/:plan @ typical*
  *proposed*
- **R-u3t.** When a step that changed the app’s code is merged, the plan’s session shows the parts it changed on the map, without the agent drawing it.
  *shown-on: /f/:project/plans/:plan @ done*
  *proposed*
- **R-e2q.** A plan is finished when every one of its steps is merged into main.
  *shown-on: /f/:project/plans/:plan @ done*
  *proposed*
