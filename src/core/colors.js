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
  const byBl = new Map();
  for (const c of colors) {
    for (const bl of c.blIds || []) {
      byBl.set(String(bl), c);
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

  /** BrickLink colour id -> Rebrickable colour id (string) or null. */
  blToRb(blColorId) {
    const c = this.byBl.get(String(blColorId));
    return c ? String(c.rbId) : null;
  }

  /** BrickLink colour id -> friendly name or null. */
  blName(blColorId) {
    const c = this.byBl.get(String(blColorId));
    return c ? c.name : null;
  }

  get size() {
    return this.colors.length;
  }
}

module.exports = { ColorMap };
