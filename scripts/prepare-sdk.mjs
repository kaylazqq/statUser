// Reproducible dependency input; no SDK source or generated archive is committed.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const version = '0.11.0';
const sha256 = 'be526521b50e48d223f68155233b271e2f337e9e2411d18f79d2a372b20b38d3';
const file = new URL(`../.sdk/colink-app-sdk-${version}.tgz`, import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let bytes;
try { bytes = await readFile(file); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (process.env.COLINK_SDK_SOURCE_ROOT) {
    // Explicit offline alternative. Accept only the exact reviewed release bytes.
    const builder = pathToFileURL(resolve(process.env.COLINK_SDK_SOURCE_ROOT, 'dev/app-toolkit/distribution/build.mjs'));
    bytes = (await (await import(builder.href)).buildSdkArchive()).bytes;
  } else {
    const response = await fetch(`https://colink.link/docs/app-extensions/downloads/sdk/javascript/${version}/colink-app-sdk-${version}.tgz`,
      { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`SDK_DOWNLOAD_FAILED_${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw Error('SDK_ARCHIVE_TOO_LARGE');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  }
  if (hash(bytes) !== sha256) throw Error('SDK_DIGEST_MISMATCH');
  await mkdir(new URL('../.sdk/', import.meta.url), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
}
if (hash(bytes) !== sha256) throw Error('SDK_DIGEST_MISMATCH');
console.log(`SDK ${version} verified (${sha256})`);
