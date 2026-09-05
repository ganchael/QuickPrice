import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pbkdf2Sync } from 'node:crypto';
import { verifyPassword, tokenHash } from '../lib/auth-crypto.ts';

test('password checks use the configured hash and reject malformed configuration', async () => {
  const salt = '1234567890abcdef1234567890abcdef';
  const password = 'test credential only';
  const record = JSON.stringify({ salt, hash: pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex') });
  assert.equal(await verifyPassword(password, record), true);
  assert.equal(await verifyPassword('incorrect', record), false);
  assert.equal(await verifyPassword(password + ' ', record), false);
  await assert.rejects(() => verifyPassword(password, '{"salt":"bad","hash":"bad"}'));
  assert.equal((await tokenHash('sample token')).length, 64);
  assert.notEqual(await tokenHash('sample token'), await tokenHash('different token'));
});
