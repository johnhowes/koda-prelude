# A message to the agent
decisions: D-c3t, D-l5w, D-b9k, D-r7s, D-v3x

What happens from the person sending a message to the turn's result showing in every window.

1. server: takes the POST, makes the design's branch if it has none, and starts a turn with the prompt for the design's kind and mode
2. turns: queues it if the design's agent is busy, then prepends what Prelude found after the last turn
3. agent: builds the prompt (with the visual vocabulary, once there's an architecture) and permission flags, and spawns the CLI in the worktree
4. claude: reads the project and writes the design's files
5. turns: saves finished entries to the transcript, the agent's words as written, and streams them live
6. sessions: appends each entry to `transcript.jsonl`
7. live: sends the entries and `design-changed` to every window on the design's channel
8. host: after the turn, renders every route in every state and compares the approved screens
9. architecture: for build and fix turns, checks the changed files against these files and names their parts, which turns records for the chat's map
10. branches: commits the turn to the design's branch
11. views: when an entry is shown, renders its words and draws its visuals (flow: visual)
