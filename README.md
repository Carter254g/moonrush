# 🚀 Moon Rush — TikTok Live Game
### Free interactive rocket game for TikTok LIVE streams

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

---

## 🎮 What is Moon Rush?

Moon Rush is a free arcade-style rocket game for TikTok LIVE.
**FOR ENTERTAINMENT ONLY** — No real money. No purchases. No gambling. 100% free.
Viewers earn stars through likes and gifts to keep the rocket flying.

---

## 💰 Token System

| Action | Tokens |
|--------|--------|
| Sign up | 2,000 free |
| ❤️ Like tap | +0.5 tokens |
| 🌹 Rose gift (1 coin) | +1 token |
| 🎊 Confetti (100 coins) | +100 tokens |
| 💸 Money Rain (500 coins) | +500 tokens |
| 🦁 Lion (29,999 coins) | +29,999 tokens |
| 🌌 Universe (44,999 coins) | +44,999 tokens |
| ⏱ Auto-renew | 2,000 every 24hrs |

**Rule: 1 TikTok coin = 1 game token. Always.**

---

## 📁 Project Structure

```
moonrush-production/
├── backend/
│   ├── server.js          ← Game engine + TikTok connector + Firebase
│   ├── package.json
│   └── .env.example       ← Copy to .env and fill in your values
├── frontend/
│   └── public/
│       ├── index.html     ← Game UI
│       └── game.js        ← Canvas + Socket.io client
├── docs/
│   └── DEPLOYMENT.md      ← Full step-by-step deployment guide
├── render.yaml            ← Render auto-deploy config
├── vercel.json            ← Vercel auto-deploy config
└── .gitignore
```

---

## 🚀 Quick Deploy

**Read the full guide:** `docs/DEPLOYMENT.md`

Short version:
1. Set up Firebase → get credentials
2. Push to GitHub
3. Deploy backend to Render (free, no card)
4. Deploy frontend to Vercel (free, forever)
5. Set up UptimeRobot to keep server awake
6. Start TikTok LIVE → connect game → play!

---

## ⚔️ PK Battle

Moon Rush supports TikTok-style PK Battles:
- Two streamers play on a split screen simultaneously
- Each rocket is independent — separate crash points, separate landings
- Battle timer counts down (1, 3, 5 or 10 minutes)
- Whoever **loses the most stars** during the battle = LOSER
- Loser must do a random punishment challenge on camera

---

## 🛡️ Why This Is TikTok Compliant

- **Stars are 100% free** — never purchaseable, zero monetary value
- **No gambling** — arcade-style fun only, no real money involved
- TikTok gifts are voluntary creator support (same as any Live)
- Gifters receive nothing back — no pay-to-win
- 24hr auto-renew ensures everyone can always play
- Clear "FOR ENTERTAINMENT ONLY" disclaimers throughout the app

---

## 📞 Tech Stack

| Layer | Technology | Cost |
|-------|-----------|------|
| Frontend | Vanilla JS + HTML5 Canvas | Free |
| Backend | Node.js + Express + Socket.io | Free |
| Database | Firebase Firestore | Free |
| Hosting (FE) | Vercel | Free |
| Hosting (BE) | Render | Free |
| Keep-alive | UptimeRobot | Free |
| TikTok | tiktok-live-connector | Free |

**Total: KSh 0/month** 🎉

---

Built for Kenyan TikTok creators 🇰🇪
#MoonRush #TikTokLive #Kenya
