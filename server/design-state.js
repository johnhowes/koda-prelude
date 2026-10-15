// What each design looks like right now, shared by every window showing it:
// which screen is current, how many times its files have changed, and how many
// pop-out windows are open. It lives on the server, in memory and on this
// machine only (plan: ground rule 5) - it describes the moment, not the design,
// so none of it is written to the folder.
//
// Every change is announced on the design's channel as `design-changed`, and
// each design surface reloads itself when it hears it. One event for
// everything keeps the windows in step without any of them holding state.

export const designChannel = key => `design:${key}`;

export function createDesignState({ live }) {
  const designs = new Map();   // designKey -> { version, current, windows }

  const of = key => {
    if (!designs.has(key)) designs.set(key, { version: 0, current: null, state: null, windows: 0 });
    return designs.get(key);
  };

  const announce = key => {
    const design = of(key);
    design.version++;
    live.publish(designChannel(key), `design-changed:${design.version}`);
  };

  return {
    version: key => of(key).version,
    current: key => of(key).current,
    windows: key => of(key).windows,

    /** The design's files changed. */
    filesChanged: announce,

    /**
     * Someone picked a screen, or followed a link to one. Says whether that was
     * news. `shown` is the screen on show when none has been picked (the first),
     * so a frame loading it for the first time isn't mistaken for a change.
     */
    show(key, screenId, { shown = null } = {}) {
      if ((of(key).current ?? shown) === screenId) {
        of(key).current = screenId;
        return false;
      }
      of(key).current = screenId;
      announce(key);
      return true;
    },

    /** The design-wide state on show (a hosted design's fake dataset), or null for its default. */
    state: key => of(key).state,

    /** Someone picked a state. Says whether that was news. */
    showState(key, stateId) {
      if (of(key).state === stateId) return false;
      of(key).state = stateId;
      announce(key);
      return true;
    },

    /** A pop-out window opened; returns what to call when it closes. */
    windowOpened(key) {
      of(key).windows++;
      announce(key);
      return () => {
        of(key).windows = Math.max(0, of(key).windows - 1);
        announce(key);
      };
    },
  };
}
