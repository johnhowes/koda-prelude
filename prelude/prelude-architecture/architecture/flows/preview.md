# A design's page in the preview
decisions: D-p2o, D-r7s

How a URL on a design's own origin becomes a page in the design surface.

1. server: sees the request's host is a design's preview origin and hands it to the host
2. host: matches the route, finds its data in the current state's working copy, and picks the layout
3. renderer: renders the page, its regions and its layout in the sandbox, or another stack's host does over HTTP
4. host: answers a whole page or a fragment, as the request asks
5. live: when the state or the files change, tells the frame to re-render
