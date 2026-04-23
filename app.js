let beat, bass;
let beatGain, bassGain;
let reverb, reverbSend;

let sfxGain, sfxFilter, sfxReverb;
let capOpen, splat, squeeze, stir;

/* =========================
   GESTURE STATE
========================= */

let lastGesture = null;
let pendingGesture = null;
let pendingCount = 0;
const STABLE_FRAMES = 2;

let audioReady = false;
let isPlaying  = false;

/* =========================
   HELPERS
========================= */

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function triggerOneShot(name, player) {
  player.stop();
  player.start();
  flashButton(name);
  spawnShockwave(name);
  console.log("TRIGGER:", name);
}

const FINGERS = {
  index:  [5,  6,  8],
  middle: [9,  10, 12],
  ring:   [13, 14, 16],
  pinky:  [17, 18, 20],
};

function fingerIsExtended(hand, [, pip, tip]) {
  const wrist = hand[0];
  return distance(hand[tip], wrist) > distance(hand[pip], wrist) * 1.05;
}

function fingerIsCurled(hand, [, pip, tip]) {
  const wrist = hand[0];
  return distance(hand[tip], wrist) < distance(hand[pip], wrist) * 0.95;
}

function detectGesture(hand) {
  const indexOut  = fingerIsExtended(hand, FINGERS.index);
  const middleOut = fingerIsExtended(hand, FINGERS.middle);
  const ringOut   = fingerIsExtended(hand, FINGERS.ring);
  const pinkyOut  = fingerIsExtended(hand, FINGERS.pinky);

  const indexIn  = fingerIsCurled(hand, FINGERS.index);
  const middleIn = fingerIsCurled(hand, FINGERS.middle);
  const ringIn   = fingerIsCurled(hand, FINGERS.ring);
  const pinkyIn  = fingerIsCurled(hand, FINGERS.pinky);

  const handSize = distance(hand[0], hand[9]);
  const pinchDist = distance(hand[4], hand[8]) / handSize;

  const indexClearlyOut =
    distance(hand[8], hand[0]) > distance(hand[6], hand[0]) * 1.3;

  if (pinchDist < 0.7 && indexClearlyOut && middleIn && ringIn && pinkyIn) return "SQUEEZE";
  if (pinchDist > 0.7 && indexClearlyOut && middleIn && ringIn && pinkyIn) return "STIR";
  if (indexOut && middleOut && ringOut && pinkyOut) return "SPLAT";
  if (indexIn && middleIn && ringIn && pinkyIn) return "CAP";
  return null;
}

/* =========================
   BUTTON GLOW
========================= */

const SFX_BUTTONS = {
  CAP:     document.getElementById("capBtn"),
  SPLAT:   document.getElementById("splatBtn"),
  SQUEEZE: document.getElementById("squeezeBtn"),
  STIR:    document.getElementById("stirBtn"),
};

function flashButton(name) {
  const btn = SFX_BUTTONS[name];
  if (!btn) return;
  btn.classList.remove("active");
  void btn.offsetWidth;
  btn.classList.add("active");
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => btn.classList.remove("active"), 350);
}

/* =========================
   HAND SKELETON + DEBUG HUD
========================= */

const overlay    = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const debugEl    = document.getElementById("debug");

function drawHands(results) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  if (!results?.multiHandLandmarks?.length) return;

  for (const landmarks of results.multiHandLandmarks) {
    drawConnectors(overlayCtx, landmarks, HAND_CONNECTIONS, {
      color: "#ff0",
      lineWidth: 3,
    });
    drawLandmarks(overlayCtx, landmarks, {
      color: "#ff0",
      lineWidth: 1,
      radius: 3,
    });
  }
}

function showDebug(hand, gesture) {
  if (!debugEl) return;
  if (!hand) { debugEl.textContent = "no left hand"; return; }

  const f = (name) => {
    const out = fingerIsExtended(hand, FINGERS[name]);
    const inn = fingerIsCurled(hand,   FINGERS[name]);
    return `${name.padEnd(6)}: ${out ? "OUT" : inn ? "IN " : "..."}`;
  };
  const handSize = distance(hand[0], hand[9]);
  const pinch = (distance(hand[4], hand[8]) / handSize).toFixed(2);

  debugEl.textContent =
    `gesture: ${gesture ?? "—"}  [${isPlaying ? "PLAYING" : "PAUSED"}]\n` +
    f("index")  + "\n" +
    f("middle") + "\n" +
    f("ring")   + "\n" +
    f("pinky")  + "\n" +
    `pinch dist: ${pinch}`;
}

/* =========================
   AUDIO START / PLAY-PAUSE
========================= */

const startBtn = document.getElementById("start");

function togglePlay() {
  if (!audioReady) return;
  if (isPlaying) {
    Tone.Transport.pause();
    isPlaying = false;
    startBtn.textContent = "▶ Play (Space)";
    console.log("TRANSPORT: pause");
  } else {
    Tone.Transport.start();
    isPlaying = true;
    startBtn.textContent = "⏸ Pause (Space)";
    console.log("TRANSPORT: start");
  }
}

async function initAudio() {
  if (audioReady) return;
  await Tone.start();

  // --- SFX BUS ---
  sfxGain   = new Tone.Gain(0.9);
  sfxFilter = new Tone.Filter(12000, "lowpass");
  sfxReverb = new Tone.Reverb({ decay: 6, wet: 0.4 });
  sfxGain.connect(sfxFilter);
  sfxFilter.connect(sfxReverb);
  sfxReverb.toDestination();

  // --- FX SEND ---
  reverb     = new Tone.Reverb(8).toDestination();
  reverbSend = new Tone.Gain(0.3).connect(reverb);

  // --- LOOPS ---
  beat = new Tone.Player("assets/sounds/beat.wav").sync().start(0);
  bass = new Tone.Player("assets/sounds/bass.wav").sync().start(0);
  beat.loop = true;
  bass.loop = true;

  beatGain = new Tone.Gain(0.8).toDestination();
  bassGain = new Tone.Gain(0.8).toDestination();
  beat.connect(beatGain);
  bass.connect(bassGain);
  beatGain.connect(reverbSend);
  bassGain.connect(reverbSend);

  // --- ONE SHOTS ---
  capOpen = new Tone.Player("assets/sounds/mayo_cap_open.wav").connect(sfxGain);
  splat   = new Tone.Player("assets/sounds/mayo_splat.wav").connect(sfxGain);
  splat.volume.value = 10;   // boost splat
  squeeze = new Tone.Player("assets/sounds/mayo_squeeze.wav").connect(sfxGain);
  stir    = new Tone.Player("assets/sounds/mayo_stir.wav").connect(sfxGain);

  // --- ANALYSERS ---
  analyser = new Tone.Analyser("waveform", 256);
  Tone.Destination.connect(analyser);

  bassAnalyser = new Tone.Analyser("waveform", 256);
  bassGain.connect(bassAnalyser);

  await Tone.loaded();
  audioReady = true;
}

startBtn.onclick = async () => {
  await initAudio();
  togglePlay();
};

document.addEventListener("keydown", async (e) => {
  if (e.code !== "Space") return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  e.preventDefault();
  await initAudio();
  togglePlay();
});

/* =========================
   PLAYER LOOKUP
========================= */

const PLAYERS = {
  CAP:     () => capOpen,
  SPLAT:   () => splat,
  SQUEEZE: () => squeeze,
  STIR:    () => stir,
};

/* =========================
   SLIDERS
========================= */

const beatSliderEl   = document.getElementById("beatSlider");
const bassSliderEl   = document.getElementById("bassSlider");
const reverbSliderEl = document.getElementById("reverbSlider");

if (beatSliderEl)   beatSliderEl.oninput   = e => beatGain   && (beatGain.gain.value   = +e.target.value);
if (bassSliderEl)   bassSliderEl.oninput   = e => bassGain   && (bassGain.gain.value   = +e.target.value);
if (reverbSliderEl) reverbSliderEl.oninput = e => reverbSend && (reverbSend.gain.value = +e.target.value);

/* =========================
   MEDIAPIPE HANDS
========================= */

const hands = new Hands({
  locateFile: file =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 0,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

hands.onResults((results) => {
  drawHands(results);

  if (!results?.multiHandLandmarks?.length) {
    lastGesture = null;
    pendingGesture = null;
    pendingCount = 0;
    showDebug(null, null);
    palmScreen = null;
    return;
  }

  let rightHand = null;
  let leftHand  = null;

  for (let i = 0; i < results.multiHandLandmarks.length; i++) {
    const label = results.multiHandedness[i].label;
    if (label === "Right") leftHand  = results.multiHandLandmarks[i];
    if (label === "Left")  rightHand = results.multiHandLandmarks[i];
  }

  if (rightHand && beatGain && bassGain && reverbSend && sfxFilter) {
    const palmX = rightHand[9].x;
    const palmY = rightHand[9].y;

    beatGain.gain.value = 1 - palmX;
    bassGain.gain.value = palmX;
    reverbSend.gain.value = 1 - palmY;
    sfxFilter.frequency.value = palmY < 0.4 ? 12000 : 800;

    updateCrossfade(palmX);
    palmScreen = {
      x: (1 - palmX) * window.innerWidth,
      y: palmY * window.innerHeight,
    };
  }

  if (leftHand) {
    const gesture = detectGesture(leftHand);
    showDebug(leftHand, gesture);

    if (gesture === pendingGesture) {
      pendingCount++;
    } else {
      pendingGesture = gesture;
      pendingCount = 1;
    }

    if (
      pendingCount === STABLE_FRAMES &&
      pendingGesture &&
      pendingGesture !== lastGesture
    ) {
      lastGesture = pendingGesture;
      const player = PLAYERS[pendingGesture]?.();
      if (player?.loaded) triggerOneShot(pendingGesture, player);
    }
  } else {
    showDebug(null, null);
    lastGesture = null;
    pendingGesture = null;
    pendingCount = 0;
  }
});

/* =========================
   CAMERA
========================= */

async function startCamera() {
  const video = document.getElementById("video");
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await video.play();

  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 640,
    height: 480,
  });

  camera.start();
}

startCamera();

/* =========================
   ===  VISUAL EFFECTS  ===
========================= */

let analyser;
let bassAnalyser;
let lastBeatLevel = 0;
let palmScreen = null;

const fx = document.getElementById("fxCanvas");
const fxCtx = fx.getContext("2d");
function resizeFx() { fx.width = window.innerWidth; fx.height = window.innerHeight; }
resizeFx();
window.addEventListener("resize", resizeFx);

const bgGlow    = document.getElementById("bgGlow");
const beatFlash = document.getElementById("beatFlash");
const xfadeFill = document.getElementById("xfadeFill");

function updateCrossfade(palmX) {
  const pct = (1 - palmX) * 100;
  xfadeFill.style.left = `${Math.max(0, Math.min(100, pct))}%`;
}

/* ----- Hand trail ----- */
const trail = [];
const TRAIL_MAX = 28;
function pushTrail() {
  if (!palmScreen) return;
  trail.push({ x: palmScreen.x, y: palmScreen.y, life: 1 });
  if (trail.length > TRAIL_MAX) trail.shift();
}
function drawTrail() {
  for (const p of trail) {
    p.life *= 0.92;
    const r = 14 * p.life + 2;
    fxCtx.beginPath();
    fxCtx.fillStyle = `rgba(70,135,255,${0.5 * p.life})`;
    fxCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    fxCtx.fill();
  }
}

/* ----- 3D Expanding Rings (one-shots) ----- */
const shockwaves = [];

function spawnShockwave(gestureName) {
  const cx = window.innerWidth  / 2;
  const cy = window.innerHeight / 2;

  const colorRGB = (gestureName && GESTURE_COLOR[gestureName])
    ? GESTURE_COLOR[gestureName]
    : GESTURE_COLOR.IDLE;

  // emit 3 rings staggered in time for a "3D stack" effect
  for (let i = 0; i < 3; i++) {
    shockwaves.push({
      x: cx,
      y: cy,
      r: 10,
      alpha: 1,
      color: colorRGB,
      delay: i * 6,
      tilt: 0.35 + i * 0.05,
      speed: 14 + i * 2,
      thickness: 5 - i,
    });
  }
}

function drawShockwaves() {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];

    if (s.delay > 0) { s.delay--; continue; }

    s.r     += s.speed;
    s.alpha *= 0.95;
    s.speed *= 0.99;

    const [r, g, b] = s.color;

    // outer soft glow ring
    fxCtx.strokeStyle = `rgba(${r},${g},${b},${s.alpha * 0.35})`;
    fxCtx.lineWidth   = s.thickness + 6;
    fxCtx.shadowColor = `rgba(${r},${g},${b},${s.alpha})`;
    fxCtx.shadowBlur  = 25;
    fxCtx.beginPath();
    fxCtx.ellipse(s.x, s.y, s.r, s.r * s.tilt, 0, 0, Math.PI * 2);
    fxCtx.stroke();

    // crisp inner ring
    fxCtx.strokeStyle = `rgba(${r},${g},${b},${s.alpha})`;
    fxCtx.lineWidth   = s.thickness;
    fxCtx.shadowBlur  = 12;
    fxCtx.beginPath();
    fxCtx.ellipse(s.x, s.y, s.r, s.r * s.tilt, 0, 0, Math.PI * 2);
    fxCtx.stroke();

    fxCtx.shadowBlur = 0;

    if (s.alpha < 0.02) shockwaves.splice(i, 1);
  }
}

/* ----- Particle field ----- */
const PARTICLE_COUNT = 90;
const particles = [];
for (let i = 0; i < PARTICLE_COUNT; i++) {
  particles.push({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: 0, vy: 0,
  });
}
function updateParticles() {
  for (const p of particles) {
    if (palmScreen) {
      const dx = p.x - palmScreen.x;
      const dy = p.y - palmScreen.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < 200*200 && d2 > 1) {
        const f = 600 / d2;
        p.vx += dx * f * 0.02;
        p.vy += dy * f * 0.02;
      }
    }
    p.vx *= 0.92; p.vy *= 0.92;
    p.x  += p.vx; p.y  += p.vy;
    if (p.x < 0) p.x += window.innerWidth;
    if (p.x > window.innerWidth) p.x -= window.innerWidth;
    if (p.y < 0) p.y += window.innerHeight;
    if (p.y > window.innerHeight) p.y -= window.innerHeight;

    fxCtx.beginPath();
    fxCtx.fillStyle = "rgba(70,135,255,0.55)";
    fxCtx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
    fxCtx.fill();
  }
}

/* ----- Audio loudness → background glow + beat flash ----- */
function readLoudness() {
  if (!analyser) return 0;
  const buf = analyser.getValue();
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}
function readBassLevel() {
  if (!bassAnalyser) return 0;
  const buf = bassAnalyser.getValue();
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}
let bassSmoothed = 0;
function updateAudioVisuals() {
  const level = readLoudness();
  document.documentElement.style.setProperty("--glow", level.toFixed(3));
  if (level - lastBeatLevel > 0.18) {
    beatFlash.style.opacity = "0.18";
    setTimeout(() => { beatFlash.style.opacity = "0"; }, 60);
  }
  lastBeatLevel = lastBeatLevel * 0.85 + level * 0.15;

  bassSmoothed = bassSmoothed * 0.82 + readBassLevel() * 0.18;
}

/* ----- Parallax ----- */
function updateParallax() {
  if (!palmScreen) {
    document.body.style.backgroundPosition = "center";
    return;
  }
  const x = (palmScreen.x / window.innerWidth  - 0.5) * 30;
  const y = (palmScreen.y / window.innerHeight - 0.5) * 30;
  document.body.style.backgroundPosition =
    `calc(50% + ${-x}px) calc(50% + ${-y}px)`;
}

/* =========================
   ENERGY ORB ON PALM
========================= */

const GESTURE_COLOR = {
  CAP:     [255, 220, 70 ],
  SPLAT:   [255, 220, 70 ],
  SQUEEZE: [255, 220, 70 ],
  STIR:    [255, 220, 70 ],
  IDLE:    [70,  135, 255],
};
let orbPulse = 0;

function drawEnergyOrb() {
  if (!palmScreen) return;

  const reverbAmt = reverbSend ? reverbSend.gain.value : 0.3;
  const baseR = 30 + reverbAmt * 80;

  orbPulse = orbPulse * 0.85 + bassSmoothed * 0.15;
  const pulseR = baseR
    + Math.sin(performance.now() * 0.008) * 6
    + orbPulse * 90;

  const key = (lastGesture && GESTURE_COLOR[lastGesture]) ? lastGesture : "IDLE";
  const [r, g, b] = GESTURE_COLOR[key];

  const x = palmScreen.x;
  const y = palmScreen.y;

  const aura = fxCtx.createRadialGradient(x, y, pulseR * 0.2, x, y, pulseR * 2.2);
  aura.addColorStop(0,   `rgba(${r},${g},${b},0.55)`);
  aura.addColorStop(0.5, `rgba(${r},${g},${b},0.18)`);
  aura.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  fxCtx.fillStyle = aura;
  fxCtx.beginPath();
  fxCtx.arc(x, y, pulseR * 2.2, 0, Math.PI * 2);
  fxCtx.fill();

  const core = fxCtx.createRadialGradient(
    x - pulseR * 0.3, y - pulseR * 0.3, pulseR * 0.1,
    x, y, pulseR
  );
  core.addColorStop(0,   `rgba(255,255,255,0.95)`);
  core.addColorStop(0.4, `rgba(${r},${g},${b},0.85)`);
  core.addColorStop(1,   `rgba(${Math.floor(r*0.4)},${Math.floor(g*0.4)},${Math.floor(b*0.4)},0.7)`);
  fxCtx.fillStyle = core;
  fxCtx.beginPath();
  fxCtx.arc(x, y, pulseR, 0, Math.PI * 2);
  fxCtx.fill();

  fxCtx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
  fxCtx.lineWidth = 2;
  fxCtx.shadowColor = `rgba(${r},${g},${b},0.9)`;
  fxCtx.shadowBlur = 18 + orbPulse * 40;
  fxCtx.beginPath();
  fxCtx.arc(x, y, pulseR, 0, Math.PI * 2);
  fxCtx.stroke();
  fxCtx.shadowBlur = 0;
}

/* ----- Master FX loop ----- */
function fxLoop() {
  fxCtx.globalCompositeOperation = "destination-out";
  fxCtx.fillStyle = "rgba(0,0,0,0.12)";
  fxCtx.fillRect(0, 0, fx.width, fx.height);
  fxCtx.globalCompositeOperation = "source-over";

  pushTrail();
  drawTrail();
  updateParticles();
  drawShockwaves();
  drawEnergyOrb();
  updateAudioVisuals();
  updateParallax();

  requestAnimationFrame(fxLoop);
}
fxLoop();

/* =========================
   FULLSCREEN (no edits to your code)
========================= */

function enterFullscreen() {
  const el = document.documentElement;

  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.msRequestFullscreen) el.msRequestFullscreen();
}

// Runs alongside your existing start button
document.getElementById("start").addEventListener("click", () => {
  enterFullscreen();
});

// Runs alongside your existing Space bar control
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    enterFullscreen();
  }
});

// Optional: hide cursor when fullscreen
document.addEventListener("fullscreenchange", () => {
  document.body.style.cursor =
    document.fullscreenElement ? "none" : "default";
});