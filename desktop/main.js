const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

app.setAppUserModelId('com.devcorestudio.chatter');
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readServerUrl() {
  if (process.env.CHATTER_APP_URL) return process.env.CHATTER_APP_URL;
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')).serverUrl; } catch { return null; }
}

function validServerUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)); } catch { return false; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 850, minHeight: 600,
    backgroundColor: '#1e1f22', title: 'Chatter', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const serverUrl = readServerUrl();
  if (validServerUrl(serverUrl)) win.loadURL(serverUrl);
  else win.loadFile(path.join(__dirname, 'setup.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('save-server-url', async (_event, value) => {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  if (!validServerUrl(normalized)) return { ok: false, error: 'Unesi ispravnu HTTPS Railway adresu.' };
  fs.writeFileSync(configPath(), JSON.stringify({ serverUrl: normalized }, null, 2));
  BrowserWindow.getFocusedWindow().loadURL(normalized);
  return { ok: true };
});

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
