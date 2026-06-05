/* ═══════════════════════════════════════════════════════════
   SkyAlert — Google OAuth2 Authentication
   Handles the OAuth2 flow for Google Calendar access
   ═══════════════════════════════════════════════════════════ */

const { google } = require('googleapis');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// These will be set by the user in their credentials file
const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const REDIRECT_URI = 'http://localhost';

class GoogleAuth {
  constructor() {
    this.oauth2Client = null;
  }

  _loadCredentials() {
    try {
      if (fs.existsSync(CREDENTIALS_PATH)) {
        const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
        const { client_id, client_secret } = creds.installed || creds.web || {};
        if (client_id && client_secret) {
          return { client_id, client_secret };
        }
      }
    } catch (e) {
      console.error('Failed to load Google credentials:', e.message);
    }
    return null;
  }

  _createClient(credentials) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      REDIRECT_URI
    );
    return this.oauth2Client;
  }

  /**
   * Start the OAuth2 authorization flow
   * Opens a browser window for the user to sign in
   * @returns {Promise<Object>} The tokens object
   */
  async authorize() {
    const creds = this._loadCredentials();
    if (!creds) {
      throw new Error(
        'Google credentials not found!\n\n' +
        'To set up Google Calendar:\n' +
        '1. Go to console.cloud.google.com\n' +
        '2. Create a project & enable Google Calendar API\n' +
        '3. Create OAuth 2.0 credentials (Desktop app)\n' +
        '4. Download the JSON file\n' +
        `5. Save it as:\n   ${CREDENTIALS_PATH}`
      );
    }

    const client = this._createClient(creds);

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    // Open auth window
    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 520,
        height: 700,
        title: 'Sign in to Google Calendar',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      authWindow.loadURL(authUrl);

      // Listen for the redirect with the auth code
      authWindow.webContents.on('will-redirect', async (event, url) => {
        try {
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get('code');
          const error = urlObj.searchParams.get('error');

          if (error) {
            reject(new Error(`Auth denied: ${error}`));
            authWindow.close();
            return;
          }

          if (code) {
            event.preventDefault();
            const { tokens } = await client.getToken(code);
            client.setCredentials(tokens);
            authWindow.close();
            resolve(tokens);
          }
        } catch (err) {
          reject(err);
          authWindow.close();
        }
      });

      // Also check navigation (some flows use navigation instead of redirect)
      authWindow.webContents.on('will-navigate', async (event, url) => {
        if (url.startsWith(REDIRECT_URI)) {
          try {
            const urlObj = new URL(url);
            const code = urlObj.searchParams.get('code');
            if (code) {
              event.preventDefault();
              const { tokens } = await client.getToken(code);
              client.setCredentials(tokens);
              authWindow.close();
              resolve(tokens);
            }
          } catch (err) {
            reject(err);
            authWindow.close();
          }
        }
      });

      authWindow.on('closed', () => {
        reject(new Error('Auth window was closed'));
      });
    });
  }

  /**
   * Get an authenticated OAuth2 client from stored tokens
   * @param {Object} tokens - Stored OAuth tokens
   * @returns {OAuth2Client}
   */
  async getAuthClient(tokens) {
    if (!tokens) throw new Error('No tokens stored');

    const creds = this._loadCredentials();
    if (!creds) throw new Error('No Google credentials found');

    const client = this._createClient(creds);
    client.setCredentials(tokens);

    // Set up auto token refresh
    client.on('tokens', (newTokens) => {
      console.log('🔄 Google tokens refreshed');
      // Tokens will be updated by the scheduler via store
    });

    return client;
  }
}

module.exports = GoogleAuth;
