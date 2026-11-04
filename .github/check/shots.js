// Temporary: screenshots of the live app to check the new map, photos and route preview.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://blacklabs1.github.io/Dog-Friendly-Ireland/';
(async () => {
  fs.mkdirSync('shots', { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    geolocation: { latitude: 54.5973, longitude: -5.9301 }, permissions: ['geolocation'] });
  const p = await ctx.newPage(); const log = [];
  p.on('pageerror', e => log.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.push('console ' + m.text().slice(0, 200)); });
  p.on('requestfailed', r => log.push('failed ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
  const shot = async n => { await p.screenshot({ path: 'shots/' + n + '.png' }); log.push('shot ' + n); };
  await p.goto(BASE + '#map', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('#loading', { state: 'hidden', timeout: 60000 }).catch(() => log.push('loading still visible'));
  await p.waitForTimeout(4000); await shot('1-map-ireland');
  log.push('maplibre loaded: ' + await p.evaluate(() => !!window.maplibregl) + ', gl canvas: ' + await p.evaluate(() => !!document.querySelector('.maplibregl-canvas, canvas.leaflet-gl-layer, .leaflet-gl-layer')));
  await p.evaluate(() => { localStorage.setItem('dfi-view', JSON.stringify({ c: [54.5973, -5.9301], z: 15 })); });
  await p.goto(BASE + '#map', { waitUntil: 'networkidle' }); await p.waitForTimeout(5000); await shot('2-map-belfast');
  await p.goto(BASE + '#place-n4381113291', { waitUntil: 'networkidle' }); await p.waitForTimeout(4000); await shot('3-place-photos');
  await p.click('#act-route'); await p.waitForTimeout(6000); await shot('4-route');
  log.push('route info: ' + await p.textContent('#route-info') + ' | go: ' + await p.getAttribute('#route-go', 'href'));
  await p.click('#route-close');
  await p.hover('.leaflet-control-layers'); await p.waitForTimeout(500);
  await p.click('text=Walking (hills and trails)').catch(e => log.push('layer click failed ' + e.message));
  await p.waitForTimeout(4000); await shot('5-walking');
  await p.goto(BASE + '#place-w352173368', { waitUntil: 'networkidle' }); await p.waitForTimeout(4000); await shot('6-place-failte');
  await ctx.close();
  const dark = await b.newContext({ viewport: { width: 400, height: 800 }, colorScheme: 'dark' });
  const d = await dark.newPage(); await d.goto(BASE + '#map', { waitUntil: 'networkidle' }); await d.waitForTimeout(5000);
  await d.screenshot({ path: 'shots/7-dark.png' });
  fs.writeFileSync('shots/log.txt', log.join('\n'));
  console.log(log.join('\n'));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
