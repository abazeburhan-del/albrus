const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inv', (channel, ...args) => {
  return ipcRenderer.invoke(channel, ...args);
});
