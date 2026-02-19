const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getModels: () => ipcRenderer.invoke('get-models'),
  getCurrentModel: () => ipcRenderer.invoke('get-current-model'),
  setModel: (id) => ipcRenderer.invoke('set-model', id),
  
  onUpdateScreenshots: (callback) => ipcRenderer.on('update-screenshots', (event, paths) => callback(paths)),
  onGeminiResponse: (callback) => ipcRenderer.on('gemini-response', (event, text) => callback(text)),
  onGeminiStatus: (callback) => ipcRenderer.on('gemini-status', (event, status) => callback(status)),
  
  triggerSolve: () => ipcRenderer.send('trigger-solve'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  resizeWindow: (size) => ipcRenderer.send('resize-window', size),
  onToggleModelDropdown: (callback) => ipcRenderer.on('toggle-model-dropdown', () => callback()),
  onForceExpand: (callback) => ipcRenderer.on('force-expand', () => callback()),
  onForceCollapse: (callback) => ipcRenderer.on('force-collapse', () => callback()),
  onScrollEvent: (callback) => ipcRenderer.on('scroll-event', (event, direction) => callback(direction)),
  openExternal: (url) => shell.openExternal(url)
});
