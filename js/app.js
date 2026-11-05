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
      return { generated: j.generated, built: j.built, source: 'file', places: j.places };
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
        // Show the saved copy straight away, then check for a newer one (the file is only re-downloaded when it has changed)
        if (navigator.onLine !== false) {
          fetchStatic().then(function (d) {
            if (d.built && d.built === cached.built) return;
            d.saved = Date.now(); idb.set('ireland', d); setData(d); toast('Places updated');
          }).catch(function () {
            var age = (Date.now() - cached.saved) / 864e5;
            if (age > MAX_AGE_DAYS) fetchOverpass().then(function (d) { d.saved = Date.now(); idb.set('ireland', d); setData(d); toast('Places updated'); }).catch(function () {});
          });
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
    map = L.map('map', { zoomControl: true, preferCanvas: true, attributionControl: true, maxZoom: 19 }).setView(IRELAND.center, IRELAND.zoom);
    var osmCredit = 'Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    // Street map: OpenFreeMap (free, no key). Falls back to OpenStreetMap's own tiles if the device can't draw vector maps.
    var street = window.maplibregl && L.maplibreGL && webgl()
      ? L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty',
          attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' + osmCredit })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: osmCredit });
    var walking = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 17,
      attribution: 'Style © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC BY-SA), SRTM · ' + osmCredit
    });
    var layers = { 'Street map': street, 'Walking (hills and trails)': walking };
    (layers[recall('dfi-layer', '')] || street).addTo(map);
    L.control.layers(layers, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', function (e) { store('dfi-layer', e.name); });
    markerLayer = L.layerGroup().addTo(map);
    map.on('moveend', debounce(updateAreaButton, 150));
    var last = recall('dfi-view', null);
    if (last && last.c) map.setView(last.c, last.z);
    map.on('moveend', function () { var c = map.getCenter(); store('dfi-view', { c: [c.lat, c.lng], z: map.getZoom() }); });
  }
  function webgl() {
    try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
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

  function directionsUrl(p, mode) {
    // Places only known to be in a town (not pinned exactly) are routed by name instead of coordinates
    var byName = p.w && p.w.a, named = p.n + ', ' + [town(p.t), p.t['addr:county']].filter(Boolean).join(', ');
    // On Android, a geo: link lets the person choose any maps app they have (Google Maps, Waze, OsmAnd…)
    if (/Android/i.test(navigator.userAgent)) {
      return 'geo:0,0?q=' + (byName ? encodeURIComponent(named) : p.la + ',' + p.lo + '(' + encodeURIComponent(p.n) + ')');
    }
    var tm = { foot: 'walking', bike: 'bicycling', car: 'driving' }[mode] || '';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(byName ? named : p.la + ',' + p.lo) + (tm ? '&travelmode=' + tm : '');
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

  // ---------- photos and descriptions (data/media.json, loaded the first time a place is opened) ----------
  var media = null, mediaLoading = false;
  function loadMedia() {
    if (media || mediaLoading) return;
    mediaLoading = true;
    fetch('data/media.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (m) {
      media = m || {}; mediaLoading = false;
      if (state.sheetId && media[state.sheetId]) {
        var s = $('sheet'), top = s.scrollTop, p = state.byId[state.sheetId] || state.saved[state.sheetId];
        if (p) { s.innerHTML = placeHtml(p); s.scrollTop = top; }
      }
    });
  }
  function galleryHtml(p) {
    var md = media && media[p.id], list = (md && md.ph) || [];
    var own = photoUrl(p.t);
    if (!list.length && own) list = [{ u: own, f: own, s: host(own), a: '', l: '' }];
    if (!list.length) return '';
    return '<div class="gallery' + (list.length === 1 ? ' one' : '') + '">' + list.map(function (x) {
      var credit = [x.a ? (x.v ? 'Video: ' : 'Photo: ') + x.a : '', x.l, x.s].filter(Boolean).join(' · ');
      return '<figure><a href="' + esc(x.f) + '" target="_blank" rel="noopener"' + (x.v ? ' class="video" aria-label="Play video"' : '') + '>' +
        '<img src="' + esc(x.u) + '" alt="' + (x.v ? 'Video of ' : 'Photo of ') + esc(p.n) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest(\'figure\').remove()"></a>' +
        '<figcaption>' + esc(credit) + '</figcaption></figure>';
    }).join('') + '</div>';
  }

  function fact(icon, label, html) {
    return '<div class="fact">' + ico(icon) + '<div><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div></div>';
  }

  function placeHtml(p) {
    var t = p.t, c = P.CAT_BY_ID[p.c], pol = P.POLICIES[p.d];
    var h = '<div class="grabber"></div><div class="sheet-in" style="--dot:' + c.color + '">';
    var logo = media && media[p.id] && media[p.id].lg;
    h += '<div class="sheet-top">' + (logo ? '<span class="dot logo"><img src="' + esc(logo.u) + '" alt="" referrerpolicy="no-referrer"></span>'
      : '<span class="dot"><svg viewBox="0 0 64 64"><use href="#paw"/></svg></span>') +
      '<div class="sheet-title"><h2 id="sheet-title">' + esc(p.n) + '</h2><p>' + esc([p.k, town(t) || t['addr:county']].filter(Boolean).join(' · ')) +
      (state.user ? ' · ' + fmtKm(km(state.user, [p.la, p.lo])) + ' away' : '') + '</p></div>' +
      '<button class="close" type="button" id="close" aria-label="Close">' + ico('close') + '</button></div>';

    var extra = [t['dog:note'], t['dog:description'], t['dog:conditional'] ? 'Conditions: ' + t['dog:conditional'] : '', p.w && p.w.n].filter(Boolean);
    h += '<div class="policy p-' + p.d + '"><strong>' + esc(pol.label) + '</strong><p>' + esc(pol.note) + '</p>' +
      extra.map(function (e) { return '<p class="extra">' + esc(e) + '</p>'; }).join('') + '</div>';

    h += galleryHtml(p);


    var phone = t.phone || t['contact:phone'] || t.mobile || t['contact:mobile'];
    var site = t.website || t['contact:website'] || t.url;
    var saved = !!state.saved[p.id];
    h += '<div class="actions">' +
      '<button class="act" type="button" id="act-route">' + ico('nav') + 'Directions</button>' +
      (phone ? '<a class="act" href="' + esc(telHref(phone.split(';')[0])) + '">' + ico('phone') + 'Call</a>'
             : (site ? '<a class="act" href="' + esc(url(site)) + '" target="_blank" rel="noopener">' + ico('web') + 'Website</a>'
                     : '<button class="act" type="button" id="act-osm">' + ico('pin') + 'Map</button>')) +
      '<button class="act" type="button" id="act-save" aria-pressed="' + saved + '">' + ico('save') + (saved ? 'Saved' : 'Save') + '</button>' +
      '<button class="act" type="button" id="act-share">' + ico('share') + 'Share</button></div>';

    var facts = '';
    var addr = addressOf(t);
    if (addr) facts += fact('pin', 'Address', esc(addr) + ' <button class="copy" type="button" data-copy="' + esc(addr) + '">Copy</button>');
    if (t.opening_hours) facts += fact('clock', t['opening_hours:source'] === 'website' ? 'Opening hours (from their website)' : 'Opening hours', hoursHtml(t.opening_hours));
    if (phone) facts += fact('phone', 'Phone', phone.split(/\s*;\s*/).map(function (n) {
      return '<a href="' + esc(telHref(n)) + '">' + esc(n) + '</a> <button class="copy" type="button" data-copy="' + esc(n) + '">Copy</button>';
    }).join('<br>'));
    var email = t.email || t['contact:email'];
    if (email) facts += fact('mail', 'Email', '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>');
    if (site) facts += fact('web', 'Website', '<a href="' + esc(url(site)) + '" target="_blank" rel="noopener">' + esc(prettyUrl(site)) + '</a>');
    if (t['website:menu']) facts += fact('food', 'Menu', '<a href="' + esc(url(t['website:menu'])) + '" target="_blank" rel="noopener">See the menu on their website</a>');
    var fb = t.facebook || t['contact:facebook'], ig = t.instagram || t['contact:instagram'];
    if (fb || ig) facts += fact('social', 'Social', [
      fb ? '<a href="' + esc(social(fb, 'https://www.facebook.com/')) + '" target="_blank" rel="noopener">Facebook</a>' : '',
      ig ? '<a href="' + esc(social(ig, 'https://www.instagram.com/')) + '" target="_blank" rel="noopener">Instagram</a>' : ''
    ].filter(Boolean).join(' · '));
    var md = media && media[p.id];
    if (t.description) facts += fact('info', 'About', esc(t.description));
    else if (md && md.ds) facts += fact('info', 'About', esc(md.ds.x) + ' <a href="' + esc(md.ds.h) + '" target="_blank" rel="noopener">' + esc(md.ds.s) + '</a>');
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
    if (p.w && p.w.a) facts += fact('pin', 'Location', (t['addr:street'] ? 'Shown on ' + esc(t['addr:street']) : 'Shown at the centre of ' + esc(town(t) || 'the town')) + '. Use Google Maps for the exact spot.');
    if (p.w && p.w.by) facts += fact('check', 'Suggested through this app', p.w.by === 'owner' ? 'By the owner or staff' : 'By a visitor');
    if (p.w && p.w.v === 'team' && !(p.w.s && p.w.s.length)) {
      facts += fact('check', 'Confirmed by Dog Friendly Ireland' + (p.w.c ? ' (checked ' + esc(fmtDate(p.w.c)) + ')' : ''),
        p.w.all ? 'Our team confirmed that ' + esc(p.w.chain) + ' stores welcome dogs.' : 'Checked in person by our team.');
    }
    if (p.w && p.w.s && p.w.s.length) {
      var links = p.w.s.map(function (s) { return '<a href="' + esc(s) + '" target="_blank" rel="noopener">' + esc(host(s)) + '</a>'; }).join('<br>');
      var when = p.w.c ? ' (checked ' + esc(fmtDate(p.w.c)) + ')' : '';
      if (p.w.v === 'business') facts += fact('check', 'Confirmed by the business' + when, links);
      else if (p.w.v === 'official') facts += fact('check', 'Confirmed by the official tourism guide' + when, links);
      else if (p.w.v === 'team') facts += fact('check', 'Confirmed by Dog Friendly Ireland' + when, p.w.all ? 'Our team confirmed that ' + esc(p.w.chain) + ' stores welcome dogs.' : 'Checked in person by our team.');
      else if (p.w.v !== 'suggested') facts += fact('info', 'Not yet confirmed by the business', 'Listed as dog friendly by ' + links + '. Check before you go.');
      else facts += fact('info', 'Link', links);
      if (p.w.f && p.w.v !== 'unconfirmed') facts += fact('info', 'First listed by', '<a href="' + esc(p.w.f) + '" target="_blank" rel="noopener">' + esc(host(p.w.f)) + '</a>');
    }
    if (facts) h += '<dl class="facts">' + facts + '</dl>';

    var webOnly = p.w && 'a' in p.w && !/^[nwr]\d/.test(p.id);
    var ownerMove = owner.token ? '<span class="owner-btns"><button class="btn ghost" type="button" id="act-move">Move this marker</button>' +
      '<button class="btn ghost danger" type="button" id="act-delete">Delete this place</button></span>' : '';
    h += '<p class="fix">' + (t.check_date ? 'Details last checked ' + esc(fmtDate(t.check_date)) + '. ' : '') +
      (webOnly ? 'Something wrong or out of date? <a href="' + esc(reportUrl(p)) + '" target="_blank" rel="noopener">Report it</a>, or <a href="' + esc(osmUrl(p)) + '" target="_blank" rel="noopener">add it to OpenStreetMap</a>.'
               : 'Something wrong or missing? <a href="' + esc(osmUrl(p)) + '" target="_blank" rel="noopener">Fix this on OpenStreetMap</a>.') + ownerMove + '</p>';
    return h + '</div>';
  }

  function openPlace(id, quiet) {
    var p = state.byId[id] || state.saved[id];
    if (!p) {
      if (!state.places.length) { state.sheetId = id; return; }   // places still loading: open it once they arrive
      state.sheetId = null;
      if (!quiet) toast('That place is no longer listed');
      return;
    }
    state.sheetId = id;
    loadMedia();
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
  function whereAmI(done, fail) {
    if (!navigator.geolocation) { fail('Location is not available on this device'); return; }
    var b = $('locate'); b.classList.add('busy');
    navigator.geolocation.getCurrentPosition(function (pos) {
      b.classList.remove('busy');
      state.user = [pos.coords.latitude, pos.coords.longitude];
      if (map) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker(state.user, { radius: 8, weight: 3, color: '#ffffff', fillColor: '#1c7cd6', fillOpacity: 1 }).addTo(map);
      }
      done();
    }, function (err) {
      b.classList.remove('busy');
      fail(err.code === 1 ? 'Allow location access in your browser settings to see places near you' : 'Could not find your location. Try again outside.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  function locate() {
    whereAmI(function () {
      if (map) map.setView(state.user, 14);
      if (state.view === 'list') renderList();
    }, toast);
  }

  // ---------- route preview (OpenStreetMap routing by FOSSGIS: free, at most one request a second) ----------
  var trip = null, routeLine = null, lastRouteAt = 0;
  var MODES = { foot: 'Walk', bike: 'Cycle', car: 'Drive' };
  function fmtTime(s) {
    var m = Math.max(1, Math.round(s / 60));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? m % 60 + ' min' : '');
  }
  function startRoute(id) {
    var p = state.byId[id] || state.saved[id]; if (!p) return;
    trip = { p: p, mode: recall('dfi-mode', 'foot') };
    location.hash = 'map';
    showRoute();
    if (state.user) getRoute();
    else {
      $('route-info').textContent = 'Finding your location…';
      whereAmI(getRoute, function (msg) { $('route-info').textContent = msg + '. You can still start navigation below.'; });
    }
  }
  function showRoute() {
    var p = trip.p, r = $('route');
    r.hidden = false;
    $('route-to').textContent = p.n;
    $('route-go').href = directionsUrl(p, trip.mode);
    r.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mode === trip.mode); });
    $('route-approx').hidden = !(p.w && p.w.a);
    $('app').classList.add('routing');
  }
  function getRoute() {
    if (!trip || !state.user || !map) return;
    var p = trip.p, mode = trip.mode, info = $('route-info');
    var wait = 1100 - (Date.now() - lastRouteAt);
    if (wait > 0) { setTimeout(getRoute, wait); return; }
    lastRouteAt = Date.now();
    info.textContent = 'Working out the route…';
    var u = 'https://routing.openstreetmap.de/routed-' + mode + '/route/v1/driving/' +
      state.user[1].toFixed(6) + ',' + state.user[0].toFixed(6) + ';' + p.lo.toFixed(6) + ',' + p.la.toFixed(6) + '?overview=full&geometries=geojson';
    fetch(u).then(function (r) { return r.json(); }).then(function (j) {
      if (!trip || trip.p !== p || trip.mode !== mode) return;
      var rt = j.routes && j.routes[0];
      if (!rt) throw new Error(j.code || 'no route');
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.geoJSON(rt.geometry, { interactive: false, style: { color: '#1c7cd6', weight: 6, opacity: .85, lineCap: 'round' } }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [40, 40], paddingBottomRight: [40, $('route').offsetHeight + 30] });
      info.innerHTML = '<strong>' + fmtTime(rt.duration) + '</strong> · ' + fmtKm(rt.distance / 1000) + ' ' + MODES[mode].toLowerCase().replace('walk', 'on foot').replace('cycle', 'by bike').replace('drive', 'by car');
    }).catch(function () {
      if (trip && trip.p === p) info.textContent = 'Could not get a route right now. You can still start navigation below.';
    });
  }
  function endRoute() {
    trip = null;
    $('route').hidden = true;
    $('app').classList.remove('routing');
    if (routeLine && map) { map.removeLayer(routeLine); routeLine = null; }
  }

  // ---------- owner tools: move markers (saved to data/moves.csv in the GitHub repository) ----------
  var REPO = 'BlackLabs1/Dog-Friendly-Ireland', MOVES = 'data/moves.csv';
  var owner = { token: recall('dfi-owner-token', ''), show: false };
  var moving = null, movePin = null;
  function gh(path, opts) {
    opts = opts || {};
    return fetch('https://api.github.com/repos/' + REPO + path, {
      method: opts.method || 'GET', cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + owner.token, Accept: 'application/vnd.github+json' },
        opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }
  function ownerUi() {
    var on = !!owner.token;
    $('owner-token-row').hidden = on; $('owner-connect').hidden = on; $('owner-disconnect').hidden = !on;
    $('owner-status').textContent = on ? 'This device can move map markers. Open any place and tap "Move this marker".'
      : 'Connect this device to the app\'s GitHub repository to move map markers. Only someone with your GitHub key can do this.';
  }
  function initOwner() {
    ownerUi();
    $('owner-connect').addEventListener('click', function () {
      var key = $('owner-token').value.trim();
      if (!key) { toast('Paste your GitHub key first'); return; }
      owner.token = key;
      var b = $('owner-connect'); b.disabled = true; b.textContent = 'Checking…';
      gh('').then(function (r) { return r.ok ? r.json() : null; }).then(function (repo) {
        if (!repo || !repo.permissions || !repo.permissions.push) throw new Error('no access');
        store('dfi-owner-token', key); $('owner-token').value = ''; ownerUi(); toast('Connected. You can now move markers.');
      }).catch(function () { owner.token = ''; toast('That key can\'t change the repository. Check it and try again.'); })
        .then(function () { b.disabled = false; b.textContent = 'Connect'; });
    });
    $('owner-disconnect').addEventListener('click', function () {
      owner.token = ''; try { localStorage.removeItem('dfi-owner-token'); } catch (e) {}
      ownerUi(); toast('Disconnected');
    });
    $('move-cancel').addEventListener('click', endMove);
    $('move-here').addEventListener('click', function () {
      whereAmI(function () { if (movePin) { movePin.setLatLng(state.user); map.setView(state.user, Math.max(map.getZoom(), 18)); } }, toast);
    });
    $('move-save').addEventListener('click', saveMove);
  }
  function startMove(id) {
    var p = state.byId[id]; if (!p || !map) return;
    moving = p;
    location.hash = 'map';
    $('move-name').textContent = p.n; $('move').hidden = false; $('app').classList.add('routing');
    $('move-info').textContent = 'Drag the pin to the right spot, or tap "Use my location" if you\'re there now.';
    var icon = L.divIcon({ className: 'move-pin', iconSize: [34, 46], iconAnchor: [17, 44],
      html: '<svg viewBox="0 0 34 46"><path d="M17 45S2 27 2 17a15 15 0 0 1 30 0c0 10-15 28-15 28z" fill="#d6336c" stroke="#fff" stroke-width="3"/><circle cx="17" cy="17" r="5" fill="#fff"/></svg>' });
    movePin = L.marker([p.la, p.lo], { draggable: true, icon: icon, zIndexOffset: 1000, autoPan: true }).addTo(map);
    map.setView([p.la, p.lo], Math.max(map.getZoom(), 18));
  }
  function endMove() {
    moving = null; $('move').hidden = true; $('app').classList.remove('routing');
    if (movePin && map) { map.removeLayer(movePin); movePin = null; }
  }
  // Adds one line to a file in the repository (saving triggers the quick update, live in about a minute)
  function appendToRepo(file, line, message) {
    function attempt(tries) {
      return gh('/contents/' + file).then(function (r) {
        if (!r.ok) throw new Error('read ' + r.status);
        return r.json();
      }).then(function (f) {
        var text = decodeURIComponent(escape(atob(f.content.replace(/\n/g, ''))));
        if (!/\n$/.test(text)) text += '\n';
        text += line + '\n';
        return gh('/contents/' + file, { method: 'PUT', body: { message: message, sha: f.sha, content: btoa(unescape(encodeURIComponent(text))) } });
      }).then(function (r) {
        if (r.status === 409 && tries > 0) return attempt(tries - 1);   // saved by another device at the same moment
        if (!r.ok) throw new Error('save ' + r.status);
      });
    }
    return attempt(2);
  }
  function saveError(err) {
    toast(/401|403/.test(err.message) ? 'Your GitHub key has expired or lost access. Reconnect it in About.' : 'Couldn\'t save. Check your connection and try again.');
  }
  function deletePlace(id) {
    var p = state.byId[id]; if (!p || !owner.token) return;
    if (!window.confirm('Delete "' + p.n + '" from the app?\n\nIt will disappear for everyone in about a minute. You can bring it back later by removing its line from data/removed.txt on GitHub.')) return;
    var b = $('act-delete'); if (b) { b.disabled = true; b.textContent = 'Deleting…'; }
    var line = p.id + '  ' + p.n.replace(/\s+/g, ' ') + ' (removed in the app, ' + new Date().toISOString().slice(0, 10) + ')';
    appendToRepo('data/removed.txt', line, 'Remove ' + p.n + ' from the app').then(function () {
      state.places = state.places.filter(function (x) { return x.id !== id; });
      delete state.byId[id];
      if (state.meta) { state.meta.places = state.places; idb.set('ireland', state.meta); }
      closeToView(); refresh(); renderChips();
      toast('Deleted. Everyone will stop seeing it in about a minute.');
    }).catch(function (err) {
      saveError(err); if (b) { b.disabled = false; b.textContent = 'Delete this place'; }
    });
  }
  function showOnMap(id) {
    location.hash = 'map';
    setTimeout(function () { location.hash = 'place-' + id; }, 0);
  }
  function saveMove() {
    if (!moving || !movePin) return;
    var p = moving, ll = movePin.getLatLng(), la = Math.round(ll.lat * 1e6) / 1e6, lo = Math.round(ll.lng * 1e6) / 1e6;
    var b = $('move-save'); b.disabled = true; b.textContent = 'Saving…';
    var line = [p.id, la, lo, '"' + p.n.replace(/"/g, '""') + '"', new Date().toISOString().slice(0, 10)].join(',');
    appendToRepo(MOVES, line, 'Move ' + p.n + ' on the map').then(function () {
      p.la = la; p.lo = lo; if (p.w) p.w.a = 0;
      if (state.meta) { idb.set('ireland', state.meta); }
      drawMarkers(filtered());
      toast('Saved. Everyone will see the new position in about a minute.');
      endMove();
    }).catch(saveError).then(function () { b.disabled = false; b.textContent = 'Save position'; });
  }

  // ---------- routing ----------
  function route() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('place-') === 0) { openPlace(h.slice(6)); return; }
    closePlace();
    if (h === 'owner') { owner.show = true; h = 'about'; }
    $('owner-tools').hidden = !(owner.show || owner.token);
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
      if (e.target.closest('#act-route')) { startRoute(state.sheetId); return; }
      if (e.target.closest('#act-move')) { startMove(state.sheetId); return; }
      var md = e.target.closest('[data-mode]');
      if (md && trip) { trip.mode = md.dataset.mode; store('dfi-mode', trip.mode); showRoute(); getRoute(); return; }
      if (e.target.closest('#route-close')) { endRoute(); return; }
      if (e.target.closest('#act-share')) { share(state.sheetId); return; }
      if (e.target.closest('#act-osm')) { showOnMap(state.sheetId); return; }
      if (e.target.closest('#act-delete')) { deletePlace(state.sheetId); return; }
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
      ['s-name', 's-address', 's-county', 's-type'].forEach(function (id) {
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
      if (!bad && photoData && !$('s-photo-ok').checked) bad = $('s-photo-ok');
      if (bad) {
        err.textContent = bad.id === 's-photo-ok' ? 'Please confirm you can share the photo, or remove it.' : bad.id === 's-link' ? 'That link doesn\'t look right. Paste the full web address, or leave it empty.'
          : bad.name === 'dogs' ? 'Choose where dogs are allowed, or pick "Not sure".' : 'Please fill in the fields marked *.';
        err.hidden = false; bad.focus(); return;
      }
      var address = $('s-address').value.trim();
      var parts = address.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var values = {
        name: $('s-name').value.trim(), address: address, town: parts[parts.length - 1] || address, county: $('s-county').value,
        postcode: $('s-postcode').value.trim().toUpperCase(), type: $('s-type').value, dogs: dogs.value, link: link,
        notes: $('s-notes').value.trim(), owner: $('s-owner').checked, website: $('s-website').value,
        photo: photoData || '', photoOk: !!(photoData && $('s-photo-ok').checked)
      };
      var btn = $('s-submit');
      var done = function () {
        $('sent-name').textContent = values.name;
        f.hidden = true; $('suggest-sent').hidden = false; f.reset(); clearPhoto();
        f.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
        $('view-suggest').scrollTop = 0;
      };
      var failed = function () { err.textContent = 'Couldn\'t send. Check your connection and try again.'; err.hidden = false; };
      var reset = function () { btn.disabled = false; btn.textContent = 'Send suggestion'; };
      var endpoint = (window.DFI_CONFIG || {}).suggestEndpoint;
      if (endpoint) {
        btn.disabled = true; btn.textContent = photoData ? 'Sending photo…' : 'Sending…';
        // Google Apps Script doesn't let the page read its reply, so only a network error can be seen here
        fetch(endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(values) })
          .then(done, failed).then(reset);
        return;
      }
      var cfg = (window.DFI_CONFIG || {}).suggestForm || {};
      if (!cfg.action || !cfg.fields) {
        err.textContent = 'Suggestions aren\'t switched on yet. Please try again soon.'; err.hidden = false; return;
      }
      // Older Google Form (no photo): the address goes in its "Town or area" question
      var form = { name: values.name, town: [address, values.postcode].filter(Boolean).join(', '), county: values.county, type: values.type,
        dogs: values.dogs, link: link, notes: values.notes, owner: values.owner ? 'Yes' : 'No' };
      var body = new URLSearchParams();
      Object.keys(cfg.fields).forEach(function (k) { if (form[k] != null) body.append(cfg.fields[k], form[k]); });
      btn.disabled = true; btn.textContent = 'Sending…';
      fetch(cfg.action, { method: 'POST', mode: 'no-cors', body: body }).then(done, failed).then(reset);
    });

    // Photo: shrunk on the phone to at most 1600 pixels so it uploads quickly
    var photoData = null;
    function clearPhoto() {
      photoData = null; $('s-photo').value = '';
      $('s-photo-preview').hidden = true; $('s-photo-preview').removeAttribute('src');
      $('s-photo-label').textContent = 'Add a photo of the place';
      $('s-photo-remove').hidden = true; $('s-photo-ok-row').hidden = true; $('s-photo-ok').checked = false;
    }
    $('s-photo').addEventListener('change', function () {
      var file = this.files && this.files[0]; if (!file) return;
      if (!/^image\//.test(file.type)) { clearPhoto(); return; }
      $('s-photo-label').textContent = 'Preparing photo…';
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        photoData = c.toDataURL('image/jpeg', 0.82);
        $('s-photo-preview').src = photoData; $('s-photo-preview').hidden = false;
        $('s-photo-label').textContent = 'Change photo';
        $('s-photo-remove').hidden = false; $('s-photo-ok-row').hidden = false;
      };
      img.onerror = function () { URL.revokeObjectURL(url); clearPhoto(); $('s-photo-label').textContent = 'That photo couldn\'t be opened. Try another.'; };
      img.src = url;
    });
    $('s-photo-remove').addEventListener('click', clearPhoto);
    $('suggest-again').addEventListener('click', function () { $('suggest-sent').hidden = true; f.hidden = false; $('s-name').focus(); });
  }

  // ---------- start ----------
  function start() {
    initMap(); bind(); initSuggest(); initOwner(); route();
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
