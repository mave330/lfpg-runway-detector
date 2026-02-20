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

// Try multiple sources in order until one works
const SOURCES = [
  {
    name: 'adsb.one',
    buildUrl: (lat, lon) => `https://api.adsb.one/v2/lat/${lat}/lon/${lon}/dist/3`,
    parse: parseAdsbExchangeV2,
  },
  {
    name: 'adsbexchange (globe)',
    buildUrl: (lat, lon) => `https://globe.adsbexchange.com/re-api/?circle=${lat},${lon},5`,
    parse: parseAdsbExchangeV2,
  },
  {
    name: 'airplanes.live',
    buildUrl: (lat, lon) => `https://api.airplanes.live/v2/lat/${lat}/lon/${lon}/dist/3`,
    parse: parseAdsbExchangeV2,
  },
];

function parseAdsbExchangeV2(raw) {
  const data = JSON.parse(raw);
  const aircraft = data.ac || data.aircraft || [];
  const states = aircraft
    .filter(ac => ac.lat != null && ac.lon != null)
    .map(ac => {
      const baroFt   = ac.alt_baro === 'ground' ? 0 : (parseFloat(ac.alt_baro) || 0);
      const geoFt    = parseFloat(ac.alt_geom) || baroFt;
      const onGround = ac.alt_baro === 'ground' || (parseFloat(ac.gs) || 0) < 30;
      return [
        ac.hex,
        (ac.flight || '').trim() || ac.hex,
        null, null, null,
        parseFloat(ac.lon),
        parseFloat(ac.lat),
        baroFt * 0.3048,
        onGround,
        (parseFloat(ac.gs) || 0) * 0.514444,
        parseFloat(ac.track) || null,
        (parseFloat(ac.baro_rate) || 0) * 0.00508,
        null,
        geoFt * 0.3048,
        ac.squawk || null,
        false, 0,
      ];
    });
  return { states, time: data.now };
}

function tryFetch(sourceIndex, lat, lon, res) {
  if (sourceIndex >= SOURCES.length) {
    console.error('All sources failed');
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'All ADS-B sources failed or returned no data' }));
  }

  const source = SOURCES[sourceIndex];
  const targetUrl = source.buildUrl(lat, lon);
  console.log(`[${new Date().toISOString()}] → Trying ${source.name}: ${targetUrl}`);

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; LFPG-RunwayDetector/1.0)',
    'Referer': 'https://globe.adsbexchange.com/',
  };

  https.get(targetUrl, { headers, timeout: 8000 }, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log(`[${new Date().toISOString()}] ← ${source.name} HTTP ${apiRes.statusCode} · ${data.length} bytes`);

      if (apiRes.statusCode !== 200 || data.length < 10) {
        console.log(`  → ${source.name} failed (${apiRes.statusCode}), trying next source`);
        return tryFetch(sourceIndex + 1, lat, lon, res);
      }

      try {
        const parsed = source.parse(data);
        console.log(`  ✓ ${source.name} OK — ${parsed.states.length} aircraft`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ states: parsed.states, time: parsed.time, source: source.name }));
      } catch (e) {
        console.log(`  → ${source.name} parse error: ${e.message}, trying next`);
        tryFetch(sourceIndex + 1, lat, lon, res);
      }
    });
  }).on('error', (err) => {
    console.log(`  → ${source.name} error: ${err.message}, trying next source`);
    tryFetch(sourceIndex + 1, lat, lon, res);
  }).on('timeout', () => {
    console.log(`  → ${source.name} timeout, trying next source`);
    tryFetch(sourceIndex + 1, lat, lon, res);
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
      return res.end(JSON.stringify({ error: 'Missing bbox parameters' }));
    }
    const lat = ((parseFloat(lamin) + parseFloat(lamax)) / 2).toFixed(4);
    const lon = ((parseFloat(lomin) + parseFloat(lomax)) / 2).toFixed(4);
    tryFetch(0, lat, lon, res);
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
