'use strict';

const fs = require('fs');

/**
 * The colour bridge.
 *
 * The inventory XML uses BrickLink colour ids (e.g. 174). elements.csv is keyed
 * by Rebrickable colour ids. Rebrickable's /colors/ page publishes the mapping
 * between them (the External IDs / BrickLink column). We scrape that once with a
 * real browser (Electron) — see electron/scraper.js — and cache the result as
 * JSON so subsequent runs are offline.
 *
 * Cache shape:
 *   { scrapedAt: ISOString,
 *     colors: [ { rbId: "31", name: "Medium Lavender", blIds: ["174"] }, ... ] }
 */

function buildBlIndex(colors) {
  // A BrickLink colour id can legitimately map to several Rebrickable colours
  // (e.g. BL 77 -> "Pearl Dark Gray" and "Pearl Titanium"), so keep them all.
  const byBl = new Map();
  for (const c of colors) {
    for (const bl of c.blIds || []) {
      const key = String(bl);
      let arr = byBl.get(key);
      if (!arr) byBl.set(key, (arr = []));
      arr.push(c);
    }
  }
  return byBl;
}

class ColorMap {
  constructor(colors = []) {
    this.colors = colors;
    this.byBl = buildBlIndex(colors);
  }

  static fromCache(cachePath) {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return new ColorMap(data.colors || []);
  }

  static save(cachePath, colors) {
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ scrapedAt: new Date().toISOString(), colors }, null, 2)
    );
  }

  /** All Rebrickable colour ids for a BrickLink colour id (may be >1). */
  blRbIds(blColorId) {
    return (this.byBl.get(String(blColorId)) || []).map((c) => String(c.rbId));
  }

  /** All Rebrickable colour names for a BrickLink colour id (may be >1). */
  blNames(blColorId) {
    return (this.byBl.get(String(blColorId)) || []).map((c) => c.name);
  }

  /** BrickLink colour id -> first Rebrickable colour id (string) or null. */
  blToRb(blColorId) {
    const ids = this.blRbIds(blColorId);
    return ids.length ? ids[0] : null;
  }

  /** BrickLink colour id -> first friendly name or null (for display). */
  blName(blColorId) {
    const names = this.blNames(blColorId);
    return names.length ? names[0] : null;
  }

  /** BrickLink colour id -> RGB hex (e.g. "A3A9FF") or null. */
  blRgb(blColorId) {
    const arr = this.byBl.get(String(blColorId)) || [];
    for (const c of arr) if (c.rgb) return c.rgb;
    return null;
  }

  /** Colour name -> RGB hex or null (used for BrickLink-scraped colour names). */
  rgbForName(name) {
    const norm = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const c of this.colors) {
      if (c.rgb && String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '') === norm) return c.rgb;
    }
    return null;
  }

  get size() {
    return this.colors.length;
  }
}

module.exports = { ColorMap };
