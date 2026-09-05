import assert from 'node:assert/strict';
import { test } from 'node:test';
const base = process.env.QUICKPRICE_TEST_URL;
const password = process.env.QUICKPRICE_TEST_PASSWORD;

test('account login gates pages and catalog; sessions persist, revoke, and resist stale writes', { skip: !base || !password }, async () => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use only a local test server');
  const origin = new URL(base).origin;
  const api = new URL('/api/catalog', base);
  const credentials = { username: 'zlw', password };
  const login = (data = credentials, more = {}) => fetch(new URL('/api/auth/login', base), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...more }, body: JSON.stringify(data) });
  const anonymous = await fetch(new URL('/', base), { redirect: 'manual' });
  assert.ok([302,303,307,308].includes(anonymous.status)); assert.equal(new URL(anonymous.headers.get('location'), base).pathname, '/login');
  assert.equal((await fetch(new URL('/login', base))).status, 200);
  assert.equal((await fetch(api)).status, 401);
  assert.equal((await fetch(api, { headers: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'forged@example.invalid' } })).status, 401);
  assert.equal((await fetch(api, { headers: { Cookie: 'quickprice_session=' + 'a'.repeat(64) } })).status, 401);
  assert.equal((await login({ username: 'someone-else', password })).status, 401);
  assert.equal((await login({ username: 'zlw', password: 'incorrect' })).status, 401);
  assert.equal((await login(credentials, { Origin: 'https://example.invalid' })).status, 403);
  const signIn = await login(); assert.equal(signIn.status, 200, await signIn.clone().text());
  const cookieHeader = signIn.headers.getSetCookie()[0]; assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Lax/);
  const cookie = cookieHeader.split(';')[0];
  const get = () => fetch(api, { headers: { Cookie: cookie } });
  const initial = await get(); assert.equal(initial.status, 200); const original = await initial.json();
  assert.equal(original.ownerId, 'account:zlw');
  const page = await fetch(new URL('/', base), { headers: { Cookie: cookie } }); assert.equal(page.status, 200);
  const pageText = await page.text(); assert.ok(pageText.includes('计价明细')); assert.ok(!pageText.includes('使用 ChatGPT 登录'));
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin };
  const products = [{ id: crypto.randomUUID(), shortName: 'TEST5', name: 'Sync test product', specification: '5mg*10vials', unit: '盒', price: '75.00', category: '测试', aliases: [] }];
  let revision = original.revision; const ownerId = original.ownerId;
  const save = (data, extra = {}) => fetch(api, { method: 'PUT', headers: { ...headers, ...extra }, body: JSON.stringify(data) });
  let secondCookie;
  try {
    const saved = await save({ products, revision, ownerId }); assert.equal(saved.status, 200, await saved.clone().text()); revision = (await saved.json()).revision;
    assert.equal((await (await get()).json()).products[0].name, 'Sync test product');
    assert.equal((await save({ products, revision, ownerId: 'other-user' })).status, 403);
    assert.equal((await save({ products, revision: revision - 1, ownerId })).status, 409);
    assert.equal((await save({ products: [{ ...products[0], price: '-100' }], revision, ownerId })).status, 400);
    assert.equal((await save({ products, revision, ownerId }, { Origin: 'https://example.invalid' })).status, 403);
    assert.equal((await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products, revision, ownerId }) })).status, 401);
    const secondLogin = await login(); assert.equal(secondLogin.status, 200); secondCookie = secondLogin.headers.getSetCookie()[0].split(';')[0]; assert.notEqual(secondCookie, cookie);
    assert.equal((await (await fetch(api, { headers: { Cookie: secondCookie } })).json()).products[0].shortName, 'TEST5');
  } finally {
    const restore = await save({ products: original.products, revision, ownerId }); assert.equal(restore.status, 200);
    const logout = await fetch(new URL('/api/auth/logout', base), { method: 'POST', headers: { Cookie: cookie, Origin: origin } }); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await get()).status, 401);
    if (secondCookie) {
      assert.equal((await fetch(api, { headers: { Cookie: secondCookie } })).status, 200);
      await fetch(new URL('/api/auth/logout', base), { method: 'POST', headers: { Cookie: secondCookie, Origin: origin } });
    }
  }
  for (let i = 0; i < 10; i++) assert.equal((await login({ username: 'zlw', password: 'wrong' })).status, 401);
  const limited = await login(); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
