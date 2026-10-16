import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { bodySignature } from '../src/channel-signature.js';

test('signs the exact raw request bytes', () => {
  const raw = '{"appId":"a"}';
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expected = `v1=${crypto.createHmac('sha256', 'secret').update(`v1\n100\ndelivery\n${hash}`).digest('hex')}`;
  assert.equal(bodySignature('secret', '100', 'delivery', raw), expected);
});
