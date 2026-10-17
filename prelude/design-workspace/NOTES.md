# Design Workspace - notes

A redesign of Prelude's design page (`/f/:folder/d/:design`, its sessions and
the pop-out window): today `server/views/_session.eta`, `_design.eta`,
`_branch.eta`, `_entry.eta`, `_status.eta`, `_composer.eta`, `_window.eta`.
It renders in the shell's `workspace` and `window` layouts. The routes carry
`"from": "@app/server/views/…"`, so the build ports it back.

Pages: Design page, About the design (drawer), Pop-out window. The fake
project is a lender's borrower portal, so sizes (phone, tablet) and a second
client (its mobile app) mean something. States: typical, pages differ,
doesn't render, building, new design, update clashed, popped out.

## Decisions

- **Scope: 1-3 of the review, plus the pop-out** (the person, 2026-10-17):
  the header, the design bar, and check results that lead somewhere.
- **A one-line header.** Crumbs and title, then the branch as one button
  with pills for what to act on (check, behind main, a clash). It opens a
  drawer (`/about`) with the branch in full and its actions, what the design
  uses, and what the agent can read. An update that clashed also shows as a
  notice above the work, since it holds the branch.
- **The chat owns its toolbar**: sessions menu, Show Agent/Tools, New
  session. A build session says so in a notice at the top of the chat.
- **The design bar reads "what am I looking at", then "how"**: Design/App,
  page (Refresh and Open in browser moved into its menu, since they act on
  the page), state, Send event, Reset data; then size, client, Pop out.
- **Review strip under the bar** (a `.notice`, edge to edge), only when
  there's something to do: a page that doesn't render, pages that differ
  (with Approve again), or none approved yet. Its menu lists the pages;
  each shows that page in the state the check named. The chat's check
  entries have Show beside each page too. The page count is gone.
- **Size and client are not states** (the person asked, 2026-10-17). States
  are data; size and client are how one window looks at it. They're per
  window (in the surface's URL, like Design/App), so the pop-out can show a
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
  (page, state, size, client, or the app) and adds the PNG to the message
  box (`POST …/capture`); a line beside it says so, and the tray reloads on
  `draft-changed`, so a capture from the pop-out reaches the chat. At Fit,
  "in view" is the frame's size, measured by a ResizeObserver script. The
  server renders it (a headless browser), not the client: a cross-origin
  frame can't be read from the page, and it works the same in both
  clients. Captures are named "Page – State – 390×844.png".
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
  sections are bullets, the decision's bold lead as its title).
- In the design, a message refused while images are attached comes back
  with an empty tray (the fake route has only the posted fields), and the
  tray isn't emptied after sending (a route does one change). The app does
  both.

## Open questions

- A message may be images alone (rule R-b6d), but the design's route still
  requires text: its `require` can't say "text or an image".
- Not taken on yet for the message box: @ mentions of pages, states,
  rules and files; up-arrow to edit the last message.
- Where are the speech model removed or changed? Prelude has no settings
  page yet; the folder page, or a menu on the microphone?
- How Prelude runs Whisper (whisper.cpp through a Node binding, or a
  sidecar binary) and on which hardware: to decide when building.
- Capture needs a headless browser in Prelude (a new dependency), or the
  desktop app's own capture. To decide when building.
- When a state's file changes, should its working copy (what forms changed)
  be dropped? Today it's kept until Reset data, so a page needing data the
  file has since gained fails with "There's nothing at …" (found
  2026-10-17: the images route, after the states gained `images`).
  Proposed: drop it, and say so in the design bar ("The state changed, so
  what forms did was reset").
- In the design, a marked-up copy shows no thumbnail (the fake route can't
  store the file), and Mark up on a just-uploaded image has nothing to open.
- An image added in the preview (a real upload) has no full-size view: the
  fake route doesn't add it to the session's images.

- In the preview, session links, New session and the branch actions lead
  nowhere (the design shows one session at the design's URL).
- Not taken on yet from the review: a fuller status line, suggestions for
  a new session.
- An open question has no id or date in NOTES.md today. Prelude could date
  each by the commit that added it, and the agent could ask a question in
  the chat and the notes at once; or questions get their own file.
- Should a new question the agent asks also flag itself (the count turning
  up as the turn ends), or is the count enough?
