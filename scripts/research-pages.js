#!/usr/bin/env node
/* Research helper: reads every URL listed in a file in data/research (one per line) and prints the readable text of
   each page, plus up to FOLLOW same-site pages whose link looks useful (FAQ, visit, dogs, events, contact, rehoming...).
   Output goes to the job log only (gzip + base64 between EVIDENCE markers). Run: PAGES=file.txt node scripts/research-pages.js */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const H = require('./research-evidence.js');

const LIST = path.join(__dirname, '..', 'data', 'research', process.env.PAGES || 'pages.txt');
const FOLLOW = +(process.env.FOLLOW || 6);
const USEFUL = /dog|pet|faq|question|visit|plan|about|contact|find|event|what.?s.?on|show|expo|rehom|adopt|centre|center|shelter|location|branch|ticket|programme|schedule|calendar/i;

function text(html) {
  return H.blocks(html).map(b => (b.head ? '## ' : '') + b.text).join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 20000);
}
function sameSiteLinks(html, base) {
  let host; try { host = new URL(base).host; } catch (e) { return []; }
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(H.decode(m[1]), base); } catch (e) { continue; }
    if (u.host !== host || /\.(pdf|jpe?g|png|gif|webp|mp4|zip)$/i.test(u.pathname) || u.href === base) continue;
    if (USEFUL.test(u.pathname) || USEFUL.test(m[2].replace(/<[^>]+>/g, ' '))) out.add(u.origin + u.pathname + u.search);
  }
  return [...out].slice(0, FOLLOW);
}

(async () => {
  const urls = fs.readFileSync(LIST, 'utf8').split('\n').map(s => s.trim()).filter(s => /^https?:/.test(s));
  const pages = {};
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < urls.length) {
      const u = urls[i++];
      const r = await H.get(u, 30000);
      const pg = pages[u] = { status: r.status, final: r.url, sub: {} };
      if (r.html) {
        Object.assign(pg, H.published(r.html));
        pg.title = (r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].replace(/\s+/g, ' ').trim().slice(0, 200);
        pg.text = text(r.html);
        for (const l of sameSiteLinks(r.html, r.url)) {
          const s = await H.get(l, 20000);
          pg.sub[l] = s.html ? { status: s.status, title: (s.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].replace(/\s+/g, ' ').trim().slice(0, 200), text: text(s.html).slice(0, 8000) } : { status: s.status };
        }
      }
      console.log('page', r.status, Object.keys(pg.sub).length + ' sub', u);
    }
  }));
  const blob = zlib.gzipSync(JSON.stringify(pages)).toString('base64');
  console.log('EVIDENCE-START');
  for (let j = 0; j < blob.length; j += 8000) console.log('EV ' + blob.slice(j, j + 8000));
  console.log('EVIDENCE-END');
})();
