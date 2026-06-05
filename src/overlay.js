/* ═══════════════════════════════════════════════════════════
   SkyAlert — Overlay Logic
   Handles airplane animations, sounds, and cloud effects
   ═══════════════════════════════════════════════════════════ */

const stage = document.getElementById('stage');
const template = document.getElementById('flight-template');

// Queue to prevent overlapping flights
let isFlying = false;
const flightQueue = [];

// ─── Cute Chime Sound (Web Audio API) ───────────────────────
function playCuteChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Ascending sparkle notes: C5, E5, G5, C6
    const notes = [523.25, 659.25, 783.99, 1046.50];
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.15;
    masterGain.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      // Soft sine + triangle blend for warmth
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.14);

      // Gentle envelope
      const startTime = ctx.currentTime + i * 0.14;
      noteGain.gain.setValueAtTime(0.001, startTime);
      noteGain.gain.linearRampToValueAtTime(0.5, startTime + 0.04);
      noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.55);

      osc.connect(noteGain);
      noteGain.connect(masterGain);
      osc.start(startTime);
      osc.stop(startTime + 0.6);
    });

    // Little shimmer at the end
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(1568, ctx.currentTime + 0.6);
    shimmerGain.gain.setValueAtTime(0.001, ctx.currentTime + 0.6);
    shimmerGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.65);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(masterGain);
    shimmer.start(ctx.currentTime + 0.6);
    shimmer.stop(ctx.currentTime + 1.3);
  } catch (e) {
    console.warn('Sound failed:', e);
  }
}

// ─── Spawn Cloud Puffs ──────────────────────────────────────
function spawnClouds(flightEl) {
  const group = flightEl.querySelector('.airplane-group');
  let cloudInterval;

  const spawn = () => {
    const puff = document.createElement('div');
    puff.className = 'cloud-puff';

    // Randomize size and position behind the plane
    const size = 15 + Math.random() * 25;
    puff.style.width = `${size}px`;
    puff.style.height = `${size}px`;
    puff.style.right = `${100 + Math.random() * 30}px`;
    puff.style.top = `${25 + Math.random() * 35}px`;
    puff.style.setProperty('--puff-dx', `${-40 - Math.random() * 50}px`);
    puff.style.setProperty('--puff-dy', `${-10 + Math.random() * 25}px`);
    puff.style.setProperty('--puff-duration', `${1.2 + Math.random() * 1}s`);

    group.appendChild(puff);

    // Clean up after animation
    puff.addEventListener('animationend', () => puff.remove());
  };

  // Spawn clouds every 200ms during flight
  cloudInterval = setInterval(spawn, 200);

  // Also spawn some sparkles
  const sparkleInterval = setInterval(() => {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.right = `${90 + Math.random() * 50}px`;
    sparkle.style.top = `${20 + Math.random() * 50}px`;
    group.appendChild(sparkle);
    sparkle.addEventListener('animationend', () => sparkle.remove());
  }, 300);

  return () => {
    clearInterval(cloudInterval);
    clearInterval(sparkleInterval);
  };
}

// ─── Emoji Picker ───────────────────────────────────────────
function getEmoji(type) {
  const emojis = {
    meeting: '📅',
    deadline: '⏰',
    reminder: '💡',
    test: '🛩️',
    birthday: '🎂',
    default: '✨'
  };
  return emojis[type] || emojis.default;
}

// ─── Speed Config ───────────────────────────────────────────
function getSpeedClass(speed) {
  return `speed-${speed || 'normal'}`;
}

// ─── Fly an Airplane! ───────────────────────────────────────
function flyAirplane(data) {
  if (isFlying) {
    flightQueue.push(data);
    return;
  }

  isFlying = true;

  // Clone the template
  const clone = template.content.cloneNode(true);
  const flightPath = clone.querySelector('.flight-path');

  // Set content
  const bannerText = clone.querySelector('.banner-text');
  const bannerEmoji = clone.querySelector('.banner-emoji');
  bannerText.textContent = data.title || 'Upcoming event!';
  bannerEmoji.textContent = data.emoji || getEmoji(data.type);

  // Randomize vertical position slightly (15% - 30% from top)
  const yPos = 15 + Math.random() * 15;
  flightPath.style.setProperty('--flight-y', `${yPos}%`);

  // Set speed
  flightPath.classList.add(getSpeedClass(data.speed));

  // Add to stage
  stage.appendChild(flightPath);

  // Play sound
  playCuteChime();

  // Start cloud effects
  const stopClouds = spawnClouds(flightPath);

  // Clean up after animation ends
  flightPath.addEventListener('animationend', (e) => {
    // Prevent child animationend events (clouds/sparkles) from triggering early removal
    if (e.target !== flightPath) return;

    stopClouds();
    flightPath.remove();
    isFlying = false;

    // Tell main process
    if (window.skyalert) {
      window.skyalert.airplaneLanded();
    }

    // Process queue
    if (flightQueue.length > 0) {
      setTimeout(() => flyAirplane(flightQueue.shift()), 800);
    }
  });
}

// ─── Listen for flights from main process ───────────────────
if (window.skyalert) {
  window.skyalert.onFlyAirplane((data) => {
    flyAirplane(data);
  });
}

// Debug: allow manual testing via console
window.testFlight = (msg) => {
  flyAirplane({
    title: msg || 'Test Flight! ✨',
    type: 'test',
    emoji: '🛩️'
  });
};

console.log('✈️ SkyAlert overlay ready!');
