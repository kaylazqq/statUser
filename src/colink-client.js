import { signedHeaders } from './channel-signature.js';

export class ColinkError extends Error {
  constructor(status, code, message, requestId) {
    super(message || code || `CoLink request failed (${status})`);
    this.name = 'ColinkError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function jsonResponse(response) {
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { throw new ColinkError(response.status, 'INVALID_PLATFORM_RESPONSE', 'CoLink 返回了无效 JSON'); }
  }
  if (!response.ok) throw new ColinkError(response.status, body.code, body.message, body.requestId);
  return body;
}

export class ColinkClient {
  constructor({ origin, appId, appSecret, fetchImpl = fetch }) {
    this.origin = origin.replace(/\/$/, '');
    this.appId = appId;
    this.appSecret = appSecret;
    this.fetch = fetchImpl;
  }

  async exchange(uiSessionId, loginCode) {
    const rawBody = JSON.stringify({ appId: this.appId, uiSessionId, loginCode });
    const response = await this.fetch(`${this.origin}/api/v1/extensions/session-exchanges`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...signedHeaders(this.appSecret, rawBody),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    return jsonResponse(response);
  }

  async validate(accessToken) {
    const response = await this.fetch(`${this.origin}/api/v1/extensions/session-validations`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    return jsonResponse(response);
  }

  async getPage(path, accessToken) {
    const response = await this.fetch(`${this.origin}/api/v1${path}`, {
      redirect: 'error',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    return jsonResponse(response);
  }
}
