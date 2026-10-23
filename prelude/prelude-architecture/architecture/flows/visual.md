# A visual in a message
decisions: D-v3x, D-f4q

From the agent drawing a flow or a map, or a build changing code, to it showing in the chat with the design system.

1. agent: gives every prompt the current vocabulary, from visuals, when the project has an architecture
2. claude: writes a fenced `prelude-flow-1` or `prelude-map-1` block in its message
3. turns: saves the message to the transcript as written, and streams it
4. architecture: after a build or fix turn, maps the changed files to their parts, and turns records them as a parts entry
5. server: gives the present context the parts and layers of the session's branch, as they stand now
6. views: splits the message on top-level fences with visuals, and renders the text between with Koda's renderMarkdown
7. visuals: parses each block by its tag's kind and version and checks its part ids, or says it isn't a visual
8. views: renders a visual with its `_visual-<kind>.eta` partial and the design system, and anything else as a code block
