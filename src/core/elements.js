'use strict';

const fs = require('fs');

/**
 * Load the Rebrickable elements.csv:  element_id,part_num,color_id,design_id
 *
 * Builds an index keyed by `${part_num}|${color_id}` (both Rebrickable-side
 * identifiers) -> array of element_ids (PCCs). There can be several element_ids
 * for the same part+color (different moulds / production runs), so we keep them
 * all and let the downloader try each until it finds images.
 *
 * @param {string} path path to elements.csv
 * @returns {{index: Map<string,string[]>, size: number}}
 */
function loadElements(path) {
  const text = fs.readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const index = new Map();
  // Secondary index keyed by design_id (the base mould number). BrickLink uses
  // base numbers (e.g. 3069) while Rebrickable's part_num is often a mould
  // variant (3069b) whose design_id is the base (3069). This lets us recover
  // those when the direct part_num lookup misses.
  const designIndex = new Map();
  let count = 0;

  // Skip header (line 0) which is: element_id,part_num,color_id,design_id
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Fields in this dataset never contain commas, so a plain split is safe.
    const firstComma = line.indexOf(',');
    const secondComma = line.indexOf(',', firstComma + 1);
    const thirdComma = line.indexOf(',', secondComma + 1);
    if (firstComma < 0 || secondComma < 0) continue;

    const elementId = line.slice(0, firstComma);
    const partNum = line.slice(firstComma + 1, secondComma);
    const colorId = thirdComma < 0
      ? line.slice(secondComma + 1)
      : line.slice(secondComma + 1, thirdComma);
    const designId = thirdComma < 0 ? '' : line.slice(thirdComma + 1).trim();

    if (!elementId || !partNum) continue;
    addTo(index, `${partNum}|${colorId}`, elementId);
    if (designId && designId !== partNum) {
      addTo(designIndex, `${designId}|${colorId}`, elementId);
    }
    count++;
  }

  return { index, designIndex, size: count };
}

function addTo(map, key, value) {
  let arr = map.get(key);
  if (!arr) map.set(key, (arr = []));
  if (!arr.includes(value)) arr.push(value);
}

/**
 * Look up candidate PCCs for a Rebrickable part_num + Rebrickable color_id.
 * Falls back to the design_id index (base mould number) when the direct part
 * lookup misses.
 * @param {Map<string,string[]>} index
 * @param {string} partNum
 * @param {string} colorId
 * @param {Map<string,string[]>} [designIndex]
 * @returns {string[]} possibly empty
 */
function lookupElements(index, partNum, colorId, designIndex) {
  const direct = index.get(`${partNum}|${colorId}`);
  if (direct && direct.length) return direct;
  if (designIndex) {
    const byDesign = designIndex.get(`${partNum}|${colorId}`);
    if (byDesign && byDesign.length) return byDesign;
  }
  return [];
}

module.exports = { loadElements, lookupElements };
