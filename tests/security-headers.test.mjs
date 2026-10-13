import assert from 'node:assert/strict';
import { test } from 'node:test';
import { securityHeaders } from '../lib/security-headers.ts';

test('security headers frame-deny the app and keep the exchange-rate API same-origin', () => {
  for (const env of [{ nodeEnv: 'production' }, { nodeEnv: 'development' }, {}]) {
    const headers = securityHeaders(env);
    const joined = headers.map(header => `${header.name}: ${header.value}`).join('\n');
    assert.equal(joined.toLowerCase().includes('strict-transport-security'), false);
    assert.equal(headers.find(header => header.name === 'X-Frame-Options').value, 'DENY');
    const csp = headers.find(header => header.name === 'Content-Security-Policy').value;
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.equal(/https?:/.test(csp), false);
  }
  const dev = securityHeaders({ nodeEnv: 'development' }).find(header => header.name === 'Content-Security-Policy').value;
  assert.match(dev, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(dev, /ws: wss:/);
  const prod = securityHeaders({ nodeEnv: 'production' }).find(header => header.name === 'Content-Security-Policy').value;
  assert.equal(prod.includes('unsafe-eval'), false);
  assert.equal(prod.includes('ws:'), false);
});
