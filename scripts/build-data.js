#!/usr/bin/env node
/* Downloads every dog-friendly place on the island of Ireland from OpenStreetMap
   and writes the compact file the app loads: data/ireland.json
   Run: node scripts/build-data.js   (Node 18 or newer) */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/places.js');

async function query() {
  const body = 'data=' + encodeURIComponent(P.OVERPASS_QUERY);
  let lastErr;
  for (const url of P.OVERPASS_ENDPOINTS) {
    try {
      console.log('Querying', url);
      const res = await fetch(url, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DogFriendlyIreland-data-build/1.0' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark);
      return json;
    } catch (e) { lastErr = e; console.warn('  failed:', e.message); }
  }
  throw lastErr;
}

(async () => {
  const json = await query();
  const places = P.fromOverpass(json);
  if (places.length < 500) throw new Error('Only ' + places.length + ' places returned; refusing to overwrite the data file.');
  const out = {
    generated: (json.osm3s && json.osm3s.timestamp_osm_base) || new Date().toISOString(),
    count: places.length,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright',
    places
  };
  const file = path.join(__dirname, '..', 'data', 'ireland.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const byCat = {};
  places.forEach(p => { byCat[p.c] = (byCat[p.c] || 0) + 1; });
  console.log(`Wrote ${places.length} places (${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
  console.table(byCat);
})().catch(e => { console.error(e); process.exit(1); });
