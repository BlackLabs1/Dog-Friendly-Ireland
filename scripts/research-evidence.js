#!/usr/bin/env node
/* Research helper for checking unconfirmed places.
   For each unconfirmed place it reads:
     1. the article where the place was found, keeping only the passage about that place and the article's date;
     2. the place's own website (home page plus pages such as FAQ, policies, visit, rooms, contact),
        keeping only sentences that mention dogs or pets.
   Nothing is saved in the repository: the result is printed to the job log (gzip + base64 between markers)
   for a person or Claude to read while researching each place.
   Run: node scripts/research-evidence.js [startIndex] [count] */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA = path.join(__dirname, '..', 'data');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DogFriendlyIreland-research';
const SKIP = /facebook\.com|instagram\.com|business\.site|tripadvisor|booking\.com|google\.|linktr\.ee|twitter\.com|x\.com\//i;
const DOG = /\b(dogs?|doggy|doggie|pets?|pup|puppy|puppies|pooch|pooches|canine|four[- ]legged|furry (friend|friends|guests)|hound|pupp?uccino|woof)\b/i;
const LINK = /dog|pet|faq|polic|terms|visit|about|contact|stay|room|accommodation|info|rules|garden|terrace|plan|amenit|facilit|find-us|cottage|camp|pitch/i;

async function get(u, ms = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'en-IE,en;q=0.9' }, redirect: 'follow', signal: ctl.signal });
    const ty = r.headers.get('content-type') || '';
    if (!r.ok) return { url: r.url, status: r.status };
    if (!/html|xml|text/i.test(ty)) return { url: r.url, status: 'type ' + ty };
    return { url: r.url, status: r.status, html: (await r.text()).slice(0, 3000000) };
  } catch (e) { return { url: u, status: 'error ' + (e.name || e.message) }; } finally { clearTimeout(t); }
}

const ENT = { amp: '&', nbsp: ' ', quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', eacute: 'é', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] || m));
function blocks(html) {
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return body.split(/<(?=\/?(?:h[1-6]|p|li|div|section|article|br|tr|blockquote|figcaption|dt|dd)\b)/i).map(part => {
    const head = /^h[1-6]\b/i.test(part);
    const text = decode(part.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return { head, text };
  }).filter(b => b.text);
}
function published(html) {
  const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/) || html.match(/article:published_time"\s+content="([^"]+)"/) ||
    html.match(/content="([^"]+)"\s+property="article:published_time"/) || html.match(/<time[^>]+datetime="([^"]+)"/);
  const u = html.match(/"dateModified"\s*:\s*"([^"]+)"/);
  return { published: m ? m[1].slice(0, 10) : '', modified: u ? u[1].slice(0, 10) : '' };
}
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['the', 'and', 'of', 'at', 'bar', 'cafe', 'pub', 'hotel', 'house', 'restaurant', 'co', 'by', 'in', 'on', 'a', 'kitchen', 'coffee', 'shop', 'store']);
function keys(name) {
  const n = norm(name), k = new Set([n, n.replace(/^the /, '')]);
  const w = n.split(' ').filter(x => !STOP.has(x) && x.length > 2);
  if (w.length >= 2) k.add(w.slice(0, 2).join(' '));
  if (w.length === 1 && w[0].length > 5) k.add(w[0]);
  return [...k].filter(x => x.length > 3);
}
function passages(bl, name) {
  const ks = keys(name), out = [];
  for (let i = 0; i < bl.length && out.length < 3; i++) {
    const t = norm(bl[i].text);
    if (!ks.some(k => (' ' + t + ' ').includes(' ' + k + ' '))) continue;
    let s = bl[i].text, j = i + 1;
    while (j < bl.length && !bl[j].head && s.length < 1400) { s += ' ¶ ' + bl[j].text; j++; }
    if (!out.some(o => o.includes(s.slice(0, 80)))) out.push(s.slice(0, 1600));
    i = j - 1;
  }
  return out;
}
function dogSentences(bl, url) {
  const out = [];
  for (const b of bl) {
    if (!DOG.test(b.text)) continue;
    b.text.split(/(?<=[.!?])\s+/).forEach(s => { if (DOG.test(s) && s.length < 500) out.push(s.trim()); });
  }
  return [...new Set(out)].slice(0, 15).map(s => ({ url, s }));
}
function links(html, base) {
  const out = new Set(); let host;
  try { host = new URL(base).host; } catch (e) { return []; }
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(decode(m[1]), base); } catch (e) { continue; }
    if (u.host !== host || /\.(pdf|jpe?g|png|gif|webp|mp4|zip)$/i.test(u.pathname)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ');
    if (LINK.test(u.pathname) || LINK.test(label)) out.add(u.origin + u.pathname);
  }
  return [...out].sort((a, b) => (/dog|pet/i.test(b) - /dog|pet/i.test(a)) || (/faq|polic|terms/i.test(b) - /faq|polic|terms/i.test(a))).slice(0, 9);
}

async function pool(items, n, fn) {
  let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: n }, run));
}

async function main() {
  const start = +(process.argv[2] || 0), count = +(process.argv[3] || 10000);
  const places = JSON.parse(fs.readFileSync(path.join(DATA, 'ireland.json'), 'utf8')).places
    .filter(p => p.w && p.w.v === 'unconfirmed').slice(start, start + count);
  const facts = fs.existsSync(path.join(DATA, 'website-facts.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'website-facts.json'), 'utf8')) : {};
  const result = {};
  // 1. articles
  const bySource = {};
  places.forEach(p => (p.w.s || []).forEach(s => (bySource[s] = bySource[s] || []).push(p)));
  const articles = {};
  await pool(Object.keys(bySource), 4, async src => {
    const r = await get(src, 30000);
    const a = { status: r.status, url: r.url };
    if (r.html) {
      Object.assign(a, published(r.html));
      const bl = blocks(r.html);
      a.title = (r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim().slice(0, 200);
      a.chars = bl.reduce((n, b) => n + b.text.length, 0);
      bySource[src].forEach(p => {
        const x = result[p.id] = result[p.id] || { n: p.n, src: [] };
        x.src.push({ url: src, passages: passages(bl, p.n) });
      });
    }
    articles[src] = a;
    console.log('article', a.status, a.published || '-', (a.chars || 0) + ' chars', src);
  });
  // 2. websites
  await pool(places, 6, async p => {
    const t = p.t || {}, x = result[p.id] = result[p.id] || { n: p.n, src: [] };
    x.osm = Object.fromEntries(Object.entries(t).filter(([k]) => /^(dog|website|contact:website|url|outdoor_seating|indoor_seating|beer_garden|check_date|disused|opening_hours|phone|contact:phone|email|contact:email|contact:facebook|facebook)/.test(k)));
    const site = t.website || t['contact:website'] || t.url || (facts[p.id] && facts[p.id].site);
    if (!site || SKIP.test(site)) return;
    x.site = { url: site, pages: [], dogs: [] };
    const home = await get(site);
    x.site.status = home.status;
    if (!home.html) return;
    x.site.final = home.url;
    x.site.dogs.push(...dogSentences(blocks(home.html), home.url));
    for (const l of links(home.html, home.url)) {
      const pg = await get(l, 15000);
      x.site.pages.push(l.replace(/^https?:\/\/[^/]+/, '') + ' ' + pg.status);
      if (pg.html) x.site.dogs.push(...dogSentences(blocks(pg.html), pg.url));
    }
    const seen = new Set(); x.site.dogs = x.site.dogs.filter(d => !seen.has(d.s) && seen.add(d.s)).slice(0, 25);
  });
  const blob = zlib.gzipSync(JSON.stringify({ articles, places: result })).toString('base64');
  console.log('EVIDENCE-START');
  for (let i = 0; i < blob.length; i += 8000) console.log('EV ' + blob.slice(i, i + 8000));
  console.log('EVIDENCE-END');
}

module.exports = { get, blocks, published, passages, keys, norm, decode, dogSentences, links };
if (require.main === module) main();
