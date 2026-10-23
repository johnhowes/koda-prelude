# Rules: Coordinator

- **R-s6t.** A step starts by itself once every step it waits for is merged into main, with its branch brought up to date with main first; a design or discussion starts with the plan sending its first message, and the rest of that session is the person’s.
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
- **R-e2q.** A plan is finished when every one of its steps is merged into main.
  *shown-on: /f/:project/plans/:plan @ done*
  *proposed*
