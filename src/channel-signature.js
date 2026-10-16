import crypto from 'node:crypto';

export function bodySignature(secret, timestamp, deliveryId, rawBody) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const base = `v1\n${timestamp}\n${deliveryId}\n${bodyHash}`;
  return `v1=${crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex')}`;
}

export function signedHeaders(secret, rawBody, now = Date.now) {
  const timestamp = String(Math.floor(now() / 1000));
  const deliveryId = crypto.randomUUID();
  return {
    'X-CoLink-Timestamp': timestamp,
    'X-CoLink-Delivery-Id': deliveryId,
    'X-CoLink-Key-Id': 'local-1',
    'X-CoLink-Signature': bodySignature(secret, timestamp, deliveryId, rawBody),
  };
}
