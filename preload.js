const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skyalert', {
  // Overlay API
  onFlyAirplane: (callback) => {
    ipcRenderer.on('fly-airplane', (_event, data) => callback(data));
  },
  airplaneLanded: () => ipcRenderer.send('airplane-landed'),

  // Settings API
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  
  // Auth API
  startGoogleAuth: () => ipcRenderer.invoke('start-google-auth'),
  signOutGoogle: () => ipcRenderer.invoke('sign-out-google'),
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),

  // Settings window events
  onSettingsUpdate: (callback) => {
    ipcRenderer.on('settings-updated', (_event, data) => callback(data));
  },

  // Pet API
  movePet: (bounds) => ipcRenderer.send('move-pet', bounds),
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),
  setPetMouseIgnore: (ignore) => ipcRenderer.send('set-pet-mouse-ignore', ignore),
  onGlobalMouseMove: (callback) => ipcRenderer.on('global-mouse-move', (_event, pt) => callback(pt))
});
