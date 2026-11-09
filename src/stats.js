const MAX_PAGES = 1000;
async function scan(read, visit, signal) {
  let cursor;
  const cursors = new Set();
  for (let index = 0; index < MAX_PAGES; index++) {
    signal?.throwIfAborted();
    const page = await read({ limit: 100, ...(cursor ? { cursor } : {}) });
    signal?.throwIfAborted();
    if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean') throw Error('INVALID_PLATFORM_PAGE');
    for (const item of page.items) visit(item);
    if (!page.hasMore) return;
    if (typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor)) throw Error('INVALID_PLATFORM_CURSOR');
    cursor = page.nextCursor;
    cursors.add(cursor);
  }
  throw Error('PLATFORM_PAGE_LIMIT_EXCEEDED');
}
// Live scan, not a database snapshot. Keep identifiers/counters, never message bodies.
export async function calculateTopicStats(client, topicId, { signal, now = () => new Date() } = {}) {
  const humans = new Set(), agents = new Set(), messages = new Set();
  let humanMessageCount = 0, agentMessageCount = 0, unknownMessageCount = 0;
  const startedAt = now().toISOString();
  const results = await Promise.allSettled([
    scan(query => client.participants.list({ topicId, ...query }), item => {
      if (typeof item?.userId !== 'string' || !item.userId) throw Error('INVALID_PARTICIPANT');
      humans.add(item.userId);
    }, signal),
    scan(query => client.topicMessages.read({ topicId, ...query }), item => {
      if (typeof item?.id !== 'string' || !item.id) throw Error('INVALID_MESSAGE');
      if (messages.has(item.id)) return;
      messages.add(item.id);
      if (item.senderKind === 'human') humanMessageCount++;
      else if (item.senderKind === 'agent') {
        agentMessageCount++;
        if (item.senderName) agents.add(item.senderName);
      } else unknownMessageCount++;
    }, signal),
  ]);
  // Join both scans before releasing the request slot, including the failure case.
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return { topicId, humanMemberCount: humans.size, speakingAgentCount: agents.size, messageCount: messages.size,
    humanMessageCount, agentMessageCount, unknownMessageCount, startedAt, computedAt: now().toISOString(),
    agentCountAccuracy: 'deduplicated_by_sender_name', consistency: 'live_paginated_not_snapshot' };
}
