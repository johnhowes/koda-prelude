# A merged pull request shows as merged

For anyone who finishes designs by pushing them for a pull request. Today a pushed branch says "Pull request open" forever, even after its pull request was merged. That's worse after a squash merge, or when someone keeps working on the branch after the merge. Those branches also never leave In progress, so the list fills with work that's already done. Once this is built, a branch says its pull request was merged as soon as what was pushed is in main. A branch with nothing left over goes away by itself. A branch with work left over says how much, so the person knows whether anything still needs pushing.

## What changes

- A pushed branch shows "Pull request open" only until what was pushed is in main. This holds however it was merged: a merge commit, a rebase or a squash.
- Once the pull request is merged, a branch with nothing new on it is tidied up by itself, as a branch merged here already is. It leaves In progress, and its design is listed under Designs again.
- A branch with commits made after it was pushed stays under In progress. Instead of "Pull request open", it shows "Pull request merged" and a warning, e.g. "2 commits since".
- Under it, a line says when its pull request was merged into main. It also says that the commits made since aren't in main, and that they can be pushed for another pull request.
- That branch no longer offers "Open the pull request". It offers "Push and open a pull request…" again.

## Acceptance criteria

- **R-t5w.** A branch's pull request shows as open only until what was pushed is in main, however it was merged, squashed included; a branch whose work is all in main is tidied up by itself, and one with commits since says how many.
- A pushed branch whose pull request hasn't been merged still shows "Pull request open" and "Open the pull request".
- A branch whose pull request was squash-merged on the Git server, with nothing committed since, leaves In progress without the person doing anything. Its design shows under Designs again.
- A branch whose pull request was merged, with commits since, shows "Pull request merged" and "N commits since" ("1 commit since" for one).
- Under that branch, a line reads "Its pull request was merged into main 3 days ago. The 2 commits made since aren't in main: push them for another pull request…", with "The commit made since isn't" for one.
- That branch offers "Push and open a pull request…" and not "Open the pull request".
- A merge on the Git server shows up within five minutes without a reload, as other changes on this page do.

## Looks right in

- **Typical**: Underwriting queue's branch shows "Pull request merged" and "2 commits since", with the line saying its pull request was merged 3 days ago and offering to push again. See the approved screen `typical/f_spark-lending.html`.
- **Large project**: its pushed branches haven't been merged yet, so they still show "Pull request open". See `large-project/f_spark-platform.html`.
- **App being built**, **Update clashed** and **Long names** have no pushed branches, so nothing here changes. Their approved screens are `app-being-built/f_borrower-portal.html`, `update-clashed/f_borrower-portal.html` and `long-names/f_mortgage-origination.html`.

## For developers

- Addresses: `/f/:project` (view `projects/page`) and `/f/:project/work` (view `projects/_work`), both with data `projects/:project`. Only `projects/_branch` changes, which `_work` includes for each of `inProgress`.
- Each branch in `inProgress` gains `pullRequest: { state, when, since }`. `state` is `"merged"` once what was pushed is in main. `since` is the count of commits made after the push.
  - `_branch` reads `pushed && pullRequest.state === "merged"` as merged, and `pushed` otherwise as open.
- The cause today: `published` in `builds.json` is set on push and never cleared. Tidying also removes a branch only when its tip is an ancestor of main, so a squash-merged branch, or one that carried on after its merge, stays.
- Decide "in main" by a trial merge that changes nothing (`git merge-tree --write-tree`), not by ancestry:
  - Record the commit that was pushed.
  - The pull request counts as merged once merging that commit into main would change nothing.
  - Tidying uses the same test, so squash-merged branches go by themselves.
  - Where `gh` or `az` is available, its pull request state confirms it.
- The work's five-minute read, and the `projects-changed` event, already reload In progress. A merge on the Git server reaches the page that way.
- Test data, in `prelude/project-landing-page/states/`:
  - `01-typical.json`: branch `5b8a2e` (Underwriting queue) has `pushed: true` and `pullRequest: { state: "merged", when: "3 days ago", since: 2 }`.
  - `06-large-project.json`: pushed branches with no `pullRequest`, still open.
- Approved screens: `prelude/project-landing-page/snapshots/<state>/f_<project>.html` and `…_work.html`.
