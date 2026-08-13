'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseInventoryXml } = require('../src/core/inventory');
const { loadElements, lookupElements } = require('../src/core/elements');
const { ColorMap } = require('../src/core/colors');
const { resolveInventory, matchBricklinkPccs, normColor } = require('../src/core/resolve');
const { decodeQuotedPrintable, mhtmlToHtml } = require('../src/scrape/mhtml');
const { inventoryJobs, bricklinkJobs, slug } = require('../src/core/download');

test('parseInventoryXml extracts item id + colour', () => {
  const xml = '<INVENTORY><ITEM><ITEMID>6901</ITEMID><ITEMTYPE>P</ITEMTYPE><COLOR>174</COLOR><QTY>4</QTY></ITEM>' +
    '<ITEM><ITEMID>973pb01</ITEMID><COLOR>11</COLOR><QTY>2</QTY></ITEM></INVENTORY>';
  const items = parseInventoryXml(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].itemId, '6901');
  assert.equal(items[0].colorId, '174');
  assert.equal(items[0].qty, 4);
  assert.equal(items[1].itemId, '973pb01');
});

test('elements index + design_id fallback', () => {
  const csv = 'element_id,part_num,color_id,design_id\n' +
    '6584690,6901,1147,6901\n' +
    '6614247,3069b,1147,3069\n';
  const tmp = path.join(os.tmpdir(), `el-${process.pid}.csv`);
  fs.writeFileSync(tmp, csv);
  const { index, designIndex, size } = loadElements(tmp);
  assert.equal(size, 2);
  // direct hit
  assert.deepEqual(lookupElements(index, '6901', '1147', designIndex), ['6584690']);
  // design_id fallback (BrickLink base 3069 -> Rebrickable 3069b)
  assert.deepEqual(lookupElements(index, '3069', '1147', designIndex), ['6614247']);
  // miss
  assert.deepEqual(lookupElements(index, '9999', '1147', designIndex), []);
  fs.unlinkSync(tmp);
});

test('ColorMap maps BrickLink -> Rebrickable', () => {
  const cm = new ColorMap([{ rbId: '1147', name: 'Blue Violet', blIds: ['174'] }]);
  assert.equal(cm.blToRb('174'), '1147');
  assert.equal(cm.blName('174'), 'Blue Violet');
  assert.equal(cm.blToRb('999'), null);
});

test('resolveInventory ties colours + elements together', () => {
  const cm = new ColorMap([{ rbId: '1147', name: 'Blue Violet', blIds: ['174'] }]);
  const index = new Map([['6901|1147', ['6584690']]]);
  const designIndex = new Map([['3069|1147', ['6614247']]]);
  const items = [
    { itemId: '6901', colorId: '174' },
    { itemId: '3069', colorId: '174' },
    { itemId: '6901', colorId: '999' }, // unknown colour
  ];
  const { resolved, unresolved } = resolveInventory(items, cm, index, designIndex);
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved[0].pccs, ['6584690']);
  assert.deepEqual(resolved[1].pccs, ['6614247']);
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0].reason, /no Rebrickable colour/);
});

test('matchBricklinkPccs picks PCCs by colour name (tolerant match)', () => {
  const cm = new ColorMap([{ rbId: '1', name: 'White', blIds: ['1'] }]);
  const rows = [
    { colorName: 'White', pcc: '6308127' },
    { colorName: 'white', pcc: '6581402' }, // case difference
    { colorName: 'Black', pcc: '9999999' },
  ];
  const r = matchBricklinkPccs(rows, '1', cm);
  assert.equal(r.colorName, 'White');
  assert.deepEqual(r.pccs, ['6308127', '6581402']);
  // unknown colour id -> nothing
  assert.deepEqual(matchBricklinkPccs(rows, '999', cm).pccs, []);
  assert.equal(normColor('Light Bluish Gray'), 'lightbluishgray');
});

test('quoted-printable decode', () => {
  assert.equal(decodeQuotedPrintable('a=3Db'), 'a=b');
  assert.equal(decodeQuotedPrintable('line=\r\nwrap'), 'linewrap');
});

test('mhtmlToHtml pulls the html part', () => {
  const mh = [
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="B"',
    '',
    '--B',
    'Content-Type: text/html',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<html><body>hi=3D</body></html>',
    '--B--',
  ].join('\r\n');
  const html = mhtmlToHtml(mh);
  assert.match(html, /<body>hi=<\/body>/);
});

test('job builders create sane folder layout', () => {
  const invJobs = inventoryJobs([{ itemId: '6901', colorName: 'Blue Violet', blColorId: '174', pccs: ['6584690'] }], '/out');
  assert.equal(invJobs.length, 1);
  assert.equal(invJobs[0].pcc, '6584690');
  assert.match(invJobs[0].outDir, /6901_Blue_Violet$/);

  const blJobs = bricklinkJobs('3001', [{ colorName: 'White', pcc: '300101' }], '/out');
  assert.match(blJobs[0].outDir, /3001\/White_300101$/);
  assert.equal(slug('Trans-Clear!!'), 'Trans-Clear');
});
