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

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { canonical, folderId } from './folders.js';
import { listSessions, updateSession } from './sessions.js';

// Never a file-system monitor: with core.fsmonitor (or the older
// core.useBuiltinFSMonitor) on, each git command in a new repository or
// worktree starts a daemon that outlives it, and can hold this process's
// pipes open.
const NO_MONITOR = ['-c', 'core.fsmonitor=false', '-c', 'core.useBuiltinFSMonitor=false'];
const git = (cwd, ...args) => execFileSync('git', [...NO_MONITOR, ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (cwd, ...args) => { try { git(cwd, ...args); return true; } catch { return false; } };

// Git runs synchronously, so every call holds up every request. What a commit
// or a blob holds never changes, so answers keyed by their ids are kept: a
// page read again with nothing moved costs a call or two, not dozens.
const kept = (limit) => {
  const map = new Map();
  return {
    get: key => map.get(key),
    set(key, value) {
      map.set(key, value);
      if (map.size > limit) map.delete(map.keys().next().value);
      return value;
    },
  };
};
const SHA = /^[0-9a-f]{40}$/;
const blobs = kept(4000);
const trees = kept(200);
const commitsSince = kept(500);

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

/** The repository a worktree belongs to (its project's folder), or null. */
export function repositoryOf(worktreePath) {
  try { return canonical(resolve(worktreePath, git(worktreePath, 'rev-parse', '--git-common-dir'), '..')); } catch { return null; }
}

/** Whether a build can start here: a repository, or a folder a build can make one. */
export const buildable = folderPath => ['repository', 'none'].includes(gitState(folderPath));

/** The repository's main branch: its remote's default, else main, else master, else what's checked out. */
export function mainBranch(folderPath) {
  try { return git(folderPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, ''); } catch { /* no remote default */ }
  for (const name of ['main', 'master']) if (gitOk(folderPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)) return name;
  try { return git(folderPath, 'symbolic-ref', '--short', 'HEAD'); } catch { return 'main'; }
}

/**
 * Where a design's branch left the main branch (step 10): the commit its
 * increment is measured from, or null.
 */
export function baselineOf(repo, branch) {
  try { return git(repo, 'merge-base', mainBranch(repo), `refs/heads/${branch}`); } catch { return null; }
}

/** The files under a path at a commit, relative to it: Map(relative path -> blob id). */
export function filesAt(repo, rev, prefix) {
  const key = SHA.test(rev) ? `${repo}\n${rev}\n${prefix}` : null;
  const known = key && trees.get(key);
  if (known) return new Map(known);
  const files = new Map();
  try {
    for (const line of git(repo, 'ls-tree', '-r', rev, '--', prefix).split('\n').filter(Boolean)) {
      const [meta, path] = line.split('\t');
      files.set(path.slice(prefix.length), meta.split(' ')[2]);
    }
  } catch { return files; /* nothing there */ }
  if (key) trees.set(key, new Map(files));
  return files;
}

/**
 * Blobs' texts by their ids, in one git process however many there are (one
 * `git show` each was most of a project page's time): Map(id -> text). An id
 * git hasn't got is left out.
 */
export function textsOf(repo, ids) {
  const texts = new Map();
  const wanted = [...new Set(ids)].filter(id => {
    const text = blobs.get(id);
    if (text !== undefined) texts.set(id, text);
    return text === undefined;
  });
  if (!wanted.length) return texts;
  let out;
  try {
    out = execFileSync('git', [...NO_MONITOR, 'cat-file', '--batch'], { cwd: repo, input: `${wanted.join('\n')}\n`, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  } catch { return texts; }
  // Each answer: "<id> <type> <size>\n<size bytes>\n", or "<id> missing\n".
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf(0x0a, at);
    if (end < 0) break;
    const [id, type, size] = out.subarray(at, end).toString('utf8').split(' ');
    at = end + 1;
    if (type === 'missing' || size === undefined) continue;
    const length = Number(size);
    const text = out.subarray(at, at + length).toString('utf8');
    at += length + 1;
    if (type === 'blob') texts.set(id, blobs.set(id, text));
  }
  return texts;
}

/** A file's text as it was at a commit, or null. */
export function textAt(repo, rev, path) {
  try { return execFileSync('git', [...NO_MONITOR, 'show', `${rev}:${path}`], { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
}

/** The files git has seen deleted under a folder (repository-relative, with /). */
export function removedUnder(repo, dir) {
  try {
    return [...new Set(git(repo, 'log', '--diff-filter=D', '--name-only', '--format=', '--', dir).split('\n').map(line => line.trim()).filter(Boolean))];
  } catch { return []; }
}

/**
 * A file as it was just before the commit that last deleted it, or null if
 * git never had it: { text, removedIn }. Prelude deletes a shell's copy of a
 * layout once layouts.json links the app's; this brings it back.
 */
export function beforeRemoval(repo, path) {
  try {
    const removedIn = git(repo, 'log', '-1', '--format=%H', '--diff-filter=D', '--', path);
    if (!removedIn) return null;
    const text = textAt(repo, `${removedIn}^`, path);
    return text === null ? null : { text, removedIn };
  } catch { return null; }
}

/**
 * The commits on a branch since a commit that touched a design (its sessions
 * and approved screens aside). `to` is the branch's name, or its tip's id:
 * by ids, the answer is kept.
 */
export function designCommitsSince(repo, from, to, designId) {
  const key = SHA.test(from) && SHA.test(to) ? `${repo}\n${from}\n${to}\n${designId}` : null;
  const known = key && commitsSince.get(key);
  if (known) return [...known];
  try {
    const commits = git(repo, 'log', '--format=%H', `${from}..${SHA.test(to) ? to : `refs/heads/${to}`}`, '--', `prelude/${designId}`, `:(exclude)prelude/${designId}/sessions`, `:(exclude)prelude/${designId}/snapshots`).split('\n').filter(Boolean);
    if (key) commitsSince.set(key, [...commits]);
    return commits;
  } catch { return []; }
}

/** Fetch a repository's remote without holding up anything else: resolves true once fetched, false if it couldn't. */
export function fetchRemote(folderPath, ...args) {
  return new Promise(resolve => {
    execFile('git', [...NO_MONITOR, 'fetch', '--quiet', 'origin', ...args], { cwd: folderPath, windowsHide: true }, error => resolve(!error));
  });
}

/**
 * The files a worktree has changed since a commit, committed or not, new
 * files included (repository-relative, with /). A fix's check (step 11)
 * runs before the turn is committed.
 */
export function changedSince(worktree, base) {
  try {
    const tracked = git(worktree, 'diff', '--name-only', base).split('\n');
    const untracked = git(worktree, 'ls-files', '--others', '--exclude-standard').split('\n');
    return [...new Set([...tracked, ...untracked].map(line => line.trim()).filter(Boolean))];
  } catch { return []; }
}

/**
 * What a worktree has changed since a commit, committed or not, new files
 * included: [{ path, how: 'added' | 'changed' | 'removed' }], by path. A
 * build session with no screens of its own shows it (prelude/build).
 */
export function filesChangedSince(worktree, base) {
  try {
    const files = new Map();
    for (const line of git(worktree, 'diff', '--name-status', '--no-renames', base).split('\n')) {
      const [status, path] = line.trim().split('\t');
      if (path) files.set(path, status.startsWith('A') ? 'added' : status.startsWith('D') ? 'removed' : 'changed');
    }
    for (const path of git(worktree, 'ls-files', '--others', '--exclude-standard').split('\n').map(line => line.trim()).filter(Boolean)) files.set(path, 'added');
    return [...files].map(([path, how]) => ({ path, how })).sort((a, b) => a.path.localeCompare(b.path));
  } catch { return []; }
}

/** The commit a worktree is at, or null. */
export function headOf(worktree) {
  try { return git(worktree, 'rev-parse', 'HEAD'); } catch { return null; }
}

/** git's user name where a folder is, as a commit there would be signed, or '' with none. */
export function gitUser(folderPath) {
  try { return git(folderPath, 'config', 'user.name'); } catch { return ''; }
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
    return { error: `This project’s folder is inside another git repository (${git(folderPath, 'rev-parse', '--show-toplevel')}). Open that repository in Prelude instead, so its designs get branches of their own.` };
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
      git(folderPath, 'commit', '-q', '--allow-empty', '-m', 'The project so far (committed by Prelude)');
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
  // All of it, as the files git names are often the part that says why.
  const said = detail.split('\n').map(line => line.trim()).filter(line => line && !/^hint:/.test(line)).join(' ');
  return `${what}: ${said.length > 600 ? `${said.slice(0, 600)}…` : said}${identity}`;
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
  // Branches' status, by where their refs are (status()).
  const statuses = kept(200);
  const halfway = into => `${into} is half brought into this branch: send the agent a message to resolve the files that clash, or abandon the update, first.`;

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
      // A fix's branch is prelude/fix-<slug> (step 11); a design's, prelude/<design>.
      const base = designId.startsWith('fixes/') ? `prelude/fix-${slug(designId.slice(6))}` : `prelude/${slug(designId)}`;
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

    /** Record that a group's build finished, at the branch's current commit (step 10). */
    markBuilt(entry, groupKey) {
      const current = read()[entry.id];
      if (!current) return null;
      const sha = git(parentPath(current), 'rev-parse', `refs/heads/${current.branch}`);
      return update(entry.id, { built: { ...(current.built ?? {}), [groupKey]: sha } });
    },

    /**
     * Commit everything in the worktree to its branch, if anything changed.
     * Returns the commit's short id, or null. While main is half brought in
     * (an update that clashed), nothing is committed until no clashing file
     * has a conflict marker left; then the commit finishes that merge.
     */
    commit(entry, message) {
      const merging = this.merging(entry);
      if (merging?.unresolved.length) return null;
      if (merging) message = `Update from ${merging.from} (merged by Prelude; the clashes resolved by the agent)`;
      git(entry.path, 'add', '-A');
      if (merging) {
        git(entry.path, 'commit', '-q', '-m', message);
        update(entry.id, { clashes: null });
        return git(entry.path, 'rev-parse', '--short', 'HEAD');
      }
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
      // Where the branch, main and the remote's main are, in one call. Read
      // from the repository by name: it holds even once the worktree is gone.
      const names = [`refs/heads/${entry.branch}`, `refs/heads/${into}`, `refs/remotes/origin/${into}`];
      const refs = new Map(git(parent, 'for-each-ref', '--format=%(refname) %(objectname)', ...names).split('\n').filter(Boolean).map(line => line.split(' ')));
      const tip = refs.get(names[0]);
      const main = refs.get(names[1]);
      if (!tip || !main) throw new Error(`git has no ${tip ? into : entry.branch}`);
      const origin = refs.get(names[2]) ?? null;
      // While none of them moves, the answer is the one worked out last time.
      const key = `${parent}\n${entry.design}\n${entry.base}\n${tip}\n${into}\n${main}\n${origin}`;
      const known = statuses.get(key);
      if (known) return { ...known, alsoChanges: [...known.alsoChanges] };
      const targets = [main, ...(origin ? [origin] : [])];
      const worked = tip !== entry.base;
      const merged = worked && targets.some(target => gitOk(parent, 'merge-base', '--is-ancestor', tip, target));
      const count = range => Number(git(parent, 'rev-list', '--count', range) || 0);
      const behind = count(`${tip}..${main}`);
      const ahead = count(`${main}..${tip}`);
      const own = `prelude/${entry.design}/`;
      const alsoChanges = git(parent, 'diff', '--name-only', `${main}...${tip}`).split('\n').filter(Boolean)
        .filter(path => !path.startsWith(own) && !/\/(sessions|snapshots)\//.test(path));
      statuses.set(key, { into, merged, worked, behind, ahead, alsoChanges, tip });
      return { into, merged, worked, behind, ahead, alsoChanges: [...alsoChanges], tip };
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
      if (this.merging(entry)?.unresolved.length) return { error: halfway(into) };
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
     * Main half brought in: an update that clashed, left in the worktree for
     * the agent to resolve. { from, clashes: [paths], unresolved: [paths still
     * holding a conflict marker] }, or null when no update is under way.
     */
    merging(entry) {
      if (!existsSync(entry.path) || !gitOk(entry.path, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) return null;
      const recorded = read()[entry.id] ?? {};
      const clashes = recorded.clashes ?? [];
      const marked = /^(<{7}|>{7})(\s|$)/m;
      const unresolved = clashes.filter(path => {
        const file = join(entry.path, ...path.split('/'));
        try { return existsSync(file) && marked.test(readFileSync(file, 'utf8')); } catch { return true; }
      });
      return { from: recorded.clashesFrom ?? mainBranch(parentPath(entry)), clashes, unresolved };
    },

    /** Give up a clashing update: the branch is as it was before it. */
    abandon(entry) {
      gitOk(entry.path, 'merge', '--abort');
      update(entry.id, { clashes: null, clashesFrom: null });
      return !this.merging(entry);
    },

    /**
     * Bring the main branch into a design's branch, so it builds on what's
     * there now. Files that clash are left with git's conflict markers, for
     * the agent to resolve with the person's next message (merging()); any
     * other failure is undone. { files } (what came in), { clashes, from },
     * or { error }.
     */
    update(entry) {
      const parent = parentPath(entry);
      const into = mainBranch(parent);
      if (this.merging(entry)?.unresolved.length) return { error: halfway(into) };
      const remote = remoteOf(parent);
      if (remote) gitOk(parent, 'fetch', '--quiet', 'origin', into);
      const source = remote && gitOk(parent, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${into}`) ? `origin/${into}` : into;
      this.commit(entry, 'Work in progress (committed by Prelude, updating from main)');
      const before = git(entry.path, 'rev-parse', 'HEAD');
      try {
        git(entry.path, 'merge', '--no-edit', '-m', `Update from ${into} (merged by Prelude)`, source);
      } catch (error) {
        const clashes = (() => { try { return git(entry.path, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean); } catch { return []; } })();
        if (clashes.length && gitOk(entry.path, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
          update(entry.id, { clashes, clashesFrom: into });
          return { clashes, from: into };
        }
        gitOk(entry.path, 'merge', '--abort');
        return { error: gitError(`git couldn’t bring ${into} into ${entry.branch}, so nothing changed`, error) };
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
      if (this.merging(entry)?.unresolved.length) return { error: halfway(into) };
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
     * of each. Returns the notes it made. With `fetch: false`, the remote's
     * branches are as last fetched (fetchRemote fetches without blocking).
     */
    tidy(folder, { beforeRemove = () => {}, fetch = true } = {}) {
      const notes = [];
      // Folders of tidied branches that were still in use last time.
      const leftovers = read().$leftovers ?? [];
      if (leftovers.length) {
        const still = leftovers.filter(path => { try { rmSync(path, { recursive: true, force: true }); } catch { /* still in use */ } return existsSync(path); });
        const all = read();
        all.$leftovers = still;
        write(all);
      }
      if (fetch && remoteOf(folder.path)) gitOk(folder.path, 'fetch', '--quiet', 'origin');
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
