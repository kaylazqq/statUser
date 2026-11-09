import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTopicStats } from '../src/stats.js';
const page = items => ({ items, hasMore: false, nextCursor: null });
const client = (people, messages) => ({ participants: { list: people }, topicMessages: { read: messages } });
test('paginates actual SDK methods, deduplicates IDs, counts humans/agents/unknown without retaining bodies', async () => {
  const calls = [];
  const c = client(async q => { calls.push(q); return q.cursor ? page([{ userId: 'u2' }, { userId: 'u1' }]) : { items: [{ userId: 'u1' }], hasMore: true, nextCursor: 'p2' }; },
    async q => { calls.push(q); return q.cursor ? page([{ id: 'm2', senderKind: 'agent', senderName: 'A' }, { id: 'm3', senderKind: 'agent', senderName: 'A' }, { id: 'm4', senderKind: 'app' }])
      : { items: [{ id: 'm1', senderKind: 'human' }, { id: 'm2', senderKind: 'agent', senderName: 'A' }], hasMore: true, nextCursor: 'm2' }; });
  const result = await calculateTopicStats(c, 't1', { now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(result.humanMemberCount, 2); assert.equal(result.messageCount, 4);
  assert.equal(result.humanMessageCount, 1); assert.equal(result.agentMessageCount, 2);
  assert.equal(result.speakingAgentCount, 1); assert.equal(result.unknownMessageCount, 1);
  assert.equal(result.consistency, 'live_paginated_not_snapshot');
  assert.equal(calls.length, 4); assert.ok(calls.every(q => q.topicId === 't1' && q.limit === 100));
});
test('an upstream failure is not an empty successful result', async () => {
  await assert.rejects(calculateTopicStats(client(async () => { throw Error('offline'); }, async () => page([])), 't'), /offline/);
});
test('repeated cursor fails instead of looping or reporting partial counts', async () => {
  let n = 0;
  await assert.rejects(calculateTopicStats(client(async () => { n++; return { items: [], hasMore: true, nextCursor: 'same' }; }, async () => page([])), 't'), /CURSOR/);
  assert.equal(n, 2);
});
test('malformed pages and missing stable message IDs fail closed', async () => {
  await assert.rejects(calculateTopicStats(client(async () => page([]), async () => page([{ senderKind: 'human' }])), 't'), /INVALID_MESSAGE/);
});
test('cancellation prevents any platform reads', async () => {
  let calls = 0; const abort = new AbortController(); abort.abort();
  await assert.rejects(calculateTopicStats(client(async () => { calls++; }, async () => { calls++; }), 't', { signal: abort.signal }));
  assert.equal(calls, 0);
});
test('failed request still joins the other in-flight scan before completion', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; }); let completed = false;
  const result = calculateTopicStats(client(async () => { throw Error('denied'); }, async () => { await pending; return page([]); }), 't');
  result.catch(() => { completed = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(completed, false);
  finish(); await assert.rejects(result, /denied/);
});
