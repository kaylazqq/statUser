const MAX_PAGES = 1000;

async function readAll(client, path, accessToken) {
  const items = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const result = await client.getPage(`${path}?${query}`, accessToken);
    if (!Array.isArray(result.items)) throw new Error('INVALID_PLATFORM_PAGE');
    items.push(...result.items);
    if (!result.hasMore) return items;
    if (typeof result.nextCursor !== 'string' || !result.nextCursor) throw new Error('INVALID_PLATFORM_CURSOR');
    cursor = result.nextCursor;
  }
  throw new Error('PLATFORM_PAGE_LIMIT_EXCEEDED');
}

export async function calculateTopicStats(client, topicId, accessToken, now = () => new Date()) {
  const [participants, messages] = await Promise.all([
    readAll(client, `/topics/${encodeURIComponent(topicId)}/participants`, accessToken),
    readAll(client, `/topics/${encodeURIComponent(topicId)}/messages`, accessToken),
  ]);

  const humans = new Set(participants.map(item => item.userId).filter(Boolean));
  const speakingAgents = new Set();
  let humanMessageCount = 0;
  let agentMessageCount = 0;
  for (const message of messages) {
    if (message.senderKind === 'human') humanMessageCount += 1;
    if (message.senderKind === 'agent') {
      agentMessageCount += 1;
      if (message.senderName) speakingAgents.add(message.senderName);
    }
  }

  return {
    topicId,
    humanMemberCount: humans.size,
    speakingAgentCount: speakingAgents.size,
    messageCount: messages.length,
    humanMessageCount,
    agentMessageCount,
    computedAt: now().toISOString(),
    agentCountAccuracy: 'deduplicated_by_sender_name',
  };
}
