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
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'LFPG-RunwayDetector/1.0',
  };
  https.get(targetUrl, { headers }, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => callback(null, apiRes.statusCode, data));
  }).on('error', (err) => callback(err));
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ── Debug endpoint ──
  if (parsed.pathname === '/api/debug') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      source: 'adsb.one (free, no key required)',
      endpoint: 'https://api.adsb.one/v2/lat/{lat}/lon/{lon}/dist/{nm}',
      node_version: process.version,
      time: new Date().toISOString(),
    }, null, 2));
  }

  // ── Aircraft proxy: calls adsb.one by lat/lon/radius ──
  if (parsed.pathname === '/api/opensky') {
    const { lamin, lomin, lamax, lomax } = parsed.query;
    if (!lamin || !lomin || !lamax || !lomax) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing bbox parameters' }));
    }

    // Convert bbox center to lat/lon + radius in nautical miles
    const lat  = ((parseFloat(lamin) + parseFloat(lamax)) / 2).toFixed(4);
    const lon  = ((parseFloat(lomin) + parseFloat(lomax)) / 2).toFixed(4);
    const dist = 3; // ~5km in NM

    // adsb.one v2 API — free, no auth, cloud-friendly
    const target = `https://api.adsb.one/v2/lat/${lat}/lon/${lon}/dist/${dist}`;

    console.log(`[${new Date().toISOString()}] → adsb.one: ${target}`);

    fetchUrl(target, (err, status, data) => {
      if (err) {
        console.error(`[${new Date().toISOString()}] ✗ Error: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }

      console.log(`[${new Date().toISOString()}] ← HTTP ${status} · ${data.length} bytes`);

      // adsb.one returns { ac: [...], msg, now, total, ... }
      // Convert to OpenSky-compatible format expected by frontend
      try {
        const adsbData = JSON.parse(data);
        const aircraft = adsbData.ac || [];

        // Map adsb.one fields → OpenSky state vector array format
        // [icao24, callsign, origin, time_pos, last_contact, lon, lat,
        //  baro_alt_m, on_ground, velocity_ms, true_track, vertical_rate_ms,
        //  sensors, geo_alt_m, squawk, spi, position_source]
        const states = aircraft
          .filter(ac => ac.lat != null && ac.lon != null)
          .map(ac => {
            const baroFt = ac.alt_baro === 'ground' ? 0 : (parseFloat(ac.alt_baro) || 0);
            const geoFt  = parseFloat(ac.alt_geom) || baroFt;
            const onGround = ac.alt_baro === 'ground' || ac.gs < 30;
            return [
              ac.hex,                                     // icao24
              (ac.flight || '').trim() || ac.hex,        // callsign
              null,                                       // origin_country
              ac.seen_pos || 0,                           // time_position
              ac.seen || 0,                               // last_contact
              parseFloat(ac.lon),                         // longitude
              parseFloat(ac.lat),                         // latitude
              baroFt * 0.3048,                            // baro_altitude (m)
              onGround,                                   // on_ground
              (parseFloat(ac.gs) || 0) * 0.514444,       // velocity (m/s)
              parseFloat(ac.track) || null,               // true_track (heading)
              (parseFloat(ac.baro_rate) || 0) * 0.00508, // vertical_rate (m/s)
              null,                                       // sensors
              geoFt * 0.3048,                             // geo_altitude (m)
              ac.squawk || null,                          // squawk
              false,                                      // spi
              0,                                          // position_source
            ];
          });

        const out = JSON.stringify({ time: adsbData.now, states });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(out);

      } catch (parseErr) {
        console.error('Parse error:', parseErr.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ states: [] }));
      }
    });

    return;
  }

  // ── Static files ──
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
  console.log(`\n  ✈  LFPG Runway Detector`);
  console.log(`  Port    : ${PORT}`);
  console.log(`  Source  : adsb.one (free · no API key · cloud-friendly)`);
  console.log(`  Endpoint: https://api.adsb.one/v2/lat/49.0097/lon/2.5479/dist/3\n`);
});
