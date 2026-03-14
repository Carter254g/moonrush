# 🚀 MOON RUSH — Complete Deployment Guide
# From zero to live on TikTok — step by step

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## WHAT YOU NEED BEFORE STARTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ A laptop or PC (Windows, Mac or Linux)
✅ A Google account (Gmail)
✅ A GitHub account (free at github.com)
✅ A TikTok account with 1000+ followers
✅ Node.js installed (nodejs.org — download LTS version)
✅ Git installed (git-scm.com)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 1 — SET UP FIREBASE (Free Database)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Firebase stores your players' tokens and accounts.
Free tier = 1GB storage + 50,000 reads/day = plenty for starting.

1. Go to: https://console.firebase.google.com
2. Click "Create a project"
3. Name it: moonrush
4. Disable Google Analytics (not needed) → click Create
5. Wait for project to create → click Continue

--- CREATE FIRESTORE DATABASE ---
6. In left menu click "Firestore Database"
7. Click "Create database"
8. Choose "Start in production mode" → Next
9. Choose location: eur3 (Europe) or nam5 (US) → Enable
10. Database is now created ✅

--- GET SERVICE ACCOUNT KEY ---
11. Click the gear icon (⚙️) → Project Settings
12. Click "Service Accounts" tab
13. Click "Generate new private key"
14. Click "Generate key" → a JSON file downloads
15. KEEP THIS FILE SAFE — it gives access to your database

--- COPY THE VALUES ---
Open the downloaded JSON file. You need these 3 values:
  - "project_id"    → this is FIREBASE_PROJECT_ID
  - "private_key"   → this is FIREBASE_PRIVATE_KEY
  - "client_email"  → this is FIREBASE_CLIENT_EMAIL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 2 — PUSH CODE TO GITHUB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Go to github.com → Sign in → Click "New repository"
2. Name it: moonrush
3. Set to Public → Click "Create repository"
4. Open your terminal/command prompt:

   cd moonrush-production
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOURUSERNAME/moonrush.git
   git push -u origin main

5. Refresh GitHub — your code should be there ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 3 — DEPLOY BACKEND TO RENDER (Free)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Render hosts your Node.js game server for free.
No credit card needed.

1. Go to: https://render.com
2. Click "Get Started for Free"
3. Sign up with your GitHub account
4. Click "New +" → "Web Service"
5. Connect your GitHub repo: moonrush
6. Fill in these settings:

   Name:            moonrush-backend
   Region:          Frankfurt (EU) or Oregon (US)
   Branch:          main
   Root Directory:  backend
   Runtime:         Node
   Build Command:   npm install
   Start Command:   node server.js
   Instance Type:   Free

7. Click "Advanced" → "Add Environment Variable"
   Add these one by one:

   Key: FIREBASE_PROJECT_ID
   Value: (paste your project_id from the JSON file)

   Key: FIREBASE_PRIVATE_KEY
   Value: (paste your private_key from the JSON file — include the quotes)

   Key: FIREBASE_CLIENT_EMAIL
   Value: (paste your client_email from the JSON file)

   Key: NODE_ENV
   Value: production

8. Click "Create Web Service"
9. Wait 3-5 minutes for it to deploy
10. Your backend URL will be:
    https://moonrush-backend.onrender.com ✅

--- TEST YOUR BACKEND ---
Open this URL in your browser:
https://moonrush-backend.onrender.com/health

You should see:
{"status":"ok","uptime":12.3,"phase":"countdown","round":1}

If you see this → backend is working ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 4 — DEPLOY FRONTEND TO VERCEL (Free)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Vercel hosts your game website for free, forever.

1. Go to: https://vercel.com
2. Click "Sign Up" → Continue with GitHub
3. Click "Add New Project"
4. Import your moonrush GitHub repository
5. Fill in settings:

   Framework Preset: Other
   Root Directory:   frontend
   Build Command:    (leave empty)
   Output Directory: public

6. Click "Deploy"
7. Wait 1-2 minutes
8. Your game URL will be:
   https://moonrush.vercel.app ✅

--- UPDATE BACKEND URL IN GAME ---
After deploying, open this file:
frontend/public/game.js

Find this line (near the top):
   const socket = io(window.location.origin, ...);

Change to:
   const socket = io('https://moonrush-backend.onrender.com', ...);

Then push to GitHub:
   git add .
   git commit -m "Update backend URL"
   git push

Vercel auto-deploys when you push to GitHub ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 5 — KEEP SERVER AWAKE (UptimeRobot)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Render's free tier sleeps after 15 min of no traffic.
UptimeRobot pings it every 10 minutes to keep it awake.
It's free and takes 2 minutes to set up.

1. Go to: https://uptimerobot.com
2. Click "Register for FREE"
3. Sign up → Verify your email
4. Click "Add New Monitor"
5. Fill in:

   Monitor Type:  HTTP(s)
   Friendly Name: Moon Rush Backend
   URL:           https://moonrush-backend.onrender.com/health
   Monitoring Interval: Every 10 minutes

6. Click "Create Monitor" ✅

Now UptimeRobot pings your server every 10 minutes.
The server NEVER goes to sleep during your TikTok Live.

BONUS: UptimeRobot also emails you if your server goes down!
       Set your email in "Alert Contacts" → "Add Alert Contact"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 6 — CONNECT TIKTOK LIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Do this every time you start a TikTok Live:

1. Start your TikTok LIVE first
2. Wait 30 seconds for it to be detected
3. Open this URL in your browser
   (replace YOUR_USERNAME with your TikTok username, no @):

   https://moonrush-backend.onrender.com/api/tiktok/connect
   Method: POST
   Body: {"username": "your_tiktok_username"}

   EASIEST WAY — paste this in your browser console:
   fetch('https://moonrush-backend.onrender.com/api/tiktok/connect', {
     method: 'POST',
     headers: {'Content-Type':'application/json'},
     body: JSON.stringify({username:'YOUR_TIKTOK_USERNAME'})
   })

4. The game will show "🟢 TikTok Connected"
5. Gifts and likes now update tokens in real time ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP 7 — GO LIVE ON TIKTOK!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Start TikTok LIVE on your phone
2. On your laptop/tablet: open moonrush.vercel.app
3. Log in with your account
4. Connect TikTok (Step 6 above)
5. Point your camera at the screen OR screen-share
6. Tell your viewers:

   "TAP LIKE to give me tokens! ❤️"
   "SEND A GIFT to bail me out! 🎁"
   "Every coin you gift = tokens I get!"
   "If I run out of tokens the rocket won't fly!"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Problem: Backend health check shows error
Fix: Check Render logs → Dashboard → Your service → Logs tab
     Most common: Firebase environment variables wrong
     Double-check FIREBASE_PRIVATE_KEY has the \n characters

Problem: TikTok connection fails
Fix: Make sure you are ACTIVELY LIVE when connecting
     Wait 30 seconds after starting your live, then connect
     Some regions need a VPN on the server

Problem: Game is slow/laggy
Fix: This is normal for first request on free Render (30s wake-up)
     After UptimeRobot is set up, it stays awake and is fast

Problem: Tokens not saving
Fix: Check Firebase Console → Firestore → players collection
     Should show player documents with token values
     If empty → Firebase credentials are wrong in Render env vars

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## YOUR COMPLETE FREE STACK SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Service        URL                              Cost
─────────────────────────────────────────────────────
Game (UI)      moonrush.vercel.app              FREE
Backend        moonrush-backend.onrender.com    FREE
Database       Firebase Firestore               FREE
Keep-alive     UptimeRobot                      FREE
TikTok Live    tiktok-live-connector            FREE
─────────────────────────────────────────────────────
TOTAL                                        KSh 0/month

When ready to upgrade:
- Domain (.ke): KSh 800/year from KENIC
- Render paid: $7/month (no sleep, faster)
- Firebase paid: only if 50,000+ daily users

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## QUICK REFERENCE URLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Firebase Console:  https://console.firebase.google.com
Render Dashboard:  https://dashboard.render.com
Vercel Dashboard:  https://vercel.com/dashboard
UptimeRobot:       https://uptimerobot.com
GitHub:            https://github.com
TikTok Dev:        https://developers.tiktok.com

Your game:         https://moonrush.vercel.app
Your backend:      https://moonrush-backend.onrender.com
Health check:      https://moonrush-backend.onrender.com/health
