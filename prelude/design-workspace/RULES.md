# Rules: Design Workspace

- **R-7vq.** A window’s size and client are its own: the pop-out can show a phone in the mobile app while the surface beside the chat fits the panel, and changing one never changes the other.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
- **R-c2m.** The page and the state on show belong to the design, so picking either moves every window showing it.
- **R-h9x.** Every design in a project offers the same sizes and clients: the ones its app shell declares, with Fit the panel always first.
  *shown-on: /f/:folder/d/:design @ typical*
- **R-e5n.** A custom size takes a width and a height between 200 and 4000 pixels; anything outside that shows the page fitting the panel.
- **R-w3j.** A design remembers one custom size, offered in every window’s size menu after the shell’s sizes; setting another replaces it.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
- **R-b6d.** A message may be images alone, with no words.
- **R-x8f.** The agent sees every image sent with a message, and the images stay with the session, so they’re still there when it’s opened again.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
- **R-m2s.** Only images can be attached (PNG, JPEG, GIF or WebP); pasting or dropping anything else leaves the message box as it was.
- **R-r7h.** Each message tells the agent what the person was looking at when they sent it (the page, the state, and the size and client when they aren’t the defaults), unless they turned that off for it.
  *shown-on: /f/:folder/d/:design @ typical*
- **R-z4k.** Messages sent while the agent is working wait, and go to it together, in the order they were written, when its turn ends.
  *shown-on: /f/:folder/d/:design @ agent-working*
- **R-9cn.** Stopping the agent sends nothing that was waiting: the waiting messages go back into the message box, to send or change.
- **R-d3v.** Each session keeps its own unsent message, words and images, until it’s sent: a reload, or going to another session and back, finds it as it was left.
  *shown-on: /f/:folder/d/:design @ typical*
- **R-u6p.** Marking up an image never changes it: the marked-up copy goes in the message box, in place of the original only if the original was waiting there to be sent.
  *shown-on: /f/:folder/d/:design/images/:image/markup @ typical*
- ~~**R-k7c.** A capture is the page exactly as the window that captured it shows it: its page, state, size and client, or the app.~~
  *retired: it pictured the page picked, never a drawer or modal open over it or a page reached by a link, and a page opened afresh can't hold what's typed (2026-10-20); see R-w8p and R-3qz.*
- **R-w8p.** A capture of the design is of the page where the frame is now, a page reached by following its links or a drawer or modal open over it included, in the window's state, size and client.
- **R-3qz.** In the desktop app, capturing what's in view keeps the page exactly as it is on screen, with what's typed or drawn in it; in a browser, and for the whole page in either, the page is opened afresh where it was, without what's typed.
  *shown-on: /f/:folder/d/:design @ typical*
- **R-f2y.** What the person says is turned into text on their own computer and never leaves it; the only download is the speech model, once, when they turn dictation on.
  *shown-on: /f/:folder/d/:design/dictation @ pages-differ*
- **R-n5q.** Dictation adds what was said after what’s already typed, keeping anything typed while it listened.
- ~~**R-s8b.** A page about one record offers every record the current state has for it, in the state’s order, each by its label; an overlay on such a page opens over the record on show.~~
  *retired: the person held it off (2026-10-17); records are found by following links in the page.*
- ~~**R-g4e.** Going to a URL the design doesn’t answer leaves the page on show as it was and says there’s no such page.~~
  *retired: Go to a URL was held off with the record picker (2026-10-17).*
- **R-j8w.** The design’s rules are listed with those shown on the page on show first, then those on other pages, then those no page shows.
  *shown-on: /f/:folder/d/:design/rules @ typical*
- **R-y3h.** Answering an open question starts a message about it in the message box, after anything already typed; nothing is sent until the person sends it.
  *shown-on: /f/:folder/d/:design/questions @ typical*
- **R-a6x.** When a state’s file changes, what forms did to that state’s data is undone, and the design bar says so once.
  *shown-on: /f/:folder/d/:design @ pages-differ*
- **R-h4u.** Changing the speech model keeps dictation working with the old one until the new one has downloaded, then removes the old one.
- **R-e9t.** A session’s starting points are only what Prelude already knows needs doing on the design, most pressing first, and they go once its first message is sent.
  *shown-on: /f/:folder/d/:design @ new-session*
- **R-o4s.** Opening a design shows its latest session only while the agent is working there or a turn has ended there that the person hasn't seen; otherwise it shows a new session, with its starting points. A session seen on the design's branch is still seen once the branch is merged.
- **R-4tw.** Choosing a client changes only what the page itself shows for that client; Prelude doesn’t run the client, so Pop out and links behave as they do in a browser.
- **R-pk8.** Showing a page the check named shows it in the state the check named it in.
  *shown-on: /f/:folder/d/:design @ pages-differ*
- **R-v2q.** The agent's changes to a design never reload the page on show: the design bar says the design has changed, and the page loads them only when the person asks; their own choices (a page, a state, a size) still show at once in every window.
- **R-s4n.** A message shows in the conversation the moment it's sent, before the agent has it; if it's refused, it leaves the conversation and stays in the message box.
- **R-t7w.** The agent's tool calls are hidden in the chat until the person turns Tools on; that choice is remembered on their computer, for every design and session.
  *shown-on: /f/:folder/d/:design @ typical*
- **R-6jw.** A flow or a map the agent writes shows as a picture exactly where it wrote it, between its words, however many a message has.
  *shown-on: /f/:folder/d/:design @ several-visuals*
- **R-p3e.** Every part on a flow or a map in a conversation opens that part's page from the project's architecture in a drawer over the conversation, which stays as it was.
  *shown-on: /f/:folder/d/:design @ a-flow-and-a-map*
- **R-k9u.** A map shows every part of the project, layer by layer; the parts it picks out stand out, each with the agent's note, and the rest show only their names. Only a map of what a turn changed says "Changed"; an agent's map says nothing about change.
  *shown-on: /f/:folder/d/:design @ a-flow-and-a-map*
- **R-x2a.** A visual is drawn only if every part it names is in the project's architecture as it stands on the session's branch when the conversation is shown; otherwise it shows as the agent wrote it, with a line naming the parts that aren't.
  *shown-on: /f/:folder/d/:design @ visual-not-drawn*
- **R-f7c.** A visual whose lines aren't in its kind's format, or whose kind or version Prelude doesn't draw, shows as the agent wrote it, with a line saying which line is wrong or which kinds Prelude draws.
  *shown-on: /f/:folder/d/:design @ visual-not-drawn*
- **R-0hq.** A visual that was drawn shows as the agent wrote it once a part it names is renamed or removed from the architecture, saying so; one that wasn't is drawn once its parts exist.
- **R-m4v.** In a project with no architecture yet, every visual shows as the agent wrote it, with a line saying there are no parts to draw it with.
- **R-b8s.** The agent isn't told when a visual of its couldn't be drawn; only the person sees why.
- **R-w5g.** While the agent is still writing a visual, a placeholder says what it's drawing, and the visual takes its place as soon as its block is complete, while the words after it keep coming.
  *shown-on: /f/:folder/d/:design @ drawing-a-visual*
- **R-c1y.** After a turn that changed the app's code, the conversation shows a map of the parts whose files changed, worked out by Prelude from the files, not by the agent.
  *shown-on: /f/:folder/d/:design @ ask-and-fix-visuals*
- **R-9tz.** A flow is a numbered list, each step naming its part, when the chat is narrow, and columns, one per part, when there's room for them: popped out, or in a conversation about the project when it has four parts or fewer.
  *shown-on: /f/:folder/d/:design @ visuals-popped-out*
