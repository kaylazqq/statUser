import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';

const config = { port: 0, platformOrigin: 'https://colink.example', hostOrigin: 'https://colink.example', publicOrigin: 'https://stats.example', appId: 'app', appSecret: 'secret', secureCookie: false };

test('serves manifest and calculates stats only from the trusted exchanged topic', async t => {
  const requested = [];
  const client = {
    async exchange() { return { accessToken: 'token', installationId: 'install-1', expiresAt: '2099-01-01T00:00:00Z', source: { channelId: 'c1', topicId: 'trusted-topic' } }; },
    async validate() { return { installationId: 'install-1', source: { channelId: 'c1', topicId: 'trusted-topic' } }; },
    async getPage(path) {
      requested.push(path);
      return path.includes('participants')
        ? { items: [{ userId: 'u1' }], hasMore: false, nextCursor: null }
        : { items: [{ senderKind: 'agent', senderName: 'A' }], hasMore: false, nextCursor: null };
    },
  };
  const server = await createServer({ config, client });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifest = await fetch(`${origin}/manifest.json`).then(r => r.json());
  assert.equal(manifest.ui.entries[0].extensionPoint.id, 'colink.topic.actions');
  const login = await fetch(`${origin}/api/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uiSessionId: 'ui', loginCode: 'code' }) });
  assert.equal(login.status, 201);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${origin}/api/v1/topic-stats?topicId=attacker-topic`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.ok(requested.every(item => item.includes('trusted-topic')));
});

test('rejects stats without an app session', async t => {
  const server = await createServer({ config, client: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/topic-stats`);
  assert.equal(response.status, 401);
});
