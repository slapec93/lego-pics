'use strict';
// Boots the real app (main.js registers all IPC handlers + creates the window),
// then reads back renderer DOM state to confirm the config:get round-trip and
// the bricklink:preview IPC path actually work end-to-end.
const { app, BrowserWindow } = require('electron');
require('../electron/main');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log('NO WINDOW'); return app.quit(); }
  await win.webContents.executeJavaScript('new Promise(r=>setTimeout(r,1200))');
  const state = await win.webContents.executeJavaScript(`({
    badge: document.getElementById('colorsBadge').textContent,
    csv: document.getElementById('csvPath').value,
    out: document.getElementById('outputDir').value,
    tabs: document.querySelectorAll('.tab').length,
    hasApi: typeof window.api === 'object'
  })`);
  console.log('RENDERER_STATE', JSON.stringify(state));

  // Exercise the bricklink preview IPC exactly as the renderer would.
  try {
    const preview = await win.webContents.executeJavaScript(`window.api.previewBricklink({ blId: '3005' })`);
    console.log('BL_PREVIEW count=', preview.rows.length, 'sample=', JSON.stringify(preview.rows.slice(0, 3)));
  } catch (e) {
    console.log('BL_PREVIEW_ERR', e.message);
  }
  app.quit();
});
