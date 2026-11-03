/* Shared place logic: used by the app in the browser and by the nightly data build in Node. */
(function (root) {
  'use strict';

  // The island of Ireland: Republic of Ireland + Northern Ireland.
  // Places that are dog services by nature, plus anything tagged with a dog policy (paths and roads excluded).
  var OVERPASS_QUERY = [
    '[out:json][timeout:180];',
    'area["ISO3166-1"="IE"][admin_level=2]->.ie;',
    'area["ISO3166-2"="GB-NIR"]->.ni;',
    '(.ie;.ni;)->.a;',
    '(',
    '  nwr["dog"~"^(yes|leashed|outside|unleashed|designated)$"][!highway][!barrier][!route](area.a);',
    '  nwr["leisure"="dog_park"](area.a);',
    '  nwr["amenity"~"^(veterinary|animal_boarding|animal_shelter|animal_training)$"](area.a);',
    '  nwr["shop"~"^(pet|pet_grooming)$"](area.a);',
    ');',
    'out center tags qt;'
  ].join('\n');

  var OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  var CATEGORIES = [
    { id: 'dogpark',    label: 'Dog parks',                     short: 'Dog park',        color: '#2b8a3e' },
    { id: 'vet',        label: 'Vets',                          short: 'Vet',             color: '#e03131' },
    { id: 'petshop',    label: 'Pet shops & groomers',          short: 'Pet shop',        color: '#e67700' },
    { id: 'care',       label: 'Boarding, daycare & training',  short: 'Dog care',        color: '#7048e8' },
    { id: 'rescue',     label: 'Rescues & shelters',            short: 'Rescue',          color: '#c2255c' },
    { id: 'cafe',       label: 'Cafés',                         short: 'Café',            color: '#8d5524' },
    { id: 'pub',        label: 'Pubs & bars',                   short: 'Pub',             color: '#1971c2' },
    { id: 'food',       label: 'Restaurants & takeaways',       short: 'Restaurant',      color: '#0b8f73' },
    { id: 'stay',       label: 'Places to stay',                short: 'Accommodation',   color: '#364fc7' },
    { id: 'outdoors',   label: 'Parks, beaches & walks',        short: 'Outdoors',        color: '#7c8f12' },
    { id: 'attraction', label: 'Attractions & days out',        short: 'Attraction',      color: '#d9480f' },
    { id: 'shop',       label: 'Shops & shopping centres',      short: 'Shop',            color: '#d6336c' },
    { id: 'health',     label: 'Hospitals, care homes & health',short: 'Health & care',   color: '#1098ad' },
    { id: 'other',      label: 'Other places',                  short: 'Other',           color: '#6c7a75' }
  ];

  var CAT_BY_ID = {};
  CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  var SERVICE_CATS = { dogpark: 1, vet: 1, petshop: 1, care: 1, rescue: 1 };

  // Tags kept per place. Everything else is dropped to keep the data file small.
  var KEEP = [
    'addr:housenumber', 'addr:housename', 'addr:street', 'addr:place', 'addr:suburb', 'addr:city', 'addr:town',
    'addr:village', 'addr:county', 'addr:postcode',
    'opening_hours', 'phone', 'contact:phone', 'mobile', 'contact:mobile', 'email', 'contact:email',
    'website', 'contact:website', 'url', 'facebook', 'contact:facebook', 'instagram', 'contact:instagram',
    'description', 'cuisine', 'outdoor_seating', 'wheelchair', 'operator', 'brand', 'check_date',
    'dog', 'dog:conditional', 'dog:note', 'dog:description', 'image', 'wikimedia_commons', 'wikidata',
    'amenity', 'shop', 'tourism', 'leisure', 'natural', 'historic', 'stars', 'takeaway', 'fee',
    'internet_access', 'level', 'healthcare', 'social_facility', 'veterinary', 'emergency'
  ];

  function categorise(t) {
    var a = t.amenity, s = t.shop, tr = t.tourism, l = t.leisure;
    if (l === 'dog_park') return 'dogpark';
    if (a === 'veterinary') return 'vet';
    if (s === 'pet' || s === 'pet_grooming') return 'petshop';
    if (a === 'animal_boarding' || a === 'animal_training') return 'care';
    if (a === 'animal_shelter') return 'rescue';
    if (a === 'cafe' || a === 'ice_cream') return 'cafe';
    if (a === 'pub' || a === 'bar' || a === 'biergarten') return 'pub';
    if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return 'food';
    if (/^(hotel|guest_house|hostel|motel|camp_site|caravan_site|chalet|apartment|alpine_hut|wilderness_hut)$/.test(tr || '')) return 'stay';
    if (/^(hospital|clinic|doctors|nursing_home|social_facility|pharmacy|dentist)$/.test(a || '') || t.healthcare) return 'health';
    if (/^(park|nature_reserve|garden|common|playground|recreation_ground|beach_resort)$/.test(l || '') ||
        /^(beach|wood|heath)$/.test(t.natural || '') || /^(picnic_site|viewpoint)$/.test(tr || '')) return 'outdoors';
    if (/^(attraction|museum|gallery|zoo|theme_park|aquarium)$/.test(tr || '') || t.historic ||
        /^(arts_centre|theatre|cinema|library|marketplace)$/.test(a || '')) return 'attraction';
    if (s) return 'shop';
    return 'other';
  }

  var KIND_LABELS = {
    cafe: 'Café', ice_cream: 'Ice cream', pub: 'Pub', bar: 'Bar', biergarten: 'Beer garden', restaurant: 'Restaurant',
    fast_food: 'Takeaway', food_court: 'Food court', hotel: 'Hotel', guest_house: 'B&B / guest house', hostel: 'Hostel',
    motel: 'Motel', camp_site: 'Campsite', caravan_site: 'Caravan park', chalet: 'Holiday cottage', apartment: 'Holiday apartment',
    hospital: 'Hospital', clinic: 'Clinic', doctors: 'GP surgery', nursing_home: 'Nursing home', social_facility: 'Care facility',
    pharmacy: 'Pharmacy', park: 'Park', nature_reserve: 'Nature reserve', garden: 'Garden', beach: 'Beach', picnic_site: 'Picnic area',
    viewpoint: 'Viewpoint', attraction: 'Attraction', museum: 'Museum', gallery: 'Gallery', zoo: 'Zoo', mall: 'Shopping centre',
    supermarket: 'Supermarket', garden_centre: 'Garden centre', hardware: 'Hardware shop', doityourself: 'DIY store',
    clothes: 'Clothes shop', books: 'Bookshop', pet: 'Pet shop', pet_grooming: 'Dog groomer', veterinary: 'Vet',
    animal_boarding: 'Kennels / boarding', animal_training: 'Dog training', animal_shelter: 'Rescue / shelter',
    dog_park: 'Dog park', bakery: 'Bakery', convenience: 'Convenience shop', outdoor: 'Outdoor shop', farm: 'Farm shop'
  };

  function kindLabel(t, cat) {
    var k = t.amenity || t.shop || t.tourism || t.leisure || t.natural;
    if (k && KIND_LABELS[k]) return KIND_LABELS[k];
    if (k && k !== 'yes') return k.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
    return CAT_BY_ID[cat].short;
  }

  // Dog policy, from OSM's dog=* tag. Dog services count as welcoming even without the tag.
  var POLICIES = {
    yes:        { label: 'Dogs welcome',         note: 'Dogs are allowed here.', rank: 3 },
    unleashed:  { label: 'Dogs welcome off lead',note: 'Dogs are allowed here, including off the lead.', rank: 3 },
    designated: { label: 'Dogs welcome',         note: 'This place is set up for dogs.', rank: 3 },
    leashed:    { label: 'Dogs on a lead',       note: 'Dogs are allowed if kept on a lead.', rank: 2 },
    outside:    { label: 'Dogs outside only',    note: 'Dogs are allowed outside, for example in a beer garden or on a terrace, but not indoors.', rank: 1 },
    service:    { label: 'Dog service',          note: 'A service for dogs and their owners.', rank: 3 }
  };

  function policyOf(t, cat) {
    var d = t.dog;
    if (d && POLICIES[d]) return d;
    if (SERVICE_CATS[cat]) return 'service';
    return 'yes';
  }

  function fallbackName(t, cat) {
    return kindLabel(t, cat);
  }

  // Overpass element -> compact record: { id, la, lo, n, c, d, k, t }
  function compact(el) {
    var t = el.tags || {};
    var la = el.lat != null ? el.lat : (el.center && el.center.lat);
    var lo = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (la == null || lo == null) return null;
    var cat = categorise(t);
    var kept = {};
    KEEP.forEach(function (k) { if (t[k]) kept[k] = t[k]; });
    var name = t.name || t['name:en'] || t.brand || '';
    return {
      id: el.type.charAt(0) + el.id,
      la: Math.round(la * 1e6) / 1e6,
      lo: Math.round(lo * 1e6) / 1e6,
      n: name || fallbackName(t, cat),
      u: name ? 0 : 1,
      c: cat,
      d: policyOf(t, cat),
      k: kindLabel(t, cat),
      t: kept
    };
  }

  function fromOverpass(json) {
    var out = [], seen = {};
    (json.elements || []).forEach(function (el) {
      var r = compact(el);
      if (r && !seen[r.id]) { seen[r.id] = 1; out.push(r); }
    });
    return out;
  }

  var api = {
    OVERPASS_QUERY: OVERPASS_QUERY,
    OVERPASS_ENDPOINTS: OVERPASS_ENDPOINTS,
    CATEGORIES: CATEGORIES,
    CAT_BY_ID: CAT_BY_ID,
    POLICIES: POLICIES,
    SERVICE_CATS: SERVICE_CATS,
    categorise: categorise,
    compact: compact,
    fromOverpass: fromOverpass
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DFPlaces = api;
})(this);
