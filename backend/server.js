/**
 * ╔══════════════════════════════════════════════╗
 * ║         MOON RUSH — Production Server        ║
 * ║   Node.js + Express + Socket.io + Firebase   ║
 * ║        TikTok Live Connector + PK Battle     ║
 * ╚══════════════════════════════════════════════╝
 */

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const admin      = require('firebase-admin');
const { WebcastPushConnection } = require('tiktok-live-connector');

// ─────────────────────────────────────────
//  FIREBASE INIT
// ─────────────────────────────────────────
const fs = require('fs');
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
let credential;

if (fs.existsSync(serviceAccountPath)) {
  credential = admin.credential.cert(require(serviceAccountPath));
} else {
  credential = admin.credential.cert({
    projectId:    process.env.FIREBASE_PROJECT_ID,
    privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
  });
}
admin.initializeApp({ credential });
const db = admin.firestore();

// ─────────────────────────────────────────
//  EXPRESS + SOCKET.IO
// ─────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ─────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────
const MAX_TOKENS     = 2000;
const RENEWAL_HOURS  = 24;
const LIKE_VALUE     = 0.5;   // 0.5 token per like tap
// Gift coins = exact tokens (1 TikTok coin = 1 game token)

// ─────────────────────────────────────────
//  PLAYER HELPERS (Firebase)
// ─────────────────────────────────────────
async function getPlayer(userId) {
  const doc = await db.collection('players').doc(userId).get();
  if (!doc.exists) return null;
  return doc.data();
}

async function createPlayer(userId, username, role, avatar = '🚀') {
  const player = {
    userId, username, role, avatar,
    tokens:       MAX_TOKENS,
    likeBuffer:   0,           // accumulates 0.5 per tap
    streak:       0,
    bestStreak:   0,
    bestMult:     0,
    totalWins:    0,
    chalWins:     0,
    totalLost:    0,
    createdAt:    Date.now(),
    lastRenewal:  Date.now(),
    lastLogin:    Date.now(),
  };
  await db.collection('players').doc(userId).set(player);
  return player;
}

async function savePlayer(player) {
  await db.collection('players').doc(player.userId).update(player);
}

async function checkAndRenew(player) {
  // Only renew when tokens are exactly 0, and 24h have passed since they ran out
  if (player.tokens > 0) return false;
  if (!player.lastDepletedAt) {
    player.lastDepletedAt = Date.now(); // start 24h clock for existing players at 0
    await savePlayer(player);
    return false;
  }
  const hoursSinceDepleted = (Date.now() - player.lastDepletedAt) / 3600000;
  if (hoursSinceDepleted >= RENEWAL_HOURS) {
    player.tokens        = MAX_TOKENS;
    player.lastRenewal  = Date.now();
    player.lastDepletedAt = null;
    await savePlayer(player);
    return true;
  }
  return false;
}

// Daily login bonus — 100 tokens if not claimed today
async function claimDailyBonus(player) {
  const now       = new Date();
  const today     = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const lastBonus = player.lastBonusDate || '';
  if (lastBonus !== today) {
    player.tokens        += 100;
    player.lastBonusDate  = today;
    await savePlayer(player);
    return 100;
  }
  return 0;
}

// ─────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────
let gamePhase      = 'countdown';
let countdownVal   = 5;
let currentMult    = 1.00;
let crashPoint     = 1.00;
let roundStartTime = null;
let countdownTimer = null;
let flyInterval    = null;
let roundNumber    = 0;
const activeBets   = new Map();   // userId → bet object
const roundHistory = [];

// Spribe 97% RTP crash formula
function generateCrashPoint() {
  let r = Math.random();
  if (r >= 0.97) r = 0.9699;
  return Math.max(1.00, Math.round((0.97 / (1 - r)) * 100) / 100);
}

// Multiplier growth — matches real Aviator speed
function calcMult(ms) {
  return Math.max(1.00, Math.round(Math.exp(ms / 10500) * 100) / 100);
}

function startCountdown() {
  gamePhase    = 'countdown';
  countdownVal = 5;
  currentMult  = 1.00;
  crashPoint   = generateCrashPoint();
  activeBets.clear();
  roundNumber++;
  io.emit('game:countdown', { val: countdownVal, roundNumber });
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownVal--;
    io.emit('game:countdown', { val: countdownVal, roundNumber });
    if (countdownVal <= 0) {
      clearInterval(countdownTimer);
      startFlying();
    }
  }, 1000);
}

function startFlying() {
  gamePhase      = 'flying';
  roundStartTime = Date.now();
  io.emit('game:flying', { roundNumber });
  clearInterval(flyInterval);
  flyInterval = setInterval(() => {
    const elapsed = Date.now() - roundStartTime;
    currentMult   = calcMult(elapsed);
    io.emit('game:tick', { mult: currentMult });
    // Auto-cashouts
    for (const [userId, bet] of activeBets) {
      if (!bet.cashedOut && bet.autoCashout && currentMult >= bet.autoCashout) {
        processCashout(userId, currentMult);
      }
    }
    if (currentMult >= crashPoint) {
      clearInterval(flyInterval);
      processCrash();
    }
  }, 100);
}

function processCrash() {
  gamePhase = 'crashed';
  // Mark all un-cashed bets as lost
  for (const [userId, bet] of activeBets) {
    if (!bet.cashedOut) {
      getPlayer(userId).then(player => {
        if (player) {
          player.streak    = 0;
          player.totalLost = (player.totalLost || 0) + bet.amount;
          savePlayer(player);
          io.to(userId).emit('bet:lost', { amount: bet.amount, mult: currentMult });
        }
      });
    }
  }
  roundHistory.unshift({ mult: currentMult, roundNumber, ts: Date.now() });
  if (roundHistory.length > 50) roundHistory.pop();
  io.emit('game:crashed', { mult: currentMult, roundNumber });
  // Send round summary to each invite room so friends can compare
  for (const [roomCode] of inviteRooms) {
    const summary = buildInviteRoundSummary(roomCode, currentMult);
    if (summary) io.to(`invite_${roomCode}`).emit('invite:round_summary', summary);
  }
  setTimeout(startCountdown, 3000);
}

async function processCashout(userId, mult) {
  const bet = activeBets.get(userId);
  if (!bet || bet.cashedOut) return;
  bet.cashedOut    = true;
  bet.cashoutMult  = mult;
  const winAmount  = Math.round(bet.amount * mult);
  const player     = await getPlayer(userId);
  if (player) {
    player.tokens     += winAmount;
    player.totalWins++;
    player.streak++;
    if (player.streak > player.bestStreak) player.bestStreak = player.streak;
    if (mult > player.bestMult)            player.bestMult   = mult;
    await savePlayer(player);
    io.to(userId).emit('bet:won', {
      amount: bet.amount, mult, winAmount,
      tokens: player.tokens, streak: player.streak
    });
  }
}

// ─────────────────────────────────────────
//  PK BATTLE STATE
// ─────────────────────────────────────────
const pkRooms = new Map(); // roomId → pk state

function createPKRoom(roomId, p1Id, p2Id, durationSecs) {
  const room = {
    roomId, p1Id, p2Id,
    durationSecs,
    timeLeft:   durationSecs,
    p1Lost:     0,
    p2Lost:     0,
    p1Tokens:   2000,
    p2Tokens:   2000,
    p1Gifts:    0,
    p2Gifts:    0,
    phase:      'countdown',
    timer:      null,
    roundHist:  [],
  };
  pkRooms.set(roomId, room);
  return room;
}

function startPKBattle(roomId) {
  const room = pkRooms.get(roomId);
  if (!room) return;
  room.phase  = 'battle';
  room.timer  = setInterval(() => {
    room.timeLeft--;
    io.to(roomId).emit('pk:tick', {
      timeLeft: room.timeLeft,
      p1Lost:   room.p1Lost,
      p2Lost:   room.p2Lost,
      p1Tokens: room.p1Tokens,
      p2Tokens: room.p2Tokens,
      p1Gifts:  room.p1Gifts,
      p2Gifts:  room.p2Gifts,
    });
    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      endPKBattle(roomId);
    }
  }, 1000);
}

function endPKBattle(roomId) {
  const room = pkRooms.get(roomId);
  if (!room) return;
  room.phase = 'ended';
  const PUNISHMENTS = [
    { icon: '🎤', title: 'Sing a Song!',        desc: 'Must sing a full song on camera!' },
    { icon: '💃', title: 'Dance 30 Seconds!',    desc: 'Full energy dance on camera now!' },
    { icon: '🌶️', title: 'Eat the Chilli!',      desc: 'Raw chilli on camera — no water!' },
    { icon: '🐔', title: 'Chicken Dance!',        desc: 'Full chicken dance — flap those arms!' },
    { icon: '📞', title: 'Call Someone Live!',    desc: 'Call a contact on speaker and confess you lost!' },
    { icon: '🤡', title: 'Wear Funny Hat!',       desc: 'Wear a silly costume for the rest of the live!' },
    { icon: '😂', title: 'Tell 3 Jokes!',         desc: 'Tell 3 jokes — if viewers don\'t laugh, go again!' },
    { icon: '🧊', title: 'Ice Bucket!',           desc: 'Ice bucket over the head. Right now. On camera.' },
  ];
  const pun        = PUNISHMENTS[Math.floor(Math.random() * PUNISHMENTS.length)];
  const p1Wins     = room.p1Lost <= room.p2Lost;
  const draw       = room.p1Lost === room.p2Lost;
  const loser      = draw ? null : (p1Wins ? room.p2Id : room.p1Id);
  io.to(roomId).emit('pk:ended', {
    p1Lost: room.p1Lost, p2Lost: room.p2Lost,
    p1Wins, draw, loser, punishment: pun
  });
  pkRooms.delete(roomId);
}

// ─────────────────────────────────────────
//  INVITE ROOMS (play with friends via link — no TikTok needed)
// ─────────────────────────────────────────
const INVITE_ROOM_MAX = 10;
const inviteRooms    = new Map(); // roomCode → { hostId, members: [{ userId, username }], createdAt }
const userToInviteRoom = new Map(); // userId → roomCode

function genInviteCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return inviteRooms.has(code) ? genInviteCode() : code;
}

function buildInviteRoundSummary(roomCode, crashMult) {
  const room = inviteRooms.get(roomCode);
  if (!room) return null;
  const results = room.members.map(({ userId, username }) => {
    const bet = activeBets.get(userId);
    if (!bet) return { userId, username, outcome: 'no_bet' };
    if (bet.cashedOut) return { userId, username, outcome: 'cashed_out', mult: bet.cashoutMult, winAmount: Math.round(bet.amount * bet.cashoutMult) };
    return { userId, username, outcome: 'crashed', mult: crashMult };
  });
  return { roomCode, crashMult, results };
}

// ─────────────────────────────────────────
//  REST API
// ─────────────────────────────────────────
// Register new player
app.post('/api/auth/register', async (req, res) => {
  try {
    const { userId, username, role, avatar, pin } = req.body;
    if (!userId || !username || !role) return res.status(400).json({ error: 'Missing fields' });
    const existing = await getPlayer(userId);
    if (existing) return res.status(409).json({ error: 'User already exists' });
    const player = await createPlayer(userId, username, role, avatar);
    // Store hashed PIN (simple — use bcrypt in production)
    await db.collection('auth').doc(userId).set({ pin, userId });
    res.json({ success: true, player });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { userId, pin } = req.body;
    const authDoc = await db.collection('auth').doc(userId).get();
    if (!authDoc.exists) return res.status(404).json({ error: 'User not found' });
    if (authDoc.data().pin !== pin) return res.status(401).json({ error: 'Wrong PIN' });
    const player    = await getPlayer(userId);
    const renewed   = await checkAndRenew(player);
    const bonus     = await claimDailyBonus(player);
    player.lastLogin = Date.now();
    await savePlayer(player);
    res.json({ player, renewed, dailyBonus: bonus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get player
app.get('/api/player/:userId', async (req, res) => {
  const player = await getPlayer(req.params.userId);
  if (!player) return res.status(404).json({ error: 'Not found' });
  await checkAndRenew(player);
  res.json(player);
});

// Game state
app.get('/api/game/state', (req, res) => {
  res.json({ phase: gamePhase, mult: currentMult, countdown: countdownVal, roundNumber, history: roundHistory.slice(0, 10) });
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const snap = await db.collection('players').orderBy('bestMult', 'desc').limit(10).get();
  const board = snap.docs.map(d => {
    const p = d.data();
    return { username: p.username, avatar: p.avatar, bestMult: p.bestMult, totalWins: p.totalWins, bestStreak: p.bestStreak };
  });
  res.json(board);
});

// Connect to TikTok Live (userId = streamer's game userId, so they receive gift stars)
app.post('/api/tiktok/connect', (req, res) => {
  const { username, userId } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  connectTikTok(username, userId || null);
  res.json({ message: `Connecting to @${username}` });
});

// ─────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // Join game (optional: inviteCode to join a friend's room)
  socket.on('player:join', async ({ userId, username, inviteCode }) => {
    socket.userId = userId;
    socket.join(userId);
    let player = await getPlayer(userId);
    if (!player) player = await createPlayer(userId, username, 'viewer');
    const renewed = await checkAndRenew(player);
    socket.emit('player:state', { ...player, renewed });
    socket.emit('game:state', { phase: gamePhase, mult: currentMult, countdown: countdownVal, roundNumber, history: roundHistory.slice(0, 10) });

    const code = (inviteCode || '').toLowerCase().trim();
    if (code && inviteRooms.has(code)) {
      const room = inviteRooms.get(code);
      if (room.members.length >= INVITE_ROOM_MAX) return;
      const already = room.members.some(m => m.userId === userId);
      if (!already) {
        room.members.push({ userId, username });
        userToInviteRoom.set(userId, code);
        socket.join(`invite_${code}`);
        const members = room.members.map(m => ({ userId: m.userId, username: m.username }));
        socket.emit('invite:joined', { roomCode: code, members });
        socket.to(`invite_${code}`).emit('invite:member_joined', { userId, username, members });
      }
    }
  });

  // Create invite room and get shareable link
  socket.on('invite:create', async ({ userId, username }) => {
    const code = genInviteCode();
    inviteRooms.set(code, {
      hostId: userId,
      members: [{ userId, username }],
      createdAt: Date.now(),
    });
    userToInviteRoom.set(userId, code);
    socket.join(`invite_${code}`);
    const baseUrl = process.env.MOONRUSH_FRONTEND_URL || 'https://moonrush.onrender.com';
    const inviteUrl = `${baseUrl}?invite=${code}`;
    socket.emit('invite:created', { roomCode: code, inviteUrl, members: [{ userId, username }] });
  });

  // Change username (wrong name entered)
  socket.on('player:updateUsername', async ({ userId, username }) => {
    const player = await getPlayer(userId);
    if (!player) return;
    player.username = username;
    await savePlayer(player);
  });

  // Place bet
  socket.on('bet:place', async ({ userId, amount, autoCashout }) => {
    if (gamePhase !== 'countdown' && gamePhase !== 'flying') return socket.emit('bet:error', { message: 'Launch window closed' });
    const player = await getPlayer(userId);
    if (!player)       return socket.emit('bet:error', { message: 'Player not found' });
    if (amount < 10)   return socket.emit('bet:error', { message: 'Minimum launch is 10 stars' });
    if (amount > player.tokens) return socket.emit('bet:error', { message: 'Not enough stars' });
    player.tokens -= amount;
    if (player.tokens <= 0) {
      player.lastDepletedAt = Date.now(); // start 24h renewal clock
    }
    await savePlayer(player);
    activeBets.set(userId, { userId, amount, autoCashout: autoCashout || null, cashedOut: false });
    socket.emit('bet:placed', { amount, tokens: player.tokens, lastDepletedAt: player.lastDepletedAt || null });
  });

  // Cash out
  socket.on('bet:cashout', ({ userId }) => {
    if (gamePhase !== 'flying') return;
    processCashout(userId, currentMult);
  });

  // Like tap — 0.5 token per tap
  socket.on('like:tap', async ({ userId }) => {
    const player = await getPlayer(userId);
    if (!player) return;
    player.likeBuffer = (player.likeBuffer || 0) + LIKE_VALUE;
    if (player.likeBuffer >= 1) {
      const whole          = Math.floor(player.likeBuffer);
      player.tokens       += whole;
      player.likeBuffer   -= whole;
    }
    await savePlayer(player);
    socket.emit('tokens:update', { tokens: player.tokens, likeBuffer: player.likeBuffer, source: 'like' });
  });

  // TikTok gift received — coins = exact tokens
  socket.on('gift:received', async ({ userId, giftName, coins }) => {
    const player = await getPlayer(userId);
    if (!player) return;
    player.tokens += coins;   // 1 coin = 1 token exactly
    await savePlayer(player);
    io.emit('gift:announce', { username: player.username, giftName, coins, tokenReward: coins });
    socket.emit('tokens:update', { tokens: player.tokens, source: 'gift', amount: coins });
  });

  // ── PK BATTLE
  socket.on('pk:create', async ({ roomId, p1Id, p2Id, durationSecs }) => {
    socket.join(roomId);
    const room = createPKRoom(roomId, p1Id, p2Id, durationSecs);
    io.to(roomId).emit('pk:created', room);
  });

  socket.on('pk:join', ({ roomId }) => {
    socket.join(roomId);
  });

  socket.on('pk:start', ({ roomId }) => {
    startPKBattle(roomId);
  });

  socket.on('pk:bet_lost', ({ roomId, side, amount }) => {
    const room = pkRooms.get(roomId);
    if (!room) return;
    if (side === 'left')  { room.p1Lost += amount; room.p1Tokens -= amount; }
    if (side === 'right') { room.p2Lost += amount; room.p2Tokens -= amount; }
  });

  socket.on('pk:gift', ({ roomId, side, coins }) => {
    const room = pkRooms.get(roomId);
    if (!room) return;
    if (side === 'left')  { room.p1Tokens += coins; room.p1Gifts++; }
    if (side === 'right') { room.p2Tokens += coins; room.p2Gifts++; }
  });

  socket.on('disconnect', () => {
    const uid = socket.userId;
    if (uid && userToInviteRoom.has(uid)) {
      const code = userToInviteRoom.get(uid);
      const room = inviteRooms.get(code);
      if (room) {
        room.members = room.members.filter(m => m.userId !== uid);
        userToInviteRoom.delete(uid);
        socket.to(`invite_${code}`).emit('invite:member_left', { userId: uid, members: room.members });
        if (room.members.length === 0) inviteRooms.delete(code);
      }
    }
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────
//  TIKTOK LIVE CONNECTOR
// ─────────────────────────────────────────
let tiktokConn = null;
let streamerUserId = null;  // who receives stars from gifts/likes

function connectTikTok(username, userId = null) {
  streamerUserId = userId;  // store so gifts credit the streamer
  if (tiktokConn) tiktokConn.disconnect();
  tiktokConn = new WebcastPushConnection(username, {
    processInitialData:       false,
    enableExtendedGiftInfo:   true,
    enableWebsocketUpgrade:   true,
    requestPollingIntervalMs: 2000,
  });

  tiktokConn.connect()
    .then(state => {
      console.log(`✅ TikTok Live connected: @${username} (Room: ${state.roomId})`);
      io.emit('tiktok:connected', { username, roomId: state.roomId });
    })
    .catch(err => {
      console.error('❌ TikTok connect failed:', err.message);
      io.emit('tiktok:error', { message: err.message });
    });

  // ── LIKES → show reactions + credit streamer (0.5 stars per like, buffered)
  tiktokConn.on('like', async data => {
    io.emit('tiktok:like', {
      username:    data.uniqueId,
      likeCount:   data.likeCount,
      totalLikes:  data.totalLikeCount
    });
    if (streamerUserId) {
      const player = await getPlayer(streamerUserId);
      if (player) {
        player.likeBuffer = (player.likeBuffer || 0) + LIKE_VALUE;
        if (player.likeBuffer >= 1) {
          const whole = Math.floor(player.likeBuffer);
          player.tokens += whole;
          player.likeBuffer -= whole;
          await savePlayer(player);
          io.to(streamerUserId).emit('tokens:update', { tokens: player.tokens, likeBuffer: player.likeBuffer, source: 'like' });
        }
      }
    }
  });

  // ── GIFTS → coins = stars, credit streamer
  tiktokConn.on('gift', async data => {
    if (data.giftType === 1 && !data.repeatEnd) return; // skip mid-combo
    const coins = data.diamondCount * (data.repeatCount || 1);
    console.log(`🎁 ${data.giftName} x${data.repeatCount} from @${data.uniqueId} = ${coins} stars`);
    io.emit('tiktok:gift', {
      username:    data.uniqueId,
      giftName:    data.giftName,
      giftEmoji:   data.giftPictureUrl,
      coins,
      tokenReward: coins,
      repeatCount: data.repeatCount || 1,
    });
    if (streamerUserId) {
      const player = await getPlayer(streamerUserId);
      if (player) {
        player.tokens += coins;
        await savePlayer(player);
        io.to(streamerUserId).emit('tokens:update', { tokens: player.tokens, source: 'gift', amount: coins });
      }
    }
  });

  // ── CHAT
  tiktokConn.on('chat', data => {
    io.emit('tiktok:chat', { username: data.uniqueId, comment: data.comment });
  });

  // ── FOLLOWERS
  tiktokConn.on('follow', data => {
    io.emit('tiktok:follow', { username: data.uniqueId });
  });

  // ── VIEWERS
  tiktokConn.on('roomUser', data => {
    io.emit('tiktok:viewers', { count: data.viewerCount });
  });

  // ── AUTO RECONNECT
  tiktokConn.on('disconnected', () => {
    console.log('TikTok disconnected. Reconnecting in 30s...');
    io.emit('tiktok:disconnected', {});
    setTimeout(() => connectTikTok(username), 30000);
  });

  tiktokConn.on('error', err => {
    console.error('TikTok error:', err);
    io.emit('tiktok:error', { message: err.message });
  });
}

// ─────────────────────────────────────────
//  HEALTH CHECK (for UptimeRobot)
// ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), phase: gamePhase, round: roundNumber });
});

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Moon Rush Production Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
  startCountdown();
});
