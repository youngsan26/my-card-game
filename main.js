const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const movesEl = document.getElementById("moves");
const matchesEl = document.getElementById("matches");
const timeEl = document.getElementById("time");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");
const boardWrapper = document.querySelector(".board-wrapper");
const playerNameInput = document.getElementById("playerName");
const bestMovesEl = document.getElementById("bestMoves");
const bestTimeEl = document.getElementById("bestTime");
const leaderboardEl = document.getElementById("leaderboard");
const leaderboardHint = document.getElementById("leaderboardHint");
const refreshLeaderboardBtn = document.getElementById("refreshLeaderboard");
const leaderboardModal = document.getElementById("leaderboardModal");
const closeLeaderboardBtn = document.getElementById("closeLeaderboard");
const flipSpeedInput = document.getElementById("flipSpeed");
const flipSpeedValue = document.getElementById("flipSpeedValue");

const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
const SUPABASE_URL = SUPABASE_CONFIG.url || "";
const SUPABASE_PUBLIC_KEY = SUPABASE_CONFIG.anonKey || "";
const SCORES_TABLE = "scores";
const supabaseClient =
  SUPABASE_URL && SUPABASE_PUBLIC_KEY && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY)
    : null;

if (!supabaseClient) {
  console.warn(
    "Supabase client not initialized. Add config.js with URL/key and ensure CDN script loads."
  );
} else {
  console.info("Supabase client initialized.", SUPABASE_URL);
}

const rows = 4;
const cols = 4;
const pairCount = (rows * cols) / 2;
const bestKey = `memory-best-${rows}x${cols}`;

const layout = {
  padding: 24,
  gap: 16,
  cardWidth: 110,
  cardHeight: 140,
};

let cards = [];
let selected = [];
let moves = 0;
let matches = 0;
let startTime = null;
let lastTime = null;
let resolving = false;
let pendingUnflip = false;
let gameOver = false;
let endTime = null;
let lastElapsedMs = 0;
let scoreSubmitted = false;
let lastSubmittedSignature = "";
let nameReady = false;
let gameStarted = false;
let leaderboardLoading = false;
const refreshLabel = "Refresh";
const leaderboardRefreshMs = 10000;
let unflipDeadline = 0;
let resolveTimer = null;
let flipSpeed = 2.6;
let pendingPair = null;
let singleFlipTimer = null;
const singleFlipDelayMs = 900;
let flipGlow = 0;

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function buildDeck() {
  const values = [];
  for (let i = 1; i <= pairCount; i += 1) {
    values.push(i, i);
  }
  shuffle(values);

  const deck = [];
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x =
        layout.padding + c * (layout.cardWidth + layout.gap);
      const y =
        layout.padding + r * (layout.cardHeight + layout.gap);
      deck.push({
        id: index,
        row: r,
        col: c,
        x,
        y,
        width: layout.cardWidth,
        height: layout.cardHeight,
        value: values[index],
        faceUp: false,
        matched: false,
        flipProgress: 0,
        flipping: false,
        targetFaceUp: false,
        pulse: 0,
      });
      index += 1;
    }
  }
  return deck;
}

function resizeCanvas() {
  const boardWidth =
    cols * layout.cardWidth + (cols - 1) * layout.gap;
  const boardHeight =
    rows * layout.cardHeight + (rows - 1) * layout.gap;
  const cssWidth = boardWidth + layout.padding * 2;
  const cssHeight = boardHeight + layout.padding * 2;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  const availableWidth = boardWrapper ? boardWrapper.clientWidth : cssWidth;
  const scale = Math.min(1, availableWidth / cssWidth);
  canvas.style.width = `${cssWidth * scale}px`;
  canvas.style.height = `${cssHeight * scale}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function flipTo(card, faceUp) {
  card.targetFaceUp = faceUp;
  card.flipping = true;
  card.pulse = 1;
}

function forceFaceUp(card) {
  card.targetFaceUp = true;
  card.faceUp = true;
  card.flipProgress = 1;
  card.flipping = false;
}

function syncFlipSpeed() {
  if (!flipSpeedInput) return;
  flipSpeed = Number.parseFloat(flipSpeedInput.value) || 2.6;
  if (flipSpeedValue) {
    flipSpeedValue.textContent = `${flipSpeed.toFixed(1)}x`;
  }
}

function resetGame() {
  cards = buildDeck();
  selected = [];
  moves = 0;
  matches = 0;
  resolving = false;
  pendingUnflip = false;
  unflipDeadline = 0;
  pendingPair = null;
  if (singleFlipTimer) {
    clearTimeout(singleFlipTimer);
    singleFlipTimer = null;
  }
  if (resolveTimer) {
    clearTimeout(resolveTimer);
    resolveTimer = null;
  }
  startTime = null;
  lastTime = null;
  gameOver = false;
  endTime = null;
  lastElapsedMs = 0;
  scoreSubmitted = false;
  nameReady = false;
  gameStarted = false;
  movesEl.textContent = "0";
  matchesEl.textContent = "0";
  statusEl.textContent = "Enter your name to start.";
  ensurePlayerName();
  closeLeaderboardModal();
}

function toCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: ((event.clientX - rect.left) * scaleX) / (window.devicePixelRatio || 1),
    y: ((event.clientY - rect.top) * scaleY) / (window.devicePixelRatio || 1),
  };
}

function handleClick(event) {
  if (!ensurePlayerName()) return;
  syncFlipSpeed();
  startTimerIfNeeded();
  if (resolving) return;
  const point = toCanvasPoint(event);
  const card = cards.find(
    (item) =>
      point.x >= item.x &&
      point.x <= item.x + item.width &&
      point.y >= item.y &&
      point.y <= item.y + item.height
  );
  if (!card || card.matched || card.faceUp || card.flipping) return;
  if (selected.includes(card)) return;

  flipTo(card, true);
  flipGlow = 1;
  selected.push(card);

  if (selected.length === 1) {
    if (singleFlipTimer) {
      clearTimeout(singleFlipTimer);
    }
    singleFlipTimer = setTimeout(() => {
      if (selected.length === 1 && !selected[0].matched) {
        const [onlyCard] = selected;
        selected = [];
        flipTo(onlyCard, false);
      }
    }, singleFlipDelayMs);
  }

  if (selected.length === 2) {
    const [first, second] = selected;
    if (singleFlipTimer) {
      clearTimeout(singleFlipTimer);
      singleFlipTimer = null;
    }
    forceFaceUp(first);
    forceFaceUp(second);
    moves += 1;
    movesEl.textContent = String(moves);
    resolving = true;
    if (resolveTimer) {
      clearTimeout(resolveTimer);
    }
    resolveTimer = setTimeout(() => {
      if (first.value === second.value) {
        first.matched = true;
        second.matched = true;
        matches += 1;
        matchesEl.textContent = String(matches);
        selected = [];
        resolving = false;
        if (matches === pairCount) {
          finishGame();
        }
      } else {
        pendingUnflip = true;
        unflipDeadline = performance.now() + 700;
        pendingPair = [first, second];
        selected = [];
        flipTo(first, false);
        flipTo(second, false);
      }
    }, 600);
  }
}

function update(delta) {
  const speed = flipSpeed;
  for (const card of cards) {
    if (!card.flipping) continue;
    const dir = card.targetFaceUp ? 1 : -1;
    card.flipProgress += dir * speed * delta;
    if (card.flipProgress >= 1) {
      card.flipProgress = 1;
      card.faceUp = true;
      card.flipping = false;
    } else if (card.flipProgress <= 0) {
      card.flipProgress = 0;
      card.faceUp = false;
      card.flipping = false;
    }
  }

  for (const card of cards) {
    if (card.pulse > 0) {
      card.pulse = Math.max(0, card.pulse - delta * 3.5);
    }
  }

  if (flipGlow > 0) {
    flipGlow = Math.max(0, flipGlow - delta * 2);
  }

  for (const card of cards) {
    if (!card.flipping && !card.targetFaceUp && card.faceUp) {
      card.faceUp = false;
      card.flipProgress = 0;
    }
  }

  const now = performance.now();
  if (pendingUnflip && pendingPair) {
    const done = pendingPair.every(
      (card) => !card.flipping && !card.faceUp
    );
    if (done) {
      pendingUnflip = false;
      resolving = false;
      pendingPair = null;
    } else if (unflipDeadline && now >= unflipDeadline) {
      for (const card of pendingPair) {
        card.faceUp = false;
        card.flipProgress = 0;
        card.flipping = false;
        card.targetFaceUp = false;
      }
      pendingUnflip = false;
      resolving = false;
      pendingPair = null;
    }
  }

  const elapsedMs = startTime
    ? (gameOver ? endTime - startTime : now - startTime)
    : 0;
  lastElapsedMs = elapsedMs;
  timeEl.textContent = formatTime(elapsedMs);
}

function drawRoundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawCard(card) {
  const cx = card.x + card.width / 2;
  const cy = card.y + card.height / 2;
  const scaleX = Math.max(
    0.02,
    Math.abs(Math.cos(card.flipProgress * Math.PI))
  );
  const showFront = card.flipping
    ? card.flipProgress > 0.5
    : card.faceUp;
  const pulseScale = 1 + card.pulse * 0.06;
  const glowStrength = card.pulse * 0.8;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scaleX * pulseScale, 1 * pulseScale);
  ctx.translate(-card.width / 2, -card.height / 2);

  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;

  if (showFront || card.matched) {
    ctx.fillStyle = card.matched ? "#22c55e" : "#e2e8f0";
    drawRoundedRect(0, 0, card.width, card.height, 14);
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = "600 36px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(card.value), card.width / 2, card.height / 2);
  } else {
    const backGradient = ctx.createLinearGradient(0, 0, card.width, card.height);
    backGradient.addColorStop(0, "#2563eb");
    backGradient.addColorStop(0.5, "#22c55e");
    backGradient.addColorStop(1, "#f59e0b");
    ctx.fillStyle = backGradient;
    drawRoundedRect(0, 0, card.width, card.height, 14);
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#e2e8f0";
    const dotSpacing = 18;
    const dotRadius = 2.4;
    for (let y = 12; y < card.height - 8; y += dotSpacing) {
      for (let x = 12; x < card.width - 8; x += dotSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    drawRoundedRect(10, 10, card.width - 20, card.height - 20, 10);
    ctx.fill();

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 26px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", card.width / 2, card.height / 2);
  }

  if (glowStrength > 0.05) {
    ctx.globalAlpha = glowStrength;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#38bdf8";
    drawRoundedRect(3, 3, card.width - 6, card.height - 6, 12);
    ctx.stroke();
  }

  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (flipGlow > 0) {
    ctx.save();
    ctx.globalAlpha = 0.25 * flipGlow;
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 6;
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#38bdf8";
    ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    ctx.restore();
  }

  for (const card of cards) {
    drawCard(card);
  }
}

function loop(timestamp) {
  if (lastTime == null) {
    lastTime = timestamp;
  }
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  update(delta);
  draw();
  requestAnimationFrame(loop);
}

canvas.addEventListener("click", handleClick);
restartBtn.addEventListener("click", resetGame);
window.addEventListener("resize", resizeCanvas);
playerNameInput.addEventListener("input", ensurePlayerName);
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (ensurePlayerName()) {
    startTimerIfNeeded();
    playerNameInput.blur();
  }
});
if (flipSpeedInput) {
  syncFlipSpeed();
  flipSpeedInput.addEventListener("input", syncFlipSpeed);
  flipSpeedInput.addEventListener("change", syncFlipSpeed);
}
if (refreshLeaderboardBtn) {
  refreshLeaderboardBtn.addEventListener("click", () => {
    loadLeaderboard();
  });
}
if (closeLeaderboardBtn) {
  closeLeaderboardBtn.addEventListener("click", () => {
    closeLeaderboardModal();
  });
}
if (leaderboardModal) {
  leaderboardModal.addEventListener("click", (event) => {
    if (event.target === leaderboardModal) {
      closeLeaderboardModal();
    }
  });
}
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLeaderboardModal();
  }
});

resizeCanvas();
resetGame();
loadBest();
loadLeaderboard();
setInterval(() => {
  if (document.hidden) return;
  loadLeaderboard();
}, leaderboardRefreshMs);
requestAnimationFrame(loop);

function formatTime(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function loadBest() {
  const stored = localStorage.getItem(bestKey);
  if (!stored) {
    bestMovesEl.textContent = "-";
    bestTimeEl.textContent = "-";
    return;
  }
  try {
    const best = JSON.parse(stored);
    updateBestUI(best);
  } catch (error) {
    bestMovesEl.textContent = "-";
    bestTimeEl.textContent = "-";
  }
}

function updateBestUI(best) {
  bestMovesEl.textContent = String(best.moves);
  bestTimeEl.textContent = formatTime(best.timeMs);
}

function maybeUpdateBest() {
  const stored = localStorage.getItem(bestKey);
  const current = { moves, timeMs: lastElapsedMs };
  if (!stored) {
    localStorage.setItem(bestKey, JSON.stringify(current));
    updateBestUI(current);
    return;
  }
  try {
    const best = JSON.parse(stored);
    const better =
      current.timeMs < best.timeMs ||
      (current.timeMs === best.timeMs && current.moves < best.moves);
    if (better) {
      localStorage.setItem(bestKey, JSON.stringify(current));
      updateBestUI(current);
    }
  } catch (error) {
    localStorage.setItem(bestKey, JSON.stringify(current));
    updateBestUI(current);
  }
}

function finishGame() {
  if (gameOver) return;
  gameOver = true;
  endTime = performance.now();
  statusEl.textContent = "You won! Restart to play again.";
  maybeUpdateBest();
  submitScore();
  openLeaderboardModal();
}

function openLeaderboardModal() {
  if (!leaderboardModal) return;
  leaderboardModal.classList.add("is-open");
  leaderboardModal.setAttribute("aria-hidden", "false");
}

function closeLeaderboardModal() {
  if (!leaderboardModal) return;
  leaderboardModal.classList.remove("is-open");
  leaderboardModal.setAttribute("aria-hidden", "true");
}

function getPlayerName() {
  const raw = playerNameInput.value.trim();
  const normalized = raw.replace(/\s+/g, " ");
  const safe = normalized.replace(/[^\w\s\-가-힣]/g, "");
  return safe ? safe.slice(0, 12) : "Player";
}

function ensurePlayerName() {
  const raw = playerNameInput.value.trim();
  if (!raw) {
    nameReady = false;
    statusEl.textContent = "Enter your name to start.";
    playerNameInput.focus();
    return false;
  }
  nameReady = true;
  if (!gameOver && moves === 0 && matches === 0) {
    statusEl.textContent = "Find all pairs.";
  }
  return true;
}

function startTimerIfNeeded() {
  if (gameStarted || gameOver) return;
  startTime = performance.now();
  lastTime = null;
  gameStarted = true;
}

function setLeaderboardHint(visible) {
  leaderboardHint.style.display = visible ? "block" : "none";
}

function setLeaderboardMessage(message) {
  leaderboardHint.textContent = message;
  setLeaderboardHint(true);
}

function setLeaderboardLoadingState(isLoading) {
  if (!refreshLeaderboardBtn) return;
  refreshLeaderboardBtn.disabled = isLoading;
  refreshLeaderboardBtn.textContent = isLoading ? "Loading..." : refreshLabel;
}

function renderLeaderboard(rowsData) {
  leaderboardEl.innerHTML = "";
  rowsData.forEach((row, index) => {
    const item = document.createElement("li");
    const name = row.player_name || "Player";
    item.innerHTML = `
      <span>#${index + 1}</span>
      <span>${name}</span>
      <span>${formatTime(row.time_ms)}</span>
      <span>${row.moves}</span>
    `;
    leaderboardEl.appendChild(item);
  });
}

async function loadLeaderboard() {
  if (!supabaseClient) {
    setLeaderboardMessage("Connect Supabase to enable ranking.");
    return;
  }
  if (leaderboardLoading) return;
  leaderboardLoading = true;
  setLeaderboardLoadingState(true);
  leaderboardEl.innerHTML = "";
  setLeaderboardMessage("Loading leaderboard...");
  const { data, error } = await supabaseClient
    .from(SCORES_TABLE)
    .select("player_name, moves, time_ms")
    .eq("board_size", rows * cols)
    .order("time_ms", { ascending: true })
    .order("moves", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10);
  leaderboardLoading = false;
  setLeaderboardLoadingState(false);
  if (error) {
    setLeaderboardMessage("Leaderboard unavailable.");
    return;
  }
  if (!data || data.length === 0) {
    setLeaderboardMessage("No scores yet.");
    return;
  }
  setLeaderboardHint(false);
  renderLeaderboard(data || []);
}

async function submitScore() {
  if (!supabaseClient || scoreSubmitted) return;
  const payload = {
    player_name: getPlayerName(),
    moves,
    time_ms: Math.round(lastElapsedMs),
    board_size: rows * cols,
  };
  const signature = `${payload.player_name}-${payload.moves}-${payload.time_ms}`;
  if (signature === lastSubmittedSignature) return;
  const { error } = await supabaseClient.from(SCORES_TABLE).insert(payload);
  if (error) {
    scoreSubmitted = false;
    statusEl.textContent = "Score not saved. Try again.";
    return;
  }
  scoreSubmitted = true;
  lastSubmittedSignature = signature;
  loadLeaderboard();
}
