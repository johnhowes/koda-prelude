// Turns: one message to the agent and everything it does in reply.
//
// One turn runs at a time per design, whichever of the design's sessions it
// belongs to, so two sessions never write the same files at once. Every event
// is appended to the transcript first and published second, so a page that
// renders the transcript and then subscribes from where it left off misses
// nothing and sees nothing twice.
//
// The agent's words stream as they're written: a "live" entry is pushed when a
// message starts, its text arrives in small batches, and when the message ends
// it is saved and the live entry is replaced by the finished one, rendered as
// markdown. Only finished messages are saved; the live text exists only on the
// pages watching.
//
// Messages sent while the agent works wait (R-z4k): each session's in the
// order written. When a turn ends, `onIdle` is told, and sends them together
// as the next message.

import { designPrompt, toolSummary } from './agent.js';
import { appendEntry, readEntries, readSession, updateSession } from './sessions.js';
import { render } from './views.js';
import { presentEntry, sinceWords, stepOf } from './workspace.js';

const MAX_RESULT = 2000;
const FLUSH_MS = 50;

export const designKey = (folder, design) => `${folder.id}/${design.id}`;
export const sessionKey = (folder, design, sessionId) => `${folder.id}/${design.id}/${sessionId}`;

/**
 * How entries are shown on the pages watching: `present` readies an entry
 * for _entry.eta, and `base` is the design's address, for its links.
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

/** The person's message, preceded by what Prelude's last check of the design found. */
export function withFindings(failures, message) {
  if (!failures?.length) return message;
  const line = f => `- ${f.path}${f.state ? ` (state "${f.state}")` : ''}: ${f.error}`;
  const fix = failures.filter(f => !f.info);
  const info = failures.filter(f => f.info);
  const parts = [];
  if (fix.length) parts.push(`(From Prelude, not the person: after your last turn, these didn't render, or point at nothing. Fix them along with what's asked below.)\n${fix.map(line).join('\n')}`);
  if (info.length) parts.push(`(From Prelude, for your information: how pages now differ from the screens the person approved. Expected porting differences are theirs to approve; anything else means the port isn't faithful.)\n${info.map(line).join('\n')}`);
  return `${parts.join('\n\n')}\n\n${message}`;
}

/**
 * `onChange({ key, finished, watched })` hears each turn start and end: `key`
 * is its session's, and `watched` whether a page showed the session as it ended.
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
  // text has been published, so a page joining now gets exactly that much.
  const flush = ctx => {
    const block = ctx.block;
    clearTimeout(ctx.timer);
    ctx.timer = null;
    if (!block || block.sent === block.text.length) return;
    live.publish(ctx.key, render('./push-delta', { id: block.id, text: block.text.slice(block.sent) }));
    block.sent = block.text.length;
  };

  const startText = ctx => {
    ctx.block = { id: `live-${++liveCount}`, text: '', sent: 0 };
    live.publish(ctx.key, render('./push-entry', { html: render('./_live-entry', { id: ctx.block.id, text: '' }).trim() }));
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
     */
    start({ folder, design, designDir, sessionId, message, shown = null, stopUrl, references = [], system = null, shell = null, format = 'screens', kodaPath = null, stack = null, check = null, mode = 'design', systemPrompt = null, afterTurn = null, shared = [], preface = null, view = plainView, onIdle = null }) {
      const dKey = designKey(folder, design);
      if (running.has(dKey)) return { error: 'The agent is already working on this design. Wait for it to finish, or stop it.' };
      const session = readSession(designDir, sessionId);
      if (!session) return { error: 'That session no longer exists.' };

      const ctx = { designDir, session, key: sessionKey(folder, design, sessionId), block: null, timer: null, view, step: null, startedAt: new Date().toISOString(), checking: false };
      const designPath = `prelude/${design.id}`;
      const pending = new Map();   // tool id -> name, to label its result

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
        systemPrompt: systemPrompt ?? designPrompt({ title: design.title, designPath, references, kind: design.kind, format, system, shell, kodaPath, stack, shared }),
        designPath,
        mode,
        shared,
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
            const summary = toolSummary(event.name, event.input, folder.path);
            record(ctx, { type: 'tool', id: event.id, name: event.name, summary });
            // The status line says what it's doing now.
            ctx.step = stepOf(event.name, summary);
            publishState();
          } else if (event.type === 'tool-result') {
            record(ctx, {
              type: 'tool-result', id: event.id, name: pending.get(event.id) ?? null,
              error: event.isError, text: String(event.text ?? '').slice(0, MAX_RESULT),
            });
          }
        },
      });

      running.set(dKey, { sessionId, stop: turn.stop, stopUrl, ctx });
      publishState();
      changed({ key: ctx.key, finished: false, watched: false });

      findings.delete(dKey);

      const finish = async result => {
        let checked = null;   // what the check found, for afterTurn
        // A message cut off by Stop or an error is kept as far as it got.
        if (ctx.block) endText(ctx, ctx.block.text);
        // Render what the agent made, and say what doesn't: to the person now,
        // and to the agent with the next message.
        if (check && result.ok) {
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
              ];
              if (told.length) findings.set(dKey, told);
              // Kept with the check, so a restarted Prelude still tells the agent.
              record(ctx, { type: 'check', failures, rendered, differ: differ.map(d => d.name), warnings, ahead, ...(told.length ? { told } : {}) });
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
        changed({ key: ctx.key, finished: true, watched: (live.listening?.(ctx.key) ?? 0) > 0 });
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
     * The messages a newly connected page needs: entries it hasn't rendered,
     * the message being written (as far as it has been published), then the
     * status.
     */
    catchUp(folder, design, designDir, sessionId, from, view = plainView) {
      const messages = readEntries(designDir, sessionId, from)
        .map(entry => entryMessage(entry, view))
        .filter(Boolean);
      const turn = running.get(designKey(folder, design));
      const block = turn?.sessionId === sessionId ? turn.ctx.block : null;
      if (block) {
        const html = render('./_live-entry', { id: block.id, text: block.text.slice(0, block.sent) }).trim();
        messages.push(render('./push-entry', { html }));
      }
      messages.push(statusMessage(this.state(folder, design, sessionId)));
      return messages;
    },
  };
  return turns;
}
