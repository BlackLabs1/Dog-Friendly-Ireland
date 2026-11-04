// Temporary: tests which free sources of photos, reviews and contact details respond, and saves samples.
const fs = require('fs');
const UA = 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const out = 'probe-out'; fs.mkdirSync(out, { recursive: true });
const log = [];
async function get(name, url, opts = {}) {
  try {
    const r = await fetch(url, Object.assign({ headers: { 'User-Agent': UA, Origin: 'https://blacklabs1.github.io' } }, opts));
    const body = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(out + '/' + name, body);
    log.push(`${name}: ${r.status} ${body.length} bytes  acao=${r.headers.get('access-control-allow-origin')}  type=${r.headers.get('content-type')}\n  ${url}\n  ${body.slice(0, 600).toString().replace(/\n/g, '\n  ')}\n`);
  } catch (e) { log.push(`${name}: ERROR ${e.message}\n  ${url}\n`); }
}
(async () => {
  const F = 'https://failteireland.azure-api.net/opendata-api/v2/';
  for (const k of ['attractions', 'accommodation', 'activities']) {
    await get('failte-' + k + '.csv', F + k + '/csv');
    await get('failte-' + k + '.json', F + k + '?$top=3');
  }
  await get('failte-v1-accommodation.json', 'https://failteireland.azure-api.net/opendata-api/v1/accommodation?$top=3');
  const M = 'https://api.mangrove.reviews';
  await get('mangrove-reviews.json', M + '/reviews?limit=3');
  await get('mangrove-q.json', M + '/reviews?q=Dublin');
  await get('mangrove-geo.json', M + '/reviews?latitude=53.3446&longitude=-6.2763&radius=50000');
  await get('mangrove-sub.json', M + '/reviews?sub=' + encodeURIComponent('geo:53.3446,-6.2763?q=The Brazen Head&u=30'));
  await get('mangrove-geo-search.json', M + '/geo?q=Dublin');
  await get('mangrove-root.txt', M + '/');
  const C = 'https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&origin=*&';
  await get('commons-geo.json', C + 'action=query&generator=geosearch&ggscoord=53.3446|-6.2763&ggsradius=150&ggsnamespace=6&ggslimit=50&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=640');
  await get('commons-geo-park.json', C + 'action=query&generator=geosearch&ggscoord=53.2715|-6.2695&ggsradius=500&ggsnamespace=6&ggslimit=50&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640');
  const W = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
  await get('wd-search.json', W + 'action=wbsearchentities&language=en&limit=5&search=' + encodeURIComponent('Lough Eske Castle'));
  await get('wd-sparql.json', 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(
    'SELECT (COUNT(*) AS ?n) WHERE { ?i wdt:P625 ?c . ?i wdt:P17 ?country . VALUES ?country { wd:Q27 wd:Q145 } SERVICE wikibase:box { ?i wdt:P625 ?c . bd:serviceParam wikibase:cornerWest "Point(-10.7 51.3)"^^geo:wktLiteral . bd:serviceParam wikibase:cornerEast "Point(-5.3 55.5)"^^geo:wktLiteral . } }'));
  await get('tourismni.txt', 'https://www.opendatani.gov.uk/api/3/action/package_search?q=tourism&rows=20');
  fs.writeFileSync(out + '/LOG.txt', log.join('\n'));
  console.log(log.join('\n'));
})();
