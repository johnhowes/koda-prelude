// npm run host-check <folder>
//
// Checks a repository's design host (prelude/prelude.json) against Prelude's
// contract: it starts the host, then
//   - asks /__prelude/health;
//   - renders a view that doesn't exist, which must fail with the engine's error;
//   - renders every route of every hosted design in every state, and each POST
//     route against a throwaway copy, exactly as the after-turn check does (in
//     a folder without a shell, that includes the host's own default layout).
// Running it is the person's approval for this one run; nothing is recorded.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PRELUDE_DIR, listDesigns } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { checkDesign, isHosted } from '../server/host.js';
import { createHosts, readHostConfig } from '../server/hosts.js';

const folderPath = canonical(resolve(process.argv[2] ?? '.'));
const config = readHostConfig(folderPath);
if (!config) {
  console.error(`No design host in ${join(folderPath, PRELUDE_DIR, 'prelude.json')}.`);
  process.exit(2);
}

const folder = { id: folderId(folderPath), path: folderPath };
const hosts = createHosts({ home: mkdtempSync(join(tmpdir(), 'prelude-host-check-')) });
hosts.approve(folder, config);

let failed = 0;
const report = (ok, what, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n       ${detail.split('\n').slice(0, 6).join('\n       ')}` : ''}`);
};

console.log(`Starting ${config.start} ...`);
try {
  const blank = { page: { views: join(folderPath, PRELUDE_DIR), template: './__no_such_view__', data: {} }, layout: null, regions: {}, query: {} };
  try {
    await hosts.render(folder, config, blank);
    report(false, 'a missing view fails', 'the host answered 200');
  } catch (error) {
    const healthy = !/wasn't ready|stopped before/.test(error.message);
    report(healthy, 'the host starts and answers /__prelude/health', healthy ? '' : error.message);
    if (healthy) report(error.message.length > 0, 'a missing view fails with the engine’s error', error.message);
  }

  const designs = listDesigns(folderPath).filter(design => isHosted(join(folderPath, PRELUDE_DIR, ...design.id.split('/'))));
  if (!designs.length) console.log('(No designs of views in this folder to render.)');
  for (const design of designs) {
    const designDir = join(folderPath, PRELUDE_DIR, ...design.id.split('/'));
    const failures = await checkDesign({ hosts }, { folder, design, designDir });
    report(failures.length === 0, `design ${design.id}: every route, state and POST route`,
      failures.map(f => `${f.path}${f.state ? ` (${f.state})` : ''}: ${f.error}`).join('\n'));
  }
} finally {
  hosts.closeAll();
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nThe host meets the contract.');
process.exit(failed ? 1 : 0);
