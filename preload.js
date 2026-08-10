const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getCurrentModel: () => ipcRenderer.invoke('get-current-model'),
  setModel: (id) => ipcRenderer.invoke('set-model', id),
  fetchModels: () => ipcRenderer.invoke('fetch-models'),

  onUpdateScreenshots: (callback) => ipcRenderer.on('update-screenshots', (event, paths) => callback(paths)),
  onGeminiResponse: (callback) => ipcRenderer.on('gemini-response', (event, text) => callback(text)),
  onGeminiStatus: (callback) => ipcRenderer.on('gemini-status', (event, status) => callback(status)),

  triggerSolve: (customPrompt) => ipcRenderer.send('trigger-solve', customPrompt),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  closeCustomPrompt: () => ipcRenderer.send('close-custom-prompt'),
  resizeWindow: (size) => ipcRenderer.send('resize-window', size),
  onToggleModelDropdown: (callback) => ipcRenderer.on('toggle-model-dropdown', () => callback()),
  onToggleCustomPrompt: (callback) => ipcRenderer.on('toggle-custom-prompt', () => callback()),
  onForceExpand: (callback) => ipcRenderer.on('force-expand', () => callback()),
  onForceCollapse: (callback) => ipcRenderer.on('force-collapse', () => callback()),
  onScrollEvent: (callback) => ipcRenderer.on('scroll-event', (event, direction) => callback(direction)),
  openExternal: (url) => shell.openExternal(url)
});
