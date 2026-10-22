const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function hasUpdateFeed() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
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
    const rectangle = {
      x: Math.max(0, Math.floor(Number(bounds?.x) || 0)),
      y: Math.max(0, Math.floor(Number(bounds?.y) || 0)),
      width: Math.min(10000, Math.max(1, Math.ceil(Number(bounds?.width) || 0))),
      height: Math.min(10000, Math.max(1, Math.ceil(Number(bounds?.height) || 0)))
    };
    if (!Number.isFinite(rectangle.x) || !Number.isFinite(rectangle.y) || rectangle.width < 1 || rectangle.height < 1) {
      throw new Error('The game screen has invalid capture bounds.');
    }
    const image = await event.sender.capturePage(rectangle);
    if (image.isEmpty()) throw new Error('The game screen could not be captured.');
    return image.toPNG();
  });
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
