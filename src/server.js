import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCoLinkApp, openEncryptedStore, validateIssuer, CoLinkError } from '@colink/app-sdk';
import { calculateTopicStats } from './stats.js';
import { createTelemetry } from './telemetry.js';

export function configFromEnv(env = process.env) {
  const required = key => { if (!env[key]) throw Error(`${key} is required`); return env[key]; };
  const local = env.COLINK_ALLOW_INSECURE_ISSUER === 'true';
  const issuer = required('COLINK_ISSUER'), hostOrigin = required('COLINK_HOST_ORIGIN');
  const publicOrigin = env.COLINK_APP_ORIGIN || required('COLINK_PUBLIC_ORIGIN');
  if (env.COLINK_APP_ORIGIN && env.COLINK_PUBLIC_ORIGIN && env.COLINK_APP_ORIGIN !== env.COLINK_PUBLIC_ORIGIN) throw Error('Conflicting App origins');
  for (const origin of [issuer, hostOrigin, publicOrigin]) validateIssuer(origin, local);
  const maxStatsConcurrency = Number(env.STATS_MAX_CONCURRENCY || 32), port = Number(env.PORT || 8080);
  if (!Number.isInteger(maxStatsConcurrency) || maxStatsConcurrency < 1 || maxStatsConcurrency > 256) throw Error('Invalid STATS_MAX_CONCURRENCY');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  return { port, hostOrigin, publicOrigin, maxStatsConcurrency, telemetryEnabled: env.STATS_TELEMETRY_ENABLED === 'true',
    stateFile: required('COLINK_STATE_FILE'), credentialKey: required('COLINK_CREDENTIAL_KEY'),
    sdk: { issuer, apiBase: issuer + '/api/v1', allowInsecureIssuer: local,
      appId: required('COLINK_APP_ID'), appInstanceId: required('COLINK_APP_INSTANCE_ID'),
      clientId: required('COLINK_CLIENT_ID'), clientSecret: required('COLINK_CLIENT_SECRET'), signingSecret: required('COLINK_SIGNING_SECRET') } };
}
const json = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function send(res, status, data, headers = json) {
  res.writeHead(status, headers);
  res.end(Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data));
}
function errorResponse(res, error) {
  if (res.destroyed || res.writableEnded) return;
  if (error instanceof CoLinkError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    return send(res, status, error.toJSON());
  }
  send(res, 502, { code: 'STATS_UNAVAILABLE', message: '本次统计未完成，不能作为空结果使用。', hint: '检查授权和平台连接后重试。' });
}
export async function createServer(options = {}) {
  const config = options.config || configFromEnv();
  const telemetry=createTelemetry({enabled:config.telemetryEnabled,issuer:config.sdk.issuer,fetcher:options.fetcher||fetch});
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const store=options.app?undefined:openEncryptedStore(config.stateFile,config.credentialKey);
  const app = options.app || createCoLinkApp({ config: config.sdk,
    store, manifest,
    pages: { origin: config.publicOrigin, capabilities: { readOnly: true } }, fetcher:telemetry.fetcher });
  const files = new Map(await Promise.all(['index.html', 'app.js', 'styles.css'].map(async name =>
    ['/' + name, await readFile(new URL('../public/' + name, import.meta.url))])));
  const browser = options.browserModule || await readFile(new URL(import.meta.resolve('@colink/app-sdk/browser')));
  let active = 0;
  const server = http.createServer((req, res) => {
    const phase=telemetry.observe(req,res);
    return telemetry.run(phase,async()=>{
    try {
      const url = new URL(req.url, config.publicOrigin);
      if(req.method==='GET'&&url.pathname==='/metrics'){
        if(!config.telemetryEnabled||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(res,404,{code:'NOT_FOUND'});
        const state=store?`echo_stats_sdk_transactions ${Object.keys(store.data.pageTransactions||{}).length}\necho_stats_sdk_sessions ${Object.keys(store.data.pageSessions||{}).length}\necho_stats_sdk_capacity 1000\n`:'';
        return send(res,200,telemetry.render()+state,{'Content-Type':'text/plain; version=0.0.4','Cache-Control':'no-store'});
      }
      if (req.method === 'GET' && url.pathname === '/page-config.json') {
        return send(res, 200, { hostOrigin: config.hostOrigin, issuer: config.sdk.issuer, allowInsecureLocal: config.sdk.allowInsecureIssuer });
      }
      if (req.method === 'GET' && url.pathname === '/colink-browser.mjs') {
        return send(res, 200, browser, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      const file = url.pathname === '/' ? '/index.html' : url.pathname;
      if (req.method === 'GET' && files.has(file)) {
        const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css';
        return send(res, 200, files.get(file), { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors ${config.hostOrigin}` });
      }
      if (['GET', 'POST'].includes(req.method) && url.pathname === '/api/v1/topic-stats') {
        if (req.method === 'POST') {
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 2048) return send(res, 413, { code: 'REQUEST_TOO_LARGE' });
          }
        }
        const identity = await app.pages.authenticate(req);
        const source = identity.source;
        if (typeof source?.topicId !== 'string' || !source.topicId || typeof source.channelId !== 'string' || !source.channelId) {
          return send(res, 403, { code: 'TOPIC_SOURCE_REQUIRED', message: '请从话题操作入口打开。' });
        }
        const mode = url.searchParams.get('mode') || 'public';
        if (!['public', 'private'].includes(mode)) return send(res, 400, { code: 'INVALID_READ_MODE' });
        if (mode === 'private' && !identity.scopes.includes('messages:read-private')) {
          return send(res, 403, { code: 'PAGE_AUTHORIZATION_REQUIRED', message: '私密话题需要当前使用者授权。' });
        }
        if (active >= config.maxStatsConcurrency) return send(res, 429, { code: 'STATS_BUSY', message: '统计繁忙，请稍后重试。' }, { ...json, 'Retry-After': '1' });
        active++;
        const abort = new AbortController();
        const closed = () => { if (!res.writableEnded) abort.abort(); };
        res.once('close', closed);
        try {
          // Select identity before the read, never by retrying a failed identity.
          const client = mode === 'private' ? app.pages.client(req) : app.client(identity.installationId);
          const result = await calculateTopicStats(client, source.topicId, { signal: abort.signal });
          if (!abort.signal.aborted) send(res, 200, { ...result, readMode: mode });
        } finally { active--; res.off('close', closed); }
        return;
      }
      // SDK retains original bytes/signatures and owns OAuth, installation/ready and page sessions.
      await app.publicHandler(req, res);
    } catch (error) { errorResponse(res, error); }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.app = app;
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let server;
  if (process.env.COLINK_BOOTSTRAP === 'true') {
    const { pendingManifestHandler } = await import('../node_modules/@colink/app-sdk/examples/shared/bootstrap.mjs');
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    server = http.createServer(pendingManifestHandler({ manifest, stateFile: process.env.COLINK_STATE_FILE }));
    server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  } else {
    server = await createServer();
    server.listen(configFromEnv().port, '0.0.0.0', () => { server.app.start(); console.log('topic participant stats listening'); });
  }
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    if (closing) return;
    closing = true;
    await server.app?.close();
    server.closeAllConnections();
    server.close();
  });
}
