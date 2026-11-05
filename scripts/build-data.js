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
const { loadSuggestions } = require('./suggestions.js');
const { nameAndPlace } = require('./reverse.js');
const { addMedia } = require('./media.js');
const { applyWebsiteFacts } = require('./website-facts.js');
const { chainStores } = require('./chains.js');

const DATA = path.join(__dirname, '..', 'data');
const OSM_FILE = path.join(DATA, 'osm-places.json');
const OUT = path.join(DATA, 'ireland.json');

// Some mirror servers lag weeks behind; never replace newer data with older.
function savedDate() {
  try { return Date.parse(JSON.parse(fs.readFileSync(OSM_FILE, 'utf8')).generated) || 0; } catch (e) { return 0; }
}
async function query() {
  const body = 'data=' + encodeURIComponent(P.OVERPASS_QUERY);
  const have = savedDate();
  let lastErr;
  for (const url of P.OVERPASS_ENDPOINTS) {
    try {
      console.log('Querying', url);
      const res = await fetch(url, {
        method: 'POST', body, signal: AbortSignal.timeout(240000),   // give up on a server that hangs
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DogFriendlyIreland-data-build/1.0' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark);
      const stamp = Date.parse(json.osm3s && json.osm3s.timestamp_osm_base) || 0;
      if (have && stamp && stamp < have - 2 * 864e5) throw new Error('data is out of date (' + json.osm3s.timestamp_osm_base + ')');
      return json;
    } catch (e) { lastErr = e; console.warn('  failed:', e.message); }
  }
  throw lastErr;
}

// Quick updates (when a change is pushed): reuse today's map data instead of downloading it all again.
// The nightly run always downloads fresh data.
const QUICK = process.env.QUICK === '1';
function savedOsm(maxHours) {
  try {
    const saved = JSON.parse(fs.readFileSync(OSM_FILE, 'utf8'));
    return Date.now() - Date.parse(saved.generated) < maxHours * 36e5 ? saved : null;
  } catch (e) { return null; }
}

async function osmPlaces() {
  if (QUICK) {
    const saved = savedOsm(48);
    if (saved) { console.log('Quick update: reusing map data from', saved.generated); return saved; }
  }
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

/* Merge duplicates: the same id twice, or the same business recorded twice close together
   (OpenStreetMap often has a business both as a point and as its building outline). */
const norm = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'of', 'co', 's', 'ltd', 'limited']);
const tokens = s => norm(s).split(' ').filter(w => w && !STOP.has(w));
function km(a, b) {
  const r = Math.PI / 180, x = (b.lo - a.lo) * r * Math.cos((a.la + b.la) / 2 * r), y = (b.la - a.la) * r;
  return Math.hypot(x, y) * 6371;
}
function sameBusiness(a, b) {
  if (a.u || b.u || a.c !== b.c) return false;
  const d = km(a, b);
  if (d > 0.3) return false;
  const ta = tokens(a.n), tb = tokens(b.n);
  if (!ta.length || !tb.length) return false;
  const [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  const subset = small.every(w => big.has(w));
  return subset && (ta.join(' ') === tb.join(' ') || d < 0.1);
}
function mergeInto(keep, drop) {
  Object.keys(drop.t).forEach(k => { if (!keep.t[k]) keep.t[k] = drop.t[k]; });
  if (drop.w) {
    keep.w = keep.w || { s: [] };
    keep.w.s = Array.from(new Set((keep.w.s || []).concat(drop.w.s || [])));
    if (drop.w.n && !keep.w.n) keep.w.n = drop.w.n;
    if (drop.w.by && !keep.w.by) keep.w.by = drop.w.by;
    const vr = { business: 4, team: 3, official: 2, suggested: 1, unconfirmed: 0 };
    if ((vr[drop.w.v] || 0) > (vr[keep.w.v] || 0)) { keep.w.v = drop.w.v; if (drop.w.c) keep.w.c = drop.w.c; }
    if (drop.w.f && !keep.w.f) keep.w.f = drop.w.f;
    if ('a' in keep.w && !drop.w.a) keep.w.a = 0;
  }
  const rank = { yes: 4, unleashed: 4, service: 4, leashed: 3, outside: 2, friendly: 1 };
  if ((rank[drop.d] || 0) > (rank[keep.d] || 0)) keep.d = drop.d;
}
function dedupe(list) {
  const byId = new Map(), out = [];
  let merged = 0;
  // Prefer OpenStreetMap records with the most detail
  list.slice().sort((a, b) => (/^x/.test(a.id) - /^x/.test(b.id)) || (Object.keys(b.t).length - Object.keys(a.t).length))
    .forEach(p => {
      if (byId.has(p.id)) { mergeInto(byId.get(p.id), p); merged++; return; }
      const near = out.find(q => Math.abs(q.la - p.la) < 0.01 && Math.abs(q.lo - p.lo) < 0.015 && sameBusiness(q, p));
      if (near) { mergeInto(near, p); merged++; return; }
      byId.set(p.id, p); out.push(p);
    });
  console.log('Merged', merged, 'duplicates');
  return out;
}

(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  const osm = await osmPlaces();
  const byId = {};
  osm.places.forEach(p => { delete p.w; byId[p.id] = p; });
  // Branches of shops and chains known to welcome dogs (data/chains.csv); they replace the same place from the main download
  const chains = await chainStores();
  chains.forEach(c => {
    const i = osm.places.findIndex(p => p.id === c.id);
    if (i >= 0) { if (osm.places[i].t.dog) c.d = osm.places[i].d; osm.places[i] = c; } else osm.places.push(c);
    byId[c.id] = c;
  });
    await nameAndPlace(osm.places);
  const web = await buildWebPlaces(byId, await loadSuggestions());
  const closedFile = path.join(DATA, 'closed.json');
  const closed = fs.existsSync(closedFile) ? JSON.parse(fs.readFileSync(closedFile, 'utf8')) : {};
  // data/removed.txt: places removed by hand (one id per line, then a note)
  const removedFile = path.join(DATA, 'removed.txt');
  const removed = new Set(fs.existsSync(removedFile) ? fs.readFileSync(removedFile, 'utf8').split('\n').map(l => l.trim().split(/\s+/)[0]).filter(id => id && !id.startsWith('#')) : []);
  let places = dedupe(osm.places.concat(web.places)).filter(p => !closed[p.id] && !removed.has(p.id));
  console.log('Left out', removed.size, 'places removed by hand');
  console.log('Left out', Object.keys(closed).length, 'places listed as permanently closed');
  // Photos, descriptions and extra contact details (may pin town-centre places exactly, so check for duplicates again)
  applyWebsiteFacts(places);
  await addMedia(places);
  places = dedupe(places);
  // data/moves.csv: markers moved by the owner in the app (the latest move of each place wins)
  const movesFile = path.join(DATA, 'moves.csv');
  if (fs.existsSync(movesFile)) {
    const { parseCsv } = require('./web-places.js');
    const moves = {};
    parseCsv(fs.readFileSync(movesFile, 'utf8')).forEach(m => { if (m.id && +m.lat && +m.lon) moves[m.id] = m; });
    let moved = 0;
    places.forEach(p => {
      const m = moves[p.id]; if (!m) return;
      p.la = +(+m.lat).toFixed(6); p.lo = +(+m.lon).toFixed(6);
      if (p.w) p.w.a = 0;
      moved++;
    });
    console.log('Moved', moved, 'markers by hand');
  }
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
