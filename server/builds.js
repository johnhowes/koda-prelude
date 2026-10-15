// Build sessions' branches (plan: step 7).
//
// A build session changes the app's real code, so it works on a branch of its
// own, in a git worktree: build/<design>-<group>. Prelude treats the worktree
// as a folder of its own - its own design origin, its own design host, its own
// check - so everything that works for a folder works for a build, and the
// session's transcript lives on the branch and merges with the PR.
//
// Which worktrees exist is a machine-local convenience, kept in
// <home>/builds.json (ground rule 1): the branch is what matters, and it's in
// git. Worktrees live under <home>/worktrees/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { canonical, folderId } from './folders.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'build';

/** Whether a folder is the top of a git repository, as a build needs. */
export function isRepository(folderPath) {
  try { return canonical(git(folderPath, 'rev-parse', '--show-toplevel')).toLowerCase() === canonical(folderPath).toLowerCase(); } catch { return false; }
}

export function createBuilds({ home }) {
  const file = join(home, 'builds.json');
  const read = () => {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const write = all => {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  };

  const asFolder = build => build && existsSync(build.path)
    ? { id: build.id, path: build.path, name: `${build.parentName} · ${build.branch}`, build }
    : null;

  return {
    /** A build's worktree as a folder ({ id, path, name, build }), or null. */
    folderOf(id) {
      return asFolder(read()[id]);
    },

    /** The builds of one design in a folder, newest first. */
    of(parentId, designId) {
      return Object.values(read())
        .filter(build => build.parentId === parentId && build.design === designId && existsSync(build.path))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    /**
     * Start a build: a branch and worktree from the folder's HEAD. Refused
     * when the folder isn't a git repository, or the design has uncommitted
     * changes (the branch would build an older design). { build } or { error }.
     */
    start({ folder, design, group, clean = null }) {
      if (!isRepository(folder.path)) return { error: 'A build session works on a git branch, and this folder isn’t the top of a git repository.' };
      // What must be committed: the design, or (for the app build) all of prelude/.
      const designPath = clean ?? `prelude/${design.id}`;
      try {
        if (git(folder.path, 'status', '--porcelain', '--', designPath)) {
          return { error: `${clean ? 'The designs have' : 'The design has'} changes that aren’t committed. Commit ${designPath}/ first: the build branch starts from the last commit.` };
        }
      } catch (error) {
        return { error: `git couldn’t read the design’s status: ${error.message}` };
      }
      const base = `build/${slug(design.id)}-${group.slug}`;
      const taken = name => { try { git(folder.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`); return true; } catch { return false; } };
      let branch = base;
      for (let n = 2; taken(branch); n++) branch = `${base}-${n}`;
      const path = join(home, 'worktrees', folder.id, branch.replace(/\//g, '-'));
      try {
        mkdirSync(join(home, 'worktrees', folder.id), { recursive: true });
        git(folder.path, 'worktree', 'add', '-b', branch, path, 'HEAD');
      } catch (error) {
        return { error: `git couldn’t create the build branch: ${String(error.stderr || error.message).trim()}` };
      }
      const full = canonical(path);
      const build = {
        id: folderId(full), path: full, parentId: folder.id, parentName: folder.name ?? basename(folder.path),
        design: design.id, group: group.key, title: `${group.title}: ${design.title}`, branch, createdAt: new Date().toISOString(),
      };
      const all = read();
      all[build.id] = build;
      write(all);
      return { build };
    },

    /** Commit everything in the worktree to its branch, if anything changed. Returns the commit's short id, or null. */
    commit(build, message) {
      git(build.path, 'add', '-A');
      if (!git(build.path, 'status', '--porcelain')) return null;
      git(build.path, 'commit', '-q', '-m', message);
      return git(build.path, 'rev-parse', '--short', 'HEAD');
    },
  };
}
