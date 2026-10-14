// What the desktop shell adds to a page, when there is one (docs/plan.md, step 4).
//
// The shell brings `window.preludeDesktop` on Prelude's own origin. Controls
// only the shell can drive are marked `data-desktop-only` and shown only when
// it is here; links it can do better are taken over - Pop out gets a real
// window, Open in browser the system's browser. In a browser none of this
// runs, and nothing is lost: the links work as links.
//
// This is the device's half: it relays between the page and the shell, and
// decides nothing. It is a script because it is genuinely imperative - a
// native dialog, a native window - which no binding or action expresses.

const desktop = window.preludeDesktop ?? null;

if (desktop) {
  document.querySelector('.prelude')?.setAttribute('data-desktop', '');

  document.addEventListener('click', event => {
    const control = event.target.closest?.('[data-pick-folder], a[data-pop-out], a[target="_blank"]');
    if (!control || event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    run(control).catch(error => console.error('Prelude desktop:', error));
  }, true);
}

async function run(control) {
  if (control.matches('[data-pick-folder]')) {
    const path = await desktop.pickFolder();
    if (!path) return;
    const form = control.closest('form');
    form.elements.path.value = path;
    form.requestSubmit();
    return;
  }
  const url = new URL(control.getAttribute('href'), location.href).href;
  if (control.matches('[data-pop-out]')) await desktop.popOut(url, control.getAttribute('target'));
  else await desktop.openInBrowser(url);
}
