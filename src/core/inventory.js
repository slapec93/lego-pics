'use strict';

const fs = require('fs');

/**
 * Parse a BrickLink inventory XML (the flat <INVENTORY><ITEM>...</ITEM></INVENTORY>
 * format exported by BrickLink). We only care about ITEMID + COLOR, but we keep
 * a few extra fields so the UI can show something useful.
 *
 * The format is simple and well-formed enough that a tolerant regex parser is
 * more robust (and dependency-free) than pulling in a full XML library.
 *
 * @param {string} xml raw XML text
 * @returns {Array<{itemId:string,itemType:string,colorId:string,qty:number,category:string}>}
 */
function parseInventoryXml(xml) {
  const items = [];
  const itemBlocks = xml.match(/<ITEM>([\s\S]*?)<\/ITEM>/gi) || [];
  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const itemId = get('ITEMID');
    if (!itemId) continue;
    items.push({
      itemId,
      itemType: get('ITEMTYPE') || 'P',
      colorId: get('COLOR'),
      qty: parseInt(get('QTY'), 10) || 0,
      category: get('CATEGORY'),
    });
  }
  return items;
}

/** Read + parse an inventory XML file from disk. */
function parseInventoryFile(path) {
  return parseInventoryXml(fs.readFileSync(path, 'utf8'));
}

module.exports = { parseInventoryXml, parseInventoryFile };
