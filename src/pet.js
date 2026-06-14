'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  SkyAlert Virtual Puppy — Eye Tracking, Paw Prints, Time Awareness
// ═══════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById('petCanvas');
const ctx    = canvas.getContext('2d');
const CW = 220, CH = 240;

// Mouse position on canvas for eye tracking
let mouseCanvasX = CW / 2, mouseCanvasY = 0;

// ═══════════════════════════════════════════════════════════════════════════
//  TIME OF DAY
// ═══════════════════════════════════════════════════════════════════════════
function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 6 && h < 11)  return 'morning';   // energetic!
  if (h >= 11 && h < 17) return 'afternoon';  // normal
  if (h >= 17 && h < 21) return 'evening';    // winding down
  return 'night';                              // sleepy
}
function getWalkSpeedMult() {
  const t = getTimeOfDay();
  if (t === 'morning') return 1.3;
  if (t === 'evening') return 0.7;
  if (t === 'night')   return 0.5;
  return 1.0;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PAW PRINTS
// ═══════════════════════════════════════════════════════════════════════════
let pawPrints = [];
let lastPawX = -999;
const PAW_SPACING = 28; // pixels between prints

function addPawPrint(screenX) {
  if (Math.abs(screenX - lastPawX) < PAW_SPACING) return;
  lastPawX = screenX;
  pawPrints.push({ screenX: screenX, life: 1.0, side: pawPrints.length % 2 });
  if (pawPrints.length > 20) pawPrints.shift();
}
function drawPawPrints(dt, currentScreenX) {
  for (let i = pawPrints.length - 1; i >= 0; i--) {
    const p = pawPrints[i];
    p.life -= dt * 0.3; // fade over ~3 seconds
    if (p.life <= 0) { pawPrints.splice(i, 1); continue; }
    // Calculate canvas X relative to dog's current screen position
    const relX = CW / 2 + (p.screenX - currentScreenX);
    if (relX < -20 || relX > CW + 20) continue; // off-screen, skip drawing
    ctx.save();
    ctx.globalAlpha = p.life * 0.4;
    const px = relX + (p.side === 0 ? -8 : 8);
    const py = CH - 6;
    // Main pad
    ctx.fillStyle = '#D4B896';
    ctx.beginPath(); ctx.ellipse(px, py, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Toe beans
    ctx.beginPath(); ctx.arc(px - 3, py - 5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + 3, py - 5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, py - 7, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO
// ═══════════════════════════════════════════════════════════════════════════
const AC = new (window.AudioContext || window.webkitAudioContext)();
function synth(f1, f2, dur, type = 'triangle', vol = 0.1) {
  if (AC.state === 'suspended') AC.resume();
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, AC.currentTime);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, AC.currentTime + dur * 0.7);
  g.gain.setValueAtTime(0, AC.currentTime);
  g.gain.linearRampToValueAtTime(vol, AC.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(); o.stop(AC.currentTime + dur + 0.05);
}
const SND = {
  yip:     () => synth(900, 450, 0.15, 'triangle', 0.12),
  squeak:  () => synth(1200, 1400, 0.1, 'sine', 0.1),
  happy:   () => { synth(700, 950, 0.08, 'triangle', 0.09); setTimeout(() => synth(950, 1100, 0.1, 'triangle', 0.07), 120); },
  whimper: () => synth(500, 380, 0.4, 'sine', 0.07),
  sneeze:  () => { synth(1800, 2400, 0.04, 'triangle', 0.06); setTimeout(() => synth(1200, 800, 0.1, 'sine', 0.1), 40); }
};

// ═══════════════════════════════════════════════════════════════════════════
//  HAPPINESS (love goes from 0-100, decays slowly over ~30 min)
//  Dog starts sad. Pet it enough and it becomes happy.
// ═══════════════════════════════════════════════════════════════════════════
const LOVE_DECAY = 0.055; // ~30 min from 100 to 0
const SAD_THRESHOLD = 25; // below this = sad
const PET_BOOST = 6;      // each pet adds this much love (5 pets to get happy)
let love = 0; // start sad

function loadLove() {
  try {
    const raw = localStorage.getItem('puppyLoveV2');
    if (!raw) return;
    const { v, ts } = JSON.parse(raw);
    const elapsed = (Date.now() - ts) / 1000;
    love = Math.max(0, v - LOVE_DECAY * elapsed);
  } catch (_) {}
}
function saveLove() { localStorage.setItem('puppyLoveV2', JSON.stringify({ v: love, ts: Date.now() })); }
function tickLove(dt) {
  if (state !== 'sleep') {
    love = Math.max(0, love - LOVE_DECAY * dt);
  }
}
loadLove();
setInterval(saveLove, 15000);

// ═══════════════════════════════════════════════════════════════════════════
//  STATE MACHINE & AI
// ═══════════════════════════════════════════════════════════════════════════
let state = 'idle', stateTimer = null, stateTime = 0, behaviorClock = 0;
let lastGlobalMouseMove = Date.now();
const SLEEP_IDLE_MS = 5 * 60 * 1000; // 5 minutes
let forcedSleep = false;

function enterState(s, durationMs) {
  state = s; stateTime = 0;
  if (stateTimer) clearTimeout(stateTimer);
  if (durationMs) stateTimer = setTimeout(decide, durationMs);
  
  if (s === 'sneeze') {
    setTimeout(() => { SND.sneeze(); spawnParticles('sparkle', 2); }, 700);
  }
}

function decide() {
  if (state === 'drag') return;

  const isSad = love < SAD_THRESHOLD;

  if (isSad) {
    // When sad: mostly sit around sadly, occasionally wander slowly
    const r = Math.random();
    if      (r < 0.30) enterState('wander', 3000 + Math.random() * 4000);
    else if (r < 0.70) enterState('sad',    4000 + Math.random() * 5000);
    else               enterState('idle',   3000 + Math.random() * 3000);
  } else {
    // When happy: lots of wandering, occasional sit/idle/sleep, and sneezes!
    const r = Math.random();
    if      (r < 0.05) enterState('sneeze', 1300);
    else if (r < 0.65) enterState('wander', 4000 + Math.random() * 8000);
    else if (r < 0.80) enterState('idle',   2000 + Math.random() * 3000);
    else               enterState('sit',    3000 + Math.random() * 4000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MOVEMENT
// ═══════════════════════════════════════════════════════════════════════════
const WIN_W = 220, WIN_H = 325;
let workArea = { x: 0, y: 0, width: 1920, height: 1040 };
let scaleFactor = 1;
let dogScreenX = 500, walkDir = 1;
let dogScreenY = 0, dogVelocityY = 0;
const WALK_SPD = 80;
let walkTilt = 0;

function updatePosition(dt) {
  if (state === 'in_house') return; // stay still in house
  if (state === 'drag') { walkTilt = Math.sin(Date.now()/150) * 0.15; dogVelocityY = 0; return; }

  const floorY = workArea.height - WIN_H;
  if (dogScreenY < floorY) {
    dogVelocityY += 1500 * dt;
    dogScreenY += dogVelocityY * dt;
    if (dogScreenY > floorY) { dogScreenY = floorY; dogVelocityY = 0; }
  } else {
    dogScreenY = floorY;
  }

  if (state !== 'wander' || dogScreenY < floorY) {
    walkTilt *= 0.9;
  } else {
    const sadMult = (love < SAD_THRESHOLD) ? 0.4 : 1.0;
    const spd = WALK_SPD * sadMult * getWalkSpeedMult();
    dogScreenX += walkDir * spd * dt;
    walkTilt = walkDir * 0.05;
    if (dogScreenX > workArea.width - 90)  { dogScreenX = workArea.width - 90;  walkDir = -1; }
    if (dogScreenX < 90)                   { dogScreenX = 90;                   walkDir =  1; }
    addPawPrint(dogScreenX); // leave paw prints!
  }

  const wx = workArea.x + dogScreenX - WIN_W / 2;
  const wy = workArea.y + dogScreenY;
  window.skyalert.movePet({ x: Math.round(wx), y: Math.round(wy), width: Math.round(WIN_W * scaleFactor), height: Math.round(WIN_H * scaleFactor) });
}

// ═══════════════════════════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════════════════════════
let particles = [];
function spawnParticles(type, n) {
  for (let i = 0; i < n; i++) particles.push({
    type, life: 1, x: 70 + Math.random() * 80, y: 10 + Math.random() * 30,
    vx: (Math.random() - 0.5) * 1.8, vy: -1 - Math.random() * 1.5,
    sz: 13 + Math.random() * 6, delay: i * 0.18
  });
}
function tickParticles(dt) {
  const glyphs = { heart: '❤️', star: '⭐', sparkle: '✨' };
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if ((p.delay -= dt) > 0) continue;
    p.x += p.vx; p.y += p.vy; p.vy += 0.025; p.life -= dt * 0.55;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.font = `${p.sz}px serif`; ctx.textAlign = 'center';
    ctx.fillText(glyphs[p.type] || '?', p.x, p.y);
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOG RENDERER
// ═══════════════════════════════════════════════════════════════════════════
const FUR    = '#FFFDF5';
const EAR_C  = '#E0B589';
const FACE_C = '#5C4033';
const BLUSH  = 'rgba(255, 183, 178, 0.7)';
const TONGUE = '#FF9EBB';
const OUTLINE= '#9C7A63';

let animPhase  = 0;
let tailT      = 0;
let blinkTimer = 3 + Math.random() * 2;
let isBlinking = false, blinkDur = 0;

function drawShape(x, y, rx, ry, rot, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.restore();
}

function drawDog(dt) {
  const running = state === 'wander';
  const sleeping = state === 'sleep';
  const draggingDog = state === 'drag';
  const petting = state === 'pet';

  const isSad = love < SAD_THRESHOLD && !petting && !draggingDog;
  const happy = love / 100;

  blinkTimer -= dt;
  if (blinkTimer <= 0) { isBlinking = true; blinkDur = 0.13; blinkTimer = 2.5 + Math.random() * 3.5; }
  if (isBlinking && (blinkDur -= dt) <= 0) isBlinking = false;

  const spd = running ? 13 : 1.2;
  animPhase += dt * spd;

  // Smooth bob that only lifts up
  const bob = running ? Math.sin(animPhase * 2) * 2 - 2
            : Math.sin(animPhase * 0.9) * 1.5 - 1.5;

  tailT += dt * (draggingDog ? 25 : petting ? 20 : 2 + happy * 9);

  const cx = CW / 2;
  const offsetY = draggingDog ? 0 : 38;

  ctx.save();
  ctx.translate(cx, CH / 2 + offsetY);
  ctx.rotate(walkTilt);
  ctx.translate(-cx, -(CH / 2 + offsetY));

  ctx.translate(0, offsetY);

  // ─── IN HOUSE (sleeping inside) ───
  if (state === 'in_house') {
    ctx.save();
    const houseHeadY = CH - 56; // moved up to fit exactly inside the door hole
    const breathe = Math.sin(Date.now() / 1200) * 2.0;

    // Scale the whole head down by 0.5 so it fits inside the 45px door
    ctx.translate(cx, houseHeadY);
    ctx.scale(0.5, 0.5);
    ctx.translate(-cx, -houseHeadY);

    // Ears
    drawShape(cx - 25, houseHeadY + 5 + breathe, 14, 24, 0.3, EAR_C);
    drawShape(cx + 25, houseHeadY + 5 + breathe, 14, 24, -0.3, EAR_C);
    
    // Head
    drawShape(cx, houseHeadY + breathe, 40, 28, 0, FUR);
    
    // Closed eyes (sleeping)
    ctx.strokeStyle = FACE_C; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - 15, houseHeadY - 2 + breathe, 5, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 15, houseHeadY - 2 + breathe, 5, 0, Math.PI); ctx.stroke();
    
    // Nose
    ctx.fillStyle = FACE_C;
    ctx.beginPath(); ctx.ellipse(cx, houseHeadY + 8 + breathe, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); // remove scale for Zzz's

    // Zzz (Unscaled so they are visible)
    ctx.save();
    const zp = ((Date.now() / 1800) % 1);
    ctx.globalAlpha = Math.sin(zp * Math.PI) * 0.9;
    ctx.fillStyle = '#7B8FA1'; ctx.font = `bold ${10 + zp * 6}px sans-serif`;
    ctx.textAlign = 'center'; ctx.fillText('z', cx + 15 - zp * 6, houseHeadY - 10 - zp * 20);
    ctx.restore();

    ctx.restore();
    return;
  }

  // ─── SLEEPING (plopped down, front-facing, same proportions as standing) ───
  if (sleeping) {
    ctx.save();
    const breathe = Math.sin(Date.now() / 1200) * 1.5;
    
    // Use same center as standing dog
    const sleepBodyY = 183 + breathe * 0.3;
    const sleepHeadY = 157 + breathe * 0.3;

    // Tail behind (same style as standing tail)
    const tOff = Math.sin(Date.now() / 3000) * 4; // slow lazy wag
    drawShape(cx + 28 + tOff, sleepBodyY - 8, 12, 12, 0, EAR_C);

    // Back paws peeking out to sides
    drawShape(cx - 28, sleepBodyY + 10, 12, 7, 0.2, FUR);
    drawShape(cx + 28, sleepBodyY + 10, 12, 7, -0.2, FUR);

    // Body (squished flat, wider than tall — plopped down)
    drawShape(cx, sleepBodyY + breathe * 0.3, 38, 20 + breathe * 0.3, 0, FUR);

    // Front paws stretched out in front (head rests on these)
    drawShape(cx - 20, sleepHeadY + 32, 13, 8, 0.1, FUR);
    drawShape(cx + 20, sleepHeadY + 32, 13, 8, -0.1, FUR);

    // Ears flopping down (same size as standing ears)
    drawShape(cx - 48, sleepHeadY + 14, 18, 30, 0.3, EAR_C);
    drawShape(cx + 48, sleepHeadY + 14, 18, 30, -0.3, EAR_C);

    // Head (same size as standing head, slightly drooped)
    drawShape(cx, sleepHeadY, 58, 40, 0, FUR);

    // Blush
    ctx.fillStyle = BLUSH;
    ctx.beginPath(); ctx.ellipse(cx - 34, sleepHeadY + 10, 12, 7, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 34, sleepHeadY + 10, 12, 7, 0, 0, Math.PI*2); ctx.fill();

    // Closed eyes (happy inverted-U arcs)
    ctx.strokeStyle = FACE_C; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - 20, sleepHeadY + 2, 7, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 20, sleepHeadY + 2, 7, 0, Math.PI); ctx.stroke();

    // Nose
    ctx.fillStyle = FACE_C;
    ctx.beginPath(); ctx.ellipse(cx, sleepHeadY + 12, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();

    // Peaceful little smile
    ctx.strokeStyle = FACE_C; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx - 4, sleepHeadY + 17, 4, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 4, sleepHeadY + 17, 4, 0, Math.PI); ctx.stroke();

    // Zzz floating up
    const zp = ((Date.now() / 1800) % 1);
    ctx.globalAlpha = Math.sin(zp * Math.PI) * 0.9;
    ctx.fillStyle = '#7B8FA1'; ctx.font = `bold ${13 + zp * 8}px sans-serif`;
    ctx.textAlign = 'center'; ctx.fillText('z', cx + 45 - zp * 8, sleepHeadY - 30 - zp * 25);

    ctx.restore();
    ctx.restore();
    return;
  }

  const isSneezing = state === 'sneeze';
  let sneezeOffset = 0;
  let sneezeInhale = false;
  let sneezeAchoo = false;

  if (isSneezing) {
    if (stateTime < 0.7) {
      // Inhale
      sneezeInhale = true;
      sneezeOffset = -(stateTime / 0.7) * 5; // pull head up
    } else {
      // Achoo!
      sneezeAchoo = true;
      const achooTime = stateTime - 0.7;
      if (achooTime < 0.15) {
        sneezeOffset = 8; // Violent jerk down
      } else {
        sneezeOffset = Math.max(0, 8 - (achooTime - 0.15) * 20); // Recovering
      }
    }
  }

  // ─── STANDING / WALKING ───
  const bodyY = draggingDog ? 175 : 168 + bob + (sneezeOffset * 0.3);
  const headY = 135 + bob + sneezeOffset;

  // TAIL
  const tailX = cx + 25;
  const tOff = Math.sin(tailT) * 10;
  drawShape(tailX + tOff, bodyY - 5, 12, 12, 0, EAR_C);

  // PAWS — feet stay planted on the ground
  const pW = draggingDog ? 9 : 11;
  const pH = draggingDog ? 14 : 8;
  const lPawOffset = running ? Math.sin(animPhase) * 4 - 4 : 0;
  const rPawOffset = running ? Math.sin(animPhase + Math.PI) * 4 - 4 : 0;
  const lLegY = draggingDog ? 36 : 26 + lPawOffset - bob;
  const rLegY = draggingDog ? 36 : 26 + rPawOffset - bob;
  drawShape(cx - 16, bodyY + lLegY, pW, pH, 0, FUR);
  drawShape(cx + 16, bodyY + rLegY, pW, pH, 0, FUR);

  // BODY
  const bodyH = draggingDog ? 38 : 30;
  drawShape(cx, bodyY, 32, bodyH, 0, FUR);

  // EARS
  let eL = draggingDog ? 0.7 : 0.2 + Math.sin(animPhase * 0.4) * 0.05;
  let eR = draggingDog ? -0.7 : -0.2 - Math.sin(animPhase * 0.4) * 0.05;
  
  if (sneezeAchoo) {
    eL = 0.8; // flap up
    eR = -0.8;
  } else if (sneezeInhale) {
    eL = 0.05; // droop
    eR = -0.05;
  }

  drawShape(cx - 48, headY + 10, 18, 32, eL, EAR_C);
  drawShape(cx + 48, headY + 10, 18, 32, eR, EAR_C);

  // HEAD
  drawShape(cx, headY, 58, 42, 0, FUR);

  // BLUSH
  ctx.fillStyle = BLUSH;
  ctx.beginPath(); ctx.ellipse(cx - 34, headY + 12, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 34, headY + 12, 12, 7, 0, 0, Math.PI * 2); ctx.fill();

  // EYES
  const eyeY = headY + 2;
  const eyeL = cx - 24;
  const eyeR = cx + 24;

  if (draggingDog) {
    // Wide surprised eyes
    ctx.fillStyle = FACE_C;
    ctx.beginPath(); ctx.arc(eyeL, eyeY-2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeR, eyeY-2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(eyeL+2, eyeY-5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeR+2, eyeY-5, 3, 0, Math.PI * 2); ctx.fill();
  } else if (sneezeInhale) {
    // Squinting eyes 
    ctx.strokeStyle = FACE_C; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(eyeL - 5, eyeY); ctx.lineTo(eyeL + 5, eyeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(eyeR - 5, eyeY); ctx.lineTo(eyeR + 5, eyeY); ctx.stroke();
  } else if (sneezeAchoo) {
    // Squeezed tight (><)
    ctx.strokeStyle = FACE_C; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(eyeL-4, eyeY-4); ctx.lineTo(eyeL+3, eyeY); ctx.lineTo(eyeL-4, eyeY+4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(eyeR+4, eyeY-4); ctx.lineTo(eyeR-3, eyeY); ctx.lineTo(eyeR+4, eyeY+4); ctx.stroke();
  } else if (petting || isBlinking) {
    // Happy squint eyes
    ctx.strokeStyle = FACE_C; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(eyeL, eyeY + 4, 7, Math.PI + 0.2, -0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(eyeR, eyeY + 4, 7, Math.PI + 0.2, -0.2); ctx.stroke();
  } else {
    // Normal eyes with mouse tracking!
    const lookDx = mouseCanvasX - cx;
    const lookDy = mouseCanvasY - (headY + offsetY);
    const lookDist = Math.sqrt(lookDx * lookDx + lookDy * lookDy) || 1;
    const maxShift = 3.5;
    const pupilOX = (lookDx / lookDist) * Math.min(maxShift, Math.abs(lookDx) * 0.08);
    const pupilOY = (lookDy / lookDist) * Math.min(maxShift, Math.abs(lookDy) * 0.08);

    ctx.fillStyle = FACE_C;
    ctx.beginPath(); ctx.arc(eyeL, eyeY, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeR, eyeY, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(eyeL + pupilOX, eyeY - 2 + pupilOY, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeR + pupilOX, eyeY - 2 + pupilOY, 2.5, 0, Math.PI * 2); ctx.fill();

    // Sad eyebrows
    if (isSad) {
      ctx.strokeStyle = '#A88D7D'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(eyeL - 8, eyeY - 12); ctx.lineTo(eyeL + 2, eyeY - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(eyeR + 8, eyeY - 12); ctx.lineTo(eyeR - 2, eyeY - 8); ctx.stroke();
    }
  }

  // NOSE
  const noseY = headY + 12;
  ctx.fillStyle = FACE_C;
  ctx.beginPath(); ctx.ellipse(cx, noseY, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  // MOUTH
  ctx.strokeStyle = FACE_C; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  if (draggingDog) {
    ctx.beginPath(); ctx.ellipse(cx, noseY + 8, 4, 5, 0, 0, Math.PI*2); ctx.stroke();
  } else if (sneezeInhale) {
    // Inhaling O shape
    ctx.beginPath(); ctx.ellipse(cx, noseY + 7, 3, 4, 0, 0, Math.PI*2); ctx.stroke();
  } else if (sneezeAchoo) {
    // Scrunched mouth
    ctx.beginPath(); ctx.arc(cx - 3, noseY + 4, 3, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 3, noseY + 4, 3, 0, Math.PI); ctx.stroke();
  } else if (isSad) {
    // Frown
    ctx.beginPath(); ctx.moveTo(cx - 5, noseY + 10); ctx.quadraticCurveTo(cx, noseY + 6, cx + 5, noseY + 10); ctx.stroke();
  } else {
    // Happy mouth
    ctx.beginPath(); ctx.arc(cx - 4, noseY + 5, 4, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 4, noseY + 5, 4, 0, Math.PI); ctx.stroke();
  }

  // TONGUE (only when happy or being petted)
  if (!draggingDog && (petting || (running && !isSad)) && !isSad) {
    ctx.fillStyle = TONGUE;
    ctx.beginPath(); ctx.ellipse(cx, noseY + 11, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
  }

  // YAWN (evening/night when idle or sitting)
  const tod = getTimeOfDay();
  if ((tod === 'evening' || tod === 'night') && (state === 'idle' || state === 'sit') && !isSad && !draggingDog) {
    const yawnPhase = (Date.now() / 5000) % 1; // yawn cycle
    if (yawnPhase < 0.15) {
      const openAmount = Math.sin(yawnPhase / 0.15 * Math.PI) * 8;
      ctx.fillStyle = '#FF9EBB';
      ctx.beginPath(); ctx.ellipse(cx, noseY + 6, 5, openAmount, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = OUTLINE; ctx.stroke();
    }
  }

  // TEAR (when sad)
  if (isSad && !draggingDog) {
    const tp = ((Date.now() / 1200) % 1);
    ctx.save(); ctx.globalAlpha = Math.min(1, tp * 2.5);
    ctx.fillStyle = 'rgba(120, 180, 240, 0.8)';
    const tdy = headY + 8 + tp * 25;
    ctx.beginPath();
    ctx.moveTo(cx - 24, tdy - 6); ctx.quadraticCurveTo(cx - 19, tdy + 4, cx - 24, tdy + 8);
    ctx.quadraticCurveTo(cx - 29, tdy + 4, cx - 24, tdy - 6);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════
let lastTime = performance.now();
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts; stateTime += dt; behaviorClock += dt;
  if (behaviorClock > 7 && ['wander', 'idle', 'sit', 'sad'].includes(state) && state !== 'drag') {
    behaviorClock = 0;
    if (Math.random() < 0.45) decide();
  }

  // Idle-based sleep: sleep after 5 min of no mouse, wake on move
  if (!forcedSleep && state !== 'sleep' && state !== 'drag' && (Date.now() - lastGlobalMouseMove > SLEEP_IDLE_MS)) {
    forcedSleep = true;
    enterState('sleep', 999999);
  }

  tickLove(dt);
  updatePosition(dt);

  ctx.clearRect(0, 0, CW, CH);
  drawPawPrints(dt, dogScreenX);
  drawDog(dt);
  tickParticles(dt);
  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PETTING & DRAGGING
// ═══════════════════════════════════════════════════════════════════════════
let dragging = false, dragOX = 0, dragOY = 0, dragDist = 0;
let lastMouseX = 0, lastMouseY = 0, petAccum = 0, lastPetTime = 0;
let hoverTimer = null;

function doPet() {
  love = Math.min(100, love + PET_BOOST);
  spawnParticles('heart', 3);
  enterState('pet', 600);
  SND.yip();
  saveLove();
}

// Track mouse globally for idle sleep detection
window.addEventListener('mousemove', e => {
  lastGlobalMouseMove = Date.now();

  // Wake from idle sleep
  if (forcedSleep && state === 'sleep') {
    forcedSleep = false;
    enterState('idle', 1000);
  }

  if (!dragging) {
    window.skyalert.setPetMouseIgnore(false);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (!dragging) window.skyalert.setPetMouseIgnore(true);
    }, 150);
  }

  if (dragging) {
    const dx = e.screenX - dragOX - window.screenX;
    const dy = e.screenY - dragOY - window.screenY;
    dragDist += Math.sqrt(dx*dx + dy*dy);

    let nx = e.screenX - dragOX;
    let ny = e.screenY - dragOY;

    nx = Math.max(workArea.x, Math.min(nx, workArea.x + workArea.width - Math.round(WIN_W * scaleFactor)));
    ny = Math.max(workArea.y, Math.min(ny, workArea.y + workArea.height - Math.round(WIN_H * scaleFactor)));

    dogScreenX = nx - workArea.x + (WIN_W / 2);
    dogScreenY = ny - workArea.y;

    window.skyalert.movePet({ x: Math.round(nx), y: Math.round(ny), width: Math.round(WIN_W * scaleFactor), height: Math.round(WIN_H * scaleFactor) });
  }
});

window.addEventListener('mouseleave', () => {
  if (!dragging) window.skyalert.setPetMouseIgnore(true);
});

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  dragging = true;
  dragDist = 0;
  dragOX = e.screenX - window.screenX;
  dragOY = e.screenY - window.screenY;
  enterState('drag', 999999);
  SND.squeak();
});

canvas.addEventListener('mousemove', e => {
  // Update eye tracking position
  mouseCanvasX = e.offsetX;
  mouseCanvasY = e.offsetY;

  if (dragging) return;
  if (state === 'in_house') return; // no petting while in house

  // Exact elliptical hitbox matching the dog's head/body
  const dxFromCenter = e.offsetX - (CW / 2);
  const dyFromCenter = e.offsetY - 150;
  // If outside a 110x100 ellipse, it's not a pet
  if ((dxFromCenter * dxFromCenter) / (55 * 55) + (dyFromCenter * dyFromCenter) / (50 * 50) > 1) {
    petAccum = 0;
    return;
  }

  const dx = e.offsetX - lastMouseX;
  const dy = e.offsetY - lastMouseY;
  const dist = Math.sqrt(dx*dx + dy*dy);
  lastMouseX = e.offsetX;
  lastMouseY = e.offsetY;

  if (dist > 0 && dist < 100) petAccum += dist;

  const now = Date.now();
  if (petAccum > 80 && now - lastPetTime > 400) {
    petAccum = 0;
    lastPetTime = now;
    doPet();
  }
});

canvas.addEventListener('mouseleave', () => { petAccum = 0; });

window.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false;
    
    // Check if dropped near the dog house (bottom right)
    if (dogScreenX > workArea.width - 200) {
      enterState('in_house', 999999);
      dogScreenX = workArea.width - 100; // snap to center of house
      // Move window to exact snapped position
      const floorY = workArea.height - WIN_H;
      const wx = workArea.x + dogScreenX - WIN_W / 2;
      const wy = workArea.y + floorY;
      window.skyalert.movePet({ x: Math.round(wx), y: Math.round(wy), width: Math.round(WIN_W * scaleFactor), height: Math.round(WIN_H * scaleFactor) });
    } else {
      enterState('idle', 1000);
    }
  }
});

window.addEventListener('contextmenu', e => e.preventDefault());

// ═══════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════
async function init() {
  const b = await window.skyalert.getScreenBounds();
  workArea = b.workArea; scaleFactor = b.scaleFactor;
  dogScreenX = workArea.width / 2;
  dogScreenY = workArea.height - WIN_H;
  decide();
  requestAnimationFrame(loop);
  window.skyalert.setPetMouseIgnore(true);

  // Global eye tracking
  if (window.skyalert.onGlobalMouseMove) {
    window.skyalert.onGlobalMouseMove((pt) => {
      const windowLeft = workArea.x + dogScreenX - (WIN_W / 2);
      const windowTop = workArea.y + dogScreenY;
      mouseCanvasX = pt.x - windowLeft;
      mouseCanvasY = pt.y - windowTop;
    });
  }
}
init();
