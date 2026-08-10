'use strict';
//   npx electron scripts/parse-saved-rb.js "~/Downloads/colors.mhtml"
// Accepts .mhtml or .html. Decodes MHTML -> HTML, loads it as a normal (non-
// sandboxed) file, runs the extractor, writes assets/colors.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { extractRebrickableColors, dumpRebrickableColors } = require('../src/scrape/extractors');
const { mhtmlToHtml } = require('../src/scrape/mhtml');

app.disableHardwareAcceleration();

let input = process.argv[2] || '~/Downloads/colors.mhtml';
if (input.startsWith('~')) input = path.join(os.homedir(), input.slice(1));
input = path.resolve(input);

function wrap(fnSource) {
  return `(function(){ try { return { ok:true, value: (${fnSource})() }; } catch (e) { return { ok:false, error: String(e && e.stack || e) }; } })()`;
}

app.whenReady().then(async () => {
  if (!fs.existsSync(input)) { console.log('MISSING', input); return app.quit(); }

  let htmlFile = input;
  if (/\.mhtml?$/i.test(input) || fs.readFileSync(input, 'binary').slice(0, 400).toLowerCase().includes('mime-version')) {
    const html = mhtmlToHtml(fs.readFileSync(input));
    htmlFile = path.join(os.tmpdir(), 'rb-colors-decoded.html');
    fs.writeFileSync(htmlFile, html);
    console.log('decoded MHTML ->', htmlFile, html.length, 'bytes');
  }

  const win = new BrowserWindow({ show: false, webPreferences: { javascript: true } });
  await win.loadFile(htmlFile);
  await new Promise((r) => setTimeout(r, 500));

  const meta = await win.webContents.executeJavaScript(
    `({ title: document.title, tables: document.querySelectorAll('table').length, trs: document.querySelectorAll('tr').length })`, true);
  console.log('META', JSON.stringify(meta));

  const dump = await win.webContents.executeJavaScript(wrap(dumpRebrickableColors.toString()), true);
  console.log('DUMP', JSON.stringify(dump, null, 2));

  const parsed = await win.webContents.executeJavaScript(wrap(extractRebrickableColors.toString()), true);
  if (!parsed.ok) { console.log('EXTRACT ERROR', parsed.error); win.destroy(); return app.quit(); }
  const colors = parsed.value || [];
  const withBl = colors.filter((c) => c.blIds && c.blIds.length);
  console.log('PARSED count=', colors.length, 'withBL=', withBl.length);
  console.log('SAMPLE', JSON.stringify(colors.slice(0, 6), null, 2));
  console.log('BL174', JSON.stringify(colors.find((c) => (c.blIds || []).includes('174'))));

  if (withBl.length) {
    const outDir = path.join(__dirname, '..', 'assets');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'colors.json');
    fs.writeFileSync(outFile, JSON.stringify({ scrapedAt: new Date().toISOString(), source: 'rebrickable.com/colors (saved page)', colors }, null, 2));
    console.log('WROTE', outFile, colors.length, 'colors');
  } else {
    console.log('NOT WRITING — no BrickLink ids parsed. See DUMP above.');
  }
  win.destroy();
  app.quit();
});
