/**
 * PFLEGE-RUNNER ENGINE
 * - 8 Random Skins bei jedem Laden / Reload
 * - 4-Frame Laufanimation ab Sekunde 0 (Endlos-Demo)
 * - Slide-Mechanik (Pfeil nach unten)
 * - Flur mit Türen als durchscrollender Hintergrund
 * - Keine Vögel, kein Mond, keine invertierenden Nachtmodi
 */

const GAME_CONFIG = {
  // 1. SPIELER-KOORDINATEN (Aus deiner 1x PSD/CSV)
  PLAYER: {
    STAND_X: 728,        // Start-X der ersten Box (Skin 1, Frame 1)
    STAND_Y: 401,         // Start-Y der ersten Box (Skin 1, Frame 1)
    STAND_W: 40,         // Einheitliche Breite der aufrechten Box
    STAND_H: 49,         // Einheitliche Höhe der aufrechten Box

    SLIDE_X: 968,        // Start-X der ersten Slide-Box (Skin 1)
    SLIDE_Y: 416,         // Start-Y der ersten Slide-Box (Skin 1)
    SLIDE_W: 54,         // Breite der Slide-Box
    SLIDE_H: 34,         // Höhe der Slide-Box

    ROW_STRIDE_Y: -57,    // Abstand von Oberkante Skin 1 zu Oberkante Skin 2
    TOTAL_SKINS: 6       // 8 verschiedene Charaktere
  },

  // 2. WELT / FLUR (Durchlaufender Streifen mit Türen)
  HORIZON: {
    X: 2,
    Y: 459,
    WIDTH: 1114,         // Breite deines Flurband-Segments
    HEIGHT: 58           // Höhe des Flurbands
  },

  // 3. BODENNIVEAU IM SPIELFELD
  GROUND_Y: 155,         // Y-Position der Fußsohle im Spielfeld (0 = oben, 260 = unten)

  // 4. HINDERNISSE (Aus deiner 1x PSD/CSV)
  OBSTACLES: [
    { name: 'BETT_1',     x: 245, y: 407, width: 65, height: 31 },
    { name: 'BETT_2', x: 318, y: 407, width: 65, height: 31 },
    { name: 'ROLLATOR_1',        x: 391, y: 414, width: 21, height: 24 },
    { name: 'ROLLATOR_2',    x: 420, y: 417, width: 21, height: 21 },
    { name: 'ROLLSTUHL',    x: 449, y: 409, width: 31, height: 29 },
    { name: 'MEDI_WAGEN',      x: 488, y: 401, width: 50, height: 37 },
    { name: 'LIFTER_1',      x: 546, y: 401, width: 44, height: 52 },
    { name: 'LIFTER_2',      x: 598, y: 401, width: 42, height: 52 },
    { name: 'SCHRANK_1',     x: 649, y: 401, width: 31, height: 52 },
    { name: 'SCHRANK_2',     x: 689, y: 401, width: 31, height: 52 }
  ],

  // 5. UI-SYMBOLE (Aus deiner 1x PSD/CSV)
  UI: {
    GAME_OVER:    { x: 46, y: 414, width: 191, height: 11 },
    RESTART_BTN:  { x: 2, y: 401, width: 36,  height: 32 },
    SCORE_DIGITS: { x: 46, y: 401, width: 119, height: 11 }
  },

  // 6. GESCHWINDIGKEITEN (Hier feintunen)
  SPEED: {
    START: 4.2,          // Vorher 6.0 (Start-Tempo: 4.0 - 4.5 ist deutlich entspannter)
    DEMO: 2.2,           // Vorher 3.5 (Gemütliches Joggen im Demo-Modus)
    ACCELERATION: 0.0005 // Vorher 0.0007 (Wie sanft das Tempo mit der Zeit anzieht)
  }
};

(function () {
  'use strict';

  const canvas = document.getElementById('care-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const isHiDPI = window.devicePixelRatio > 1;
  const spriteImg = document.getElementById('offline-resources-1x');
  const scaleRatio = 1;

  // Zufälligen Skin bestimmen (0 bis 7)
  const activeSkinIndex = Math.floor(Math.random() * GAME_CONFIG.PLAYER.TOTAL_SKINS);

  let isPlaying = false;
  let isGameOver = false;
  let gameSpeed = GAME_CONFIG.SPEED.START;
  let score = 0;
  let highScore = parseInt(localStorage.getItem('care_runner_hi') || '0', 10);
  let distanceRan = 0;
  let frameCount = 0;

  // Meilenstein-Effekt (100er-Schritte)
  let lastMilestone = 0;
  let milestoneScore = 0;
  let isFlashingScore = false;
  let flashTimer = 0;
  const FLASH_FRAMES = 84; // ~1,4 Sekunden Blinken

  // Hintergrund-Positionierung
  let floorX1 = 0;
  let floorX2 = GAME_CONFIG.HORIZON.WIDTH;

  // Spieler-Zustand
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
  const MASTER_VOLUME = 0.18; // Lautstärke: 0.15 bis 0.25 ist dezent und angenehm

  const soundBuffers = {
    press: null,   // Sprung-Sound
    hit: null,     // Crash-Sound
    reached: null  // 100er Meilenstein
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

      // Zentraler Lautstärkeregler
      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(MASTER_VOLUME, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);

      // Lädt die drei Original-Sounds
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
        source.connect(masterGain); // Signal läuft gedämpft durch den GainNode
        source.start(0);
        return;
      } catch (e) {}
    }

    // Fallback für HTML-Audio
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
    initAudio(); // Schaltet Audio nach Benutzer-Interaktion frei

    if (isGameOver) {
      resetGame();
      player.dy = player.jumpForce;
      player.grounded = false;
      return;
    }

    // 1. Neustart nach Crash inklusive direktem Sprung
    if (isGameOver) {
      resetGame();
      player.dy = player.jumpForce;
      player.grounded = false;
      playJumpSound();
      return;
    }

    // 2. Start aus dem Demo-Lauf
    if (!isPlaying) {
      isPlaying = true;
      isGameOver = false;
    }

    // 3. Sprung ausführen
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

  // Steuerung
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

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    triggerJump();
  });

  function resetGame() {
    activeObstacles = [];
    score = 0;
    distanceRan = 0;
    lastMilestone = 0;
    isFlashingScore = false;
    flashTimer = 0;
    gameSpeed = GAME_CONFIG.SPEED.START; // Setzt wieder auf das entspannte Start-Tempo
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

  function update() {
    frameCount++;

    // 1. Hintergrund (Flur) scrollen – STOPPT sofort bei isGameOver
    if (!isGameOver) {
      const currentScrollSpeed = isPlaying ? gameSpeed : GAME_CONFIG.SPEED.DEMO;
      floorX1 -= currentScrollSpeed;
      floorX2 -= currentScrollSpeed;

      if (floorX1 <= -GAME_CONFIG.HORIZON.WIDTH) floorX1 = floorX2 + GAME_CONFIG.HORIZON.WIDTH;
      if (floorX2 <= -GAME_CONFIG.HORIZON.WIDTH) floorX2 = floorX1 + GAME_CONFIG.HORIZON.WIDTH;
    }

    // 2. Spieler-Physik
    if (!player.grounded) {
      player.dy += player.gravity;
      player.y += player.dy;

      const currentGroundY = GAME_CONFIG.GROUND_Y - (player.isDucking ? GAME_CONFIG.PLAYER.SLIDE_H : GAME_CONFIG.PLAYER.STAND_H);
      if (player.y >= currentGroundY) {
        player.y = currentGroundY;
        player.dy = 0;
        player.grounded = true;
      }
    }

    // 3. Aktiver Spielstatus
    if (isPlaying && !isGameOver) {
      distanceRan += gameSpeed * 0.05;
      score = Math.floor(distanceRan);
      if (score > highScore) {
        highScore = score;
        localStorage.setItem('care_runner_hi', highScore);
      }

      // 100er Meilenstein erreicht: Sound abspielen & Blink-Timer starten
      if (score > 0 && score % 100 === 0 && score !== lastMilestone) {
        lastMilestone = score;
        milestoneScore = score;
        isFlashingScore = true;
        flashTimer = FLASH_FRAMES;
        playScoreSound();
      }

      // Blink-Timer herunterzählen
      if (isFlashingScore) {
        flashTimer--;
        if (flashTimer <= 0) {
          isFlashingScore = false;
        }
      }

      gameSpeed += GAME_CONFIG.SPEED.ACCELERATION;

      // Hindernisse bewegen & spawnen
      obstacleTimer++;
      if (obstacleTimer > Math.max(55, 110 - gameSpeed * 4)) {
        if (Math.random() < 0.6) spawnObstacle();
        obstacleTimer = 0;
      }

      for (let i = activeObstacles.length - 1; i >= 0; i--) {
        const obs = activeObstacles[i];
        obs.x -= gameSpeed;

        // 1. Passgenaue Hitbox für den Spieler (schneidet den Leerraum links & rechts ab)
        const pHit = player.isDucking
          ? { x: player.x + 4,  y: player.y + 3, w: player.w - 8,  h: player.h - 5 }  // Beim Rutschen
          : { x: player.x + 10, y: player.y + 4, w: player.w - 18, h: player.h - 6 }; // Aufrecht (schlanker Körper)

        // 2. Passgenaue Hitbox für das Hindernis
        const oHit = {
          x: obs.x + 4,
          y: obs.y + 3,
          w: obs.w - 8,
          h: obs.h - 5
        };

        // AABB-Kollisionsprüfung
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

    // 4. Lauf-Frame takten
    if (frameCount % 9 === 0) {
      player.animFrame = (player.animFrame + 1) % 4;
    }
  }

  function drawPixelText(text, startX, startY) {
    const digits = GAME_CONFIG.UI.SCORE_DIGITS;
    const charWidth = 10;  // Breite einer Ziffer auf deinem 1x-Sheet
    const charHeight = digits.height; // 11 px

    let curX = startX;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      let charIndex = -1;

      if (char >= '0' && char <= '9') {
        charIndex = char.charCodeAt(0) - 48; // 0 bis 9
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

      // Weiterrücken: Leerzeichen sind etwas schmaler, Buchstaben bekommen 1px Abstand
      curX += (char === ' ') ? 6 : charWidth + 1;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Hintergrund zeichnen
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

    // 2. Hindernisse zeichnen
    activeObstacles.forEach((obs) => {
      ctx.drawImage(
        spriteImg,
        obs.sourceX * scaleRatio, obs.sourceY * scaleRatio, obs.w * scaleRatio, obs.h * scaleRatio,
        Math.round(obs.x), Math.round(obs.y), obs.w, obs.h
      );
    });

    // 3. Spieler zeichnen
    const pCfg = GAME_CONFIG.PLAYER;
    const skinYOffset = activeSkinIndex * pCfg.ROW_STRIDE_Y;

    let sx = pCfg.STAND_X;
    let sy = pCfg.STAND_Y + skinYOffset;
    let sw = pCfg.STAND_W;
    let sh = pCfg.STAND_H;

    if (isGameOver) {
      sx += 5 * pCfg.STAND_W; // Crash Frame
    } else if (!player.grounded) {
      sx += 4 * pCfg.STAND_W; // Sprung Frame
    } else if (player.isDucking) {
      sx = pCfg.SLIDE_X;
      sy = pCfg.SLIDE_Y + skinYOffset;
      sw = pCfg.SLIDE_W;
      sh = pCfg.SLIDE_H;
    } else {
      sx += player.animFrame * pCfg.STAND_W; // 4-Frame Laufanimation
    }

    ctx.drawImage(
      spriteImg,
      sx * scaleRatio, sy * scaleRatio, sw * scaleRatio, sh * scaleRatio,
      Math.round(player.x), Math.round(player.y), sw, sh
    );

    // 4. UI / Score (Original Pixel-Art mit Blinken bei 100er-Schritten)
    const displayScoreNum = isFlashingScore ? milestoneScore : score;

    // Taktet die Ziffern sichtbar / unsichtbar (alle 14 Frames an/aus)
    const showScoreDigits = !isFlashingScore || (Math.floor(flashTimer / 14) % 2 === 0);
    const scorePart = showScoreDigits ? String(displayScoreNum).padStart(5, '0') : '     ';

    const scoreString = `HI ${String(highScore).padStart(5, '0')}  ${scorePart}`;
    const totalScoreWidth = (scoreString.length - 2) * 11 + 2 * 6;
    const scoreX = canvas.width - totalScoreWidth - 20;

    drawPixelText(scoreString, scoreX, 20);

    if (isGameOver) {
      const go = GAME_CONFIG.UI.GAME_OVER;
      const rb = GAME_CONFIG.UI.RESTART_BTN;

      // Math.round() verhindert unschöne Halbpixel-Verzerrungen
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

  function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
  }

  // Sicherstellen, dass das Sprite geladen ist
  if (spriteImg.complete) {
    gameLoop();
  } else {
    spriteImg.addEventListener('load', gameLoop);
  }
})();
