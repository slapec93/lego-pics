'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const { parseInventoryFile } = require('../src/core/inventory');
const { loadElements } = require('../src/core/elements');
const { ColorMap } = require('../src/core/colors');
const { resolveInventory, matchBricklinkPccs } = require('../src/core/resolve');
const { inventoryJobs, bricklinkJobs, runJobs } = require('../src/core/download');
const { sortPccsDesc, latestPerColor } = require('../src/core/pcc');
const { donorCandidates } = require('../src/core/elements');
const { generateColor, baseItemNo } = require('../src/core/generate');
const { Scraper, scrapePage } = require('./scraper');
const { extractBricklinkPccs } = require('../src/scrape/extractors');
const config = require('./config');

const COLORS_PATH = path.join(__dirname, '..', 'assets', 'colors.json');
const BUNDLED_ELEMENTS_PATH = path.join(__dirname, '..', 'assets', 'elements.csv');

let mainWindow = null;
// elements.csv is large; cache the parsed index keyed by path+mtime.
let elementsCache = null;
// Active runs, so the UI can cancel them.
const runs = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 820,
    minHeight: 640,
    title: 'LEGO Pics',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- helpers ----------

function loadColorMap() {
  if (!fs.existsSync(COLORS_PATH)) {
    throw new Error('Colour database (assets/colors.json) is missing. Regenerate it from a saved Rebrickable colours page.');
  }
  return ColorMap.fromCache(COLORS_PATH);
}

function getElements(csvPath) {
  // Fall back to the bundled elements.csv when the user hasn't pointed at their
  // own (newer) copy.
  if (!csvPath || !fs.existsSync(csvPath)) csvPath = BUNDLED_ELEMENTS_PATH;
  if (!fs.existsSync(csvPath)) {
    throw new Error(`elements.csv not found at: ${csvPath || '(not set)'}`);
  }
  const mtime = fs.statSync(csvPath).mtimeMs;
  if (elementsCache && elementsCache.path === csvPath && elementsCache.mtime === mtime) {
    return elementsCache.data;
  }
  const data = loadElements(csvPath);
  elementsCache = { path: csvPath, mtime, data };
  return data;
}

function sendLog(sender, msg) {
  sender.send('log', msg);
}

// ---------- IPC: config + dialogs ----------

ipcMain.handle('config:get', () => {
  const cfg = config.load();
  // Default to the bundled elements.csv unless the user picked their own.
  if (!cfg.elementsCsvPath && fs.existsSync(BUNDLED_ELEMENTS_PATH)) {
    cfg.elementsCsvPath = BUNDLED_ELEMENTS_PATH;
    cfg.elementsBundled = true;
  }
  cfg.colorsAvailable = fs.existsSync(COLORS_PATH);
  return cfg;
});

ipcMain.handle('config:set', (_e, patch) => config.save(patch));

ipcMain.handle('dialog:pickXml', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Select BrickLink inventory XML',
    properties: ['openFile'],
    filters: [{ name: 'XML', extensions: ['xml'] }, { name: 'All', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickCsv', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Select elements.csv',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'All', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickOutput', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open:path', (_e, p) => {
  if (p) shell.openPath(p);
});

// ---------- IPC: inventory (mode 1) ----------

// Resolve unresolved items by scraping BrickLink's catalogColors for each part
// and matching the inventory colour by name. Runs sequentially (one shared
// scraping window) to stay gentle on BrickLink.
async function bricklinkFallback(unresolved, colorMap, sender, signal) {
  const stillUnresolved = [];
  const recovered = [];
  if (!unresolved.length) return { recovered, stillUnresolved };

  const scraper = new Scraper({ log: (m) => sendLog(sender, m) });
  try {
    let i = 0;
    for (const it of unresolved) {
      if (signal?.aborted) { stillUnresolved.push(it); continue; }
      i++;
      const url = `https://www.bricklink.com/catalogColors.asp?itemType=P&itemNo=${encodeURIComponent(it.itemId)}&v=2`;
      sendLog(sender, `BrickLink fallback ${i}/${unresolved.length}: ${it.itemId}`);
      try {
        const rows = await scraper.scrape(url, extractBricklinkPccs, { timeoutMs: 60000 });
        const { pccs, colorName } = matchBricklinkPccs(rows, it.colorId, colorMap);
        if (pccs.length) {
          recovered.push({ itemId: it.itemId, blColorId: it.colorId, rbColorId: it.rbColorId || null, colorName, colorHex: colorMap.blRgb(it.colorId), qty: it.qty, pccs: sortPccsDesc(pccs), pccCandidates: pccs.length, source: 'bricklink' });
        } else {
          stillUnresolved.push({ ...it, reason: `${it.reason}; BrickLink had no "${colorName || 'colour ' + it.colorId}" for ${it.itemId}` });
        }
      } catch (err) {
        stillUnresolved.push({ ...it, reason: `${it.reason}; BrickLink lookup failed: ${err.message}` });
      }
    }
  } finally {
    scraper.destroy();
  }
  return { recovered, stillUnresolved };
}

async function resolveWithFallback(items, csvPath, useBricklink, sender, signal) {
  const colorMap = loadColorMap();
  const { index, designIndex } = getElements(csvPath);
  let { resolved, unresolved } = resolveInventory(items, colorMap, index, designIndex);
  if (useBricklink && unresolved.length) {
    const { recovered, stillUnresolved } = await bricklinkFallback(unresolved, colorMap, sender, signal);
    resolved = resolved.concat(recovered);
    unresolved = stillUnresolved;
  }
  return { resolved, unresolved };
}

ipcMain.handle('inventory:resolve', async (e, { xmlPath, csvPath, useBricklink }) => {
  const items = parseInventoryFile(xmlPath);
  sendLog(e.sender, `Loading elements.csv …`);
  const { resolved, unresolved } = await resolveWithFallback(items, csvPath, useBricklink, e.sender);
  const pccCount = resolved.reduce((n, r) => n + r.pccs.length, 0);
  return { itemCount: items.length, resolved, unresolved, pccCount };
});

ipcMain.handle('inventory:download', async (e, { resolved, outputDir, concurrency, runId }) => {
  const jobs = inventoryJobs(resolved || [], outputDir);

  const controller = new AbortController();
  runs.set(runId, controller);
  try {
    const summary = await runJobs(jobs, {
      concurrency: Number(concurrency) || 4,
      signal: controller.signal,
      log: (m) => sendLog(e.sender, m),
      onProgress: (p) => e.sender.send('progress', p),
    });
    return { ...summary, jobCount: jobs.length, outputDir, canceled: controller.signal.aborted };
  } finally {
    runs.delete(runId);
  }
});

// ---------- IPC: bricklink (mode 2) ----------

ipcMain.handle('bricklink:preview', async (e, { blId }) => {
  const url = `https://www.bricklink.com/catalogColors.asp?itemType=P&itemNo=${encodeURIComponent(blId)}&v=2`;
  sendLog(e.sender, `Scraping ${url}`);
  const rows = await scrapePage(url, extractBricklinkPccs, {
    show: false,
    timeoutMs: 60000,
    log: (m) => sendLog(e.sender, m),
  });
  // Collapse to one row per colour (newest PCC first), tagging each with its RGB
  // (for generation) so the renderer can offer to generate missing colours.
  const colorMap = loadColorMap();
  const grouped = latestPerColor(rows || []).map((row) => ({ ...row, hex: colorMap.rgbForName(row.colorName) }));
  return { blId, rows: grouped, allRows: rows || [] };
});

ipcMain.handle('bricklink:download', async (e, { blId, rows, outputDir, concurrency, runId }) => {
  const jobs = bricklinkJobs(blId, rows, outputDir);
  const controller = new AbortController();
  runs.set(runId, controller);
  try {
    const summary = await runJobs(jobs, {
      concurrency: Number(concurrency) || 4,
      signal: controller.signal,
      log: (m) => sendLog(e.sender, m),
      onProgress: (p) => e.sender.send('progress', p),
    });
    return { ...summary, jobCount: jobs.length, outputDir, canceled: controller.signal.aborted };
  } finally {
    runs.delete(runId);
  }
});

// ---------- IPC: generate a missing colour from a donor photo ----------

// Scrape BrickLink catalogColors for a part and return its other colours' PCCs
// (newest-first), excluding the target colour name — used as donor spins.
async function bricklinkDonors(itemNo, excludeColorName, sender) {
  const url = `https://www.bricklink.com/catalogColors.asp?itemType=P&itemNo=${encodeURIComponent(itemNo)}&v=2`;
  const rows = await scrapePage(url, extractBricklinkPccs, { timeoutMs: 60000, log: (m) => sendLog(sender, m) });
  const grouped = latestPerColor(rows || []);
  const ex = String(excludeColorName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const isNeutral = (n) => /^(white|lightgray|lightbluishgray|verylightgray|tan)$/.test(String(n).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return grouped
    .filter((g) => String(g.colorName).toLowerCase().replace(/[^a-z0-9]+/g, '') !== ex)
    .sort((a, b) => (isNeutral(a.colorName) ? 0 : 1) - (isNeutral(b.colorName) ? 0 : 1))
    .flatMap((g) => g.pccs || [g.pcc]);
}

ipcMain.handle('generate:item', async (e, args) => {
  const { partNum, colorName, targetHex, excludeColorId, blColorId, donorPccs, csvPath, outputDir, runId } = args;
  if (!outputDir) return { ok: false, error: 'no output folder set' };

  const controller = new AbortController();
  if (runId) runs.set(runId, controller);
  sendLog(e.sender, `Generating ${partNum} · ${colorName}…`);
  try {
    // Donor cascade: caller-provided → same part (elements.csv) → same part
    // (BrickLink) → base mould (strip print suffix, BrickLink).
    let donors = donorPccs && donorPccs.length ? donorPccs : [];
    if (!donors.length) {
      try {
        const { partIndex } = getElements(csvPath);
        donors = donorCandidates(partIndex, partNum, excludeColorId).map((c) => c.elementId);
      } catch { /* not in elements.csv */ }
    }
    if (!donors.length) {
      sendLog(e.sender, `Looking up other colours of ${partNum} on BrickLink…`);
      donors = await bricklinkDonors(partNum, colorName, e.sender);
    }
    if (!donors.length) {
      const base = baseItemNo(partNum);
      if (base) {
        sendLog(e.sender, `No other colour of ${partNum}; using base mould ${base} as donor…`);
        donors = await bricklinkDonors(base, null, e.sender);
      }
    }

    return await generateColor(
      { partNum, colorName, blItemNo: partNum, blColorId, targetHex, donorPccs: donors, outputDir },
      { signal: controller.signal, log: (m) => sendLog(e.sender, m) }
    );
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (runId) runs.delete(runId);
  }
});

ipcMain.handle('run:cancel', (_e, runId) => {
  const c = runs.get(runId);
  if (c) c.abort();
  return true;
});
