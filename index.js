/**
 * PFLEGE-RUNNER ENGINE
 * - Delta-Time Gameloop für konstante 60 FPS auf allen Geräten (Desktop & Mobile)
 * - 0ms Touch-Latenz für Touchscreens
 * - Original Google Chrome Audio Engine (MasterGain gedämpft)
 * - 1-Frame Slide, dynamische Hitboxen, Sprite-Font Renderer
 */

const GAME_CONFIG = {
  // 1. SPIELER-KOORDINATEN
  PLAYER: {
    STAND_X: 728,
    STAND_Y: 401,
    STAND_W: 40,
    STAND_H: 49,

    SLIDE_X: 968,
    SLIDE_Y: 416,
    SLIDE_W: 54,
    SLIDE_H: 34,

    ROW_STRIDE_Y: -57,
    TOTAL_SKINS: 6
  },

  // 2. WELT / FLUR
  HORIZON: {
    X: 2,
    Y: 459,
    WIDTH: 1114,
    HEIGHT: 58
  },

  // 3. BODENNIVEAU IM CANVAS
  GROUND_Y: 155,

  // 4. HINDERNISSE
  OBSTACLES: [
    { name: 'BETT_1',     x: 245, y: 407, width: 65, height: 31 },
    { name: 'BETT_2',     x: 318, y: 407, width: 65, height: 31 },
    { name: 'ROLLATOR_1', x: 391, y: 414, width: 21, height: 24 },
    { name: 'ROLLATOR_2', x: 420, y: 417, width: 21, height: 21 },
    { name: 'ROLLSTUHL',  x: 449, y: 409, width: 31, height: 29 },
    { name: 'MEDI_WAGEN', x: 488, y: 401, width: 50, height: 37 },
    { name: 'LIFTER_1',   x: 546, y: 401, width: 44, height: 52 },
    { name: 'LIFTER_2',   x: 598, y: 401, width: 42, height: 52 },
    { name: 'SCHRANK_1',  x: 649, y: 401, width: 31, height: 52 },
    { name: 'SCHRANK_2',  x: 689, y: 401, width: 31, height: 52 }
  ],

  // 5. UI-SYMBOLE
  UI: {
    GAME_OVER:    { x: 46, y: 414, width: 191, height: 11 },
    RESTART_BTN:  { x: 2,  y: 401, width: 36,  height: 32 },
    SCORE_DIGITS: { x: 46, y: 401, width: 119, height: 11 }
  },

  // 6. GESCHWINDIGKEITEN
  SPEED: {
    START: 4.2,
    DEMO: 2.2,
    ACCELERATION: 0.0005
  }
};

(function () {
  'use strict';

  let canvas = null;
  let ctx = null;
  let spriteImg = null;
  const scaleRatio = 1;

  const activeSkinIndex = Math.floor(Math.random() * GAME_CONFIG.PLAYER.TOTAL_SKINS);

  let isPlaying = false;
  let isGameOver = false;
  let gameSpeed = GAME_CONFIG.SPEED.START;
  let score = 0;
  let highScore = parseInt(localStorage.getItem('care_runner_hi') || '0', 10);
  let distanceRan = 0;

  // Zeitgesteuerte Delta-Time & Animationsvariablen
  let lastTime = 0;
  let animTimer = 0;

  // Meilenstein-Effekt
  let lastMilestone = 0;
  let milestoneScore = 0;
  let isFlashingScore = false;
  let flashTimer = 0;
  const FLASH_FRAMES = 84;

  let floorX1 = 0;
  let floorX2 = GAME_CONFIG.HORIZON.WIDTH;

  const player = {
    x: 60,
    y: GAME_CONFIG.GROUND_Y - GAME_CONFIG.PLAYER.STAND_H,
    w: GAME_CONFIG.PLAYER.STAND_W,
    h: GAME_CONFIG.PLAYER.STAND_H,
    dy: 0,
    jumpForce: -11.5,
    gravity: 0.62,
    grounded: true,
    isDucking: false,
    animFrame: 0
  };

  let activeObstacles = [];
  let obstacleTimer = 0;

  // ==========================================
  // ORIGINALE GOOGLE CHROME AUDIO ENGINE
  // ==========================================
  let audioCtx = null;
  let masterGain = null;
  const MASTER_VOLUME = 0.18;

  const soundBuffers = {
    press: null,
    hit: null,
    reached: null
  };

  function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function loadSound(id, key) {
    const el = document.getElementById(id);
    if (!el || !el.src || !audioCtx) return;
    const base64Data = el.src.split(',')[1];
    if (!base64Data) return;

    const arrayBuffer = base64ToArrayBuffer(base64Data);
    audioCtx.decodeAudioData(arrayBuffer, (decoded) => {
      soundBuffers[key] = decoded;
    }, () => {});
  }

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(MASTER_VOLUME, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);

      loadSound('offline-sound-press', 'press');
      loadSound('offline-sound-hit', 'hit');
      loadSound('offline-sound-reached', 'reached');
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playSound(buffer, fallbackId) {
    if (audioCtx && buffer && masterGain) {
      try {
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(masterGain);
        source.start(0);
        return;
      } catch (e) {}
    }

    const el = document.getElementById(fallbackId);
    if (el) {
      el.volume = MASTER_VOLUME;
      el.currentTime = 0;
      el.play().catch(() => {});
    }
  }

  function playJumpSound() {
    playSound(soundBuffers.press, 'offline-sound-press');
  }

  function playDeathSound() {
    playSound(soundBuffers.hit, 'offline-sound-hit');
  }

  function playScoreSound() {
    playSound(soundBuffers.reached, 'offline-sound-reached');
  }

  function triggerJump() {
    initAudio();

    // Neustart nach Game Over
    if (isGameOver) {
      resetGame();
      player.dy = player.jumpForce;
      player.grounded = false;
      playJumpSound();
      return;
    }

    // Start aus Demo-Lauf
    if (!isPlaying) {
      isPlaying = true;
      isGameOver = false;
    }

    // Sprung
    if (player.grounded && !player.isDucking) {
      player.dy = player.jumpForce;
      player.grounded = false;
      playJumpSound();
    }
  }

  function setDucking(ducking) {
    if (!isPlaying || isGameOver) return;
    player.isDucking = ducking;
    if (ducking) {
      player.h = GAME_CONFIG.PLAYER.SLIDE_H;
      player.w = GAME_CONFIG.PLAYER.SLIDE_W;
      player.y = GAME_CONFIG.GROUND_Y - player.h;
    } else {
      player.h = GAME_CONFIG.PLAYER.STAND_H;
      player.w = GAME_CONFIG.PLAYER.STAND_W;
      player.y = GAME_CONFIG.GROUND_Y - player.h;
    }
  }

  function setupControls() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        triggerJump();
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        setDucking(true);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowDown') {
        setDucking(false);
      }
    });

    // 0ms Latenz auf Smartphones
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      triggerJump();
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') {
        e.preventDefault();
        triggerJump();
      }
    });
  }

  function resetGame() {
    activeObstacles = [];
    score = 0;
    distanceRan = 0;
    lastMilestone = 0;
    isFlashingScore = false;
    flashTimer = 0;
    gameSpeed = GAME_CONFIG.SPEED.START;
    isGameOver = false;
    isPlaying = true;
    player.y = GAME_CONFIG.GROUND_Y - GAME_CONFIG.PLAYER.STAND_H;
    player.dy = 0;
    player.grounded = true;
    player.isDucking = false;
  }

  function spawnObstacle() {
    const list = GAME_CONFIG.OBSTACLES;
    const item = list[Math.floor(Math.random() * list.length)];
    activeObstacles.push({
      x: canvas.width + 20,
      y: GAME_CONFIG.GROUND_Y - item.height,
      w: item.width,
      h: item.height,
      sourceX: item.x,
      sourceY: item.y
    });
  }

  function update(deltaFactor) {
    // 1. Hintergrund-Scrollen an Echtzeit gekoppelt
    if (!isGameOver) {
      const currentScrollSpeed = (isPlaying ? gameSpeed : GAME_CONFIG.SPEED.DEMO) * deltaFactor;
      floorX1 -= currentScrollSpeed;
      floorX2 -= currentScrollSpeed;

      if (floorX1 <= -GAME_CONFIG.HORIZON.WIDTH) floorX1 = floorX2 + GAME_CONFIG.HORIZON.WIDTH;
      if (floorX2 <= -GAME_CONFIG.HORIZON.WIDTH) floorX2 = floorX1 + GAME_CONFIG.HORIZON.WIDTH;
    }

    // 2. Spieler-Physik
    if (!player.grounded) {
      player.dy += player.gravity * deltaFactor;
      player.y += player.dy * deltaFactor;

      const currentGroundY = GAME_CONFIG.GROUND_Y - (player.isDucking ? GAME_CONFIG.PLAYER.SLIDE_H : GAME_CONFIG.PLAYER.STAND_H);
      if (player.y >= currentGroundY) {
        player.y = currentGroundY;
        player.dy = 0;
        player.grounded = true;
      }
    }

    // 3. Aktiver Spielstatus
    if (isPlaying && !isGameOver) {
      distanceRan += (gameSpeed * 0.05) * deltaFactor;
      score = Math.floor(distanceRan);
      if (score > highScore) {
        highScore = score;
        localStorage.setItem('care_runner_hi', highScore);
      }

      if (score > 0 && score % 100 === 0 && score !== lastMilestone) {
        lastMilestone = score;
        milestoneScore = score;
        isFlashingScore = true;
        flashTimer = FLASH_FRAMES;
        playScoreSound();
      }

      if (isFlashingScore) {
        flashTimer -= deltaFactor;
        if (flashTimer <= 0) {
          isFlashingScore = false;
        }
      }

      gameSpeed += GAME_CONFIG.SPEED.ACCELERATION * deltaFactor;

      obstacleTimer += deltaFactor;
      if (obstacleTimer > Math.max(55, 110 - gameSpeed * 4)) {
        if (Math.random() < 0.6) spawnObstacle();
        obstacleTimer = 0;
      }

      for (let i = activeObstacles.length - 1; i >= 0; i--) {
        const obs = activeObstacles[i];
        obs.x -= gameSpeed * deltaFactor;

        const pHit = player.isDucking
          ? { x: player.x + 4,  y: player.y + 3, w: player.w - 8,  h: player.h - 5 }
          : { x: player.x + 10, y: player.y + 4, w: player.w - 18, h: player.h - 6 };

        const oHit = {
          x: obs.x + 4,
          y: obs.y + 3,
          w: obs.w - 8,
          h: obs.h - 5
        };

        if (
          pHit.x < oHit.x + oHit.w &&
          pHit.x + pHit.w > oHit.x &&
          pHit.y < oHit.y + oHit.h &&
          pHit.y + pHit.h > oHit.y
        ) {
          isGameOver = true;
          playDeathSound();
        }

        if (obs.x + obs.w < -20) activeObstacles.splice(i, 1);
      }
    }

    // 4. Lauf-Animation an Echtzeit gekoppelt
    animTimer += deltaFactor;
    if (animTimer >= 9) {
      player.animFrame = (player.animFrame + 1) % 4;
      animTimer = 0;
    }
  }

  function drawPixelText(text, startX, startY) {
    const digits = GAME_CONFIG.UI.SCORE_DIGITS;
    const charWidth = 10;
    const charHeight = digits.height;

    let curX = startX;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      let charIndex = -1;

      if (char >= '0' && char <= '9') {
        charIndex = char.charCodeAt(0) - 48;
      } else if (char === 'H') {
        charIndex = 10;
      } else if (char === 'I') {
        charIndex = 11;
      }

      if (charIndex !== -1) {
        ctx.drawImage(
          spriteImg,
          digits.x + charIndex * charWidth, digits.y, charWidth, charHeight,
          Math.round(curX), Math.round(startY), charWidth, charHeight
        );
      }

      curX += (char === ' ') ? 6 : charWidth + 1;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const h = GAME_CONFIG.HORIZON;
    const floorDrawY = GAME_CONFIG.GROUND_Y - 54;

    ctx.drawImage(
      spriteImg,
      h.X * scaleRatio, h.Y * scaleRatio, h.WIDTH * scaleRatio, h.HEIGHT * scaleRatio,
      floorX1, floorDrawY, h.WIDTH, h.HEIGHT
    );
    ctx.drawImage(
      spriteImg,
      h.X * scaleRatio, h.Y * scaleRatio, h.WIDTH * scaleRatio, h.HEIGHT * scaleRatio,
      floorX2, floorDrawY, h.WIDTH, h.HEIGHT
    );

    activeObstacles.forEach((obs) => {
      ctx.drawImage(
        spriteImg,
        obs.sourceX * scaleRatio, obs.sourceY * scaleRatio, obs.w * scaleRatio, obs.h * scaleRatio,
        Math.round(obs.x), Math.round(obs.y), obs.w, obs.h
      );
    });

    const pCfg = GAME_CONFIG.PLAYER;
    const skinYOffset = activeSkinIndex * pCfg.ROW_STRIDE_Y;

    let sx = pCfg.STAND_X;
    let sy = pCfg.STAND_Y + skinYOffset;
    let sw = pCfg.STAND_W;
    let sh = pCfg.STAND_H;

    if (isGameOver) {
      sx += 5 * pCfg.STAND_W;
    } else if (!player.grounded) {
      sx += 4 * pCfg.STAND_W;
    } else if (player.isDucking) {
      sx = pCfg.SLIDE_X;
      sy = pCfg.SLIDE_Y + skinYOffset;
      sw = pCfg.SLIDE_W;
      sh = pCfg.SLIDE_H;
    } else {
      sx += player.animFrame * pCfg.STAND_W;
    }

    ctx.drawImage(
      spriteImg,
      sx * scaleRatio, sy * scaleRatio, sw * scaleRatio, sh * scaleRatio,
      Math.round(player.x), Math.round(player.y), sw, sh
    );

    const displayScoreNum = isFlashingScore ? milestoneScore : score;
    const showScoreDigits = !isFlashingScore || (Math.floor(flashTimer / 14) % 2 === 0);
    const scorePart = showScoreDigits ? String(displayScoreNum).padStart(5, '0') : '     ';

    const scoreString = `HI ${String(highScore).padStart(5, '0')}  ${scorePart}`;
    const totalScoreWidth = (scoreString.length - 2) * 11 + 2 * 6;
    const scoreX = canvas.width - totalScoreWidth - 20;

    drawPixelText(scoreString, scoreX, 20);

    if (isGameOver) {
      const go = GAME_CONFIG.UI.GAME_OVER;
      const rb = GAME_CONFIG.UI.RESTART_BTN;

      ctx.drawImage(
        spriteImg,
        go.x, go.y, go.width, go.height,
        Math.round(canvas.width / 2 - go.width / 2), 65, go.width, go.height
      );

      ctx.drawImage(
        spriteImg,
        rb.x, rb.y, rb.width, rb.height,
        Math.round(canvas.width / 2 - rb.width / 2), 95, rb.width, rb.height
      );
    }
  }

  function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;
    lastTime = timestamp;

    // Normalisiert auf 60 FPS (16.667ms = Faktor 1.0)
    const deltaFactor = Math.min(Math.max(elapsed / 16.667, 0.1), 2.0);

    update(deltaFactor);
    draw();
    requestAnimationFrame(gameLoop);
  }

  function initGame() {
    canvas = document.getElementById('care-canvas');
    if (!canvas) return;

    // Fallback: Webflow Custom Element auf die optimalen Pixelmaße setzen
    if (!canvas.width || canvas.width === 300) canvas.width = 580;
    if (!canvas.height || canvas.height === 150) canvas.height = 200;

    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    spriteImg = document.getElementById('offline-resources-1x');
    if (!spriteImg) return;

    setupControls();

    if (spriteImg.complete && spriteImg.naturalWidth > 0) {
      requestAnimationFrame(gameLoop);
    } else {
      spriteImg.addEventListener('load', () => requestAnimationFrame(gameLoop));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
  } else {
    initGame();
  }
})();
