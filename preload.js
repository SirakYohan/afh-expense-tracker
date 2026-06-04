const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadDB: () => ipcRenderer.invoke('db-load'),
  saveDB: (data) => ipcRenderer.invoke('db-save', data),
  exportCSV: (csvContent, defaultName) => ipcRenderer.invoke('export-csv', csvContent, defaultName),
});
