const SETTINGS_KEY = 'flashdesk-settings-v1';
const LIBRARY_VIEW_KEY = 'flashdesk-library-view-v1';
const FAVORITES_DB_NAME = 'flashdesk-favorites-v1';
const FAVORITES_STORE_NAME = 'games';
const RECENT_STORE_NAME = 'recent';
const defaults = {
  enhance: true, brightness: 100, contrast: 100, saturation: 100, crisp: false,
  resolution: 'showAll', renderQuality: 'high', colorEnhance: true, colorBoost: 125,
  volume: 75, muted: false
};
let settings = { ...defaults };
let currentPlayer = null;
let currentBuffer = null;
let currentFileName = '';
let currentLibraryId = null;
let libraryRecords = [];
let libraryFilter = 'all';
let libraryViewMode = readLibraryViewMode();
let libraryCoverUrls = [];
let gameSceneTargets = [];
let favoritesDbPromise = null;
let recentGame = null;
let recentGamePromise = null;
let gifRecording = false;
let gifCrop = null;
let toastTimer = null;
let fullscreenControlsTimer = null;
let viewportSyncFrame = 0;
let lastAudibleVolume = defaults.volume;

const $ = (id) => document.getElementById(id);
function readLibraryViewMode() {
  try {
    const saved = localStorage.getItem(LIBRARY_VIEW_KEY);
    return ['large', 'normal', 'columns', 'list'].includes(saved) ? saved : 'normal';
  } catch {
    return 'normal';
  }
}

const elements = {
  playerTab: $('player-tab'), libraryTab: $('library-tab'), playerView: $('player-view'), libraryView: $('library-view'),
  libraryAddButton: $('library-add-game-btn'), librarySummary: $('library-summary'),
  filePicker: $('file-picker'), openButton: $('open-file-btn'), browseButton: $('browse-file-btn'),
  favoritesCount: $('favorites-count'),
  favoritesList: $('favorites-list'), favoriteCurrentButton: $('favorite-current-btn'),
  sceneSelects: Array.from(document.querySelectorAll('[data-scene-select]')),
  libraryCurrentButton: $('library-current-btn'), coverCurrentButton: $('cover-current-btn'),
  screenshotCurrentButton: $('screenshot-current-btn'), gifCoverButton: $('gif-cover-btn'),
  gifCropButton: $('gif-crop-btn'), gifSizeSelect: $('gif-size-select'), gifFrameRateSelect: $('gif-frame-rate-select'),
  fullscreenScreenshotButton: $('fullscreen-screenshot-btn'), fullscreenGifButton: $('fullscreen-gif-btn'), fullscreenGifCropButton: $('fullscreen-gif-crop-btn'), coverPicker: $('cover-picker'),
  dropZone: $('drop-zone'), dropHint: $('drop-hint'), emptyState: $('empty-state'), playerMount: $('player-mount'), stageOverlay: $('stage-overlay'),
  fileName: $('file-name'), fileDetails: $('file-details'), movieState: $('movie-state'),
  engineStatus: $('engine-status'), engineDot: $('engine-dot'), playButton: $('play-btn'),
  transportTitle: $('transport-title'), transportSubtitle: $('transport-subtitle'),
  volumeSlider: $('volume-slider'), volumeValue: $('volume-value'), muteButton: $('mute-btn'),
  fullscreenButton: $('fullscreen-btn'),
  volumeIcon: $('volume-icon'), muteToggle: $('mute-toggle'), enhanceToggle: $('enhance-toggle'),
  brightness: $('brightness-slider'), contrast: $('contrast-slider'), saturation: $('saturation-slider'),
  brightnessValue: $('brightness-value'), contrastValue: $('contrast-value'), saturationValue: $('saturation-value'),
  resolutionMode: $('resolution-mode'), renderQuality: $('render-quality'),
  colorEnhanceToggle: $('color-enhance-toggle'), colorBoost: $('color-boost-slider'), colorBoostValue: $('color-boost-value'),
  updateVersion: $('update-version'), updateStatus: $('update-status'), updateButton: $('check-updates-btn'),
  updateProgress: $('update-progress'), updateProgressFill: $('update-progress-fill'),
  crispToggle: $('crisp-toggle'), toast: $('toast')
};
let updatePhase = 'idle';

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2900);
}

function setEngineState(label, state) {
  elements.engineStatus.textContent = label;
  elements.engineDot.classList.toggle('ready', state === 'ready');
  elements.engineDot.classList.toggle('error', state === 'error');
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    settings = { ...defaults, ...saved };
  } catch {
    settings = { ...defaults };
  }
  lastAudibleVolume = settings.volume || defaults.volume;
  elements.enhanceToggle.checked = !!settings.enhance;
  elements.brightness.value = settings.brightness;
  elements.contrast.value = settings.contrast;
  elements.saturation.value = settings.saturation;
  elements.crispToggle.checked = !!settings.crisp;
  elements.resolutionMode.value = settings.resolution;
  elements.renderQuality.value = settings.renderQuality;
  elements.colorEnhanceToggle.checked = !!settings.colorEnhance;
  elements.colorBoost.value = settings.colorBoost;
  elements.volumeSlider.value = settings.muted ? 0 : settings.volume;
  elements.muteToggle.checked = !!settings.muted;
  syncAudioUI();
  applyPictureSettings();
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Storage may be unavailable. */ }
}

function updateRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const progress = ((value - min) / (max - min)) * 100;
  input.style.setProperty('--range-progress', `${progress}%`);
}

function applyPictureSettings() {
  elements.brightnessValue.textContent = `${elements.brightness.value}%`;
  elements.contrastValue.textContent = `${elements.contrast.value}%`;
  elements.saturationValue.textContent = `${elements.saturation.value}%`;
  elements.colorBoostValue.textContent = `${elements.colorBoost.value}%`;
  [elements.brightness, elements.contrast, elements.saturation, elements.colorBoost, elements.volumeSlider].forEach(updateRangeFill);
  const isEnhanced = elements.enhanceToggle.checked;
  const filterParts = [];
  if (isEnhanced) {
    filterParts.push(
      `brightness(${Number(elements.brightness.value) / 100})`,
      `contrast(${Number(elements.contrast.value) / 100})`,
      `saturate(${Number(elements.saturation.value) / 100})`
    );
  }
  if (elements.colorEnhanceToggle.checked) {
    filterParts.push(`saturate(${Number(elements.colorBoost.value) / 100})`);
  }
  const filter = filterParts.join(' ') || 'none';

  // Ruffle draws into a canvas inside its open shadow root. Styling that canvas
  // directly makes crisp scaling and color filters affect the game pixels,
  // rather than just the custom-element wrapper.
  if (currentPlayer) {
    const root = currentPlayer.shadowRoot;
    if (root) {
      let style = root.getElementById('flashdesk-game-image-settings');
      if (!style) {
        style = document.createElement('style');
        style.id = 'flashdesk-game-image-settings';
        root.append(style);
      }
      style.textContent = `#container canvas { image-rendering: ${elements.crispToggle.checked ? 'pixelated' : 'auto'} !important; filter: ${filter} !important; }`;
    }
  }
  document.querySelectorAll('.preset-chip').forEach((button) => button.classList.remove('active'));
  const preset = getActivePreset();
  if (preset) document.querySelector(`[data-preset="${preset}"]`)?.classList.add('active');
  settings.enhance = isEnhanced;
  settings.brightness = Number(elements.brightness.value);
  settings.contrast = Number(elements.contrast.value);
  settings.saturation = Number(elements.saturation.value);
  settings.crisp = elements.crispToggle.checked;
  settings.colorEnhance = elements.colorEnhanceToggle.checked;
  settings.colorBoost = Number(elements.colorBoost.value);
  saveSettings();
}

function getActivePreset() {
  const b = Number(elements.brightness.value);
  const c = Number(elements.contrast.value);
  const s = Number(elements.saturation.value);
  const colorBoost = Number(elements.colorBoost.value);
  const colorsOn = elements.colorEnhanceToggle.checked;
  if (b === 100 && c === 100 && s === 100 && !colorsOn) return 'original';
  if (b === 104 && c === 112 && s === 145 && colorsOn && colorBoost === 135) return 'vivid';
  if (b === 94 && c === 112 && s === 82 && colorsOn && colorBoost === 95) return 'cinema';
  return null;
}

function setPreset(name) {
  const presets = {
    original: { brightness: 100, contrast: 100, saturation: 100, colorEnhance: false, colorBoost: 100 },
    vivid: { brightness: 104, contrast: 112, saturation: 145, colorEnhance: true, colorBoost: 135 },
    cinema: { brightness: 94, contrast: 112, saturation: 82, colorEnhance: true, colorBoost: 95 }
  };
  const preset = presets[name];
  if (!preset) return;
  elements.enhanceToggle.checked = true;
  elements.brightness.value = preset.brightness;
  elements.contrast.value = preset.contrast;
  elements.saturation.value = preset.saturation;
  elements.colorEnhanceToggle.checked = preset.colorEnhance;
  elements.colorBoost.value = preset.colorBoost;
  applyPictureSettings();
}

function syncAudioUI() {
  const muted = !!settings.muted;
  const amount = muted ? 0 : Number(settings.volume);
  elements.volumeSlider.value = amount;
  elements.volumeValue.textContent = `${amount}%`;
  elements.muteToggle.checked = muted;
  elements.muteButton.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  elements.muteButton.title = muted ? 'Unmute audio' : 'Mute audio';
  elements.volumeIcon.innerHTML = muted || amount === 0
    ? '<path d="M3.5 8v4h3l4 3V5l-4 3z"/><path d="m13 8 4 4m0-4-4 4"/>'
    : '<path d="M3.5 8v4h3l4 3V5l-4 3z"/><path d="M13 7.5a4 4 0 0 1 0 5m2-7a7 7 0 0 1 0 9"/>';
  if (currentPlayer) currentPlayer.ruffle().volume = amount / 100;
  updateRangeFill(elements.volumeSlider);
}

function setMuted(muted) {
  if (muted && !settings.muted && Number(elements.volumeSlider.value) > 0) {
    lastAudibleVolume = Number(elements.volumeSlider.value);
  }
  settings.muted = !!muted;
  if (!muted && Number(elements.volumeSlider.value) === 0) {
    settings.volume = lastAudibleVolume || defaults.volume;
  }
  syncAudioUI();
  saveSettings();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function openFavoritesDb() {
  if (!window.indexedDB) return Promise.reject(new Error('Favorites storage is unavailable.'));
  if (!favoritesDbPromise) {
    favoritesDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(FAVORITES_DB_NAME, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(FAVORITES_STORE_NAME)) {
          request.result.createObjectStore(FAVORITES_STORE_NAME, { keyPath: 'id' });
        }
        if (!request.result.objectStoreNames.contains(RECENT_STORE_NAME)) {
          request.result.createObjectStore(RECENT_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open favorites storage.'));
    });
  }
  return favoritesDbPromise;
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not save favorites.'));
    transaction.onabort = () => reject(transaction.error || new Error('Favorites change was cancelled.'));
  });
}

async function readLibraryRecords() {
  const db = await openFavoritesDb();
  const transaction = db.transaction(FAVORITES_STORE_NAME, 'readonly');
  const request = transaction.objectStore(FAVORITES_STORE_NAME).getAll();
  const records = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Could not load the library.'));
  });
  return records.map((record) => ({ ...record, favorite: record.favorite ?? true })).sort((a, b) => b.addedAt - a.addedAt);
}

async function writeFavoriteRecord(record) {
  const db = await openFavoritesDb();
  const transaction = db.transaction(FAVORITES_STORE_NAME, 'readwrite');
  transaction.objectStore(FAVORITES_STORE_NAME).put(record);
  await waitForTransaction(transaction);
}

async function deleteFavoriteRecord(id) {
  const db = await openFavoritesDb();
  const transaction = db.transaction(FAVORITES_STORE_NAME, 'readwrite');
  transaction.objectStore(FAVORITES_STORE_NAME).delete(id);
  await waitForTransaction(transaction);
}

async function readRecentGameRecord() {
  const db = await openFavoritesDb();
  const transaction = db.transaction(RECENT_STORE_NAME, 'readonly');
  const request = transaction.objectStore(RECENT_STORE_NAME).get('latest');
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not load the recent game.'));
  });
}

async function writeRecentGameRecord(record) {
  const db = await openFavoritesDb();
  const transaction = db.transaction(RECENT_STORE_NAME, 'readwrite');
  transaction.objectStore(RECENT_STORE_NAME).put(record);
  await waitForTransaction(transaction);
}

function syncRecentPlayButton() {
  if (currentPlayer) return;
  if (recentGame) {
    elements.transportSubtitle.textContent = `Recent: ${recentGame.name}`;
    elements.playButton.setAttribute('aria-label', `Play recent game ${recentGame.name}`);
    elements.playButton.title = `Play recent game: ${recentGame.name}`;
  } else {
    elements.transportSubtitle.textContent = 'Open a SWF movie';
    elements.playButton.setAttribute('aria-label', 'Play');
    elements.playButton.title = 'Play';
  }
}

function refreshRecentGame() {
  if (!recentGamePromise) {
    recentGamePromise = readRecentGameRecord()
      .then((record) => {
        recentGame = record;
        syncRecentPlayButton();
        return record;
      })
      .catch(() => {
        recentGame = null;
        syncRecentPlayButton();
        return null;
      });
  }
  return recentGamePromise;
}

async function rememberRecentGame() {
  const record = {
    id: 'latest',
    name: currentFileName,
    size: currentBuffer.byteLength,
    data: new Blob([currentBuffer], { type: 'application/x-shockwave-flash' }),
    lastOpenedAt: Date.now()
  };
  await writeRecentGameRecord(record);
  recentGame = record;
  recentGamePromise = Promise.resolve(record);
}

function getCurrentLibraryRecord() {
  return libraryRecords.find((record) => record.id === currentLibraryId) || null;
}

function syncLibraryButtons() {
  const hasGame = !!currentBuffer;
  const record = getCurrentLibraryRecord();
  const isFavorite = !!record?.favorite;
  elements.libraryCurrentButton.disabled = !hasGame || !!record;
  elements.libraryCurrentButton.classList.toggle('is-saved', !!record);
  elements.libraryCurrentButton.setAttribute('aria-label', record ? 'Current game is in the library' : 'Add current game to library');
  elements.libraryCurrentButton.title = record ? 'Saved in library' : 'Add to library';
  elements.coverCurrentButton.disabled = !hasGame;
  elements.screenshotCurrentButton.disabled = !hasGame;
  elements.gifCoverButton.disabled = !hasGame || gifRecording;
  elements.fullscreenScreenshotButton.disabled = !hasGame;
  elements.fullscreenGifButton.disabled = !hasGame || gifRecording;
  elements.favoriteCurrentButton.disabled = !hasGame;
  elements.favoriteCurrentButton.classList.toggle('is-favorite', isFavorite);
  elements.favoriteCurrentButton.setAttribute('aria-label', isFavorite ? 'Remove current game from favorites' : 'Add current game to favorites');
  elements.favoriteCurrentButton.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
}

function setGameSceneTargets(targets) {
  const supported = Array.isArray(targets) ? targets.filter((scene) =>
    /^screen(?:6|7|8|9|10)$/.test(scene?.target) && typeof scene.label === 'string') : [];
  gameSceneTargets = supported;
  elements.sceneSelects.forEach((select) => {
    select.hidden = supported.length === 0;
    select.value = '';
  });
}

function selectGameScene(event) {
  const target = event.currentTarget.value;
  event.currentTarget.value = '';
  const scene = gameSceneTargets.find((item) => item.target === target);
  if (!scene || !currentPlayer) return;
  try {
    const opened = currentPlayer.ruffle().callExternalInterface('flashdeskSelectScene', scene.target);
    if (opened === true) showToast(`${scene.label} opened.`);
    else showToast('This game could not switch scenes right now.');
  } catch {
    showToast('This game could not switch scenes right now.');
  }
}

function renderLibrary() {
  elements.favoritesList.dataset.view = libraryViewMode;
  syncLibraryViewButtons();
  libraryCoverUrls.forEach((url) => URL.revokeObjectURL(url));
  libraryCoverUrls = [];
  elements.favoritesCount.textContent = String(libraryRecords.length);
  const favoriteCount = libraryRecords.filter((record) => record.favorite).length;
  elements.librarySummary.textContent = `${libraryRecords.length} ${libraryRecords.length === 1 ? 'game' : 'games'} · ${favoriteCount} ${favoriteCount === 1 ? 'favorite' : 'favorites'}`;
  elements.favoritesList.replaceChildren();
  const visibleRecords = libraryFilter === 'favorites' ? libraryRecords.filter((record) => record.favorite) : libraryRecords;
  if (!visibleRecords.length) {
    const empty = document.createElement('div');
    empty.className = 'favorites-empty';
    empty.textContent = libraryFilter === 'favorites'
      ? 'No favorite games yet. Use the star on a game card to add it here.'
      : 'Your library is empty. Add a SWF, then save it with the + button in Player.';
    elements.favoritesList.append(empty);
    return;
  }

  for (const record of visibleRecords) {
    const card = document.createElement('article');
    card.className = 'favorite-row';
    const cover = document.createElement('div');
    cover.className = 'favorite-cover';
    if (record.cover instanceof Blob) {
      const image = document.createElement('img');
      const url = URL.createObjectURL(record.cover);
      libraryCoverUrls.push(url);
      image.src = url;
      image.alt = '';
      cover.append(image);
    } else {
      cover.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h14v12H3zM5 13l3-3 2 2 2-3 3 4"/></svg>';
    }
    const open = document.createElement('button');
    open.className = 'favorite-open';
    open.type = 'button';
    open.dataset.action = 'open';
    open.dataset.libraryId = record.id;
    const name = document.createElement('span');
    name.className = 'favorite-name';
    name.textContent = record.name;
    const details = document.createElement('span');
    details.className = 'favorite-details';
    details.textContent = `${formatBytes(record.size)}${record.cover ? ' · Cover set' : ''}`;
    open.append(name, details);
    const favorite = document.createElement('button');
    favorite.className = `icon-btn library-favorite${record.favorite ? ' is-favorite' : ''}`;
    favorite.type = 'button';
    favorite.dataset.action = 'favorite';
    favorite.dataset.libraryId = record.id;
    favorite.setAttribute('aria-label', `${record.favorite ? 'Remove' : 'Add'} ${record.name} ${record.favorite ? 'from' : 'to'} favorites`);
    favorite.title = record.favorite ? 'Remove from favorites' : 'Add to favorites';
    favorite.innerHTML = '<svg viewBox="0 0 20 20"><path d="m10 2.5 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8z"/></svg>';
    const remove = document.createElement('button');
    remove.className = 'icon-btn favorite-remove';
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.dataset.libraryId = record.id;
    remove.setAttribute('aria-label', `Remove ${record.name} from library`);
    remove.title = 'Remove from library';
    remove.textContent = '×';
    const actions = document.createElement('div');
    actions.className = 'library-card-actions';
    actions.append(favorite, remove);
    card.append(cover, actions, open);
    elements.favoritesList.append(card);
  }
}

function setActiveAppTab(view) {
  const isLibrary = view === 'library';
  elements.playerView.hidden = isLibrary;
  elements.libraryView.hidden = !isLibrary;
  elements.playerTab.classList.toggle('active', !isLibrary);
  elements.libraryTab.classList.toggle('active', isLibrary);
  elements.playerTab.setAttribute('aria-selected', String(!isLibrary));
  elements.libraryTab.setAttribute('aria-selected', String(isLibrary));
  if (isLibrary) renderLibrary();
}

function syncLibraryFilterButtons() {
  document.querySelectorAll('.library-filter').forEach((button) => {
    const active = button.dataset.filter === libraryFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function syncLibraryViewButtons() {
  document.querySelectorAll('.library-layout-button').forEach((button) => {
    const active = button.dataset.libraryView === libraryViewMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function refreshLibrary() {
  try {
    libraryRecords = await readLibraryRecords();
    renderLibrary();
  } catch {
    elements.favoritesList.innerHTML = '<div class="favorites-empty">The library could not be loaded on this device.</div>';
  }
}

function createCurrentLibraryRecord(favorite = false) {
  return {
    id: crypto.randomUUID(),
    name: currentFileName,
    size: currentBuffer.byteLength,
    data: new Blob([currentBuffer], { type: 'application/x-shockwave-flash' }),
    cover: null,
    favorite,
    addedAt: Date.now()
  };
}

async function addCurrentGameToLibrary(favorite = false) {
  if (!currentBuffer || !currentFileName) return null;
  try {
    const record = createCurrentLibraryRecord(favorite);
    await writeFavoriteRecord(record);
    libraryRecords = [record, ...libraryRecords];
    currentLibraryId = record.id;
    syncLibraryButtons();
    renderLibrary();
    showToast(favorite ? 'Added to the library and favorites.' : 'Saved to your library on this device.');
    return record;
  } catch (error) {
    showToast(error?.name === 'QuotaExceededError' ? 'Not enough device storage to save this game.' : (error?.message || 'Could not save this game.'));
    return null;
  }
}

async function toggleCurrentFavorite() {
  if (!currentBuffer || !currentFileName) return;
  let record = getCurrentLibraryRecord();
  if (!record) {
    await addCurrentGameToLibrary(true);
    return;
  }
  record = { ...record, favorite: !record.favorite };
  try {
    await writeFavoriteRecord(record);
    libraryRecords = libraryRecords.map((item) => item.id === record.id ? record : item);
    syncLibraryButtons();
    renderLibrary();
    showToast(record.favorite ? 'Added to favorites.' : 'Removed from favorites.');
  } catch (error) {
    showToast(error?.message || 'Could not update this favorite.');
  }
}

async function createCoverThumbnail(file) {
  // Keep animated GIF data intact so the library can show the full animation.
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name || '')) {
    return new Blob([file], { type: 'image/gif' });
  }
  const bitmap = await createImageBitmap(file);
  const edge = 512;
  const scale = Math.max(edge / bitmap.width, edge / bitmap.height);
  const sourceWidth = edge / scale;
  const sourceHeight = edge / scale;
  const sourceX = (bitmap.width - sourceWidth) / 2;
  const sourceY = (bitmap.height - sourceHeight) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Could not prepare that cover image.');
  }
  try {
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, edge, edge);
  } finally {
    bitmap.close();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare that cover image.')), 'image/webp', 0.88);
  });
}

async function storeCurrentCover(cover, message = 'Game cover saved.') {
  let record = getCurrentLibraryRecord();
  if (!record) record = await addCurrentGameToLibrary(false);
  if (!record) return;
  record = { ...record, cover };
  await writeFavoriteRecord(record);
  libraryRecords = libraryRecords.map((item) => item.id === record.id ? record : item);
  syncLibraryButtons();
  renderLibrary();
  showToast(message);
}

async function chooseCoverImage(file) {
  if (!file || !currentBuffer || !currentFileName) return;
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name || '')) {
    showToast('Choose an image file for the cover.');
    return;
  }
  try {
    await storeCurrentCover(await createCoverThumbnail(file));
  } catch (error) {
    showToast(error?.message || 'Could not save that cover image.');
  }
}

function getGameSurfaceBounds() {
  if (!currentPlayer) throw new Error('Open a game before capturing its screen.');
  const candidates = [
    currentPlayer.shadowRoot?.querySelector('#container canvas'),
    currentPlayer.shadowRoot?.querySelector('canvas'),
    currentPlayer
  ];
  for (const surface of candidates) {
    if (!surface) continue;
    const bounds = surface.getBoundingClientRect();
    if (bounds.width >= 1 && bounds.height >= 1) return bounds;
  }
  throw new Error('The game screen is not visible yet.');
}

async function captureGameFrameBlob() {
  if (!window.appWindow?.captureGameFrame) {
    throw new Error('Game capture is unavailable. Restart FlashDesk and try again.');
  }
  const bounds = getGameSurfaceBounds();
  const pngBytes = await window.appWindow.captureGameFrame({
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  });
  const blob = new Blob([pngBytes], { type: 'image/png' });
  if (blob.size < 100) throw new Error('The game screen returned an empty screenshot.');
  return blob;
}

async function captureGameCover() {
  try {
    const cover = await createCoverThumbnail(await captureGameFrameBlob());
    await storeCurrentCover(cover);
  } catch (error) {
    showToast(error?.message || 'Could not capture the game screen.');
  }
}

function selectGifCropArea() {
  if (!currentPlayer) { showToast('Open a game before selecting a GIF area.'); return; }
  let surface;
  try { surface = getGameSurfaceBounds(); } catch (error) { showToast(error.message); return; }
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '99999', cursor: 'crosshair', touchAction: 'none', background: 'rgba(8,10,16,.12)' });
  const rect = document.createElement('div');
  Object.assign(rect.style, { position: 'fixed', border: '2px solid #b4a2ff', background: 'rgba(143,119,255,.18)', boxShadow: '0 0 0 9999px rgba(0,0,0,.35)', display: 'none', pointerEvents: 'none' });
  overlay.append(rect); document.body.append(overlay);
  let start = null;
  const cancel = () => { overlay.remove(); document.removeEventListener('keydown', onKeyDown); showToast('GIF area selection canceled.'); };
  const onKeyDown = (event) => { if (event.key === 'Escape') cancel(); };
  const finish = (event) => {
    if (!start) return;
    document.removeEventListener('keydown', onKeyDown);
    const x1 = Math.max(surface.left, Math.min(start.x, event.clientX));
    const y1 = Math.max(surface.top, Math.min(start.y, event.clientY));
    const x2 = Math.min(surface.right, Math.max(start.x, event.clientX));
    const y2 = Math.min(surface.bottom, Math.max(start.y, event.clientY));
    overlay.remove();
    if (x2 - x1 < 12 || y2 - y1 < 12) { showToast('GIF area selection canceled.'); return; }
    gifCrop = { x: (x1 - surface.left) / surface.width, y: (y1 - surface.top) / surface.height, width: (x2 - x1) / surface.width, height: (y2 - y1) / surface.height };
    showToast('Selected game area saved. GIF will record exactly inside that box.');
  };
  overlay.addEventListener('pointerdown', (event) => {
    if (event.clientX < surface.left || event.clientX > surface.right || event.clientY < surface.top || event.clientY > surface.bottom) {
      showToast('Start the selection inside the game screen, then drag to the desired edge.');
      return;
    }
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    rect.style.display = 'block';
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove', (event) => {
    if (!start) return;
    const x = Math.max(surface.left, Math.min(surface.right, event.clientX));
    const y = Math.max(surface.top, Math.min(surface.bottom, event.clientY));
    Object.assign(rect.style, { left: `${Math.min(start.x,x)}px`, top: `${Math.min(start.y,y)}px`, width: `${Math.abs(x-start.x)}px`, height: `${Math.abs(y-start.y)}px` });
  });
  overlay.addEventListener('pointerup', finish);
  overlay.addEventListener('pointercancel', cancel, { once: true });
  document.addEventListener('keydown', onKeyDown);
  showToast('Drag a box directly over the game. Press Esc to cancel.');
}

async function captureGameGifCover() {
  if (!currentPlayer || !window.appWindow?.startGameGif) {
    showToast('Game GIF capture is unavailable. Restart FlashDesk and try again.');
    return;
  }
  const edge = Number(elements.gifSizeSelect.value) || 256;
  const frameRate = Number(elements.gifFrameRateSelect.value) || 24;
  const durationMs = 4000;
  const frameCount = Math.ceil(durationMs / 1000 * frameRate);
  const frameInterval = 1000 / frameRate;
  const canvas = document.createElement('canvas');
  let encoderStarted = false;
  gifRecording = true;
  elements.gifCoverButton.disabled = true;
  elements.gifCoverButton.textContent = 'REC';
  elements.gifCoverButton.setAttribute('aria-label', 'Recording a four-second game GIF');
  elements.gifCoverButton.title = 'Recording game GIF…';
  elements.fullscreenGifButton.textContent = 'REC';
  elements.fullscreenGifButton.setAttribute('aria-label', 'Recording a four-second game GIF');
  elements.fullscreenGifButton.title = 'Recording game GIF…';
  showToast('Recording a 4-second animated cover… keep the game on screen.');
  const startedAt = performance.now();
  try {
    for (let index = 0; index < frameCount; index += 1) {
      const waitMs = startedAt + index * frameInterval - performance.now();
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const bitmap = await createImageBitmap(await captureGameFrameBlob());
      const custom = gifCrop;
      const sourceX = custom ? custom.x * bitmap.width : 0;
      const sourceY = custom ? custom.y * bitmap.height : 0;
      const sourceWidth = custom ? custom.width * bitmap.width : bitmap.width;
      const sourceHeight = custom ? custom.height * bitmap.height : bitmap.height;
      const scale = edge / Math.max(sourceWidth, sourceHeight);
      const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
      const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not prepare a GIF cover.');
      context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
      if (index === 0) {
        await window.appWindow.startGameGif(outputWidth, outputHeight, Math.round(frameInterval));
        encoderStarted = true;
      }
      await window.appWindow.appendGameGifFrame(context.getImageData(0, 0, outputWidth, outputHeight).data);
      bitmap.close();
    }
    const gifBytes = await window.appWindow.finishGameGif();
    encoderStarted = false;
    const saveResult = await window.appWindow.saveGameGif(gifBytes, `${currentFileName.replace(/\.swf$/i, '')}-cover.gif`);
    await storeCurrentCover(new Blob([gifBytes], { type: 'image/gif' }), saveResult?.filePath
      ? `GIF saved to ${saveResult.filePath} and added as the library cover.`
      : 'GIF added as the library cover; file export canceled.');
  } catch (error) {
    if (encoderStarted) await window.appWindow.cancelGameGif().catch(() => {});
    showToast(error?.message || 'Could not record an animated game cover.');
  } finally {
    gifRecording = false;
    elements.gifCoverButton.textContent = 'GIF';
    elements.gifCoverButton.setAttribute('aria-label', 'Record a four-second game GIF as its cover');
    elements.gifCoverButton.title = 'Record 4-second game GIF as cover';
    elements.fullscreenGifButton.textContent = 'GIF';
    elements.fullscreenGifButton.setAttribute('aria-label', 'Record a four-second game GIF as its cover');
    elements.fullscreenGifButton.title = 'Record 4-second game GIF as cover';
    syncLibraryButtons();
  }
}

async function openLibraryGame(id) {
  const record = libraryRecords.find((item) => item.id === id);
  if (!record) return;
  try {
    currentBuffer = await record.data.arrayBuffer();
    currentFileName = record.name;
    currentLibraryId = record.id;
    setActiveAppTab('player');
    await runCurrentGame();
  } catch (error) {
    showToast(error?.message || 'Could not open this game.');
  }
}

async function openRecentGame() {
  const record = await refreshRecentGame();
  if (!record?.data) {
    elements.filePicker.click();
    return;
  }
  try {
    currentBuffer = await record.data.arrayBuffer();
    currentFileName = record.name;
    currentLibraryId = null;
    await runCurrentGame();
  } catch (error) {
    showToast(error?.message || 'Could not open your recent game.');
  }
}

function createPlayer() {
  if (currentPlayer) return currentPlayer;
  if (!window.RufflePlayer?.newest) throw new Error('Ruffle did not load. Connect to the internet, then restart the app.');
  window.RufflePlayer.config = {
    autoplay: 'on',
    unmuteOverlay: 'hidden',
    showSwfDownload: false,
    logLevel: 'error',
    contextMenu: false,
    scale: settings.resolution,
    forceScale: true,
    salign: '',
    forceAlign: true,
    letterbox: 'fullscreen',
    quality: settings.renderQuality
  };
  const player = window.RufflePlayer.newest().createPlayer();
  player.setAttribute('aria-label', 'SWF movie player');
  player.style.width = '100%';
  player.style.height = '100%';
  player.style.display = 'block';
  elements.playerMount.replaceChildren(player);
  elements.playerMount.classList.add('active');
  currentPlayer = player;
  applyPictureSettings();
  syncPlayerViewport();
  syncAudioUI();
  return player;
}

function getCurrentLoadOptions(data = currentBuffer) {
  return {
    data,
    swfFileName: currentFileName,
    autoplay: 'on',
    unmuteOverlay: 'hidden',
    scale: settings.resolution,
    forceScale: true,
    salign: '',
    forceAlign: true,
    letterbox: 'fullscreen',
    quality: settings.renderQuality
  };
}

function syncPlayerViewport() {
  if (!currentPlayer) return;
  const bounds = elements.playerMount.getBoundingClientRect();
  if (bounds.width < 1 || bounds.height < 1) return;
  // Match Ruffle's host bounds to the real game viewport in CSS pixels. This
  // avoids stale stage dimensions after fullscreen and display-DPI changes.
  currentPlayer.style.width = `${bounds.width}px`;
  currentPlayer.style.height = `${bounds.height}px`;
}

function schedulePlayerViewportSync() {
  cancelAnimationFrame(viewportSyncFrame);
  viewportSyncFrame = requestAnimationFrame(() => {
    viewportSyncFrame = requestAnimationFrame(() => {
      syncPlayerViewport();
      window.dispatchEvent(new Event('resize'));
    });
  });
}

async function runCurrentGame({ clearOnFailure = true } = {}) {
  if (!currentBuffer || !currentFileName) return;
  setGameSceneTargets([]);
  elements.stageOverlay.hidden = false;
  elements.stageOverlay.textContent = 'Applying game settings…';
  setEngineState('Loading game…', 'loading');
  try {
    const player = currentPlayer || createPlayer();
    const preparedGame = window.appWindow?.prepareSceneControls
      ? await window.appWindow.prepareSceneControls(currentBuffer)
      : { data: currentBuffer, scenes: [] };
    await player.ruffle().load(getCurrentLoadOptions(preparedGame?.data || currentBuffer));
      if (preparedGame?.scenes?.length) setGameSceneTargets(preparedGame.scenes);
    elements.emptyState.classList.add('hidden');
    elements.fileName.textContent = currentFileName;
    elements.fileDetails.textContent = `${formatBytes(currentBuffer.byteLength)}  ·  SWF game or animation`;
    elements.movieState.innerHTML = '<span class="tiny-dot"></span> LOADED';
    elements.transportTitle.textContent = currentFileName;
    elements.transportSubtitle.textContent = 'Movie loaded';
    elements.playButton.classList.add('is-playing');
    elements.playButton.setAttribute('aria-label', 'Pause');
    elements.playButton.title = 'Pause';
    elements.playButton.innerHTML = '<svg viewBox="0 0 20 20"><path d="M6.5 5v10M13.5 5v10"/></svg>';
    elements.stageOverlay.hidden = true;
    setEngineState('Ruffle ready', 'ready');
    applyPictureSettings();
    syncPlayerViewport();
    syncAudioUI();
    syncLibraryButtons();
    try {
      await rememberRecentGame();
    } catch {
      showToast('Game loaded, but could not save it as your recent game.');
    }
  } catch (error) {
    elements.stageOverlay.hidden = true;
    if (clearOnFailure) {
      elements.emptyState.classList.remove('hidden');
      elements.playerMount.classList.remove('active');
      elements.playerMount.replaceChildren();
      currentPlayer = null;
      currentBuffer = null;
      currentFileName = '';
      currentLibraryId = null;
      setGameSceneTargets([]);
      syncLibraryButtons();
      syncRecentPlayButton();
    }
    setEngineState('Could not load movie', 'error');
    showToast(error?.message || 'This SWF could not be loaded.');
  }
}

async function loadSwf(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.swf')) {
    showToast('Choose a .swf movie file.');
    return;
  }
  try {
    currentBuffer = await file.arrayBuffer();
    currentFileName = file.name;
    currentLibraryId = null;
    await runCurrentGame();
  } catch (error) {
    showToast(error?.message || 'This SWF could not be read.');
  }
}

async function togglePlayback() {
  if (!currentPlayer) {
    await openRecentGame();
    return;
  }
  if (currentPlayer.ruffle().isPlaying) {
    currentPlayer.ruffle().pause();
    elements.playButton.classList.remove('is-playing');
    elements.playButton.setAttribute('aria-label', 'Play');
    elements.playButton.title = 'Play';
    elements.playButton.innerHTML = '<svg viewBox="0 0 20 20"><path d="M6.5 4.5 15 10l-8.5 5.5z"/></svg>';
    elements.transportSubtitle.textContent = 'Paused';
    elements.movieState.innerHTML = '<span class="tiny-dot"></span> PAUSED';
  } else {
    currentPlayer.ruffle().play();
    elements.playButton.classList.add('is-playing');
    elements.playButton.setAttribute('aria-label', 'Pause');
    elements.playButton.title = 'Pause';
    elements.playButton.innerHTML = '<svg viewBox="0 0 20 20"><path d="M6.5 5v10M13.5 5v10"/></svg>';
    elements.transportSubtitle.textContent = 'Playing';
    elements.movieState.innerHTML = '<span class="tiny-dot"></span> PLAYING';
  }
}

function resetSettings() {
  const renderSettingsChanged = settings.resolution !== defaults.resolution || settings.renderQuality !== defaults.renderQuality;
  if (renderSettingsChanged && currentBuffer && !window.confirm('Resetting resolution settings will restart the current game. Continue?')) return;
  settings = { ...defaults };
  lastAudibleVolume = defaults.volume;
  elements.enhanceToggle.checked = defaults.enhance;
  elements.brightness.value = defaults.brightness;
  elements.contrast.value = defaults.contrast;
  elements.saturation.value = defaults.saturation;
  elements.crispToggle.checked = defaults.crisp;
  elements.resolutionMode.value = defaults.resolution;
  elements.renderQuality.value = defaults.renderQuality;
  elements.colorEnhanceToggle.checked = defaults.colorEnhance;
  elements.colorBoost.value = defaults.colorBoost;
  applyPictureSettings();
  syncAudioUI();
  saveSettings();
  showToast('Settings restored to defaults.');
  if (renderSettingsChanged && currentBuffer) runCurrentGame({ clearOnFailure: false });
}

async function changeRenderOption(input, settingName) {
  const nextValue = input.value;
  const previousValue = settings[settingName];
  if (nextValue === previousValue) return;
  if (currentBuffer && !window.confirm('Changing resolution or render quality restarts the current game. Unsaved in-game progress may be lost. Continue?')) {
    input.value = previousValue;
    return;
  }
  settings[settingName] = nextValue;
  saveSettings();
  if (currentBuffer) await runCurrentGame({ clearOnFailure: false });
}

function syncFullscreenUI(isFullscreen) {
  document.body.classList.toggle('movie-fullscreen', isFullscreen);
  elements.fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  elements.fullscreenButton.title = isFullscreen ? 'Exit fullscreen · Esc' : 'Fullscreen';
  schedulePlayerViewportSync();
  if (isFullscreen) revealFullscreenControls();
  else {
    clearTimeout(fullscreenControlsTimer);
    document.body.classList.remove('fullscreen-controls-visible');
  }
}

function revealFullscreenControls() {
  if (!document.body.classList.contains('movie-fullscreen')) return;
  document.body.classList.add('fullscreen-controls-visible');
  clearTimeout(fullscreenControlsTimer);
  fullscreenControlsTimer = setTimeout(() => document.body.classList.remove('fullscreen-controls-visible'), 2600);
}

function renderUpdateState(update = {}) {
  updatePhase = update.state || 'idle';
  const version = update.version || '';
  const percent = Math.max(0, Math.min(100, Number(update.percent) || 0));
  elements.updateVersion.textContent = `FlashDesk Player ${update.currentVersion ? `v${update.currentVersion}` : ''}`.trim();
  elements.updateProgress.hidden = updatePhase !== 'downloading';
  elements.updateProgressFill.style.width = `${percent}%`;

  const view = {
    idle: { message: 'New versions download automatically after you check.', button: 'Check for updates', disabled: false },
    checking: { message: 'Checking for updates…', button: 'Checking…', disabled: true },
    current: { message: `You’re up to date${version ? ` · v${version}` : ''}.`, button: 'Check again', disabled: false },
    available: { message: `Version ${version ? `v${version}` : ''} is available. Starting download…`, button: 'Downloading…', disabled: true },
    downloading: { message: `Downloading update… ${Math.round(percent)}%`, button: 'Downloading…', disabled: true },
    downloaded: { message: `Version ${version ? `v${version}` : ''} is ready. Restart FlashDesk or close it to install.`, button: 'Restart to update', disabled: false },
    unconfigured: { message: 'Connect a GitHub Releases feed to enable updates.', button: 'Not configured', disabled: true },
    unavailable: { message: 'Updates are available in the installed app.', button: 'Unavailable here', disabled: true },
    error: { message: update.message || 'Could not check for updates.', button: 'Try again', disabled: false }
  }[updatePhase] || { message: update.message || 'Update status unavailable.', button: 'Try again', disabled: false };

  elements.updateStatus.textContent = view.message;
  elements.updateButton.textContent = view.button;
  elements.updateButton.disabled = view.disabled;
  if (updatePhase === 'current') showToast('FlashDesk Player is up to date.');
  if (updatePhase === 'available') showToast(`FlashDesk Player ${version} is available.`);
}

async function toggleFullscreen() {
  if (!currentPlayer) {
    showToast('Load a SWF movie before entering fullscreen.');
    return;
  }
  try {
    if (window.appWindow?.toggleFullscreen) {
      const isFullscreen = await window.appWindow.toggleFullscreen();
      syncFullscreenUI(isFullscreen);
      if (isFullscreen) showToast('Press Esc to exit fullscreen.');
    } else if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      syncFullscreenUI(true);
    } else {
      await document.exitFullscreen();
      syncFullscreenUI(false);
    }
  } catch {
    showToast('Fullscreen is unavailable right now.');
  }
}

function bindEvents() {
  elements.playerTab.addEventListener('click', () => setActiveAppTab('player'));
  elements.libraryTab.addEventListener('click', () => setActiveAppTab('library'));
  elements.libraryAddButton.addEventListener('click', () => elements.filePicker.click());
  elements.openButton.addEventListener('click', () => elements.filePicker.click());
  elements.browseButton.addEventListener('click', () => elements.filePicker.click());
  elements.libraryCurrentButton.addEventListener('click', () => addCurrentGameToLibrary());
  elements.coverCurrentButton.addEventListener('click', () => elements.coverPicker.click());
  elements.screenshotCurrentButton.addEventListener('click', captureGameCover);
  elements.gifCoverButton.addEventListener('click', captureGameGifCover);
  elements.gifCropButton.addEventListener('click', selectGifCropArea);
  elements.fullscreenScreenshotButton.addEventListener('click', captureGameCover);
  elements.fullscreenGifButton.addEventListener('click', captureGameGifCover);
  elements.fullscreenGifCropButton.addEventListener('click', selectGifCropArea);
  elements.sceneSelects.forEach((select) => select.addEventListener('change', selectGameScene));
  elements.coverPicker.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) chooseCoverImage(file);
    event.target.value = '';
  });
  elements.favoriteCurrentButton.addEventListener('click', toggleCurrentFavorite);
  document.querySelectorAll('.library-filter').forEach((button) => button.addEventListener('click', () => {
    libraryFilter = button.dataset.filter;
    syncLibraryFilterButtons();
    renderLibrary();
  }));
  document.querySelectorAll('.library-layout-button').forEach((button) => button.addEventListener('click', () => {
    const view = button.dataset.libraryView;
    if (!['large', 'normal', 'columns', 'list'].includes(view)) return;
    libraryViewMode = view;
    try { localStorage.setItem(LIBRARY_VIEW_KEY, view); } catch { /* Keep the selected layout for this session. */ }
    syncLibraryViewButtons();
    renderLibrary();
  }));
  elements.favoritesList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.libraryId;
    if (button.dataset.action === 'open') {
      await openLibraryGame(id);
      return;
    }
    if (button.dataset.action === 'favorite') {
      const record = libraryRecords.find((item) => item.id === id);
      if (!record) return;
      try {
        const updatedRecord = { ...record, favorite: !record.favorite };
        await writeFavoriteRecord(updatedRecord);
        libraryRecords = libraryRecords.map((item) => item.id === id ? updatedRecord : item);
        syncLibraryButtons();
        renderLibrary();
        showToast(updatedRecord.favorite ? 'Added to favorites.' : 'Removed from favorites.');
      } catch (error) {
        showToast(error?.message || 'Could not update this favorite.');
      }
      return;
    }
    if (button.dataset.action === 'remove') {
      try {
        await deleteFavoriteRecord(id);
        libraryRecords = libraryRecords.filter((record) => record.id !== id);
        if (currentLibraryId === id) currentLibraryId = null;
        syncLibraryButtons();
        renderLibrary();
        showToast('Removed from your library.');
      } catch (error) {
        showToast(error?.message || 'Could not remove this game.');
      }
    }
  });
  elements.filePicker.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) loadSwf(file);
    event.target.value = '';
  });
  elements.playButton.addEventListener('click', togglePlayback);
  elements.muteButton.addEventListener('click', () => setMuted(!settings.muted));
  elements.muteToggle.addEventListener('change', () => setMuted(elements.muteToggle.checked));
  elements.volumeSlider.addEventListener('input', () => {
    const volume = Number(elements.volumeSlider.value);
    settings.volume = volume;
    settings.muted = volume === 0;
    if (volume > 0) lastAudibleVolume = volume;
    syncAudioUI();
    saveSettings();
  });
  [elements.brightness, elements.contrast, elements.saturation, elements.colorBoost].forEach((input) => input.addEventListener('input', applyPictureSettings));
  elements.enhanceToggle.addEventListener('change', applyPictureSettings);
  elements.crispToggle.addEventListener('change', applyPictureSettings);
  elements.colorEnhanceToggle.addEventListener('change', applyPictureSettings);
  elements.resolutionMode.addEventListener('change', () => changeRenderOption(elements.resolutionMode, 'resolution'));
  elements.renderQuality.addEventListener('change', () => changeRenderOption(elements.renderQuality, 'renderQuality'));
  document.querySelectorAll('.preset-chip').forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.preset)));
  $('reset-settings-btn').addEventListener('click', resetSettings);
  elements.fullscreenButton.addEventListener('click', toggleFullscreen);
  $('fullscreen-exit-btn').addEventListener('click', () => window.appWindow?.exitFullscreen());
  document.addEventListener('mousemove', revealFullscreenControls);
  document.addEventListener('pointerdown', revealFullscreenControls);
  $('about-ruffle').addEventListener('click', () => showToast('FlashDesk uses Ruffle, an open-source Flash Player emulator.'));
  elements.updateButton.addEventListener('click', async () => {
    try {
      if (!window.appWindow?.checkForUpdates) {
        throw new Error('Update controls did not load. Restart FlashDesk, then install the latest setup if this keeps happening.');
      }
      if (updatePhase === 'available') await window.appWindow.downloadUpdate();
      else if (updatePhase === 'downloaded') await window.appWindow.installUpdate();
      else renderUpdateState(await window.appWindow.checkForUpdates());
    } catch (error) {
      renderUpdateState({ state: 'error', message: error?.message || 'Could not start the update action.' });
    }
  });
  $('minimize-btn').addEventListener('click', () => window.appWindow?.minimize());
  $('maximize-btn').addEventListener('click', () => window.appWindow?.toggleMaximize());
  $('close-btn').addEventListener('click', () => window.appWindow?.close());

  let dragDepth = 0;
  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dragDepth += 1;
    elements.dropHint.classList.add('visible');
  });
  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  document.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) elements.dropHint.classList.remove('visible');
  });
  document.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    dragDepth = 0;
    elements.dropHint.classList.remove('visible');
    loadSwf(event.dataTransfer.files[0]);
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    revealFullscreenControls();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      elements.filePicker.click();
    } else if (!typing && event.code === 'Space') {
      event.preventDefault();
      togglePlayback();
    } else if (!typing && event.key.toLowerCase() === 'm') {
      setMuted(!settings.muted);
    } else if (event.key === 'Escape' && document.fullscreenElement) {
      document.exitFullscreen();
    }
  });
}

loadSettings();
bindEvents();
syncLibraryFilterButtons();
refreshLibrary();
refreshRecentGame();
window.appWindow?.onFullscreenChange(syncFullscreenUI);
window.appWindow?.onUpdateState(renderUpdateState);
if (window.appWindow?.getUpdateStatus) {
  window.appWindow.getUpdateStatus()
    .then(renderUpdateState)
    .catch((error) => renderUpdateState({ state: 'error', message: error?.message || 'Could not load update status.' }));
} else {
  renderUpdateState({ state: 'error', message: 'FlashDesk controls did not load. Restart the app, then install the latest setup if this keeps happening.' });
}
document.addEventListener('fullscreenchange', () => syncFullscreenUI(!!document.fullscreenElement));
window.addEventListener('resize', schedulePlayerViewportSync, { passive: true });
new ResizeObserver(schedulePlayerViewportSync).observe(elements.playerMount);
window.addEventListener('load', () => {
  if (window.RufflePlayer?.newest) setEngineState('Ruffle ready', 'ready');
  else setEngineState('Player offline', 'error');
});
