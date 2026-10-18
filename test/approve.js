// Approve every design of views in a folder, as the person would before a
// build (plan, 10.9): Prelude's own check, with --approve.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const check = fileURLToPath(new URL('../tools/check.js', import.meta.url));

export function approve(folderPath) {
  try {
    execFileSync(process.execPath, [check, folderPath, '--approve'], { stdio: 'ignore', windowsHide: true });
  } catch { /* a design whose pages don't render isn't approved; the test says so */ }
}
