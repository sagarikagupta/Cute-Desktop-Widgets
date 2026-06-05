const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'skyalert-config.json');
    this.data = this._load();
  }

  _defaults() {
    return {
      alertMinutesBefore: 15,
      airplaneSpeed: 'normal',  // slow, normal, fast
      soundEnabled: true,
      startAtLogin: false,
      googleTokens: null,
      alertedEvents: {}  // eventId -> timestamp, for dedup
    };
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return { ...this._defaults(), ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }
    return this._defaults();
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  getAll() {
    // Don't expose tokens to renderer
    const { googleTokens, ...safe } = this.data;
    return { ...safe, isSignedIn: !!googleTokens };
  }

  setAll(settings) {
    // Don't let renderer overwrite tokens
    const { googleTokens, isSignedIn, ...safe } = settings;
    this.data = { ...this.data, ...safe };
    this._save();
  }

  // Track which events we already alerted on
  markAlerted(eventId) {
    this.data.alertedEvents[eventId] = Date.now();
    this._cleanOldAlerts();
    this._save();
  }

  wasAlerted(eventId) {
    return !!this.data.alertedEvents[eventId];
  }

  _cleanOldAlerts() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const alerts = this.data.alertedEvents;
    for (const id in alerts) {
      if (alerts[id] < oneDayAgo) delete alerts[id];
    }
  }
}

module.exports = Store;
