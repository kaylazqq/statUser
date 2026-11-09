// Playground currently opens this source-dependent view without a topic source.
// Prove real login and fail-closed rendering; do not forge initialize/source.
import assert from 'node:assert/strict';
export default async ({ page, frame, control, user }) => {
  const failed = page.waitForResponse(response => response.url().includes('/api/v1/topic-stats') && response.request().method() === 'POST');
  await frame.getByRole('button', { name: '统计公共话题', exact: true }).click();
  const response = await failed;
  assert.equal(response.status(), 403);
  assert.equal((await response.json()).code, 'TOPIC_SOURCE_REQUIRED');
  await frame.locator('#status.error').waitFor();
  assert.equal(await frame.locator('#stats').isVisible(), false);
  await control('user-state', { user, status: 'signed-out' });
  await frame.getByRole('button', { name: '统计公共话题', exact: true }).click();
  await frame.locator('#status.error').waitFor();
  assert.equal(await frame.locator('#stats').isVisible(), false);
};
