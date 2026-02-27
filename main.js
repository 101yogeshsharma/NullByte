const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, Tray, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

let mainWindow = null; // The overlay
let setupWindow = null;
let settingsWindow = null;
let tray = null;
let trayIconPath = path.join(__dirname, 'assets', 'icon.png');
let screenshots = []; // Store screenshot paths
let geminiModel = 'gemma-3-27b-it'; // User requested "Gemini 3 27B" (Gemma 3 27B)
let apiKey = null;

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
      if (data.encryptedKey) {
        if (safeStorage.isEncryptionAvailable()) {
          try {
            apiKey = safeStorage.decryptString(Buffer.from(data.encryptedKey, 'hex'));
          } catch (e) {
            log("Failed to decrypt key: " + e.message);
          }
        }
      } else if (data.apiKey) {
        // Plain text fallback (e.g. from setup script)
        apiKey = data.apiKey;
      }
      if (data.model) geminiModel = data.model;
      return data;
    }
  } catch (err) {
    log("Error loading config: " + err.message);
  }
  return {};
}

function saveConfig(newConfig) {
  const current = loadConfig();
  const updated = { ...current, ...newConfig };
  
  if (newConfig.apiKey) { // explicitly check newConfig for key update
     apiKey = newConfig.apiKey; // Update memory immediately
  }

  // If we have an API key in memory (or passed in), ensure it's encrypted in the file object
  const keyToSave = newConfig.apiKey || apiKey;
  if (keyToSave) {
      if (safeStorage.isEncryptionAvailable()) {
        updated.encryptedKey = safeStorage.encryptString(keyToSave).toString('hex');
        delete updated.apiKey; // Remove plain text from file object
      } else {
        updated.apiKey = keyToSave; // Fallback
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
    icon: trayIconPath,
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
    width: 850, // Initial width, flexible
    height: 130, // Start as a strip
    x: Math.round((width - 600) / 2),
    y: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // Stealth: Prevents focus stealing, stays invisible to focus trackers
    type: 'toolbar', // Stealth: Hides from Alt+Tab window switcher
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
    icon: trayIconPath,
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

// --- Screenshot Logic ---
async function captureScreenshot(solveImmediately = false) {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // --- STEALTH: Hide overlay before capturing so it's never in the screenshot ---
    // --- STEALTH: setContentProtection(true) handles hiding from capture automatically on Windows.
    // No need to manually hide/show, which causes blinking.
    
    // desktopCapturer is safer than user-mode hooks
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: { width: primaryDisplay.size.width, height: primaryDisplay.size.height } 
    });

    const primarySource = sources.find(s => s.display_id === primaryDisplay.id.toString()) || sources[0];
    
    if (primarySource) {
      const image = primarySource.thumbnail;
      const filename = `capture_${Date.now()}.png`;
      const filePath = path.join(TEMP_DIR, filename);
      
      fs.writeFileSync(filePath, image.toPNG());
      screenshots.push(filePath);
      log(`Screenshot captured: ${filePath}`);

      // --- Restore overlay after capture ---
      if (mainWindow) {
        // Force window to be 'active' for a split second to ensure painting
        mainWindow.setIgnoreMouseEvents(false);
        setTimeout(() => {
             if (mainWindow) mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }, 200);
        
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }

      // If NOT solving immediately, ensure we start in strip mode (collapse)
      if (!solveImmediately) {
          mainWindow.webContents.send('force-collapse');
      }
      
      mainWindow.webContents.send('update-screenshots', screenshots);

      if (solveImmediately) {
        setTimeout(() => solveWithGemini(), 500);
      }
    }
  } catch (error) {
    log(`Screenshot failed: ${error}`);
  }
}

// --- Gemini Logic ---
async function solveWithGemini() {
  if (!apiKey) {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send('gemini-response', "**Error**: Missing API Key.\nPlease add your Gemini API Key in Settings.");
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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: geminiModel });

    const prompt = `Analyze the attached image(s). Provide the direct, correct answer or solution to the question, problem, or task shown.
    - If it is a coding problem, output ONLY the fully functional code.
    - If it is a multiple-choice question, provide a list of ONLY the correct option(s), with each correct option on a new line. Do not output all options in a single row.
    - If multiple questions are visible on screen, provide the clearly formatted answer/solution for each question numbered sequentially.
    - If it is a language/communication question, output ONLY the required response or correction.
    - If it is an aptitude/IQ test, output ONLY the logical answer or next item in sequence.
    - Do NOT include any explanations, reasoning, or conversational filler.`;

    const imageParts = screenshots.map(path => {
      const fileData = fs.readFileSync(path);
      return {
        inlineData: {
          data: fileData.toString('base64'),
          mimeType: "image/png"
        }
      };
    });

    const result = await model.generateContentStream([prompt, ...imageParts]);

    let fullText = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      if (mainWindow) mainWindow.webContents.send('gemini-response', fullText);
    }
    
    if (mainWindow) mainWindow.webContents.send('gemini-status', 'done');

    // Auto-clear screenshots after successful solution
    clearScreenshots();
    log('Screenshots auto-cleared after successful solution.');

  } catch (error) {
    log(`Gemini Error: ${error.message}`);
    if (mainWindow) mainWindow.webContents.send('gemini-response', `Error: ${error.message} \n\nCheck your API Key in Settings.`);
    if (mainWindow) mainWindow.webContents.send('gemini-status', 'error');
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
    ensureDirs();
    const config = loadConfig();
    
    // Auto-encrypt plain key if found during load
    if (config.apiKey && !config.encryptedKey) {
        console.log("Migrating plain text key to secure storage...");
        saveConfig({ apiKey: config.apiKey });
    }

    // Tray
    tray = new Tray(path.join(__dirname, 'assets', 'icon.png')); // Ensure this exists or use empty native image
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show/Hide Overlay', click: toggleOverlay },
      { label: 'Capture Screenshot', click: () => captureScreenshot(false) },
      { label: 'Settings', click: createSettingsWindow },
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
            if (!ret) console.log(`Registration failed for ${accelerator}`);
            else console.log(`Registered ${accelerator}`);
        } catch (e) {
            console.error(`Exception registering ${accelerator}:`, e);
        }
    };

    // Standard
    registerShortcut('CommandOrControl+Shift+S', () => captureScreenshot(false));
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

    // First run?
    if (!apiKey) {
      createSetupWindow();
    } else {
      createOverlayWindow();
    }
  });
}

// IPC Handlers
ipcMain.handle('save-api-key', (event, key) => {
  saveConfig({ apiKey: key });
  if (setupWindow) setupWindow.close();
  createOverlayWindow();
  return true;
});

ipcMain.handle('get-settings', () => {
    return { model: geminiModel, hasKey: !!apiKey };
});

ipcMain.handle('save-settings', (event, settings) => {
    saveConfig(settings);
    // Reload model
    if (settings.model) geminiModel = settings.model;
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

ipcMain.on('trigger-solve', () => {
  solveWithGemini();
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
