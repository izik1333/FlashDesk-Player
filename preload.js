const { contextBridge, ipcRenderer } = require('electron');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

function encodeGameGif(frames, width, height, delay = 170) {
  if (!Array.isArray(frames) || frames.length < 2 || width < 1 || height < 1) {
    throw new Error('There are not enough game frames to make a GIF.');
  }
  const paletteBytes = new Uint8Array(Math.ceil((width * height) / 4) * frames.length * 4);
  let paletteOffset = 0;
  const rgbaFrames = frames.map((frame) => frame instanceof Uint8Array ? frame : new Uint8Array(frame));
  for (const frame of rgbaFrames) {
    if (frame.length !== width * height * 4) throw new Error('A captured game frame has an invalid size.');
    for (let offset = 0; offset < frame.length; offset += 16) {
      paletteBytes.set(frame.subarray(offset, offset + 4), paletteOffset);
      paletteOffset += 4;
    }
  }
  const palette = quantize(paletteBytes.subarray(0, paletteOffset), 128, { format: 'rgb565' });
  const gif = GIFEncoder();
  rgbaFrames.forEach((frame, index) => {
    const indexed = applyPalette(frame, palette);
    gif.writeFrame(indexed, width, height, {
      palette: index === 0 ? palette : null,
      delay,
      repeat: index === 0 ? 0 : undefined
    });
  });
  gif.finish();
  return gif.bytes();
}

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
  encodeGameGif: (frames, width, height, delay) => encodeGameGif(frames, width, height, delay),
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
