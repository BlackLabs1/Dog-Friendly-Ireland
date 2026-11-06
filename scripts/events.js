/* Dog events (shows, expos, fun days, charity walks) from data/events.csv. They are temporary places: an event is
   left out once its end date has passed, and the app also hides finished events between builds.

   Columns: name, start (YYYY-MM-DD), end (YYYY-MM-DD, blank for one day), time, venue, street, town, county,
   lat, lon (optional; otherwise the venue is looked up), dogs (yes, leashed, outside, friendly, service),
   price, website, source, description, note, verified (business = from the organiser, official = tourism body,
   unconfirmed = listing site), checked (date the listing was last checked). */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/places.js');
const { parseCsv, nominatim, hash, norm, NI } = require('./web-places.js');

const DATA = path.join(__dirname, '..', 'data');
const CSV = path.join(DATA, 'events.csv');
const CACHE = path.join(DATA, 'geocode-cache.json');

function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' }); }

async function findVenue(r) {
  const region = NI.test(r.county) ? 'County ' + r.county + ', Northern Ireland' : (r.county === 'Dublin' ? 'Dublin' : 'County ' + r.county);
  const tries = [];
  if (r.venue) tries.push(r.venue + ', ' + (r.street ? r.street + ', ' : '') + r.town + ', ' + region, r.venue + ', ' + region);
  if (r.street) tries.push(r.street + ', ' + r.town + ', ' + region);
  for (const q of tries) {
    const hits = await nominatim({ q, limit: 3 });
    const h = hits.find(x => norm(x.display_name).includes(norm(r.county)) || norm(x.display_name).includes(norm(r.town)) ||
      (/derry/i.test(r.county) && /londonderry/i.test(x.display_name)));
    if (h) return { la: +h.lat, lo: +h.lon, approx: 0 };
  }
  const t = await nominatim({ q: r.town + ', ' + region, limit: 1 });
  return t.length ? { la: +t[0].lat, lo: +t[0].lon, approx: 1 } : null;
}

async function buildEvents(log = console.log) {
  if (!fs.existsSync(CSV)) return [];
  const now = today();
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8')).filter(r => r.name && r.start && r.county);
  const live = rows.filter(r => (r.end || r.start) >= now);
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const out = [];
  for (const r of live) {
    let g = +r.lat && +r.lon ? { la: +r.lat, lo: +r.lon, approx: 0 } : null;
    const key = 'event|' + norm(r.venue) + '|' + norm(r.street) + '|' + norm(r.town) + '|' + norm(r.county);
    if (!g && cache[key] !== undefined) g = cache[key];
    if (!g) { try { g = await findVenue(r); } catch (e) { log('  event lookup failed:', r.name, e.message); continue; } cache[key] = g; }
    if (!g) { log('  event not found on the map:', r.name); continue; }
    const tags = {};
    tags[NI.test(r.county) || r.county === 'Dublin' ? 'addr:city' : 'addr:town'] = r.town;
    tags['addr:county'] = (r.county === 'Dublin' ? 'County ' : 'Co. ') + r.county;
    if (r.street) tags['addr:street'] = r.street;
    if (r.website) tags.website = r.website;
    const ev = { s: r.start };
    if (r.end && r.end !== r.start) ev.e = r.end;
    if (r.time) ev.tm = r.time;
    if (r.venue) ev.v = r.venue;
    if (r.price) ev.pr = r.price;
    const place = {
      id: 'e' + hash(norm(r.name) + '|' + r.start + '|' + norm(r.town)),
      la: Math.round(g.la * 1e6) / 1e6, lo: Math.round(g.lo * 1e6) / 1e6,
      n: r.name, u: 0, c: 'event', d: P.POLICIES[r.dogs] ? r.dogs : 'friendly', k: 'Event', t: tags, ev,
      w: Object.assign({ s: r.source ? [r.source] : [], n: r.note || '', a: g.approx, v: r.verified || 'unconfirmed' }, r.checked ? { c: r.checked } : {})
    };
    if (r.description) place.ds = r.description;
    out.push(place);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  log(`Events: ${rows.length} listed, ${out.length} upcoming added, ${rows.length - live.length} finished and left out`);
  return out;
}

module.exports = { buildEvents };
