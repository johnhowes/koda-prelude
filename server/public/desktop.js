// What the desktop shell adds to a page, when there is one (docs/plan.md, step 4).
//
// The shell brings `window.preludeDesktop` on Prelude's own origin. Controls
// only the shell can drive are marked `data-desktop-only` and shown only when
// it is here; links it can do better are taken over - Pop out gets a real
// window, Open in browser the system's browser, Capture's What's in view the
// frame exactly as it is on screen. In a browser none of this runs, and
// nothing is lost: the links work as links, and the form as a form.
//
// This is the device's half: it relays between the page and the shell, and
// decides nothing. It is a script because it is genuinely imperative - a
// native dialog, a native window, the window's own pixels - which no binding
// or action expresses.

const desktop = window.preludeDesktop ?? null;

if (desktop) {
  // The page's root: .prelude in the app's layout, the document in the shell's.
  (document.querySelector('.prelude') ?? document.documentElement).setAttribute('data-desktop', '');

  const taken = desktop.capture
    ? '[data-pick-folder], a[data-pop-out], a[target="_blank"], [data-capture-shown]'
    : '[data-pick-folder], a[data-pop-out], a[target="_blank"]';
  document.addEventListener('click', event => {
    const control = event.target.closest?.(taken);
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
  if (control.matches('[data-capture-shown]')) return captureShown(control);
  const url = new URL(control.getAttribute('href'), location.href).href;
  if (control.matches('[data-pop-out]')) await desktop.popOut(url, control.getAttribute('target'));
  else {
    // The shell opens only what it trusts (its server, the preview, https);
    // anything else it refuses still opens, as the link would have.
    try {
      await desktop.openInBrowser(url);
    } catch (error) {
      console.warn('Prelude desktop: the system browser wasn’t allowed this address, so it opens here.', error);
      window.open(url, '_blank', 'noopener');
    }
  }
}

/**
 * Capture's What's in view (R-3qz): the frame as it is on screen, with what's
 * typed or drawn in it, which no page opened afresh can hold. The menu closes
 * first, so it isn't in the picture; the shell pictures the frame's box, at
 * the page's own pixels when a size scales it down (1 / --scale); the PNG goes
 * in the form's `picture`, which the server keeps as it is. If the shell
 * can't, the form goes without it, and the server opens the page afresh.
 */
async function captureShown(button) {
  const form = button.form;
  const input = form.querySelector('[data-capture-picture]');
  const frame = button.closest('.design')?.querySelector('.design-frame iframe');
  // The click stops here (above), so the layout's own closing never hears it.
  const menu = button.closest('[popover]');
  if (menu?.matches(':popover-open')) menu.hidePopover();
  if (input) input.value = '';
  if (input && frame) {
    try {
      // Two frames: the menu's closing is painted before the picture.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = frame.getBoundingClientRect();
      const scale = Number(getComputedStyle(frame.closest('.device') ?? frame).getPropertyValue('--scale')) || 1;
      const answer = JSON.parse(await desktop.capture({ x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height }, 1 / scale));
      const bytes = Uint8Array.from(atob(answer.data), c => c.charCodeAt(0));
      const files = new DataTransfer();
      files.items.add(new File([bytes], form.elements.namedItem('name')?.value || 'Capture.png', { type: 'image/png' }));
      input.files = files.files;
    } catch (error) {
      console.error('Prelude desktop: the window couldn’t picture the frame, so the page is opened afresh.', error);
    }
  }
  form.requestSubmit(button);
}
