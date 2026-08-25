'use strict';

const { PNG } = require('pngjs');

/**
 * Recolour a LEGO photoreal frame (transparent background, opaque brick) to a
 * target colour, using the donor's luminance as a shading map. Works best with
 * a neutral (white / light-gray) donor of the SAME part in a colour that has
 * photos, to approximate a colour that LEGO never photographed.
 *
 * This is a synthetic approximation — not an official render — so callers should
 * mark the output (see markGenerated).
 *
 * @param {Buffer} pngBuffer donor PNG
 * @param {[number,number,number]} target target RGB
 * @param {object} [opts]
 * @param {number} [opts.highlight=0.6] how strongly specular highlights go white
 * @returns {Buffer} recoloured PNG
 */
function recolorToColor(pngBuffer, target, opts = {}) {
  const { highlight = 0.6 } = opts;
  const png = PNG.sync.read(pngBuffer);
  const { data } = png;
  const [tr, tg, tb] = target;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue; // transparent background — leave it
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Donor luminance as a 0..1 shading map.
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Multiply the target by the shading map (white donor -> target colour).
    let nr = tr * L;
    let ng = tg * L;
    let nb = tb * L;
    // Preserve bright plastic highlights by pushing them toward white.
    if (L > 0.85) {
      const hl = ((L - 0.85) / 0.15) * highlight;
      nr = nr + (255 - nr) * hl;
      ng = ng + (255 - ng) * hl;
      nb = nb + (255 - nb) * hl;
    }
    data[i] = Math.round(nr);
    data[i + 1] = Math.round(ng);
    data[i + 2] = Math.round(nb);
    // alpha unchanged
  }
  return PNG.sync.write(png);
}

/**
 * Stamp a clearly-visible "generated" marker so synthetic images are never
 * mistaken for official photos: a solid magenta triangle in the top-left corner.
 * @param {Buffer} pngBuffer
 * @param {object} [opts]
 * @param {number} [opts.size=140] triangle leg length in px
 * @returns {Buffer}
 */
function markGenerated(pngBuffer, opts = {}) {
  const png = PNG.sync.read(pngBuffer);
  const { width, data } = png;
  const size = opts.size || 140;
  const [mr, mg, mb] = [214, 51, 132]; // magenta
  for (let y = 0; y < size; y++) {
    const rowW = size - y; // triangle
    for (let x = 0; x < rowW; x++) {
      const i = (y * width + x) * 4;
      data[i] = mr; data[i + 1] = mg; data[i + 2] = mb; data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/**
 * Sample the dominant plastic colour of a part from a product image (e.g. a
 * BrickLink photo), ignoring the background and near-black/near-white pixels and
 * any printed decoration (which is a minority of pixels). Returns [r,g,b].
 * Used to recolour a donor to the *true* photographed colour rather than a
 * swatch approximation.
 * @param {Buffer} pngBuffer
 * @returns {[number,number,number]|null}
 */
function sampleDominantColor(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const { data } = png;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue; // background / edges
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 240 && mn > 225) continue; // near-white background
    if (mx < 30) continue;              // near-black shadow
    // Quantise to 24 levels/channel and count.
    const key = `${r >> 4}|${g >> 4}|${b >> 4}`;
    let e = buckets.get(key);
    if (!e) buckets.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++; e.r += r; e.g += g; e.b += b;
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

module.exports = { recolorToColor, markGenerated, hexToRgb, sampleDominantColor };
