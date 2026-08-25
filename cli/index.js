#!/usr/bin/env node
'use strict';

/**
 * Headless CLI. Inventory mode runs fully in Node (no browser needed — the
 * colour map is baked into assets/colors.json and images come from the LEGO CDN
 * over plain fetch).
 *
 * Usage:
 *   node cli/index.js inventory --xml <file.xml> [--csv <elements.csv>] --out <dir> [--concurrency 4]
 *
 * BrickLink mode needs a real browser to scrape, so it lives in the Electron app
 * (npm start).
 */

const fs = require('fs');
const path = require('path');
const { parseInventoryFile } = require('../src/core/inventory');
const { loadElements } = require('../src/core/elements');
const { ColorMap } = require('../src/core/colors');
const { resolveInventory } = require('../src/core/resolve');
const { inventoryJobs, runJobs } = require('../src/core/download');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd !== 'inventory') {
    console.log('Usage: node cli/index.js inventory --xml <file.xml> [--csv <elements.csv>] --out <dir> [--concurrency 4]');
    console.log('(BrickLink part mode requires the GUI: npm start)');
    process.exit(cmd ? 1 : 0);
  }

  const bundledCsv = path.join(__dirname, '..', 'assets', 'elements.csv');
  const xml = args.xml;
  const csv = args.csv || bundledCsv;
  const out = args.out;
  const concurrency = Number(args.concurrency) || 4;
  const colorsPath = path.join(__dirname, '..', 'assets', 'colors.json');

  for (const [label, p] of [['--xml', xml], ['--out', out]]) {
    if (!p) { console.error(`Missing ${label}`); process.exit(1); }
  }
  if (!fs.existsSync(colorsPath)) { console.error('assets/colors.json missing'); process.exit(1); }
  if (!fs.existsSync(csv)) { console.error(`elements.csv not found: ${csv}`); process.exit(1); }

  console.log(`Parsing ${xml}`);
  const items = parseInventoryFile(xml);
  const colorMap = ColorMap.fromCache(colorsPath);
  console.log(`Loading ${csv} …`);
  const { index, designIndex } = loadElements(csv);
  const { resolved, unresolved } = resolveInventory(items, colorMap, index, designIndex);

  console.log(`\nMatched ${resolved.length}/${items.length} items:`);
  for (const r of resolved) console.log(`  ${r.itemId.padEnd(14)} ${(r.colorName || '').padEnd(18)} ${r.pccs.join(', ')}`);
  if (unresolved.length) {
    console.log(`\nUnmatched ${unresolved.length}:`);
    for (const u of unresolved) console.log(`  ${u.itemId.padEnd(14)} ${u.reason}`);
  }

  const jobs = inventoryJobs(resolved, out);
  console.log(`\nDownloading ${jobs.length} PCC(s) → ${out} (concurrency ${concurrency})`);
  const summary = await runJobs(jobs, {
    concurrency,
    onProgress: (p) => process.stdout.write(`\r  ${p.done}/${p.total}  ${p.saved} imgs  ${p.label.slice(0, 40).padEnd(40)}`),
  });
  console.log(`\n\nDone: ${summary.totalSaved} images from ${summary.partsOk}/${jobs.length} part(s).`);
  if (summary.failed.length) {
    console.log(`\n${summary.failed.length} combination(s) had no photos on the LEGO CDN:`);
    for (const f of summary.failed) console.log(`  ${f.label}  (PCC ${f.pcc})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
