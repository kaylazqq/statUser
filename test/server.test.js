import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { CoLinkError } from '@colink/app-sdk';
import { createServer } from '../src/server.js';
const config = { publicOrigin: 'https://stats.example', hostOrigin: 'https://host.example', maxStatsConcurrency: 1, sdk: { issuer: 'https://host.example' } };
const identity = { installationId: 'install-1', userId: 'u1', source: { channelId: 'c1', topicId: 'trusted-topic' }, scopes: [] };
const empty = { items: [], hasMore: false, nextCursor: null };
async function fixture(t, overrides = {}) {
  const calls = [];
  const c = { participants: { list: async q => { calls.push(q); return { ...empty, items: [{ userId: 'u1' }] }; } }, topicMessages: { read: async q => { calls.push(q); return { ...empty, items: [{ id: 'm1', senderKind: 'human' }] }; } } };
  const app = { pages: { authenticate: async () => identity, client: () => { calls.push('U'); return c; } },
    client: id => { calls.push(['A', id]); return c; }, publicHandler: async (req, res) => { res.writeHead(404); res.end(); }, ...overrides };
  const server = await createServer({ config, app }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { server, app, calls, origin: `http://127.0.0.1:${server.address().port}` };
}
test('source and installation are SDK-validated; query/body cannot select other resources', async t => {
  const f = await fixture(t);
  const r = await fetch(f.origin + '/api/v1/topic-stats?topicId=attacker&installationId=other');
  assert.equal(r.status, 200); const result = await r.json(); assert.equal(result.topicId, 'trusted-topic'); assert.equal(result.messageCount, 1);
  assert.deepEqual(f.calls[0], ['A', 'install-1']);
  assert.ok(f.calls.slice(1).every(q => q.topicId === 'trusted-topic'));
  assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('expired or revoked identity rejects before any installation/data access', async t => {
  const f = await fixture(t, { pages: { authenticate: async () => { throw new CoLinkError('PAGE_LOGIN_REQUIRED', 401); } } });
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats')).status, 401); assert.equal(f.calls.length, 0);
});
test('private mode requires U and never silently uses A', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats?mode=private')).status, 403); assert.equal(f.calls.length, 0);
  f.app.pages.authenticate = async () => ({ ...identity, scopes: ['messages:read-private'] });
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats?mode=private')).status, 200);
  assert.equal(f.calls[0], 'U'); assert.ok(!f.calls.some(q => Array.isArray(q)));
});
test('failed private read never falls back to installation A', async t => {
  const f = await fixture(t);
  f.app.pages.authenticate = async () => ({ ...identity, scopes: ['messages:read-private'] });
  f.app.pages.client = () => { throw new CoLinkError('ACCESS_DENIED', 403); };
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats?mode=private')).status, 403); assert.equal(f.calls.length, 0);
});
test('missing trusted topic and invalid read mode do not read data', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats?mode=guess')).status, 400);
  f.app.pages.authenticate = async () => ({ ...identity, source: {} });
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats')).status, 403); assert.equal(f.calls.length, 0);
});
test('unknown errors do not leak upstream credentials or become zeros', async t => {
  const f = await fixture(t, { client: () => { throw Error('secret raw request'); } });
  const r = await fetch(f.origin + '/api/v1/topic-stats'); assert.equal(r.status, 502);
  const text = await r.text(); assert.ok(!text.includes('secret')); assert.ok(!text.includes('messageCount'));
});
test('static SDK/config and CSP expose no credentials; old login endpoint is unavailable', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/v1/sessions', { method: 'POST' })).status, 404);
  const html = await fetch(f.origin + '/index.html'); assert.match(html.headers.get('content-security-policy'), /frame-ancestors https:\/\/host.example/);
  const sdk = await fetch(f.origin + '/colink-browser.mjs'); assert.match(await sdk.text(), /connectPage/);
  assert.deepEqual(await fetch(f.origin + '/page-config.json').then(r => r.json()), { hostOrigin: config.hostOrigin, issuer: config.sdk.issuer });
});
test('bounded concurrency rejects overload and releases its slot after failure', async t => {
  const f = await fixture(t);
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  f.app.client = () => ({ participants: { list: async () => { entered(); await pending; throw Error('failed'); } }, topicMessages: { read: async () => empty } });
  const first = fetch(f.origin + '/api/v1/topic-stats');
  await started;
  try {
    const busy = await fetch(f.origin + '/api/v1/topic-stats');
    assert.equal(busy.status, 429); assert.equal(busy.headers.get('retry-after'), '1');
  } finally { finish(); }
  assert.equal((await first).status, 502);
  f.app.client = () => ({ participants: { list: async () => empty }, topicMessages: { read: async () => empty } });
  assert.equal((await fetch(f.origin + '/api/v1/topic-stats')).status, 200);
});
test('each request revalidates current user and installation instead of caching prior identity', async t => {
  const f = await fixture(t);
  await fetch(f.origin + '/api/v1/topic-stats');
  f.app.pages.authenticate = async () => ({ ...identity, userId: 'u2', installationId: 'install-2', source: { channelId: 'c2', topicId: 't2' } });
  const response = await fetch(f.origin + '/api/v1/topic-stats');
  assert.equal((await response.json()).topicId, 't2');
  assert.deepEqual(f.calls[3], ['A', 'install-2']);
});
