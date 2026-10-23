// Turns: one message to the agent and everything it does in reply.
//
// One turn runs at a time per design, whichever of the design's sessions it
// belongs to, so two sessions never write the same files at once. Every event
// is appended to the transcript first and published second, so a page that
// renders the transcript and then subscribes from where it left off misses
// nothing and sees nothing twice.
//
// The agent's words stream as they're written: a "live" entry is pushed when a
// message starts, and every little while it is replaced by all its words so
// far, rendered as markdown afresh (a list or a code block isn't markdown
// until it's whole enough). When the message ends it is saved and the live
// entry is replaced by the finished one, looking the same. Only finished
// messages are saved; the live text is in memory, and a page rendered
// mid-sentence shows it as far as it has got (`streaming`).
//
// Messages sent while the agent works wait (R-z4k): each session's in the
// order written. When a turn ends, `onIdle` is told, and sends them together
// as the next message.
//
// The agent has no shell, so it deletes a file by writing it empty: when the
// turn ends, each file it emptied, and that is empty still, is removed.

import { existsSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { randomUUID } from 'node:crypto';

import { DELETING, designPrompt, toolSummary } from './agent.js';
import { appendEntry, readEntries, readSession, updateSession } from './sessions.js';
import { messagePieces, render } from './views.js';
import { presentEntry, sinceWords, stepOf } from './workspace.js';

const MAX_RESULT = 2000;
// Each push carries the whole message so far, so not too often.
const FLUSH_MS = 150;

/**
 * The words so far, as the transcript will show them once saved: its pieces,
 * a visual still being written a placeholder (R-w5g), drawn as soon as its
 * block closes, with what the view draws visuals with.
 */
const wordsOf = (view, text) => (view.words ?? (words => messagePieces(words, null, { streaming: true })))(text);

export const designKey = (folder, design) => `${folder.id}/${design.id}`;
export const sessionKey = (folder, design, sessionId) => `${folder.id}/${design.id}/${sessionId}`;
// Whether the person has seen a session is the project's, not its branch's: a
// turn watched on a branch's worktree stays seen once the branch is merged.
export const seenKey = (folder, design, sessionId) => `${folder.branch?.parentId ?? folder.id}/${design.id}/${sessionId}`;

/**
 * How entries are shown on the pages watching: `present` readies an entry
 * for _entry.eta, `words` the message being written for _live-entry.eta (its
 * pieces), and `base` is the design's address, for its links.
 */
const plainView = { present: entry => presentEntry(entry, { base: '', routes: [], states: [], datasetOf: () => ({}) }), base: '' };

const entryHtml = (entry, view = plainView) => render('./_entry', { entry: view.present(entry), base: view.base }).trim();

/** Markup for one entry, added to the transcript; empty when the entry shows nothing. */
export function entryMessage(entry, view = plainView) {
  const html = entryHtml(entry, view);
  return html ? render('./push-entry', { html }) : '';
}

export function statusMessage(state) {
  return render('./push-status', { state });
}

let liveCount = 0;

// What the agent is told of a check is kept short, however much failed: one
// broken view a whole design renders fails every route in every state, and
// told in full that once made a message too long for the agent to start.
const FINDING_LINES = 20;
const FINDING_CHARS = 1500;
const MAX_WHERE = 6;       // the places one problem is named at
const MAX_FINDINGS = 20;   // distinct problems, per kind

/** An error as the agent is told it: its first lines, and not too many characters. */
function clipFinding(error) {
  const lines = String(error ?? '').split('\n');
  let text = lines.slice(0, FINDING_LINES).join('\n');
  if (text.length > FINDING_CHARS) text = `${text.slice(0, FINDING_CHARS)}…`;
  else if (lines.length > FINDING_LINES) text += '\n…';
  return text;
}

/** Findings as lines: the same error once, naming where it happened. */
function findingLines(failures) {
  const groups = new Map();   // clipped error -> places
  for (const f of failures) {
    const error = clipFinding(f.error);
    if (!groups.has(error)) groups.set(error, []);
    groups.get(error).push(`${f.path}${f.state ? ` (state "${f.state}")` : ''}`);
  }
  const lines = [...groups].slice(0, MAX_FINDINGS).map(([error, where]) => {
    const more = where.length > MAX_WHERE ? `, and ${where.length - MAX_WHERE} more` : '';
    return `- ${where.slice(0, MAX_WHERE).join(', ')}${more}: ${error}`;
  });
  if (groups.size > MAX_FINDINGS) lines.push(`- …and ${groups.size - MAX_FINDINGS} more, not listed here.`);
  return lines.join('\n');
}

/** The person's message, preceded by what Prelude's last check of the design found. */
export function withFindings(failures, message) {
  if (!failures?.length) return message;
  const fix = failures.filter(f => !f.info && !f.architecture);
  const info = failures.filter(f => f.info);
  const drifted = failures.filter(f => f.architecture);
  const parts = [];
  if (fix.length) parts.push(`(From Prelude, not the person: after your last turn, these didn't render, or point at nothing. Fix them along with what's asked below.)\n${findingLines(fix)}`);
  if (drifted.length) parts.push(`(From Prelude, not the person: after your last turn, these in the files you changed don't match the project's architecture. Change the code, or propose a decision that changes the architecture, along with what's asked below.)\n${findingLines(drifted)}`);
  if (info.length) parts.push(`(From Prelude, for your information: how pages now differ from the screens the person approved. Expected porting differences are theirs to approve; anything else means the port isn't faithful.)\n${findingLines(info)}`);
  return `${parts.join('\n\n')}\n\n${message}`;
}

/**
 * `onChange({ key, seen, finished, watched })` hears each turn start and end:
 * `key` is its session's, `seen` its seenKey, and `watched` whether a page
 * showed the session as it ended.
 */
export function createTurns({ runner, live, onChange = () => {} }) {
  const changed = change => { try { onChange(change); } catch (error) { console.error(error); } };
  const running = new Map();   // designKey -> { sessionId, stop, stopUrl, ctx }
  // What the last check found wrong with a design, told to the agent with the
  // next message on that design (the agent can't see the preview itself).
  const findings = new Map();  // designKey -> [{ state, path, error }]
  // Messages waiting for a turn to end: designKey -> [{ id, sessionId, ... }]
  const queues = new Map();
  let queuedCount = 0;

  const record = (ctx, entry) => {
    appendEntry(ctx.designDir, ctx.session.id, entry);
    const message = entryMessage(entry, ctx.view);
    if (message) live.publish(ctx.key, message);
  };

  // The message being written: { id, text, sent } - `sent` is how much of the
  // text has been published, so a flush with nothing new sends nothing.
  const flush = ctx => {
    const block = ctx.block;
    clearTimeout(ctx.timer);
    ctx.timer = null;
    if (!block || block.sent === block.text.length) return;
    live.publish(ctx.key, render('./push-delta', { id: block.id, pieces: wordsOf(ctx.view, block.text) }));
    block.sent = block.text.length;
  };

  const liveEntry = (block, view) => render('./push-entry', { html: render('./_live-entry', { id: block.id, pieces: wordsOf(view, block.text) }).trim() });

  const startText = ctx => {
    ctx.block = { id: `live-${++liveCount}`, text: '', sent: 0 };
    live.publish(ctx.key, liveEntry(ctx.block, ctx.view));
  };

  const endText = (ctx, text) => {
    const block = ctx.block;
    if (!block) return record(ctx, { type: 'text', text });
    clearTimeout(ctx.timer);
    ctx.timer = null;
    ctx.block = null;
    const entry = { type: 'text', text };
    appendEntry(ctx.designDir, ctx.session.id, entry);
    live.publish(ctx.key, render('./push-final', { id: block.id, html: entryHtml(entry, ctx.view) }));
  };

  const queueOf = dKey => {
    if (!queues.has(dKey)) queues.set(dKey, []);
    return queues.get(dKey);
  };

  const turns = {
    /**
     * What this session's status line shows: 'working' (with its latest step,
     * when it started, and how many messages wait), 'checking' (Prelude checks
     * the pages after the turn), 'busy' (another session) or 'idle'.
     */
    state(folder, design, sessionId) {
      const dKey = designKey(folder, design);
      const turn = running.get(dKey);
      if (!turn) return { kind: 'idle' };
      if (turn.sessionId !== sessionId) return { kind: 'busy' };
      if (turn.ctx.checking) return { kind: 'checking' };
      return {
        kind: 'working',
        stopUrl: turn.stopUrl,
        step: turn.ctx.step,
        startedAt: turn.ctx.startedAt,
        since: sinceWords(Date.now() - Date.parse(turn.ctx.startedAt)),
        waiting: queueOf(dKey).filter(item => item.sessionId === sessionId).length,
      };
    },

    /** Whether a turn is running on the design. */
    busy: (folder, design) => running.has(designKey(folder, design)),

    /**
     * Start a turn. Returns an error message instead when one can't start.
     * `message` is what the agent is told; `shown` the person's messages as
     * the transcript keeps them ([{ text, images, lookingAt }]: several when
     * waiting messages go together). `references` are the folders the agent
     * may also read ([{ name, path }]), and `system` the folder's design
     * system, as designPrompt takes it. `view` is how the pages show entries,
     * and `onIdle` runs once the turn is over and the design is free.
     * `recap` is told instead of `preface` if the conversation can't be
     * resumed (one carried onto a fix's branch, prelude/fix-something, or
     * one grown too long for the agent): the agent starts afresh, once, with
     * what was said so far.
     * `architecture` is the project's ({ path }, architectureBrief), which a
     * design's agent reads and may propose a decision in; `drift()`, after a
     * turn of a build or a fix, checks the code it changed against it and
     * returns what doesn't match ([{ file, text, next }]), told to the agent
     * with the next message (R-4vx). `changedParts()`, after the same turns,
     * says which parts its changed files belong to ({ files, parts }, or
     * null), recorded for the chat's map (R-c1y).
     */
    start(options) {
      const { folder, design, designDir, sessionId, message, shown = null, stopUrl, references = [], system = null, shell = null, format = 'screens', kodaPath = null, stack = null, check = null, mode = 'design', systemPrompt = null, afterTurn = null, shared = [], architecture = null, drift = null, changedParts = null, preface = null, recap = null, view = plainView, onIdle = null } = options;
      const dKey = designKey(folder, design);
      if (running.has(dKey)) return { error: 'The agent is already working on this design. Wait for it to finish, or stop it.' };
      const session = readSession(designDir, sessionId);
      if (!session) return { error: 'That session no longer exists.' };

      const ctx = { designDir, session, key: sessionKey(folder, design, sessionId), seen: seenKey(folder, design, sessionId), block: null, timer: null, view, step: null, startedAt: new Date().toISOString(), checking: false };
      const designPath = `prelude/${design.id}`;
      const pending = new Map();   // tool id -> name, to label its result
      const emptying = new Map();  // tool id -> the file an empty Write names
      const emptied = new Set();   // files it emptied, deleted when the turn ends

      // What the last check found: from memory, or - after Prelude restarted -
      // from this session's last check, if no message has gone since.
      const entries = readEntries(designDir, sessionId);
      const lastCheck = entries.findLast(entry => entry.type === 'check');
      const sinceCheck = lastCheck ? entries.slice(entries.lastIndexOf(lastCheck)) : [];
      const told = findings.get(dKey) ?? (lastCheck?.told && !sinceCheck.some(entry => entry.type === 'user') ? lastCheck.told : null);

      for (const said of shown ?? [{ text: message }]) {
        record(ctx, {
          type: 'user',
          text: said.text ?? '',
          ...(said.images?.length ? { images: said.images } : {}),
          ...(said.lookingAt ? { lookingAt: said.lookingAt } : {}),
        });
      }

      const publishState = () => live.publish(ctx.key, statusMessage(turns.state(folder, design, sessionId)));

      const turn = runner.turn({
        cwd: folder.path,
        sessionId: session.claudeSessionId,
        resume: session.started === true,
        prompt: preface ? `${preface}

${withFindings(told, message)}` : withFindings(told, message),
        // A build session (step 7) brings its own instructions and permissions.
        systemPrompt: `${systemPrompt ?? designPrompt({ title: design.title, designPath, references, kind: design.kind, format, system, shell, kodaPath, stack, shared, architecture })}

${DELETING}`,
        designPath,
        mode,
        // A design's agent may propose a decision in the architecture (R-h9w).
        shared: architecture && mode === 'design' ? [...shared, architecture.path] : shared,
        references: references.map(reference => reference.path),
        onEvent: event => {
          if (event.type === 'init') {
            if (!ctx.session.started) ctx.session = updateSession(designDir, sessionId, { started: true }) ?? ctx.session;
          } else if (event.type === 'text-start') {
            startText(ctx);
          } else if (event.type === 'text-delta') {
            if (!ctx.block) startText(ctx);
            ctx.block.text += event.text;
            ctx.timer ??= setTimeout(() => flush(ctx), FLUSH_MS);
          } else if (event.type === 'text') {
            endText(ctx, event.text);
          } else if (event.type === 'tool') {
            pending.set(event.id, event.name);
            if (event.name === 'Write' && event.input?.file_path && event.input.content === '') emptying.set(event.id, event.input.file_path);
            const summary = toolSummary(event.name, event.input, folder.path);
            record(ctx, { type: 'tool', id: event.id, name: event.name, summary });
            // The status line says what it's doing now.
            ctx.step = stepOf(event.name, summary);
            publishState();
          } else if (event.type === 'tool-result') {
            // Only a write that was allowed: a refused one emptied nothing.
            if (emptying.has(event.id) && !event.isError) emptied.add(emptying.get(event.id));
            record(ctx, {
              type: 'tool-result', id: event.id, name: pending.get(event.id) ?? null,
              error: event.isError, text: String(event.text ?? '').slice(0, MAX_RESULT),
            });
          }
        },
      });

      running.set(dKey, { sessionId, stop: turn.stop, stopUrl, ctx });
      publishState();
      changed({ key: ctx.key, seen: ctx.seen, finished: false, watched: false });

      findings.delete(dKey);

      const finish = async result => {
        // A conversation that couldn't be resumed here starts afresh, told
        // what was said; the person's message is already in the transcript.
        if (result.lost && recap) {
          running.delete(dKey);
          updateSession(designDir, sessionId, { claudeSessionId: randomUUID(), started: false });
          const again = turns.start({ ...options, shown: [], preface: recap, recap: null });
          if (!again.error) return;
          running.set(dKey, { sessionId, stop: turn.stop, stopUrl, ctx });
        }
        let checked = null;   // what the check found, for afterTurn
        // A message cut off by Stop or an error is kept as far as it got.
        if (ctx.block) endText(ctx, ctx.block.text);
        // The files it emptied are the ones it deleted; one it wrote again since isn't.
        for (const path of emptied) {
          const file = resolve(folder.path, path);
          const inside = relative(folder.path, file);
          if (!inside || inside.startsWith('..') || isAbsolute(inside)) continue;
          try { if (existsSync(file) && statSync(file).isFile() && statSync(file).size === 0) rmSync(file); } catch { /* left for the person */ }
        }
        // The parts whose files it changed, worked out by Prelude from the
        // files, not by the agent: the chat draws them on the map (R-c1y).
        if (changedParts) {
          try {
            const changed = await changedParts();
            if (changed) record(ctx, { type: 'parts', files: changed.files, parts: changed.parts });
          } catch (error) { console.error(error); }
        }
        // The code it changed, checked against the architecture (R-4vx): what
        // doesn't match is said to the person now, and to the agent with the
        // next message, beside what the check below finds.
        let drifted = [];
        if (drift) {
          try { drifted = (await drift()) ?? []; } catch (error) { console.error(error); }
          if (drifted.length) {
            record(ctx, { type: 'note', failed: true, text: `${drifted.length === 1 ? '1 thing in the code this turn changed doesn’t' : `${drifted.length} things in the code this turn changed don’t`} match the architecture: ${drifted.map(finding => finding.text).join(' ')} The agent is told with your next message.` });
          }
        }
        const driftTold = drifted.map(finding => ({ architecture: true, state: null, path: finding.file, error: `${finding.text} ${finding.next}` }));
        if (driftTold.length) findings.set(dKey, driftTold);
        // Render what the agent made, and say what doesn't: to the person now,
        // and to the agent with the next message. A build checks every screen
        // each time its turn ends, stopped or not (R-9xe): what it changed
        // before it stopped is in the app.
        if (check && (result.ok || mode === 'build')) {
          ctx.checking = true;
          publishState();
          try {
            // A page that doesn't render is the agent's to fix. One that renders
            // differently from its approved snapshot is the person's to judge
            // (the agent was probably asked to change it), so it's only shown.
            const result = await check();
            if (result?.blocked) record(ctx, { type: 'note', text: result.blocked });
            else if (result) {
              checked = result;
              const { failures, rendered = 0, differ = [], warnings = [], ahead = [] } = result;
              // Rules that point at nothing are the agent's to fix too.
              // A build session is also told what the app's models still lack.
              const told = [
                ...failures,
                ...warnings.map(warning => ({ state: null, path: 'RULES.md', error: warning })),
                ...(mode === 'build' ? ahead.map(member => ({ state: null, path: 'models', error: `the states have ${member}, which the app's model doesn't have yet` })) : []),
                // ...and how its port differs from the approved screens.
                ...(mode === 'build' ? differ.slice(0, 8).map(d => ({ info: true, state: null, path: d.name, error: `\n${d.diff.split('\n').slice(0, 14).join('\n')}` })) : []),
                ...driftTold,
              ];
              if (told.length) findings.set(dKey, told);
              // Kept with the check, so a restarted Prelude still tells the agent.
              // A fix's check (step 11) also names the designs it rendered, and those whose pages differ.
              const across = result.designs ? { designs: result.designs, differDesigns: result.differDesigns ?? [] } : {};
              record(ctx, { type: 'check', failures, rendered, differ: differ.map(d => d.name), warnings, ahead, ...across, ...(told.length ? { told } : {}) });
            }
          } catch { /* a failed check is no reason to lose the turn */ }
        }
        record(ctx, {
          type: 'turn',
          ok: result.ok === true,
          stopped: result.stopped === true,
          error: result.error ?? null,
          costUsd: result.costUsd ?? null,
        });
        updateSession(designDir, sessionId, {});
        // A build session commits the turn to its branch, transcript included.
        // (The entry saying so is committed with the next turn.)
        if (afterTurn) {
          try {
            const notes = await afterTurn({ message, result, check: checked });
            for (const note of [notes].flat()) if (note) record(ctx, note);
          } catch (error) {
            record(ctx, { type: 'note', failed: true, text: `Prelude couldn’t commit this turn: ${String(error.stderr || error.message).trim().split('\n').slice(-2).join(' ')}` });
          }
        }
        running.delete(dKey);
        live.publish(ctx.key, statusMessage({ kind: 'idle' }));
        changed({ key: ctx.key, seen: ctx.seen, finished: true, watched:(live.listening?.(ctx.key) ?? 0) > 0 });
        if (onIdle) {
          try { onIdle(); } catch (error) { console.error(error); }
        }
      };
      turn.done.then(finish, error => finish({ ok: false, error: String(error?.message ?? error) }));
      return { ok: true };
    },

    stop(folder, design, sessionId) {
      const turn = running.get(designKey(folder, design));
      if (turn?.sessionId === sessionId) turn.stop();
    },

    /** A message to send when the turn ends: { id, sessionId, text, prompt, images, lookingAt }. */
    enqueue(folder, design, item) {
      const queued = { ...item, id: `q-${++queuedCount}` };
      queueOf(designKey(folder, design)).push(queued);
      return queued;
    },

    /** The messages waiting in a session, in the order written. */
    queued(folder, design, sessionId) {
      return queueOf(designKey(folder, design)).filter(item => item.sessionId === sessionId);
    },

    /** Take one waiting message back: it, or null. */
    cancel(folder, design, id) {
      const queue = queueOf(designKey(folder, design));
      const at = queue.findIndex(item => item.id === id);
      return at < 0 ? null : queue.splice(at, 1)[0];
    },

    /**
     * Take the waiting messages of a session - or, with none named, of the
     * session whose message has waited longest - out of the queue.
     */
    takeQueued(folder, design, sessionId = null) {
      const queue = queueOf(designKey(folder, design));
      const which = sessionId ?? queue[0]?.sessionId;
      const taken = queue.filter(item => item.sessionId === which);
      queues.set(designKey(folder, design), queue.filter(item => item.sessionId !== which));
      return taken;
    },

    /**
     * What the agent is writing in a session now, for a page to render in
     * its transcript: { id, html } (the words so far, as markdown), or null.
     */
    streaming(folder, design, sessionId, view = plainView) {
      const turn = running.get(designKey(folder, design));
      const block = turn?.sessionId === sessionId ? turn.ctx.block : null;
      return block && { id: block.id, pieces: wordsOf(view, block.text) };
    },

    /**
     * The messages a newly connected page needs: entries it hasn't rendered,
     * the message being written, then the status. `shown` is the live entry
     * the page rendered (its id), if any: brought up to date while it's
     * still being written, and taken away once it's been saved, since the
     * saved entry comes with the others.
     */
    catchUp(folder, design, designDir, sessionId, from, view = plainView, shown = null) {
      const messages = [];
      const turn = running.get(designKey(folder, design));
      const block = turn?.sessionId === sessionId ? turn.ctx.block : null;
      if (shown && shown !== block?.id) messages.push(render('./push-remove', { id: shown }));
      messages.push(...readEntries(designDir, sessionId, from)
        .map(entry => entryMessage(entry, view))
        .filter(Boolean));
      if (block) {
        messages.push(block.id === shown
          ? render('./push-delta', { id: block.id, pieces: wordsOf(view, block.text) })
          : liveEntry(block, view));
      }
      messages.push(statusMessage(this.state(folder, design, sessionId)));
      return messages;
    },
  };
  return turns;
}
