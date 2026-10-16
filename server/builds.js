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

// Never a file-system monitor: with core.fsmonitor (or the older
// core.useBuiltinFSMonitor) on, each git command in a new repository or
// worktree starts a daemon that outlives it - one per build, never stopped -
// and can hold this process's pipes open.
const NO_MONITOR = ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false'];
const git = (cwd, ...args) => execFileSync('git', [...NO_MONITOR, ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'build';

/**
 * The folder and git: 'repository' (the top of one), 'none' (not in one: a
 * build makes it one), 'inside' (inside another repository, which a build
 * leaves alone) or 'missing' (no git on this machine).
 */
export function gitState(folderPath) {
  try {
    const top = git(folderPath, 'rev-parse', '--show-toplevel');
    return canonical(top).toLowerCase() === canonical(folderPath).toLowerCase() ? 'repository' : 'inside';
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : 'none';
  }
}

/** Whether a build can start here: a repository, or a folder a build can make one. */
export const buildable = folderPath => ['repository', 'none'].includes(gitState(folderPath));

/**
 * Ready a folder for a build's branch, as part of starting it: make it a git
 * repository if it isn't one (a new folder someone started designing in),
 * then commit the designs the build starts from, if they have changes - the
 * branch starts from that commit. Returns { error } when it can't.
 */
function prepare(folderPath, designPath, message) {
  const state = gitState(folderPath);
  if (state === 'missing') return { error: 'A build works on a git branch, and git isn’t installed on this machine (or isn’t on the PATH).' };
  if (state === 'inside') {
    return { error: `This folder is inside another git repository (${git(folderPath, 'rev-parse', '--show-toplevel')}). Open that repository in Prelude instead, so its builds get branches of their own.` };
  }
  try {
    if (state === 'none') {
      git(folderPath, 'init', '-q', '-b', 'main');
      const ignore = join(folderPath, '.gitignore');
      if (!existsSync(ignore)) writeFileSync(ignore, 'node_modules/\n');
      git(folderPath, 'add', '-A');
      git(folderPath, 'commit', '-q', '-m', 'The designs so far (committed by Prelude, starting a build)');
      return {};
    }
    if (git(folderPath, 'status', '--porcelain', '--', designPath)) {
      git(folderPath, 'add', '--', designPath);
      git(folderPath, 'commit', '-q', '-m', message, '--', designPath);
    }
    return {};
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    const identity = /user\.(name|email)|Please tell me who you are/i.test(detail)
      ? ' Tell git who you are first: git config --global user.name "Your Name" and git config --global user.email you@example.com.'
      : '';
    return { error: `git couldn’t commit the designs for the build: ${detail.split('\n').slice(-2).join(' ')}${identity}` };
  }
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
     * Start a build: a branch and worktree from the folder's HEAD, once the
     * folder is a repository and the designs the build starts from - the
     * design, or (for the app build, `clean`) all of prelude/ - are committed.
     * { build } or { error }.
     */
    start({ folder, design, group, clean = null }) {
      const designPath = clean ?? `prelude/${design.id}`;
      const ready = prepare(folder.path, designPath, clean ? 'The designs, before the app build (committed by Prelude)' : `${design.title}, before building ${group.title} (committed by Prelude)`);
      if (ready.error) return ready;
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
