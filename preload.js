const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('window:exit-fullscreen'),
  onFullscreenChange: (listener) => {
    const handler = (_event, isFullScreen) => listener(isFullScreen);
    ipcRenderer.on('window:fullscreen-change', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-change', handler);
  },
  getUpdateStatus: () => ipcRenderer.invoke('updater:get-status'),
  captureGameFrame: (bounds) => ipcRenderer.invoke('player:capture-frame', bounds),
  encodeGameGif: (frames, width, height, delay) => ipcRenderer.invoke('player:encode-gif', frames, width, height, delay),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('updater:state', handler);
    return () => ipcRenderer.removeListener('updater:state', handler);
  },
  close: () => ipcRenderer.invoke('window:close')
});
