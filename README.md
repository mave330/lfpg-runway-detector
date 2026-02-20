# ✈ LFPG Live Runway Detector

Real-time ADS-B runway detection for **Paris Charles de Gaulle (LFPG)**.  
Identifies active landing runways live from traffic via OpenSky Network.

---

## 🚀 Deploy to Railway in 5 minutes

### 1. Push this repo to GitHub

```bash
cd lfpg-runway-detector
git init
git add .
git commit -m "Initial commit"
```

Go to [github.com/new](https://github.com/new), create a repo called `lfpg-runway-detector`, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/lfpg-runway-detector.git
git branch -M main
git push -u origin main
```

---

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Pick your `lfpg-runway-detector` repo
5. Railway auto-detects Node.js and deploys ✅

---

### 3. Add your OpenSky credentials

In your Railway project:
1. Click on your service → **"Variables"** tab
2. Add these two environment variables:

| Variable | Value |
|----------|-------|
| `OPENSKY_USER` | `mave330-api-client` |
| `OPENSKY_PASS` | `xNnsV4XCS7fwBicsnm4YVv32LeS1XzzU` |

3. Railway automatically redeploys — your app is live! 🎉

---

### 4. Get your public URL

Railway → your service → **"Settings"** tab → **"Domains"**  
Click **"Generate Domain"** → you get a free `https://xxxx.up.railway.app` URL.

---

## 📁 Project structure

```
lfpg-runway-detector/
├── public/
│   └── index.html    ← Full frontend (radar, runway cards, aircraft table)
├── server.js         ← Node.js server + OpenSky proxy
├── package.json      ← "start": "node server.js"
├── .gitignore        ← Excludes .env and node_modules
└── README.md
```

> **Security**: credentials are set as Railway env vars — they are never in the code or Git history.

---

## ✈ How it works

- Fetches live ADS-B data from **OpenSky Network** every 15 seconds
- Filters aircraft within **5 km** of LFPG (49.0097°N, 2.5479°E), airborne only
- Matches aircraft heading (±25°) + altitude < 1500m → "on approach"
- Runway cards light up 🟢 when approach traffic detected

### LFPG Runways monitored

| Runway pair | Landing headings |
|-------------|-----------------|
| 08L / 26R   | 083° / 263°     |
| 08R / 26L   | 083° / 263°     |
| 09L / 27R   | 093° / 273°     |
| 09R / 27L   | 093° / 273°     |
