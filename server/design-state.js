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

    /** Someone picked a state. Says whether that was news. Forms' changes start again. */
    showState(key, stateId) {
      if (of(key).state === stateId) return false;
      of(key).state = stateId;
      of(key).copy = null;
      announce(key);
      return true;
    },

    /**
     * The working copy of the current state's data, once forms have changed it:
     * { stateId, data }, or null. Changing it is not announced: the frame that
     * posted already shows the answer, and reloading it would undo what Koda
     * did in the page (a drawer closing, a row replaced).
     */
    copy: key => of(key).copy ?? null,
    setCopy(key, stateId, data) {
      of(key).copy = { stateId, data };
    },

    /** "Reset data": back to the state's file, in every window. */
    resetCopy(key) {
      if (!of(key).copy) return false;
      of(key).copy = null;
      announce(key);
      return true;
    },

    /**
     * A state's file changed while forms had changed its data (R-a6x): the
     * changes go, so the pages read the file as it is now, and the design
     * bar says so once - in the window that shows the design next. The files'
     * change is announced by whoever saw it.
     */
    dropCopy(key, notice) {
      of(key).copy = null;
      of(key).reset = notice;
    },
    takeReset(key) {
      const notice = of(key).reset ?? null;
      of(key).reset = null;
      return notice;
    },

    /**
     * The design's custom size, one, replacing the last (R-w3j): every window
     * offers it after the shell's sizes. Which size a window shows is its own.
     */
    custom: key => of(key).custom ?? null,
    setCustom(key, size) {
      of(key).custom = size;
      announce(key);
    },

    /**
     * The session the chat shows ("new" before one starts): where Answer,
     * Start with this, a capture or a marked-up image put their message.
     */
    session: key => of(key).session ?? null,
    showSession(key, sessionId) {
      of(key).session = sessionId;
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
