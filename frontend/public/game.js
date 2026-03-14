/**
 * MOON RUSH — Frontend Game Logic
 * Connects to backend via Socket.io
 * Handles canvas rendering, audio, UI updates
 */

// ─────────────────────────────────────────
//  SOCKET CONNECTION
// ─────────────────────────────────────────
// Use localhost when running locally; otherwise use configured backend URL
const backendUrl = window.location.hostname === 'localhost' ? window.location.origin : (window.MOONRUSH_BACKEND_URL || 'https://moonrush.onrender.com');
const socket = io(backendUrl, { reconnection: true, reconnectionDelay: 2000 });

// Invite link: ?invite=CODE or ?room=CODE (so friends can compete without TikTok)
const urlParams = new URLSearchParams(window.location.search);
const inviteCodeFromUrl = (urlParams.get('invite') || urlParams.get('room') || '').trim().toLowerCase() || null;

// Game state (declare early to avoid temporal dead zone)
let phase = 'countdown', curMult = 1.00;
let trailPts = [], pX = 0, pY = 0, pAng = 0, pAngT = 0;
let tokens = 2000, streak = 0, bestMult = 0, totalWins = 0, chalWins = 0, likeTapsToday = 0;
let challenge = 3.0, betActive = false, cashedOut = false, betAmount = 0;
let hist = [], renewalTimer = null, renewalEnd = null, lastDepletedAt = null;
let inviteRoomCode = null, inviteMembers = [], inviteUrl = null; // invite link competition

// Generate or retrieve userId from localStorage
let userId = localStorage.getItem('moonrush_userId');
if (!userId) {
  userId = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('moonrush_userId', userId);
}
let username = localStorage.getItem('moonrush_username') || prompt('Enter your TikTok username (e.g. @yourname):') || '@player';
localStorage.setItem('moonrush_username', username);
document.getElementById('uname').textContent = username;
document.getElementById('avatar').textContent = username.charAt(username.startsWith('@') ? 1 : 0).toUpperCase();

function changeUsername() {
  const newName = prompt('Change display name (e.g. @yourname):', username);
  if (newName == null || newName.trim() === '') return;
  username = newName.trim();
  if (!username.startsWith('@')) username = '@' + username;
  localStorage.setItem('moonrush_username', username);
  document.getElementById('uname').textContent = username;
  document.getElementById('avatar').textContent = username.charAt(1).toUpperCase();
  socket.emit('player:updateUsername', { userId, username });
}

socket.on('connect', () => {
  setConnStatus(true);
  socket.emit('player:join', { userId, username, inviteCode: inviteRoomCode || inviteCodeFromUrl });
});
socket.on('disconnect', () => setConnStatus(false));

function setConnStatus(online) {
  const el = document.getElementById('conn-status');
  el.textContent = online ? '🟢 Live' : '🔴 Reconnecting...';
  el.className = online ? 'online' : 'offline';
}

// ─────────────────────────────────────────
//  CANVAS SETUP
// ─────────────────────────────────────────
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 0, H = 0;
let stars = [];
function makeStars() {
  stars = [];
  for (let i = 0; i < 100; i++)
    stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + .2, p: Math.random() * 6.28, sp: Math.random() * .4 + .1 });
}
function resize() {
  W = cv.width = cv.clientWidth;
  H = cv.height = cv.clientHeight;
  makeStars();
}
window.addEventListener('resize', resize);
resize();

// ─────────────────────────────────────────
//  AUDIO ENGINE
// ─────────────────────────────────────────
let aC = null, eO = null, eO2 = null, eG = null;
function initAudio() {
  if (aC) return;
  aC = new (window.AudioContext || window.webkitAudioContext)();
}
function startEngine() {
  if (!aC) return; stopEngine();
  eO = aC.createOscillator(); eO.type = 'sawtooth'; eO.frequency.value = 55;
  eO2 = aC.createOscillator(); eO2.type = 'square'; eO2.frequency.value = 82;
  eG = aC.createGain(); eG.gain.setValueAtTime(0, aC.currentTime); eG.gain.linearRampToValueAtTime(0.06, aC.currentTime + 1);
  let f = aC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 8;
  let d = aC.createWaveShaper();
  let n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { let x = i * 2 / n - 1; c[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x)); }
  d.curve = c; d.oversample = '2x';
  eO.connect(d); eO2.connect(d); d.connect(f); f.connect(eG); eG.connect(aC.destination);
  eO.start(); eO2.start();
}
function updateEngine(m) {
  if (!eO || !aC) return;
  let t = aC.currentTime, fr = 55 + Math.min((m - 1) / 19, 1) * 110;
  eO.frequency.linearRampToValueAtTime(fr, t + .1);
  eO2.frequency.linearRampToValueAtTime(fr * 1.5, t + .1);
  eG.gain.linearRampToValueAtTime(0.06 + Math.min((m - 1) / 19, 1) * .05, t + .1);
}
function stopEngine() {
  if (eO) { try { eO.stop(); eO.disconnect(); } catch (e) { } }
  if (eO2) { try { eO2.stop(); eO2.disconnect(); } catch (e) { } }
  eO = eO2 = eG = null;
}
function playCrashSound() {
  if (!aC) return; stopEngine();
  let o = aC.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(200, aC.currentTime);
  o.frequency.exponentialRampToValueAtTime(25, aC.currentTime + .9);
  let g = aC.createGain(); g.gain.setValueAtTime(.14, aC.currentTime); g.gain.linearRampToValueAtTime(0, aC.currentTime + 1);
  o.connect(g); g.connect(aC.destination); o.start(); o.stop(aC.currentTime + 1);
}
function playWinSound() {
  if (!aC) return;
  [0, .13, .26].forEach((t, i) => {
    let o = aC.createOscillator(); o.type = 'sine'; o.frequency.value = [523, 659, 784][i];
    let g = aC.createGain(); g.gain.setValueAtTime(0, aC.currentTime + t); g.gain.linearRampToValueAtTime(.15, aC.currentTime + t + .04); g.gain.linearRampToValueAtTime(0, aC.currentTime + t + .2);
    o.connect(g); g.connect(aC.destination); o.start(aC.currentTime + t); o.stop(aC.currentTime + t + .22);
  });
}
function playGiftSound() {
  if (!aC) return;
  [0, .1, .2, .3].forEach((t, i) => {
    let o = aC.createOscillator(); o.type = 'sine'; o.frequency.value = [523, 659, 784, 1047][i];
    let g = aC.createGain(); g.gain.setValueAtTime(0, aC.currentTime + t); g.gain.linearRampToValueAtTime(.18, aC.currentTime + t + .04); g.gain.linearRampToValueAtTime(0, aC.currentTime + t + .22);
    o.connect(g); g.connect(aC.destination); o.start(aC.currentTime + t); o.stop(aC.currentTime + t + .25);
  });
}
function playBeep(hi) {
  if (!aC) return;
  let o = aC.createOscillator(); o.type = 'sine'; o.frequency.value = hi ? 880 : 440;
  let g = aC.createGain(); g.gain.setValueAtTime(.1, aC.currentTime); g.gain.linearRampToValueAtTime(0, aC.currentTime + .12);
  o.connect(g); g.connect(aC.destination); o.start(); o.stop(aC.currentTime + .13);
}
function playLikePop() {
  if (!aC) return;
  let o = aC.createOscillator(); o.type = 'sine'; o.frequency.value = 880;
  let g = aC.createGain(); g.gain.setValueAtTime(.07, aC.currentTime); g.gain.linearRampToValueAtTime(0, aC.currentTime + .08);
  o.connect(g); g.connect(aC.destination); o.start(); o.stop(aC.currentTime + .09);
}

// ─────────────────────────────────────────
//  REACTIONS
// ─────────────────────────────────────────
const rPool = ['🔥', '🚀', '😱', '💰', '🤑', '🙏', '👀', '💎', '⚡', '🎯', '❤️', '🌙', '😤'];
let rTimer = null;
function startReactions() { rTimer = setInterval(() => { if (Math.random() < .6) spawnEmoji(); }, 800); }
function stopReactions() { clearInterval(rTimer); }
function spawnEmoji(emoji) {
  let el = document.createElement('div'); el.className = 'remoji';
  el.textContent = emoji || rPool[Math.floor(Math.random() * rPool.length)];
  el.style.bottom = Math.floor(Math.random() * 80 + 5) + 'px';
  el.style.animationDuration = (1.7 + Math.random()) + 's';
  document.getElementById('reactions').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─────────────────────────────────────────
//  BEZIER FLIGHT PATH
// ─────────────────────────────────────────
const SX = () => 50, SY = () => H - 38, CX = () => W - 60, CY = () => H - 38, EX = () => W - 28, EY = () => 26;
function bPt(t) { let m = 1 - t; return { x: m * m * SX() + 2 * m * t * CX() + t * t * EX(), y: m * m * SY() + 2 * m * t * CY() + t * t * EY() }; }
function bAng(t) { let m = 1 - t; return Math.atan2(2 * m * (CY() - SY()) + 2 * t * (EY() - CY()), 2 * m * (CX() - SX()) + 2 * t * (EX() - CX())); }
function mToT(m) { return Math.min(Math.pow((m - 1) / 19, .55), .99); }

// ─────────────────────────────────────────
//  DRAW ROCKET
// ─────────────────────────────────────────
function drawRocket(x, y, ang) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  // Plume
  let pl = ctx.createRadialGradient(-44, 0, 0, -44, 0, 30);
  pl.addColorStop(0, 'rgba(255,240,100,1)'); pl.addColorStop(.15, 'rgba(255,150,20,.9)');
  pl.addColorStop(.5, 'rgba(255,60,0,.6)'); pl.addColorStop(1, 'rgba(200,30,0,0)');
  ctx.fillStyle = pl; ctx.beginPath();
  ctx.moveTo(-26, 0); ctx.bezierCurveTo(-34, -11, -62, -8, -74, 0); ctx.bezierCurveTo(-62, 8, -34, 11, -26, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,220,.98)'; ctx.beginPath(); ctx.ellipse(-35, 0, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(-31, 0, 4.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  // Body
  ctx.beginPath();
  ctx.moveTo(26, 0); ctx.bezierCurveTo(20, -6, 6, -9, -8, -9); ctx.lineTo(-24, -9);
  ctx.bezierCurveTo(-28, -9, -30, -5, -30, 0); ctx.bezierCurveTo(-30, 5, -28, 9, -24, 9);
  ctx.lineTo(-8, 9); ctx.bezierCurveTo(6, 9, 20, 6, 26, 0); ctx.closePath();
  let bG = ctx.createLinearGradient(0, -9, 0, 9);
  bG.addColorStop(0, '#f0f4f8'); bG.addColorStop(.5, '#dce8f2'); bG.addColorStop(1, '#aec4d6');
  ctx.fillStyle = bG; ctx.fill();
  // Nose
  ctx.beginPath();
  ctx.moveTo(38, 0); ctx.bezierCurveTo(34, -3, 28, -6, 22, -6); ctx.bezierCurveTo(24, -3, 24, 3, 22, 6); ctx.bezierCurveTo(28, 6, 34, 3, 38, 0); ctx.closePath();
  let nG = ctx.createLinearGradient(22, -6, 22, 6);
  nG.addColorStop(0, '#ff6060'); nG.addColorStop(.5, '#ff2d55'); nG.addColorStop(1, '#cc1133');
  ctx.fillStyle = nG; ctx.fill();
  // Porthole
  ctx.beginPath(); ctx.arc(6, 0, 5.5, 0, Math.PI * 2);
  let wG = ctx.createRadialGradient(4, -2, 0, 6, 0, 5.5);
  wG.addColorStop(0, '#c8f0ff'); wG.addColorStop(.6, '#40a0e0'); wG.addColorStop(1, '#1060a0');
  ctx.fillStyle = wG; ctx.fill();
  ctx.beginPath(); ctx.arc(4, -1.5, 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
  // Kenya flag
  ctx.fillStyle = '#006600'; ctx.fillRect(-2, -9, 12, 3);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-2, -6, 12, 3);
  ctx.fillStyle = '#bb0000'; ctx.fillRect(-2, -3, 12, 3);
  // Nozzle
  ctx.beginPath();
  ctx.moveTo(-24, -9); ctx.lineTo(-30, -13); ctx.lineTo(-34, -9); ctx.lineTo(-34, 9); ctx.lineTo(-30, 13); ctx.lineTo(-24, 9); ctx.closePath();
  let nzG = ctx.createLinearGradient(-24, -9, -34, 9); nzG.addColorStop(0, '#8899aa'); nzG.addColorStop(1, '#445566');
  ctx.fillStyle = nzG; ctx.fill();
  // Fins
  let fG = ctx.createLinearGradient(-20, -9, -26, -20); fG.addColorStop(0, '#ccd8e5'); fG.addColorStop(1, '#8aaabf');
  ctx.beginPath(); ctx.moveTo(-20, -9); ctx.lineTo(-14, -20); ctx.lineTo(-26, -20); ctx.lineTo(-30, -9); ctx.closePath(); ctx.fillStyle = fG; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-20, 9); ctx.lineTo(-14, 20); ctx.lineTo(-26, 20); ctx.lineTo(-30, 9); ctx.closePath(); ctx.fillStyle = fG; ctx.fill();
  ctx.restore();
  // Particles
  for (let i = 0; i < 6; i++) {
    let d = 58 + i * 12 + (Date.now() % 400) / 400 * 14;
    let ppx = x + Math.cos(ang + Math.PI) * d + (Math.random() - .5) * 8;
    let ppy = y + Math.sin(ang + Math.PI) * d + (Math.random() - .5) * 8;
    ctx.globalAlpha = i < 3 ? (.7 - i * .15) : (.14 - i * .03);
    ctx.fillStyle = i < 3 ? `rgb(255,${180 - i * 40},10)` : `rgb(160,170,185)`;
    ctx.beginPath(); ctx.arc(ppx, ppy, Math.max(2.8 - i * .38, .2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Challenge system
function newChallenge() {
  const opts = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 7.0, 10.0];
  const base = opts[Math.min(Math.floor(streak / 2), opts.length - 1)];
  challenge = Math.round((base + Math.random() * .4 - .2) * 100) / 100;
  document.getElementById('chal-v').textContent = challenge.toFixed(2) + 'x';
  document.getElementById('cd-chal-v').textContent = challenge.toFixed(2) + 'x';
  document.getElementById('chal-badge').textContent = 'Active';
  document.getElementById('chal-badge').className = 'chal-badge active';
}

// ─────────────────────────────────────────
//  SOCKET EVENTS FROM SERVER
// ─────────────────────────────────────────
socket.on('player:state', (player) => {
  tokens = player.tokens;
  streak = player.streak;
  bestMult = player.bestMult;
  totalWins = player.totalWins;
  chalWins = player.chalWins;
  lastDepletedAt = player.lastDepletedAt || null;
  updateUI();
});

socket.on('game:state', (state) => {
  phase = state.phase;
  curMult = state.mult;
  if (state.history) {
    hist = state.history.map(r => ({ m: r.mult.toFixed(2), w: false }));
    renderHistory();
  }
  // Sync UI and rocket so flight is visible even when joining mid-round
  if (phase === 'countdown') {
    pX = SX(); pY = SY(); pAng = 0; trailPts = [];
    document.getElementById('cd').classList.remove('hide');
    document.getElementById('fa').classList.remove('show');
    if (state.countdown != null) document.getElementById('cd-n').textContent = state.countdown;
    document.getElementById('place-btn').disabled = false;
    document.getElementById('co-btn').disabled = true;
  } else if (phase === 'flying') {
    let t = mToT(curMult);
    let bp = bPt(t);
    pX = bp.x; pY = bp.y; pAngT = bAng(t); pAng = pAngT;
    trailPts = [{ x: pX, y: pY }];
    document.getElementById('cd').classList.add('hide');
    document.getElementById('fa').classList.remove('show');
    document.getElementById('place-btn').disabled = true;
    if (betActive) document.getElementById('co-btn').disabled = false;
    startReactions();
    startEngine();
  }
});

socket.on('game:countdown', ({ val }) => {
  phase = 'countdown';
  trailPts = []; curMult = 1.00; pX = SX(); pY = SY(); pAng = 0;
  document.getElementById('cd').classList.remove('hide');
  document.getElementById('fa').classList.remove('show');
  document.getElementById('cd-n').textContent = val;
  document.getElementById('place-btn').disabled = false;
  document.getElementById('co-btn').disabled = true;
  stopReactions(); stopEngine();
  if (val === 5) newChallenge();
  playBeep(val === 0);
});

socket.on('game:flying', () => {
  phase = 'flying';
  // Ensure rocket starts at launch position (game:countdown already set pX, pY; resize may have changed W/H)
  pX = SX(); pY = SY(); pAng = 0;
  trailPts = [{ x: pX, y: pY }];
  document.getElementById('cd').classList.add('hide');
  document.getElementById('fa').classList.remove('show');
  startReactions(); startEngine();
  if (betActive) document.getElementById('co-btn').disabled = false;
  document.getElementById('place-btn').disabled = true;
});

socket.on('game:tick', ({ mult }) => {
  curMult = mult;
  let t = mToT(mult);
  let bp = bPt(t); pX = bp.x; pY = bp.y;
  pAngT = bAng(t);
  pAng = pAng + (pAngT - pAng) * .1;
  trailPts.push({ x: pX, y: pY });
  if (trailPts.length > 220) trailPts.shift();
  updateEngine(mult);
  // Challenge hint
  let chalDone = mult >= challenge;
  // update inline in canvas render
});

socket.on('game:crashed', ({ mult }) => {
  phase = 'crashed';
  curMult = mult;
  stopReactions(); playCrashSound();
  // If bet wasn't cashed out
  if (betActive && !cashedOut) {
    streak = 0;
    document.getElementById('chal-badge').textContent = 'Failed ❌';
    document.getElementById('chal-badge').className = 'chal-badge lost';
    addHist(mult, false);
  }
  betActive = false; cashedOut = false;
  document.getElementById('fa-icon').textContent = '🚀';
  document.getElementById('fa-m').textContent = 'Flew away at ' + mult.toFixed(2) + 'x';
  document.getElementById('fa-s').textContent = '';
  document.getElementById('fa').classList.add('show');
  document.getElementById('co-btn').disabled = true;
  updateUI();
});

socket.on('bet:placed', ({ amount, tokens: t, lastDepletedAt: lda }) => {
  betActive = true; cashedOut = false; betAmount = amount;
  tokens = t;
  if (lda) lastDepletedAt = lda;
  updateUI();
});

socket.on('bet:won', ({ amount, mult, winAmount, tokens: t, streak: s }) => {
  cashedOut = true;
  tokens = t; streak = s;
  if (mult > bestMult) bestMult = mult;
  totalWins++;
  if (mult >= challenge) { chalWins++; document.getElementById('chal-badge').textContent = 'Beaten ✅'; document.getElementById('chal-badge').className = 'chal-badge won'; }
  playWinSound(); spawnEmoji('💰'); spawnEmoji('🎉');
  document.getElementById('fa-m').textContent = '🎉 Cashed out at ' + mult.toFixed(2) + 'x!';
  document.getElementById('fa-s').textContent = '+' + winAmount + ' stars';
  addHist(mult, true);
  updateUI();
});

socket.on('bet:lost', ({ amount, mult }) => {
  addHist(mult, false);
  updateUI();
});

socket.on('bet:error', ({ message }) => {
  alert(message);
});

// ── Invite link (compete with friends without TikTok)
socket.on('invite:created', ({ roomCode, inviteUrl: url, members }) => {
  inviteRoomCode = roomCode;
  inviteUrl = url;
  inviteMembers = members || [];
  showInvitePanel(true);
  renderInviteMembers();
});
socket.on('invite:joined', ({ roomCode, members }) => {
  inviteRoomCode = roomCode;
  inviteMembers = members || [];
  renderInviteMembers();
  if (document.getElementById('invite-strip')) document.getElementById('invite-strip').classList.remove('hide');
});
socket.on('invite:member_joined', ({ userId, username, members }) => {
  inviteMembers = members || [];
  renderInviteMembers();
  showGiftBanner(`👋 ${username} joined your group!`);
});
socket.on('invite:member_left', ({ members }) => {
  inviteMembers = members || [];
  renderInviteMembers();
  if (inviteMembers.length <= 1) document.getElementById('invite-strip')?.classList.add('hide');
});
socket.on('invite:round_summary', ({ crashMult, results }) => {
  const lines = (results || []).map(r => {
    if (r.outcome === 'no_bet') return `${r.username} — no bet`;
    if (r.outcome === 'cashed_out') return `${r.username} landed at ${r.mult.toFixed(2)}x (+${r.winAmount})`;
    return `${r.username} crashed at ${crashMult.toFixed(2)}x`;
  });
  showGiftBanner('🏆 Group: ' + lines.join(' · '));
});

socket.on('tokens:update', ({ tokens: t, source, amount }) => {
  tokens = t;
  if (source === 'gift') { playGiftSound(); spawnEmoji('🎁'); spawnEmoji('💰'); }
  if (source === 'like') { playLikePop(); spawnEmoji('❤️'); }
  updateUI();
  checkBroke();
});

// ── TikTok Live events
socket.on('tiktok:gift', (data) => {
  showGiftBanner(`🎁 @${data.username} sent ${data.giftName}! +${data.tokenReward} stars`);
  addGifterBadge(`@${data.username}`, data.giftName);
  spawnEmoji('🎁'); spawnEmoji('🔥');
  playGiftSound();
});

socket.on('tiktok:like', (data) => {
  document.getElementById('viewer-count').textContent = data.totalLikes || document.getElementById('viewer-count').textContent;
});

socket.on('tiktok:chat', (data) => {
  addChatMessage(data.username, data.comment);
});

socket.on('tiktok:viewers', ({ count }) => {
  document.getElementById('viewer-count').textContent = count.toLocaleString();
});

socket.on('tiktok:follow', (data) => {
  spawnEmoji('❤️');
  addChatMessage(data.username, 'just followed! ❤️');
});

socket.on('tiktok:connected', () => {
  const btn = document.getElementById('connect-live-btn');
  if (btn) { btn.textContent = '✅ Live'; btn.disabled = true; btn.style.background = 'rgba(34,197,94,.3)'; }
});

socket.on('tiktok:error', ({ message }) => {
  const btn = document.getElementById('connect-live-btn');
  if (btn) { btn.disabled = false; btn.textContent = '📡 Connect Live'; }
});

socket.on('gift:announce', ({ username, giftName, tokenReward }) => {
  showGiftBanner(`🎁 @${username} sent ${giftName}! +${tokenReward} stars`);
});

// ─────────────────────────────────────────
//  UI ACTIONS
// ─────────────────────────────────────────
function setBet(v) {
  document.getElementById('bet-amt').value = v;
  updPreview();
}

document.getElementById('bet-amt').addEventListener('input', updPreview);
document.getElementById('auto-x').addEventListener('input', updPreview);
function updPreview() {
  let b = parseInt(document.getElementById('bet-amt').value) || 0;
  let x = parseFloat(document.getElementById('auto-x').value) || 2;
  document.getElementById('win-preview').textContent = Math.round(b * x);
}

function placeBet() {
  if (phase === 'flying') return;
  initAudio();
  let amount = parseInt(document.getElementById('bet-amt').value) || 0;
  if (amount < 10) return;
  if (amount > tokens) { document.getElementById('bet-amt').style.outline = '1px solid #ff4d4d'; setTimeout(() => document.getElementById('bet-amt').style.outline = '', 800); return; }
  let autoCashout = document.getElementById('auto-cb').checked ? (parseFloat(document.getElementById('auto-x').value) || null) : null;
  socket.emit('bet:place', { userId, amount, autoCashout });
  document.getElementById('place-btn').disabled = true;
}

function cashOut() {
  if (phase !== 'flying' || !betActive || cashedOut) return;
  socket.emit('bet:cashout', { userId });
}

function tapLike() {
  initAudio();
  likeTapsToday++;
  document.getElementById('like-count').textContent = likeTapsToday;
  socket.emit('like:tap', { userId });
  spawnEmoji('❤️');
}

function requestGift() {
  alert('Tell your viewers:\n\n"Send a gift to give me stars!\nEvery gift helps me keep flying! 🚀🎁\n(Free fun only — no real money)"');
}

function connectTikTokLive() {
  const apiUrl = (window.MOONRUSH_BACKEND_URL || window.location.origin) + '/api/tiktok/connect';
  const tiktokUser = username.replace(/^@/, '');
  if (!tiktokUser || tiktokUser === 'player') {
    alert('Enter your TikTok username first (refresh and type it when prompted).');
    return;
  }
  const btn = document.getElementById('connect-live-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Connecting...'; }
  fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: tiktokUser, userId })
  })
    .then(r => r.json())
    .then(() => {
      // Wait for tiktok:connected socket event for success; tiktok:error will reset button
    })
    .catch(err => {
      if (btn) { btn.disabled = false; btn.textContent = '📡 Connect Live'; }
      alert('Connection failed. Make sure you are LIVE on TikTok first, then try again.\n\n' + err.message);
    });
}

function dismissCrash() {
  document.getElementById('fa').classList.remove('show');
}

function shareResult() {
  const text = `🚀 MOON RUSH RESULT\n\nRound: ${curMult.toFixed(2)}x\nStars: ${tokens} ⭐\nStreak: ${streak} 🔥\nBest: ${bestMult.toFixed(2)}x\nChallenges: ${chalWins} 🎯\n\n▶️ Free arcade game on TikTok Live! (No gambling)\n#MoonRush #TikTokLive #Kenya #FreeGame`;
  if (navigator.share) {
    navigator.share({ title: 'Moon Rush 🚀', text });
  } else {
    navigator.clipboard.writeText(text).then(() => alert('Result copied! Paste it on TikTok 🎬'));
  }
}

// ─────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────
function updateUI() {
  const maxT = 2000;
  const pct = Math.round((tokens / maxT) * 100);
  document.getElementById('token-display').textContent = tokens;
  document.getElementById('token-bar-fill').style.width = Math.min(pct, 100) + '%';
  document.getElementById('token-pct').textContent = pct + '%';
  // Bar color
  let bar = document.getElementById('token-bar-fill');
  if (pct < 15) bar.style.background = 'linear-gradient(90deg,#ff4d4d,#ff6060)';
  else if (pct < 40) bar.style.background = 'linear-gradient(90deg,#ff8c00,#FFD700)';
  else bar.style.background = 'linear-gradient(90deg,#ff4d4d,#FFD700,#22c55e)';
  document.getElementById('streak-val').textContent = streak;
  document.getElementById('sv-tokens').textContent = tokens;
  document.getElementById('sv-streak').textContent = streak + (streak >= 3 ? ' 🔥' : '');
  document.getElementById('sv-best').textContent = bestMult > 0 ? bestMult.toFixed(2) + 'x' : '—';
  document.getElementById('sv-chals').textContent = chalWins;
  checkBroke();
}

function checkBroke() {
  if (tokens <= 0 && phase !== 'flying') {
    document.getElementById('broke').classList.add('show');
    startRenewalCountdown();
  } else {
    document.getElementById('broke').classList.remove('show');
  }
}

function startRenewalCountdown() {
  if (renewalTimer) return;
  const depletedAt = lastDepletedAt || Date.now(); // use server time if available
  renewalEnd = depletedAt + 24 * 60 * 60 * 1000;   // 24h from when they hit 0
  renewalTimer = setInterval(() => {
    let left = renewalEnd - Date.now();
    if (left <= 0) {
      clearInterval(renewalTimer); renewalTimer = null;
      socket.emit('player:join', { userId, username, inviteCode: inviteRoomCode || inviteCodeFromUrl });
      document.getElementById('broke').classList.remove('show');
      return;
    }
    let h = Math.floor(left / 3600000);
    let m = Math.floor((left % 3600000) / 60000);
    let s = Math.floor((left % 60000) / 1000);
    document.getElementById('broke-timer').textContent =
      String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }, 1000);
}

function addHist(m, won) {
  hist.unshift({ m: m.toFixed(2), w: won });
  if (hist.length > 10) hist.pop();
  renderHistory();
}

function renderHistory() {
  document.getElementById('hist-row').innerHTML = hist.map(r => `<span class="hp ${r.w ? 'g' : 'b'}">${r.m}x</span>`).join('');
}

function showGiftBanner(text) {
  let b = document.getElementById('gift-banner');
  b.textContent = text; b.style.display = 'block';
  clearTimeout(b._t);
  b._t = setTimeout(() => b.style.display = 'none', 3500);
}

function showInvitePanel(show) {
  const panel = document.getElementById('invite-panel');
  if (!panel) return;
  panel.classList.toggle('show', !!show);
  if (show && inviteUrl) {
    const input = document.getElementById('invite-link-input');
    if (input) input.value = inviteUrl;
  }
}

function renderInviteMembers() {
  const el = document.getElementById('invite-members');
  if (!el) return;
  if (inviteMembers.length === 0) { el.textContent = ''; return; }
  el.textContent = 'Playing with: ' + inviteMembers.map(m => m.username).join(', ');
}

function copyInviteLink() {
  if (!inviteUrl) return;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showGiftBanner('🔗 Invite link copied! Share with friends.');
    showInvitePanel(false);
  }).catch(() => { prompt('Copy this link:', inviteUrl); });
}

function createInvite() {
  if (inviteRoomCode) { showInvitePanel(true); return; }
  socket.emit('invite:create', { userId, username });
}

function addGifterBadge(username, gift) {
  let bar = document.getElementById('gifters-bar');
  let el = document.createElement('div'); el.className = 'gifter';
  el.innerHTML = `🎁 ${username} • ${gift}`;
  bar.insertBefore(el, bar.firstChild);
  if (bar.children.length > 8) bar.removeChild(bar.lastChild);
}

function addChatMessage(username, comment) {
  let wrap = document.getElementById('chat-overlay');
  let el = document.createElement('div'); el.className = 'chat-msg';
  el.textContent = `@${username}: ${comment}`;
  wrap.appendChild(el);
  if (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 5000);
}

// ─────────────────────────────────────────
//  CANVAS RENDER LOOP (deferred to avoid init order issues)
// ─────────────────────────────────────────
requestAnimationFrame(function loop(now) {
  requestAnimationFrame(loop);
  if (W === 0 || H === 0) resize();
  if (W === 0 || H === 0) return;
  ctx.clearRect(0, 0, W, H);

  // BG
  let bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#000005'); bg.addColorStop(.5, '#060820'); bg.addColorStop(1, '#0d1545');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Stars
  let scroll = phase === 'flying' ? Math.min((curMult - 1) / 20, 1) * 28 : 0;
  stars.forEach(s => {
    let yy = (s.y * H + scroll * s.sp * 60) % H;
    ctx.globalAlpha = .12 + .3 * Math.sin(now / 1100 + s.p);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x * W, yy, s.r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Moon
  ctx.beginPath(); ctx.arc(W - 40, 34, 20, 0, Math.PI * 2);
  let mG = ctx.createRadialGradient(W - 44, 30, 2, W - 40, 34, 20);
  mG.addColorStop(0, '#fffde8'); mG.addColorStop(.6, '#f0e060'); mG.addColorStop(1, '#c8a820');
  ctx.fillStyle = mG; ctx.fill();
  ctx.globalAlpha = .22; ctx.fillStyle = '#a08010';
  ctx.beginPath(); ctx.arc(W - 34, 28, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W - 48, 38, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Grid
  let baseY = SY();
  ctx.strokeStyle = 'rgba(255,255,255,.032)'; ctx.lineWidth = .5;
  for (let y = baseY; y > 0; y -= 30) { ctx.beginPath(); ctx.moveTo(44, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = 50; x < W; x += 42) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, baseY); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = .7;
  ctx.beginPath(); ctx.moveTo(46, 0); ctx.lineTo(46, baseY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(46, baseY); ctx.lineTo(W, baseY); ctx.stroke();

  // Trail
  if (trailPts.length > 1) {
    ctx.beginPath(); ctx.moveTo(trailPts[0].x, baseY);
    for (let p of trailPts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(trailPts[trailPts.length - 1].x, baseY); ctx.closePath();
    let fg = ctx.createLinearGradient(0, 20, 0, baseY);
    fg.addColorStop(0, 'rgba(255,140,0,.22)'); fg.addColorStop(.6, 'rgba(255,80,0,.07)'); fg.addColorStop(1, 'rgba(255,50,0,.01)');
    ctx.fillStyle = fg; ctx.fill();
    ctx.beginPath(); ctx.moveTo(trailPts[0].x, trailPts[0].y);
    for (let i = 1; i < trailPts.length; i++) ctx.lineTo(trailPts[i].x, trailPts[i].y);
    let tc = `hsl(${Math.max(28, 52 - Math.min(curMult * 2, 24))},100%,55%)`;
    ctx.strokeStyle = tc; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    let lp = trailPts[trailPts.length - 1];
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 4, 0, Math.PI * 2); ctx.fillStyle = tc; ctx.fill();
    ctx.beginPath(); ctx.arc(lp.x, lp.y, 8, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,140,0,.28)'; ctx.lineWidth = 2.5; ctx.stroke();
  }

  // Multiplier text
  if (phase === 'flying' || phase === 'crashed') {
    let col = phase === 'crashed' ? '#ff4d4d' : '#fff';
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(H * .2)}px system-ui,sans-serif`;
    ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 16;
    ctx.fillText(curMult.toFixed(2) + 'x', W / 2, H * .36); ctx.shadowBlur = 0;
    if (phase === 'flying') {
      ctx.font = `600 11px system-ui,sans-serif`;
      let cd = curMult >= challenge;
      ctx.fillStyle = cd ? '#22c55e' : 'rgba(255,215,0,.5)';
      ctx.fillText(cd ? '✅ Challenge done! Land now!' : '🎯 Challenge: ' + challenge.toFixed(2) + 'x', W / 2, H * .36 + Math.round(H * .16));
    }
    ctx.restore();
  }

  // Rocket
  if (phase === 'flying') drawRocket(pX, pY, pAng);
});

// Init
updPreview();
updateUI();
