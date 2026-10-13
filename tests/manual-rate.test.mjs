import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearManualRate, MANUAL_RATE_KEY, readManualRate, writeManualRate } from '../lib/manual-rate.ts';

function memory() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
  };
}

test('manual rate persists only valid values and survives a fresh read', () => {
  const store = memory();
  writeManualRate('7.2', store);
  assert.equal(readManualRate(store), '7.2');
  assert.equal(store.getItem(MANUAL_RATE_KEY), '7.2');
  writeManualRate('7.', store);
  assert.equal(readManualRate(store), '7.2');
  writeManualRate('', store);
  assert.equal(readManualRate(store), null);
  writeManualRate(' 6.750000 ', store);
  assert.equal(readManualRate(store), '6.750000');
  clearManualRate(store);
  assert.equal(readManualRate(store), null);
  writeManualRate('0', store);
  writeManualRate('-1', store);
  assert.equal(readManualRate(store), null);
});
