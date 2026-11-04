#!/usr/bin/env node
/* Finds a phone number and email address for each place that isn't confirmed yet, so the business can be asked
   to confirm its dog policy. It reads only the business's own website (home page plus one contact page),
   looking for phone and email links and addresses. Results go to data/contacts.json, which the contact tracker uses.
   Run: node scripts/find-contacts.js   (Node 18 or newer) */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'contacts.json');
const UA = 'DogFriendlyIreland/1.0 (contact finder; https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const REFRESH_DAYS = 60;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return null;
    return { url: r.url, html: (await r.text()).slice(0, 800000) };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

const BAD_MAIL = /(example|domain|sentry|wixpress|godaddy|yourname|^your@|^you@|^name@|^user@|^test@|email@|@email\.com|@2x|\.(png|jpe?g|gif|svg|webp)$)/i;
function emails(html) {
  const out = new Set();
  (html.match(/mailto:([^"'?>\s]+)/gi) || []).forEach(m => out.add(decodeURIComponent(m.slice(7)).toLowerCase()));
  (html.replace(/<[^>]+>/g, ' ').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach(m => out.add(m.toLowerCase()));
  return [...out].filter(e => !BAD_MAIL.test(e) && e.length < 80);
}
function phones(html) {
  const out = [];
  (html.match(/href=["']tel:([^"']+)/gi) || []).forEach(m => out.push(decodeURIComponent(m.replace(/^href=["']tel:/i, ''))));
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  (text.match(/(?:\+353|\+44|\(0\d{1,4}\)|\b0\d{1,4})[\s\d().-]{6,14}\d/g) || []).forEach(m => out.push(m));
  const seen = new Set();
  return out.map(p => p.replace(/[^\d+]/g, '').replace(/^(\+353|\+44)0/, '$1')).filter(p => validPhone(p) && !seen.has(p) && seen.add(p));
}
// Irish numbers: 01 + 7 digits, other areas 9-10 digits, mobiles 10; UK (Northern Ireland) numbers 11 digits.
function validPhone(p) {
  if (/^\+353/.test(p)) return /^\+353[1-9]\d{7,8}$/.test(p);
  if (/^\+44/.test(p)) return /^\+44[1-9]\d{9}$/.test(p);
  if (/^0(28|7)/.test(p)) return /^0\d{10}$/.test(p);
  if (/^01/.test(p)) return /^01\d{7}$/.test(p);
  return /^0[2-9]\d{7,8}$/.test(p);
}
// Prefer an address at the business's own domain
function bestEmail(list, site) {
  let h = ''; try { h = new URL(site).hostname.replace(/^www\./, ''); } catch (e) {}
  const own = list.filter(e => h && e.split('@')[1] && (h.endsWith(e.split('@')[1]) || e.split('@')[1].endsWith(h)));
  return (own[0] || list[0]);
}
function contactLink(html, base) {
  const m = html.match(/<a[^>]+href=["']([^"'#]+)["'][^>]*>[^<]{0,40}(contact|get in touch|find us|visit us)/i) ||
    html.match(/href=["']([^"'#]*contact[^"'#]*)["']/i);
  if (!m) return null;
  try { const u = new URL(m[1], base); return u.hostname === new URL(base).hostname ? u.href : null; } catch (e) { return null; }
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, 'ireland.json'), 'utf8'));
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const now = Date.now();
  const todo = data.places.filter(p => p.w && p.w.v === 'unconfirmed');
  let checked = 0, found = 0;
  const out = {};
  for (const p of todo) {
    const t = p.t;
    const site = t.website || t['contact:website'] || t.url;
    const has = { phone: t.phone || t['contact:phone'] || t.mobile, email: t.email || t['contact:email'] };
    const prev = old[p.id];
    if (prev && prev.v === 2 && now - Date.parse(prev.checked) < REFRESH_DAYS * 864e5) { out[p.id] = prev; continue; }
    if (!site || /facebook\.com|instagram\.com|business\.site|tripadvisor|caffenero\.com\/uk\/stores/i.test(site) || (has.phone && has.email)) continue;
    const home = await page(/^https?:/i.test(site) ? site : 'https://' + site);
    checked++;
    let ph = [], em = [], from = '';
    if (home) {
      ph = phones(home.html); em = emails(home.html); from = home.url;
      if (!ph.length || !em.length) {
        const c = contactLink(home.html, home.url);
        if (c) { await sleep(500); const cp = await page(c); if (cp) { if (!ph.length) ph = phones(cp.html); if (!em.length) em = emails(cp.html); if (ph.length || em.length) from = cp.url; } }
      }
    }
    const rec = { v: 2, checked: new Date().toISOString().slice(0, 10) };
    if (ph.length && !has.phone) rec.phone = ph[0];
    if (em.length && !has.email) rec.email = bestEmail(em, from);
    if (rec.phone || rec.email) { rec.from = from; found++; }
    out[p.id] = rec;
    await sleep(700);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0));
  console.log(`Checked ${checked} websites, found contact details for ${found}. ${Object.keys(out).length} places in data/contacts.json.`);
})().catch(e => { console.error(e); process.exit(1); });
