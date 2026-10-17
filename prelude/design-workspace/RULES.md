# Rules: Design Workspace

- **R-7vq.** A window’s size and client are its own: the pop-out can show a phone in the mobile app while the surface beside the chat fits the panel, and changing one never changes the other.
  *shown-on: /f/:folder/d/:design/window @ popped-out*
  *proposed*
- **R-c2m.** The page and the state on show belong to the design, so picking either moves every window showing it.
  *proposed*
- **R-h9x.** Every design in a project offers the same sizes and clients: the ones its app shell declares, with Fit the panel always first.
  *shown-on: /f/:folder/d/:design @ typical*
  *proposed*
- **R-4tw.** Choosing a client changes only what the page itself shows for that client; Prelude doesn’t run the client, so Pop out and links behave as they do in a browser.
  *proposed*
- **R-pk8.** Showing a page the check named shows it in the state the check named it in.
  *shown-on: /f/:folder/d/:design @ pages-differ*
  *proposed*
