/* Approved suggestions from the app's "Suggest a place" form.
   The form saves to a Google Sheet. In that sheet, type "yes" in the Approved column to accept a suggestion.
   The sheet's responses tab is published as CSV, and its address goes in scripts/suggestions-url.txt. */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./web-places.js');

const URL_FILE = path.join(__dirname, 'suggestions-url.txt');

const TYPE_TO_CAT = [
  [/caf/i, 'cafe'], [/pub|bar/i, 'pub'], [/restaurant|takeaway/i, 'food'], [/hotel|b&b|self-catering|campsite|glamping/i, 'stay'],
  [/shopping centre|garden centre|^shop/i, 'shop'], [/park, beach|walk/i, 'outdoors'], [/attraction|day out/i, 'attraction'],
  [/hospital|care home|clinic/i, 'health'], [/^vet/i, 'vet'], [/pet shop|groomer/i, 'petshop'],
  [/kennel|daycare|training/i, 'care'], [/dog park/i, 'dogpark']
];
const DOGS_TO_POLICY = { 'inside': 'yes', 'outside only': 'outside', 'on a lead': 'leashed', 'not sure': 'friendly' };

function pick(row, re) { const k = Object.keys(row).find(h => re.test(h)); return k ? (row[k] || '').trim() : ''; }

// suggestions-url.txt: one CSV address per line (the original Google Form tab, and the app's own "App suggestions" tab)
async function loadSuggestions(log = console.log) {
  const urls = fs.existsSync(URL_FILE) ? fs.readFileSync(URL_FILE, 'utf8').split('\n').map(l => l.trim()).filter(l => /^https:/.test(l)) : [];
  let rows = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      rows = rows.concat(parseCsv(await res.text()));
    } catch (e) { log('Could not read suggestions sheet:', e.message); }
  }
  const out = [];
  rows.forEach(r => {
    if (!/^y(es)?$/i.test(pick(r, /approved/i))) return;
    const name = pick(r, /name of the place|^name/i), county = pick(r, /county/i).replace(/^(co\.?|county)\s+/i, '');
    const address = pick(r, /^address/i);
    const parts = address.split(',').map(x => x.trim()).filter(Boolean);
    const town = pick(r, /town/i) || parts[parts.length - 1] || '';
    if (!name || !town || !county) return;
    const street = parts.length > 1 ? parts.slice(0, -1).join(', ') : '';
    const photo = /^[\w-]{20,}$/.test(pick(r, /^photo$/i)) && /^y/i.test(pick(r, /photo permission/i)) ? pick(r, /^photo$/i) : '';
    const type = pick(r, /type/i);
    const cat = (TYPE_TO_CAT.find(([re]) => re.test(type)) || [null, 'other'])[1];
    const link = pick(r, /link|website/i);
    out.push({
      name, town, county, category: cat,
      policy: DOGS_TO_POLICY[pick(r, /dogs/i).toLowerCase()] || 'friendly',
      source: /^https?:\/\//.test(link) ? link : '',
      note: pick(r, /know|notes/i).slice(0, 300),
      by: /^y/i.test(pick(r, /\bi own|work here|owner or staff/i)) ? 'owner' : 'visitor',
      street, postcode: pick(r, /postcode/i).toUpperCase().slice(0, 10), photo
    });
  });
  log('Approved suggestions:', out.length, 'of', rows.length);
  return out;
}

module.exports = { loadSuggestions };
