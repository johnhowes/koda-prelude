// Design branches (plan: step 9).
//
// In a git repository every design works on a branch of its own,
// prelude/<design>, in a git worktree under <home>/worktrees/: its design
// sessions and its build sessions both work there, every turn is committed,
// and the branch is merged once - design and code together. Prelude never
// writes to the person's own checkout; it changes only when a branch is
// merged into it locally.
//
// Prelude treats a worktree as a folder of its own - its own design origin,
// design host and check - so everything that works for a folder works for a
// design's branch, and the sessions' transcripts merge with the branch.
//
// Which worktrees exist is a machine-local convenience, kept in
// <home>/builds.json (ground rule 1): the branch is what matters, and it's in
// git. Once a branch that did some work is in the main branch - merged here,
// or by a pull request on the server - its worktree and branch are removed,
// and the folder says so.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { canonical, folderId } from './folders.js';
import { listSessions, updateSession } from './sessions.js';

// Never a file-system monitor: with core.fsmonitor (or the older
// core.useBuiltinFSMonitor) on, each git command in a new repository or
// worktree starts a daemon that outlives it, and can hold this process's
// pipes open.
const NO_MONITOR = ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false'];
const git = (cwd, ...args) => execFileSync('git', [...NO_MONITOR, ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (cwd, ...args) => { try { git(cwd, ...args); return true; } catch { return false; } };

const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'design';

/**
 * The folder and git: 'repository' (the top of one), 'none' (not in one: a
 * build makes it one), 'inside' (inside another repository, which Prelude
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

/** The repository's main branch: its remote's default, else main, else master, else what's checked out. */
export function mainBranch(folderPath) {
  try { return git(folderPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, ''); } catch { /* no remote default */ }
  for (const name of ['main', 'master']) if (gitOk(folderPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)) return name;
  try { return git(folderPath, 'symbolic-ref', '--short', 'HEAD'); } catch { return 'main'; }
}

/** The repository's remote, for pushing and pull requests: { url, host: 'github' | 'azure' | 'other' } or null. */
export function remoteOf(folderPath) {
  let url;
  try { url = git(folderPath, 'remote', 'get-url', 'origin'); } catch { return null; }
  const host = /github\.com/i.test(url) ? 'github' : /dev\.azure\.com|visualstudio\.com/i.test(url) ? 'azure' : 'other';
  return { url, host };
}

/**
 * Ready a folder for branches: make it a git repository if it isn't one (a
 * new folder someone started designing in), then commit the given paths on
 * its current branch if they have changes - the folder's settings
 * (prelude/prelude.json) and anything designed before branches. { error } when
 * it can't.
 */
export function prepare(folderPath, paths, message) {
  const state = gitState(folderPath);
  if (state === 'missing') return { error: 'Prelude works on git branches, and git isn’t installed on this machine (or isn’t on the PATH).' };
  if (state === 'inside') {
    return { error: `This folder is inside another git repository (${git(folderPath, 'rev-parse', '--show-toplevel')}). Open that repository in Prelude instead, so its designs get branches of their own.` };
  }
  try {
    if (state === 'none') {
      git(folderPath, 'init', '-q', '-b', 'main');
      const ignore = join(folderPath, '.gitignore');
      if (!existsSync(ignore)) writeFileSync(ignore, 'node_modules/\n');
      git(folderPath, 'add', '-A');
      git(folderPath, 'commit', '-q', '-m', 'The designs so far (committed by Prelude)');
      return {};
    }
    // A repository with no commits yet has no branch to start from: its first
    // commit is the folder as it is.
    if (!gitOk(folderPath, 'rev-parse', '--verify', '--quiet', 'HEAD')) {
      git(folderPath, 'add', '-A');
      git(folderPath, 'commit', '-q', '--allow-empty', '-m', 'The folder so far (committed by Prelude)');
      return {};
    }
    const present = paths.filter(path => existsSync(join(folderPath, ...path.split('/'))));
    if (present.length && git(folderPath, 'status', '--porcelain', '--', ...present)) {
      git(folderPath, 'add', '--', ...present);
      git(folderPath, 'commit', '-q', '-m', message, '--', ...present);
    }
    return {};
  } catch (error) {
    return { error: gitError('git couldn’t commit the designs', error) };
  }
}

function gitError(what, error) {
  const detail = String(error.stderr || error.stdout || error.message).trim();
  const identity = /user\.(name|email)|Please tell me who you are/i.test(detail)
    ? ' Tell git who you are first: git config --global user.name "Your Name" and git config --global user.email you@example.com.'
    : '';
  return `${what}: ${detail.split('\n').slice(-3).join(' ')}${identity}`;
}

export function createBranches({ home }) {
  const file = join(home, 'builds.json');

  // Entries: { id, path, parentId, parentName, design, branch, base, createdAt,
  // building: { group, title } | null }. Step 7 and 8 kept one entry per build
  // ({ group, title }); each is now its design's branch, the newest per design.
  const read = () => {
    let raw;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = {}; }
    const all = {};
    const newest = {};
    for (const entry of Object.values(raw)) {
      if (entry === raw.$merged || !entry?.path) continue;
      const adopted = entry.group !== undefined && entry.building === undefined
        ? { ...entry, building: { group: entry.group, title: entry.title }, adopted: true }
        : entry;
      const key = `${adopted.parentId}:${adopted.design}`;
      if (!newest[key] || newest[key].createdAt < adopted.createdAt) newest[key] = adopted;
    }
    for (const entry of Object.values(newest)) all[entry.id] = entry;
    all.$merged = Array.isArray(raw.$merged) ? raw.$merged : [];
    all.$leftovers = Array.isArray(raw.$leftovers) ? raw.$leftovers : [];
    return all;
  };
  const write = all => {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
  };
  const entries = () => { const all = read(); delete all.$merged; delete all.$leftovers; return Object.values(all); };

  // Once: a step 7 or 8 build becomes its design's branch, and its sessions
  // (build sessions all) say so, as build sessions now do themselves.
  {
    let raw = {};
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* nothing yet */ }
    const legacy = Object.values(raw).filter(entry => entry?.path && entry.group !== undefined && entry.building === undefined);
    if (legacy.length) {
      for (const entry of legacy) {
        const dir = join(entry.path, 'prelude', ...String(entry.design).split('/'));
        for (const session of listSessions(dir)) {
          if (!session.build) updateSession(dir, session.id, { build: { group: entry.group, title: entry.title } });
        }
      }
      const all = read();
      for (const entry of Object.values(all)) {
        if (!entry?.adopted) continue;
        entry.adopted = false;
        delete entry.group;
        delete entry.title;
        // Where it started, so a branch with nothing of its own isn't taken for merged work.
        if (!entry.base) {
          try { entry.base = git(entry.path, 'merge-base', 'HEAD', mainBranch(canonical(join(git(entry.path, 'rev-parse', '--git-common-dir'), '..')))); } catch { /* unknown */ }
        }
      }
      write(all);
    }
  }
  const update = (id, change) => {
    const all = read();
    if (!all[id]) return null;
    all[id] = { ...all[id], ...change };
    write(all);
    return all[id];
  };

  const asFolder = entry => entry && existsSync(entry.path)
    ? { id: entry.id, path: entry.path, name: `${entry.parentName} · ${entry.branch}`, branch: entry }
    : null;

  // The repository a branch belongs to: recorded when it was made, or (for an
  // older record) found from the worktree.
  const parentPath = entry => entry.repo ?? canonical(join(git(entry.path, 'rev-parse', '--git-common-dir'), '..'));

  return {
    /** A design's worktree as a folder ({ id, path, name, branch }), or null. */
    folderOf(id) {
      return asFolder(read()[id]);
    },

    /** The folder's design branches. */
    of(parentId) {
      return entries().filter(entry => entry.parentId === parentId && existsSync(entry.path));
    },

    /** A design's branch in a folder, or null. */
    forDesign(parentId, designId) {
      return this.of(parentId).find(entry => entry.design === designId) ?? null;
    },

    /** Branches merged and tidied up lately: [{ design, title, branch, into, at }], newest first. */
    merged(parentId) {
      return read().$merged.filter(record => record.parentId === parentId).sort((a, b) => b.at.localeCompare(a.at));
    },

    /**
     * A design's branch, made if it has none: prelude/<design> from the main
     * branch, in a worktree of its own. Anything designed in the checkout before
     * branches (and the folder's settings) is committed on the main branch first.
     * { entry } or { error }.
     */
    ensure({ folder, designId, title = designId }) {
      const existing = this.forDesign(folder.id, designId);
      if (existing) return { entry: existing };
      const ready = prepare(folder.path, [`prelude/${designId}`, 'prelude/prelude.json'], `${title}, as designed so far (committed by Prelude)`);
      if (ready.error) return ready;
      const main = mainBranch(folder.path);
      const base = `prelude/${slug(designId)}`;
      let branch = base;
      for (let n = 2; gitOk(folder.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); n++) branch = `${base}-${n}`;
      const path = join(home, 'worktrees', folder.id, branch.replace(/\//g, '-'));
      try {
        mkdirSync(join(home, 'worktrees', folder.id), { recursive: true });
        git(folder.path, 'worktree', 'add', '-b', branch, path, main);
      } catch (error) {
        return { error: gitError('git couldn’t make the design’s branch', error) };
      }
      const full = canonical(path);
      const entry = {
        id: folderId(full), path: full, parentId: folder.id, parentName: folder.name ?? basename(folder.path),
        design: designId, branch, base: git(full, 'rev-parse', 'HEAD'), repo: canonical(folder.path), createdAt: new Date().toISOString(), building: null,
      };
      const all = read();
      all[entry.id] = entry;
      write(all);
      return { entry };
    },

    /** Mark a branch as building one of its design's groups (one at a time), or as done building. */
    building(entry, group) {
      return update(entry.id, { building: group ? { group: group.key, title: group.title } : null, adopted: false });
    },

    /** Commit everything in the worktree to its branch, if anything changed. Returns the commit's short id, or null. */
    commit(entry, message) {
      git(entry.path, 'add', '-A');
      if (!git(entry.path, 'status', '--porcelain')) return null;
      git(entry.path, 'commit', '-q', '-m', message);
      return git(entry.path, 'rev-parse', '--short', 'HEAD');
    },

    /**
     * Where a branch stands against the main branch:
     * { into, merged, worked, behind, ahead, alsoChanges: [paths outside its design] }.
     * "merged" counts what the main branch here, or the remote's, already has.
     */
    status(entry, repo = null) {
      const parent = repo ?? parentPath(entry);
      const into = mainBranch(parent);
      const targets = [into, ...(gitOk(parent, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${into}`) ? [`origin/${into}`] : [])];
      // Read from the repository by name: it holds even once the worktree is gone.
      const tip = git(parent, 'rev-parse', `refs/heads/${entry.branch}`);
      const worked = tip !== entry.base;
      const merged = worked && targets.some(target => gitOk(parent, 'merge-base', '--is-ancestor', tip, target));
      const count = range => Number(git(parent, 'rev-list', '--count', range) || 0);
      const behind = count(`${tip}..${into}`);
      const ahead = count(`${into}..${tip}`);
      const own = `prelude/${entry.design}/`;
      const alsoChanges = git(parent, 'diff', '--name-only', `${into}...${tip}`).split('\n').filter(Boolean)
        .filter(path => !path.startsWith(own) && !/\/(sessions|snapshots)\//.test(path));
      return { into, merged, worked, behind, ahead, alsoChanges };
    },

    /**
     * Merge a branch into the main branch, here - for someone working on their
     * own; a team opens a pull request instead. When the main branch is
     * checked out, the merge happens there; otherwise it's made without
     * touching the checkout at all. A conflict changes nothing.
     * { merged } or { error }.
     */
    merge(entry, message) {
      const parent = parentPath(entry);
      const into = mainBranch(parent);
      try {
        this.commit(entry, 'The last chat notes (committed by Prelude, merging)');
        const checkedOut = git(parent, 'rev-parse', '--abbrev-ref', 'HEAD') === into;
        if (checkedOut) {
          try {
            git(parent, 'merge', '--no-ff', '--no-edit', '-m', message, entry.branch);
          } catch (error) {
            gitOk(parent, 'merge', '--abort');
            throw error;
          }
        } else {
          let tree;
          try { tree = git(parent, 'merge-tree', '--write-tree', into, entry.branch).split('\n')[0]; } catch (error) {
            throw Object.assign(new Error(`${entry.branch} and ${into} both change the same lines`), { stderr: String(error.stdout || '') });
          }
          const old = git(parent, 'rev-parse', into);
          const commit = git(parent, 'commit-tree', tree, '-p', into, '-p', entry.branch, '-m', message);
          git(parent, 'update-ref', `refs/heads/${into}`, commit, old);
        }
        return { merged: true, into };
      } catch (error) {
        return { error: gitError(`git couldn’t merge ${entry.branch} into ${into}, so nothing changed`, error) };
      }
    },

    /**
     * Bring the main branch into a design's branch, so it builds on what's
     * there now. A conflict is undone, and named. { files } (what came in) or
     * { error, conflicts }.
     */
    update(entry) {
      const parent = parentPath(entry);
      const into = mainBranch(parent);
      const remote = remoteOf(parent);
      if (remote) gitOk(parent, 'fetch', '--quiet', 'origin', into);
      const source = remote && gitOk(parent, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${into}`) ? `origin/${into}` : into;
      this.commit(entry, 'Work in progress (committed by Prelude, updating from main)');
      const before = git(entry.path, 'rev-parse', 'HEAD');
      try {
        git(entry.path, 'merge', '--no-edit', '-m', `Update from ${into} (merged by Prelude)`, source);
      } catch (error) {
        const conflicts = (() => { try { return git(entry.path, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean); } catch { return []; } })();
        gitOk(entry.path, 'merge', '--abort');
        return { error: gitError(`git couldn’t bring ${into} into ${entry.branch}, so nothing changed`, error), conflicts };
      }
      const files = git(entry.path, 'diff', '--name-only', before, 'HEAD').split('\n').filter(Boolean);
      if (files.length) update(entry.id, { cameIn: files });
      return { files, from: into };
    },

    /** What the last update brought in, once: for the agent's next message. */
    takeCameIn(entry) {
      const files = read()[entry.id]?.cameIn ?? null;
      if (files) update(entry.id, { cameIn: null });
      return files;
    },

    /**
     * Push a branch to the remote and open a pull request with the remote's
     * own tool (gh for GitHub, az for Azure DevOps), if installed. Prelude asks
     * the person before this is called. { pushed, pr: url | null, compare: url | null } or { error }.
     */
    publish(entry, { title, body }) {
      const parent = parentPath(entry);
      const into = mainBranch(parent);
      const remote = remoteOf(parent);
      if (!remote) return { error: 'This repository has no remote to push to.' };
      try {
        this.commit(entry, 'The last chat notes (committed by Prelude, publishing)');
        git(entry.path, 'push', '--quiet', '-u', 'origin', entry.branch);
      } catch (error) {
        return { error: gitError(`git couldn’t push ${entry.branch}`, error) };
      }
      let pr = null;
      // The description goes in a file: its lines and quotes never pass through
      // a shell. Windows runs az (az.cmd) only through one, so the title is
      // kept to characters a shell leaves alone.
      const bodyFile = join(home, `pr-${entry.id}.md`);
      writeFileSync(bodyFile, body);
      const safeTitle = `"${String(title).replace(/["%^&|<>!`$\\]/g, '')}"`;
      const run = (command, args) => execFileSync(command, args, { cwd: entry.path, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: true }).trim();
      try {
        if (remote.host === 'github') pr = run('gh', ['pr', 'create', '--head', entry.branch, '--base', into, '--title', safeTitle, '--body-file', `"${bodyFile}"`]).split('\n').find(line => /^https?:/.test(line)) ?? null;
        if (remote.host === 'azure') pr = JSON.parse(run('az', ['repos', 'pr', 'create', '--source-branch', entry.branch, '--target-branch', into, '--title', safeTitle, '--description', `"@${bodyFile}"`, '--output', 'json']))?.url ?? null;
      } catch { /* the tool isn't installed or signed in: the link below instead */ }
      rmSync(bodyFile, { force: true });
      const web = remote.url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
      const compare = remote.host === 'github' ? `${web}/compare/${into}...${encodeURIComponent(entry.branch)}?expand=1`
        : remote.host === 'azure' ? `${web}/pullrequestcreate?sourceRef=${encodeURIComponent(entry.branch)}&targetRef=${into}`
        : null;
      update(entry.id, { published: { at: new Date().toISOString(), pr } });
      return { pushed: true, pr, compare };
    },

    /**
     * Remove the worktrees and branches of the folder's designs whose work is
     * in the main branch now - merged here or on the server - and keep a note
     * of each. Returns the notes it made.
     */
    tidy(folder, { beforeRemove = () => {} } = {}) {
      const notes = [];
      // Folders of tidied branches that were still in use last time.
      const leftovers = read().$leftovers ?? [];
      if (leftovers.length) {
        const still = leftovers.filter(path => { try { rmSync(path, { recursive: true, force: true }); } catch { /* still in use */ } return existsSync(path); });
        const all = read();
        all.$leftovers = still;
        write(all);
      }
      if (remoteOf(folder.path)) gitOk(folder.path, 'fetch', '--quiet', 'origin');
      for (const entry of this.of(folder.id)) {
        let state;
        if (!entry.repo) update(entry.id, { repo: canonical(folder.path) });
        try { state = this.status(entry, canonical(folder.path)); } catch { continue; }
        if (!state.merged) continue;
        // Whatever runs from the worktree (its design host) holds its files.
        try { beforeRemove(entry); } catch { /* nothing to stop */ }
        gitOk(folder.path, 'worktree', 'remove', '--force', entry.path);
        gitOk(folder.path, 'worktree', 'prune');
        // Still a worktree of the repository: leave it all, and try again next time.
        const listed = (() => { try { return git(folder.path, 'worktree', 'list', '--porcelain'); } catch { return ''; } })();
        if (listed.split('\n').some(line => line.startsWith('worktree ') && canonical(line.slice(9)).toLowerCase() === canonical(entry.path).toLowerCase())) continue;
        gitOk(folder.path, 'branch', '-D', entry.branch);
        // Its folder, if something still holds files in it, goes later.
        try { if (existsSync(entry.path)) rmSync(entry.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* still in use */ }
        if (existsSync(entry.path)) { const all = read(); all.$leftovers = [...new Set([...(read().$leftovers ?? []), entry.path])]; write(all); }
        const all = read();
        delete all[entry.id];
        const note = { parentId: folder.id, design: entry.design, branch: entry.branch, into: state.into, at: new Date().toISOString() };
        all.$merged = [note, ...all.$merged].slice(0, 50);
        write(all);
        notes.push(note);
      }
      return notes;
    },
  };
}
