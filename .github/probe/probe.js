// Temporary: find Casey's / Gaynor's in Wexford town on OpenStreetMap.
(async () => {
  const q = '[out:json][timeout:60];nwr["name"~"Casey|Gaynor",i](52.32,-6.50,52.36,-6.44);out center tags;';
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'DogFriendlyIreland/1.0' } });
      const j = await r.json();
      j.elements.forEach(e => console.log(e.type + e.id, e.lat || (e.center && e.center.lat), e.lon || (e.center && e.center.lon), JSON.stringify(e.tags)));
      break;
    } catch (e) { console.log('fail', url, e.message); }
  }
  const n = await (await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&q=' + encodeURIComponent("Casey's, Wexford") + '&countrycodes=ie&limit=5', { headers: { 'User-Agent': 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)' } })).json();
  n.forEach(h => console.log('nominatim', h.osm_type, h.osm_id, h.lat, h.lon, h.display_name));
})();
