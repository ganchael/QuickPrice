import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installLegacyClipboard } from '../lib/legacy-clipboard.ts';

test('legacy clipboard fills a missing writeText and leaves an existing one', () => {
  const existing = { clipboard: { writeText: async () => {} } };
  const original = existing.clipboard.writeText;
  installLegacyClipboard(existing);
  assert.equal(existing.clipboard.writeText, original);
  const fresh = {};
  installLegacyClipboard(fresh);
  assert.equal(typeof fresh.clipboard.writeText, 'function');
});
