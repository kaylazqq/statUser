import crypto from 'node:crypto';

export class SessionStore {
  constructor() { this.sessions = new Map(); }

  create(value) {
    const id = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(id, value);
    return id;
  }

  get(id) {
    const value = id && this.sessions.get(id);
    if (!value) return null;
    if (Date.parse(value.expiresAt) <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return value;
  }

  delete(id) { if (id) this.sessions.delete(id); }
  sweep() { for (const id of this.sessions.keys()) this.get(id); }
}
