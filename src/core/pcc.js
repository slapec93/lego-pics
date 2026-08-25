'use strict';

/**
 * PCCs (LEGO element ids) are assigned from an ever-increasing global pool, so
 * the highest number is the newest element for that part+colour — and the one
 * most likely to have current photoreal images. When several PCCs exist for a
 * part+colour we keep only that latest one (avoids downloading duplicate image
 * sets of the same brick).
 *
 * @param {string[]} pccs
 * @returns {string|null}
 */
function pickLatestPcc(pccs) {
  let best = null;
  let bestN = -Infinity;
  for (const p of pccs || []) {
    const n = Number(p);
    if (Number.isFinite(n) && n > bestN) {
      bestN = n;
      best = p;
    } else if (best === null) {
      best = p; // non-numeric fallback
    }
  }
  return best;
}

/** Unique PCCs sorted newest-first (highest number first). */
function sortPccsDesc(pccs) {
  return [...new Set((pccs || []).filter(Boolean))].sort((a, b) => Number(b) - Number(a));
}

/**
 * Group BrickLink colour rows ([{colorName, pcc}]) to one entry per colour,
 * carrying ALL that colour's PCCs newest-first (so the downloader can try the
 * newest and fall back to older ones if it has no photos). `pcc` is the newest,
 * for display. BrickLink's colour order is preserved.
 * @param {Array<{colorName:string,pcc:string}>} rows
 * @returns {Array<{colorName:string,pcc:string,pccs:string[]}>}
 */
function latestPerColor(rows) {
  const byColor = new Map();
  for (const r of rows || []) {
    let g = byColor.get(r.colorName);
    if (!g) byColor.set(r.colorName, (g = { colorName: r.colorName, pccs: [] }));
    g.pccs.push(r.pcc);
  }
  return Array.from(byColor.values()).map((g) => {
    const pccs = sortPccsDesc(g.pccs);
    return { colorName: g.colorName, pcc: pccs[0], pccs };
  });
}

module.exports = { pickLatestPcc, sortPccsDesc, latestPerColor };
