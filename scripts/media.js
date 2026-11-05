/* Photos, logos, descriptions and contact details from sources that are free to reuse:
   - Wikimedia Commons: freely licensed photos and videos taken at or near a place, kept only when the file's title names the place.
   - Fáilte Ireland open data (CC BY 4.0): the tourism board's register of attractions, food and drink, with photo, phone and website.
   - Wikidata and Wikipedia (CC0 / CC BY-SA): image, logo and a short description, for places OpenStreetMap links to Wikidata.
   Writes data/media.json, which the app loads when a place is opened, and adds missing phone numbers and websites to places.
   Commons lookups are cached in data/media-cache.json and refreshed every 90 days, a limited number per run. */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./web-places.js');

const DATA = path.join(__dirname, '..', 'data');
const CACHE = path.join(DATA, 'media-cache.json');
const OUT = path.join(DATA, 'media.json');
const UA = 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const FAILTE = 'https://failteireland.azure-api.net/opendata-api/v2/attractions/csv';
const MAX_LOOKUPS = 900;          // Commons lookups per run (about 5 minutes)
const REFRESH_DAYS = 90;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error && /busy|maxlag|ratelimit/i.test(j.error.code || '')) { await sleep(3000 * (i + 1)); continue; }
      return j;
    } catch (e) { if (i === 3) throw e; await sleep(2000); }
  }
  throw new Error('Too busy: ' + url);
}

// ---------- names ----------
const norm = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
// Words that say what kind of place it is rather than which one
const GENERIC = new Set(('the and of a an at on in by dog dogs park parks cafe caffe coffee bar pub restaurant hotel house inn shop store ' +
  'ltd limited co company kitchen bistro centre center lounge tavern bakery deli b b bnb guesthouse guest accommodation ' +
  'cottage cottages lodge lodges apartments self catering holiday homes small large enclosure area run off lead leash').split(' '));
// Single words too common to identify a place on their own
const VAGUE = new Set(('bridge river beach lake castle church harbour harbor pier station square street road market garden gardens ' +
  'wood woods forest hill view mill quay strand bay point head island court hall abbey tower green field fields yard corner lane').split(' '));
function keyTokens(name) {
  const name2 = name.replace(/\(.*?\)/g, ' ').split(/,| in /)[0];   // "Dog park, Ballincollig" -> "Dog park"; "X in Y" -> "X"
  const tk = s => norm(s).split(' ').filter(w => w && !GENERIC.has(w));
  const first = tk(name2);
  return first.length ? first : tk(name.replace(/\(.*?\)/g, ' '));  // "Small Dog Area in Marlay Park" -> "marlay"
}
// Businesses: every word of the name must be in the photo's title, so "The Bath Pub" doesn't match "Bath Avenue".
// Parks, beaches and attractions: the distinctive words are enough ("Marlay Park Dog Park" matches "Marlay Park, Rathfarnham").
const LOOSE = /^(dogpark|outdoors|attraction|rescue)$/;
const ARTICLES = new Set(['the', 'and', 'of', 'a', 'an', 'at', 'co', 'ltd', 'limited']);
function strictTokens(name) {
  return norm(name.replace(/\(.*?\)/g, ' ')).split(' ').filter(w => w && !ARTICLES.has(w));
}
// Close-ups of street furniture, interiors, transport and old pictures say little about a place
const JUNK = /\b(drain|manhole|cover|sewer|vent|letter ?box|post ?box|bust|statue|plaque|scraper|door|doorway|sign|antenna|aerial|turbine|lobby|hallway|corridor|staircase|bank|fire station|railway|train|station|bus|bollard|bin|lamp|hydrant|graffiti|banners?|cart|toilet|car park|map|bridge over|property advisors)\b/i;
const OLD = /\b(1[0-8]\d\d|19[0-4]\d)s?\b/;
// Words that only name the town or county (a "Dog park, Carlow" photo of Carlow isn't a photo of the dog park)
function placeWords(p) {
  const t = p.t || {};
  return new Set(norm([t['addr:town'], t['addr:city'], t['addr:village'], t['addr:suburb'], t['addr:county']].filter(Boolean).join(' ')
    .replace(/\b(co|county|city|district|dublin \d+)\b/gi, ' ')).split(' ').filter(Boolean));
}
function photoFits(p, title) {
  if (JUNK.test(title) || OLD.test(title)) return false;
  if (p.c === 'dogpark' && /\bdog ?park\b/i.test(title)) return true;
  if (LOOSE.test(p.c)) {
    const town = placeWords(p);
    const tk = keyTokens(p.n).filter(w => !town.has(w));
    if (!tk.length) return false;
    return titleMatches(keyTokens(p.n), title) && tk.some(w => norm(title).split(' ').includes(w));
  }
  const t = strictTokens(p.n);
  if (!t.length || t.join('').length < 4) return false;
  // "The Fumbally" is not "Fumbally Lane": skip photos of a street that shares the business's name
  const street = new RegExp('\\b' + t[t.length - 1] + ' (lane|street|st|road|rd|avenue|ave|place|terrace|square|row|quay)\\b');
  const ownStreet = /\b(lane|street|road|avenue|place|terrace|square|row|quay|hill)\b/.test(norm(p.n));
  if (!ownStreet && street.test(norm(title))) return false;
  if (titleMatches(t, title, true)) return true;
  // Pubs are often photographed as "The Sunflower" rather than "Sunflower Bar"
  const short = /^(bar|pub|tavern|lounge)$/.test(t[t.length - 1]) ? t.slice(0, -1) : null;
  return !!short && (short.length >= 2 || (short.length === 1 && short[0].length >= 6)) && titleMatches(short, title, true);
}
const fileTitle = f => { try { return decodeURIComponent((f || '').split('File:')[1] || '').replace(/_/g, ' ').replace(/\.[a-z0-9]+$/i, '').replace(/geograph[\w .-]*\d+/i, ''); } catch (e) { return ''; } };
function titleMatches(tokens, title, strict) {
  if (!tokens.length) return false;
  if (!strict && tokens.length === 1 && (VAGUE.has(tokens[0]) || tokens[0].length < 4)) return false;
  if (strict && tokens.length === 1 && VAGUE.has(tokens[0])) return false;
  const t = new Set(norm(title).split(' '));
  return tokens.every(w => t.has(w));
}

// ---------- Wikimedia Commons ----------
const stripHtml = s => (s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
function radiusFor(p) {
  if (/^(dogpark|outdoors|attraction)$/.test(p.c)) return /^[wr]/.test(p.id) ? 400 : 250;
  return 80;
}
async function commonsNear(p, tokens) {
  const u = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&action=query&generator=geosearch' +
    '&ggscoord=' + p.la + '|' + p.lo + '&ggsradius=' + radiusFor(p) + '&ggsnamespace=6&ggslimit=100' +
    '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=800&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl';
  const j = await getJson(u);
  const pages = (j.query && j.query.pages) || [];
  return pages
    .filter(pg => titleMatches(tokens, pg.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/geograph[\w .-]*\d+/i, '')))
    .map(pg => {
      const ii = (pg.imageinfo || [])[0] || {}, m = ii.extmetadata || {};
      const lic = m.LicenseShortName && m.LicenseShortName.value;
      if (!ii.thumburl || !lic || !/^(image\/(jpeg|png|webp)|video\/)/.test(ii.mime || '')) return null;
      return Object.assign({
        u: ii.thumburl.split('?')[0], f: ii.descriptionurl, s: 'Wikimedia Commons',
        a: stripHtml(m.Artist && m.Artist.value).slice(0, 80), l: lic
      }, /^video\//.test(ii.mime) ? { v: 1 } : {});
    })
    .filter(Boolean)
    .slice(0, 6);
}

// ---------- Wikidata / Wikipedia ----------
async function wikidata(qid) {
  const j = await getJson('https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=claims|sitelinks&ids=' + qid);
  const e = j.entities && j.entities[qid]; if (!e) return {};
  const file = prop => { const c = e.claims && e.claims[prop]; return c && c[0].mainsnak.datavalue && c[0].mainsnak.datavalue.value; };
  const fp = f => 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f);
  const out = {};
  if (file('P154')) out.lg = { u: fp(file('P154')) + '?width=200', f: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file('P154')) };
  if (file('P18')) out.img = { u: fp(file('P18')) + '?width=800', f: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file('P18')), s: 'Wikimedia Commons', a: '', l: 'see file page' };
  const wp = e.sitelinks && e.sitelinks.enwiki && e.sitelinks.enwiki.title;
  if (wp) {
    try {
      const s = await getJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(wp.replace(/ /g, '_')));
      if (s.extract) out.ds = { x: s.extract.slice(0, 600), s: 'Wikipedia', h: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(wp.replace(/ /g, '_')) };
    } catch (e2) { /* no description */ }
  }
  return out;
}

// ---------- Fáilte Ireland ----------
function km(a, b) {
  const r = Math.PI / 180, x = (b.lo - a.lo) * r * Math.cos((a.la + b.la) / 2 * r), y = (b.la - a.la) * r;
  return Math.hypot(x, y) * 6371;
}
function phone(n) {
  const d = (n || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (/^00353/.test(d)) return '+353 ' + d.slice(5).replace(/^0/, '');
  if (/^0044/.test(d)) return '+44 ' + d.slice(4).replace(/^0/, '');
  return d;
}
async function failte(log) {
  try {
    const r = await fetch(FAILTE, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = parseCsv((await r.text()).replace(/^﻿/, ''));
    log('Fáilte Ireland open data:', rows.length, 'listings');
    return rows.map(x => ({ n: x.Name, tk: keyTokens(x.Name), la: +x.Latitude, lo: +x.Longitude, url: x.Url, tel: phone(x.Telephone), photo: x.Photo, county: norm(x.County) }))
      .filter(x => x.n && x.la && x.lo);
  } catch (e) { log('Fáilte Ireland open data unavailable:', e.message); return null; }
}
const sameName = (a, b) => a.length && b.length && a.join(' ') === b.join(' ');
const subsetName = (a, b) => a.length && b.length && (a.every(w => b.includes(w)) || b.every(w => a.includes(w))) && Math.min(a.length, b.length) >= 1 && a.concat(b).some(w => w.length >= 4);
function matchFailte(p, list) {
  const tk = keyTokens(p.n); if (!tk.length) return null;
  if (p.w && p.w.a) {      // only known to be in a town: need the same name in the same county
    const county = norm((p.t['addr:county'] || '').replace(/^(co\.?|county)\s+/i, ''));
    return list.find(f => f.county === county && sameName(tk, f.tk)) || null;
  }
  let best = null, bd = 1e9;
  for (const f of list) {
    if (Math.abs(f.la - p.la) > 0.005 || Math.abs(f.lo - p.lo) > 0.008) continue;
    const d = km(p, f);
    if (d < 0.3 && (sameName(tk, f.tk) || (d < 0.15 && subsetName(tk, f.tk))) && d < bd) { best = f; bd = d; }
  }
  return best;
}

// ---------- main ----------
async function addMedia(places, log = console.log) {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  // Photos marked wrong on photos.html: one per line, "placeId photoPageUrl" (or just the photo page URL to drop it everywhere)
  const BLOCK = path.join(DATA, 'photo-blocklist.txt');
  const blocked = new Set(fs.existsSync(BLOCK) ? fs.readFileSync(BLOCK, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) : []);
  const now = Date.now(), media = {};
  let looked = 0, withPhotos = 0, fiMatched = 0, fiPhones = 0, fiSites = 0, moved = 0;

  const fi = await failte(log);
  const SF = path.join(DATA, 'website-facts.json');
  const siteFacts = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : {};
  let ownPhotos = 0;
  for (const p of places) {
    if (p.u) continue;
    const m = {};
    // Fáilte Ireland
    const f = fi && matchFailte(p, fi);
    if (f) {
      fiMatched++;
      if (f.photo && /^https:\/\//.test(f.photo)) m.ph = [{ u: f.photo.replace(/\?.*$/, '') + '?w=800&q=70&fit=scale', f: 'https://data.gov.ie/dataset/tourism-activities-and-attractions', s: 'Fáilte Ireland', a: '', l: 'CC BY 4.0' }];
      const t = p.t;
      if (f.tel && !(t.phone || t['contact:phone'] || t.mobile)) { t['contact:phone'] = f.tel; fiPhones++; }
      if (f.url && /^https?:\/\//.test(f.url) && !(t.website || t['contact:website'] || t.url)) { t['contact:website'] = f.url; fiSites++; }
      if (p.w && p.w.a) { p.la = f.la; p.lo = f.lo; p.w.a = 0; moved++; }
    }
    // The business's own share image (og:image) from its website, credited to the business and linked to its site
    const wfi = siteFacts[p.id];
    if (wfi && wfi.image) {
      let host = ''; try { host = new URL(wfi.site).hostname.replace(/^www\./, ''); } catch (e) {}
      m.ph = [{ u: wfi.image, f: wfi.site, s: 'their website', a: p.n, l: '', o: 1 }].concat(m.ph || []);
      ownPhotos++;
    }
    // Wikimedia Commons (not for places only known to be somewhere in a town)
    if (!(p.w && p.w.a)) {
      const key = p.id + '|' + p.n;
      let c = cache[key];
      if ((!c || now - c.t > REFRESH_DAYS * 864e5) && looked < MAX_LOOKUPS) {
        const tokens = keyTokens(p.n);
        try {
          c = { t: now, ph: tokens.length ? await commonsNear(p, tokens) : [] };
          if (p.t.wikidata && /^Q\d+$/.test(p.t.wikidata)) Object.assign(c, await wikidata(p.t.wikidata));
          cache[key] = c; looked++;
          if (looked % 100 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); log('  photo lookups:', looked); }
        } catch (e) { log('  photo lookup failed:', p.n, e.message); }
        await sleep(150);
      }
      if (c) {
        const extra = [].concat(c.img ? [c.img] : [], (c.ph || []).filter(x => photoFits(p, fileTitle(x.f))))
          .filter(x => !(m.ph || []).some(y => y.u === x.u));
        if (extra.length) m.ph = (m.ph || []).concat(extra).slice(0, 7);
        if (c.lg) m.lg = c.lg;
        if (c.ds) m.ds = c.ds;
      }
    }
    if (p.t.wikimedia_commons && /^File:/i.test(p.t.wikimedia_commons)) {
      const file = p.t.wikimedia_commons.replace(/^File:/i, '');
      const own = { u: 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=800', f: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file), s: 'Wikimedia Commons', a: '', l: 'see file page' };
      m.ph = [own].concat((m.ph || []).filter(x => x.f !== own.f)).slice(0, 7);
    }
    if (m.ph) { m.ph = m.ph.filter(x => !blocked.has(p.id + ' ' + x.f) && !blocked.has(x.f)); if (!m.ph.length) delete m.ph; }
    if (m.ph || m.lg || m.ds) { media[p.id] = m; if (m.ph) withPhotos++; }
  }
  // Drop cache entries for places that no longer exist
  const ids = new Set(places.map(p => p.id + '|' + p.n));
  Object.keys(cache).forEach(k => { if (!ids.has(k)) delete cache[k]; });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync(OUT, JSON.stringify(media));
  const pending = places.filter(p => !p.u && !(p.w && p.w.a) && !cache[p.id + '|' + p.n]).length;
  log(`Media: ${withPhotos} places with photos, ${Object.keys(media).length} with any media; ${looked} new photo lookups, ${pending} still to check.`);
  log(`Business websites' own share images: ${ownPhotos}.`);
  log(`Fáilte Ireland matched ${fiMatched} places: added ${fiPhones} phone numbers, ${fiSites} websites, pinned ${moved} town-centre places exactly.`);
  return media;
}

module.exports = { addMedia, keyTokens, titleMatches, matchFailte, photoFits, fileTitle };
