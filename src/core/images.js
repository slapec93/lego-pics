'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_URL = (pcc, n) =>
  `https://www.lego.com/cdn/product-assets/element.spin.photoreal/${pcc}/0000${n}.png`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download the (up to 8) photoreal spin images for a single PCC/element id.
 *
 * LEGO's CDN (Akamai-fronted) does not publish a rate-limit policy. Empirically
 * it tolerates modest concurrency for image GETs but will return 403/429/503 if
 * you burst hard. We therefore: keep global concurrency low (caller-controlled),
 * add a small jitter between requests, and back off exponentially on 429/503,
 * honouring Retry-After when present.
 *
 * A 404 simply means that image index does not exist for this element (many
 * elements have fewer than 8 frames) — it is not an error.
 *
 * @param {string} pcc element id / product color code
 * @param {string} outDir directory to write into
 * @param {object} [opts]
 * @param {number} [opts.frames=8] how many frame indices to try (1..frames)
 * @param {number} [opts.maxRetries=4]
 * @param {number} [opts.jitterMs=120]
 * @param {(msg:string)=>void} [opts.log]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{pcc:string, saved:string[], missing:number[]}>}
 */
async function downloadPccImages(pcc, outDir, opts = {}) {
  const { frames = 8, maxRetries = 4, jitterMs = 120, log = () => {}, signal } = opts;
  fs.mkdirSync(outDir, { recursive: true });

  const saved = [];
  const missing = [];

  for (let n = 1; n <= frames; n++) {
    if (signal?.aborted) break;
    const url = IMAGE_URL(pcc, n);
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) break;
      try {
        const res = await fetch(url, {
          signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
            Referer: 'https://www.lego.com/',
          },
        });

        if (res.status === 404) {
          missing.push(n);
          break;
        }
        if (res.status === 429 || res.status === 503) {
          if (attempt >= maxRetries) {
            log(`  ! ${pcc}/0000${n}: gave up after ${res.status}`);
            missing.push(n);
            break;
          }
          const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
          const wait = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(8000, 500 * 2 ** attempt);
          log(`  … ${pcc}/0000${n}: ${res.status}, backing off ${wait}ms`);
          await sleep(wait);
          attempt++;
          continue;
        }
        if (!res.ok) {
          log(`  ! ${pcc}/0000${n}: HTTP ${res.status}`);
          missing.push(n);
          break;
        }

        const buf = Buffer.from(await res.arrayBuffer());
        const file = path.join(outDir, `${pcc}_0000${n}.png`);
        fs.writeFileSync(file, buf);
        saved.push(file);
        break;
      } catch (err) {
        if (signal?.aborted) break;
        if (attempt >= maxRetries) {
          log(`  ! ${pcc}/0000${n}: ${err.message}`);
          missing.push(n);
          break;
        }
        await sleep(Math.min(8000, 500 * 2 ** attempt));
        attempt++;
      }
    }
    if (jitterMs) await sleep(jitterMs * (0.5 + Math.random()));
  }

  return { pcc, saved, missing };
}

/**
 * Run an async worker over a list with bounded concurrency.
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item:T, i:number)=>Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = { downloadPccImages, mapLimit, IMAGE_URL };
