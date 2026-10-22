import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { configFromEnv, createServer } from '../src/server.js';

const config = { port: 0, platformOrigin: 'https://colink.example', hostOrigin: 'https://colink.example', publicOrigin: 'https://stats.example', appId: 'app', appInstanceId: 'instance', appSecret: 'secret', secureCookie: false };

test('requires the app instance id in environment configuration', () => {
  assert.throws(() => configFromEnv({
    COLINK_PLATFORM_ORIGIN: 'https://colink.example',
    COLINK_HOST_ORIGIN: 'https://colink.example',
    COLINK_PUBLIC_ORIGIN: 'https://stats.example',
    COLINK_APP_ID: 'app',
    COLINK_APP_SECRET: 'secret',
  }), /COLINK_APP_INSTANCE_ID is required/);
});

test('proves the app identity with the issued challenge', async t => {
  const server = await createServer({ config, client: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const challenge = 'a'.repeat(64);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/colink-app?challenge=${challenge}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  const expected = createHmac('sha256', config.appSecret)
    .update(`colink-app-verification-v1\n${config.appId}\n${config.appInstanceId}\n${challenge}`)
    .digest('hex');
  assert.deepEqual(result, { appId: config.appId, appInstanceId: config.appInstanceId, signature: expected });
  assert.equal(JSON.stringify(result).includes(config.appSecret), false);
});

test('rejects malformed app verification challenges', async t => {
  const server = await createServer({ config, client: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/.well-known/colink-app?challenge=invalid`);
  assert.equal(response.status, 400);
});

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
  assert.equal(manifest.version, '1.0.2');
  assert.match(manifest.description, /使用方式：安装到项目后/);
  const login = await fetch(`${origin}/api/v1/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uiSessionId: 'ui', loginCode: 'code' }) });
  assert.equal(login.status, 201);
  const created = await login.json();
  assert.match(created.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${origin}/api/v1/topic-stats?topicId=attacker-topic`, { headers: { Authorization: `Bearer ${created.sessionToken}` } });
  assert.equal(response.status, 200);
  assert.ok(requested.every(item => item.includes('trusted-topic')));

  const compatible = await fetch(`${origin}/api/v1/topic-stats`, { headers: { Cookie: cookie } });
  assert.equal(compatible.status, 200);
});

test('rejects stats without an app session', async t => {
  const server = await createServer({ config, client: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/topic-stats`);
  assert.equal(response.status, 401);
});
