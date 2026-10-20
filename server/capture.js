// Capture (prelude/design-workspace, R-w8p, R-3qz): a picture of a page,
// opened afresh where the frame is, as a window shows it - its state, size and
// client, or the app - for the message box. (The desktop app's What's in view
// is its own picture of the frame, desktop.js; this is everything else.) The page is in a frame on another origin, which the page
// around it can't read, so the server takes the picture: it opens the page in
// a headless Edge or Chrome already on this computer (PRELUDE_BROWSER names
// another) and asks it for a PNG over the DevTools protocol. No dependency:
// Node's own WebSocket speaks the protocol.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
  win32: [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

/** The browser to capture with, or null. */
export function findBrowser() {
  if (process.env.PRELUDE_BROWSER) return process.env.PRELUDE_BROWSER;
  return (CANDIDATES[process.platform] ?? CANDIDATES.linux).find(path => path && existsSync(path)) ?? null;
}

const LONGEST = 16000;   // a whole page is cut off here, as browsers cut off a picture

/**
 * A PNG of `url` laid out at width × height; `whole` scrolls to its end.
 * `attributes` go on the page's root, as the client sets them.
 */
export async function capture({ url, width, height, whole = false, attributes = {}, timeout = 20000 }) {
  const browser = findBrowser();
  if (!browser) throw new Error('Capturing needs Edge or Chrome on this computer (or PRELUDE_BROWSER naming one).');
  const profile = mkdtempSync(join(tmpdir(), 'prelude-capture-'));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let said = '';
      child.stderr.on('data', chunk => {
        said += chunk;
        const found = said.match(/DevTools listening on (ws:\/\/\S+)/);
        if (found) resolve(found[1]);
      });
      child.on('error', reject);
      child.on('exit', () => reject(new Error('The browser closed before it could take the picture.')));
    });
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('Couldn’t reach the browser.')); });
    let next = 0;
    const waiting = new Map();
    const listeners = new Set();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id && waiting.has(message.id)) {
        const { resolve, reject } = waiting.get(message.id);
        waiting.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const event = (method, sessionId) => new Promise(resolve => {
      const listener = message => { if (message.method === method && message.sessionId === sessionId) { listeners.delete(listener); resolve(message.params); } };
      listeners.add(listener);
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    const metrics = h => send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await metrics(height);
    const loaded = event('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url }, sessionId);
    await loaded;
    // The client: attributes on the page's root, as the frame gives them.
    if (Object.keys(attributes).length) {
      await send('Runtime.evaluate', { expression: `for (const [k, v] of Object.entries(${JSON.stringify(attributes)})) document.documentElement.setAttribute(k, v)` }, sessionId);
    }
    // A moment for Koda to start and any regions to load.
    await new Promise(resolve => setTimeout(resolve, 400));
    if (whole) {
      const layout = await send('Page.getLayoutMetrics', {}, sessionId);
      const tall = Math.ceil((layout.cssContentSize ?? layout.contentSize).height);
      await metrics(Math.min(LONGEST, Math.max(height, tall)));
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    socket.close();
    return Buffer.from(data, 'base64');
  } finally {
    clearTimeout(timer);
    child.kill();
    // The browser keeps its profile busy for a moment after it's told to go.
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2000).unref();
  }
}
