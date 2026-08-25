'use strict';

/**
 * Browser-side extractor functions. These are serialised with .toString() and
 * executed inside the scraping BrowserWindow (see electron/scraper.js), so they
 * must be self-contained and may only use DOM APIs — no closures over Node
 * variables, no require().
 *
 * Each returns `null` while the page is still loading / behind a challenge, so
 * the scraper keeps polling until real data appears.
 */

/**
 * Rebrickable /colors/ — extract [{ rbId, name, blIds:[...] }].
 *
 * The page renders a single big table of colours. Each row links to
 * /colors/<id>-<slug>/ (that href is the Rebrickable colour id) and carries the
 * external ids (BrickLink, LEGO, LDraw, Peeron) either as columns or inside the
 * row. We parse defensively: derive rbId from the detail link, name from its
 * text, and pull the BrickLink id from whichever column header mentions it.
 */
function extractRebrickableColors() {
  const tables = Array.from(document.querySelectorAll('table'));
  if (!tables.length) return null;

  // Pick the largest table (the colour list).
  let table = null;
  let best = -1;
  for (const t of tables) {
    const rows = t.querySelectorAll('tbody tr, tr').length;
    if (rows > best) {
      best = rows;
      table = t;
    }
  }
  if (!table || best < 10) return null;

  // Map header labels to column indexes.
  const headerCells = Array.from(table.querySelectorAll('thead th, thead td, tr th'));
  const headers = headerCells.map((c) => (c.textContent || '').trim().toLowerCase());
  const findCol = (needle) => headers.findIndex((h) => h.includes(needle));
  const blCol = findCol('bricklink');
  const nameCol = findCol('name');

  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const out = [];
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (!cells.length) continue;

    // Rebrickable id + name from the /colors/<id>-<slug>/ link.
    let rbId = null;
    let name = null;
    const link = row.querySelector('a[href*="/colors/"]');
    if (link) {
      const m = link.getAttribute('href').match(/\/colors\/(\d+)/);
      if (m) rbId = m[1];
      name = (link.textContent || '').trim();
    }
    if (nameCol >= 0 && cells[nameCol]) {
      const t = (cells[nameCol].textContent || '').trim();
      if (t) name = t;
    }
    if (rbId == null) continue;

    // RGB hex from the swatch cell's inline background-color.
    let rgb = null;
    const swatch = row.querySelector('[style*="background-color"]');
    if (swatch) {
      const m = (swatch.getAttribute('style') || '').match(/background-color:\s*#?([0-9a-fA-F]{6})/);
      if (m) rgb = m[1].toUpperCase();
    }

    // BrickLink id(s): prefer the dedicated column, else scan the whole row for
    // a "BrickLink" label followed by number(s).
    const blIds = [];
    if (blCol >= 0 && cells[blCol]) {
      const t = (cells[blCol].textContent || '').trim();
      for (const num of t.match(/\d+/g) || []) blIds.push(num);
    } else {
      const rowText = row.textContent || '';
      const m = rowText.match(/bricklink[^0-9]*([0-9,\s]+)/i);
      if (m) for (const num of m[1].match(/\d+/g) || []) blIds.push(num);
    }

    out.push({ rbId, name: name || `color ${rbId}`, rgb, blIds });
  }

  return out.length ? out : null;
}

/**
 * Diagnostic dump of the Rebrickable colours table so we can inspect the real
 * DOM structure (headers + a couple of sample rows) before trusting the parser.
 */
function dumpRebrickableColors() {
  const tables = Array.from(document.querySelectorAll('table'));
  if (!tables.length) return null;
  let table = null;
  let best = -1;
  for (const t of tables) {
    const rows = t.querySelectorAll('tr').length;
    if (rows > best) { best = rows; table = t; }
  }
  if (!table || best < 5) return null;
  const headers = Array.from(table.querySelectorAll('thead th, thead td, tr th'))
    .map((c) => (c.textContent || '').trim());
  const sample = Array.from(table.querySelectorAll('tbody tr')).slice(0, 3).map((row) => ({
    html: row.innerHTML.slice(0, 600),
    text: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  }));
  return { tableCount: tables.length, rowCount: best, headers, sample };
}

/**
 * BrickLink catalogColors page — extract [{ colorName, pcc }].
 *
 * The "Part Color Codes" section is a table of: Color | Code (PCC) | By.
 * We collect every numeric code, tagged with its colour name.
 */
function extractBricklinkPccs() {
  // Each PCC row renders (with a leading spacer cell) as:
  //   ['', <Color Name>, <PCC>, <seq>, <contributor>]
  // We match any row that has a cell of exactly 5-8 digits (the PCC) preceded by
  // a short text cell (the colour name), ignoring the page's many layout tables.
  const rows = Array.from(document.querySelectorAll('tr'));
  const out = [];
  for (const row of rows) {
    const cells = Array.from(row.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    const texts = cells.map((c) => (c.textContent || '').trim());
    if (texts.some((t) => t.length >= 40)) continue; // skip layout/script cells
    const pccIdx = texts.findIndex((t) => /^\d{5,8}$/.test(t));
    if (pccIdx < 1) continue;
    const colorName = texts[pccIdx - 1];
    if (!colorName || /^\d+$/.test(colorName)) continue;
    out.push({ colorName, pcc: texts[pccIdx], seq: texts[pccIdx + 1] || '' });
  }

  // De-dupe by pcc, preserving colour grouping order.
  const seen = new Set();
  const deduped = [];
  for (const r of out) {
    if (seen.has(r.pcc)) continue;
    seen.add(r.pcc);
    deduped.push(r);
  }
  return deduped.length ? deduped : null;
}

module.exports = {
  extractRebrickableColors,
  dumpRebrickableColors,
  extractBricklinkPccs,
};
