'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // config + dialogs
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  pickXml: () => ipcRenderer.invoke('dialog:pickXml'),
  pickCsv: () => ipcRenderer.invoke('dialog:pickCsv'),
  pickOutput: () => ipcRenderer.invoke('dialog:pickOutput'),
  openPath: (p) => ipcRenderer.invoke('open:path', p),

  // inventory (mode 1)
  resolveInventory: (args) => ipcRenderer.invoke('inventory:resolve', args),
  downloadInventory: (args) => ipcRenderer.invoke('inventory:download', args),

  // bricklink (mode 2)
  previewBricklink: (args) => ipcRenderer.invoke('bricklink:preview', args),
  downloadBricklink: (args) => ipcRenderer.invoke('bricklink:download', args),

  // run control
  cancelRun: (runId) => ipcRenderer.invoke('run:cancel', runId),

  // streams
  onLog: (cb) => ipcRenderer.on('log', (_e, msg) => cb(msg)),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
