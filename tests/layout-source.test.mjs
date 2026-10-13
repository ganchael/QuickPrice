import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../app/quickprice-app.tsx', import.meta.url), 'utf8');

test('app CSS clears the phone action bar and pins desktop actions without a hotfix stylesheet', () => {
  assert.match(css, /bottom: calc\(68px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /z-index: 41/);
  assert.match(css, /bottom: calc\(50px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /min-width: 741px/);
  assert.match(css, /\.quote-actions \{[^}]*position: fixed/s);
  assert.match(app, /className="quote-actions"/);
  assert.match(app, /installLegacyClipboard/);
  assert.match(app, /恢复自动/);
  const clearance = css.lastIndexOf('z-index: 41');
  const covered = css.indexOf('z-index: 30');
  assert.ok(clearance > covered);
});
