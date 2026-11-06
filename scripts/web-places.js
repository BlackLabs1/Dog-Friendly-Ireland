/* Researched places: data/web-places.csv lists dog-friendly businesses found in media articles, tourism guides
   and businesses' own websites. This module finds each one on the map using OpenStreetMap's Nominatim search,
   and turns it into the same record shape the app uses. Results are cached in data/geocode-cache.json so each
   place is only looked up once (Nominatim allows one request per second).

   To add a place: add a row to data/web-places.csv on GitHub. It appears after the next nightly run. */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/places.js');

const DATA = path.join(__dirname, '..', 'data');
const CSV = path.join(DATA, 'web-places.csv');
const CACHE = path.join(DATA, 'geocode-cache.json');
const UA = 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const NI = /^(antrim|armagh|down|fermanagh|derry|londonderry|tyrone)$/i;

const KIND = {
  cafe: 'Café', pub: 'Pub', food: 'Restaurant', stay: 'Accommodation', outdoors: 'Outdoors',
  attraction: 'Attraction', shop: 'Shop', petshop: 'Pet shop', care: 'Dog care', dogpark: 'Dog park',
  rescue: 'Rescue', vet: 'Vet', health: 'Health & care', other: 'Place'
};
// Tags worth keeping from a matched OpenStreetMap object
const EXTRA = ['opening_hours', 'phone', 'contact:phone', 'website', 'contact:website', 'email', 'contact:email',
  'facebook', 'contact:facebook', 'instagram', 'contact:instagram', 'cuisine', 'outdoor_seating', 'wheelchair',
  'description', 'stars', 'image', 'wikimedia_commons'];

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
async function nominatim(params) {
  const wait = 1100 - (Date.now() - last); if (wait > 0) await sleep(wait);
  last = Date.now();
  const u = new URL('https://nominatim.openstreetmap.org/search');
  Object.entries(Object.assign({ format: 'jsonv2', addressdetails: 1, extratags: 1, limit: 5,
    countrycodes: 'ie,gb', viewbox: '-11.0,55.5,-5.2,51.3', bounded: 1 }, params)).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
      if (res.status === 429) { await sleep(5000); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (attempt === 2) throw e; await sleep(2000); }
  }
  return [];
}

const norm = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'bar', 'pub', 'cafe', 'coffee', 'hotel', 'restaurant', 'and', 'co', 'of', 'inn', 'house', 'shop', 'kitchen', 'company']);
function nameScore(want, got) {
  const a = norm(want).split(' ').filter(w => w && !STOP.has(w));
  const b = new Set(norm(got).split(' '));
  if (!a.length) return norm(want) === norm(got) ? 1 : 0;
  return a.filter(w => b.has(w)).length / a.length;
}
function inCounty(hit, county, town) {
  const addr = norm(hit.display_name);
  return addr.includes(norm(county)) || (county.toLowerCase() === 'derry' && addr.includes('londonderry')) || addr.includes(norm(town));
}

async function locate(r) {
  const region = NI.test(r.county) ? 'County ' + r.county + ', Northern Ireland' : (r.county === 'Dublin' ? 'Dublin' : 'County ' + r.county);
  const tries = [r.name + ', ' + r.town + ', ' + region, r.name + ', ' + region];
  if (r.street) tries.unshift(r.name + ', ' + r.street + ', ' + r.town + ', ' + region);
  for (const q of tries) {
    const hits = await nominatim({ q });
    const good = hits
      .filter(h => inCounty(h, r.county, r.town))
      .map(h => ({ h, s: nameScore(r.name, h.name || h.display_name.split(',')[0]) }))
      .filter(x => x.s >= 0.6)
      .sort((a, b) => b.s - a.s || (b.h.importance || 0) - (a.h.importance || 0));
    if (good.length) {
      const h = good[0].h;
      const extras = {};
      EXTRA.forEach(k => { if (h.extratags && h.extratags[k]) extras[k] = h.extratags[k]; });
      const a = h.address || {};
      if (a.road) extras['addr:street'] = a.road;
      if (a.house_number) extras['addr:housenumber'] = a.house_number;
      if (a.postcode) extras['addr:postcode'] = a.postcode;
      return { la: +h.lat, lo: +h.lon, approx: 0, osm: h.osm_type ? h.osm_type.charAt(0) + h.osm_id : null, tags: extras };
    }
  }
  // Fall back to the street, then the town centre
  if (r.street) {
    const st = await nominatim({ q: r.street + ', ' + r.town + ', ' + region, limit: 1 });
    if (st.length) return { la: +st[0].lat, lo: +st[0].lon, approx: 1, osm: null, tags: {} };
  }
  const hits = await nominatim({ q: r.town + ', ' + region, limit: 1 });
  if (hits.length) return { la: +hits[0].lat, lo: +hits[0].lon, approx: 1, osm: null, tags: {} };
  return null;
}

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/* Returns { places, stats }. osmById: map of existing OSM records (by id) so matches merge instead of duplicating. */
async function buildWebPlaces(osmById, extraRows = [], log = console.log) {
  const fileRows = fs.existsSync(CSV) ? parseCsv(fs.readFileSync(CSV, 'utf8')) : [];
  const rows = fileRows.concat(extraRows).filter(r => r.name && r.county && r.verified !== 'closed' && r.verified !== 'no-dogs');   // no-dogs: research found dogs are not allowed
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const out = []; let merged = 0, looked = 0, failed = 0, approx = 0;
  for (const r of rows) {
    const key = norm(r.name) + '|' + norm(r.town) + '|' + norm(r.county);
    let g = cache[key];
    // A row with its own map position doesn't need looking up
    if (+r.lat && +r.lon) g = { la: +r.lat, lo: +r.lon, approx: 0, osm: null, tags: {} };
    if (g === undefined) {
      try { g = await locate(r); looked++; } catch (e) { log('  lookup failed:', r.name, e.message); continue; }
      cache[key] = g;
      if (looked % 25 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); log('  looked up', looked); }
    }
    if (!g) { failed++; continue; }
    if (g.approx) approx++;
    const cat = P.CAT_BY_ID[r.category] ? r.category : 'other';
    const policy = P.POLICIES[r.policy] ? r.policy : 'friendly';
    const src = r.source ? [r.source] : [];
    const existing = g.osm && osmById[g.osm];
    if (existing) {
      // Already on the map from OpenStreetMap: add the web source and, if OSM had no dog tag, the web policy
      existing.w = existing.w || { s: [] };
      existing.w.s = Array.from(new Set(existing.w.s.concat(src)));
      if (r.note && !existing.w.n) existing.w.n = r.note;
      if (r.by && !existing.w.by) existing.w.by = r.by;
      if (r.photo) existing.w.ph = r.photo;
      existing.w.v = r.verified || 'unconfirmed';
      if (r.found_in && r.found_in !== r.source) existing.w.f = r.found_in;
      if (r.checked) existing.w.c = r.checked;
      if (!existing.t.dog && existing.d !== 'service') existing.d = policy;
      if (r.description && !existing.ds) existing.ds = r.description;
      merged++;
      continue;
    }
    // Spread places that share a town-centre position so they don't sit on top of each other
    let la = g.la, lo = g.lo;
    if (g.approx) { const h = parseInt(hash(key), 36); la += ((h % 200) - 100) / 1e5 * 1.5; lo += (((h >> 8) % 200) - 100) / 1e5 * 2.5; }
    const tags = Object.assign({}, g.tags);
    tags[NI.test(r.county) || r.county === 'Dublin' ? 'addr:city' : 'addr:town'] = r.town;
    tags['addr:county'] = (r.county === 'Dublin' ? 'County ' : 'Co. ') + r.county;
    if (r.street && !tags['addr:street']) tags['addr:street'] = r.street;
    ['phone', 'website', 'facebook', 'instagram'].forEach(k => { if (r[k] && !tags[k] && !tags['contact:' + k]) tags['contact:' + k] = r[k]; });
    if (r.postcode && !tags['addr:postcode']) tags['addr:postcode'] = r.postcode;
    out.push({
      id: g.osm || 'x' + hash(key),
      la: Math.round(la * 1e6) / 1e6, lo: Math.round(lo * 1e6) / 1e6,
      n: r.name, u: 0, c: cat, d: policy, k: KIND[cat], t: tags,
      w: Object.assign({ s: src, n: r.note || '', a: g.approx, v: r.by ? 'suggested' : (r.verified || 'unconfirmed') },
        r.by ? { by: r.by } : {}, r.photo ? { ph: r.photo } : {}, r.found_in && r.found_in !== r.source ? { f: r.found_in } : {}, r.checked ? { c: r.checked } : {})
    });
    if (r.description) out[out.length - 1].ds = r.description;
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  log(`Researched places: ${rows.length} listed, ${out.length} added, ${merged} matched existing map places, ${approx} at town centre, ${failed} not found, ${looked} new lookups`);
  return { places: out, merged };
}

module.exports = { buildWebPlaces, parseCsv, nominatim, hash, norm, NI };
