'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { recolorData, projectPrintData, extractPrintLayer, hexToRgb, sampleDominantColor } = require('./recolor');

const FRAME_URL = (pcc, n) =>
  `https://www.lego.com/cdn/product-assets/element.spin.photoreal/${pcc}/0000${n}.png`;
const BL_IMAGE_URL = (itemNo, blColorId) =>
  `https://img.bricklink.com/ItemImage/PN/${blColorId}/${encodeURIComponent(itemNo)}.png`;

const LEGO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'image/png,image/*,*/*;q=0.8',
};

async function fetchImage(url, referer, signal) {
  try {
    const res = await fetch(url, { signal, headers: { ...LEGO_HEADERS, Referer: referer } });
    if (res.status !== 200) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 500 ? buf : null;
  } catch {
    return null;
  }
}

const fetchFrame = (pcc, n, signal) => fetchImage(FRAME_URL(pcc, n), 'https://www.lego.com/', signal);

/** Strip a BrickLink print/pattern suffix to get the base mould item number. */
function baseItemNo(itemNo) {
  // e.g. 970c00pb1273 -> 970c00, 3068bpb0123 -> 3068b, 973pr0001 -> 973
  const m = String(itemNo).match(/^(.*?)(?:p[a-z]*\d.*)$/i);
  const base = m ? m[1] : String(itemNo);
  return base && base !== String(itemNo) ? base : null;
}

/**
 * Find the first donor PCC (in order) that actually has an 8-angle spin.
 * @returns {Promise<{pcc:string, firstFrame:Buffer}|null>}
 */
async function firstDonorWithPhotos(donorPccs, opts = {}) {
  const { signal, log = () => {}, maxTries = 20 } = opts;
  let tries = 0;
  for (const pcc of donorPccs || []) {
    if (signal?.aborted || tries >= maxTries) break;
    tries++;
    const f = await fetchFrame(pcc, 1, signal);
    if (f) { log(`  donor ${pcc} has a spin`); return { pcc, firstFrame: f }; }
  }
  return null;
}

/**
 * Generate a marked 8-angle set for a colour LEGO never spin-photographed.
 *
 * Strategy:
 *  - Fetch the real BrickLink image for this exact part+colour (correct print +
 *    true colour) to use as the hero angle and to sample the recolour target.
 *  - Recolour a donor's 8-angle spin (same part in another colour, or the plain
 *    base mould) to that colour for the remaining angles.
 *
 * Everything lands in <output>/<part>_<colour>_generated/ with a _generated
 * marker (the BrickLink hero keeps a _hero name and is a real photo).
 *
 * @param {object} args
 * @param {string} args.partNum          folder name + base-mould fallback
 * @param {string} args.colorName        folder name
 * @param {string} [args.blItemNo]       BrickLink item no for the hero image
 * @param {string} [args.blColorId]      BrickLink colour id for the hero image
 * @param {string} [args.targetHex]      fallback RGB if no hero image to sample
 * @param {string[]} args.donorPccs      donor element ids, best first
 * @param {string} args.outputDir
 * @param {object} [opts]
 */
async function generateColor(args, opts = {}) {
  const { partNum, colorName, blItemNo, blColorId, targetHex, donorPccs, outputDir } = args;
  const { frames = 8, signal, log = () => {} } = opts;

  // 1) Real BrickLink hero image (correct print + true colour), if we can.
  let hero = null;
  if (blItemNo && blColorId) {
    hero = await fetchImage(BL_IMAGE_URL(blItemNo, blColorId), 'https://www.bricklink.com/', signal);
    if (hero) log('  fetched BrickLink hero image');
  }

  // 2) Target colour + print layer from the hero (true colour beats the swatch).
  let target = null;
  let print = null;
  if (hero) {
    try { target = sampleDominantColor(hero); } catch { /* ignore */ }
    try {
      const p = extractPrintLayer(hero);
      if (p && p.coverage > 0.02) { print = p; log(`  print detected (${Math.round(p.coverage * 100)}% coverage) — will estimate on each angle`); }
    } catch { /* ignore */ }
  }
  if (!target && targetHex) target = hexToRgb(targetHex);
  if (!target && !hero) return { ok: false, error: 'no colour to recolour to (no hero image, no RGB)' };

  // 3) Donor 8-angle spin.
  const donor = target ? await firstDonorWithPhotos(donorPccs, { signal, log }) : null;
  if (!hero && !donor) {
    return { ok: false, error: 'no donor spin and no BrickLink image for this part+colour' };
  }

  const outDir = path.join(outputDir, `${slugify(partNum)}_${slugify(colorName)}_generated`);
  fs.mkdirSync(outDir, { recursive: true });
  const saved = [];

  // 4) Hero angle (real photo, keeps its own name).
  if (hero) {
    const heroFile = path.join(outDir, `${slugify(blItemNo)}_hero_bricklink.png`);
    fs.writeFileSync(heroFile, hero);
    saved.push(heroFile);
  }

  // 5) Recoloured donor angles.
  let donorFrames = 0;
  if (donor && target) {
    for (let n = 1; n <= frames; n++) {
      if (signal?.aborted) break;
      const src = n === 1 ? donor.firstFrame : await fetchFrame(donor.pcc, n, signal);
      if (!src) continue;
      let out;
      try {
        const png = PNG.sync.read(src);
        recolorData(png.data, target);
        if (print) projectPrintData(png.data, png.width, png.height, print);
        out = PNG.sync.write(png);
      } catch (e) { log(`  frame ${n} failed: ${e.message}`); continue; }
      const file = path.join(outDir, `${donor.pcc}_0000${n}_generated.png`);
      fs.writeFileSync(file, out);
      saved.push(file);
      donorFrames++;
    }
  }

  if (!saved.length) return { ok: false, error: 'nothing could be generated' };
  return {
    ok: true,
    saved: saved.length,
    donorFrames,
    hero: !!hero,
    donorPcc: donor ? donor.pcc : null,
    color: target,
    outDir,
  };
}

function slugify(s) {
  return String(s == null ? '' : s).trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x';
}

module.exports = { generateColor, firstDonorWithPhotos, baseItemNo, fetchFrame };
