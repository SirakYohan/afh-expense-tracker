const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(app.getPath('userData'), 'afh_expenses.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {}
  return {};
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'AFH Expense Tracker',
    backgroundColor: '#f9f9f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('db-load', () => loadDB());
ipcMain.handle('db-save', (_e, data) => { saveDB(data); return true; });

ipcMain.handle('export-csv', async (_e, csvContent, defaultName) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export Expense Report',
    defaultPath: defaultName,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (filePath) {
    fs.writeFileSync(filePath, csvContent, 'utf8');
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});
