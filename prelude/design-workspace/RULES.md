# Rules: Design Workspace

- **R-7vq.** A window’s size and client are its own: the pop-out can show a phone in the mobile app while the surface beside the chat fits the panel, and changing one never changes the other.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
  *proposed*
- **R-c2m.** The page and the state on show belong to the design, so picking either moves every window showing it.
  *proposed*
- **R-h9x.** Every design in a project offers the same sizes and clients: the ones its app shell declares, with Fit the panel always first.
  *shown-on: /f/:folder/d/:design @ typical*
  *proposed*
- **R-e5n.** A custom size takes a width and a height between 200 and 4000 pixels; anything outside that shows the page fitting the panel.
  *proposed*
- **R-w3j.** A design remembers one custom size, offered in every window’s size menu after the shell’s sizes; setting another replaces it.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
  *proposed*
- **R-b6d.** A message may be images alone, with no words.
  *proposed*
- **R-x8f.** The agent sees every image sent with a message, and the images stay with the session, so they’re still there when it’s opened again.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
  *proposed*
- **R-m2s.** Only images can be attached (PNG, JPEG, GIF or WebP); pasting or dropping anything else leaves the message box as it was.
  *proposed*
- **R-r7h.** Each message tells the agent what the person was looking at when they sent it (the page, the state, and the size and client when they aren’t the defaults), unless they turned that off for it.
  *shown-on: /f/:folder/d/:design @ typical*
  *proposed*
- **R-z4k.** Messages sent while the agent is working wait, and go to it together, in the order they were written, when its turn ends.
  *shown-on: /f/:folder/d/:design @ building*
  *proposed*
- **R-9cn.** Stopping the agent sends nothing that was waiting: the waiting messages go back into the message box, to send or change.
  *proposed*
- **R-d3v.** Each session keeps its own unsent message, words and images, until it’s sent: a reload, or going to another session and back, finds it as it was left.
  *shown-on: /f/:folder/d/:design @ typical*
  *proposed*
- **R-u6p.** Marking up an image never changes it: the marked-up copy goes in the message box, in place of the original only if the original was waiting there to be sent.
  *shown-on: /f/:folder/d/:design/images/:image/markup @ typical*
  *proposed*
- **R-4tw.** Choosing a client changes only what the page itself shows for that client; Prelude doesn’t run the client, so Pop out and links behave as they do in a browser.
  *proposed*
- **R-pk8.** Showing a page the check named shows it in the state the check named it in.
  *shown-on: /f/:folder/d/:design @ pages-differ*
  *proposed*
