const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
};

function fetchUrl(targetUrl, callback) {
  const options = {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LFPG-RunwayDetector/1.0)',
    },
    timeout: 10000,
  };
  const req = https.get(targetUrl, options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => callback(null, apiRes.statusCode, data));
  });
  req.on('error', (err) => callback(err));
  req.on('timeout', () => { req.destroy(); callback(new Error('timeout')); });
}

function parseAc(raw) {
  const data = JSON.parse(raw);
  const aircraft = data.ac || data.aircraft || [];

  // Log first aircraft raw to understand the shape
  if (aircraft.length > 0) {
    console.log('  Sample aircraft raw:', JSON.stringify(aircraft[0]).substring(0, 300));
  } else {
    console.log('  No aircraft in response. Keys:', Object.keys(data).join(', '));
    console.log('  Raw preview:', raw.substring(0, 200));
  }

  const states = aircraft
    .filter(ac => {
      const hasPos = ac.lat != null && ac.lon != null;
      const onGround = ac.alt_baro === 'ground';
      if (!hasPos) return false;
      if (onGround) return false;
      return true;
    })
    .map(ac => {
      const baroFt = parseFloat(ac.alt_baro) || 0;
      const geoFt  = parseFloat(ac.alt_geom) || baroFt;
      return [
        ac.hex,
        (ac.flight || '').trim() || ac.hex,
        null, null, null,
        parseFloat(ac.lon),
        parseFloat(ac.lat),
        baroFt * 0.3048,       // baro alt in meters
        false,                  // on_ground (already filtered above)
        (parseFloat(ac.gs) || 0) * 0.514444, // knots → m/s
        parseFloat(ac.track) ?? null,         // heading
        (parseFloat(ac.baro_rate) || 0) * 0.00508, // ft/min → m/s
        null,
        geoFt * 0.3048,
        ac.squawk || null,
        false, 0,
      ];
    });

  return { states, time: data.now, total: aircraft.length };
}

const SOURCES = [
  {
    name: 'airplanes.live',
    url: (lat, lon) => `https://api.airplanes.live/v2/lat/${lat}/lon/${lon}/dist/3`,
  },
  {
    name: 'adsb.one',
    url: (lat, lon) => `https://api.adsb.one/v2/lat/${lat}/lon/${lon}/dist/3`,
  },
];

function trySource(i, lat, lon, res) {
  if (i >= SOURCES.length) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'All sources failed', states: [] }));
  }

  const src = SOURCES[i];
  const targetUrl = src.url(lat, lon);
  console.log(`\n[${new Date().toISOString()}] → ${src.name}: ${targetUrl}`);

  fetchUrl(targetUrl, (err, status, data) => {
    if (err) {
      console.log(`  ✗ ${src.name} error: ${err.message}`);
      return trySource(i + 1, lat, lon, res);
    }

    console.log(`  ← HTTP ${status}, ${data.length} bytes`);

    if (status !== 200) {
      console.log(`  ✗ ${src.name} non-200, body: ${data.substring(0, 100)}`);
      return trySource(i + 1, lat, lon, res);
    }

    try {
      const parsed = parseAc(data);
      console.log(`  ✓ ${src.name}: ${parsed.total} total, ${parsed.states.length} airborne`);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ states: parsed.states, time: parsed.time, source: src.name }));
    } catch (e) {
      console.log(`  ✗ Parse error: ${e.message}`);
      trySource(i + 1, lat, lon, res);
    }
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/api/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      sources: SOURCES.map(s => s.name),
      node_version: process.version,
      time: new Date().toISOString(),
    }, null, 2));
  }

  if (parsed.pathname === '/api/opensky') {
    const { lamin, lomin, lamax, lomax } = parsed.query;
    if (!lamin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing parameters' }));
    }
    const lat = ((parseFloat(lamin) + parseFloat(lamax)) / 2).toFixed(4);
    const lon = ((parseFloat(lomin) + parseFloat(lomax)) / 2).toFixed(4);
    trySource(0, lat, lon, res);
    return;
  }

  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ✈  LFPG Runway Detector · port ${PORT}`);
  console.log(`  Sources: ${SOURCES.map(s => s.name).join(' → ')}\n`);
});
