const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

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

  // ── Debug endpoint ──
  if (parsed.pathname === '/api/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      opensky_user_set: !!OPENSKY_USER,
      opensky_user_value: OPENSKY_USER || '(not set)',
      opensky_pass_set: !!OPENSKY_PASS,
      opensky_pass_length: OPENSKY_PASS ? OPENSKY_PASS.length : 0,
      mode: (OPENSKY_USER && OPENSKY_PASS) ? 'authenticated' : 'anonymous',
      node_version: process.version,
      time: new Date().toISOString(),
    }, null, 2));
  }

  // ── OpenSky proxy ──
  if (parsed.pathname === '/api/opensky') {
    const { lamin, lomin, lamax, lomax } = parsed.query;

    if (!lamin || !lomin || !lamax || !lomax) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing bbox parameters' }));
    }

    // Try authenticated first, fall back to anonymous if creds not set
    const useAuth = OPENSKY_USER && OPENSKY_PASS;
    const target = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

    const headers = {
      'Accept': 'application/json',
      'User-Agent': 'LFPG-RunwayDetector/1.0',
    };

    if (useAuth) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${OPENSKY_USER}:${OPENSKY_PASS}`).toString('base64');
    }

    console.log(`[${new Date().toISOString()}] → OpenSky fetch (mode: ${useAuth ? 'authenticated' : 'anonymous'})`);

    const makeRequest = (hdrs) => {
      https.get(target, { headers: hdrs }, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          console.log(`[${new Date().toISOString()}] ← OpenSky ${apiRes.statusCode} · ${data.length} bytes`);

          // If auth failed (401), automatically retry as anonymous
          if (apiRes.statusCode === 401 && useAuth) {
            console.log(`[${new Date().toISOString()}] ⚠ Auth failed — retrying anonymously`);
            const anonHeaders = {
              'Accept': 'application/json',
              'User-Agent': 'LFPG-RunwayDetector/1.0',
            };
            makeRequest(anonHeaders);
            return;
          }

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
    };

    makeRequest(headers);
    return;
  }

  // ── Static files ──
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);

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
  console.log(`  ║   Mode: ${(OPENSKY_USER && OPENSKY_PASS) ? 'authenticated (4000 req/day) ' : 'anonymous  (400 req/day)  '}  ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
