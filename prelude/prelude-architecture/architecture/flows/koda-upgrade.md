# Upgrade a project's Koda
decisions: D-k7v, D-b9k

From the project page noticing the app's Koda is behind Prelude's to the upgrade committed on a fix's branch.

1. designs: reads the app's Koda version from the checkout's `node_modules/@kodalang/core/package.json`
2. pages: compares it with Prelude's version and offers "Upgrade Koda" on the project page
3. server: takes the POST and creates a fix, "Upgrade Koda to <version>"
4. branches: makes the fix's branch and worktree
5. installs: runs `<package manager> install @kodalang/core@<version> --ignore-scripts` in the worktree's app folder
6. designs: now finds the new Koda in the worktree, and the server passes its path to the prompt
7. agent: spawns the CLI with the fix prompt, pointed at the new Koda's reference and skills
8. claude: changes the app's views where the new version needs it
9. architecture: checks the changed files against these files
10. branches: commits `package.json`, the lockfile and the agent's changes to the fix's branch
