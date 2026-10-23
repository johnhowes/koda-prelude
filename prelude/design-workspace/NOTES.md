# Design Workspace - notes

A redesign of Prelude's design page (`/f/:folder/d/:design`, its sessions and
the pop-out window): today `server/views/_session.eta`, `_design.eta`,
`_branch.eta`, `_entry.eta`, `_status.eta`, `_composer.eta`, `_window.eta`.
It renders in the shell's `workspace` and `window` layouts. The routes carry
`"from": "@app/server/views/…"`, so the build ports it back.

Pages: Design page, with drawers (About the design, Rules, Open
questions) and modals (an image, Mark up, Turn on dictation); Pop-out
window. The fake project is a lender's borrower portal, so sizes (phone,
tablet) and a second client (its mobile app) mean something. States:
typical, pages differ, doesn't render, agent working, new design, update
clashed, popped out, new session; and for visuals in the chat: a flow and
a map, several visuals, a visual not drawn, visuals popped out, drawing a
visual (streaming), ask and fix (a fix's conversation, its own design).

All seven items of the first review are now designed or settled (item 4,
the record picker, was dropped).

## Decisions

- **Scope: 1-3 of the review, plus the pop-out** (the person, 2026-10-17):
  the header, the design bar, and check results that lead somewhere.
- **A one-line header.** Crumbs and title, then the branch as one button
  with pills for what to act on (check, behind main, a clash). It opens a
  drawer (`/about`) with the branch in full and its actions, what the design
  uses, and what the agent can read. An update that clashed also shows as a
  notice above the work, since it holds the branch.
- **The chat owns its toolbar**: sessions menu, Show Agent/Tools.
- **The design page is for designing only** (the person, 2026-10-20): every
  build session opens in Build (`prelude/build`), so the design page has no
  Design | App switch or App mode, no "This session builds …" notice, no
  "Next:" entry, no Build pill or build sessions in the sessions menu, and
  no build variants of the review strip ("The build changed how … looks",
  "All pages match", "Nothing is approved to check against"): a build's
  check is its session's. The header's Build button, to the Build page,
  stays. The app already dropped all but the strip's variants
  (`_design-bar.eta`, `s.stage`), which the build removes.
- **The design bar reads "what am I looking at", then "how"**: page (Refresh and Open in browser moved into its menu, since they act on
  the page), state, Send event, Reset data; then size, client, Pop out.
- **Review strip under the bar** (a `.notice`, edge to edge), only when
  there's something to do: a page that doesn't render, pages that differ
  (with Approve again), or none approved yet. Its menu lists the pages;
  each shows that page in the state the check named. In the chat, a
  check's pages that don't render are listed, each with Show; pages that
  differ are only counted in one line, with no list (the person,
  2026-10-20: a change can make 60 differ, and the strip lists them).
  The page count is gone.
- **Size and client are not states** (the person asked, 2026-10-17). States
  are data; size and client are how one window looks at it. They're per
  window (in the surface's URL), so the pop-out can show a
  phone while the panel fits. Page and state stay shared, as today.
- **Sizes**: Fit the panel (default), then fixed sizes, then Custom (width
  and height fields, 200-4000 px; the person, 2026-10-17). One size at a
  time, not several side by side (the person, 2026-10-17). The custom size
  is remembered for the design (the person, 2026-10-17): one, replaced
  when another is set, listed after the shell's sizes in every window
  (`POST …/size`); which size a window shows stays its own. At a size the
  frame keeps that shape, scaled down to fit (container units in the
  design; the app's iframe needs a transform from its measured size).
- **Sizes and clients are declared by the app shell** (the person agreed,
  2026-10-17): `prelude-shell/clients.json`, the same for every design.
  Prelude's: Small window, Laptop, Desktop; Browser and Desktop app. The
  states here show a borrower portal's own (Phone, Tablet; its mobile app),
  as its shell would declare them.
- **Clients**: what the page runs in. The desktop app's whole difference is
  a root attribute (`data-desktop`, which shows `[data-desktop-only]`) plus
  native windows and the system browser. So a client is attributes on the
  previewed page's root, and words saying what else differs; Prelude can't
  run the client. For Prelude's own design page the desktop app changes
  nothing visible; it matters for Landing Page's Open a project (Choose…).
- **The design's forms post dotted fields** (`surface.current`,
  `surface.state`) so the preview works; the app posts `screen` and `state`.
  The composer posts hidden `type` and `action` for the same reason: a
  refused message re-renders from the posted fields alone, so the form must
  carry its own action. The app's composer posts only `message`. Starting
  a session is an `update` of the design in the design, so its refusal
  re-renders with the design's data.

- **Images in the message box** (the person, 2026-10-17): a sketch, a
  Figma export, a screenshot of a problem. Attach (paperclip), paste into
  the box, or drop on it. Each uploads at once (`POST …/attachments`, a
  `ko-form` part, so the message isn't sent) into the session's draft and
  comes back as a thumbnail with Remove; Send posts their ids. Sent
  messages show the images above the bubble, each opening full size. The
  app keeps them with the session and tells the agent their paths, so it
  reads them (the CLI's Read takes images). Paste and drop are the one
  script: moving a File into the upload's input. The box grows as you type.
  Components (`.attachments` …) went into the design system.
- **A thumbnail opens its image full size** (the person, 2026-10-17), in
  the modal (`/images/:image`), whether it's waiting to send or sent; Open
  in browser for its own size. Added a wide modal to the shell
  (`.modal-wide`) for it.
- **What you're looking at goes with the message** (the person,
  2026-10-17): a chip at the box's foot, "Compare offers · Typical ·
  Phone", on by default, off for a message about something else. Page and
  state come from the server and follow the design (`/looking-at`, reloaded
  on `design-changed`); the size and client are the surface beside the
  chat's, written by it in `#lookingSize` and read with a binding, and left
  out at Fit and Browser. A sent message shows what it was about under
  its bubble. Added `.chip` to the design system.
- **Messages wait while the agent works** (the person, 2026-10-17): the
  box stays open, Send says "Send when it's done", and each waiting message
  shows under the transcript, dashed, with Cancel. When the turn ends they
  go together, in order, as the next message; Stop puts them back in the
  box instead (rules R-z4k, R-9cn).
- **Waiting messages can only be cancelled**, not edited (the person,
  2026-10-17): cancel and retype.
- **Drafts are kept** (the person, 2026-10-17): each session's message box
  keeps its text and images on the server, the text saved 0.8s after the
  person stops typing (`POST …/draft`, a hidden `ko-form` part following
  the box with a binding), so a reload or another session and back finds
  it. "Draft kept" says so quietly. Sending empties it.
- **Marking up an image** (the person, 2026-10-17): Mark up on the
  full-size view opens the image on a canvas in the modal: Pen, Arrow, Box,
  Undo, Clear, in the danger colour. "Put it in the message" adds a PNG copy
  to the message box (in place of the original if it was waiting there);
  the original never changes. Not a desktop-only feature: a canvas works in
  any browser. Canvas drawing is the script; it reads the colour from CSS.
  Pointer-only is fine: words say the same (the person, 2026-10-17). No
  text tool for now (the person, 2026-10-17).
  The tray has an id now, so the modal can aim at it. Added radio options
  to the design system's `.segmented` for the tools.
- **Capture the page** (the person, 2026-10-17): Capture in the design bar
  (after Reset data: it acts on what's on show), a menu of What's in view
  or The whole page. The server renders the page as that window shows it
  (page, state, size, client) and adds the PNG to the message
  box (`POST …/capture`); a line beside it says so, and the tray reloads on
  `draft-changed`, so a capture from the pop-out reaches the chat. At Fit,
  "in view" is the frame's size, measured by a ResizeObserver script. The
  server renders it (a headless browser), not the client: a cross-origin
  frame can't be read from the page, and it works the same in both
  clients. Captures are named "Page – State – 390×844.png".
- **Capture pictures where the frame is, and the desktop app what's on
  screen** (the person, 2026-10-20: capturing over the Mark up modal gave
  the page beneath). The server opened the page picked, never a drawer or
  modal over it (no address changes when one opens) or a page reached by a
  link. Now the framed page reports where it is: the design's origin adds a
  script to the pages it serves into a frame (beside `withClient`,
  host.js), which on each `koda:attached` and popstate posts
  `{ type: 'prelude:where', at }` to the parent: an open overlay region's
  `ko-location` (`#modal`, `#drawer`), else its own path. The surface keeps
  it in `frame.at` (beside the frame, `form="capture-form"`), and the
  server opens that instead of `page` when it's a path its routes answer,
  an overlay route rendering over its page as deep links do; the name
  takes that route's title. Opened afresh, what's typed isn't in it,
  so in the desktop app What's in view is the app's own picture of the
  frame: `desktop.js` takes a click on `[data-capture-shown]` (closing the
  menu first, so it isn't in the picture), asks the shell for the frame's
  pixels (`preludeDesktop.capture(rect, scale)`: WebView2's DevTools
  `Page.captureScreenshot` clipped to the iframe, scaled by `1 / --scale`
  so a sized frame keeps its real pixels), puts the PNG in the form's
  `picture` input and submits; the server stores a posted `picture` as
  is. The whole page is opened afresh in both. The menu's hints say which,
  by client (`[data-browser-only]`, added to the shell) (R-w8p, R-3qz).
  The preview shows both hints until it's built: the page renders in the
  app's layout (`layouts.json`), which links the app's copy of the shell's
  CSS (`server/public/shell.css`), without the new rule; the build copies
  the shell's `shell.css` over it.
  To design it, the page's views came back into the design (`"from"` on
  the page, window, preview and bar routes) with every partial they
  include; only `_surface.eta` and `_design-bar.eta` changed.
- **Dictation, transcribed on this computer** (the person, 2026-10-17;
  replaces the browser's speech service): a microphone beside Attach. The
  first press opens a modal to choose a speech model (Quick 142 MB English,
  Balanced 466 MB, Most accurate 1.6 GB; Whisper) and download it once
  from Hugging Face, the one outward step, said so. While it downloads the
  microphone shows progress with Cancel, reloading on `dictation-changed`
  (events.json shows it in the preview). Ready: press, speak, press again;
  the browser records (MediaRecorder, in browsers and WebView2 alike), the
  recording and what's typed go to `…/dictation/transcribe`, and the box
  comes back with the words added at the end (`#message-box`, a region of
  its own; the composer listens for Enter and paste on the form so it
  survives that). Prelude's server runs the model, primed with the design's
  words. Same in both clients; nothing said leaves the machine. Words come
  after speaking, not while. The set-up is the person's, on this machine.
  Added `dictate` and `capture` icons, and a pressed `.icon-btn`.
- **No record picker** (the person, 2026-10-17, item 4 of the first
  review): Prelude already lists `:param` pages with the state's first
  record, and other records are found by following links in the page. A
  picker (records under their page, Go to a URL) was designed and taken
  back out.
- **Rules and open questions on the page** (the person, 2026-10-17; item 5
  of the first review). Rules sit with the page they're about: Rules in
  the design bar, after the page menu, counting those shown on the page on
  show, opens a drawer (`/rules`): this page's, other pages', then those no
  page shows, each Proposed or Built, with Show (that page, in that state);
  retired ones fold away with why. Questions sit with the chat, where
  they're answered: Questions in the chat's toolbar, counted in the accent
  (each is a next step), opens a drawer (`/questions`) of NOTES.md's open
  questions with when they were asked; Answer starts a message "About
  “…”: " in the box (after what's typed, in the app) and closes the drawer.
  Decisions so far fold away below. Prelude reads both files (rules.js
  already reads RULES.md; NOTES.md's "Open questions" and "Decisions"
  sections are bullets, the decision's bold lead as its title). A
  question's date is that of the commit that added its bullet; NOTES.md
  stays as it is (the person, 2026-10-17). A new question is flagged only
  by the count going up (the person, 2026-10-17).
- **A fuller status line** (the person, 2026-10-17; item 6 of the first
  review): while the agent works, its latest step in words ("Editing
  compare.eta", the path in the title), how long the turn has run (a
  binding on its start, `duration(now() - …)`, so it moves on its own), how
  many messages wait, and Stop. The step is pushed as each tool starts.
  After the turn, "Checking every page in every state…" while Prelude
  checks (no state shows it: every state here is after a check).
- **A state's file changing drops its working copy** (recommended and
  agreed, 2026-10-17): Prelude throws away what forms changed in that
  state, and the design bar says so once ("Typical’s file changed, so what
  your forms did to its data was undone"). Fixes "There's nothing at …"
  after the agent adds data a page needs. A change to `server/design-state.js`.
- **The speech model's menu sits beside the microphone** (recommended and
  agreed, 2026-10-17): a small menu, opening upwards, says which model and
  its size, with Change model… (the same modal; the old model keeps working
  until the new one is in) and Remove the model. It's the person's, for
  this computer, so no project page holds it, and Prelude has no settings
  page. Added `.menu.up` and `.menu-note` to the design system.
- **Starting points for a new session** (the person, 2026-10-17; item 7 of
  the first review): a session with no messages lists what Prelude knows
  needs doing, most pressing first and only what applies: pages that don't
  render, open questions, pages that differ from their approved screens,
  proposed rules no page shows, and carrying on from the last session.
  "Start with this" starts the message in the box (`POST …/start`), to add
  to or send; a page that differs only has Show (the person: only they can
  judge it). A design with no pages gets "Describe the feature" and "Start
  from a sketch or a screenshot"; the project's architecture with nothing
  written gets "Draft it from the code" instead (2026-10-22, from a fix: a
  feature's starters left the person unsure what to do). All from what Prelude already has (the
  check, NOTES.md, RULES.md, the last session's last line), none written by
  the agent. State `08-new-session` shows it; `05-new-design` the first.
- **The chat's toolbar is quieter** (the person, 2026-10-19). Agent's
  messages always show (no checkbox); tool calls only with Tools on, off
  by default, remembered in the browser (`ko-persist`, local storage):
  a preference of the person's, not the design's (R-t7w). To design it,
  `_session.eta` came back into the design (`"from"` on its route) with
  every partial it includes, since includes resolve only in the design's
  views. `_chat.eta` changed; `_surface.eta` split into it and
  `_design-bar.eta` (below), and `_window.eta` came back to include it.
- **No New session** (the person, 2026-10-20, and again the same day: it
  never worked in the app, and isn't needed; to be added back if it's
  missed): opening a design starts one when the last is finished (R-o4s),
  so the sessions menu lists only the sessions. Built on this branch
  (below); main still has the button until the branch is merged. In the
  app, `GET …/sessions/new` can go too (`server/main.js`), unless
  something else links it.
- **The agent's changes don't reload the page on show** (the person,
  2026-10-20): reviewing was hard while every edit reloaded the frame.
  The person's own changes (page, state, size, Reset, Show, a pop-out)
  still reload the whole surface in every window (`design-changed`). The
  agent's (files of the design, its system, its shell) send
  `files-changed`, which reloads only the head (`#design-bar`,
  `…/preview/bar`, `_design-bar.eta`): page list, states, rules, review
  strip. When the design's version is past the one the frame loaded
  (`shown`, in the bar's URL), "Updated · Load changes" beside the page
  menu reloads the surface. Never on its own, not even when the turn
  ends (the person: never, for now); no Live switch yet (later, if
  needed). Capture's frame size inputs moved beside the frame
  (`form="capture-form"`) so they outlast the bar's reloads. Added
  `.panel-head` to the design system. In the app: split the event in
  `design-state.js` (`filesChanged` publishes `files-changed`) and add the
  bar's route. Send event "The agent changes the design" shows it here.
- **A sent message shows at once** (the person, 2026-10-20: there was a
  lag). The composer's script, on submit, clones a `<template>` bubble
  (words as text, the tray's thumbnails), marked "Sending…", into
  `#transcript` (or `#queued` while the agent works). The answer's
  transcript replaces it; a refusal's composer removes any left (R-s4n).
  Each image goes in an `li.attachment`, since the system sizes `.thumb`
  only inside one (it showed full size before, 2026-10-20).
- **The agent's words stream as markdown** (the person, 2026-10-20: raw
  markdown showed until the message was whole). `_live-entry.eta` is a
  `.prose` of the words so far, rendered; each push replaces it with all
  of them rendered afresh, not appended text, so the saved entry that
  takes its place looks the same. A reload finds it in the transcript
  (`it.streaming`). State `04-agent-working` shows one mid-sentence.
- **Visuals in the chat** (the person, 2026-10-23; D-v3x, the design
  system's flow and map). The page's route came back into the design
  (`"from"`) with every partial it includes; `_entry.eta` and
  `_live-entry.eta` changed, and `_message`, `_visual-flow`, `_visual-map`,
  `_visual-drawing` and `_visual-unread` are new. An agent's message is
  `pieces` (text, flow, map, drawing, unread) in the order written, each
  ready to print; a message with none is one text piece (`html` still
  reads). Each part links to `/f/<project>/architecture/parts/<id>`.
  - **The agent's map marks "Would change"** (`.proposed`); Prelude's own
    map after a turn that changed code marks "Changed" (`.touched`), as an
    entry of its own (`type: 'parts'`, open, folds away). A marked map's
    other parts show only their names, so it fits a chat column; with no
    mark it's the plain map, which the Architecture page can share.
  - **A block Prelude couldn't read** shows with its fences and tag as
    written, and "Not drawn: …" under it, naming the parts that aren't in
    the architecture, the line that's wrong, or the kinds Prelude draws
    (R-x2a, R-f7c, R-m4v). Quiet (muted), not a warning: the message still
    reads, and only the person is told (R-b8s).
  - **Streaming**: a finished visual is drawn at once; one still being
    written is a skeleton with "Drawing a flow…" / "Drawing a map of the
    parts…" (R-w5g). The push re-renders the message's pieces into
    `#<id>-text`, now the `_message` stack rather than a `.prose`.
  - **Widths need nothing of their own**: flow and map answer to their
    container. Beside the design (26rem) a flow is a list and a map's
    labels sit above; popped out or in a fix's conversation (`--measure`)
    a flow of up to four parts gets columns, five or more stay a list
    (R-9tz). States 09–14 show each.
  - Added to the design system: linked flow parts, and `.entry :where(ul)`.
- In the design, a message refused while images are attached comes back
  with an empty tray (the fake route has only the posted fields), and the
  tray isn't emptied after sending (a route does one change). The app does
  both.

## Built: the Design page (2026-10-17)

The page, its drawers and modals, and their forms are the app's own views
now (`server/views/`, the page over `_session.eta`), with the model in
`server/workspace.js` (`DesignPage`) and the routes in `handleDesign`
(`server/main.js`). The pop-out window is built too (2026-10-17):
`_window.eta`, the shared surface in the window layout, its channel
`…/live?view=window`, which is how the panel beside the chat knows one is
open.

Where the app differs from the screens, on purpose:

- **The frame is the page**: `_frame.eta` is an iframe in the design's
  `.device`, not the drawn placeholder. At a size it's laid out at that
  width and height and scaled by a measured `--scale` (a ResizeObserver).
  A client's attributes ride in the frame's `name`
  (`prelude-client:{…}`), and the design's origin sets them on each page
  it serves into such a frame (`withClient`, host.js), so they hold as
  links are followed (R-4tw).
- **The composer posts only `message`** (and its parts): no hidden `type`
  or `action`. A refused message re-renders from the session, so in the
  check (which has only the posted fields) a refusal renders without the
  session's action.
- **The page renders in an app layout of its own**,
  `server/views/workspace-layout.eta`: the shell's workspace and window
  layouts with Prelude's bar, `drawer?` and `modal?`, and the page's one
  live channel. It links Prelude's design system (`/system/`) and the
  shell's `shell.css` (`/shell/`), served from `prelude/`, and the
  design's styles, moved to `server/public/workspace.css`. Other pages keep
  `layout.eta` and `/ds/v1`.
- **One channel per page**: a session's page connects to
  `…/sessions/<id>/live?from=N`, which carries the session's entries and
  status, the design's events (`design-changed`, `draft-changed`) and
  dictation's (`dictation-changed`); a new session's page to `…/live`.
  The page's channel is in the page (`it.live`, printed at the end of
  `_session.eta`), not the layout: going to another session swaps only
  the page, and the channel has to follow it. The pop-out's is its
  layout's.
- **Drafts live at the session's address**: `draft.base` is
  `…/sessions/<id>` (or `…/sessions/new`), so each session keeps its own
  (R-d3v). They're kept on this machine (`~/.prelude/drafts/`), not in
  the repository; sending moves the images into the session's folder
  (`sessions/<id>/images/`) and tells the agent their paths. Answer,
  Start with this, Capture and dictation land in the draft of the session
  the chat shows (the last one a page opened). The design-level URLs in
  routes.json (`…/draft`, `…/attachments`) answer for that session too.
- **Waiting messages** are the app's to hold while the turn runs (in
  memory, in `turns.js`): their images move into the session's folder as
  they're queued, and come back into the box on Stop (R-9cn). Cancelling
  one deletes its images.
- **Entries keep a kind the design doesn't show**: the check's "ahead of
  the app" note, as the app had it; no state has one.
- **The design host's log** still shows under the bar when there is one
  (the design shows only the approval).
- **Send event** still says when its markup didn't render or no page
  heard it (`it.sent`), as the app did.
- **A capture or dictation that fails** says why: `_captured.eta` and
  `_dictation.eta` take an `error`.
- **Capture** uses Edge or Chrome already on the computer, headless, over
  the DevTools protocol with Node's own WebSocket (`server/capture.js`; no
  new dependency; `PRELUDE_BROWSER` names another), or in the desktop app
  its own picture of the frame (below).
- **Dictation** runs whisper.cpp's `whisper-cli` with the downloaded ggml
  model, after `ffmpeg` turns the recording into 16 kHz WAV
  (`server/dictation.js`; `PRELUDE_WHISPER`, `PRELUDE_FFMPEG`). Both are
  the person's to install; the microphone says so when one is missing.
  Models come from `huggingface.co/ggerganov/whisper.cpp` into
  `~/.prelude/speech-models/`.
- **Questions** are NOTES.md's "Open questions" bullets; a question's id
  is a hash of its words, and its date is the commit that added its line
  (git blame). Decisions are the "Decisions" bullets, the bold lead as the
  title.
- **The custom size and which session the chat shows** are kept in
  memory, with the page and the state on show (`design-state.js`).
- **Opening a design** (`…/d/<design>`, as the project page and Home link
  it) goes to its latest session only while that's still open: the agent
  working there, or a turn from the last week the person hasn't opened
  since (Home's own reading of "seen"). Otherwise it's a new session, with
  its starting points, "Carry on from…" among them (R-o4s). Before this, it
  always went to the latest session, even one long finished or a finished
  build (the person, 2026-10-19; prelude/fixes/from-the-project-landing-page-when-i-click-on-a-design-it).
  "Seen" is the project's, not the branch's: a session opened on a
  design's branch stays seen once the branch is merged. Before this, every
  design merged in the last week opened its old session again, because the
  person had seen it under the branch's worktree, not the project
  (2026-10-19; prelude/fixes/when-i-try-to-open-an-existing-design-the-preview-pane).

## Built: the agent's changes, the chat's toolbar, sending (2026-10-20)

- **Files-changed**: `filesChanged` (`server/design-state.js`) still moves
  the design's version on, but publishes `files-changed`, not
  `design-changed`; the watches in `openChannel` (`server/main.js`) call it
  for the design's files, its system and its shell. The bar alone is
  `GET …/preview/bar` (`server/views/_design-bar.eta`), with `shown` from
  its URL (R-v2q).
- **Streaming**: each flush (`server/turns.js`, now every 150ms) renders
  the whole message so far as markdown into `push-delta`, replacing
  `#<id>-text`. The page model has `streaming` from the turn's block, and
  the page's channel says which live entry it rendered
  (`…/live?from=N&streaming=<id>`): catching up brings that one up to date,
  or takes it away if it was saved meanwhile (`push-remove.eta`; the saved
  entry comes with the others), or adds one the page never had.
- **The server's own events** (events.json) come from where each change
  happens, over the page's one channel (`openChannel`, `server/main.js`):
  `dictation-changed` from the download in `server/dictation.js` (as it
  goes, and when the model is in), and `files-changed` from
  `filesChanged` (`server/design-state.js`), when the watches see the
  design's, its system's or its shell's files change. Neither event has
  push views: the microphone (`#dictation`) and the bar (`#design-bar`)
  reload themselves on hearing them.
- **The pop-out window shows only its bar** (an open question since
  2026-10-19): `.window-page > .design` could never match inside
  `@scope (.design-page)`, since the window's page is the scope's root.
  `server/public/workspace.css` now has the design's
  `:scope.window-page > .design`.

## Built: capture where the frame is, and what's on screen (2026-10-20)

- **Where the frame is** (R-w8p): the design's origin adds `WHERE_SCRIPT`
  beside the client script (`withClient`, `server/host.js`) to each page it
  serves; in a frame, it posts `prelude:where` on load, on each
  `koda:attached`, on popstate and when a dialog closes: an open `#modal`
  or `#drawer` at its `ko-location`, else its own path and query.
  `_surface.eta` keeps it in `frame.at`. The capture route (`server/main.js`)
  opens it instead of `page` when the design's routes answer its path (an
  overlay renders over its page, as a deep link does), and names the
  picture after that route's title. App mode still opens the page picked.
- **Koda's warnings from the frame** (2026-10-22, a fix: Koda 0.1.4): beside
  `WHERE_SCRIPT`, `WARNINGS_SCRIPT` adds a hidden `<ol ko-warnings>` to a
  framed page that has none (which asks Koda for its routing advice), takes
  each `koda:warning`, and posts `{ type: 'prelude:warning', code, message,
  url }`. `_surface.eta` adds each to the shell's warnings list
  (prelude/prelude-shell), as "In the design's page: …". So a fragment that
  lands where it doesn't belong in a design is reported, without the design's
  own layouts, which become the app's, carrying a list.
- **What's on screen, in the desktop app** (R-3qz): `desktop.js` takes the
  click on `[data-capture-shown]` when the shell has `capture`, closes the
  menu, waits two frames, asks `preludeDesktop.capture(rect, 1 / --scale)`
  and puts the PNG in `picture` before submitting. The shell's `capture`
  command (`tauri/src-tauri/src/main.rs`) is WebView2's
  `CallDevToolsProtocolMethod("Page.captureScreenshot")` with a clip, on
  the webview's thread (`webview2-com` 0.39 and `windows-core` 0.62, the
  versions Tauri's webview already uses; Windows only, elsewhere it says so
  and the page is opened afresh). The server keeps a posted `picture` as it
  is, refusing anything that isn't a PNG; if the shell can't picture it, the
  form goes without and the server opens the page afresh.
- **`[data-browser-only]`** is in the app's copy of the shell's CSS
  (`server/public/shell.css`), added beside `[data-desktop-only]` rather
  than copying the shell's file over it: the app's copy has its own
  `.fills` rules the shell's doesn't.
- The pop-out window's route now renders the app's own `_window.eta`
  (2026-10-20): the design's `_window.eta` and the partials it includes
  (`_surface`, `_frame`, `_design-bar`, `_page-menu`, `_review-menu`,
  `_keep`) matched the app's line for line, and `:scope.window-page >
  .design` was already in `server/public/workspace.css`, so the port is
  the route alone.
- **The surface or the bar no longer takes over the whole page**
  (2026-10-20, the fix in `prelude/fixes/a-design-s-page-sometimes-gets-swapped-for-a-single-piece/`).
  A design with no branch is served from the project's own address; once
  a post had made its branch, every GET there was redirected to the
  worktree's, so a region's reload (the surface on `design-changed`, the
  bar on `files-changed`) came back from outside its scope and Koda gave
  it to `#workspace` (`ko-scope="/"`). The app (`server/main.js`, the
  `/d/` routing) now answers a fragment GET there in place, with the
  worktree, and moves only a cold load. Keeping the draft, Start with
  this, answering a question and the tray's images change only the draft,
  kept on this computer, so they no longer make the branch; when another
  post makes it, the draft moves with the design.

## Built: the design page is for designing only (2026-10-20)

- The page's route renders the app's `_session.eta` again. Of the partials
  it includes, only `_chat.eta` (no New session, no build sessions'
  variant: `it.builds` is gone), `_entry.eta` (pages that differ in one
  line, unlisted) and `_design-bar.eta` (no build variants of the review
  strip; `surface.stage` is gone) changed. `.entry.next` left
  `server/public/workspace.css`.
- The model (`pageModel`, `server/main.js`) lost `builds`, the branch's
  `building` and the surface's `stage`; the header's `stage` is worked out
  beside the surface now, from the branch entry's own `building`, so it
  still says "Building …" while a build runs.
- A build session's page (`buildSessionPage`) still uses the design page's
  chat, listing the design's build sessions; with New session gone it
  needed nothing of its own.
- Not done: `GET …/sessions/new` is still answered (`server/main.js`):
  nothing in the app links it now, but drafts keep the address
  (`…/sessions/new/draft`), and an old link still works. The About drawer
  (`_about.eta`) still reads `branch.building`, which no longer comes, so
  its ", building …" never shows; the drawer wasn't part of this change.
- (fix, 2026-10-20) The review strip and the header's stage read the last
  check of the design's own sessions only (`reviewOf`, `server/workspace.js`),
  as the strip's comment always said: a build session's check is the build's,
  so a port that differs no longer reads as "The design changed since you
  approved it". The same check now keeps a design changed since it was
  approved from being ready to build (prelude/build, R-q3d). Views and states
  unchanged.
- (fix, 2026-10-22, prelude/fixes/i-added-support-for-a-project-s-architecture-view-a)
  An architecture design's surface is the Architecture page, as a design
  system's is its gallery (the person: it should behave like designing the
  system). It has no screens of its own, so the frame shows Prelude's own
  `/f/:folder/architecture` for the session's folder, without the bar
  (`bare`), once its overview is written; before then the surface says
  "Nothing written yet…". The page menu lists the one page; Capture opens it
  with `?framed=1`; there's nothing to approve. `_surface.eta` changed; this
  design's views and states don't show an architecture design.
- (fix, 2026-10-23, prelude/fixes/the-design-system-s-menu-component-was-changed-to-use-an)
  The page's menus are the design system's popover now, not `details`: the
  page, review, state, Send event, Capture, size and client menus
  (`_design-bar`, `_page-menu`, `_review-menu`), the sessions menu (`_chat`)
  and the speech model's (`_dictation`). Why: the system's menu changed, and
  the app serves the system's CSS as it is, so a `details` menu had lost its
  placing and opened in the bar's flow. Each now floats above the panels,
  closes on a click outside or Escape, and closes when a row is pressed (the
  shell's `_regions`; `desktop.js` for What's in view). Views and states
  unchanged: this design's pages are the app's.

## Open questions

- Not taken on yet for the message box: @ mentions of pages, states,
  rules and files; up-arrow to edit the last message.
- A part's link on a visual leaves the session for the Architecture page.
  Should it open in the drawer over the chat instead? That needs a drawer
  route for a part, which the app doesn't have.
- "Would change" fits a map the agent draws to propose something, not one
  that only explains which parts take part. Should `prelude-map-1` say
  which, or is a proposal the only use?

## Limits of the preview

What the fake routes can't do; the app does each.

- A message may be images alone (R-b6d), but the route requires text: its
  `require` can't say "text or an image".
- A marked-up copy shows no thumbnail (the route can't store the file), and
  Mark up on a just-uploaded image has nothing to open.
- An image added in the preview (a real upload) has no full-size view: the
  route doesn't add it to the session's images.
- Session links and the branch actions lead nowhere (the
  design shows one session at the design's URL).
