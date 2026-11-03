/* Dog Friendly Ireland: app logic. Plain JS, no build step. */
(function () {
  'use strict';

  var P = window.DFPlaces;
  var DATA_URL = 'data/ireland.json';
  var MAX_AGE_DAYS = 7;
  var PAGE = 60;
  var IRELAND = { center: [53.45, -7.9], zoom: 7 };

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    places: [], byId: {}, cat: 'all', q: '', policy: 'any', view: 'map',
    user: null, saved: loadSaved(), listLimit: PAGE, areaOnly: false, meta: null, sheetId: null
  };
  var map, markerLayer, userMarker, selectedMarker;

  // ---------- small helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function recall(key, dflt) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
  function loadSaved() { return recall('dfi-saved', {}); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function km(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLa = (b[0] - a[0]) * toR, dLo = (b[1] - a[1]) * toR;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtKm(d) { return d < 1 ? Math.round(d * 1000 / 10) * 10 + ' m' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km'; }
  function fmtDate(s) {
    var d = new Date(s); if (isNaN(d)) return s;
    return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // ---------- IndexedDB cache (data is too big for localStorage) ----------
  var idb = {
    open: function () {
      return new Promise(function (res, rej) {
        if (!('indexedDB' in window)) return rej(new Error('no idb'));
        var r = indexedDB.open('dfi', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    },
    get: function (k) {
      return idb.open().then(function (db) {
        return new Promise(function (res, rej) {
          var q = db.transaction('kv').objectStore('kv').get(k);
          q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
        });
      }).catch(function () { return null; });
    },
    set: function (k, v) {
      return idb.open().then(function (db) {
        return new Promise(function (res) {
          var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
          tx.oncomplete = res; tx.onerror = res;
        });
      }).catch(function () {});
    }
  };

  // ---------- data loading ----------
  function fetchStatic() {
    return fetch(DATA_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('No data file');
      return r.json();
    }).then(function (j) {
      if (!j || !j.places || !j.places.length) throw new Error('Empty data file');
      return { generated: j.generated, source: 'file', places: j.places };
    });
  }
  function fetchOverpass() {
    var body = 'data=' + encodeURIComponent(P.OVERPASS_QUERY);
    var i = 0;
    function attempt() {
      var url = P.OVERPASS_ENDPOINTS[i];
      return fetch(url, { method: 'POST', body: body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then(function (r) { if (!r.ok) throw new Error('Map server busy (' + r.status + ')'); return r.json(); })
        .catch(function (e) {
          i++;
          if (i < P.OVERPASS_ENDPOINTS.length) return attempt();
          throw e;
        });
    }
    return attempt().then(function (j) {
      return { generated: (j.osm3s && j.osm3s.timestamp_osm_base) || new Date().toISOString(), source: 'live', places: P.fromOverpass(j) };
    });
  }
  function fetchFresh() { return fetchStatic().catch(fetchOverpass); }

  function loadData() {
    return idb.get('ireland').then(function (cached) {
      if (cached && cached.places && cached.places.length) {
        var age = (Date.now() - cached.saved) / 864e5;
        if (age > MAX_AGE_DAYS && navigator.onLine !== false) {
          fetchFresh().then(function (d) { d.saved = Date.now(); idb.set('ireland', d); setData(d); toast('Places updated'); }).catch(function () {});
        }
        return cached;
      }
      return fetchFresh().then(function (d) { d.saved = Date.now(); idb.set('ireland', d); return d; });
    });
  }

  function setData(d) {
    state.meta = d;
    state.places = d.places;
    state.byId = {};
    d.places.forEach(function (p) { state.byId[p.id] = p; p._s = (p.n + ' ' + town(p.t) + ' ' + (p.t['addr:county'] || '') + ' ' + p.k + ' ' + (p.t.cuisine || '')).toLowerCase(); });
    $('data-meta').textContent = d.places.length.toLocaleString('en-IE') + ' places, from OpenStreetMap data as of ' + fmtDate(d.generated) + '.';
    renderChips(); refresh();
    if (state.sheetId) openPlace(state.sheetId, true);
  }

  // ---------- filtering ----------
  function town(t) { return t['addr:town'] || t['addr:city'] || t['addr:village'] || t['addr:suburb'] || t['addr:place'] || ''; }
  function matchesBase(p) {
    if (state.policy === 'inside' && !(p.d === 'yes' || p.d === 'unleashed' || p.d === 'designated' || p.d === 'leashed' || p.d === 'service')) return false;
    if (state.policy === 'services' && !P.SERVICE_CATS[p.c]) return false;
    if (state.q) {
      var words = state.q.split(/\s+/);
      for (var i = 0; i < words.length; i++) if (words[i] && p._s.indexOf(words[i]) < 0) return false;
    }
    return true;
  }
  function filtered() {
    return state.places.filter(function (p) { return (state.cat === 'all' || p.c === state.cat) && matchesBase(p); });
  }
  function origin() {
    if (state.user) return state.user;
    if (map) { var c = map.getCenter(); return [c.lat, c.lng]; }
    return IRELAND.center;
  }

  // ---------- chips ----------
  function renderChips() {
    var counts = { all: 0 };
    state.places.forEach(function (p) { if (matchesBase(p)) { counts.all++; counts[p.c] = (counts[p.c] || 0) + 1; } });
    var html = chip('all', 'Everything', null, counts.all);
    P.CATEGORIES.forEach(function (c) { if (counts[c.id] || state.cat === c.id) html += chip(c.id, c.label, c.color, counts[c.id] || 0); });
    $('chips').innerHTML = html;
  }
  function chip(id, label, color, n) {
    return '<button class="chip" type="button" data-cat="' + id + '" aria-pressed="' + (state.cat === id) + '"' +
      (color ? ' style="--dot:' + color + '"' : '') + '>' + (color ? '<i></i>' : '') + esc(label) +
      ' <b>' + n.toLocaleString('en-IE') + '</b></button>';
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L) { $('map-status').textContent = 'Map unavailable offline. Use the List tab.'; return; }
    map = L.map('map', { zoomControl: true, preferCanvas: true, attributionControl: true }).setView(IRELAND.center, IRELAND.zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    map.on('moveend', debounce(updateAreaButton, 150));
    var last = recall('dfi-view', null);
    if (last && last.c) map.setView(last.c, last.z);
    map.on('moveend', function () { var c = map.getCenter(); store('dfi-view', { c: [c.lat, c.lng], z: map.getZoom() }); });
  }
  function drawMarkers(list) {
    if (!map) return;
    markerLayer.clearLayers();
    var r = map.getZoom() < 10 ? 5 : 7;
    list.forEach(function (p) {
      var m = L.circleMarker([p.la, p.lo], {
        radius: r, weight: 1.5, color: '#ffffff', fillColor: P.CAT_BY_ID[p.c].color, fillOpacity: .95
      });
      m.on('click', function () { location.hash = 'place-' + p.id; });
      markerLayer.addLayer(m);
    });
  }
  function updateAreaButton() {
    if (!map) return;
    var b = map.getBounds(), n = 0;
    filtered().forEach(function (p) { if (b.contains([p.la, p.lo])) n++; });
    var zoomedOut = map.getZoom() <= 7;
    $('area-list').textContent = n ? (zoomedOut ? 'List all ' + n.toLocaleString('en-IE') + ' places' : 'List ' + n.toLocaleString('en-IE') + (n === 1 ? ' place' : ' places') + ' in this area') : '';
    $('map-status').textContent = n ? '' : (state.places.length ? 'No matching places here. Try zooming out.' : '');
  }

  // ---------- list ----------
  function cardHtml(p, from) {
    var c = P.CAT_BY_ID[p.c], pol = P.POLICIES[p.d];
    var where = [p.k, town(p.t) || p.t['addr:county'], p.w && p.w.v === 'unconfirmed' ? 'not yet confirmed' : ''].filter(Boolean).join(' · ');
    var dist = from ? fmtKm(km(from, [p.la, p.lo])) : '';
    return '<li><button class="card" type="button" data-id="' + p.id + '" style="--dot:' + c.color + '">' +
      '<span class="dot"><svg viewBox="0 0 64 64"><use href="#paw"/></svg></span>' +
      '<span class="card-body"><h3' + (p.u ? ' class="unnamed"' : '') + '>' + esc(p.n) + '</h3>' +
      '<p class="meta">' + esc(where) + '</p>' +
      '<span class="badge p-' + p.d + '">' + esc(pol.label) + '</span></span>' +
      '<span class="dist">' + dist + '</span></button></li>';
  }
  function renderList() {
    var list = filtered(), from = origin();
    var inArea = state.areaOnly && map;
    if (inArea) { var b = map.getBounds(); list = list.filter(function (p) { return b.contains([p.la, p.lo]); }); }
    list.forEach(function (p) { p._d = km(from, [p.la, p.lo]); });
    list.sort(function (a, b) { return a._d - b._d; });
    var shown = list.slice(0, state.listLimit);
    var n = list.length.toLocaleString('en-IE');
    var where = inArea ? ' in the map area' : (state.user ? ', nearest first' : ' across Ireland, nearest the map centre first');
    $('list-count').innerHTML = '<strong>' + n + '</strong> ' + (list.length === 1 ? 'place' : 'places') + esc(where) +
      (inArea ? ' · <a href="#list" id="show-all">Show all</a>' : '');
    $('list').innerHTML = shown.length ? shown.map(function (p) { return cardHtml(p, from); }).join('') :
      '<li class="empty"><p><strong>Nothing matches.</strong></p><p>Try a different search, or choose Everything.</p></li>';
    $('more').hidden = list.length <= shown.length;
  }
  function renderSaved() {
    var ids = Object.keys(state.saved), from = state.user;
    var list = ids.map(function (id) { return state.byId[id] || state.saved[id]; }).filter(Boolean);
    $('saved-empty').hidden = list.length > 0;
    $('saved-count').innerHTML = list.length ? '<strong>' + list.length + '</strong> saved ' + (list.length === 1 ? 'place' : 'places') : '';
    $('saved').innerHTML = list.map(function (p) { return cardHtml(p, from); }).join('');
  }

  function refresh() {
    state.listLimit = PAGE;
    drawMarkers(filtered());
    updateAreaButton();
    if (state.view === 'list') renderList();
    if (state.view === 'saved') renderSaved();
  }

  // ---------- place sheet ----------
  var ICON = {
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>',
    access: '<circle cx="12" cy="4.5" r="1.5"/><path d="M12 7v6h5l2 5M12 10h5M9 10a6 6 0 1 0 6 8"/>',
    nav: '<path d="m3 11 18-8-8 18-2-8z"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
    save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    social: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>',
    check: '<path d="m5 12 4 4L19 7"/>',
    gmaps: '<path d="M12 22s7-6.6 7-12.5a7 7 0 0 0-14 0C5 15.4 12 22 12 22z"/><path d="M9.5 9.5h5M12 7v5"/>'
  };
  function ico(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }

  function addressOf(t) {
    var line1 = [t['addr:housename'], [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [line1, t['addr:place'], t['addr:suburb'], t['addr:town'] || t['addr:city'] || t['addr:village'], t['addr:county'], t['addr:postcode']]
      .filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
  }
  var DAYS = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'Bank holidays' };
  function hoursHtml(oh) {
    if (oh === '24/7') return 'Open 24 hours';
    return '<ul class="hours">' + oh.split(/\s*;\s*/).filter(Boolean).map(function (part) {
      var s = part.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, function (d) { return DAYS[d]; })
        .replace(/-/g, '–').replace(/\boff\b/g, 'closed').replace(/,(?=\S)/g, ', ');
      return '<li>' + esc(s) + '</li>';
    }).join('') + '</ul>';
  }
  function url(u) { return /^https?:\/\//i.test(u) ? u : 'https://' + u; }
  function prettyUrl(u) { return u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''); }
  function social(v, base) { return /^https?:/i.test(v) ? v : base + v.replace(/^@/, ''); }
  function telHref(n) { return 'tel:' + n.replace(/[^\d+]/g, ''); }

  function googleUrl(p) {
    var t = p.t, q;
    if (p.u) q = p.la + ',' + p.lo;
    else {
      var where = [t['addr:street'], town(t), t['addr:county']].filter(Boolean).join(', ');
      q = where ? p.n + ', ' + where : p.n + ' near ' + p.la.toFixed(5) + ',' + p.lo.toFixed(5);
    }
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
  function directionsUrl(p) {
    // Places only known to be in a town (not pinned exactly) are routed by name instead of coordinates
    var dest = p.w && p.w.a ? p.n + ', ' + [town(p.t), p.t['addr:county']].filter(Boolean).join(', ') : p.la + ',' + p.lo;
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest);
  }
  function osmUrl(p) {
    var type = { n: 'node', w: 'way', r: 'relation' }[p.id.charAt(0)];
    return type ? 'https://www.openstreetmap.org/' + type + '/' + p.id.slice(1)
      : 'https://www.openstreetmap.org/#map=17/' + p.la + '/' + p.lo;
  }
  function reportUrl(p) {
    return 'https://github.com/BlackLabs1/Dog-Friendly-Ireland/issues/new?title=' +
      encodeURIComponent('Correction: ' + p.n + ' (' + (town(p.t) || '') + ')') +
      '&body=' + encodeURIComponent('Place id: ' + p.id + '\n\nWhat should change?\n');
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function photoUrl(t) {
    if (t.wikimedia_commons && /^File:/i.test(t.wikimedia_commons)) {
      return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(t.wikimedia_commons.replace(/^File:/i, '')) + '?width=900';
    }
    if (t.image && /^https?:\/\/.+\.(jpe?g|png|webp)(\?.*)?$/i.test(t.image)) return t.image;
    return null;
  }

  function fact(icon, label, html) {
    return '<div class="fact">' + ico(icon) + '<div><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div></div>';
  }

  function placeHtml(p) {
    var t = p.t, c = P.CAT_BY_ID[p.c], pol = P.POLICIES[p.d];
    var h = '<div class="grabber"></div><div class="sheet-in" style="--dot:' + c.color + '">';
    h += '<div class="sheet-top"><span class="dot"><svg viewBox="0 0 64 64"><use href="#paw"/></svg></span>' +
      '<div class="sheet-title"><h2 id="sheet-title">' + esc(p.n) + '</h2><p>' + esc([p.k, town(t) || t['addr:county']].filter(Boolean).join(' · ')) +
      (state.user ? ' · ' + fmtKm(km(state.user, [p.la, p.lo])) + ' away' : '') + '</p></div>' +
      '<button class="close" type="button" id="close" aria-label="Close">' + ico('close') + '</button></div>';

    var extra = [t['dog:note'], t['dog:description'], t['dog:conditional'] ? 'Conditions: ' + t['dog:conditional'] : '', p.w && p.w.n].filter(Boolean);
    h += '<div class="policy p-' + p.d + '"><strong>' + esc(pol.label) + '</strong><p>' + esc(pol.note) + '</p>' +
      extra.map(function (e) { return '<p class="extra">' + esc(e) + '</p>'; }).join('') + '</div>';

    var ph = photoUrl(t);
    if (ph) h += '<figure class="photo"><img src="' + esc(ph) + '" alt="Photo of ' + esc(p.n) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></figure>';


    var phone = t.phone || t['contact:phone'] || t.mobile || t['contact:mobile'];
    var site = t.website || t['contact:website'] || t.url;
    var saved = !!state.saved[p.id];
    h += '<div class="actions">' +
      '<a class="act" href="' + esc(directionsUrl(p)) + '" target="_blank" rel="noopener">' + ico('nav') + 'Directions</a>' +
      (phone ? '<a class="act" href="' + esc(telHref(phone.split(';')[0])) + '">' + ico('phone') + 'Call</a>'
             : (site ? '<a class="act" href="' + esc(url(site)) + '" target="_blank" rel="noopener">' + ico('web') + 'Website</a>'
                     : '<button class="act" type="button" id="act-osm">' + ico('pin') + 'Map</button>')) +
      '<button class="act" type="button" id="act-save" aria-pressed="' + saved + '">' + ico('save') + (saved ? 'Saved' : 'Save') + '</button>' +
      '<button class="act" type="button" id="act-share">' + ico('share') + 'Share</button></div>';

    var facts = '';
    var addr = addressOf(t);
    if (addr) facts += fact('pin', 'Address', esc(addr) + ' <button class="copy" type="button" data-copy="' + esc(addr) + '">Copy</button>');
    if (t.opening_hours) facts += fact('clock', 'Opening hours', hoursHtml(t.opening_hours));
    if (phone) facts += fact('phone', 'Phone', phone.split(/\s*;\s*/).map(function (n) {
      return '<a href="' + esc(telHref(n)) + '">' + esc(n) + '</a> <button class="copy" type="button" data-copy="' + esc(n) + '">Copy</button>';
    }).join('<br>'));
    var email = t.email || t['contact:email'];
    if (email) facts += fact('mail', 'Email', '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>');
    if (site) facts += fact('web', 'Website', '<a href="' + esc(url(site)) + '" target="_blank" rel="noopener">' + esc(prettyUrl(site)) + '</a>');
    var fb = t.facebook || t['contact:facebook'], ig = t.instagram || t['contact:instagram'];
    if (fb || ig) facts += fact('social', 'Social', [
      fb ? '<a href="' + esc(social(fb, 'https://www.facebook.com/')) + '" target="_blank" rel="noopener">Facebook</a>' : '',
      ig ? '<a href="' + esc(social(ig, 'https://www.instagram.com/')) + '" target="_blank" rel="noopener">Instagram</a>' : ''
    ].filter(Boolean).join(' · '));
    if (t.description) facts += fact('info', 'About', esc(t.description));
    if (t.cuisine) facts += fact('food', 'Food', esc(t.cuisine.split(/\s*;\s*/).map(function (x) { return cap(x.replace(/_/g, ' ')); }).join(', ')));
    var feats = [];
    if (t.outdoor_seating === 'yes') feats.push('Outdoor seating');
    if (t.takeaway === 'yes' || t.takeaway === 'only') feats.push(t.takeaway === 'only' ? 'Takeaway only' : 'Takeaway');
    if (t.internet_access === 'wlan' || t.internet_access === 'yes') feats.push('Wi-Fi');
    if (t.emergency === 'yes' && p.c === 'vet') feats.push('Emergency service');
    if (t.stars) feats.push(t.stars + '-star');
    if (t.fee === 'no') feats.push('Free entry'); else if (t.fee === 'yes') feats.push('Entry fee');
    if (feats.length) facts += fact('check', 'Good to know', esc(feats.join(' · ')));
    var wc = { yes: 'Wheelchair accessible', limited: 'Partly wheelchair accessible', no: 'Not wheelchair accessible' }[t.wheelchair];
    if (wc) facts += fact('access', 'Access', esc(wc));
    if (t.operator && t.operator !== p.n) facts += fact('info', 'Run by', esc(t.operator));
    if (p.w && p.w.a) facts += fact('pin', 'Location', 'Shown at the centre of ' + esc(town(t) || 'the town') + '. Use Google Maps for the exact spot.');
    if (p.w && p.w.by) facts += fact('check', 'Suggested through this app', p.w.by === 'owner' ? 'By the owner or staff' : 'By a visitor');
    if (p.w && p.w.s && p.w.s.length) {
      var links = p.w.s.map(function (s) { return '<a href="' + esc(s) + '" target="_blank" rel="noopener">' + esc(host(s)) + '</a>'; }).join('<br>');
      var when = p.w.c ? ' (checked ' + esc(fmtDate(p.w.c)) + ')' : '';
      if (p.w.v === 'business') facts += fact('check', 'Confirmed by the business' + when, links);
      else if (p.w.v === 'official') facts += fact('check', 'Confirmed by the official tourism guide' + when, links);
      else if (p.w.v !== 'suggested') facts += fact('info', 'Not yet confirmed by the business', 'Listed as dog friendly by ' + links + '. Check before you go.');
      else facts += fact('info', 'Link', links);
      if (p.w.f && p.w.v !== 'unconfirmed') facts += fact('info', 'First listed by', '<a href="' + esc(p.w.f) + '" target="_blank" rel="noopener">' + esc(host(p.w.f)) + '</a>');
    }
    if (facts) h += '<dl class="facts">' + facts + '</dl>';

    h += '<a class="gmaps" href="' + esc(googleUrl(p)) + '" target="_blank" rel="noopener">' + ico('gmaps') +
      '<div><strong>See photos & reviews on Google Maps</strong><span>Opens in your Google Maps app</span></div></a>';

    var webOnly = p.w && 'a' in p.w && !/^[nwr]\d/.test(p.id);
    h += '<p class="fix">' + (t.check_date ? 'Details last checked ' + esc(fmtDate(t.check_date)) + '. ' : '') +
      (webOnly ? 'Something wrong or out of date? <a href="' + esc(reportUrl(p)) + '" target="_blank" rel="noopener">Report it</a>, or <a href="' + esc(osmUrl(p)) + '" target="_blank" rel="noopener">add it to OpenStreetMap</a>.'
               : 'Something wrong or missing? <a href="' + esc(osmUrl(p)) + '" target="_blank" rel="noopener">Fix this on OpenStreetMap</a>.') + '</p>';
    return h + '</div>';
  }

  function openPlace(id, quiet) {
    var p = state.byId[id] || state.saved[id];
    if (!p) { if (!quiet && state.places.length) toast('That place is no longer listed'); return; }
    state.sheetId = id;
    var s = $('sheet');
    s.innerHTML = placeHtml(p);
    s.hidden = false; $('backdrop').hidden = false;
    s.scrollTop = 0;
    s.focus({ preventScroll: true });
    if (map) {
      if (selectedMarker) map.removeLayer(selectedMarker);
      selectedMarker = L.circleMarker([p.la, p.lo], { radius: 13, weight: 3, color: P.CAT_BY_ID[p.c].color, fill: false }).addTo(map);
      if (state.view === 'map') {
        var z = Math.max(map.getZoom(), 15);
        map.setView([p.la, p.lo], z, { animate: false });
        map.panBy([0, Math.round(map.getSize().y * 0.22)], { animate: false });
      }
    }
  }
  function closePlace() {
    state.sheetId = null;
    $('sheet').hidden = true; $('backdrop').hidden = true;
    if (selectedMarker && map) { map.removeLayer(selectedMarker); selectedMarker = null; }
  }

  function toggleSave(id) {
    var p = state.byId[id] || state.saved[id];
    if (!p) return;
    if (state.saved[id]) { delete state.saved[id]; toast('Removed from Saved'); }
    else { state.saved[id] = { id: p.id, la: p.la, lo: p.lo, n: p.n, u: p.u, c: p.c, d: p.d, k: p.k, t: p.t }; toast('Saved'); }
    store('dfi-saved', state.saved);
    var b = $('act-save');
    if (b) { b.setAttribute('aria-pressed', !!state.saved[id]); b.lastChild.textContent = state.saved[id] ? 'Saved' : 'Save'; }
    if (state.view === 'saved') renderSaved();
  }
  function share(id) {
    var p = state.byId[id] || state.saved[id];
    var link = location.href.split('#')[0] + '#place-' + id;
    var text = p.n + ' (' + P.POLICIES[p.d].label.toLowerCase() + ') on Dog Friendly Ireland';
    if (navigator.share) { navigator.share({ title: p.n, text: text, url: link }).catch(function () {}); return; }
    copy(link, 'Link copied');
  }
  function copy(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg || 'Copied'); }, function () { toast(text); });
    } else toast(text);
  }

  // ---------- location ----------
  function locate() {
    if (!navigator.geolocation) { toast('Location is not available on this device'); return; }
    var b = $('locate'); b.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (pos) {
      b.classList.remove('busy');
      state.user = [pos.coords.latitude, pos.coords.longitude];
      if (map) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker(state.user, { radius: 8, weight: 3, color: '#ffffff', fillColor: '#1c7cd6', fillOpacity: 1 }).addTo(map);
        map.setView(state.user, 14);
      }
      if (state.view === 'list') renderList();
    }, function (err) {
      b.classList.remove('busy');
      toast(err.code === 1 ? 'Allow location access in your browser settings to see places near you' : 'Could not find your location. Try again outside.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  // ---------- routing ----------
  function route() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('place-') === 0) { openPlace(h.slice(6)); return; }
    closePlace();
    var v = /^(map|list|saved|suggest|about)$/.test(h) ? h : 'map';
    if (v !== 'list') state.areaOnly = false;
    state.view = v;
    $('app').setAttribute('data-view', v);
    ['map', 'list', 'saved', 'suggest', 'about'].forEach(function (x) { $('view-' + x).hidden = x !== v; });
    document.querySelectorAll('.tabs a').forEach(function (a) {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 0);
    if (v === 'list') renderList();
    if (v === 'saved') renderSaved();
  }

  function closeToView() { location.replace('#' + state.view); }

  // ---------- events ----------
  function bind() {
    $('chips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      state.cat = state.cat === b.dataset.cat && b.dataset.cat !== 'all' ? 'all' : b.dataset.cat;
      renderChips(); refresh();
    });
    var onSearch = debounce(function () { state.q = $('q').value.trim().toLowerCase(); renderChips(); refresh(); }, 200);
    $('q').addEventListener('input', onSearch);
    $('q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('q').blur(); if (state.view === 'map') location.hash = 'list'; }
    });
    $('policy').addEventListener('change', function () { state.policy = $('policy').value; renderChips(); refresh(); });
    $('locate').addEventListener('click', locate);
    $('area-list').addEventListener('click', function () {
      state.areaOnly = !!(map && map.getZoom() > 7);
      if (location.hash === '#list') renderList(); else location.hash = 'list';
    });
    $('more').addEventListener('click', function () { state.listLimit += PAGE; renderList(); });
    document.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (card) { location.hash = 'place-' + card.dataset.id; return; }
      if (e.target.closest('#close')) { closeToView(); return; }
      if (e.target.closest('#act-save')) { toggleSave(state.sheetId); return; }
      if (e.target.closest('#act-share')) { share(state.sheetId); return; }
      if (e.target.closest('#act-osm')) { window.open(osmUrl(state.byId[state.sheetId]), '_blank', 'noopener'); return; }
      var cp = e.target.closest('[data-copy]');
      if (cp) { copy(cp.dataset.copy); return; }
      if (e.target.id === 'show-all') { e.preventDefault(); state.areaOnly = false; renderList(); }
    });
    $('backdrop').addEventListener('click', closeToView);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.sheetId) closeToView(); });
    window.addEventListener('hashchange', route);
    $('refresh').addEventListener('click', function () {
      var b = $('refresh'); b.disabled = true; b.textContent = 'Checking…';
      fetchFresh().then(function (d) {
        d.saved = Date.now(); idb.set('ireland', d); setData(d);
        toast(d.places.length.toLocaleString('en-IE') + ' places loaded');
      }).catch(function () { toast('Could not reach the map server. Try again later.'); })
        .then(function () { b.disabled = false; b.textContent = 'Check for new places'; });
    });
  }

  // ---------- suggest a place ----------
  var COUNTIES = ['Antrim', 'Armagh', 'Carlow', 'Cavan', 'Clare', 'Cork', 'Derry', 'Donegal', 'Down', 'Dublin', 'Fermanagh',
    'Galway', 'Kerry', 'Kildare', 'Kilkenny', 'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan',
    'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Tyrone', 'Waterford', 'Westmeath', 'Wexford', 'Wicklow'];
  var TYPES = ['Café', 'Pub or bar', 'Restaurant or takeaway', 'Hotel, B&B or self-catering', 'Campsite or glamping', 'Shop',
    'Shopping centre', 'Garden centre', 'Park, beach or walk', 'Attraction or day out', 'Hospital, care home or clinic',
    'Vet', 'Pet shop or groomer', 'Kennels, daycare or training', 'Dog park', 'Other'];
  function initSuggest() {
    $('s-county').insertAdjacentHTML('beforeend', COUNTIES.map(function (c) { return '<option>' + c + '</option>'; }).join(''));
    $('s-type').insertAdjacentHTML('beforeend', TYPES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join(''));
    var f = $('suggest-form');
    f.addEventListener('input', function (e) { $('s-error').hidden = true; if (e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()) e.target.setAttribute('aria-invalid', 'false'); });
    f.addEventListener('change', function (e) { if (e.target.getAttribute('aria-invalid') === 'true' && e.target.value) e.target.setAttribute('aria-invalid', 'false'); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('s-error'); err.hidden = true;
      var bad = null;
      ['s-name', 's-town', 's-county', 's-type'].forEach(function (id) {
        var el = $(id), ok = !!el.value.trim();
        el.setAttribute('aria-invalid', ok ? 'false' : 'true');
        if (!ok && !bad) bad = el;
      });
      var dogs = f.querySelector('input[name="dogs"]:checked');
      if (!bad && !dogs) bad = $('s-dogs-in');
      var link = $('s-link').value.trim();
      if (!bad && link && !/^https?:\/\/\S+\.\S+/.test(link)) {
        if (/^\S+\.\S+$/.test(link)) $('s-link').value = link = 'https://' + link;
        else bad = $('s-link');
      }
      if (bad) {
        err.textContent = bad.id === 's-link' ? 'That link doesn\'t look right. Paste the full web address, or leave it empty.'
          : bad.name === 'dogs' ? 'Choose where dogs are allowed, or pick "Not sure".' : 'Please fill in the fields marked *.';
        err.hidden = false; bad.focus(); return;
      }
      var cfg = (window.DFI_CONFIG || {}).suggestForm || {};
      if (!cfg.action || !cfg.fields) {
        err.textContent = 'Suggestions aren\'t switched on yet. Please try again soon.'; err.hidden = false; return;
      }
      var values = {
        name: $('s-name').value.trim(), town: $('s-town').value.trim(), county: $('s-county').value,
        type: $('s-type').value, dogs: dogs.value, link: link, notes: $('s-notes').value.trim(),
        owner: $('s-owner').checked ? 'Yes' : 'No'
      };
      var body = new URLSearchParams();
      Object.keys(cfg.fields).forEach(function (k) { if (values[k] != null) body.append(cfg.fields[k], values[k]); });
      var btn = $('s-submit'); btn.disabled = true; btn.textContent = 'Sending…';
      // Google Forms accepts the post but doesn't let the page read the reply, so a network error is the only failure we can see
      fetch(cfg.action, { method: 'POST', mode: 'no-cors', body: body }).then(function () {
        $('sent-name').textContent = values.name;
        f.hidden = true; $('suggest-sent').hidden = false; f.reset();
        f.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
        $('view-suggest').scrollTop = 0;
      }).catch(function () {
        err.textContent = 'Couldn\'t send. Check your connection and try again.'; err.hidden = false;
      }).then(function () { btn.disabled = false; btn.textContent = 'Send suggestion'; });
    });
    $('suggest-again').addEventListener('click', function () { $('suggest-sent').hidden = true; f.hidden = false; $('s-name').focus(); });
  }

  // ---------- start ----------
  function start() {
    initMap(); bind(); initSuggest(); route();
    loadData().then(function (d) {
      setData(d);
      $('loading').hidden = true;
    }).catch(function (err) {
      var l = $('loading'); l.classList.add('error');
      $('loading-text').textContent = 'Could not load places. Check your connection and try again.';
      l.querySelector('.loading-sub').innerHTML = esc(err.message) + '<br><br><button class="btn" type="button" onclick="location.reload()">Try again</button>';
    });
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }
  start();
})();
