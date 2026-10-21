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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

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
const inMains = kept(2000);

/**
 * Whether all of a commit's work is in another (main): merging it would
 * change nothing. A trial merge (git merge-tree --write-tree), which writes
 * no ref and touches no checkout, so a squash or a rebase counts as well as
 * a merge commit (R-t5w). One that clashes, or a git too old for it, is not
 * in. Kept by the two commits' ids.
 */
export function isIn(repo, commit, target) {
  const key = SHA.test(commit) && SHA.test(target) ? `${repo}\n${commit}\n${target}` : null;
  const known = key && inMains.get(key);
  if (known !== undefined) return known;
  let answer = gitOk(repo, 'merge-base', '--is-ancestor', commit, target);
  if (!answer) {
    try { answer = git(repo, 'merge-tree', '--write-tree', target, commit).split('\n')[0] === git(repo, 'rev-parse', `${target}^{tree}`); } catch { answer = false; }
  }
  return key ? inMains.set(key, answer) : answer;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const cleanupId = (where, name) => createHash('sha256').update(`${where}:${name}`).digest('hex').slice(0, 10);
const samePath = (a, b) => canonical(a).toLowerCase() === canonical(b).toLowerCase();

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

/** How many files a worktree has changed and never committed, new ones included; 0 if git can't say. */
export function uncommittedIn(worktree) {
  try { return git(worktree, 'status', '--porcelain').split('\n').filter(Boolean).length; } catch { return 0; }
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
     * "merged" counts what the main branch here, or the remote's, already has,
     * however it got there: squashed or rebased too (isIn).
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
      const merged = worked && targets.some(target => isIn(parent, tip, target));
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
      // Whichever main is newer, so every commit it's counted behind comes in
      // (R-u9d): the remote's only when it has all of the local one; the local
      // one when it's ahead or they've diverged, as status() counts.
      const remoteMain = `refs/remotes/origin/${into}`;
      const source = remote && gitOk(parent, 'rev-parse', '--verify', '--quiet', remoteMain)
        && gitOk(parent, 'merge-base', '--is-ancestor', `refs/heads/${into}`, remoteMain) ? `origin/${into}` : into;
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
      // The commit pushed: its pull request is merged once that's in main (pullRequest()).
      let sha = null;
      try { sha = git(entry.path, 'rev-parse', 'HEAD'); } catch { /* the remote's copy says, later */ }
      update(entry.id, { published: { at: new Date().toISOString(), pr, sha } });
      return { pushed: true, pr, compare };
    },

    /**
     * A pushed branch's pull request (R-t5w): { state: 'open' | 'merged', at,
     * since }, or null for one never pushed. It's merged once the commit
     * pushed is in main, here or the remote's, however it was merged (isIn);
     * `since` counts the commits made on the branch after it. `at` is when it
     * was pushed, or when Prelude first saw it merged. A push from before the
     * commit was recorded goes by the remote's copy of the branch.
     */
    pullRequest(entry, repo = null) {
      const published = read()[entry.id]?.published ?? entry.published;
      if (!published) return null;
      const parent = repo ?? parentPath(entry);
      const into = mainBranch(parent);
      const names = [`refs/heads/${entry.branch}`, `refs/remotes/origin/${entry.branch}`, `refs/heads/${into}`, `refs/remotes/origin/${into}`];
      let refs;
      try { refs = new Map(git(parent, 'for-each-ref', '--format=%(refname) %(objectname)', ...names).split('\n').filter(Boolean).map(line => line.split(' '))); } catch { refs = new Map(); }
      const tip = refs.get(names[0]);
      const sha = published.sha ?? refs.get(names[1]);
      const targets = [refs.get(names[2]), refs.get(names[3])].filter(Boolean);
      if (!tip || !sha) return { state: 'open', at: published.at, since: 0 };
      const merged = targets.some(target => isIn(parent, sha, target));
      let since = 0;
      try { since = Number(git(parent, 'rev-list', '--count', `${sha}..${tip}`) || 0); } catch { /* git couldn't say */ }
      // When it was first seen merged, kept; a main moved back un-merges it.
      if (merged && !published.mergedAt) update(entry.id, { published: { ...published, mergedAt: new Date().toISOString() } });
      if (!merged && published.mergedAt) update(entry.id, { published: { ...published, mergedAt: null } });
      const mergedAt = published.mergedAt ?? new Date().toISOString();
      return { state: merged ? 'merged' : 'open', at: merged ? mergedAt : published.at, since };
    },

    /**
     * What Prelude leaves to the person in a project, found in git and its own
     * list of worktrees, never by asking the agent (Clean up, R-c3j):
     *   pr-merged   a branch it lists whose pull request merged, with commits since
     *   untouched   a branch it lists, made a week ago or more and never worked on (R-m2e)
     *   merged      a prelude/ branch it no longer lists, its work in main
     *   unlisted    one it no longer lists, with work not in main or files never committed
     *   leftover    a folder in its worktrees with no worktree left in it
     * and on origin, its prelude/ branches whose work is in main (merged, or
     * pr-merged for a pull request it pushed). A worktree it didn't make (not
     * under <home>/worktrees/<project>) and what the checkout is on are the
     * person's own, never listed. Each: { id, where, kind, name, branch, path,
     * entry (its id, if listed), design (an id, or null), at, ahead,
     * uncommitted, since: { commits, files } (pr-merged), safe }.
     */
    leftBehind(folder, { now = Date.now() } = {}) {
      const repo = canonical(folder.path);
      const into = mainBranch(repo);
      const root = join(home, 'worktrees', folder.id);
      const mine = path => canonical(path).toLowerCase().startsWith(`${canonical(root).toLowerCase()}${sep}`);
      const refs = new Map(git(repo, 'for-each-ref', '--format=%(refname) %(objectname) %(committerdate:iso-strict)', 'refs/heads/prelude/', 'refs/remotes/origin/prelude/', `refs/heads/${into}`, `refs/remotes/origin/${into}`)
        .split('\n').filter(Boolean).map(line => { const [name, sha, date] = line.split(' '); return [name, { sha, date }]; }));
      const targets = [refs.get(`refs/heads/${into}`)?.sha, refs.get(`refs/remotes/origin/${into}`)?.sha].filter(Boolean);
      const main = targets[0];
      if (!main) return [];
      const inMain = sha => targets.some(target => isIn(repo, sha, target));
      const count = range => { try { return Number(git(repo, 'rev-list', '--count', range) || 0); } catch { return 0; } };
      const uncommitted = uncommittedIn;
      const all = read();
      const listed = this.of(folder.id);
      const notes = all.$merged.filter(note => note.parentId === folder.id);
      const noteOf = branch => notes.find(note => note.branch === branch) ?? null;
      // git's worktrees: [{ path, branch }], the checkout first.
      const worktrees = (() => { try { return git(repo, 'worktree', 'list', '--porcelain'); } catch { return ''; } })()
        .split(/\n\s*\n/).map(block => ({
          path: block.match(/^worktree (.+)$/m)?.[1] ?? null,
          branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
        })).filter(worktree => worktree.path);
      const items = [];

      for (const entry of listed) {
        const tip = refs.get(`refs/heads/${entry.branch}`)?.sha;
        if (!tip) continue;
        const pull = entry.published ? this.pullRequest(entry, repo) : null;
        if (pull?.state === 'merged' && pull.since) {
          const sha = all[entry.id]?.published?.sha ?? refs.get(`refs/remotes/origin/${entry.branch}`)?.sha;
          let files = [];
          try { files = git(repo, 'diff', '--name-only', sha, tip).split('\n').filter(Boolean); } catch { /* git couldn't say */ }
          items.push({
            where: 'local', kind: 'pr-merged', name: entry.branch, branch: entry.branch, path: entry.path, entry: entry.id, design: entry.design,
            at: pull.at, ahead: count(`${main}..${tip}`), uncommitted: uncommitted(entry.path), since: { commits: pull.since, files }, safe: false,
          });
        } else if (entry.base && tip === entry.base && !entry.building && Date.parse(entry.createdAt) <= now - WEEK) {
          const changed = uncommitted(entry.path);
          if (!changed) items.push({ where: 'local', kind: 'untouched', name: entry.branch, branch: entry.branch, path: entry.path, entry: entry.id, design: entry.design, at: entry.createdAt, ahead: 0, uncommitted: 0, safe: true });
        }
      }

      const listedBranches = new Set(listed.map(entry => entry.branch));
      const checkedOut = worktrees.find(worktree => samePath(worktree.path, repo))?.branch ?? null;
      for (const [ref, { sha, date }] of refs) {
        if (!ref.startsWith('refs/heads/prelude/')) continue;
        const branch = ref.slice('refs/heads/'.length);
        if (listedBranches.has(branch) || branch === checkedOut) continue;
        const worktree = worktrees.find(candidate => candidate.branch === branch) ?? null;
        if (worktree && !mine(worktree.path)) continue;
        const changed = worktree ? uncommitted(worktree.path) : 0;
        const done = inMain(sha);
        const note = noteOf(branch);
        items.push({
          where: 'local', kind: done && !changed ? 'merged' : 'unlisted', name: branch, branch, path: worktree?.path ?? null, entry: null,
          design: note?.design ?? null, at: note?.at ?? date, ahead: done ? 0 : count(`${main}..${sha}`), uncommitted: changed, safe: done && !changed,
        });
      }

      // Folders under Prelude's worktrees that no worktree or listed branch is in.
      let folders = [];
      try { folders = readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => join(root, item.name)); } catch { /* none yet */ }
      for (const path of folders) {
        if (worktrees.some(worktree => samePath(worktree.path, path))) continue;
        if (Object.values(all).some(entry => entry?.path && samePath(entry.path, path))) continue;
        const name = basename(path);
        const note = notes.find(candidate => candidate.branch.replace(/\//g, '-') === name) ?? null;
        let at = note?.at ?? null;
        if (!at) { try { at = statSync(path).mtime.toISOString(); } catch { at = null; } }
        items.push({ where: 'local', kind: 'leftover', name, branch: null, path, entry: null, design: note?.design ?? null, at, ahead: 0, uncommitted: 0, safe: true });
      }

      // On origin, only what's in main: a branch still being worked on there is somebody's.
      for (const [ref, { sha, date }] of refs) {
        if (!ref.startsWith('refs/remotes/origin/prelude/')) continue;
        const branch = ref.slice('refs/remotes/origin/'.length);
        if (!inMain(sha)) continue;
        const entry = listed.find(candidate => candidate.branch === branch && candidate.published);
        const pull = entry ? this.pullRequest(entry, repo) : null;
        items.push({
          where: 'origin', kind: pull?.state === 'merged' ? 'pr-merged' : 'merged', name: `origin/${branch}`, branch, path: null, entry: null,
          design: entry?.design ?? noteOf(branch)?.design ?? null, at: pull?.state === 'merged' ? pull.at : noteOf(branch)?.at ?? date, ahead: 0, uncommitted: 0, safe: false,
        });
      }
      return items.map(item => ({ id: cleanupId(item.where, item.name), ...item }));
    },

    /**
     * Remove one thing Clean up listed, once the person picked it (R-c3j): a
     * branch and its worktree (whatever runs from it stopped first, by
     * `beforeRemove`), a leftover folder, or a branch on origin. A branch
     * Prelude lists leaves its list. {} or { error }.
     */
    clear(folder, item, { beforeRemove = () => {} } = {}) {
      const repo = canonical(folder.path);
      try {
        if (item.where === 'origin') {
          try { git(repo, 'push', '--quiet', 'origin', '--delete', item.branch); } catch (error) {
            // Gone from the server already: only the copy here is left.
            if (!/remote ref does not exist/i.test(String(error.stderr ?? ''))) throw error;
          }
          gitOk(repo, 'branch', '-d', '-r', `origin/${item.branch}`);
          return {};
        }
        if (item.path && existsSync(item.path)) {
          try { beforeRemove({ path: item.path }); } catch { /* nothing to stop */ }
          if (item.kind !== 'leftover') gitOk(repo, 'worktree', 'remove', '--force', item.path);
          rmSync(item.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
        gitOk(repo, 'worktree', 'prune');
        if (item.branch) git(repo, 'branch', '-D', item.branch);
        const all = read();
        if (item.entry) delete all[item.entry];
        if (item.path) all.$leftovers = (all.$leftovers ?? []).filter(path => !samePath(path, item.path));
        write(all);
        if (item.path && existsSync(item.path)) return { error: `${item.path} is still in use, so it wasn’t removed.` };
        return {};
      } catch (error) {
        return { error: gitError(`git couldn’t remove ${item.name}`, error) };
      }
    },

    /**
     * Discard a branch unfinished (R-w8p): its worktree and branch go without
     * being merged or pushed, whatever runs from it stopped first, and it
     * leaves the list, with no note under Merged lately. Its copy on origin
     * goes only when `remote` is true, and first: one that can't go there
     * leaves everything here as it was. {} or { error }.
     */
    discard(folder, entry, { remote = false, beforeRemove = () => {} } = {}) {
      if (remote && remoteOf(folder.path)) {
        const gone = this.clear(folder, { where: 'origin', name: `origin/${entry.branch}`, branch: entry.branch });
        if (gone.error) return gone;
      }
      return this.clear(folder, { where: 'local', kind: 'discarded', name: entry.branch, branch: entry.branch, path: entry.path, entry: entry.id }, { beforeRemove });
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
