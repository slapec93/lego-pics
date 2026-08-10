'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const { parseInventoryFile } = require('../src/core/inventory');
const { loadElements } = require('../src/core/elements');
const { ColorMap } = require('../src/core/colors');
const { resolveInventory } = require('../src/core/resolve');
const { inventoryJobs, bricklinkJobs, runJobs } = require('../src/core/download');
const { scrapePage } = require('./scraper');
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

ipcMain.handle('inventory:resolve', async (e, { xmlPath, csvPath }) => {
  const items = parseInventoryFile(xmlPath);
  const colorMap = loadColorMap();
  sendLog(e.sender, `Loading elements.csv …`);
  const { index, designIndex } = getElements(csvPath);
  const { resolved, unresolved } = resolveInventory(items, colorMap, index, designIndex);
  const pccCount = resolved.reduce((n, r) => n + r.pccs.length, 0);
  return { itemCount: items.length, resolved, unresolved, pccCount };
});

ipcMain.handle('inventory:download', async (e, { xmlPath, csvPath, outputDir, concurrency, runId }) => {
  const items = parseInventoryFile(xmlPath);
  const colorMap = loadColorMap();
  const { index, designIndex } = getElements(csvPath);
  const { resolved } = resolveInventory(items, colorMap, index, designIndex);
  const jobs = inventoryJobs(resolved, outputDir);

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
  return { blId, rows: rows || [] };
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

ipcMain.handle('run:cancel', (_e, runId) => {
  const c = runs.get(runId);
  if (c) c.abort();
  return true;
});
