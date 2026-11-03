#!/usr/bin/env node
/* Builds data/ireland.json, the file the app loads:
   1. every dog-related place on the island of Ireland from OpenStreetMap (saved as data/osm-places.json), and
   2. researched places from data/web-places.csv, located on the map (see scripts/web-places.js).
   If the OpenStreetMap server is busy, the last saved copy is reused so researched places still update.
   Run: node scripts/build-data.js   (Node 18 or newer) */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/places.js');
const { buildWebPlaces } = require('./web-places.js');

const DATA = path.join(__dirname, '..', 'data');
const OSM_FILE = path.join(DATA, 'osm-places.json');
const OUT = path.join(DATA, 'ireland.json');

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

async function osmPlaces() {
  try {
    const json = await query();
    const places = P.fromOverpass(json);
    if (places.length < 500) throw new Error('Only ' + places.length + ' places returned');
    const osm = { generated: (json.osm3s && json.osm3s.timestamp_osm_base) || new Date().toISOString(), places };
    fs.writeFileSync(OSM_FILE, JSON.stringify(osm));
    return osm;
  } catch (e) {
    console.warn('OpenStreetMap download failed (' + e.message + '); using the last saved copy.');
    if (fs.existsSync(OSM_FILE)) return JSON.parse(fs.readFileSync(OSM_FILE, 'utf8'));
    if (fs.existsSync(OUT)) {
      const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      return { generated: old.generated, places: old.places.filter(p => !(p.w && 'a' in p.w)) };
    }
    throw e;
  }
}

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const osm = await osmPlaces();
  const byId = {};
  osm.places.forEach(p => { delete p.w; byId[p.id] = p; });
  const web = await buildWebPlaces(byId);
  const places = osm.places.concat(web.places);
  const out = {
    generated: osm.generated,
    built: new Date().toISOString(),
    count: places.length,
    licence: 'Map data © OpenStreetMap contributors, ODbL 1.0. Researched places compiled from the public sources linked on each place.',
    places
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const byCat = {};
  places.forEach(p => { byCat[p.c] = (byCat[p.c] || 0) + 1; });
  console.log(`Wrote ${places.length} places (${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB)`);
  console.table(byCat);
})().catch(e => { console.error(e); process.exit(1); });
