import assert from 'node:assert/strict';
import { test } from 'node:test';
const base = process.env.QUICKPRICE_TEST_URL;

test('cloud API: auth, durable sessions, validation and stale-write protection', { skip: !base }, async () => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use only a local test server');
  const api = new URL('/api/catalog', base);
  assert.equal((await fetch(api)).status, 401);
  const signIn = await fetch(new URL('/signin-with-chatgpt?return_to=/', base), { redirect: 'manual' });
  const cookie = signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'Local auth should return a session cookie');
  const get = () => fetch(api, { headers: { Cookie: cookie } });
  const initial = await get(); assert.equal(initial.status, 200);
  const original = await initial.json();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', Origin: new URL(base).origin };
  const products = [{ id: crypto.randomUUID(), shortName: 'TEST5', name: 'Sync test product', specification: '5mg*10vials', unit: '盒', price: '75.00', category: '测试', aliases: [] }];
  let revision = original.revision;
  const ownerId = original.ownerId;
  assert.ok(ownerId);
  try {
    const saved = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ products, revision, ownerId }) });
    assert.equal(saved.status, 200, await saved.clone().text()); revision = (await saved.json()).revision;
    const persisted = await (await get()).json(); assert.equal(persisted.products[0].name, 'Sync test product'); assert.equal(persisted.revision, revision);
    const wrongOwner = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ products, revision, ownerId: 'different-account' }) }); assert.equal(wrongOwner.status, 403);
    const stale = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ products, revision: revision - 1, ownerId }) }); assert.equal(stale.status, 409);
    const invalid = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ products: [{ ...products[0], price: '-100' }], revision, ownerId }) }); assert.equal(invalid.status, 400);
    const crossOrigin = await fetch(api, { method: 'PUT', headers: { ...headers, Origin: 'https://example.invalid' }, body: JSON.stringify({ products, revision, ownerId }) }); assert.equal(crossOrigin.status, 403);
    assert.equal((await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products, revision, ownerId }) })).status, 401);
    const secondSession = await fetch(new URL('/signin-with-chatgpt?return_to=/', base), { redirect: 'manual' });
    const secondCookie = secondSession.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const secondRead = await (await fetch(api, { headers: { Cookie: secondCookie } })).json(); assert.equal(secondRead.products[0].shortName, 'TEST5');
  } finally {
    const restore = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ products: original.products, revision, ownerId }) }); assert.equal(restore.status, 200);
  }
});
