(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // RNG (seeded, deterministic per puzzle)
  // ---------------------------------------------------------------------
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const el = {
    playfieldWrap: document.getElementById('playfieldWrap'),
    playfieldSizer: document.getElementById('playfieldSizer'),
    playfield: document.getElementById('playfield'),
    board: document.getElementById('board'),
    boardCanvas: document.getElementById('boardCanvas'),
    piecesLayer: document.getElementById('piecesLayer'),
    pieceCount: document.getElementById('pieceCount'),
    newGameBtn: document.getElementById('newGameBtn'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    showGuide: document.getElementById('showGuide'),
    showRef: document.getElementById('showRef'),
    refPanel: document.getElementById('refPanel'),
    refCanvas: document.getElementById('refCanvas'),
    progressText: document.getElementById('progressText'),
    timerText: document.getElementById('timerText'),
    completeOverlay: document.getElementById('completeOverlay'),
    completeStats: document.getElementById('completeStats'),
    completeRank: document.getElementById('completeRank'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    viewLeaderboardBtn: document.getElementById('viewLeaderboardBtn'),
    introOverlay: document.getElementById('introOverlay'),
    introOkBtn: document.getElementById('introOkBtn'),
    playerNameInput: document.getElementById('playerNameInput'),
    leaderboardBtn: document.getElementById('leaderboardBtn'),
    leaderboardOverlay: document.getElementById('leaderboardOverlay'),
    leaderboardList: document.getElementById('leaderboardList'),
    leaderboardCloseBtn: document.getElementById('leaderboardCloseBtn'),
    toast: document.getElementById('toast'),
  };

  let IMG_W = 1600;
  let IMG_H = 1100;
  const TARGET_IMAGE_AREA = 1600 * 1100;
  const SNAP_DIST = 22;
  let BOARD_OFFSET = { x: 40, y: 40 };

  // The whole table (board + pieces) is generated once at a fixed logical
  // size; scroll-wheel zoom scales it live via these, independent of the
  // window itself.
  const DISPLAY_SCALE_MIN = 0.3;
  const DISPLAY_SCALE_MAX = 3;
  let playfieldWLogical = 0;
  let playfieldHLogical = 0;
  let displayScale = 1;

  // Applies a display scale directly (used by manual zoom), clamping to
  // the allowed range and resizing the scrollable sizer to match.
  function setDisplayScale(scale) {
    displayScale = Math.max(DISPLAY_SCALE_MIN, Math.min(DISPLAY_SCALE_MAX, scale));
    el.playfield.style.transform = `scale(${displayScale})`;
    el.playfieldSizer.style.width = (playfieldWLogical * displayScale) + 'px';
    el.playfieldSizer.style.height = (playfieldHLogical * displayScale) + 'px';
  }

  // Converts a raw pointer position (viewport pixels) into the puzzle's
  // logical, unscaled coordinate space (the same space piece.x/y live in).
  function clientToLogical(clientX, clientY) {
    const wrapRect = el.playfieldWrap.getBoundingClientRect();
    return {
      x: (clientX - wrapRect.left + el.playfieldWrap.scrollLeft) / displayScale,
      y: (clientY - wrapRect.top + el.playfieldWrap.scrollTop) / displayScale,
    };
  }

  // Zooms out so the whole board fits in view with some breathing room
  // around it (like taking a step back from the table, so a bit of the
  // surrounding pieces/border is visible too), then centers it. Only done
  // once, when a puzzle is built — not reactive to later window resizes.
  const FIT_PADDING_FRACTION = 0.72;

  function fitAndCenterBoard() {
    const fitScale = Math.min(
      (el.playfieldWrap.clientWidth * FIT_PADDING_FRACTION) / IMG_W,
      (el.playfieldWrap.clientHeight * FIT_PADDING_FRACTION) / IMG_H
    );
    setDisplayScale(Math.min(1, fitScale));

    const wrapRect = el.playfieldWrap.getBoundingClientRect();
    el.playfieldWrap.scrollLeft = (BOARD_OFFSET.x + IMG_W / 2) * displayScale - wrapRect.width / 2;
    el.playfieldWrap.scrollTop = (BOARD_OFFSET.y + IMG_H / 2) * displayScale - wrapRect.height / 2;
  }

  // Puzzle photos live in ./Images — add a filename here and it joins the random pool.
  const PUZZLE_IMAGES = [
    'apr2026_armoured_ladder_hatch_1_4K.jpg',
    'canbe_backpacks_launch_01.jpg',
    'oct2026_plaguedoctor_dlc_hero_03_4k.jpg',
    'rust_lr300_spacedlc_1080_3_jpg.jpg',
    'rust_mortar_1_4k.jpg',
    'Naval_update_hero_shot_1_brig.jpg',
    'bradleyscientists_01.jpg',
    'chickenmodel_02.jpg',
    'dec2022_heroimage.jpg',
    'jungleUpdate_biome_01_4k.jpg',
    'jungleupdate_tiger_01.jpg',
    'junkpile_scientists_4k.jpg',
    'motorbike_riding_01.jpg',
    'oilrig_1.jpg',
    'rust_Nov2025update_helicopter_balancing_1_4K.jpg',
    'rust_febupdate2026_paintball_overalls_01_4k (1).jpg',
    'rust_patch_202403_lighttheway_hero_4K.jpg',
    'rust_valentines2025_screenshot_01 (1).jpg',
  ];

  let zTop = 10;
  let pieces = [];
  let pieceGrid = [];
  let placedCount = 0;
  let totalCount = 0;
  let gridRows = 0;
  let gridCols = 0;
  let timerHandle = null;
  let startTime = null;
  let dragInfo = null;
  let loading = false;

  // ---------------------------------------------------------------------
  // Player name + fastest-time leaderboard (persisted in localStorage —
  // there's no server, so "global" here means "this browser").
  // ---------------------------------------------------------------------
  const PLAYER_NAME_KEY = 'raidsawJigsawPlayerName';
  const LEADERBOARD_KEY = 'raidsawJigsawLeaderboard';
  const MAX_LEADERBOARD_ENTRIES = 50;
  const LEADERBOARD_DISPLAY_COUNT = 10;

  let playerName = localStorage.getItem(PLAYER_NAME_KEY) || '';
  el.playerNameInput.value = playerName;

  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function formatTime(seconds) {
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  // Adds a finished run to the leaderboard, keeping it sorted fastest-first,
  // and returns the 1-based rank the new entry landed at.
  function recordLeaderboardEntry(entry) {
    const list = loadLeaderboard();
    list.push(entry);
    list.sort((a, b) => a.timeSeconds - b.timeSeconds);
    if (list.length > MAX_LEADERBOARD_ENTRIES) list.length = MAX_LEADERBOARD_ENTRIES;
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
    return list.indexOf(entry) + 1;
  }

  function renderLeaderboard(highlightEntry) {
    const list = loadLeaderboard().sort((a, b) => a.timeSeconds - b.timeSeconds);
    el.leaderboardList.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No finished puzzles yet — be the first!';
      el.leaderboardList.appendChild(empty);
      return;
    }
    list.slice(0, LEADERBOARD_DISPLAY_COUNT).forEach((entry, i) => {
      const li = document.createElement('li');
      if (highlightEntry && entry.date === highlightEntry.date) li.classList.add('lb-mine');
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = '#' + (i + 1);
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = entry.name;
      const time = document.createElement('span');
      time.className = 'lb-time';
      time.textContent = formatTime(entry.timeSeconds);
      const piecesLabel = document.createElement('span');
      piecesLabel.className = 'lb-pieces';
      piecesLabel.textContent = entry.pieces + ' pcs';
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(time);
      li.appendChild(piecesLabel);
      el.leaderboardList.appendChild(li);
    });
  }

  function openLeaderboard(highlightEntry) {
    renderLeaderboard(highlightEntry);
    el.leaderboardOverlay.classList.remove('hidden');
  }

  let lastFinishedEntry = null;

  el.leaderboardBtn.addEventListener('click', () => openLeaderboard(null));
  el.leaderboardCloseBtn.addEventListener('click', () => {
    el.leaderboardOverlay.classList.add('hidden');
  });
  el.viewLeaderboardBtn.addEventListener('click', () => {
    el.completeOverlay.classList.add('hidden');
    openLeaderboard(lastFinishedEntry);
  });

  // Edge-piece "challenge" quip: pops a toast if the player's placed a run
  // of border pieces back to back, with no middle piece breaking it up.
  const EDGE_STREAK_THRESHOLD = 8;
  let consecutiveEdgeStreak = 0;
  let edgeNoticeShown = false;
  let nonEdgeStreak = 0;
  let toastHideTimer = null;
  let toastVisible = false;
  let lastMouseX = window.innerWidth / 2;
  let lastMouseY = window.innerHeight / 2;
  const TOAST_CURSOR_OFFSET = 18;

  // Every few pieces placed on the board, celebrate with the same toast
  // popup used for the edge-piece quip.
  const DAYUM_INTERVAL = 3;
  let boardPlacementCount = 0;

  function isEdgePiece(piece) {
    return piece.r === 0 || piece.c === 0 || piece.r === gridRows - 1 || piece.c === gridCols - 1;
  }

  // Keeps the toast pinned near the cursor, nudged back on-screen if it
  // would otherwise run off an edge.
  function positionToastNearCursor() {
    const maxLeft = Math.max(10, window.innerWidth - el.toast.offsetWidth - 10);
    const maxTop = Math.max(10, window.innerHeight - el.toast.offsetHeight - 10);
    el.toast.style.left = Math.min(lastMouseX + TOAST_CURSOR_OFFSET, maxLeft) + 'px';
    el.toast.style.top = Math.min(lastMouseY + TOAST_CURSOR_OFFSET, maxTop) + 'px';
  }

  document.addEventListener('pointermove', (ev) => {
    lastMouseX = ev.clientX;
    lastMouseY = ev.clientY;
    if (toastVisible) positionToastNearCursor();
  });

  function showToast(message) {
    clearTimeout(toastHideTimer);
    el.toast.textContent = message;
    positionToastNearCursor();
    el.toast.classList.remove('hidden');
    toastVisible = true;
    toastHideTimer = setTimeout(() => {
      el.toast.classList.add('hidden');
      toastVisible = false;
    }, 6000);
  }

  function notePiecePlacement(piece) {
    const edge = isEdgePiece(piece);

    if (!edgeNoticeShown) {
      if (edge) {
        consecutiveEdgeStreak++;
        if (consecutiveEdgeStreak >= EDGE_STREAK_THRESHOLD) {
          edgeNoticeShown = true;
          showToast('Doing all the edge pieces I see, thought you liked a challenge...');
        }
      } else {
        consecutiveEdgeStreak = 0;
      }
    }

    boardPlacementCount++;
    if (boardPlacementCount % DAYUM_INTERVAL === 0) {
      showToast('DAYUMMM!!!');
    }

    noteConnectionStreak(piece);
  }

  // A streak of non-border pieces connected back to back is worth
  // celebrating — shake the whole page a little more each time the streak
  // grows, until an edge piece breaks it and resets things. Covers both a
  // piece landing on the board and two loose pieces joining off the board,
  // since both count as "putting pieces together".
  function noteConnectionStreak(piece) {
    if (isEdgePiece(piece)) {
      nonEdgeStreak = 0;
    } else {
      nonEdgeStreak++;
      if (nonEdgeStreak >= 2) {
        shakeWebsite(nonEdgeStreak);
      }
    }
  }

  const SHAKE_MAGNITUDE_MAX = 3;
  const SHAKE_MAGNITUDE_STEP = 0.4;

  function shakeWebsite(streak) {
    const magnitude = Math.min(SHAKE_MAGNITUDE_MAX, 1 + (streak - 2) * SHAKE_MAGNITUDE_STEP);
    document.body.style.setProperty('--shake-mag', magnitude.toFixed(2));
    document.body.classList.remove('site-shake');
    void document.body.offsetWidth; // restart the animation if it's already playing
    document.body.classList.add('site-shake');
  }

  function pickRandomImage() {
    return PUZZLE_IMAGES[Math.floor(Math.random() * PUZZLE_IMAGES.length)];
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image: ' + src));
      img.src = src;
    });
  }

  function drawImageCover(ctx, img, w, h) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale, sh = h / scale;
    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  }

  // ---------------------------------------------------------------------
  // Procedural top-down "compound" scene generator
  // ---------------------------------------------------------------------
  function valueNoiseGrid(cols, rows, rng) {
    const g = [];
    for (let y = 0; y <= rows; y++) {
      const row = [];
      for (let x = 0; x <= cols; x++) row.push(rng());
      g.push(row);
    }
    return g;
  }

  function sampleNoise(grid, cols, rows, u, v) {
    const gx = u * cols, gy = v * rows;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, cols), y1 = Math.min(y0 + 1, rows);
    const fx = gx - x0, fy = gy - y0;
    const a = grid[y0][x0], b = grid[y0][x1];
    const c = grid[y1][x0], d = grid[y1][x1];
    const top = a + (b - a) * fx;
    const bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  function generateScene(ctx, w, h, rng) {
    const noiseA = valueNoiseGrid(8, 6, rng);
    const noiseB = valueNoiseGrid(16, 12, rng);

    const grassShades = ['#5a7a3a', '#4f6e33', '#64833f', '#45622c'];
    const sandShade = '#b89a5c';
    const rockShade = '#7a7468';
    const waterShade = '#3a6b8a';

    const cell = 16;
    for (let py = 0; py < h; py += cell) {
      for (let px = 0; px < w; px += cell) {
        const u = px / w, v = py / h;
        const n = sampleNoise(noiseA, 8, 6, u, v) * 0.7 + sampleNoise(noiseB, 16, 12, u, v) * 0.3;
        let color;
        if (n < 0.28) color = waterShade;
        else if (n < 0.34) color = sandShade;
        else if (n > 0.8) color = rockShade;
        else color = grassShades[Math.floor(rng() * grassShades.length)];
        ctx.fillStyle = color;
        ctx.fillRect(px, py, cell + 1, cell + 1);
      }
    }

    // speckle texture
    for (let i = 0; i < 9000; i++) {
      const x = rng() * w, y = rng() * h;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(x, y, 2, 2);
    }

    // river
    ctx.strokeStyle = waterShade;
    ctx.lineWidth = 70;
    ctx.lineCap = 'round';
    ctx.beginPath();
    let rx = -50, ry = h * (0.15 + rng() * 0.2);
    ctx.moveTo(rx, ry);
    while (rx < w + 50) {
      rx += 160 + rng() * 80;
      ry += (rng() - 0.5) * 220;
      ry = Math.max(60, Math.min(h - 60, ry));
      ctx.lineTo(rx, ry);
    }
    ctx.stroke();
    ctx.lineWidth = 50;
    ctx.strokeStyle = '#4a86a8';
    ctx.stroke();

    // road
    ctx.strokeStyle = '#6b5a42';
    ctx.lineWidth = 34;
    ctx.beginPath();
    let qx = w * (0.1 + rng() * 0.1), qy = -50;
    ctx.moveTo(qx, qy);
    while (qy < h + 50) {
      qy += 150 + rng() * 70;
      qx += (rng() - 0.5) * 200;
      qx = Math.max(60, Math.min(w - 60, qx));
      ctx.lineTo(qx, qy);
    }
    ctx.stroke();
    ctx.strokeStyle = '#7a6850';
    ctx.lineWidth = 26;
    ctx.stroke();

    // trees / rocks / bushes scattered on grass
    for (let i = 0; i < 260; i++) {
      const x = rng() * w, y = rng() * h;
      const u = x / w, v = y / h;
      const n = sampleNoise(noiseA, 8, 6, u, v) * 0.7 + sampleNoise(noiseB, 16, 12, u, v) * 0.3;
      if (n < 0.36 || n > 0.8) continue;
      const r = 6 + rng() * 10;
      ctx.fillStyle = '#2f4a22';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f6230';
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 70; i++) {
      const x = rng() * w, y = rng() * h;
      const r = 5 + rng() * 7;
      ctx.fillStyle = '#5e5a4e';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // compounds (small buildings with fences)
    const compoundCount = 6;
    for (let i = 0; i < compoundCount; i++) {
      const cx = 150 + rng() * (w - 300);
      const cy = 150 + rng() * (h - 300);
      const bw = 90 + rng() * 60;
      const bh = 70 + rng() * 50;

      ctx.strokeStyle = 'rgba(40,40,35,0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(cx - bw * 0.9, cy - bh * 0.9, bw * 1.8, bh * 1.8);
      ctx.setLineDash([]);

      ctx.fillStyle = '#6b655a';
      ctx.fillRect(cx - bw / 2 - 4, cy - bh / 2 - 4, bw + 8, bh + 8);
      ctx.fillStyle = rng() < 0.5 ? '#8a4a3a' : '#4a5a6b';
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, cy);
      ctx.lineTo(cx + bw / 2, cy);
      ctx.moveTo(cx, cy - bh / 2);
      ctx.lineTo(cx, cy + bh / 2);
      ctx.stroke();
    }

    // border frame + coordinate ticks for map flavor
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px monospace';
    for (let i = 0; i <= 10; i++) {
      const gx = (w / 10) * i;
      ctx.fillText(String.fromCharCode(65 + i), gx + 2, 14);
    }
  }

  // ---------------------------------------------------------------------
  // Jigsaw edge geometry
  // ---------------------------------------------------------------------
  function buildEdgeData(rows, cols, rng) {
    const vEdges = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols - 1; c++) {
        row.push({
          sign: rng() < 0.5 ? -1 : 1,
          sizeJit: 0.8 + rng() * 0.4,
          centerJit: (rng() - 0.5) * 0.08,
        });
      }
      vEdges.push(row);
    }
    const hEdges = [];
    for (let r = 0; r < rows - 1; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({
          sign: rng() < 0.5 ? -1 : 1,
          sizeJit: 0.8 + rng() * 0.4,
          centerJit: (rng() - 0.5) * 0.08,
        });
      }
      hEdges.push(row);
    }
    return { vEdges, hEdges };
  }

  const TAB_RADIUS_FRACTION = 0.2;

  function edgePoints(P0, P1, edge, cellLen, reverse) {
    const dx = P1.x - P0.x, dy = P1.y - P0.y;
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const nx = uy, ny = -ux;
    const sign = edge ? edge.sign : 0;
    const centerJit = edge ? edge.centerJit : 0;
    // radiusFrac is both the half-width of the bump window AND its height
    // (as a fraction of the edge length), so the bump traces a true
    // half-circle instead of a squashed ellipse.
    const radiusFrac = edge ? TAB_RADIUS_FRACTION * edge.sizeJit : 0;
    const lo = 0.5 - radiusFrac + centerJit;
    const hi = 0.5 + radiusFrac + centerJit;
    const A = radiusFrac * cellLen;
    const N = 28;
    const seq = [];
    for (let i = 0; i <= N; i++) seq.push(i / N);
    const order = reverse ? seq.slice().reverse() : seq;
    const pts = [];
    for (const t of order) {
      let b = 0;
      if (edge && t > lo && t < hi) {
        const x = 2 * ((t - lo) / (hi - lo) - 0.5); // -1..1
        b = Math.sqrt(Math.max(0, 1 - x * x));
      }
      const off = sign * A * b;
      pts.push({ x: P0.x + ux * t * L + nx * off, y: P0.y + uy * t * L + ny * off });
    }
    return pts;
  }

  function buildPiecePolygon(r, c, rows, cols, cw, ch, edges) {
    const TL = { x: c * cw, y: r * ch };
    const TR = { x: (c + 1) * cw, y: r * ch };
    const BL = { x: c * cw, y: (r + 1) * ch };
    const BR = { x: (c + 1) * cw, y: (r + 1) * ch };

    let pts = [];
    if (r > 0) pts = pts.concat(edgePoints(TL, TR, edges.hEdges[r - 1][c], cw, false));
    else pts.push(TL, TR);

    if (c < cols - 1) pts = pts.concat(edgePoints(TR, BR, edges.vEdges[r][c], ch, false).slice(1));
    else pts.push(BR);

    if (r < rows - 1) pts = pts.concat(edgePoints(BL, BR, edges.hEdges[r][c], cw, true).slice(1));
    else pts.push(BL);

    if (c > 0) pts = pts.concat(edgePoints(TL, BL, edges.vEdges[r][c - 1], ch, true).slice(1));
    else pts.push(TL);

    return pts;
  }

  // ---------------------------------------------------------------------
  // Grid sizing to hit target piece count within [30,400]
  // ---------------------------------------------------------------------
  function computeGrid(target) {
    target = Math.max(30, Math.min(400, target | 0));
    const aspect = IMG_W / IMG_H;
    let best = null;
    for (let cols = 3; cols <= 60; cols++) {
      const rows = Math.round(cols / aspect);
      if (rows < 3) continue;
      const count = rows * cols;
      const diff = Math.abs(count - target);
      if (!best || diff < best.diff) best = { rows, cols, count, diff };
    }
    return best;
  }

  // ---------------------------------------------------------------------
  // Game setup
  // ---------------------------------------------------------------------
  function clearBoard() {
    el.piecesLayer.innerHTML = '';
    pieces = [];
    pieceGrid = [];
    placedCount = 0;
    totalCount = 0;
    consecutiveEdgeStreak = 0;
    edgeNoticeShown = false;
    nonEdgeStreak = 0;
    boardPlacementCount = 0;
    clearTimeout(toastHideTimer);
    el.toast.classList.add('hidden');
    toastVisible = false;
    el.completeOverlay.classList.add('hidden');
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    el.timerText.textContent = '00:00';
  }

  function startTimer() {
    startTime = Date.now();
    timerHandle = setInterval(() => {
      const s = Math.floor((Date.now() - startTime) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      el.timerText.textContent = `${mm}:${ss}`;
    }, 500);
  }

  async function newGame() {
    if (loading) return;
    loading = true;
    clearBoard();
    const target = parseInt(el.pieceCount.value, 10) || 50;

    let photo = null;
    try {
      photo = await loadImage('Images/' + encodeURIComponent(pickRandomImage()));
    } catch (e) {
      console.warn('Could not load a puzzle photo, using a generated scene instead.', e);
    }

    if (photo) {
      const aspect = photo.naturalWidth / photo.naturalHeight;
      IMG_H = Math.round(Math.sqrt(TARGET_IMAGE_AREA / aspect));
      IMG_W = Math.round(IMG_H * aspect);
    } else {
      IMG_W = 1600;
      IMG_H = 1100;
    }

    const { rows, cols, count } = computeGrid(target);
    totalCount = count;
    gridRows = rows;
    gridCols = cols;

    const seed = (Math.random() * 1e9) | 0;
    const rng = mulberry32(seed);

    // render source scene
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = IMG_W;
    srcCanvas.height = IMG_H;
    const sctx = srcCanvas.getContext('2d');
    if (photo) drawImageCover(sctx, photo, IMG_W, IMG_H);
    else generateScene(sctx, IMG_W, IMG_H, rng);

    el.refCanvas.width = IMG_W;
    el.refCanvas.height = IMG_H;
    el.refCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);

    // board visuals (left/top are set once BOARD_OFFSET is known, below)
    el.board.style.width = IMG_W + 'px';
    el.board.style.height = IMG_H + 'px';
    el.boardCanvas.width = IMG_W;
    el.boardCanvas.height = IMG_H;
    el.boardCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);
    applyGuideVisibility();

    const cw = IMG_W / cols, ch = IMG_H / rows;
    const edges = buildEdgeData(rows, cols, rng);

    // Scatter pieces in a ring hugging the board on every side, sized just
    // large enough to fit them all without overlapping the board itself —
    // so loose pieces are never on top of their destination, and never far
    // from it either, no matter the window size or piece count.
    const PACK_FACTOR = 1.8;
    const MIN_MARGIN = 160;
    const totalPieceArea = count * cw * ch * PACK_FACTOR;
    const perim = IMG_W + IMG_H;
    const margin = Math.max(
      MIN_MARGIN,
      (-perim + Math.sqrt(perim * perim + 4 * totalPieceArea)) / 4
    );

    BOARD_OFFSET = { x: margin, y: margin };
    el.board.style.left = BOARD_OFFSET.x + 'px';
    el.board.style.top = BOARD_OFFSET.y + 'px';

    const playfieldW = IMG_W + margin * 2;
    const playfieldH = IMG_H + margin * 2;

    el.playfield.style.width = playfieldW + 'px';
    el.playfield.style.height = playfieldH + 'px';
    el.playfield.style.transform = 'none';
    playfieldWLogical = playfieldW;
    playfieldHLogical = playfieldH;
    displayScale = 1;
    el.playfieldSizer.style.width = playfieldW + 'px';
    el.playfieldSizer.style.height = playfieldH + 'px';

    // Scale and center are settled now (before pieces scatter) so the
    // reference thumbnail's on-screen position can be converted into this
    // puzzle's logical coordinates below.
    fitAndCenterBoard();

    // Extends all the way up to the very top of the table (not just the
    // board's own edge), so pieces only ever scatter to the sides and
    // below the board — never in the strip above it, where the reference
    // thumbnail floats.
    const boardRect = {
      x: BOARD_OFFSET.x - 20,
      y: 0,
      w: IMG_W + 40,
      h: BOARD_OFFSET.y + IMG_H + 20,
    };

    function randomScatterPos(bbW, bbH) {
      for (let tries = 0; tries < 30; tries++) {
        const x = 10 + Math.random() * (playfieldW - bbW - 20);
        const y = 10 + Math.random() * (playfieldH - bbH - 20);
        if (
          x + bbW < boardRect.x ||
          x > boardRect.x + boardRect.w ||
          y + bbH < boardRect.y ||
          y > boardRect.y + boardRect.h
        ) {
          return { x, y };
        }
      }
      // Extremely unlikely fallback: hug the board's left edge directly.
      return { x: Math.max(5, boardRect.x - bbW - 5), y: 10 + Math.random() * (playfieldH - bbH - 20) };
    }

    const frag = document.createDocumentFragment();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const poly = buildPiecePolygon(r, c, rows, cols, cw, ch, edges);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of poly) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        const bw = Math.ceil(maxX - minX);
        const bh = Math.ceil(maxY - minY);

        const pc = document.createElement('canvas');
        pc.width = bw;
        pc.height = bh;
        const pctx = pc.getContext('2d');
        pctx.save();
        pctx.translate(-minX, -minY);
        pctx.beginPath();
        pctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) pctx.lineTo(poly[i].x, poly[i].y);
        pctx.closePath();
        pctx.save();
        pctx.clip();
        pctx.drawImage(srcCanvas, 0, 0);
        pctx.restore();
        pctx.lineWidth = 1.6;
        pctx.strokeStyle = 'rgba(0,0,0,0.35)';
        pctx.stroke();
        pctx.lineWidth = 0.8;
        pctx.strokeStyle = 'rgba(255,255,255,0.25)';
        pctx.stroke();
        pctx.restore();

        const correctX = BOARD_OFFSET.x + minX;
        const correctY = BOARD_OFFSET.y + minY;

        const pos = randomScatterPos(bw, bh);

        const div = document.createElement('div');
        div.className = 'piece';
        div.style.width = bw + 'px';
        div.style.height = bh + 'px';
        div.appendChild(pc);
        div.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

        const pieceObj = {
          r, c,
          el: div,
          w: bw, h: bh,
          x: pos.x, y: pos.y,
          correctX, correctY,
          solved: false,
          group: null,
        };
        pieceObj.group = { members: new Set([pieceObj]), fixed: false };
        pieces.push(pieceObj);
        if (!pieceGrid[r]) pieceGrid[r] = [];
        pieceGrid[r][c] = pieceObj;

        div.addEventListener('pointerdown', (ev) => onPointerDown(ev, pieceObj));
        frag.appendChild(div);
      }
    }

    el.piecesLayer.appendChild(frag);
    updateProgress();
    // Don't start the clock while the "How to Play" intro is still up —
    // it starts instead when the player dismisses it (see introOkBtn).
    if (el.introOverlay.classList.contains('hidden')) {
      startTimer();
    }
    loading = false;
  }

  function applyGuideVisibility() {
    el.boardCanvas.style.opacity = el.showGuide.checked ? '0.02' : '0';
  }

  function updateProgress() {
    el.progressText.textContent = `${placedCount} / ${totalCount} placed`;
    if (placedCount === totalCount && totalCount > 0) {
      onComplete();
    }
  }

  function onComplete() {
    if (timerHandle) clearInterval(timerHandle);
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const elapsed = el.timerText.textContent;
    el.completeStats.textContent = `${totalCount} pieces in ${elapsed}`;

    const entry = { name: playerName || 'Player', timeSeconds: elapsedSeconds, pieces: totalCount, date: Date.now() };
    const rank = recordLeaderboardEntry(entry);
    lastFinishedEntry = entry;
    el.completeRank.textContent = rank === 1
      ? `New fastest time — #1 on the leaderboard!`
      : `#${rank} fastest time on this leaderboard`;

    el.completeOverlay.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------
  // Drag / snap interaction (whole connected groups move together)
  // ---------------------------------------------------------------------
  const NEIGHBOR_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function popPiece(piece) {
    piece.el.classList.remove('snap-pop');
    void piece.el.offsetWidth; // restart the animation if it's already playing
    piece.el.classList.add('snap-pop');
  }

  function snapGroupToBoard(group) {
    let newlySolved = 0;
    for (const m of group.members) {
      m.x = m.correctX;
      m.y = m.correctY;
      m.el.style.transform = `translate(${m.x}px, ${m.y}px)`;
      m.el.style.zIndex = '1';
      popPiece(m);
      if (!m.solved) {
        m.solved = true;
        m.el.classList.add('solved');
        newlySolved++;
        notePiecePlacement(m);
      }
    }
    group.fixed = true;
    if (newlySolved > 0) {
      placedCount += newlySolved;
      updateProgress();
    }
  }

  function mergeGroupInto(target, source) {
    if (target === source) return;
    for (const p of source.members) {
      p.group = target;
      target.members.add(p);
    }
  }

  const DRAG_TILT_MAX = 26; // degrees
  const DRAG_TILT_SENSITIVITY = 1.7; // degrees of tilt per px of horizontal mouse movement
  const DRAG_TILT_SMOOTHING = 0.5; // how quickly the tilt catches up/settles each frame

  function onPointerDown(ev, piece) {
    if (ev.button !== 0) return; // left click only — right click pans the table
    if (piece.group.fixed) return;
    ev.preventDefault();
    const p = clientToLogical(ev.clientX, ev.clientY);
    dragInfo = {
      anchor: piece,
      group: piece.group,
      offsetX: p.x - piece.x,
      offsetY: p.y - piece.y,
      pointerId: ev.pointerId,
      lastClientX: ev.clientX,
      tilt: 0,
    };
    zTop++;
    for (const m of piece.group.members) {
      m.el.classList.add('dragging');
      m.el.style.zIndex = String(zTop);
    }
    try { piece.el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    piece.el.addEventListener('pointermove', onPointerMove);
    piece.el.addEventListener('pointerup', onPointerUp);
    piece.el.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(ev) {
    if (!dragInfo) return;
    const p = clientToLogical(ev.clientX, ev.clientY);
    const anchor = dragInfo.anchor;
    anchor.x = p.x - dragInfo.offsetX;
    anchor.y = p.y - dragInfo.offsetY;

    // Tilt the piece side to side based on how fast the cursor is moving
    // horizontally, like it's swinging slightly as it's carried — eases
    // back toward level when the mouse slows or stops.
    const dx = ev.clientX - dragInfo.lastClientX;
    dragInfo.lastClientX = ev.clientX;
    const targetTilt = Math.max(-DRAG_TILT_MAX, Math.min(DRAG_TILT_MAX, dx * DRAG_TILT_SENSITIVITY));
    dragInfo.tilt += (targetTilt - dragInfo.tilt) * DRAG_TILT_SMOOTHING;

    // A connected cluster swings as one rigid piece: every other member's
    // offset from the anchor is itself rotated by the current tilt, instead
    // of each piece spinning independently around its own center.
    const rad = (dragInfo.tilt * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);

    for (const m of dragInfo.group.members) {
      if (m !== anchor) {
        const ox = m.correctX - anchor.correctX;
        const oy = m.correctY - anchor.correctY;
        m.x = anchor.x + (ox * cos - oy * sin);
        m.y = anchor.y + (ox * sin + oy * cos);
      }
      m.el.style.transform = `translate(${m.x}px, ${m.y}px) rotate(${dragInfo.tilt.toFixed(2)}deg)`;
    }
    trySnapWhileDragging();
  }

  function endDrag() {
    const { anchor, group } = dragInfo;
    for (const m of group.members) {
      m.el.classList.remove('dragging');
      // Other members were tracking a tilt-rotated offset from the anchor;
      // put them back on their correct unrotated offset now that the tilt
      // is being dropped back to flat.
      if (m !== anchor) {
        m.x = anchor.x + (m.correctX - anchor.correctX);
        m.y = anchor.y + (m.correctY - anchor.correctY);
      }
      // Settle back to level (drop the mid-drag tilt) with a quick ease
      // instead of snapping flat instantly.
      m.el.style.transition = 'transform 0.25s ease';
      m.el.style.transform = `translate(${m.x}px, ${m.y}px)`;
      setTimeout(() => { m.el.style.transition = ''; }, 260);
    }
    anchor.el.removeEventListener('pointermove', onPointerMove);
    anchor.el.removeEventListener('pointerup', onPointerUp);
    anchor.el.removeEventListener('pointercancel', onPointerUp);
    dragInfo = null;
  }

  // Checked continuously while a piece is held, so it snaps the moment it
  // reaches its board slot or a matching neighbor — no need to let go first.
  function trySnapWhileDragging() {
    const { anchor, group } = dragInfo;

    if (Math.hypot(anchor.x - anchor.correctX, anchor.y - anchor.correctY) < SNAP_DIST) {
      endDrag();
      snapGroupToBoard(group);
      return;
    }

    for (const [dr, dc] of NEIGHBOR_DIRS) {
      const row = pieceGrid[anchor.r + dr];
      const neighbor = row ? row[anchor.c + dc] : undefined;
      if (!neighbor || neighbor.group === group) continue;

      const expX = anchor.x + (neighbor.correctX - anchor.correctX);
      const expY = anchor.y + (neighbor.correctY - anchor.correctY);
      if (Math.hypot(neighbor.x - expX, neighbor.y - expY) >= SNAP_DIST) continue;

      if (neighbor.group.fixed) {
        endDrag();
        snapGroupToBoard(group);
        return;
      }

      const ndx = expX - neighbor.x, ndy = expY - neighbor.y;
      for (const q of neighbor.group.members) {
        q.x += ndx;
        q.y += ndy;
        q.el.style.transform = `translate(${q.x}px, ${q.y}px)`;
        popPiece(q);
        noteConnectionStreak(q);
      }
      popPiece(anchor);
      mergeGroupInto(group, neighbor.group);
    }
  }

  function onPointerUp() {
    if (!dragInfo) return;
    trySnapWhileDragging();
    if (dragInfo) endDrag();
  }

  function shuffleRemaining() {
    const playfieldW = parseFloat(el.playfield.style.width);
    const playfieldH = parseFloat(el.playfield.style.height);
    // Same top-extended exclusion as the initial scatter, so shuffling
    // never drops a piece above the board either.
    const boardRect = {
      x: BOARD_OFFSET.x - 20,
      y: 0,
      w: IMG_W + 40,
      h: BOARD_OFFSET.y + IMG_H + 20,
    };

    const seenGroups = new Set();
    for (const piece of pieces) {
      if (piece.group.fixed || seenGroups.has(piece.group)) continue;
      seenGroups.add(piece.group);

      const members = [...piece.group.members];
      const ref = members[0];
      let minRX = Infinity, minRY = Infinity, maxRX = -Infinity, maxRY = -Infinity;
      for (const m of members) {
        const rx = m.correctX - ref.correctX, ry = m.correctY - ref.correctY;
        minRX = Math.min(minRX, rx);
        minRY = Math.min(minRY, ry);
        maxRX = Math.max(maxRX, rx + m.w);
        maxRY = Math.max(maxRY, ry + m.h);
      }
      const bw = maxRX - minRX, bh = maxRY - minRY;

      function overlapsBoard(x, y) {
        return (
          x + minRX + bw > boardRect.x &&
          x + minRX < boardRect.x + boardRect.w &&
          y + minRY + bh > boardRect.y &&
          y + minRY < boardRect.y + boardRect.h
        );
      }

      let refX, refY, tries = 0;
      do {
        refX = 10 - minRX + Math.random() * (playfieldW - bw - 20);
        refY = 10 - minRY + Math.random() * (playfieldH - bh - 20);
        tries++;
      } while (tries < 30 && overlapsBoard(refX, refY));

      if (overlapsBoard(refX, refY)) {
        // Still overlapping after every try (a very tall exclusion zone can
        // squeeze the open area): hug the board's right edge instead.
        refX = boardRect.x + boardRect.w + 10 - minRX;
        refY = 10 - minRY + Math.random() * (playfieldH - bh - 20);
      }

      for (const m of members) {
        m.x = refX + (m.correctX - ref.correctX);
        m.y = refY + (m.correctY - ref.correctY);
        m.el.style.transform = `translate(${m.x}px, ${m.y}px)`;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Right-click drag to pan the table (left click is reserved for pieces)
  // ---------------------------------------------------------------------
  let panInfo = null;

  el.playfieldWrap.addEventListener('contextmenu', (ev) => ev.preventDefault());

  el.playfieldWrap.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 2) return;
    ev.preventDefault();
    panInfo = {
      startX: ev.clientX,
      startY: ev.clientY,
      startScrollLeft: el.playfieldWrap.scrollLeft,
      startScrollTop: el.playfieldWrap.scrollTop,
      pointerId: ev.pointerId,
    };
    el.playfieldWrap.classList.add('panning');
    try { el.playfieldWrap.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });

  el.playfieldWrap.addEventListener('pointermove', (ev) => {
    if (!panInfo) return;
    el.playfieldWrap.scrollLeft = panInfo.startScrollLeft - (ev.clientX - panInfo.startX);
    el.playfieldWrap.scrollTop = panInfo.startScrollTop - (ev.clientY - panInfo.startY);
  });

  function endPan() {
    if (!panInfo) return;
    panInfo = null;
    el.playfieldWrap.classList.remove('panning');
  }
  el.playfieldWrap.addEventListener('pointerup', endPan);
  el.playfieldWrap.addEventListener('pointercancel', endPan);

  // ---------------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------------
  el.newGameBtn.addEventListener('click', newGame);
  el.shuffleBtn.addEventListener('click', shuffleRemaining);
  el.playAgainBtn.addEventListener('click', newGame);
  el.introOkBtn.addEventListener('click', () => {
    const typed = el.playerNameInput.value.trim();
    if (!typed) {
      el.playerNameInput.focus();
      showToast('Enter your name to start playing.');
      return;
    }
    playerName = typed.slice(0, 20);
    localStorage.setItem(PLAYER_NAME_KEY, playerName);
    el.introOverlay.classList.add('hidden');
    if (!timerHandle) startTimer();
  });
  el.playerNameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') el.introOkBtn.click();
  });
  el.showGuide.addEventListener('change', applyGuideVisibility);
  el.showRef.addEventListener('change', () => {
    el.refPanel.classList.toggle('hidden', !el.showRef.checked);
  });

  newGame();
})();
