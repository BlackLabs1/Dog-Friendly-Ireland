#!/usr/bin/env node
/* Research helper: reads a list of guide pages (data/research/corpus.txt, one URL per line) and, for every
   unconfirmed place named on a page, keeps the passage about it. Directory pages (BringFido and similar) are
   followed one level to the page for each matching place. Output goes to the job log only (gzip + base64). */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const H = require('./research-evidence.js');

const DATA = path.join(__dirname, '..', 'data');
const FOLLOW = /bringfido\.|dogfriendly\.co\.uk|thegooddogguide\.com|discovernorthernireland\.com|discoverireland\.ie|wanderlog\.com|visitbelfast\.com|visitlisburncastlereagh\.com|shapedbyseaandstone\.com|visitardsandnorthdown\.com|visitcausewaycoastandglens\.com|visitmournemountains\.co\.uk|visitarmagh\.com|fermanaghlakelands\.com|visitderry\.com|visitmidulster\.com|visitwaterford\.com|visitwexford\.ie|visitkilkenny\.ie|visitdublin\.com/i;

(async () => {
  const places = JSON.parse(fs.readFileSync(path.join(DATA, 'ireland.json'), 'utf8')).places.filter(p => p.w && p.w.v === 'unconfirmed');
  const keyed = places.map(p => ({ id: p.id, n: p.n, ks: H.keys(p.n) }));
  const urls = fs.readFileSync(path.join(DATA, 'research', process.env.CORPUS || 'corpus.txt'), 'utf8').split('\n').map(s => s.trim()).filter(s => /^https?:/.test(s));
  const pages = {}, hits = {};
  const scan = async (u, depth) => {
    if (pages[u]) return;
    const r = await H.get(u, 30000);
    const pg = pages[u] = { status: r.status, final: r.url };
    if (!r.html) { console.log('page', r.status, u); return; }
    Object.assign(pg, H.published(r.html));
    pg.title = (r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].replace(/\s+/g, ' ').trim().slice(0, 200);
    const bl = H.blocks(r.html), all = H.norm(bl.map(b => b.text).join(' '));
    let n = 0;
    for (const k of keyed) {
      if (!k.ks.some(x => (' ' + all + ' ').includes(' ' + x + ' '))) continue;
      const ps = H.passages(bl, k.n);
      if (ps.length) {
        const rec = { url: u, passages: ps };
        if (depth === 1) rec.dogs = H.dogSentences(bl, u).map(d => d.s).slice(0, 8);
        (hits[k.id] = hits[k.id] || { n: k.n, pages: [] }).pages.push(rec); n++;
      }
    }
    console.log('page', r.status, pg.published || '-', n + ' places', u);
    if (depth === 0 && FOLLOW.test(u)) {
      const follow = [];
      for (const m of r.html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const label = H.norm(m[2].replace(/<[^>]+>/g, ' '));
        if (!label || label.length < 4) continue;
        if (!keyed.some(k => k.ks.some(x => label === x || label.startsWith(x + ' ') || x.startsWith(label + ' ') && label.split(' ').length > 1))) continue;
        try { follow.push(new URL(H.decode(m[1]), u).href); } catch (e) {}
      }
      for (const f of [...new Set(follow)].slice(0, 40)) await scan(f, 1);
    }
  };
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (i < urls.length) await scan(urls[i++], 0); }));
  const blob = zlib.gzipSync(JSON.stringify({ pages, places: hits })).toString('base64');
  console.log('EVIDENCE-START');
  for (let j = 0; j < blob.length; j += 8000) console.log('EV ' + blob.slice(j, j + 8000));
  console.log('EVIDENCE-END');
})();
