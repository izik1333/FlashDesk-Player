const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function hasUpdateFeed() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

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

function sendUpdateState(state, details = {}) {
  const updateState = { state, currentVersion: app.getVersion(), ...details };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:state', updateState);
  }
}

autoUpdater.on('checking-for-update', () => sendUpdateState('checking'));
autoUpdater.on('update-available', (info) => sendUpdateState('available', { version: info.version }));
autoUpdater.on('update-not-available', () => sendUpdateState('current', { version: app.getVersion() }));
autoUpdater.on('download-progress', (progress) => sendUpdateState('downloading', { percent: progress.percent }));
autoUpdater.on('update-downloaded', (info) => sendUpdateState('downloaded', { version: info.version }));
autoUpdater.on('error', (error) => sendUpdateState('error', { message: error?.message || 'Could not check for updates.' }));

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0b0e14',
    frame: false,
    title: 'FlashDesk Player',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen-change', true));
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen-change', false));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) {
      event.preventDefault();
      win.setFullScreen(false);
    }
  });

  ipcMain.removeHandler('window:minimize');
  ipcMain.removeHandler('window:toggle-maximize');
  ipcMain.removeHandler('window:toggle-fullscreen');
  ipcMain.removeHandler('window:exit-fullscreen');
  ipcMain.removeHandler('window:close');
  ipcMain.removeHandler('updater:get-status');
  ipcMain.removeHandler('updater:check');
  ipcMain.removeHandler('updater:download');
  ipcMain.removeHandler('updater:install');
  ipcMain.removeHandler('player:capture-frame');
  ipcMain.removeHandler('player:encode-gif');
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:toggle-fullscreen', () => {
    const targetState = !win.isFullScreen();
    win.setFullScreen(targetState);
    return targetState;
  });
  ipcMain.handle('window:exit-fullscreen', () => {
    if (win.isFullScreen()) win.setFullScreen(false);
    return win.isFullScreen();
  });
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('player:capture-frame', async (event, bounds) => {
    if (!event.senderFrame?.url?.startsWith('file://')) {
      throw new Error('Game screenshots can only be captured from the FlashDesk window.');
    }
    const x = Number(bounds?.x);
    const y = Number(bounds?.y);
    const width = Number(bounds?.width);
    const height = Number(bounds?.height);
    const viewportWidth = Number(bounds?.viewportWidth);
    const viewportHeight = Number(bounds?.viewportHeight);
    if (![x, y, width, height, viewportWidth, viewportHeight].every(Number.isFinite) ||
        width < 1 || height < 1 || viewportWidth < 1 || viewportHeight < 1) {
      throw new Error('The game screen has invalid capture bounds.');
    }
    // Capture the composited page first, then crop in native-image pixels. This
    // avoids WebContents.capturePage(rect) DPI/zoom discrepancies on Windows.
    const image = await event.sender.capturePage();
    if (image.isEmpty()) throw new Error('The game screen could not be captured.');
    const imageSize = image.getSize();
    const scaleX = imageSize.width / viewportWidth;
    const scaleY = imageSize.height / viewportHeight;
    const left = Math.max(0, Math.floor(x * scaleX));
    const top = Math.max(0, Math.floor(y * scaleY));
    const right = Math.min(imageSize.width, Math.ceil((x + width) * scaleX));
    const bottom = Math.min(imageSize.height, Math.ceil((y + height) * scaleY));
    if (right <= left || bottom <= top) throw new Error('The game screen is outside the visible window.');
    const croppedImage = image.crop({ x: left, y: top, width: right - left, height: bottom - top });
    if (croppedImage.isEmpty()) throw new Error('The game screen could not be cropped.');
    return croppedImage.toPNG();
  });
  ipcMain.handle('player:encode-gif', (_event, frames, width, height, delay) =>
    encodeGameGif(frames, width, height, delay));
  ipcMain.handle('updater:get-status', () => ({
    state: app.isPackaged ? (hasUpdateFeed() ? 'idle' : 'unconfigured') : 'unavailable',
    currentVersion: app.getVersion(),
    version: app.getVersion()
  }));
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { state: 'unavailable', currentVersion: app.getVersion() };
    if (!hasUpdateFeed()) return { state: 'unconfigured', currentVersion: app.getVersion() };
    try {
      await autoUpdater.checkForUpdates();
      return { state: 'checking', currentVersion: app.getVersion() };
    } catch (error) {
      return { state: 'error', currentVersion: app.getVersion(), message: error?.message || 'Could not check for updates.' };
    }
  });
  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { state: 'downloading', currentVersion: app.getVersion() };
    } catch (error) {
      return { state: 'error', currentVersion: app.getVersion(), message: error?.message || 'Could not download the update.' };
    }
  });
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall();
    return { state: 'installing', currentVersion: app.getVersion() };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
