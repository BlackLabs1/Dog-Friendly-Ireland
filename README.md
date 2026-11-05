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

## Researched places
`data/web-places.csv` lists dog-friendly places found in public guides, tourism-board pages and business websites,
one row each with its source. Columns: `name, category, town, county, policy, source, note`.
- category: cafe, pub, food, stay, shop, outdoors, attraction, petshop, care, dogpark, rescue, vet, health
- policy: yes (inside), outside, leashed, unleashed, friendly (listed as dog friendly, details not given)

Each night the build pins new rows on the map (using OpenStreetMap's search; results cached in
`data/geocode-cache.json`), merges duplicates, and republishes.

## Suggest a place
The app's Suggest tab sends suggestions to a Google Form you own. Nothing appears in the app until you approve it.
1. Create a Google Form with these questions, all **Short answer** except the notes (**Paragraph**):
   Name of the place · Town or area · County · Type of place · Where are dogs allowed? ·
   Website, Facebook or Instagram link · Anything dog owners should know? · I own or work here
2. ⋮ menu → **Get pre-filled link**, type 1, 2, 3 … 8 into the questions in order, **Get link**, copy it.
   These numbers let the app fill the right boxes; `js/config.js` holds the result.
3. **Responses** tab → **Link to Sheets**. In the new sheet, add a column headed **Approved**.
4. Sheet: **File → Share → Publish to web** → choose the responses tab and **Comma-separated values (.csv)** → Publish.
   Put that link in `scripts/suggestions-url.txt`.
5. To approve a suggestion, type **yes** in its Approved cell. It appears in the app after the next nightly update.

## Moving map markers (owner only)
Open the app at `#owner` (for example https://blacklabs1.github.io/Dog-Friendly-Ireland/#owner), paste a GitHub
fine-grained personal access token that can write *Contents* of this repository only, and tap **Connect**.
Each place then shows **Move this marker**: drag the pin (or use your current location) and tap **Save position**.
The move is saved to `data/moves.csv` and published by the quick update in about a minute.
The token is kept only on that device and sent only to GitHub.
