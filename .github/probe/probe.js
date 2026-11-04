// Temporary: inspects Mangrove reviews and Wikidata nearby search.
const UA = 'DogFriendlyIreland/1.0 (https://github.com/BlackLabs1/Dog-Friendly-Ireland)';
const j = async u => (await fetch(u, { headers: { 'User-Agent': UA } })).json();
const dec = jwt => { try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')); } catch (e) { return null; } };
(async () => {
  for (const r of [500, 50000, 300000]) {
    const d = await j('https://api.mangrove.reviews/reviews?latitude=53.4&longitude=-7.7&radius=' + r);
    const subs = d.reviews.map(x => (dec(x.jwt) || x.payload || {}).sub);
    console.log('radius', r, 'reviews', d.reviews.length, 'keys', Object.keys(d.reviews[0] || {}));
    const ie = subs.filter(s => /^geo:/.test(s || '')).filter(s => { const m = s.match(/geo:([-\d.]+),([-\d.]+)/); return m && +m[1] > 51.3 && +m[1] < 55.5 && +m[2] > -10.7 && +m[2] < -5.3; });
    console.log('  in Ireland:', ie.length, ie.slice(0, 15));
    if (r === 500) console.log('  sample', JSON.stringify(d.reviews[0]).slice(0, 1500), '\n  decoded', JSON.stringify(dec(d.reviews[0].jwt)).slice(0, 800));
  }
  const s = await j('https://api.mangrove.reviews/subjects?q=Dublin').catch(e => ({ err: e.message }));
  console.log('subjects', JSON.stringify(s).slice(0, 500));
  const wd = await j('https://www.wikidata.org/w/api.php?format=json&action=query&list=geosearch&gscoord=54.6948|-8.0536&gsradius=500&gslimit=20');
  console.log('wikidata geosearch Lough Eske', JSON.stringify(wd).slice(0, 1200));
  const e = await j('https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&ids=Q111411825&props=labels|descriptions|claims|sitelinks&languages=en');
  const c = e.entities.Q111411825.claims;
  console.log('Lough Eske claims', Object.keys(c).join(' '), 'P18', JSON.stringify(c.P18 && c.P18[0].mainsnak.datavalue), 'P154', JSON.stringify(c.P154 && c.P154[0].mainsnak.datavalue), 'P625', JSON.stringify(c.P625 && c.P625[0].mainsnak.datavalue.value));
})();
