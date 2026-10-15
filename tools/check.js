// npm run check <folder> [-- --approve]
//
// Prelude's check of a repository's designs, for a person or for CI (plan:
// step 6d). For every design of views it renders every route in every state,
// each overlay alone and over its page, each search with no match, and each
// POST route's valid and refused posts - through the built-in Eta host, or
// the repository's own design host (prelude/prelude.json) - and compares each
// page with its approved snapshot. It exits 1 if anything fails.
//
// With a design host, it first checks the host itself: it starts, answers
// /__prelude/health, and fails a view that doesn't exist with the engine's
// error. Running the check is the person's approval of the host for this one
// run; nothing is recorded.
//
// --approve writes every design's snapshots instead, as "Approve these
// screens" does, and fails only if a page doesn't render.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRELUDE_DIR, listDesigns } from '../server/designs.js';
import { canonical, folderId } from '../server/folders.js';
import { isHosted, reviewDesign } from '../server/host.js';
import { createHosts, readHostConfig } from '../server/hosts.js';
import { createRenderers } from '../server/renderers.js';
import { writeSnapshots } from '../server/snapshots.js';

const args = process.argv.slice(2);
const approve = args.includes('--approve');
const folderPath = canonical(resolve(args.find(arg => !arg.startsWith('--')) ?? '.'));
const folder = { id: folderId(folderPath), path: folderPath };
const config = readHostConfig(folderPath);

const app = config
  ? { hosts: createHosts({ home: mkdtempSync(join(tmpdir(), 'prelude-check-')) }) }
  : { renderers: createRenderers({ appRoot: dirname(dirname(fileURLToPath(import.meta.url))) }) };
if (config) app.hosts.approve(folder, config);

class HostDown extends Error {}

let failed = 0;
const report = (ok, what, detail = '') => {
  if (!ok) failed++;
  const lines = detail ? `\n${detail.split('\n').map(line => `       ${line}`).join('\n')}` : '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${lines}`);
};

try {
  if (config) {
    console.log(`Starting the design host: ${config.start} ...`);
    const blank = { page: { views: join(folderPath, PRELUDE_DIR), template: './__no_such_view__', data: {} }, layout: null, regions: {}, query: {} };
    try {
      await app.hosts.render(folder, config, blank);
      report(false, 'a missing view fails', 'the host answered 200');
    } catch (error) {
      const healthy = !/wasn't ready|stopped before|hasn’t been approved/.test(error.message);
      report(healthy, 'the host starts and answers /__prelude/health', healthy ? '' : error.message.split('\n').slice(0, 8).join('\n'));
      if (!healthy) throw new HostDown();
      report(error.message.length > 0, 'a missing view fails with the engine’s error');
    }
  }

  const designs = listDesigns(folderPath).filter(design => isHosted(join(folderPath, PRELUDE_DIR, ...design.id.split('/'))));
  if (!designs.length) console.log('(No designs of views in this folder.)');
  for (const design of designs) {
    const designDir = join(folderPath, PRELUDE_DIR, ...design.id.split('/'));
    const review = await reviewDesign(app, { folder, design, designDir });
    report(review.failures.length === 0, `${design.id}: every page renders in every state (${[...review.renders.values()].filter(Boolean).length} pages and forms)`,
      review.failures.map(f => `${f.path}${f.state ? ` (${f.state})` : ''}: ${f.error.split('\n').slice(0, 4).join('\n  ')}`).join('\n'));
    for (const warning of review.warnings) console.log(`warn ${design.id}: ${warning}`);
    if (review.ahead.length) console.log(`     ${design.id}: the design is ahead of the app: ${review.ahead.join(', ')}`);
    if (approve && review.failures.length) {
      console.log(`     ${design.id}: not approved, as some pages don't render`);
    } else if (approve) {
      const count = writeSnapshots(designDir, review.renders);
      console.log(`     ${design.id}: approved ${count} pages`);
    } else if (review.approved) {
      report(review.differ.length === 0, `${design.id}: every page matches its approved snapshot`,
        review.differ.map(d => `${d.name}: ${d.diff}`).join('\n'));
    } else {
      console.log(`     ${design.id}: no approved screens yet`);
    }
  }
} catch (error) {
  // A host that doesn't start renders nothing: there's no point asking it for every page.
  if (!(error instanceof HostDown)) throw error;
} finally {
  app.hosts?.closeAll();
  app.renderers?.closeAll();
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nEverything passes.');
process.exit(failed ? 1 : 0);
