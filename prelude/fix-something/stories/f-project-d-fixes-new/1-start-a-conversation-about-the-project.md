# Start a conversation about the project

For anyone who wants to ask how something in the project works, or say something's wrong with it. Before, they had to name the problem in a pop-up and got a branch before anyone knew what was wrong. Now they get a page with the full chat: they can write, paste a screenshot or dictate, and start from what Prelude already knows is broken. The page makes clear the agent only reads, so they can ask freely.

## What changes

- The page is called **Ask or fix**, and there's no title to write. It's a conversation about the project, not a design: there's no design beside the chat, so the chat sits in the middle of the page at a readable width instead of stretching across the window.
- Under the title, a line reads: "**Reading only** · Ask about this project, or say what's wrong. The agent reads the designs and the app to answer, and changes nothing until you fix it on a branch."
- The header has no branch, no About the design and no Rename. A new conversation has nothing to fix on a branch or rename yet.
- Above the chat it says "A new conversation". There's no New session button, since there are no sessions yet.
- The chat opens with: "The agent reads the project's designs, its app and its design system to answer you. Start from one of these, or write your own."
- The starting points come first from what Prelude knows is wrong anywhere in the project, for example "Find out why: Rate lock's build stopped", with what went wrong under it. Two more always follow: **Ask how something works** ("How a page behaves, which designs use something, where a rule is built in the app") and **Say what's wrong, with a screenshot** ("What you saw, where, and what you expected. Then attach the screenshot, paste it or drop it on the box").
- **Start with this** puts that starting point's words in the message box for the person to finish. Nothing is sent until they send it.
- The message box says: "Ask about the project, or say what's wrong and where; paste a screenshot of it."
- The message box has no "what you're looking at" chip, because no page is on show.
- The person can attach, paste or drop images, and remove them before sending. They can dictate, and what they've typed is kept as a draft ("Draft kept"), as in a design's chat.
- Sending the first message starts the conversation and takes the person to its own page. Sending an empty message is refused with "This is required."

## Acceptance criteria

- Ask or fix shows its title with no rename button, and the "Reading only" line under it.
- The header shows no branch, About the design or Fix it on a branch.
- The chat says "A new conversation" and has no New session button.
- When something in the project is broken (a stopped build, or a branch whose pages don't render), each one shows as its own "Find out why: …" starting point, before the others.
- Ask how something works and Say what's wrong, with a screenshot always show, including on a project with nothing broken and no designs.
- Start with this fills the message box with that starting point's words and sends nothing.
- The message box shows the Ask or fix placeholder, and no "what you're looking at" chip.
- An image can be attached, pasted or dropped, shows above the box, and can be removed before sending.
- What's typed is still there after a reload, and "Draft kept" shows.
- Dictation works on this page: it can be set up if it isn't yet, and once set up it types what's said into the box.
- Sending a message opens the new conversation's page. Sending an empty one shows "This is required." and stays on the page.
- On a wide window the chat is centred at a readable width. On a narrow one it fills the column.

## Looks right in

- **Typical**: `prelude/fix-something/snapshots/typical/f_spark-lending_d_fixes_new.html`
- **New project**: `prelude/fix-something/snapshots/new-project/f_rate-sheet-importer_d_fixes_new.html`

## For developers

- Page: `/f/:project/d/fixes/new`, view `_session`, data `projects/:project/newFix`. `_session.eta` itself is the same as the app's. The changes are in the partials it includes: `_header`, `_chat`, `_starters`, `_composer` and `_message-box`. The model is a fix (`kind: 'fix'`) with `branch: null`, `sessions: []`, id `fixes/new`, and a new `troubles` list (`icon`, `title`, `says`). `fixes/new` is a reserved slug. This page replaces the old Fix something modal (`_new-fix*.eta`, `GET /f/:id/fixes/new`, `POST /f/:id/fixes`), and those go.
- `_header.eta`: `reading = kind === 'fix' && !branch && !merged`, and `fresh = reading && !sessions.length`. When `reading`, the branch summary button is replaced by Fix it on a branch… (hidden when `fresh`), and the Reading only line shows (with the `fresh` wording here). The title sits in a cluster with a Rename icon, which is hidden when `fresh`.
- `_chat.eta`: when `fresh` (a fix with no sessions), the toolbar shows "A new conversation" and leaves out New session.
- `_starters.eta`: for a fix, a starter for each of `it.troubles` comes first. When there's no earlier session, the two fixed starters follow, and the intro line changes. The design-only "Describe the feature" pair doesn't show for a fix.
- `_composer.eta`: a fix passes a `placeholder` to `_message-box` and leaves out the looking-at chip. `_message-box.eta` takes the optional `placeholder` and falls back to the design wording.
- `styles.css`: when the chat is the workspace's only child and the container is `>= 52rem`, it's centred at `var(--measure)`. Port it next to `workspace.css`'s `:only-child` rule, which it replaces.
- Forms:
  - `POST /f/:project/d/fixes/new/sessions` updates `projects/:project/newFix` and requires `message` (form `_composer`). It makes the conversation's record on this computer and its first session, then redirects to the new conversation's page `/f/:project/d/fixes/<slug>`. The preview always redirects to the sample `rate-lock-build-stopped`, because the fake route can't make the model (NOTES.md, open questions).
  - `POST /f/:project/d/fixes/new/start` updates `…/newFix/draft` and answers with `_answering` into `message-box`.
  - `POST /f/:project/d/fixes/new/draft` updates `…/newFix/draft` and answers with `_draft-kept`. It's debounced 800 ms on input.
  - `POST /f/:project/d/fixes/new/attachments` adds to `…/newFix/draft/attachments`, and `POST …/attachments/:attachment/remove` removes from it. Both answer with `_attachments`.
- Regions it reloads: `/f/:project/d/fixes/new/draft` (view `_attachments`, data `projects/:project/newFix/draft`) on `event:draft-changed`, and `/f/:project/d/fixes/new/dictation/button` (view `_dictation`, data `projects/:project/newFix`) on `event:dictation-changed`.
- Test data:
  - `prelude/fix-something/states/01-typical.json` (spark-lending): one trouble, "Rate lock's build stopped", and dictation is ready with the Balanced model.
  - `prelude/fix-something/states/02-new-project.json` (rate-sheet-importer): no troubles, so only the two fixed starters show, and dictation isn't set up, so it offers setup.
  - The refused send is `snapshots/typical/POST_f_spark-lending_d_fixes_new_sessions.html`. The draft and dictation regions are `…_d_fixes_new_draft.html` and `…_d_fixes_new_dictation_button.html` in each state's folder.
