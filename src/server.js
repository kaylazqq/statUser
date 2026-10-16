import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ColinkClient, ColinkError } from './colink-client.js';
import { calculateTopicStats } from './stats.js';
import { SessionStore } from './session-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const COOKIE = 'topic_stats_session';

function configFromEnv(env = process.env) {
  const required = ['COLINK_PLATFORM_ORIGIN', 'COLINK_HOST_ORIGIN', 'COLINK_PUBLIC_ORIGIN', 'COLINK_APP_ID', 'COLINK_APP_SECRET'];
  for (const key of required) if (!env[key]) throw new Error(`${key} is required`);
  for (const key of ['COLINK_PLATFORM_ORIGIN', 'COLINK_HOST_ORIGIN', 'COLINK_PUBLIC_ORIGIN']) new URL(env[key]);
  return {
    port: Number(env.PORT || 8080),
    platformOrigin: new URL(env.COLINK_PLATFORM_ORIGIN).origin,
    hostOrigin: new URL(env.COLINK_HOST_ORIGIN).origin,
    publicOrigin: new URL(env.COLINK_PUBLIC_ORIGIN).origin,
    appId: env.COLINK_APP_ID,
    appSecret: env.COLINK_APP_SECRET,
    secureCookie: env.SESSION_COOKIE_SECURE !== 'false',
  };
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}

function send(response, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  response.end(payload);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function errorResponse(response, error) {
  if (error instanceof ColinkError) {
    const status = [400, 401, 403, 404, 409].includes(error.status) ? error.status : 502;
    send(response, status, { code: error.code || 'PLATFORM_REQUEST_FAILED', message: error.message, requestId: error.requestId });
    return;
  }
  const status = error.message === 'REQUEST_TOO_LARGE' ? 413 : error instanceof SyntaxError ? 400 : 500;
  send(response, status, { code: status === 500 ? 'INTERNAL_ERROR' : error.message, message: status === 500 ? '服务暂时不可用' : '请求格式无效' });
}

export async function createServer(options = {}) {
  const config = options.config || configFromEnv();
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const store = options.store || new SessionStore();
  const client = options.client || new ColinkClient({ origin: config.platformOrigin, appId: config.appId, appSecret: config.appSecret });
  const files = new Map(await Promise.all(['index.html', 'app.js', 'styles.css'].map(async name => [name, await readFile(path.join(root, 'public', name))])));

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, config.publicOrigin);
    try {
      if (request.method === 'GET' && url.pathname === '/healthz') return send(response, 200, 'ok', { 'Content-Type': 'text/plain; charset=utf-8' });
      if (request.method === 'GET' && url.pathname === '/readyz') return send(response, 200, { ready: true }, { 'Content-Type': 'application/json' });
      if (request.method === 'GET' && url.pathname === '/manifest.json') return send(response, 200, manifest, { 'Content-Type': 'application/json; charset=utf-8' });
      if (request.method === 'GET' && ['/index.html', '/app.js', '/styles.css', '/'].includes(url.pathname)) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const content = name === 'app.js'
          ? Buffer.from(files.get(name).toString('utf8').replace('__COLINK_HOST_ORIGIN__', JSON.stringify(config.hostOrigin)))
          : files.get(name);
        return send(response, 200, content, { 'Content-Type': MIME[path.extname(name)], 'Cache-Control': 'public, max-age=300', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors ${config.hostOrigin}` });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/sessions') {
        const input = await body(request);
        if (typeof input.uiSessionId !== 'string' || typeof input.loginCode !== 'string') return send(response, 400, { code: 'INVALID_INPUT', message: '缺少登录信息' }, { 'Content-Type': 'application/json' });
        const exchanged = await client.exchange(input.uiSessionId, input.loginCode);
        if (!exchanged.source?.topicId || !exchanged.source?.channelId) return send(response, 403, { code: 'TOPIC_SOURCE_REQUIRED', message: '请从话题操作入口打开应用' }, { 'Content-Type': 'application/json' });
        const id = store.create(exchanged);
        const cookie = `${COOKIE}=${encodeURIComponent(id)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=1800${config.secureCookie ? '; Secure' : ''}`;
        return send(response, 201, { source: exchanged.source, expiresAt: exchanged.expiresAt }, { 'Content-Type': 'application/json', 'Set-Cookie': cookie });
      }
      if (request.method === 'DELETE' && url.pathname === '/api/v1/sessions/current') {
        store.delete(cookies(request)[COOKIE]);
        return send(response, 204, '', { 'Set-Cookie': `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.secureCookie ? '; Secure' : ''}` });
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/topic-stats') {
        const session = store.get(cookies(request)[COOKIE]);
        if (!session) return send(response, 401, { code: 'SESSION_REQUIRED', message: '页面会话已失效，请重新打开应用' }, { 'Content-Type': 'application/json' });
        const validated = await client.validate(session.accessToken);
        if (validated.installationId !== session.installationId || validated.source?.topicId !== session.source.topicId || validated.source?.channelId !== session.source.channelId) {
          store.delete(cookies(request)[COOKIE]);
          return send(response, 401, { code: 'SESSION_BINDING_CHANGED', message: '页面授权已变化，请重新打开应用' }, { 'Content-Type': 'application/json' });
        }
        const stats = await calculateTopicStats(client, session.source.topicId, session.accessToken);
        return send(response, 200, stats, { 'Content-Type': 'application/json' });
      }
      return send(response, 404, { code: 'NOT_FOUND', message: '接口不存在' }, { 'Content-Type': 'application/json' });
    } catch (error) { errorResponse(response, error); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().then(server => server.listen(configFromEnv().port, '0.0.0.0', () => console.log('topic participant stats listening'))).catch(error => { console.error(error.message); process.exit(1); });
}
