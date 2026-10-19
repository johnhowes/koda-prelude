# When I try to open an existing design, the preview pane…

## The problem

1. At first, opening a design's preview said "The renderer stopped. 15:
   00007FF90A79DDA7 BaseThreadInitThunk+23 16: … RtlUserThreadStart+44".
   After merging and restarting, that wasn't seen again, and isn't fixed here.
   `server/renderers.js` still shows only the last two lines of a crashed
   renderer's output, which are the bottom of a native stack. The reason is
   at the top.
2. Once merged and restarted, every design the person opened went to an old
   session, though the project page said everything was built.

## The cause (2)

Opening a design goes to its latest session while that's "still open"
(R-o4s, `server/main.js` `stillOpen`). That means a turn ended there in the
last week that the person hasn't opened since. What they've opened is kept
in `~/.prelude/seen.json`, keyed `<folder id>/<design>/<session>`, and a
folder's id is a hash of its path. Sessions watched on a design's branch
were marked under the branch's worktree id. Once merged, the same sessions
are under the project's folder, where seen.json had no mark for them, so
every design merged in the last week counted as unseen.

## The change

- `server/turns.js`: a new `seenKey`, the project's id (a branch's
  `parentId`) with the design and session. Live channels still use
  `sessionKey`.
- `server/home.js`: `seenAt` reads seen.json by `seenKey`. A mark made
  before this fix, under a worktree's id, still counts: it matches the
  design and session under any folder. Home's Needs you uses it.
- `server/main.js`: opening a session, and a turn that ends while it's on
  screen, mark by `seenKey`. `stillOpen` reads with `seenAt`.
- Design Workspace: R-o4s says seen carries across a merge. NOTES.md
  records it.

## Tests

Run `node --test test/home.test.js test/chat.test.js` (or `npm test`).
`home.test.js` has a new test, "a session seen on its branch stays seen
once the branch is merged".

## What to check

- Restart Prelude. Open designs you'd already seen on their branches (Build,
  Landing Page, Design Workspace): each should open a new session with its
  starting points, not the old one.
- A design whose agent is working, or whose turn ended unseen, still opens
  that session.
- Home's Needs you doesn't list finished turns you'd already seen on a
  branch.
