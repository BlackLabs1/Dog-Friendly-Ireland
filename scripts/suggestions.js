/* Approved suggestions from the app's "Suggest a place" form.
   The form saves to a Google Sheet. In that sheet, type "yes" in the Approved column to accept a suggestion.
   The sheet's responses tab is published as CSV, and its address goes in scripts/suggestions-url.txt. */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./web-places.js');

const URL_FILE = path.join(__dirname, 'suggestions-url.txt');
const MODERATION = path.join(__dirname, '..', 'data', 'moderation.csv');
const { feedbackKey } = require('../js/feedback-key.js');

// Reports and edit suggestions sent from a place's page use the same form; their "Type of place" starts like this
const FEEDBACK = /^(report|edit suggestion)/i;

// The owner's decisions made in the app (Review suggestions): key -> approved / rejected
function decisions() {
  const out = {};
  if (fs.existsSync(MODERATION)) parseCsv(fs.readFileSync(MODERATION, 'utf8')).forEach(r => { if (r.key) out[r.key] = (r.decision || '').toLowerCase(); });
  return out;
}
function rowKey(r) {
  return feedbackKey(pick(r, /name of the place|^name/i), pick(r, /type/i), pick(r, /link|website/i), pick(r, /know|notes/i));
}
// Approved: "yes" typed in the sheet's Approved column, or Approve tapped in the app; Reject in the app always wins
function isApproved(r, dec) {
  const d = dec[rowKey(r)];
  if (d === 'rejected') return false;
  return d === 'approved' || /^y(es)?$/i.test(pick(r, /approved/i));
}
async function readSheets(log) {
  const urls = fs.existsSync(URL_FILE) ? fs.readFileSync(URL_FILE, 'utf8').split('\n').map(l => l.trim()).filter(l => /^https:/.test(l)) : [];
  let rows = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      rows = rows.concat(parseCsv(await res.text()));
    } catch (e) { log('Could not read suggestions sheet:', e.message); }
  }
  return rows;
}

const TYPE_TO_CAT = [
  [/caf/i, 'cafe'], [/pub|bar/i, 'pub'], [/restaurant|takeaway/i, 'food'], [/hotel|b&b|self-catering|campsite|glamping/i, 'stay'],
  [/shopping centre|garden centre|^shop/i, 'shop'], [/park, beach|walk/i, 'outdoors'], [/attraction|day out/i, 'attraction'],
  [/hospital|care home|clinic/i, 'health'], [/^vet/i, 'vet'], [/pet shop|groomer/i, 'petshop'],
  [/kennel|daycare|training/i, 'care'], [/dog park/i, 'dogpark']
];
const DOGS_TO_POLICY = { 'inside': 'yes', 'outside only': 'outside', 'on a lead': 'leashed', 'not sure': 'friendly' };

function pick(row, re) { const k = Object.keys(row).find(h => re.test(h)); return k ? (row[k] || '').trim() : ''; }

// suggestions-url.txt: one CSV address per line (the original Google Form tab, and the app's own "App suggestions" tab)
async function loadSuggestions(log = console.log, rows) {
  rows = rows || await readSheets(log);
  const dec = decisions();
  const out = [];
  rows.forEach(r => {
    if (FEEDBACK.test(pick(r, /type/i)) || !isApproved(r, dec)) return;
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
  log('Approved suggestions:', out.length, 'of', rows.filter(r => !FEEDBACK.test(pick(r, /type/i))).length);
  return out;
}

/* Approved reports and edits for places already in the app.
   The place id is in the link (…#place-ID); edits are "Field: value" lines in the notes. */
async function loadFeedback(log = console.log, rows) {
  rows = rows || await readSheets(log);
  const dec = decisions(), out = [];
  rows.forEach(r => {
    const type = pick(r, /type/i);
    if (!FEEDBACK.test(type) || !isApproved(r, dec)) return;
    const id = (pick(r, /link|website/i).match(/#place-([\w-]+)/) || [])[1];
    if (!id) return;
    const notes = pick(r, /know|notes/i), changes = {};
    notes.split('\n').forEach(line => { const m = line.match(/^(Name|Address|Town|Phone|Website|Opening hours|Dogs|Other|Details):\s*(.+)$/); if (m) changes[m[1].toLowerCase()] = m[2].trim(); });
    const dogs = pick(r, /dogs/i);
    if (dogs && !/no change|^-$/i.test(dogs)) changes.dogs = dogs;
    out.push({ id, kind: /^report/i.test(type) ? 'report' : 'edit', reason: type.replace(/^report:\s*/i, ''), changes, owner: /^y/i.test(pick(r, /\bi own|work here/i)) });
  });
  log('Approved reports and edits:', out.length);
  return out;
}

// Applies approved reports and edits to the finished list of places; returns the list without places reported closed or not dog friendly
const EDIT_DOGS = { 'inside and outside': 'yes', 'inside': 'yes', 'outside only': 'outside', 'on a lead': 'leashed', 'off the lead': 'unleashed' };
function applyFeedback(places, items, log = console.log) {
  const byId = new Map(places.map(p => [p.id, p])), drop = new Set();
  let edited = 0;
  items.forEach(f => {
    const p = byId.get(f.id); if (!p) return;
    if (f.kind === 'report') {
      if (/closed/i.test(f.reason) || /not allowed|aren.t allowed|no dogs/i.test(f.reason)) drop.add(p.id);
      return;
    }
    const c = f.changes, t = p.t = p.t || {};
    if (c.dogs && /not allowed/i.test(c.dogs)) { drop.add(p.id); return; }
    if (c.name) p.n = c.name;
    if (c.address) t['addr:street'] = c.address;
    if (c.town) { if (t['addr:town']) t['addr:town'] = c.town; else t['addr:city'] = c.town; }
    if (c.phone) { delete t['contact:phone']; t.phone = c.phone; }
    if (c.website) { delete t['contact:website']; t.website = /^https?:/i.test(c.website) ? c.website : 'https://' + c.website; }
    if (c['opening hours']) { t.opening_hours = c['opening hours']; t['opening_hours:source'] = 'visitor'; }
    if (c.dogs && EDIT_DOGS[c.dogs.toLowerCase()]) p.d = EDIT_DOGS[c.dogs.toLowerCase()];
    if (c.other) { p.w = p.w || { s: [], v: 'suggested' }; p.w.n = [p.w.n, c.other].filter(Boolean).join(' ').slice(0, 400); }
    edited++;
  });
  if (items.length) log(`Reports and edits: ${edited} places updated, ${drop.size} removed (reported closed or not dog friendly)`);
  return places.filter(p => !drop.has(p.id));
}

module.exports = { loadSuggestions, loadFeedback, applyFeedback, readSheets };
