# Dog Friendly Ireland

An installable Android web app listing dog-friendly places across the island of Ireland:
cafés, pubs, restaurants, places to stay, shops and shopping centres, parks and beaches,
attractions, hospitals and care homes, plus dog services (vets, pet shops, groomers,
dog parks, kennels, daycare, trainers, rescues).

- **Data:** OpenStreetMap (free, no account). Places tagged `dog=yes / leashed / outside / unleashed`,
  plus every vet, pet shop, groomer, dog park, kennel, trainer and rescue.
- **Extra detail:** every place has a button that opens it in the Google Maps app
  (photos, reviews, live hours). No Google API key or billing needed.
- **Offline:** after the first load, places and saved places work without a connection.
  Map imagery needs a connection.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | The app |
| `js/places.js` | Shared rules: which places to fetch, categories, dog policy labels |
| `manifest.webmanifest`, `sw.js`, `icons/` | Makes it installable on Android and work offline |
| `scripts/build-data.js` | Downloads all Irish places into `data/ireland.json` |
| `.github/workflows/update-data.yml` | Runs that download every night and republishes the app |

If `data/ireland.json` doesn't exist yet, the app fetches places live from OpenStreetMap on the phone
(about a minute the first time), then keeps a copy.

## Put it online

### Option A: GitHub Pages (free, updates itself nightly) — recommended
1. Create a free GitHub account and a new public repository, e.g. `dog-friendly-ireland`.
2. Upload all of these files (keep the folders).
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Update places and publish → Run workflow.** After a few minutes the app is live at
   `https://<your-username>.github.io/dog-friendly-ireland/`.

### Option B: Netlify Drop (quickest test)
Drag this folder onto <https://app.netlify.com/drop>. You get a live link in seconds.
Places are fetched live on the phone the first time.

## Install on Android
Open the link in Chrome → menu (⋮) → **Add to Home screen** / **Install app**.

## Publish on Google Play (later)
Wrap the live site as a Trusted Web Activity with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
or [PWABuilder](https://www.pwabuilder.com/) (paste the site link, download the Android package).
A Google Play developer account is a one-off fee.

Before a public launch, switch map imagery from `tile.openstreetmap.org` (fine for testing, but
OpenStreetMap's tile servers aren't meant for heavy app traffic) to a provider with a free tier such as
MapTiler or Stadia Maps: change the tile URL in `initMap()` in `js/app.js`.

## Adding places
Edit OpenStreetMap (phone apps: Every Door, StreetComplete). Tag a place `dog=yes`, `dog=outside`
or `dog=leashed`. It appears in the app after the next nightly update.

Map data © OpenStreetMap contributors, ODbL.
