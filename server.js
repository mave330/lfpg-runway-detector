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

const LFPG_LAT = '49.0097';
const LFPG_LON = '2.5479';
const RADIUS_NM = 15;

const SOURCES = [
  {
    name: 'adsb.fi',
    url: `https://opendata.adsb.fi/api/v2/lat/${LFPG_LAT}/lon/${LFPG_LON}/dist/${RADIUS_NM}`,
  },
  {
    name: 'airplanes.live',
    url: `https://api.airplanes.live/v2/point/${LFPG_LAT}/${LFPG_LON}/${RADIUS_NM}`,
  },
  {
    name: 'adsb.one',
    url: `https://api.adsb.one/v2/point/${LFPG_LAT}/${LFPG_LON}/${RADIUS_NM}`,
  },
];

function parseAircraft(raw) {
  const data = JSON.parse(raw);

  // Support both 'ac' (adsbexchange style) and 'aircraft' (adsb.fi style)
  const aircraft = data.ac || data.aircraft || [];

  const states = aircraft
    .filter(ac => ac.lat != null && ac.lon != null)
    .map(ac => {
      // alt_baro can be the string "ground" OR a number in feet
      const isGround  = ac.alt_baro === 'ground';
      const baroFt    = isGround ? 0 : (parseFloat(ac.alt_baro) || 0);
      const geoFt     = parseFloat(ac.alt_geom) || baroFt;
      const speedKts  = parseFloat(ac.gs) || 0;
      const onGround  = isGround || (baroFt < 100 && speedKts < 50);

      // baro_rate: adsb.fi gives ft/min, convert to m/s
      const baroRateFtMin = parseFloat(ac.baro_rate) || 0;
      const vsMs          = baroRateFtMin * 0.00508;

      return [
        ac.hex,                                   // [0]  icao24
        (ac.flight || '').trim() || ac.hex,       // [1]  callsign
        null,                                     // [2]  origin_country
        null, null,                               // [3,4] time_pos, last_contact
        parseFloat(ac.lon),                       // [5]  longitude
        parseFloat(ac.lat),                       // [6]  latitude
        baroFt * 0.3048,                          // [7]  baro_altitude metres
        onGround,                                 // [8]  on_ground
        speedKts * 0.514444,                      // [9]  velocity m/s
        parseFloat(ac.track) || null,             // [10] true_track (heading)
        vsMs,                                     // [11] vertical_rate m/s
        null,                                     // [12] sensors
        geoFt * 0.3048,                           // [13] geo_altitude metres
        ac.squawk || null,                        // [14] squawk
        false, 0,                                 // [15,16] spi, position_source
      ];
    });

  return { states, time: data.now, raw_count: aircraft.length };
}

function tryFetch(sourceIndex, res) {
  if (sourceIndex >= SOURCES.length) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ states: [], error: 'All ADS-B sources failed' }));
  }

  const source = SOURCES[sourceIndex];
  console.log(`[${new Date().toISOString()}] → ${source.name}`);

  const req = https.get(source.url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; RunwayDetector/1.0)',
    }
  }, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      console.log(`[${new Date().toISOString()}] ← ${source.name} HTTP ${apiRes.statusCode} · ${data.length} bytes`);

      if (apiRes.statusCode !== 200 || data.length < 5) {
        return tryFetch(sourceIndex + 1, res);
      }
      try {
        const parsed = parseAircraft(data);
        console.log(`  ✓ ${source.name} — ${parsed.states.length} airborne / ${parsed.raw_count} total`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify({ states: parsed.states, time: parsed.time, source: source.name }));
      } catch (e) {
        console.log(`  Parse error: ${e.message}`);
        tryFetch(sourceIndex + 1, res);
      }
    });
  });

  req.on('error', (err) => {
    console.log(`  ✗ ${source.name}: ${err.message}`);
    tryFetch(sourceIndex + 1, res);
  });

  req.setTimeout(10000, () => {
    console.log(`  ✗ ${source.name}: timeout`);
    req.destroy();
    tryFetch(sourceIndex + 1, res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
  }

  if (parsed.pathname === '/api/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      airport: 'LFPG', center: `${LFPG_LAT}N ${LFPG_LON}E`,
      radius: `${RADIUS_NM} nm`,
      sources: SOURCES.map(s => ({ name: s.name, url: s.url })),
      node_version: process.version,
      time: new Date().toISOString(),
    }, null, 2));
  }

  if (parsed.pathname === '/api/sia') {
    fetchSIA(res);
    return;
  }

  if (parsed.pathname === '/api/opensky') {
    tryFetch(0, res);
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
  console.log(`  Health  : http://localhost:${PORT}/health`);
  console.log(`  Radius  : ${RADIUS_NM} nm around LFPG`);
  console.log(`  Sources : ${SOURCES.map(s => s.name).join(' → ')}\n`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM — shutting down gracefully');
  server.close(() => process.exit(0));
});

// ── SIA Official Data Proxy ──
// Serves the official French AIP aeronautical XML from data.gouv.fr
// So the frontend can parse exact LFPG runway coordinates from source
const SIA_XML_URL = 'https://www.data.gouv.fr/api/1/datasets/r/286d2c5d-d833-4d3c-a221-04ee919eb83f';
let siaCache = null;
let siaCacheTime = 0;
const SIA_TTL = 24 * 3600 * 1000; // refresh once per day

function fetchSIA(res) {
  const now = Date.now();
  if (siaCache && (now - siaCacheTime) < SIA_TTL) {
    res.writeHead(200, { 'Content-Type': 'application/xml', 'Cache-Control': 'max-age=86400' });
    return res.end(siaCache);
  }
  https.get(SIA_XML_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LFPG-RunwayDetector/1.0)' }
  }, (apiRes) => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      if (apiRes.statusCode === 200 && data.length > 100) {
        siaCache = data;
        siaCacheTime = now;
        console.log(`[SIA] Fetched ${data.length} bytes of official aeronautical data`);
      }
      res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/xml', 'Cache-Control': 'max-age=86400' });
      res.end(data);
    });
  }).on('error', (err) => {
    console.error('[SIA] Fetch error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });
}
