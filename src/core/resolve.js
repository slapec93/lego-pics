'use strict';

const { lookupElements } = require('./elements');

/**
 * Resolve an inventory (list of {itemId, colorId(BrickLink)}) into PCC candidates
 * using the colour map + elements index.
 *
 * @param {Array<{itemId:string,colorId:string,qty?:number}>} items
 * @param {import('./colors').ColorMap} colorMap
 * @param {Map<string,string[]>} elementIndex
 * @param {Map<string,string[]>} [designIndex] optional design_id fallback index
 * @returns {{resolved: Array, unresolved: Array}}
 *   resolved:   { itemId, blColorId, rbColorId, colorName, pccs:[...] }
 *   unresolved: { itemId, blColorId, reason }
 */
function resolveInventory(items, colorMap, elementIndex, designIndex) {
  const resolved = [];
  const unresolved = [];

  for (const it of items) {
    const rbColorIds = colorMap.blRbIds(it.colorId);
    if (rbColorIds.length === 0) {
      unresolved.push({ ...it, reason: `no Rebrickable colour for BrickLink colour ${it.colorId}` });
      continue;
    }
    // A BrickLink colour may map to several Rebrickable colour ids — try each.
    let pccs = [];
    let matchedRb = rbColorIds[0];
    for (const rb of rbColorIds) {
      const found = lookupElements(elementIndex, it.itemId, rb, designIndex);
      if (found.length) { pccs = found; matchedRb = rb; break; }
    }
    if (pccs.length === 0) {
      unresolved.push({
        ...it,
        rbColorId: rbColorIds.join('/'),
        reason: `no element for part ${it.itemId} in colour ${rbColorIds.join('/')}`,
      });
      continue;
    }
    resolved.push({
      itemId: it.itemId,
      blColorId: it.colorId,
      rbColorId: matchedRb,
      colorName: colorMap.blName(it.colorId),
      qty: it.qty,
      pccs,
    });
  }

  return { resolved, unresolved };
}

/** Normalise a colour name for tolerant matching (case/spacing/punctuation). */
function normColor(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Given BrickLink catalogColors rows ([{colorName, pcc}]) for a part, pick the
 * PCCs whose colour matches the inventory item's BrickLink colour id. Used as a
 * fallback for parts (e.g. printed `970c00pb…` ids) that aren't in elements.csv.
 *
 * @param {Array<{colorName:string,pcc:string}>} rows
 * @param {string} blColorId inventory BrickLink colour id
 * @param {import('./colors').ColorMap} colorMap
 * @returns {{pccs:string[], colorName:string|null}}
 */
function matchBricklinkPccs(rows, blColorId, colorMap) {
  const names = colorMap.blNames(blColorId);
  if (!names.length) return { pccs: [], colorName: null };
  const targets = new Set(names.map(normColor));
  const pccs = [];
  for (const row of rows || []) {
    if (targets.has(normColor(row.colorName))) pccs.push(row.pcc);
  }
  return { pccs, colorName: names[0] };
}

module.exports = { resolveInventory, matchBricklinkPccs, normColor };
