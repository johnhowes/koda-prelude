// A runner for tests: each turn plays the next script of agent events through
// the same interface as the CLI runner. A { type: 'wait' } step holds the turn
// until the test calls release(). queue(...scripts) adds scripts for later turns.
// A { type: 'lost' } step ends the turn as a conversation that can't be resumed.
// carry() records what was carried, and says it was (`carries`, true by default).

export function createFakeRunner(scripts = []) {
  const turns = [];
  const carried = [];
  let release = () => {};

  return {
    turns,
    carried,
    carries: true,
    release: () => release(),
    queue: (...more) => { scripts.push(...more); },
    carry(args) {
      carried.push(args);
      return this.carries;
    },
    turn(turn) {
      turns.push(turn);
      const script = scripts.shift() ?? [{ type: 'text', text: 'Done.' }];
      let stopped = false;
      const gate = new Promise(resolve => { release = resolve; });
      const done = (async () => {
        turn.onEvent({ type: 'init' });
        for (const step of script) {
          await new Promise(resolve => setImmediate(resolve));
          if (stopped) return { ok: false, stopped: true };
          if (step.type === 'wait') { await gate; continue; }
          if (step.type === 'fail') return { ok: false, error: step.error };
          if (step.type === 'lost') return { ok: false, lost: true, error: 'This conversation can’t be resumed on this machine.' };
          turn.onEvent(step);
        }
        if (stopped) return { ok: false, stopped: true };
        return { ok: true, costUsd: 0 };
      })();
      return { done, stop() { stopped = true; release(); } };
    },
  };
}
