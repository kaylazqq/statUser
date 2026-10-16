const hostOrigin = __COLINK_HOST_ORIGIN__;
const status = document.querySelector('#status');
const stats = document.querySelector('#stats');
const note = document.querySelector('#note');
const refresh = document.querySelector('#refresh');
let connected = false;

function hostRequest(port, method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => reject(new Error('CoLink Bridge 响应超时')), 5000);
    const receive = event => {
      if (event.data?.protocol !== 'colink.ui/1.0.0' || event.data?.requestId !== requestId) return;
      port.removeEventListener('message', receive);
      clearTimeout(timeout);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    };
    port.addEventListener('message', receive);
    port.start();
    port.postMessage({ protocol: 'colink.ui/1.0.0', requestId, method, params });
  });
}

function setError(message) {
  status.textContent = message;
  status.className = 'error';
  stats.hidden = true;
  note.hidden = true;
}

async function loadStats() {
  refresh.disabled = true;
  status.textContent = '正在统计…';
  status.className = '';
  try {
    const response = await fetch('/api/v1/topic-stats', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '统计失败');
    document.querySelector('#human-members').textContent = data.humanMemberCount;
    document.querySelector('#agents').textContent = data.speakingAgentCount;
    document.querySelector('#messages').textContent = data.messageCount;
    document.querySelector('#human-messages').textContent = data.humanMessageCount;
    document.querySelector('#agent-messages').textContent = data.agentMessageCount;
    status.textContent = `更新于 ${new Date(data.computedAt).toLocaleTimeString()}`;
    stats.hidden = false;
    note.hidden = false;
  } catch (error) { setError(error.message); }
  finally { refresh.disabled = false; }
}

refresh.addEventListener('click', loadStats);

window.addEventListener('message', async event => {
  if (connected || event.source !== window.parent || event.origin !== hostOrigin) return;
  if (event.data?.type !== 'colink.ui.connected' || event.data?.version !== '1.0.0' || !event.ports[0]) return;
  connected = true;
  try {
    const initialized = await hostRequest(event.ports[0], 'host.initialize');
    if (!initialized?.source?.topicId || !initialized?.source?.channelId) throw new Error('请从话题操作入口打开应用');
    document.documentElement.dataset.theme = initialized.theme === 'dark' ? 'dark' : 'light';
    const response = await fetch('/api/v1/sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uiSessionId: event.data.uiSessionId, loginCode: event.data.loginCode }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '登录应用失败');
    if (result.source.topicId !== initialized.source.topicId || result.source.channelId !== initialized.source.channelId) throw new Error('页面来源校验失败');
    await loadStats();
  } catch (error) { setError(error.message); }
}, { once: false });

window.parent.postMessage({ type: 'colink.ui.ready', version: '1.0.0' }, hostOrigin);
