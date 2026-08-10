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
    const rbColorId = colorMap.blToRb(it.colorId);
    if (rbColorId == null) {
      unresolved.push({ ...it, reason: `no Rebrickable colour for BrickLink colour ${it.colorId}` });
      continue;
    }
    const pccs = lookupElements(elementIndex, it.itemId, rbColorId, designIndex);
    if (pccs.length === 0) {
      unresolved.push({
        ...it,
        rbColorId,
        reason: `no element for part ${it.itemId} in colour ${rbColorId}`,
      });
      continue;
    }
    resolved.push({
      itemId: it.itemId,
      blColorId: it.colorId,
      rbColorId,
      colorName: colorMap.blName(it.colorId),
      qty: it.qty,
      pccs,
    });
  }

  return { resolved, unresolved };
}

module.exports = { resolveInventory };
