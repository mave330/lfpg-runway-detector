const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Credentials come from Railway environment variables (never hardcoded)
const OPENSKY_USER = process.env.OPENSKY_USER;
const OPENSKY_PASS = process.env.OPENSKY_PASS;

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ── OpenSky proxy ──
  if (parsed.pathname === '/api/opensky') {
    const { lamin, lomin, lamax, lomax } = parsed.query;

    if (!lamin || !lomin || !lamax || !lomax) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing bbox parameters' }));
    }

    const target = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'LFPG-RunwayDetector/1.0',
    };

    if (OPENSKY_USER && OPENSKY_PASS) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${OPENSKY_USER}:${OPENSKY_PASS}`).toString('base64');
    }

    console.log(`[${new Date().toISOString()}] → OpenSky fetch (auth: ${!!OPENSKY_USER})`);

    https.get(target, { headers }, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        console.log(`[${new Date().toISOString()}] ← OpenSky ${apiRes.statusCode} · ${data.length} bytes`);
        res.writeHead(apiRes.statusCode, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    }).on('error', (err) => {
      console.error('OpenSky error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    return;
  }

  // ── Static files from /public ──
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║     ✈  LFPG Runway Detector             ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║   Listening on port ${PORT}                  ║`);
  console.log(`  ║   OpenSky auth: ${OPENSKY_USER ? '✓ credentials set  ' : '✗ anonymous mode  '}  ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
