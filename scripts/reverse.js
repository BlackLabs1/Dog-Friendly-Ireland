/* Gives unnamed places a useful name and fills in missing towns, using OpenStreetMap's Nominatim reverse lookup.
   "Dog park" inside Marlay Park becomes "Marlay Park Dog Park"; one with no park around it becomes "Dog park, Ballincollig".
   Results are cached in data/reverse-cache.json, so each place is only looked up once (one request per second). */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', 'data', 'reverse-cache.json');
const UA = 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;

async function reverse(la, lo) {
  const wait = 1100 - (Date.now() - last); if (wait > 0) await sleep(wait);
  last = Date.now();
  const u = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=' + la + '&lon=' + lo;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
      if (res.status === 429) { await sleep(5000); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const a = j.address || {};
      return {
        park: a.leisure || a.park || a.nature_reserve || '',
        area: a.suburb || a.neighbourhood || a.quarter || a.village || a.town || a.city_district || a.hamlet || a.city || '',
        town: a.town || a.village || a.city || a.suburb || '',
        county: a.county || ''
      };
    } catch (e) { if (i === 2) throw e; await sleep(2000); }
  }
  return null;
}

const TOWN_KEYS = ['addr:town', 'addr:city', 'addr:village', 'addr:suburb', 'addr:place'];
// Administrative labels that read badly as place names
const ADMIN = /\bD?ED\b|municipal district|electoral|\brural\b|\burban\b|local electoral|county council/i;
function clean(v) {
  if (!v) return '';
  // "Dunmurry ED" -> "Dunmurry", "Balbriggan Rural DED 1986" -> "Balbriggan". Municipal districts are too broad, so they're dropped.
  v = v.replace(/\s+(rural\s+|urban\s+)?D?ED(\s+\d{4})?$/i, '')
    .replace(/\s+(rural|urban)$/i, '').trim();
  return v && !ADMIN.test(v) ? v : '';
}
// Dog parks whose OSM name only describes the enclosure ("Small Dog", "Large dogs area")
const GENERIC = /^(the\s+)?(small|large|big|little|puppy|agility|quiet)?\s*(dogs?|dog park|dog run|dog area|dog walking area|enclosure|off[- ]lead area)(\s+(area|run|park|section|enclosure))?$/i;

async function nameAndPlace(places, log = console.log, maxLookups = 3000) {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  let looked = 0, named = 0;
  for (const p of places) {
    const generic = p.c === 'dogpark' && !p.u && GENERIC.test(p.n.trim());
    const needsName = p.u || generic, needsTown = !TOWN_KEYS.some(k => p.t[k]);
    if (!needsName && !needsTown) continue;
    let r = cache[p.id];
    if (r === undefined) {
      if (looked >= maxLookups) continue;
      try { r = await reverse(p.la, p.lo); } catch (e) { log('  reverse lookup failed', p.id, e.message); continue; }
      cache[p.id] = r; looked++;
      if (looked % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); log('  reverse lookups', looked); }
    }
    if (!r) continue;
    const area = clean(r.area) || clean(r.town), townName = clean(r.town) || clean(r.area);
    if (needsTown && townName) p.t['addr:town'] = townName;
    if (needsTown && r.county && !p.t['addr:county']) p.t['addr:county'] = r.county;
    if (needsName) {
      const kind = p.k || 'Place';
      const park = r.park && !GENERIC.test(r.park.trim()) && r.park.trim().toLowerCase() !== p.n.trim().toLowerCase() ? r.park : '';
      const label = kind === 'Other' ? 'Dog-friendly spot' : kind;
      const part = generic ? ' (' + p.n.trim().toLowerCase() + ')' : '';
      if (park && p.c === 'dogpark') p.n = (/dog/i.test(park) ? park : park + ' Dog Park') + part;
      else if (park) p.n = label + ' in ' + park;
      else if (area) p.n = (generic ? 'Dog park' : label) + ', ' + area + part;
      else continue;
      p.u = 0; p.gn = 1; named++;
    }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  log(`Named ${named} unnamed places; ${looked} new reverse lookups`);
}

module.exports = { nameAndPlace };
