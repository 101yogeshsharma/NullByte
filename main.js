const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, Tray, Menu, safeStorage, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const {
  PROVIDERS,
  pickDefaultFreeModel,
  formatProviderError
} = require('./modelCatalog');
const {
  DEFAULT_OLLAMA_URL,
  normalizeOllamaUrl,
  fetchProviderModels,
  testProviderConnection,
  streamProviderResponse
} = require('./providerClient');

// --- Stealth: Disguise process name ---
app.setName('NullByte');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nullbyte.app');
}

// --- Configuration & State ---
const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const TEMP_DIR = path.join(app.getPath('temp'), 'NullByte');

const ICON_PNG_PATH = path.join(__dirname, 'assets', 'icon.png');
const ICON_ICO_PATH = path.join(__dirname, 'assets', 'icons', 'win', 'icon.ico');
const appIconPath = process.platform === 'win32' && fs.existsSync(ICON_ICO_PATH) ? ICON_ICO_PATH : ICON_PNG_PATH;

let mainWindow = null; // The overlay
let setupWindow = null;
let settingsWindow = null;
let tray = null;
let screenshots = []; // Store screenshot paths
let activeProvider = PROVIDERS.GEMINI;
let geminiModel = 'gemini-4-hydrogen';
let apiKey = null;
let openrouterApiKey = null;
let ollamaUrl = DEFAULT_OLLAMA_URL;
let providerModels = { gemini: 'gemini-4-hydrogen', openrouter: '', ollama: '' };
let cachedModels = [];
const rejectedModels = new Set();

function decryptStoredKey(hexValue, plainValue, label) {
  if (hexValue && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(hexValue, 'hex')).trim();
    } catch (e) {
      log(`Failed to decrypt ${label}: ${e.message}`);
    }
  }
  return plainValue ? String(plainValue).trim() : null;
}

function hasActiveCredentials() {
  if (activeProvider === PROVIDERS.OPENROUTER) return !!(openrouterApiKey && openrouterApiKey.trim());
  if (activeProvider === PROVIDERS.OLLAMA) return true;
  return !!(apiKey && apiKey.trim());
}

// Ensure directories exist
function ensureDirs() {
  [CONFIG_DIR, LOG_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// Logger
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(path.join(LOG_DIR, 'app.log'), logLine);
  console.log(logLine.trim());
}

// --- Secure Storage ---
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const loadedGeminiKey = decryptStoredKey(data.encryptedKey, data.apiKey, 'Gemini key');
      if (loadedGeminiKey) apiKey = loadedGeminiKey;

      const loadedOrKey = decryptStoredKey(data.encryptedOpenRouterKey, data.openrouterApiKey, 'OpenRouter key');
      if (loadedOrKey) openrouterApiKey = loadedOrKey;

      if (data.provider && Object.values(PROVIDERS).includes(data.provider)) {
        activeProvider = data.provider;
      }
      if (data.ollamaUrl) {
        ollamaUrl = normalizeOllamaUrl(data.ollamaUrl);
      }
      if (data.providerModels && typeof data.providerModels === 'object') {
        providerModels = { ...providerModels, ...data.providerModels };
      }
      if (data.model) {
        geminiModel = data.model;
      } else if (providerModels[activeProvider]) {
        geminiModel = providerModels[activeProvider];
      }
      return data;
    }
  } catch (err) {
    log("Error loading config: " + err.message);
  }
  return {};
}

function saveConfig(newConfig) {
  const current = loadConfig();
  const normalized = { ...newConfig };
  if (typeof normalized.apiKey === 'string') {
    normalized.apiKey = normalized.apiKey.trim();
    if (normalized.apiKey) apiKey = normalized.apiKey;
  }
  if (typeof normalized.openrouterApiKey === 'string') {
    normalized.openrouterApiKey = normalized.openrouterApiKey.trim();
    if (normalized.openrouterApiKey) openrouterApiKey = normalized.openrouterApiKey;
  }
  if (typeof normalized.ollamaUrl === 'string' && normalized.ollamaUrl.trim()) {
    normalized.ollamaUrl = normalizeOllamaUrl(normalized.ollamaUrl);
    ollamaUrl = normalized.ollamaUrl;
  }
  if (normalized.provider && Object.values(PROVIDERS).includes(normalized.provider)) {
    activeProvider = normalized.provider;
  }

  const updated = { ...current, ...normalized };
  updated.provider = activeProvider;
  updated.ollamaUrl = ollamaUrl;

  if (normalized.model) {
    geminiModel = normalized.model;
    providerModels[activeProvider] = normalized.model;
  }
  updated.providerModels = { ...providerModels };

  const geminiToSave = normalized.apiKey || apiKey;
  if (geminiToSave) {
    if (safeStorage.isEncryptionAvailable()) {
      updated.encryptedKey = safeStorage.encryptString(geminiToSave).toString('hex');
      delete updated.apiKey;
    } else {
      updated.apiKey = geminiToSave;
    }
  }

  const orToSave = normalized.openrouterApiKey || openrouterApiKey;
  if (orToSave) {
    if (safeStorage.isEncryptionAvailable()) {
      updated.encryptedOpenRouterKey = safeStorage.encryptString(orToSave).toString('hex');
      delete updated.openrouterApiKey;
    } else {
      updated.openrouterApiKey = orToSave;
    }
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
}

// --- Window Management ---

function createSetupWindow() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 600,
    height: 450,
    title: 'NullByte Setup',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    autoHideMenuBar: true,
    resizable: false
  });

  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWindow.on('closed', () => setupWindow = null);
}

function createOverlayWindow() {
  if (mainWindow) return;

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Initial state: Horizontal Strip
  mainWindow = new BrowserWindow({
    width: 1100, // Initial width, flexible
    height: 130, // Start as a strip
    x: Math.round((width - 1100) / 2),
    y: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // Stealth: Prevents focus stealing, stays invisible to focus trackers
    type: process.platform === 'darwin' ? 'panel' : 'toolbar', // Stealth: Hides from Alt+Tab window switcher
    title: '', // Stealth: Empty title to avoid showing in screen share pickers
    show: false, // Stealth: Don't show immediately, prevents window enumeration flash
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false 
    }
  });

  // --- STEALTH: Anti-Screen-Capture ---
  // Uses Windows SetWindowDisplayAffinity (WDA_EXCLUDEFROMCAPTURE / WDA_MONITOR)
  // Makes the overlay invisible to OBS, Discord, Zoom, screenshot tools, etc.
  mainWindow.setContentProtection(true);

  // CRITICAL: Always on top settings - 'screen-saver' is highest z-level
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Load content
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  
  // Stealth: After content loads, force empty title and show window
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.setTitle(''); // Force empty title after HTML loads
    mainWindow.showInactive(); // Show without taking focus (stealth)
  });
  
  mainWindow.on('closed', () => mainWindow = null);
  
  log('NullByte overlay created with stealth mode: content-protection, toolbar-type, no-focus');
}

function createSettingsWindow() {
   if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    title: 'NullByte Settings',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => settingsWindow = null);
}

// --- Overlay Control ---
function toggleOverlay() {
  if (mainWindow) {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.restore(); // In case it was minimized
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true, 'screen-saver'); 
    }
  } else {
    createOverlayWindow();
  }
}

function clearScreenshots() {
  screenshots.forEach(p => {
    try { fs.unlinkSync(p); } catch(e) {}
  });
  screenshots = [];
  if (mainWindow) mainWindow.webContents.send('update-screenshots', []);
}

let isCapturing = false;
let lastCaptureAt = 0;
let promptedScreenPermission = false;

function openMacScreenRecordingSettings() {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
}

async function captureWithMacScreencapture(filePath) {
  const wasVisible = !!(mainWindow && mainWindow.isVisible());
  if (wasVisible) mainWindow.hide();
  try {
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-m', '-t', 'png', filePath]);
  } finally {
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

// --- Screenshot Logic ---
async function captureScreenshot(solveImmediately = false) {
  const now = Date.now();
  if (isCapturing || now - lastCaptureAt < 350) {
    return;
  }
  isCapturing = true;
  lastCaptureAt = now;

  try {
    if (!mainWindow) createOverlayWindow();

    const primaryDisplay = screen.getPrimaryDisplay();
    const scale = primaryDisplay.scaleFactor || 1;
    const filename = `capture_${Date.now()}.png`;
    const filePath = path.join(TEMP_DIR, filename);

    let captured = false;
    let captureError = null;

    // 1. Primary path: Electron desktopCapturer (respects setContentProtection without blinking)
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(primaryDisplay.size.width * scale),
          height: Math.round(primaryDisplay.size.height * scale)
        }
      });

      const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
      if (primarySource && primarySource.thumbnail && !primarySource.thumbnail.isEmpty()) {
        fs.writeFileSync(filePath, primarySource.thumbnail.toPNG());
        captured = true;
      } else {
        captureError = new Error('No screen source returned by desktopCapturer.');
      }
    } catch (err) {
      captureError = err;
      log(`desktopCapturer failed: ${err.message || err}`);
    }

    // 2. macOS fallback: native screencapture (handles Electron/ScreenCaptureKit failures on newer macOS)
    if (!captured && process.platform === 'darwin') {
      try {
        captured = await captureWithMacScreencapture(filePath);
        if (captured) {
          log('Captured screenshot via macOS screencapture fallback.');
        }
      } catch (macErr) {
        captureError = macErr;
        log(`macOS screencapture fallback failed: ${macErr.message || macErr}`);
      }
    }

    if (!captured) {
      const screenStatus = process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'unknown';
      const detail = captureError ? (captureError.message || String(captureError)) : 'Unknown error';
      log(`Screenshot failed (screen=${screenStatus}): ${detail}`);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.webContents.send('force-expand');
        mainWindow.webContents.send('gemini-status', 'error');

        if (process.platform === 'darwin') {
          if (screenStatus !== 'granted' && !promptedScreenPermission) {
            promptedScreenPermission = true;
            openMacScreenRecordingSettings();
          }
          mainWindow.webContents.send(
            'gemini-response',
            `**Screen Recording Permission Required on macOS**\n\n` +
            `NullByte could not capture your screen (\`status: ${screenStatus}\`, \`${detail}\`).\n\n` +
            `1. Open **System Settings > Privacy & Security > Screen & System Audio Recording**\n` +
            `2. Enable **NullByte** (or **Terminal** / your IDE if running via \`npm start\`)\n` +
            `3. **Quit and reopen NullByte** for the permission to take effect.`
          );
        } else {
          mainWindow.webContents.send(
            'gemini-response',
            `**Screenshot Failed**: ${detail}`
          );
        }
      }
      return;
    }

    screenshots.push(filePath);
    log(`Screenshot captured: ${filePath}`);

    // --- Restore overlay after capture ---
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }
      }, 200);

      mainWindow.setAlwaysOnTop(true, 'screen-saver');

      if (!solveImmediately) {
        mainWindow.webContents.send('force-collapse');
      }

      mainWindow.webContents.send('update-screenshots', screenshots);
    }

    if (solveImmediately) {
      setTimeout(() => solveWithGemini(), 500);
    }
  } catch (error) {
    log(`Screenshot failed: ${error.message || error}`);
  } finally {
    isCapturing = false;
  }
}

// --- AI Provider Logic ---
async function solveWithGemini(customPrompt = null) {
  if (!hasActiveCredentials()) {
    if (mainWindow) {
        const providerLabel = activeProvider === PROVIDERS.OPENROUTER ? 'OpenRouter API Key' : 'Gemini API Key';
        mainWindow.show();
        mainWindow.webContents.send('gemini-response', `**Error**: Missing ${providerLabel}.\nPlease add it in Settings (via Tray icon) or switch providers.`);
        mainWindow.webContents.send('gemini-status', 'error');
        mainWindow.webContents.send('force-expand'); 
    }
    return;
  }

  if (!geminiModel) {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send('gemini-response', `**Error**: No active model selected.\nOpen **Settings** or press **Cmd/Ctrl+Shift+M** to pick a model.`);
        mainWindow.webContents.send('gemini-status', 'error');
        mainWindow.webContents.send('force-expand');
    }
    return;
  }
  
  // WAIT FOR WINDOW LOAD if newly created
  if (mainWindow && mainWindow.webContents.isLoading()) {
      await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
  }
  
  if (screenshots.length === 0) {
      // If no screenshots, try to capture one and solve immediately
      log("No screenshots found, capturing one now...");
      captureScreenshot(true); // true = solveImmediately
      return; 
  }

  // Ensure window is visible and expanded
  if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.webContents.send('force-expand'); 
      mainWindow.webContents.send('gemini-status', 'thinking');
  }

  try {
    const defaultPrompt = `Analyze the attached image(s). Provide the direct, correct answer or solution to the question, problem, or task shown.
    - If it is a coding problem, output ONLY the fully functional code that is optimized for both time and space complexities.
    - If it is a code debugging scenario where code is already present on the screen but not working, explicitly highlight the exact line(s) containing the error and explain why it is not working before providing the correct, optimized fixed code for both space and time complexity.
    - If it is a multiple-choice question, provide a list of ONLY the correct option(s), with each correct option on a new line. Do not output all options in a single row.
    - If multiple questions are visible on screen, provide the clearly formatted answer/solution for each question numbered sequentially.
    - If it is a language/communication question, output ONLY the required response or correction.
    - If it is an aptitude/IQ test, output ONLY the logical answer or next item in sequence.
    - Do NOT include any explanations, reasoning, or conversational filler (unless you are explicitly explaining why existing code is not working).`;

    const prompt = (customPrompt && customPrompt.trim() !== '') ? customPrompt.trim() : defaultPrompt;

    const imageBase64List = screenshots.map(imgPath => fs.readFileSync(imgPath).toString('base64'));

    let fullText = '';
    let deprecationHandled = false;

    await streamProviderResponse({
      provider: activeProvider,
      apiKey,
      openrouterApiKey,
      ollamaUrl,
      model: geminiModel,
      prompt,
      imageBase64List,
      onModelStatus: (modelStatus) => {
        const stage = modelStatus.modelStage;
        if (!deprecationHandled && (stage === 'LEGACY' || stage === 'DEPRECATED' || stage === 'RETIRED')) {
          deprecationHandled = true;
          rejectedModels.add(geminiModel);
          refreshModelsAndNotify().catch(err => log(`Model refresh error: ${err.message}`));
        }
      },
      onChunk: (chunkText) => {
        if (chunkText) {
          fullText += chunkText;
          if (mainWindow) mainWindow.webContents.send('gemini-response', fullText);
        }
      }
    });
    
    if (mainWindow) mainWindow.webContents.send('gemini-status', 'done');

    // Auto-clear screenshots after successful solution
    clearScreenshots();
    log('Screenshots auto-cleared after successful solution.');

  } catch (error) {
    log(`Provider Error (${activeProvider} / ${geminiModel}): ${error.message}`);
    const formatted = formatProviderError(activeProvider, error, geminiModel, cachedModels);
    if (formatted.shouldMarkDeprecated) {
      rejectedModels.add(geminiModel);
      await refreshModelsAndNotify();
    }
    if (mainWindow) {
      mainWindow.webContents.send('gemini-response', formatted.userMessage);
      mainWindow.webContents.send('gemini-status', 'error');
    }
  }
}

// --- App Lifecycle ---

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
    ensureDirs();
    const config = loadConfig();
    
    // Auto-encrypt plain key if found during load
    if (config.apiKey && !config.encryptedKey) {
        console.log("Migrating plain text key to secure storage...");
        saveConfig({ apiKey: config.apiKey });
    }

    // Tray
    tray = new Tray(appIconPath); // Ensure this exists or use empty native image
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show/Hide Overlay', click: toggleOverlay },
      { label: 'Capture Screenshot', click: () => captureScreenshot(false) },
      { label: 'Settings', click: createSettingsWindow },
      ...(process.platform === 'darwin'
        ? [{ label: 'Screen Recording Permissions', click: openMacScreenRecordingSettings }]
        : []),
      { label: 'Clear Cache', click: clearScreenshots },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() }
    ]);
    tray.setToolTip('NullByte');
    tray.setContextMenu(contextMenu);
    tray.on('click', toggleOverlay);

    // Shortcuts - Robust Registration
    const registerShortcut = (accelerator, callback) => {
        try {
            const ret = globalShortcut.register(accelerator, callback);
            if (!ret) log(`Registration failed for ${accelerator}`);
            else log(`Registered ${accelerator}`);
        } catch (e) {
            log(`Exception registering ${accelerator}: ${e.message}`);
        }
    };

    // Standard
    registerShortcut('CommandOrControl+Shift+S', () => captureScreenshot(false));
    registerShortcut('Alt+Shift+S', () => captureScreenshot(false));
    registerShortcut('CommandOrControl+Shift+Q', toggleOverlay);
    registerShortcut('CommandOrControl+Shift+X', clearScreenshots);
    registerShortcut('CommandOrControl+Shift+Esc', () => app.quit());

    // Scrolling
    registerShortcut('CommandOrControl+Shift+Up', () => mainWindow?.webContents.send('scroll-event', 'up'));
    registerShortcut('CommandOrControl+Shift+Down', () => mainWindow?.webContents.send('scroll-event', 'down'));
    registerShortcut('CommandOrControl+Shift+Left', () => mainWindow?.webContents.send('scroll-event', 'left'));
    registerShortcut('CommandOrControl+Shift+Right', () => mainWindow?.webContents.send('scroll-event', 'right'));

    // Solve shortcut callback
    const solveShortcutCallback = (key) => {
         console.log(`Shortcut Triggered: Solve (${key})`);
         if (!mainWindow) createOverlayWindow();
         
         if (mainWindow) {
             // Force Active for a split second to ensure capture/focus
             mainWindow.setIgnoreMouseEvents(false);
             if (!mainWindow.isVisible()) mainWindow.show();
             mainWindow.setAlwaysOnTop(true, 'screen-saver');
             
             // Revert to ghost after small delay
             setTimeout(() => {
                 if (mainWindow) mainWindow.setIgnoreMouseEvents(true, { forward: true });
             }, 500);
         }
         solveWithGemini();
    };

    // Register standard solve shortcuts
    ['CommandOrControl+Shift+D', 'Alt+Shift+D', 'CommandOrControl+Shift+G'].forEach(key => {
        registerShortcut(key, () => solveShortcutCallback(key));
    });

    // Register Ctrl+Shift+Enter separately with extra verification
    try {
        const enterKey = 'CommandOrControl+Shift+Enter';
        const retEnter = globalShortcut.register(enterKey, () => solveShortcutCallback(enterKey));
        console.log(`Register ${enterKey}: ${retEnter}, isRegistered: ${globalShortcut.isRegistered(enterKey)}`);
    } catch(e1) {
        console.error('Failed with Enter, trying Return:', e1.message);
        try {
            const returnKey = 'CommandOrControl+Shift+Return';
            const retReturn = globalShortcut.register(returnKey, () => solveShortcutCallback(returnKey));
            console.log(`Register ${returnKey}: ${retReturn}, isRegistered: ${globalShortcut.isRegistered(returnKey)}`);
        } catch(e2) {
            console.error('Failed with Return too:', e2.message);
        }
    }

    // Dropdown (M) - Robust
    ['CommandOrControl+Shift+M', 'Alt+Shift+M'].forEach(key => {
        registerShortcut(key, () => {
            console.log(`Shortcut Triggered: Dropdown (${key})`);
            if (!mainWindow) createOverlayWindow();
            
            if (mainWindow) {
                mainWindow.show();
                mainWindow.setIgnoreMouseEvents(false);
                mainWindow.webContents.send('toggle-model-dropdown');
            }
        });
    });

    // Custom Prompt (P)
    ['CommandOrControl+Shift+P', 'Alt+Shift+P'].forEach(key => {
        registerShortcut(key, () => {
            console.log(`Shortcut Triggered: Custom Prompt (${key})`);
            if (!mainWindow) createOverlayWindow();
            
            if (mainWindow) {
                mainWindow.setFocusable(true);
                mainWindow.show();
                mainWindow.focus();
                mainWindow.setIgnoreMouseEvents(false);
                mainWindow.webContents.send('toggle-custom-prompt');
            }
        });
    });

    // First run?
    if (!hasActiveCredentials()) {
      createSetupWindow();
    } else {
      createOverlayWindow();
    }
  });
}

async function fetchModelsList(options = null) {
  if (options && options.provider && options.provider !== activeProvider) {
    return fetchProviderModels({
      provider: options.provider,
      apiKey: options.apiKey || apiKey,
      openrouterApiKey: options.openrouterApiKey || openrouterApiKey,
      ollamaUrl: options.ollamaUrl || ollamaUrl,
      rejectedModels
    });
  }

  cachedModels = await fetchProviderModels({
    provider: activeProvider,
    apiKey: (options && options.apiKey) || apiKey,
    openrouterApiKey: (options && options.openrouterApiKey) || openrouterApiKey,
    ollamaUrl: (options && options.ollamaUrl) || ollamaUrl,
    rejectedModels
  });

  // Ensure the active model is valid and not deprecated
  if (cachedModels.length > 0 && !cachedModels.find(m => m.id === geminiModel)) {
    const defaultModel = pickDefaultFreeModel(cachedModels);
    if (defaultModel) {
      geminiModel = defaultModel.id;
      saveConfig({ model: geminiModel });
    }
  }

  return cachedModels;
}

async function refreshModelsAndNotify() {
  const models = await fetchModelsList();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('models-updated', models);
  }
  return models;
}

// IPC Handlers
ipcMain.handle('save-api-key', async (event, key) => {
  rejectedModels.clear();
  saveConfig({ provider: PROVIDERS.GEMINI, apiKey: key });
  await fetchModelsList();
  if (setupWindow) setupWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('models-updated', cachedModels);
  } else {
    createOverlayWindow();
  }
  return true;
});

ipcMain.on('open-settings', () => {
  if (setupWindow) setupWindow.close();
  createSettingsWindow();
});

ipcMain.handle('get-settings', () => {
  return {
    provider: activeProvider,
    model: geminiModel,
    providerModels,
    hasKey: !!apiKey,
    hasOpenRouterKey: !!openrouterApiKey,
    ollamaUrl
  };
});

ipcMain.handle('save-settings', async (event, settings) => {
  const next = settings || {};
  if (next.apiKey || next.openrouterApiKey || next.provider) {
    rejectedModels.clear();
  }
  saveConfig(next);
  if (next.model) {
    geminiModel = next.model;
  } else if (providerModels[activeProvider]) {
    geminiModel = providerModels[activeProvider];
  }

  const models = await refreshModelsAndNotify();
  if (setupWindow) setupWindow.close();
  if (!mainWindow && hasActiveCredentials()) {
    createOverlayWindow();
  }
  return { ok: true, models };
});

ipcMain.handle('test-connection', async (event, payload = {}) => {
  const targetProvider = payload.provider || activeProvider;
  const result = await testProviderConnection({
    provider: targetProvider,
    apiKey: payload.apiKey && payload.apiKey.trim() ? payload.apiKey.trim() : apiKey,
    openrouterApiKey:
      payload.openrouterApiKey && payload.openrouterApiKey.trim()
        ? payload.openrouterApiKey.trim()
        : openrouterApiKey,
    ollamaUrl: payload.ollamaUrl || ollamaUrl,
    model: payload.model
  });

  if (result.models && result.models.length > 0 && targetProvider === activeProvider) {
    cachedModels = result.models;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('models-updated', cachedModels);
    }
  }
  return result;
});

// IPC: Set Model
ipcMain.handle('set-model', (event, modelId) => {
  geminiModel = modelId;
  saveConfig({ model: modelId });
  return true;
});

// IPC: Get Current Model
ipcMain.handle('get-current-model', () => {
  return geminiModel;
});

ipcMain.handle('fetch-models', async (event, options) => {
  return fetchModelsList(options);
});

ipcMain.on('trigger-solve', (event, customPrompt) => {
  solveWithGemini(customPrompt);
});

ipcMain.on('close-custom-prompt', () => {
  if (mainWindow) {
    mainWindow.setFocusable(false);
    mainWindow.blur();
  }
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow && Number.isFinite(width) && Number.isFinite(height)) {
    try {
        mainWindow.setSize(Math.round(width), Math.round(height));
    } catch (e) {
        console.error("Resize error:", e);
    }
  }
});

// Clean up
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
