#!/usr/bin/env node
/* Reads each listed business's own website (home page, plus its contact page if needed) for facts:
   phone, email, opening hours, menu link, Facebook and Instagram pages, cuisine, and what it says about dogs.
   Facts only: no photos, logos or wording are copied (those stay the business's own unless they give permission).
   Most of this comes from the structured data (schema.org) that websites publish for search engines.
   Run: node scripts/website-facts.js   -> data/website-facts.json (used by the nightly build). */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'website-facts.json');
const UA = 'DogFriendlyIreland/1.0 (reads public business details; https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const REFRESH_DAYS = 30;
const SKIP = /facebook\.com|instagram\.com|business\.site|tripadvisor|booking\.com|google\.|caffenero\.com\/uk\/stores|linktr\.ee/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return null;
    return { url: r.url, html: (await r.text()).slice(0, 1500000) };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// ---------- structured data ----------
const BIZ = /LocalBusiness|Restaurant|BarOrPub|CafeOrCoffeeShop|FoodEstablishment|Hotel|LodgingBusiness|BedAndBreakfast|Hostel|Campground|Store|PetStore|VeterinaryCare|TouristAttraction|Park|Brewery|Winery|Bakery|IceCreamShop|Organization/;
function jsonLd(html) {
  const out = [];
  (html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).forEach(block => {
    try {
      const j = JSON.parse(block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim());
      const walk = x => {
        if (Array.isArray(x)) return x.forEach(walk);
        if (!x || typeof x !== 'object') return;
        if (x['@graph']) walk(x['@graph']);
        const ty = [].concat(x['@type'] || []).join(' ');
        if (BIZ.test(ty)) out.push(x);
      };
      walk(j);
    } catch (e) { /* invalid JSON-LD is common; skip it */ }
  });
  // Prefer the most specific business type over a generic Organization
  return out.sort((a, b) => /Organization/.test([].concat(a['@type']).join()) - /Organization/.test([].concat(b['@type']).join()));
}
const DAY = { monday: 'Mo', tuesday: 'Tu', wednesday: 'We', thursday: 'Th', friday: 'Fr', saturday: 'Sa', sunday: 'Su' };
const ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const hhmm = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : null; };
function hoursFromSpec(spec) {
  const per = {};
  [].concat(spec || []).forEach(s => {
    if (!s || s.validFrom || s.validThrough) return;   // skip seasonal or one-off exceptions
    const o = hhmm(s.opens), c = hhmm(s.closes); if (!o || !c) return;
    [].concat(s.dayOfWeek || []).forEach(d => {
      const k = DAY[String(d).replace(/^.*\//, '').toLowerCase()];
      if (k) (per[k] = per[k] || []).push(o + '-' + (c === '00:00' ? '24:00' : c));
    });
  });
  const days = ORDER.filter(d => per[d]);
  if (!days.length) return null;
  const parts = []; let i = 0;
  while (i < ORDER.length) {
    const d = ORDER[i]; if (!per[d]) { i++; continue; }
    const v = per[d].join(','); let j = i;
    while (j + 1 < ORDER.length && per[ORDER[j + 1]] && per[ORDER[j + 1]].join(',') === v) j++;
    parts.push((j > i ? d + '-' + ORDER[j] : d) + ' ' + v); i = j + 1;
  }
  return parts.join('; ');
}
function hoursFromText(h) {
  // schema.org openingHours strings already use the OpenStreetMap style: "Mo-Fr 09:00-17:00"
  const list = [].concat(h || []).map(String).filter(x => /^(Mo|Tu|We|Th|Fr|Sa|Su)[A-Za-z,\- ]*\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(x.trim()));
  return list.length ? list.join('; ') : null;
}

// ---------- page text ----------
const BAD_MAIL = /(example|domain|sentry|wixpress|godaddy|yourname|^your@|^you@|^name@|^user@|^test@|email@|@email\.com|@2x|\.(png|jpe?g|gif|svg|webp)$)/i;
function emails(html) {
  const out = new Set();
  (html.match(/mailto:([^"'?>\s]+)/gi) || []).forEach(m => { try { out.add(decodeURIComponent(m.slice(7)).toLowerCase()); } catch (e) {} });
  (html.replace(/<[^>]+>/g, ' ').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach(m => out.add(m.toLowerCase()));
  return [...out].filter(e => !BAD_MAIL.test(e) && e.length < 80);
}
function validPhone(p) {
  if (/^\+353/.test(p)) return /^\+353[1-9]\d{6,8}$/.test(p);
  if (/^\+44/.test(p)) return /^\+44[1-9]\d{9}$/.test(p);
  if (/^0(28|7)/.test(p)) return /^0\d{10}$/.test(p);
  if (/^01/.test(p)) return /^01\d{7}$/.test(p);
  return /^0[2-9]\d{6,8}$/.test(p);
}
function phones(html) {
  const out = [];
  (html.match(/href=["']tel:([^"']+)/gi) || []).forEach(m => { try { out.push(decodeURIComponent(m.replace(/^href=["']tel:/i, ''))); } catch (e) {} });
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  (text.match(/(?:\+353|\+44|\(0\d{1,4}\)|\b0\d{1,4})[\s\d().-]{6,14}\d/g) || []).forEach(m => out.push(m));
  const seen = new Set();
  return out.map(p => p.replace(/[^\d+]/g, '').replace(/^(\+353|\+44)0/, '$1')).filter(p => validPhone(p) && !seen.has(p) && seen.add(p));
}
function bestEmail(list, site) {
  let h = ''; try { h = new URL(site).hostname.replace(/^www\./, ''); } catch (e) {}
  const own = list.filter(e => h && e.split('@')[1] && (h.endsWith(e.split('@')[1]) || e.split('@')[1].endsWith(h)));
  return own[0] || list[0];
}
function links(html, base) {
  const out = { menu: null, facebook: null, instagram: null, contact: null };
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    let href; try { href = new URL(m[1], base).href; } catch (e) { continue; }
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!out.facebook && /^https?:\/\/(www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|groups\/?$)[^?]+/i.test(href)) out.facebook = href.split('?')[0];
    if (!out.instagram && /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|explore|share)[^?/]+/i.test(href)) out.instagram = href.split('?')[0];
    if (!out.menu && (/\bmenus?\b/.test(text) && text.length < 40) && !/^mailto|^tel/i.test(href)) out.menu = href;
    if (!out.contact && /contact|get in touch|find us|visit us/.test(text) && new URL(href).hostname === new URL(base).hostname) out.contact = href;
  }
  return out;
}
// What the business itself says about dogs (kept as a short quote for checking, not shown in the app)
const DOG_YES = /(dog|pet)[- ]?friendly|dogs? (are |is )?(very )?welcome|welcome (your |well[- ]behaved )?(dogs|pets|four[- ]legged)|dogs? (are |is )?allowed|bring (your|the) dog|four[- ]legged (friends|guests)|pooch|pups? welcome/i;
const DOG_NO = /no dogs|dogs? (are |is )?not (permitted|allowed)|(except|apart from|only) (registered )?(guide|assistance) dogs|no pets|pets (are )?not (permitted|allowed)/i;
function dogLines(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, ' ');
  const found = { yes: [], no: [] };
  text.split(/(?<=[.!?])\s+/).forEach(s => {
    if (s.length > 400) s = s.slice(0, 400);
    if (DOG_NO.test(s)) found.no.push(s.trim());
    else if (DOG_YES.test(s)) found.yes.push(s.trim());
  });
  return { yes: [...new Set(found.yes)].slice(0, 3), no: [...new Set(found.no)].slice(0, 3) };
}

function facts(pages) {
  const f = {};
  for (const pg of pages) {
    const html = pg.html;
    for (const b of jsonLd(html)) {
      if (!f.phone && b.telephone) { const p = phones('href="tel:' + b.telephone + '"')[0]; if (p) f.phone = p; }
      if (!f.email && b.email) { const e = emails('mailto:' + String(b.email).replace(/^mailto:/i, ''))[0]; if (e) f.email = e; }
      if (!f.hours) f.hours = hoursFromSpec(b.openingHoursSpecification) || hoursFromText(b.openingHours);
      if (!f.menu) { const mn = b.hasMenu || b.menu; const u = typeof mn === 'string' ? mn : mn && (mn.url || mn['@id']); if (u && /^https?:/.test(u)) f.menu = u; }
      if (!f.cuisine && b.servesCuisine) f.cuisine = [].concat(b.servesCuisine).join(';').slice(0, 80);
      if (f.petsAllowed === undefined && b.petsAllowed !== undefined) f.petsAllowed = b.petsAllowed;
      [].concat(b.sameAs || []).forEach(u => {
        if (!f.facebook && /facebook\.com\//i.test(u)) f.facebook = u;
        if (!f.instagram && /instagram\.com\//i.test(u)) f.instagram = u;
      });
      if (!f.address && b.address && typeof b.address === 'object') {
        const a = b.address; f.address = [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).join(', ').slice(0, 160);
      }
    }
    const l = links(html, pg.url);
    if (!f.menu && l.menu) f.menu = l.menu;
    if (!f.facebook && l.facebook) f.facebook = l.facebook;
    if (!f.instagram && l.instagram) f.instagram = l.instagram;
    if (!f.phone) { const p = phones(html)[0]; if (p) f.phone = p; }
    if (!f.email) { const e = emails(html); if (e.length) f.email = bestEmail(e, pg.url); }
    const d = dogLines(html);
    if (d.yes.length || d.no.length) { f.dogs = f.dogs || { yes: [], no: [], url: pg.url }; f.dogs.yes.push(...d.yes); f.dogs.no.push(...d.no); }
  }
  return f;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'ireland.json'), 'utf8'));
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const now = Date.now(), out = {};
  let checked = 0, reached = 0;
  for (const p of data.places) {
    const site = p.t.website || p.t['contact:website'] || p.t.url;
    if (!site || SKIP.test(site)) continue;
    const prev = old[p.id];
    if (prev && now - Date.parse(prev.checked) < REFRESH_DAYS * 864e5) { out[p.id] = prev; continue; }
    const home = await page(/^https?:/i.test(site) ? site : 'https://' + site);
    checked++;
    const rec = { checked: new Date().toISOString().slice(0, 10), site: home ? home.url : site };
    if (home) {
      reached++;
      const pages = [home];
      const l = links(home.html, home.url);
      if (l.contact && l.contact !== home.url) { await sleep(500); const c = await page(l.contact); if (c) pages.push(c); }
      Object.assign(rec, facts(pages));
    } else rec.unreachable = 1;
    out[p.id] = rec;
    if (checked % 50 === 0) { fs.writeFileSync(OUT, JSON.stringify(out)); console.log('  checked', checked); }
    await sleep(600);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  const v = Object.values(out), c = k => v.filter(x => x[k]).length;
  console.log(`Websites: ${checked} read now (${reached} reachable), ${v.length} on file. Found phone ${c('phone')}, email ${c('email')}, hours ${c('hours')}, menu ${c('menu')}, Facebook ${c('facebook')}, Instagram ${c('instagram')}, says something about dogs ${c('dogs')}.`);
}

// "+35312345678" -> "+353 1 234 5678"; "02890123456" -> "+44 28 9012 3456"
function formatPhone(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (/^028\d{8}$/.test(d)) d = '+44' + d.slice(1);
  if (/^\+4428\d{8}$/.test(d)) return '+44 28 ' + d.slice(5, 9) + ' ' + d.slice(9);
  if (/^\+44\d{10}$/.test(d)) return '+44 ' + d.slice(3, 7) + ' ' + d.slice(7);
  if (/^0[1-9]/.test(d) && !/^07/.test(d)) d = '+353' + d.slice(1);
  if (/^\+3531\d{7}$/.test(d)) return '+353 1 ' + d.slice(5, 8) + ' ' + d.slice(8);
  if (/^\+353\d{8,9}$/.test(d)) return '+353 ' + d.slice(4, 6) + ' ' + d.slice(6, d.length - 4) + ' ' + d.slice(-4);
  return p;
}

// Adds website facts to places where OpenStreetMap has nothing. Never overwrites what's already there.
function applyWebsiteFacts(places, log = console.log) {
  if (!fs.existsSync(OUT)) return;
  const wf = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  let n = 0;
  for (const p of places) {
    const f = wf[p.id]; if (!f || f.unreachable) continue;
    const t = p.t; let used = false;
    const set = (k, v, has) => { if (v && !has) { t[k] = v; used = true; } };
    set('contact:phone', f.phone && formatPhone(f.phone), t.phone || t['contact:phone'] || t.mobile);
    set('contact:email', f.email, t.email || t['contact:email']);
    set('contact:facebook', f.facebook, t.facebook || t['contact:facebook']);
    set('contact:instagram', f.instagram, t.instagram || t['contact:instagram']);
    set('website:menu', f.menu, t['website:menu']);
    set('cuisine', f.cuisine && !/[<>]/.test(f.cuisine) ? f.cuisine.toLowerCase().replace(/\s*,\s*/g, ';') : null, t.cuisine);
    if (f.hours && !t.opening_hours) { t.opening_hours = f.hours; t['opening_hours:source'] = 'website'; used = true; }
    if (used) n++;
  }
  log('Website facts added to', n, 'places');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { applyWebsiteFacts, formatPhone, hoursFromSpec, hoursFromText, dogLines, facts };
