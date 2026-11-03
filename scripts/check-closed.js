#!/usr/bin/env node
/* Monthly check: asks Google whether each place is permanently closed (Places API "businessStatus").
   Needs a Google Maps Platform key in the GOOGLE_MAPS_KEY secret. One Text Search (Pro) request per place;
   Google gives 5,000 of these free each month, and this uses about 1,700.
   Writes data/closed.json: places Google lists as permanently closed. The nightly build leaves them out. */
'use strict';
const fs = require('fs');
const path = require('path');

const KEY = process.env.GOOGLE_MAPS_KEY;
const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'closed.json');
const LIMIT = +(process.env.CHECK_LIMIT || 2500);   // stay well inside the free monthly allowance

const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'of', 'bar', 'pub', 'cafe', 'coffee', 'hotel', 'restaurant', 'house', 'co', 's']);
function similar(a, b) {
  const ta = norm(a).split(' ').filter(w => w && !STOP.has(w)), tb = new Set(norm(b).split(' '));
  return ta.length ? ta.filter(w => tb.has(w)).length / ta.length : 0;
}
function km(a, b) {
  const r = Math.PI / 180, x = (b.lo - a.lo) * r * Math.cos((a.la + b.la) / 2 * r), y = (b.la - a.la) * r;
  return Math.hypot(x, y) * 6371;
}

async function lookup(p) {
  const town = p.t['addr:town'] || p.t['addr:city'] || p.t['addr:village'] || '';
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.businessStatus'
    },
    body: JSON.stringify({
      textQuery: [p.n, town].filter(Boolean).join(', '),
      pageSize: 3,
      locationBias: { circle: { center: { latitude: p.la, longitude: p.lo }, radius: p.w && p.w.a ? 5000 : 800 } }
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  const best = (j.places || [])
    .map(g => ({ g, d: km(p, { la: g.location.latitude, lo: g.location.longitude }), s: similar(p.n, g.displayName ? g.displayName.text : '') }))
    .filter(x => x.s >= 0.6 && x.d < (p.w && p.w.a ? 5 : 0.5))
    .sort((a, b) => b.s - a.s || a.d - b.d)[0];
  return best ? { gid: best.g.id, status: best.g.businessStatus || '' } : null;
}

(async () => {
  if (!KEY) { console.log('No GOOGLE_MAPS_KEY set; skipping closure check.'); return; }
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'ireland.json'), 'utf8'));
  const closed = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const places = data.places.filter(p => !p.u && !p.gn).slice(0, LIMIT);
  let n = 0, found = 0;
  for (const p of places) {
    try {
      const r = await lookup(p); n++;
      if (r && r.status === 'CLOSED_PERMANENTLY') {
        closed[p.id] = { name: p.n, town: p.t['addr:town'] || p.t['addr:city'] || '', gid: r.gid, checked: new Date().toISOString().slice(0, 10) };
        found++;
      } else if (r && closed[p.id]) delete closed[p.id];   // reopened
    } catch (e) { console.warn(p.n, e.message); if (/HTTP 4(01|03)/.test(e.message)) break; }
    await new Promise(r => setTimeout(r, 120));
  }
  fs.writeFileSync(OUT, JSON.stringify(closed, null, 1));
  console.log(`Checked ${n} places; ${found} newly listed as permanently closed; ${Object.keys(closed).length} closed in total.`);
})().catch(e => { console.error(e); process.exit(1); });
