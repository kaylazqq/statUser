import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTopicStats } from '../src/stats.js';

test('paginates and separates humans from agents', async () => {
  const calls = [];
  const client = { async getPage(path) {
    calls.push(path);
    if (path.startsWith('/topics/t1/participants')) {
      return path.includes('cursor=people-2')
        ? { items: [{ userId: 'u2' }, { userId: 'u1' }], hasMore: false, nextCursor: null }
        : { items: [{ userId: 'u1' }], hasMore: true, nextCursor: 'people-2' };
    }
    return path.includes('cursor=messages-2')
      ? { items: [{ senderKind: 'agent', senderName: '总结助手' }, { senderKind: 'human', senderName: '李四' }], hasMore: false, nextCursor: null }
      : { items: [{ senderKind: 'human', senderName: '张三' }, { senderKind: 'agent', senderName: '总结助手' }, { senderKind: 'agent', senderName: '分析助手' }], hasMore: true, nextCursor: 'messages-2' };
  } };
  const result = await calculateTopicStats(client, 't1', 'token', () => new Date('2026-10-16T00:00:00Z'));
  assert.deepEqual(result, {
    topicId: 't1', humanMemberCount: 2, speakingAgentCount: 2, messageCount: 5,
    humanMessageCount: 2, agentMessageCount: 3, computedAt: '2026-10-16T00:00:00.000Z',
    agentCountAccuracy: 'deduplicated_by_sender_name',
  });
  assert.equal(calls.length, 4);
});
