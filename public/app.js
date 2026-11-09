import { connectPage, createPageClient } from '/colink-browser.mjs';
const $ = id => document.getElementById(id);
const status = $('status'), stats = $('stats'), note = $('note');
let page, connection, mode, busy = false;
function clear() { stats.hidden = true; note.hidden = true; for (const strong of stats.querySelectorAll('strong')) strong.textContent = '–'; }
function buttons() {
  $('public-read').disabled = busy || !page;
  $('private-read').disabled = busy || !page;
  $('refresh').disabled = busy || !page || !mode;
}
async function run(nextMode, refresh = false) {
  if (busy || !page) return;
  busy = true; clear(); buttons();
  status.className = ''; status.textContent = '正在验证使用者并读取当前话题…';
  try {
    if (!refresh) await page.login();
    if (nextMode === 'private' && !refresh) await page.authorize(['messages:read-private']);
    // POST sends the browser's exact Origin, required by the trusted U client.
    const data = await page.appRequest({ path: '/api/v1/topic-stats', method: 'POST', query: { mode: nextMode }, body: {} });
    const fields = { 'human-members': 'humanMemberCount', agents: 'speakingAgentCount', messages: 'messageCount', 'human-messages': 'humanMessageCount', 'agent-messages': 'agentMessageCount' };
    for (const [id, field] of Object.entries(fields)) {
      if (!Number.isSafeInteger(data[field]) || data[field] < 0) throw Error('INVALID_STATS_RESULT');
      $(id).textContent = data[field];
    }
    mode = nextMode;
    status.textContent = `更新于 ${new Date(data.computedAt).toLocaleTimeString()} · ${mode === 'public' ? '公共话题' : '私密话题'}${data.unknownMessageCount ? ` · 其他类型消息 ${data.unknownMessageCount}` : ''}`;
    stats.hidden = false; note.hidden = false;
  } catch (error) {
    clear(); mode = undefined;
    const problem = error?.name === 'CoLinkError' && typeof error.toJSON === 'function' ? error.toJSON()
      : { message: '统计未完成。', hint: '请检查授权后重试；页面已关闭时从 CoLink 重新打开。' };
    status.className = 'error'; status.textContent = `${problem.message} ${problem.hint || ''}`;
  } finally { busy = false; buttons(); }
}
$('public-read').onclick = () => run('public');
$('private-read').onclick = () => run('private');
$('refresh').onclick = () => run(mode, true);
window.addEventListener('pagehide', () => { clear(); page?.close(); }, { once: true });
try {
  const response = await fetch('/page-config.json', { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw Error('PAGE_CONFIG_UNAVAILABLE');
  const config = await response.json();
  // Automatic handshake: host hides the iframe until initialization completes.
  connection = connectPage(config);
  const context = await connection.ready;
  document.documentElement.dataset.theme = context.theme === 'dark' ? 'dark' : 'light';
  connection.onThemeChange(({ theme }) => { document.documentElement.dataset.theme = theme; });
  page = createPageClient({ connection, issuer: config.issuer, allowInsecureLocal: config.allowInsecureLocal });
  status.textContent = '已连接。请选择当前话题类型；私密话题仅在本人明确授权后读取。';
  buttons();
  if (context.availableMethods.includes('view.ready')) await connection.presentationReady();
} catch {
  page = undefined; clear(); buttons();
  status.className = 'error'; status.textContent = '无法连接 CoLink，请从受信任的 CoLink 话题入口重新打开。';
}
