/* Shops and restaurant chains known to welcome dogs (data/chains.csv).
   Each rule names a brand and where it applies: "all" for every branch on the island of Ireland,
   or a named area (for example "dundrum" for Dundrum Town Centre only).
   The nightly build finds the branches on OpenStreetMap by name or brand, so new branches appear
   and closed ones drop off by themselves. Results are saved to data/chain-stores.json in case the map server is busy. */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/places.js');
const { parseCsv } = require('./web-places.js');

const DATA = path.join(__dirname, '..', 'data');
const RULES = path.join(DATA, 'chains.csv');
const SAVED = path.join(DATA, 'chain-stores.json');

// Areas a rule can be limited to: [south, west, north, east]
const AREAS = {
  dundrum: [53.2838, -6.2475, 53.2898, -6.2372]   // Dundrum Town Centre
};

const esc = s => s.replace(/[\\"]/g, m => '\\' + m);

async function overpass(query) {
  let last;
  for (const url of P.OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(240000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DogFriendlyIreland-data-build/1.0' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.remark && /error|timed out/i.test(j.remark)) throw new Error(j.remark);
      return j;
    } catch (e) { last = e; }
  }
  throw last;
}

function inArea(p, a) { return p.la >= a[0] && p.la <= a[2] && p.lo >= a[1] && p.lo <= a[3]; }

async function chainStores(log = console.log) {
  if (!fs.existsSync(RULES)) return [];
  const rules = parseCsv(fs.readFileSync(RULES, 'utf8')).filter(r => r.brand && r.match);
  if (!rules.length) return [];
  const combined = rules.map(r => '(' + r.match + ')').join('|');
  const query = [
    '[out:json][timeout:180];',
    'area["ISO3166-1"="IE"][admin_level=2]->.ie;',
    'area["ISO3166-2"="GB-NIR"]->.ni;',
    '(.ie;.ni;)->.a;',
    '(',
    '  nwr["name"~"' + esc(combined) + '",i][!highway][!route](area.a);',
    '  nwr["brand"~"' + esc(combined) + '",i][!highway][!route](area.a);',
    ');',
    'out center tags qt;'
  ].join('\n');
  let elements;
  if (process.env.QUICK === '1' && fs.existsSync(SAVED) && Date.now() - fs.statSync(SAVED).mtimeMs < 48 * 36e5) {
    elements = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
    log('Chain stores: quick update, reusing the saved list.');
  } else try {
    elements = (await overpass(query)).elements || [];
    fs.writeFileSync(SAVED, JSON.stringify(elements));
  } catch (e) {
    log('Chain stores: map server unavailable (' + e.message + '); using the saved list.');
    elements = fs.existsSync(SAVED) ? JSON.parse(fs.readFileSync(SAVED, 'utf8')) : [];
  }
  const out = [], seen = new Set();
  for (const r of rules) {
    const re = new RegExp(r.match, 'i'), area = r.where && r.where !== 'all' ? AREAS[r.where] : null;
    let n = 0;
    for (const el of elements) {
      const t = el.tags || {};
      if (!(re.test(t.name || '') || re.test(t.brand || ''))) continue;
      if (!(t.shop || t.amenity || t.tourism || t.craft)) continue;       // a store, not a car park or bus stop with the name
      if (t.disused || t['disused:shop'] || t.shop === 'vacant') continue;
      const p = P.compact(el);
      if (!p || seen.has(p.id)) continue;
      if (area && !inArea(p, area)) continue;
      if (r.where === 'dundrum' && !/dundrum/i.test(p.n)) p.n = p.n + ', Dundrum Town Centre';
      p.u = 0;
      if (r.category && P.CAT_BY_ID[r.category]) p.c = r.category;
      p.d = P.POLICIES[r.policy] ? r.policy : 'friendly';
      p.w = Object.assign({ s: r.source ? [r.source] : [], n: r.note || '', v: r.verified || 'team', chain: r.brand }, area ? {} : { all: 1 });
      if (r.checked) p.w.c = r.checked;
      seen.add(p.id); out.push(p); n++;
    }
    log(`Chain ${r.brand} (${r.where || 'all'}): ${n} ${n === 1 ? 'branch' : 'branches'}`);
  }
  return out;
}

module.exports = { chainStores, AREAS };
