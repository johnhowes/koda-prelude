// The agent: the Claude Code CLI, run once per turn in the chosen folder.
//
//   runner.turn({ cwd, sessionId, resume, prompt, systemPrompt, designPath, onEvent })
//     -> { done: Promise<{ ok, stopped?, error?, costUsd? }>, stop() }
//
// onEvent gets a few plain events:
//
//   { type: 'init' }                          the CLI has started the conversation
//   { type: 'text-start' }                    the agent starts saying something
//   { type: 'text-delta', text }              more of it, as it's written
//   { type: 'text', text }                    all of it
//   { type: 'tool', id, name, input }         it used a tool
//   { type: 'tool-result', id, isError, text }
//
// The agent gets ordinary file tools and nothing else (plan: ground rule 3).
// It may read anything in the folder and write only inside its design's
// folder, never in that design's sessions/. Anything else is refused without
// asking. No MCP servers, no skills, and none of this machine's settings, so a
// broad "allow" in someone's user settings can't widen what the agent may write.

import { spawn } from 'node:child_process';

const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'];

export function permissionArgs(designPath) {
  const scope = `${designPath}/**`;
  const sessions = `${designPath}/sessions/**`;
  return [
    '--tools', TOOLS.join(','),
    '--allowedTools', ['Read', 'Glob', 'Grep', `Edit(${scope})`, `Write(${scope})`].join(','),
    '--disallowedTools', [`Edit(${sessions})`, `Write(${sessions})`].join(','),
    '--permission-mode', 'dontAsk',
  ];
}

export function createCliRunner({ command = 'claude', model = null } = {}) {
  return {
    turn({ cwd, sessionId, resume, prompt, systemPrompt, designPath, onEvent = () => {} }) {
      const args = [
        '-p',
        '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        ...permissionArgs(designPath),
        '--strict-mcp-config',
        '--setting-sources', '',
        '--disable-slash-commands',
        '--append-system-prompt', systemPrompt,
        // Otherwise a resumed conversation keeps its first system prompt for
        // ever; ours changes as Prelude does.
        '--system-prompt-snapshot', 'off',
        resume ? '--resume' : '--session-id', sessionId,
        ...(model ? ['--model', model] : []),
      ];
      const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stopped = false;
      let stderr = '';
      child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });

      const done = new Promise(resolve => {
        const read = createStreamReader(onEvent);
        let result = null;
        let buffer = '';
        child.stdout.on('data', chunk => {
          buffer += chunk;
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let message;
            try { message = JSON.parse(line); } catch { continue; }
            result = read(message) ?? result;
          }
        });
        child.on('error', error => resolve({ ok: false, error: `The agent couldn't start: ${error.message}` }));
        child.on('close', code => {
          if (stopped) return resolve({ ok: false, stopped: true });
          if (result) return resolve(result);
          const detail = stderr.trim().split('\n').slice(-3).join(' ');
          if (/no conversation found/i.test(detail)) {
            return resolve({ ok: false, error: 'This conversation can’t be resumed on this machine. Start a new session: it picks up from the design’s files.' });
          }
          resolve({ ok: false, error: `The agent stopped without finishing (exit ${code}). ${detail}`.trim() });
        });
      });

      child.stdin.end(prompt);
      return {
        done,
        stop() {
          stopped = true;
          child.kill();
        },
      };
    },
  };
}

/** Turns the CLI's stream-json messages into the events above; returns the result when it comes. */
//
// Text streams as partial messages (content_block_start / _delta / _stop) when
// the CLI sends them; the whole assistant message that follows repeats that
// text, so it's used for text only when nothing streamed.
export function createStreamReader(onEvent) {
  const blocks = new Map();   // index -> text so far, for text blocks
  let streamed = false;

  return function read(message) {
    if (message.type === 'system' && message.subtype === 'init') {
      onEvent({ type: 'init' });
      return null;
    }
    if (message.type === 'stream_event') {
      const e = message.event ?? {};
      if (e.type === 'content_block_start' && e.content_block?.type === 'text') {
        streamed = true;
        blocks.set(e.index, '');
        onEvent({ type: 'text-start' });
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && blocks.has(e.index)) {
        blocks.set(e.index, blocks.get(e.index) + e.delta.text);
        onEvent({ type: 'text-delta', text: e.delta.text });
      } else if (e.type === 'content_block_stop' && blocks.has(e.index)) {
        onEvent({ type: 'text', text: blocks.get(e.index) });
        blocks.delete(e.index);
      }
      return null;
    }
    if (message.type === 'assistant') {
      for (const part of message.message?.content ?? []) {
        if (part.type === 'text' && !streamed && part.text.trim()) onEvent({ type: 'text', text: part.text });
        if (part.type === 'tool_use') onEvent({ type: 'tool', id: part.id, name: part.name, input: part.input ?? {} });
      }
      return null;
    }
    if (message.type === 'user') {
      for (const part of message.message?.content ?? []) {
        if (part.type !== 'tool_result') continue;
        const text = Array.isArray(part.content)
          ? part.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
          : String(part.content ?? '');
        onEvent({ type: 'tool-result', id: part.tool_use_id, isError: part.is_error === true, text });
      }
      return null;
    }
    if (message.type === 'result') {
      const ok = message.is_error !== true && message.subtype === 'success';
      return {
        ok,
        costUsd: message.total_cost_usd ?? null,
        error: ok ? null : String(message.result || message.subtype || 'The agent reported an error.'),
      };
    }
    return null;
  };
}

/** The instructions appended to Claude Code's own system prompt for a design session. */
export function designPrompt({ title, designPath }) {
  return `You are working in Prelude, a tool where a person designs an application with you.

You are working on the design "${title}". Its folder is ${designPath}/, relative to the current directory, which is the person's repository.

- Write only inside ${designPath}/, and never inside ${designPath}/sessions/. Everything else in the repository is for reading: use it to understand the product, its domain and its existing UI.
- A design is built up over many sessions, and this conversation is one of them. The design's memory is its files, not past conversations. At the start of a session, read ${designPath}/NOTES.md if it exists, and look at what is in ${designPath}/screens/.
- Keep ${designPath}/NOTES.md current: what the design is for, the decisions made (each with its reason), and the open questions. Update it before you finish any turn in which something was decided or learned. Keep it short, and edit it rather than appending a log.
- Screens are plain, static HTML files in ${designPath}/screens/, named NN-kebab-name.html (for example 01-sign-in.html), each with a short <title> that names the screen. The person watches them in a preview that reloads as you save. Styles shared by screens go in ${designPath}/styles.css, linked from a screen as ../styles.css. Link between screens with relative links. No build step, no frameworks, no requests to other sites.
- When a request is ambiguous or large, say briefly what you plan to do and ask before building. Keep replies short.`;
}

/** A one-line description of a tool use, with paths shown relative to the folder. */
export function toolSummary(name, input, cwd) {
  const rel = path => {
    const p = String(path ?? '').replace(/\\/g, '/');
    const base = String(cwd).replace(/\\/g, '/').replace(/\/?$/, '/');
    return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : p;
  };
  if (input.file_path) return rel(input.file_path);
  if (name === 'Glob' || name === 'Grep') return [input.pattern, input.path && `in ${rel(input.path)}`].filter(Boolean).join(' ');
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}
