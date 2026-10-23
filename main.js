const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { autoUpdater } = require('electron-updater');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function hasUpdateFeed() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

function u16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function avm1Record(opcode, payload = Buffer.alloc(0)) {
  if (opcode < 0x80) return Buffer.from([opcode]);
  return Buffer.concat([Buffer.from([opcode]), u16(payload.length), payload]);
}

function avm1PushString(value) {
  return avm1Record(0x96, Buffer.concat([Buffer.from([0]), Buffer.from(`${value}\0`, 'utf8')]));
}

function avm1PushInteger(value) {
  const payload = Buffer.alloc(5);
  payload[0] = 7;
  payload.writeInt32LE(value, 1);
  return avm1Record(0x96, payload);
}

function avm1DefineFunction2(parameterNames, body) {
  const parameters = parameterNames.flatMap((name) => [Buffer.from([0]), Buffer.from(`${name}\0`, 'utf8')]);
  const header = Buffer.concat([
    Buffer.from([0]), u16(parameterNames.length), Buffer.from([0]), u16(0),
    ...parameters, u16(body.length)
  ]);
  return Buffer.concat([Buffer.from([0x8e]), u16(header.length), header, body]);
}

function avm1ExternalCallback(name, parameters, body) {
  return Buffer.concat([
    avm1DefineFunction2(parameters, body),
    avm1PushString('_root'), avm1Record(0x1c),
    avm1PushString(name), avm1PushString('addCallback'),
    avm1PushString('flash.external.ExternalInterface'), avm1Record(0x1c),
    avm1PushInteger(3), avm1Record(0x52), avm1Record(0x17)
  ]);
}

function makeSceneBridgeActions() {
  const sceneCall = Buffer.concat([
    avm1PushString('sceneName'), avm1Record(0x1c),
    avm1PushString('gotoScreen'), avm1PushString('_root'), avm1Record(0x1c),
    avm1PushInteger(1), avm1Record(0x52), avm1Record(0x17),
    avm1Record(0x96, Buffer.from([5, 1])), avm1Record(0x3e), Buffer.from([0])
  ]);
  const ready = Buffer.concat([
    avm1Record(0x96, Buffer.from([5, 1])), avm1Record(0x3e), Buffer.from([0])
  ]);
  const callbacks = Buffer.concat([
    avm1ExternalCallback('flashdeskSelectScene', ['sceneName'], sceneCall),
    avm1ExternalCallback('flashdeskSceneControlsReady', [], ready)
  ]);
  const checkInterface = Buffer.concat([
    avm1PushString('flash.external.ExternalInterface'), avm1Record(0x1c), avm1Record(0x44),
    avm1PushString('undefined'), avm1Record(0x49)
  ]);
  const jump = Buffer.concat([Buffer.from([0x9d]), u16(2), u16(callbacks.length)]);
  return Buffer.concat([checkInterface, jump, callbacks, Buffer.from([0])]);
}

function prepareGameSceneControls(inputData) {
  let source;
  try {
    source = Buffer.isBuffer(inputData)
      ? Buffer.from(inputData)
      : (inputData?.type === 'Buffer' ? Buffer.from(inputData.data) : Buffer.from(inputData));
  } catch {
    throw new Error('Could not read the loaded SWF for scene controls.');
  }
  const original = { data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), scenes: [] };
  const signature = source.toString('ascii', 0, 3);
  if (signature !== 'FWS' && signature !== 'CWS') return original;

  let movie;
  try {
    movie = signature === 'CWS'
      ? Buffer.concat([Buffer.from('FWS'), source.subarray(3, 8), zlib.inflateSync(source.subarray(8))])
      : source;
  } catch {
    return original;
  }
  const dataText = movie.toString('latin1');
  const sceneTargets = ['screen6', 'screen7', 'screen8', 'screen9', 'screen10'];
  if (!['btn_scene1', 'btn_scene2', 'btn_scene3', 'btn_scene4', 'btn_scene5', 'gotoScreen', ...sceneTargets].every((marker) => dataText.includes(marker))) {
    return original;
  }

  let offset = 8 + Math.ceil((5 + 4 * (movie[8] >> 3)) / 8) + 4;
  let frame = 0;
  let inserted = false;
  const chunks = [movie.subarray(0, offset)];
  const bridgeTagBody = makeSceneBridgeActions();
  const bridgeTagHeader = Buffer.alloc(6);
  bridgeTagHeader.writeUInt16LE((12 << 6) | 63, 0);
  bridgeTagHeader.writeUInt32LE(bridgeTagBody.length, 2);
  const bridgeTag = Buffer.concat([bridgeTagHeader, bridgeTagBody]);

  while (offset + 2 <= movie.length) {
    const start = offset;
    const tagHeader = movie.readUInt16LE(offset);
    offset += 2;
    const code = tagHeader >> 6;
    let length = tagHeader & 63;
    if (length === 63) {
      if (offset + 4 > movie.length) return original;
      length = movie.readUInt32LE(offset);
      offset += 4;
    }
    const end = offset + length;
    if (end > movie.length) return original;
    const body = movie.subarray(offset, end);
    chunks.push(movie.subarray(start, end));
    if (!inserted && code === 12 && frame >= 2 && body.includes(Buffer.from('gotoScreen', 'ascii'))) {
      chunks.push(bridgeTag);
      inserted = true;
    }
    offset = end;
    if (code === 1) frame += 1;
    if (code === 0) break;
  }
  if (!inserted) return original;

  const patched = Buffer.concat(chunks);
  patched.write('FWS', 0, 3, 'ascii');
  patched.writeUInt32LE(patched.length, 4);
  return {
    data: patched.buffer.slice(patched.byteOffset, patched.byteOffset + patched.byteLength),
    scenes: sceneTargets.map((target, index) => ({ label: `Scene ${index + 1}`, target }))
  };
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
  const palette = quantize(paletteBytes.subarray(0, paletteOffset), 256, { format: 'rgb565' });
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
  ipcMain.removeHandler('player:prepare-scenes');
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
  ipcMain.handle('player:prepare-scenes', (event, data) => {
    if (!event.senderFrame?.url?.startsWith('file://')) {
      throw new Error('Scene controls can only be prepared from the FlashDesk window.');
    }
    return prepareGameSceneControls(data);
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
