const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const Store = require('./lib/store');
const Scheduler = require('./lib/scheduler');
const GoogleAuth = require('./auth/google-auth');

let overlayWindow = null;
let settingsWindow = null;
let petWindow = null;
let tray = null;
let store = null;
let scheduler = null;
let googleAuth = null;

// ─── Overlay Window (fullscreen transparent) ────────────────────────
function createOverlay() {
  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.bounds;
  const scaleFactor = display.scaleFactor || 1;

  console.log(`Display bounds: ${width}x${height} at (${x},${y}), scale: ${scaleFactor}`);

  overlayWindow = new BrowserWindow({
    width: Math.round(width * scaleFactor),
    height: Math.round(height * scaleFactor),
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    fullscreenable: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);

  // Force the window to cover the full screen
  overlayWindow.setBounds({ x, y, width, height });

  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));

  overlayWindow.webContents.on('did-finish-load', () => {
    const bounds = overlayWindow.getBounds();
    console.log(`Overlay actual bounds: ${bounds.width}x${bounds.height} at (${bounds.x},${bounds.y})`);
  });
}

// ─── Settings Window ────────────────────────────────────────────────
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 440,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Pet Window ─────────────────────────────────────────────────────
function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return;

  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea; // Excludes taskbar
  const scaleFactor = display.scaleFactor || 1;
  const pW = Math.round(220 * scaleFactor);
  const pH = Math.round(300 * scaleFactor);

  petWindow = new BrowserWindow({
    width: pW,
    height: pH,
    x: workArea.x + Math.floor(workArea.width / 2) - Math.floor(pW/2),
    y: workArea.y + workArea.height - pH,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Pet should stay on top and receive mouse events for petting
  petWindow.setVisibleOnAllWorkspaces(true);
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  // CRITICAL: On Windows with transparent windows, clicks on transparent pixels
  // pass through. This tells Electron to forward ALL mouse events to the renderer
  // so we can do our own per-pixel hit detection.
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  
  petWindow.loadFile(path.join(__dirname, 'src', 'pet.html'));
  
  petWindow.on('closed', () => { petWindow = null; });
}

function removePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.close();
  }
}

// ─── System Tray ────────────────────────────────────────────────────
function createTray() {
  // Create a 16x16 tray icon programmatically
  // This is a tiny pink airplane drawn as a data URL
  let trayIcon;
  try {
    const iconPath = path.join(__dirname, 'src', 'assets', 'tray-icon.png');
    const fs = require('fs');
    if (fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        console.error('Tray icon loaded but is empty, using fallback');
        trayIcon = null;
      } else {
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
        console.log('Tray icon loaded from file, size:', trayIcon.getSize());
      }
    }
  } catch (e) {
    console.error('Failed to load tray icon from file:', e.message);
  }

  // Fallback: create a simple colored icon programmatically
  if (!trayIcon || trayIcon.isEmpty()) {
    console.log('Using programmatic tray icon fallback');
    // Create a simple 16x16 pink circle icon as a BMP-style buffer
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const cx = x - size / 2;
        const cy = y - size / 2;
        const dist = Math.sqrt(cx * cx + cy * cy);
        if (dist < size / 2 - 1) {
          // Pink fill
          canvas[idx] = 255;     // R
          canvas[idx + 1] = 181; // G
          canvas[idx + 2] = 194; // B
          canvas[idx + 3] = 255; // A
        } else if (dist < size / 2) {
          // Slightly darker edge
          canvas[idx] = 230;
          canvas[idx + 1] = 150;
          canvas[idx + 2] = 170;
          canvas[idx + 3] = 255;
        } else {
          // Transparent
          canvas[idx] = 0;
          canvas[idx + 1] = 0;
          canvas[idx + 2] = 0;
          canvas[idx + 3] = 0;
        }
      }
    }
    trayIcon = nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size
    });
  }

  try {
    tray = new Tray(trayIcon);
    console.log('Tray created successfully');
  } catch (e) {
    console.error('Failed to create tray:', e.message);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Spawn Pet', click: () => createPetWindow() },
    { label: 'Remove Pet', click: () => removePetWindow() },
    { type: 'separator' },
    { label: 'Test Flight', click: () => triggerTestFlight() },
    { type: 'separator' },
    { label: 'Settings', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit SkyAlert', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('SkyAlert - Cute Calendar Notifications');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => triggerTestFlight());
}

// ─── Flight Triggers ────────────────────────────────────────────────
function triggerTestFlight() {
  sendFlight({
    title: 'Test Flight! ✨',
    subtitle: 'SkyAlert is working!',
    type: 'test',
    emoji: '🛩️'
  });
}

function sendFlight(eventData) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('fly-airplane', eventData);
  }
}

// ─── IPC Handlers ───────────────────────────────────────────────────
ipcMain.handle('get-settings', () => store.getAll());

ipcMain.handle('save-settings', (_event, settings) => {
  // Check for test flight trigger from settings window
  if (settings._testFlight) {
    delete settings._testFlight;
    triggerTestFlight();
  }
  store.setAll(settings);
  // Update login item
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin || false });
  return true;
});

ipcMain.handle('close-settings', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

ipcMain.handle('start-google-auth', async () => {
  try {
    const tokens = await googleAuth.authorize();
    store.set('googleTokens', tokens);
    if (scheduler) scheduler.start();
    return { success: true };
  } catch (err) {
    console.error('Auth failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sign-out-google', () => {
  store.set('googleTokens', null);
  if (scheduler) scheduler.stop();
  return { success: true };
});

ipcMain.handle('get-auth-status', () => {
  return { isSignedIn: !!store.get('googleTokens') };
});

ipcMain.on('airplane-landed', () => { /* animation complete */ });

ipcMain.on('move-pet', (event, { x, y, width, height }) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  }
});

ipcMain.on('set-pet-mouse-ignore', (event, ignore) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.handle('get-screen-bounds', () => {
  const display = screen.getPrimaryDisplay();
  return {
    workArea: display.workArea,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor || 1
  };
});

// ─── App Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  store = new Store();
  googleAuth = new GoogleAuth();

  createOverlay();
  createTray();

  // Start scheduler
  scheduler = new Scheduler(store, sendFlight, googleAuth);
  if (store.get('googleTokens')) {
    scheduler.start();
  }

  console.log('✈️ SkyAlert is running! Right-click the tray icon to test.');

  // Auto test flight on startup so user can see it immediately
  setTimeout(() => {
    triggerTestFlight();
  }, 3000);

  // Broadcast global mouse position for eye tracking
  setInterval(() => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('global-mouse-move', screen.getCursorScreenPoint());
    }
  }, 50);
});

app.on('window-all-closed', (e) => {
  // Keep running in tray
});

app.on('before-quit', () => {
  if (scheduler) scheduler.stop();
});
