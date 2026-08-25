'use strict';

const fs = require('fs');
const path = require('path');
const { recolorToColor, hexToRgb } = require('./recolor');

const FRAME_URL = (pcc, n) =>
  `https://www.lego.com/cdn/product-assets/element.spin.photoreal/${pcc}/0000${n}.png`;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'image/png,image/*,*/*;q=0.8',
  Referer: 'https://www.lego.com/',
};

async function fetchFrame(pcc, n, signal) {
  try {
    const res = await fetch(FRAME_URL(pcc, n), { signal, headers: HEADERS });
    if (res.status !== 200) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Find the first donor PCC (in order) that actually has photos.
 * @param {string[]} donorPccs candidate element ids, best first
 * @returns {Promise<{pcc:string, firstFrame:Buffer}|null>}
 */
async function firstDonorWithPhotos(donorPccs, opts = {}) {
  const { signal, log = () => {}, maxTries = 15 } = opts;
  let tries = 0;
  for (const pcc of donorPccs) {
    if (signal?.aborted || tries >= maxTries) break;
    tries++;
    log(`  checking donor ${pcc}…`);
    const f = await fetchFrame(pcc, 1, signal);
    if (f) return { pcc, firstFrame: f };
  }
  return null;
}

/**
 * Generate a full set of frames for a colour LEGO never photographed, by
 * recolouring a donor part's photos to the target colour. Output filenames and
 * folder carry a "_generated" marker so they are never mistaken for real photos.
 *
 * @param {object} args
 * @param {string} args.partNum for the folder name
 * @param {string} args.colorName for the folder name
 * @param {string} args.targetHex e.g. "A3A9FF"
 * @param {string[]} args.donorPccs candidate donor element ids, best first
 * @param {string} args.outputDir
 * @param {object} [opts]
 * @returns {Promise<{ok:boolean, saved?:number, donorPcc?:string, outDir?:string, error?:string}>}
 */
async function generateColor(args, opts = {}) {
  const { partNum, colorName, targetHex, donorPccs, outputDir } = args;
  const { frames = 8, signal, log = () => {} } = opts;

  if (!targetHex) return { ok: false, error: 'no RGB known for this colour' };
  if (!donorPccs || !donorPccs.length) {
    return { ok: false, error: 'no photo of this part in any other colour to use as a donor' };
  }

  const donor = await firstDonorWithPhotos(donorPccs, { signal, log });
  if (!donor) return { ok: false, error: 'no donor colour of this part has photos either' };

  const target = hexToRgb(targetHex);
  const outDir = path.join(outputDir, `${slugify(partNum)}_${slugify(colorName)}_generated`);
  const saved = [];
  for (let n = 1; n <= frames; n++) {
    if (signal?.aborted) break;
    const src = n === 1 ? donor.firstFrame : await fetchFrame(donor.pcc, n, signal);
    if (!src) continue;
    let out;
    try {
      out = recolorToColor(src, target);
    } catch (err) {
      log(`  recolor failed for frame ${n}: ${err.message}`);
      continue;
    }
    if (!saved.length) fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${donor.pcc}_0000${n}_generated.png`);
    fs.writeFileSync(file, out);
    saved.push(file);
  }

  if (!saved.length) return { ok: false, error: 'donor had no usable frames' };
  return { ok: true, saved: saved.length, donorPcc: donor.pcc, outDir };
}

function slugify(s) {
  return String(s == null ? '' : s).trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x';
}

module.exports = { generateColor, firstDonorWithPhotos, fetchFrame };
