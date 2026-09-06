const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chatterDesktop', { saveServerUrl: url => ipcRenderer.invoke('save-server-url', url) });
