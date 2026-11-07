// ========================================================
// PUZZLE-CAM: Hand-Frame Capture & Gesture Puzzle
// ========================================================

const PHOTOBOOTH_NOISE_STD = 15;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// DOM Elements
const videoEl = document.getElementById("webcam");
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const statusBadge = document.getElementById("statusBadge");
const loadingOverlay = document.getElementById("loadingOverlay");
const loaderText = document.getElementById("loaderText");
const loaderRetry = document.getElementById("loaderRetry");
const errorBanner = document.getElementById("errorBanner");
const errorMessage = document.getElementById("errorMessage");
const progressBadge = document.getElementById("progressBadge");
const progressText = document.getElementById("progressText");

const galleryStrip = document.getElementById("galleryStrip");
const galleryEmpty = document.getElementById("galleryEmpty");
const galleryCount = document.getElementById("galleryCount");
const downloadStripBtn = document.getElementById("downloadStripBtn");
const resetAllBtn = document.getElementById("resetAllBtn");
const stripCompleteMsg = document.getElementById("stripCompleteMsg");
const filterBtn = document.getElementById("filterBtn");
const filterLabel = document.getElementById("filterLabel");

// Filter presets
const FILTERS = [
  { id: "noir", label: "NOIR FILM" },
  { id: "polaroid", label: "POLAROID 70s" },
  { id: "cyber", label: "CYBER NEON" }
];
let currentFilterIdx = 0;

if (filterBtn) {
  filterBtn.addEventListener("click", () => {
    currentFilterIdx = (currentFilterIdx + 1) % FILTERS.length;
    filterLabel.textContent = FILTERS[currentFilterIdx].label;
    playSound("snap");
  });
}

// Audio Context for Procedural SFX
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSound(type) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (type === "shutter") {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === "shatter") {
    // Noise burst for glass shatter
    const bufferSize = audioCtx.sampleRate * 0.25;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.05));
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(now);
  } else if (type === "snap") {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.07);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } else if (type === "spark") {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } else if (type === "beep") {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(750, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } else if (type === "complete") {
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + idx * 0.08;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  }
}

// State Machine: "tracking" | "shatter" | "puzzle" | "saving"
let appState = "tracking";

// Hand Framing State
const frameState = {
  activeBox: null,
  holdStart: 0,
  holdDuration: 1300, // hold steady for 1.3s to snap
  flashOpacity: 0,
  countdownStep: 0,
};

// Puzzle State
const puzzle = {
  boardBox: null,
  pieces: [],
  solved: false,
  tileW: 0,
  tileH: 0,
  cols: 3,
  rows: 3,
  capturedCanvas: null,
  draggedPiece: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  startTime: 0,
  finalSolveTime: 0,
  swapCount: 0,
};

// Visual FX Particles (Sparks & Confetti)
const particles = [];

function spawnSparks(cx, cy) {
  initAudio();
  playSound("spark");
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 160;
    particles.push({
      type: "spark",
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: ["#facc15", "#22c55e", "#ffffff"][Math.floor(Math.random() * 3)],
      size: 2 + Math.random() * 3,
      life: 1.0,
      decay: 1.8 + Math.random() * 0.8,
    });
  }
}

function spawnConfetti(box) {
  for (let i = 0; i < 85; i++) {
    particles.push({
      type: "confetti",
      x: box.x + Math.random() * box.w,
      y: box.y + Math.random() * 80,
      vx: (Math.random() - 0.5) * 320,
      vy: -220 - Math.random() * 220,
      w: 8 + Math.random() * 8,
      h: 5 + Math.random() * 6,
      color: ["#facc15", "#22c55e", "#ec4899", "#06b6d4", "#ffffff"][Math.floor(Math.random() * 5)],
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 10,
      life: 1.0,
      decay: 0.35 + Math.random() * 0.25,
    });
  }
}

function updateAndDrawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= p.decay * dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 380 * dt; // gravity

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.type === "spark") {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "confetti") {
      p.rot += p.rotSpeed * dt;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
}

// Shatter Effect State
const SHATTER_COLS = 6;
const SHATTER_ROWS = 6;
const SHATTER_DURATION_MS = 850;
const shatter = {
  active: false,
  startedAt: 0,
  fragments: [],
};

// Fist Save Gesture Detection
const fistState = {
  detectedStart: 0,
  requiredHold: 500, // 0.5s fist to save
};

// Gallery Photos Strip
const MAX_STRIP_PHOTOS = 3;
const completedPhotos = [];

// Pointer & Hand Detection Cache
let currentHandLandmarks = [];
let pinchPosition = null; // { x, y, isPinching: boolean, handIndex: number }
let isFistActive = false;

// Mouse Fallback for testing without camera gestures
let mousePos = { x: 0, y: 0, isDown: false };
let isMouseDown = false;

// ========================================================
// 1. MediaPipe Setup & Camera Initialization
// ========================================================
let hands = null;
let isProcessingFrame = false;

async function setupCameraAndMediaPipe() {
  // Check if opened via file:// protocol
  if (window.location.protocol === "file:") {
    loaderText.innerHTML = `
      <div style="max-width: 460px; line-height: 1.6; color: #f87171; text-align: center;">
        <strong style="font-size: 15px; color: #fef08a;">⚠️ Protocolo file:// detectado</strong><br><br>
        Por políticas de seguridad, los navegadores (Chrome/Edge) <strong>bloquean la cámara y MediaPipe</strong> cuando se abre el archivo directamente.<br><br>
        <span style="color: #ffffff;">👉 <strong>Solución rápida:</strong></span><br>
        Haz doble clic en <strong>start.bat</strong> en la carpeta del proyecto, o ejecuta:<br>
        <code style="background: rgba(255,255,255,0.15); padding: 4px 8px; border-radius: 4px; color: #facc15; display: inline-block; margin-top: 6px;">python -m http.server 8000</code><br><br>
        Luego abre en tu navegador: <br>
        <a href="http://localhost:8000" style="color: #60a5fa; text-decoration: underline; font-weight: bold;">http://localhost:8000</a>
      </div>
    `;
    loaderRetry.classList.add("hidden");
    showError("Abre la aplicación desde http://localhost:8000 (ejecuta start.bat)");
    return;
  }

  loaderText.textContent = "Solicitando acceso a la cámara...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        facingMode: "user",
      },
      audio: false,
    });
    videoEl.srcObject = stream;
    videoEl.muted = true;
    await videoEl.play();

    // Adjust canvas resolution to webcam
    canvas.width = videoEl.videoWidth || 1280;
    canvas.height = videoEl.videoHeight || 720;

    loaderText.textContent = "Cargando modelos de MediaPipe Hands...";

    if (typeof Hands === "undefined") {
      throw new Error("No se pudo cargar la librería MediaPipe Hands desde el CDN.");
    }

    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onHandResults);

    // 1. Independent continuous render loop (never black screen)
    function renderLoop() {
      renderFrame();
      requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    // 2. Continuous tracking loop for MediaPipe
    async function trackingLoop() {
      if (videoEl.readyState >= 2 && !isProcessingFrame) {
        isProcessingFrame = true;
        try {
          await hands.send({ image: videoEl });
        } catch (e) {
          console.warn("MediaPipe frame skip:", e);
        }
        isProcessingFrame = false;
      }
      requestAnimationFrame(trackingLoop);
    }
    requestAnimationFrame(trackingLoop);

    loadingOverlay.classList.add("hidden");
    updateStatus("MANOS EN SEGUIMIENTO", "active");
  } catch (err) {
    console.error("Camera/MediaPipe error:", err);
    loaderText.innerHTML = `
      <div style="max-width: 440px; line-height: 1.5; text-align: center;">
        <span style="color: #f87171; font-weight: bold;">Error al acceder a la cámara o cargar MediaPipe:</span><br>
        ${err.message || err.name || "Permiso denegado"}<br><br>
        <span style="color: #9ca3af; font-size: 11px;">Asegúrate de permitir el acceso a la cámara en el icono del candado en la barra del navegador.</span>
      </div>
    `;
    loaderRetry.classList.remove("hidden");
    showError("Permiso de cámara denegado o error de inicialización.");
  }
}

function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.classList.remove("hidden");
  setTimeout(() => errorBanner.classList.add("hidden"), 4000);
}

function updateStatus(text, badgeType = "") {
  statusText.textContent = text;
  statusBadge.className = `badge status-badge ${badgeType}`;
}

// ========================================================
// 2. Gesture Recognizers (Pinch & Fist)
// ========================================================
function detectGestures(landmarksList) {
  pinchPosition = null;
  isFistActive = false;

  if (!landmarksList || landmarksList.length === 0) return;

  landmarksList.forEach((landmarks) => {
    // MediaPipe landmark coordinates are normalized [0, 1]
    // Because webcam is mirrored horizontally, we mirror landmark X
    const getPt = (idx) => ({
      x: (1.0 - landmarks[idx].x) * canvas.width,
      y: landmarks[idx].y * canvas.height,
    });

    const thumbTip = getPt(4);
    const indexTip = getPt(8);
    const middleTip = getPt(12);
    const ringTip = getPt(16);
    const pinkyTip = getPt(20);

    const indexPip = getPt(6);
    const middlePip = getPt(10);
    const ringPip = getPt(14);
    const pinkyPip = getPt(18);
    const wrist = getPt(0);

    // 1. PINCH: Normalized by Palm Scale (Adapts to any distance from webcam!)
    const middleMcp = getPt(9);
    const palmScale = Math.max(35, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));
    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    const pinchRatio = pinchDist / palmScale;

    const grabRatio = 0.28;
    const releaseRatio = 0.44;

    let isPinching = pinchPosition ? pinchPosition.isPinching : false;
    if (isPinching) {
      if (pinchRatio > releaseRatio) isPinching = false;
    } else {
      if (pinchRatio < grabRatio) isPinching = true;
    }

    const targetX = isPinching ? (thumbTip.x + indexTip.x) / 2 : indexTip.x;
    const targetY = isPinching ? (thumbTip.y + indexTip.y) / 2 : indexTip.y;

    if (!pinchPosition) {
      pinchPosition = { x: targetX, y: targetY, isPinching };
    } else {
      // Dynamic Velocity Cursor: zero lag when moving, smooth when still
      const dx = targetX - pinchPosition.x;
      const dy = targetY - pinchPosition.y;
      const spd = Math.hypot(dx, dy);
      const alpha = Math.min(0.95, Math.max(0.55, spd / 22));
      pinchPosition.x += dx * alpha;
      pinchPosition.y += dy * alpha;
      pinchPosition.isPinching = isPinching;
    }

    // 2. FIST: Tips curled below their PIP joints relative to wrist distance
    const distToWrist = (pt) => Math.hypot(pt.x - wrist.x, pt.y - wrist.y);
    const isFingerCurled = (tip, pip) => distToWrist(tip) < distToWrist(pip) * 1.15;

    const fistFingersCurled =
      isFingerCurled(indexTip, indexPip) &&
      isFingerCurled(middleTip, middlePip) &&
      isFingerCurled(ringTip, ringPip) &&
      isFingerCurled(pinkyTip, pinkyPip);

    if (fistFingersCurled) {
      isFistActive = true;
    }
  });
}

// Compute Framing Box when both hands are visible
function computeFramingBox(landmarksList) {
  if (!landmarksList || landmarksList.length < 2) {
    // If only one hand, allow framing between thumb and index as fallback
    if (landmarksList && landmarksList.length === 1) {
      const lm = landmarksList[0];
      const p4 = { x: (1.0 - lm[4].x) * canvas.width, y: lm[4].y * canvas.height };
      const p8 = { x: (1.0 - lm[8].x) * canvas.width, y: lm[8].y * canvas.height };
      const dist = Math.hypot(p4.x - p8.x, p4.y - p8.y);
      if (dist > canvas.width * 0.2) {
        const minX = Math.min(p4.x, p8.x);
        const maxX = Math.max(p4.x, p8.x);
        const minY = Math.min(p4.y, p8.y);
        const maxY = Math.max(p4.y, p8.y);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
    }
    return null;
  }

  // 2 Hands: Find box spanning both hands
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  landmarksList.forEach((landmarks) => {
    // Key framing points: Index tip (8), Thumb tip (4), Wrist (0)
    [0, 4, 8, 12].forEach((idx) => {
      const px = (1.0 - landmarks[idx].x) * canvas.width;
      const py = landmarks[idx].y * canvas.height;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    });
  });

  const w = maxX - minX;
  const h = maxY - minY;

  // Minimum required framing dimension
  if (w < canvas.width * 0.18 || h < canvas.height * 0.18) {
    return null;
  }

  // Add padding
  const padX = w * 0.08;
  const padY = h * 0.08;
  return {
    x: Math.max(10, minX - padX),
    y: Math.max(10, minY - padY),
    w: Math.min(canvas.width - 20, w + padX * 2),
    h: Math.min(canvas.height - 20, h + padY * 2),
  };
}

// ========================================================
// 3. MediaPipe Results Callback & Main Render Loop
// ========================================================
function onHandResults(results) {
  currentHandLandmarks = results.multiHandLandmarks || [];
  detectGestures(currentHandLandmarks);
}

function renderFrame() {
  // Sync canvas size with video resolution dynamically
  if (videoEl.videoWidth && canvas.width !== videoEl.videoWidth) {
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
  }

  const width = canvas.width;
  const height = canvas.height;

  ctx.save();
  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // 1. Draw webcam mirrored horizontally if video has data
  if (videoEl.readyState >= 2) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, -width, 0, width, height);
    ctx.restore();
  }

  // Subtle dark vignette/overlay
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  ctx.fillRect(0, 0, width, height);

  // 2. Draw Hand Skeletons
  drawHandSkeletons(currentHandLandmarks);

  // 3. State-specific logic
  const now = performance.now();

  if (appState === "tracking") {
    handleTrackingMode(now);
  } else if (appState === "shatter") {
    handleShatterMode(now);
  } else if (appState === "puzzle") {
    handlePuzzleMode(now);
  }

  // 4. Shutter flash effect
  if (frameState.flashOpacity > 0.01) {
    ctx.fillStyle = `rgba(255, 255, 255, ${frameState.flashOpacity})`;
    ctx.fillRect(0, 0, width, height);
    frameState.flashOpacity *= 0.82;
  }

  // 5. Update & Draw Particles (Sparks & Confetti)
  updateAndDrawParticles(0.016);

  // 6. Draw Pinch / Cursor Pointer
  drawCursor();

  ctx.restore();
}

// ========================================================
// 4. Mode 1: Tracking & Hand-Framing Capture
// ========================================================
function handleTrackingMode(now) {
  const box = computeFramingBox(currentHandLandmarks);

  if (box) {
    frameState.activeBox = box;
    if (frameState.holdStart === 0) {
      frameState.holdStart = now;
      frameState.countdownStep = 0;
    }
    const elapsed = now - frameState.holdStart;
    const progress = Math.min(1.0, elapsed / frameState.holdDuration);

    const step = Math.floor(progress * 3);
    if (step > frameState.countdownStep) {
      frameState.countdownStep = step;
      playSound("beep");
    }

    drawFramingBox(box, progress);
    updateStatus(`ENCADRANDO... (${Math.round(progress * 100)}%)`, "active");

    // Capture triggered!
    if (progress >= 1.0) {
      captureAndShatter(box);
      frameState.countdownStep = 0;
    }
  } else {
    frameState.holdStart = 0;
    frameState.countdownStep = 0;
    if (currentHandLandmarks.length > 0) {
      updateStatus("FORMA UN MARCO CON TUS MANOS", "active");
    } else {
      updateStatus("MANOS EN SEGUIMIENTO", "");
    }
  }
}

function drawFramingBox(box, progress) {
  ctx.save();
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 3;
  ctx.shadowColor = "#facc15";
  ctx.shadowBlur = 12;

  // Outer rectangle
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  // Corner Accents
  const cornerLen = Math.min(box.w, box.h) * 0.15;
  ctx.lineWidth = 5;
  ctx.beginPath();
  // Top Left
  ctx.moveTo(box.x, box.y + cornerLen);
  ctx.lineTo(box.x, box.y);
  ctx.lineTo(box.x + cornerLen, box.y);
  // Top Right
  ctx.moveTo(box.x + box.w - cornerLen, box.y);
  ctx.lineTo(box.x + box.w, box.y);
  ctx.lineTo(box.x + box.w, box.y + cornerLen);
  // Bottom Left
  ctx.moveTo(box.x, box.y + box.h - cornerLen);
  ctx.lineTo(box.x, box.y + box.h);
  ctx.lineTo(box.x + cornerLen, box.y + box.h);
  // Bottom Right
  ctx.moveTo(box.x + box.w - cornerLen, box.y + box.h);
  ctx.lineTo(box.x + box.w, box.y + box.h);
  ctx.lineTo(box.x + box.w, box.y + box.h - cornerLen);
  ctx.stroke();

  // Progress Loading Ring in center
  if (progress > 0) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const radius = 28;

    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#facc15";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }

  ctx.restore();
}

function captureAndShatter(box) {
  initAudio();
  playSound("shutter");
  frameState.flashOpacity = 1.0;

  // Make box square or 4:3 for clean puzzle tiles
  const size = Math.min(box.w, box.h);
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const squareBox = {
    x: Math.max(0, centerX - size / 2),
    y: Math.max(0, centerY - size / 2),
    w: size,
    h: size,
  };

  // Crop framed image from mirrored canvas
  const offscreen = document.createElement("canvas");
  offscreen.width = squareBox.w;
  offscreen.height = squareBox.h;
  const offCtx = offscreen.getContext("2d");

  // Mirror draw the webcam portion
  offCtx.save();
  offCtx.translate(offscreen.width, 0);
  offCtx.scale(-1, 1);
  const mirroredSourceX = canvas.width - (squareBox.x + squareBox.w);
  offCtx.drawImage(
    videoEl,
    mirroredSourceX, squareBox.y, squareBox.w, squareBox.h,
    0, 0, squareBox.w, squareBox.h
  );
  offCtx.restore();

  puzzle.capturedCanvas = offscreen;
  puzzle.boardBox = squareBox;

  // Setup Shatter Fragments (6x6 Grid = 36 pieces)
  setupShatterFragments(offscreen, squareBox);
  appState = "shatter";
  shatter.startedAt = performance.now();
  playSound("shatter");
  updateStatus("¡SHATTER!", "");
}

// ========================================================
// 5. Mode 2: Shatter Explosion Animation
// ========================================================
function setupShatterFragments(sourceCanvas, box) {
  shatter.fragments = [];
  const colW = box.w / SHATTER_COLS;
  const rowH = box.h / SHATTER_ROWS;

  for (let r = 0; r < SHATTER_ROWS; r++) {
    for (let c = 0; c < SHATTER_COLS; c++) {
      const sx = c * colW;
      const sy = r * rowH;

      // Extract fragment slice
      const fragCanvas = document.createElement("canvas");
      fragCanvas.width = colW;
      fragCanvas.height = rowH;
      const fctx = fragCanvas.getContext("2d");
      fctx.drawImage(sourceCanvas, sx, sy, colW, rowH, 0, 0, colW, rowH);

      // Random explosion velocity
      const angle = Math.atan2((r - SHATTER_ROWS / 2), (c - SHATTER_COLS / 2)) + (Math.random() - 0.5);
      const speed = 250 + Math.random() * 450;

      shatter.fragments.push({
        img: fragCanvas,
        origX: box.x + sx,
        origY: box.y + sy,
        x: box.x + sx,
        y: box.y + sy,
        w: colW,
        h: rowH,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100, // slight upward kick
        rot: 0,
        rotSpeed: (Math.random() - 0.5) * 8,
        scale: 1.0,
        opacity: 1.0,
      });
    }
  }
}

function handleShatterMode(now) {
  const elapsed = now - shatter.startedAt;
  const t = Math.min(1.0, elapsed / SHATTER_DURATION_MS);
  const dt = 0.016; // approximate dt per frame

  shatter.fragments.forEach((frag) => {
    frag.x += frag.vx * dt;
    frag.y += frag.vy * dt;
    frag.vy += 380 * dt; // gravity
    frag.rot += frag.rotSpeed * dt;
    frag.opacity = Math.max(0, 1.0 - t * 0.95);
    frag.scale = Math.max(0.4, 1.0 - t * 0.5);

    ctx.save();
    ctx.globalAlpha = frag.opacity;
    ctx.translate(frag.x + frag.w / 2, frag.y + frag.h / 2);
    ctx.rotate(frag.rot);
    ctx.scale(frag.scale, frag.scale);
    ctx.drawImage(frag.img, -frag.w / 2, -frag.h / 2, frag.w, frag.h);
    ctx.restore();
  });

  if (elapsed >= SHATTER_DURATION_MS) {
    // Transition to 3x3 Puzzle Mode
    initPuzzle();
    appState = "puzzle";
    progressBadge.classList.remove("hidden");
    updateStatus("ARMA EL ROMPECABEZAS CON PINCH", "active");
  }
}

// ========================================================
// 6. Mode 3: 3x3 Puzzle (Pinch to Drag & Swap)
// ========================================================
function initPuzzle() {
  const box = puzzle.boardBox;
  const tileW = box.w / puzzle.cols;
  const tileH = box.h / puzzle.rows;
  puzzle.tileW = tileW;
  puzzle.tileH = tileH;
  puzzle.solved = false;
  puzzle.draggedPiece = null;
  puzzle.startTime = performance.now();
  puzzle.finalSolveTime = 0;
  puzzle.swapCount = 0;
  particles.length = 0;

  // Create 9 pieces
  const pieces = [];
  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const idx = r * puzzle.cols + c;
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = tileW;
      tileCanvas.height = tileH;
      const tctx = tileCanvas.getContext("2d");
      tctx.drawImage(
        puzzle.capturedCanvas,
        c * tileW, r * tileH, tileW, tileH,
        0, 0, tileW, tileH
      );

      pieces.push({
        originalIndex: idx,
        currentSlot: idx,
        canvas: tileCanvas,
      });
    }
  }

  // Shuffle pieces
  shuffleArray(pieces);
  pieces.forEach((p, slot) => {
    p.currentSlot = slot;
  });

  // Ensure it's not solved initially
  if (pieces.every((p) => p.currentSlot === p.originalIndex)) {
    const temp = pieces[0].currentSlot;
    pieces[0].currentSlot = pieces[1].currentSlot;
    pieces[1].currentSlot = temp;
  }

  puzzle.pieces = pieces;
  checkPuzzleProgress();
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function getSlotBox(slotIndex) {
  const col = slotIndex % puzzle.cols;
  const row = Math.floor(slotIndex / puzzle.cols);
  return {
    x: puzzle.boardBox.x + col * puzzle.tileW,
    y: puzzle.boardBox.y + row * puzzle.tileH,
    w: puzzle.tileW,
    h: puzzle.tileH,
  };
}

function getSlotAtPos(x, y) {
  if (
    x < puzzle.boardBox.x ||
    x > puzzle.boardBox.x + puzzle.boardBox.w ||
    y < puzzle.boardBox.y ||
    y > puzzle.boardBox.y + puzzle.boardBox.h
  ) {
    return -1;
  }
  const col = Math.floor((x - puzzle.boardBox.x) / puzzle.tileW);
  const row = Math.floor((y - puzzle.boardBox.y) / puzzle.tileH);
  if (col >= 0 && col < puzzle.cols && row >= 0 && row < puzzle.rows) {
    return row * puzzle.cols + col;
  }
  return -1;
}

function checkPuzzleProgress() {
  const correctCount = puzzle.pieces.filter((p) => p.currentSlot === p.originalIndex).length;
  const elapsedSec = Math.floor(puzzle.solved ? puzzle.finalSolveTime : (performance.now() - puzzle.startTime) / 1000);
  progressText.textContent = `${correctCount} / 9 • ${elapsedSec}s • ${puzzle.swapCount} MOVES`;

  if (correctCount === 9 && !puzzle.solved) {
    puzzle.solved = true;
    puzzle.finalSolveTime = (performance.now() - puzzle.startTime) / 1000;
    playSound("complete");
    spawnConfetti(puzzle.boardBox);
    updateStatus("¡ROMPECABEZAS COMPLETO! CIERRA EL PUÑO PARA GUARDARLO", "complete");
  }
}

function handlePuzzleMode(now) {
  const box = puzzle.boardBox;
  const isPinching = (pinchPosition && pinchPosition.isPinching) || (isMouseDown);
  const cursorX = pinchPosition ? pinchPosition.x : mousePos.x;
  const cursorY = pinchPosition ? pinchPosition.y : mousePos.y;
  const hoverSlot = getSlotAtPos(cursorX, cursorY);

  // Live progress update with timer
  if (!puzzle.solved) {
    const correctCount = puzzle.pieces.filter((p) => p.currentSlot === p.originalIndex).length;
    const elapsedSec = Math.floor((now - puzzle.startTime) / 1000);
    progressText.textContent = `${correctCount} / 9 • ${elapsedSec}s • ${puzzle.swapCount} MOVES`;
  }

  // 1. Stable Pinch Drag & Drop
  if (!puzzle.solved) {
    if (isPinching) {
      if (!puzzle.draggedPiece) {
        // Grab tile under cursor
        if (hoverSlot !== -1) {
          const piece = puzzle.pieces.find((p) => p.currentSlot === hoverSlot);
          if (piece) {
            puzzle.draggedPiece = piece;
            const sBox = getSlotBox(hoverSlot);
            puzzle.dragOffsetX = cursorX - sBox.x;
            puzzle.dragOffsetY = cursorY - sBox.y;
            playSound("snap");
          }
        }
      }
    } else {
      // Released fingers -> Drop and Swap
      if (puzzle.draggedPiece) {
        const dropSlot = getSlotAtPos(cursorX, cursorY);
        if (dropSlot !== -1 && dropSlot !== puzzle.draggedPiece.currentSlot) {
          const targetPiece = puzzle.pieces.find((p) => p.currentSlot === dropSlot);
          if (targetPiece) {
            targetPiece.currentSlot = puzzle.draggedPiece.currentSlot;
          }
          puzzle.draggedPiece.currentSlot = dropSlot;
          puzzle.swapCount++;
          playSound("snap");

          // Spark particles if placed in correct position!
          if (puzzle.draggedPiece.currentSlot === puzzle.draggedPiece.originalIndex) {
            const sBox = getSlotBox(dropSlot);
            spawnSparks(sBox.x + sBox.w / 2, sBox.y + sBox.h / 2);
          }

          checkPuzzleProgress();
        }
        puzzle.draggedPiece = null;
      }
    }
  }

  // 2. Draw Board Background & Outlines
  ctx.save();
  ctx.strokeStyle = puzzle.solved ? "#22c55e" : "#facc15";
  ctx.lineWidth = puzzle.solved ? 5 : 3;
  ctx.shadowColor = puzzle.solved ? "#22c55e" : "#facc15";
  ctx.shadowBlur = puzzle.solved ? 20 : 8;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.restore();

  // 3. Draw Grid Slots & Tiles
  for (let slot = 0; slot < 9; slot++) {
    const sBox = getSlotBox(slot);

    // Slot border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sBox.x, sBox.y, sBox.w, sBox.h);

    const piece = puzzle.pieces.find((p) => p.currentSlot === slot);
    if (piece) {
      if (piece === puzzle.draggedPiece) {
        // Dimmed placeholder in original slot
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.drawImage(piece.canvas, sBox.x, sBox.y, sBox.w, sBox.h);
        ctx.strokeStyle = "#06b6d4";
        ctx.lineWidth = 1;
        ctx.strokeRect(sBox.x, sBox.y, sBox.w, sBox.h);
        ctx.restore();
      } else {
        ctx.drawImage(piece.canvas, sBox.x, sBox.y, sBox.w, sBox.h);
        ctx.strokeStyle = piece.currentSlot === piece.originalIndex ? "rgba(34, 197, 94, 0.4)" : "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sBox.x, sBox.y, sBox.w, sBox.h);
      }
    }

    // Highlight hovered target slot
    if (!puzzle.solved && slot === hoverSlot) {
      ctx.strokeStyle = puzzle.draggedPiece ? "#22c55e" : "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(sBox.x, sBox.y, sBox.w, sBox.h);
    }
  }

  // 4. Render Dragged Tile Floating on Top
  if (puzzle.draggedPiece && (pinchPosition || isMouseDown)) {
    const drawX = cursorX - puzzle.dragOffsetX;
    const drawY = cursorY - puzzle.dragOffsetY;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(puzzle.draggedPiece.canvas, drawX, drawY, puzzle.tileW, puzzle.tileH);
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 3;
    ctx.strokeRect(drawX, drawY, puzzle.tileW, puzzle.tileH);
    ctx.restore();
  }

  // 5. If Solved: Prompt & Fist Detection to Save
  if (puzzle.solved) {
    drawSolvedBanner(box);

    if (isFistActive) {
      if (fistState.detectedStart === 0) {
        fistState.detectedStart = now;
      }
      const holdTime = now - fistState.detectedStart;
      const progress = Math.min(1.0, holdTime / fistState.requiredHold);

      updateStatus(`GUARDANDO FOTO... (${Math.round(progress * 100)}%)`, "complete");

      if (progress >= 1.0) {
        saveSolvedPhotoToStrip();
      }
    } else {
      fistState.detectedStart = 0;
    }
  }
}

function drawSolvedBanner(box) {
  ctx.save();
  ctx.fillStyle = "rgba(10, 15, 20, 0.85)";
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;

  const bannerW = Math.min(box.w * 0.95, 480);
  const bannerH = 46;
  const bannerX = box.x + (box.w - bannerW) / 2;
  const bannerY = box.y + box.h + 16;

  // Draw pill banner
  roundRect(ctx, bannerX, bannerY, bannerW, bannerH, 8, true, true);

  ctx.fillStyle = "#86efac";
  ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("¡COMPLETO! — CIERRA EL PUÑO PARA GUARDARLO", bannerX + bannerW / 2, bannerY + bannerH / 2);
  ctx.restore();
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// ========================================================
// 7. Vintage Photobooth Filter & Strip Gallery
// ========================================================
function applyPhotoboothFilter(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  const octx = outCanvas.getContext("2d");

  // Draw base
  octx.drawImage(sourceCanvas, 0, 0);
  const imgData = octx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const filterType = FILTERS[currentFilterIdx].id;

  if (filterType === "noir") {
    // Noir Film: Grayscale + S-curve + Gaussian Film Grain
    const std = PHOTOBOOTH_NOISE_STD;
    for (let i = 0; i < data.length; i += 4) {
      let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      gray = ((gray / 255 - 0.5) * 1.3 + 0.5) * 255;
      const noise = (Math.random() - 0.5) * std * 2.5;
      gray = Math.max(0, Math.min(255, gray + noise));
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  } else if (filterType === "polaroid") {
    // 70s Polaroid: Warm amber/sepia tint, lifted shadows, soft grain
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 10;
      data[i] = Math.min(255, data[i] * 1.12 + 18 + noise);       // Red boost
      data[i + 1] = Math.min(255, data[i + 1] * 0.98 + 10 + noise); // Green
      data[i + 2] = Math.max(0, data[i + 2] * 0.86 + 12 + noise);   // Blue fade
    }
  } else if (filterType === "cyber") {
    // Cyberpunk Neon: High contrast, cyan shadows, magenta highlights
    for (let i = 0; i < data.length; i += 4) {
      let r = ((data[i] / 255 - 0.5) * 1.4 + 0.5) * 255 + 24;
      let g = ((data[i + 1] / 255 - 0.5) * 1.2 + 0.5) * 255 + 8;
      let b = ((data[i + 2] / 255 - 0.5) * 1.4 + 0.5) * 255 + 28;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
  }

  octx.putImageData(imgData, 0, 0);

  // Subtle vignette
  const grad = octx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.72);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.36)");
  octx.fillStyle = grad;
  octx.fillRect(0, 0, w, h);

  return outCanvas;
}

function saveSolvedPhotoToStrip() {
  playSound("shutter");
  frameState.flashOpacity = 1.0;

  // Process vintage photobooth look
  const filtered = applyPhotoboothFilter(puzzle.capturedCanvas);
  const dataUrl = filtered.toDataURL("image/jpeg", 0.92);
  const solveSec = Math.round(puzzle.finalSolveTime || (performance.now() - puzzle.startTime) / 1000);
  const scoreStr = `${solveSec}s • ${puzzle.swapCount} moves`;

  completedPhotos.push({
    dataUrl,
    timestamp: new Date().toLocaleDateString("en-GB").replace(/\//g, "."),
    id: `#00${completedPhotos.length + 1}`,
    scoreStr,
  });

  updateStripUI();

  // Reset to tracking for next capture
  progressBadge.classList.add("hidden");
  puzzle.pieces = [];
  puzzle.solved = false;
  fistState.detectedStart = 0;

  if (completedPhotos.length >= MAX_STRIP_PHOTOS) {
    stripCompleteMsg.classList.remove("hidden");
    downloadStripBtn.disabled = false;
    updateStatus("¡TIRA DE FOTOS COMPLETA!", "complete");
  } else {
    updateStatus("FOTO GUARDADA · ENCADRA LA SIGUIENTE", "active");
  }

  appState = "tracking";
}

function updateStripUI() {
  galleryCount.textContent = `${completedPhotos.length} / ${MAX_STRIP_PHOTOS}`;
  downloadStripBtn.disabled = completedPhotos.length === 0;

  if (completedPhotos.length > 0) {
    galleryEmpty.classList.add("hidden");
  } else {
    galleryEmpty.classList.remove("hidden");
    stripCompleteMsg.classList.add("hidden");
  }

  galleryStrip.innerHTML = "";
  completedPhotos.forEach((photo) => {
    const card = document.createElement("div");
    card.className = "strip-card";
    card.innerHTML = `
      <img src="${photo.dataUrl}" alt="Rompecabezas ${photo.id}">
      <div class="strip-card-footer">
        <span class="strip-card-id">${photo.id}</span>
        <span>${photo.scoreStr || ""}</span>
        <span>${photo.timestamp}</span>
      </div>
    `;
    galleryStrip.appendChild(card);
  });
}

// Download the vertical photobooth strip
downloadStripBtn.addEventListener("click", () => {
  if (completedPhotos.length === 0) return;

  const cardW = 600;
  const photoH = 450;
  const padding = 36;
  const headerH = 70;
  const footerH = 60;
  const totalH = headerH + completedPhotos.length * (photoH + padding) + footerH;

  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = cardW;
  stripCanvas.height = totalH;
  const sctx = stripCanvas.getContext("2d");

  // Classic photobooth white paper frame
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, cardW, totalH);

  // Top header branding
  sctx.fillStyle = "#1e293b";
  sctx.font = "bold 20px monospace";
  sctx.textAlign = "center";
  sctx.fillText("PUZZLE · CAM", cardW / 2, 44);

  // Photos
  let currentY = headerH;
  let loadedCount = 0;

  completedPhotos.forEach((photo, idx) => {
    const img = new Image();
    img.onload = () => {
      sctx.drawImage(img, padding, currentY + idx * (photoH + padding), cardW - padding * 2, photoH);

      // Subtle border around photo
      sctx.strokeStyle = "#e2e8f0";
      sctx.lineWidth = 2;
      sctx.strokeRect(padding, currentY + idx * (photoH + padding), cardW - padding * 2, photoH);

      loadedCount++;
      if (loadedCount === completedPhotos.length) {
        // Footer timestamp
        sctx.fillStyle = "#64748b";
        sctx.font = "14px monospace";
        sctx.textAlign = "center";
        const dateStr = new Date().toISOString().split("T")[0];
        sctx.fillText(`GESTURE PHOTOBOOTH • ${dateStr}`, cardW / 2, totalH - 24);

        // Download trigger
        const link = document.createElement("a");
        link.download = `puzzle-cam-strip-${Date.now()}.png`;
        link.href = stripCanvas.toDataURL("image/png");
        link.click();
      }
    };
    img.src = photo.dataUrl;
  });
});

resetAllBtn.addEventListener("click", () => {
  completedPhotos.length = 0;
  updateStripUI();
  appState = "tracking";
  puzzle.pieces = [];
  puzzle.solved = false;
  progressBadge.classList.add("hidden");
  updateStatus("MANOS EN SEGUIMIENTO", "active");
});

// ========================================================
// 8. Visual Helpers: Skeleton & Pointer Cursor
// ========================================================
function drawHandSkeletons(landmarksList) {
  if (!landmarksList) return;

  ctx.save();
  landmarksList.forEach((landmarks) => {
    const pts = landmarks.map((lm) => ({
      x: (1.0 - lm.x) * canvas.width,
      y: lm.y * canvas.height,
    }));

    // Bones (white lines with neon glow)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(255, 255, 255, 0.4)";
    ctx.shadowBlur = 6;

    HAND_CONNECTIONS.forEach(([i, j]) => {
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[j].x, pts[j].y);
      ctx.stroke();
    });

    // Joint landmarks
    ctx.fillStyle = "#facc15";
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = 8;
    pts.forEach((pt, idx) => {
      ctx.beginPath();
      const isFingertip = [4, 8, 12, 16, 20].includes(idx);
      ctx.arc(pt.x, pt.y, isFingertip ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  ctx.restore();
}

function drawCursor() {
  if (!pinchPosition && !isMouseDown) return;

  const x = pinchPosition ? pinchPosition.x : mousePos.x;
  const y = pinchPosition ? pinchPosition.y : mousePos.y;
  const isPinching = (pinchPosition && pinchPosition.isPinching) || isMouseDown;

  ctx.save();
  ctx.shadowColor = isPinching ? "#22c55e" : "#ffffff";
  ctx.shadowBlur = 10;

  // Outer cursor circle
  ctx.strokeStyle = isPinching ? "#22c55e" : "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, isPinching ? 14 : 9, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = isPinching ? "#22c55e" : "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, isPinching ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ========================================================
// 9. Mouse & Keyboard Fallback for Testing
// ========================================================
canvas.addEventListener("mousedown", (e) => {
  initAudio();
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  mousePos.x = (e.clientX - rect.left) * scaleX;
  mousePos.y = (e.clientY - rect.top) * scaleY;
  isMouseDown = true;
});

window.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  mousePos.x = (e.clientX - rect.left) * scaleX;
  mousePos.y = (e.clientY - rect.top) * scaleY;
});

window.addEventListener("mouseup", () => {
  isMouseDown = false;
});

// Spacebar manually snaps a photo in tracking mode or simulates fist save in solved mode
window.addEventListener("keydown", (e) => {
  initAudio();
  if (e.code === "Space") {
    if (appState === "tracking") {
      const defaultBox = {
        x: canvas.width * 0.25,
        y: canvas.height * 0.15,
        w: canvas.width * 0.5,
        h: canvas.height * 0.7,
      };
      captureAndShatter(frameState.activeBox || defaultBox);
    } else if (appState === "puzzle" && puzzle.solved) {
      saveSolvedPhotoToStrip();
    }
  }
});

loaderRetry.addEventListener("click", () => {
  loaderRetry.classList.add("hidden");
  setupCameraAndMediaPipe();
});

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
  setupCameraAndMediaPipe();
});
