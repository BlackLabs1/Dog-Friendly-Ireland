// Temporary: checks library URLs, routing service and the reviews API's query options.
const UA = 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const get = async (u, h = {}) => { const r = await fetch(u, { headers: Object.assign({ 'User-Agent': UA, Referer: 'https://blacklabs1.github.io/Dog-Friendly-Ireland/' }, h) }); return { s: r.status, h: r.headers, t: await r.text() }; };
(async () => {
  for (const u of ['https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js', 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css',
    'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js',
    'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.3/leaflet-maplibre-gl.js', 'https://tiles.openfreemap.org/styles/liberty', 'https://tiles.openfreemap.org/styles/bright', 'https://tiles.openfreemap.org/styles/positron', 'https://a.tile.opentopomap.org/7/62/41.png']) {
    try { const r = await get(u); console.log(r.s, r.t.length, 'acao=' + r.h.get('access-control-allow-origin'), u, /maplibre-gl-leaflet/.test(u) ? r.t.slice(0, 300).replace(/\n/g, ' ') : ''); } catch (e) { console.log('ERR', u, e.message); }
  }
  for (const p of ['car', 'bike', 'foot']) {
    const r = await get(`https://routing.openstreetmap.de/routed-${p}/route/v1/driving/-6.2603,53.3498;-6.2763,53.3446?overview=simplified&geometries=geojson`, { Origin: 'https://blacklabs1.github.io' });
    console.log('route', p, r.s, 'acao=' + r.h.get('access-control-allow-origin'), r.t.slice(0, 250));
  }
  const root = await get('https://api.mangrove.reviews/');
  const m = root.t.match(/__redoc_state = (\{.*?\});\s*<\/script>/s) || root.t.match(/(\{"spec".*\})/s);
  try {
    const st = JSON.parse(m[1]); const spec = st.spec.data;
    for (const [path, ops] of Object.entries(spec.paths)) for (const [verb, op] of Object.entries(ops))
      console.log(verb.toUpperCase(), path, (op.parameters || []).map(x => x.name + (x.schema && x.schema.$ref ? '(' + x.schema.$ref + ')' : '')).join(','));
    for (const [n, s] of Object.entries(spec.components.schemas)) if (/Query|Param|Review/i.test(n)) console.log('schema', n, JSON.stringify(s.properties || s).slice(0, 700));
  } catch (e) { console.log('spec parse failed', e.message, root.t.slice(root.t.indexOf('__redoc'), root.t.indexOf('__redoc') + 300)); }
})();
