import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('keeps the app session in memory and sends it as a bearer token', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /let sessionToken = ''/);
  assert.match(source, /sessionToken = result\.sessionToken/);
  assert.match(source, /Authorization: `Bearer \$\{sessionToken\}`/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
