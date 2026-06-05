/* ═══════════════════════════════════════════════════════════
   SkyAlert — Settings Window Logic
   Manages settings UI interactions and persistence
   ═══════════════════════════════════════════════════════════ */

// ─── DOM Elements ───────────────────────────────────────────
const closeBtn = document.getElementById('close-btn');
const authBtn = document.getElementById('auth-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const authHint = document.getElementById('auth-hint');
const timingPills = document.getElementById('timing-pills');
const speedPills = document.getElementById('speed-pills');
const soundToggle = document.getElementById('sound-toggle');
const startupToggle = document.getElementById('startup-toggle');
const testBtn = document.getElementById('test-btn');

let currentSettings = {};

// ─── Load Settings ──────────────────────────────────────────
async function loadSettings() {
  currentSettings = await window.skyalert.getSettings();
  applySettings(currentSettings);
}

function applySettings(s) {
  // Auth status
  updateAuthUI(s.isSignedIn);

  // Timing pills
  setActivePill(timingPills, String(s.alertMinutesBefore || 15));

  // Speed pills
  setActivePill(speedPills, s.airplaneSpeed || 'normal');

  // Toggles
  soundToggle.checked = s.soundEnabled !== false;
  startupToggle.checked = s.startAtLogin || false;
}

function setActivePill(container, value) {
  container.querySelectorAll('.pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.value === value);
  });
}

function updateAuthUI(isSignedIn) {
  if (isSignedIn) {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected to Google Calendar';
    authBtn.textContent = 'Disconnect';
    authBtn.classList.add('signed-in');
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Not connected';
    authBtn.textContent = 'Connect Google Calendar';
    authBtn.classList.remove('signed-in');
  }
}

// ─── Save Settings ──────────────────────────────────────────
async function saveSettings() {
  await window.skyalert.saveSettings(currentSettings);
}

// ─── Event Listeners ────────────────────────────────────────

// Close button
closeBtn.addEventListener('click', () => {
  window.skyalert.closeSettings();
});

// Auth button
authBtn.addEventListener('click', async () => {
  const status = await window.skyalert.getAuthStatus();
  if (status.isSignedIn) {
    // Sign out
    const result = await window.skyalert.signOutGoogle();
    if (result.success) updateAuthUI(false);
  } else {
    // Sign in
    authBtn.textContent = 'Connecting...';
    authBtn.disabled = true;
    try {
      const result = await window.skyalert.startGoogleAuth();
      if (result.success) {
        updateAuthUI(true);
      } else {
        alert('Connection failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Connection failed: ' + err.message);
    }
    authBtn.disabled = false;
    const newStatus = await window.skyalert.getAuthStatus();
    updateAuthUI(newStatus.isSignedIn);
  }
});

// Timing pills
timingPills.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  setActivePill(timingPills, pill.dataset.value);
  currentSettings.alertMinutesBefore = parseInt(pill.dataset.value);
  saveSettings();
});

// Speed pills
speedPills.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  setActivePill(speedPills, pill.dataset.value);
  currentSettings.airplaneSpeed = pill.dataset.value;
  saveSettings();
});

// Sound toggle
soundToggle.addEventListener('change', () => {
  currentSettings.soundEnabled = soundToggle.checked;
  saveSettings();
});

// Startup toggle
startupToggle.addEventListener('change', () => {
  currentSettings.startAtLogin = startupToggle.checked;
  saveSettings();
});

// Test flight button
testBtn.addEventListener('click', () => {
  // Add fun click animation
  testBtn.style.transform = 'scale(0.95)';
  setTimeout(() => { testBtn.style.transform = ''; }, 150);

  // Trigger a test flight via IPC (settings window can't directly control overlay)
  // We save a flag and the main process handles it
  window.skyalert.saveSettings({ ...currentSettings, _testFlight: true });
});

// Setup guide link
document.getElementById('setup-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  window.open('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com', '_blank');
});

// ─── Initialize ─────────────────────────────────────────────
loadSettings();
