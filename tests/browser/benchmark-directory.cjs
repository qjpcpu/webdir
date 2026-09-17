// Run after cargo build --release. Uses temporary files and its own server.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const net = require('node:net');
const {chromium} = require('@playwright/test');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webdir-performance-'));
  let server, browser;
  try {
    for (const count of [100, 10000]) {
      const target = path.join(directory, String(count));
      fs.mkdirSync(target);
      for (let index = 0; index < count; index++) {
        fs.writeFileSync(path.join(target, `image-${String(index).padStart(5, '0')}.svg`), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="skyblue"/></svg>');
      }
    }
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    server = spawn('./target/release/webdir', ['-p', String(port), '--dir', directory], {stdio: ['ignore', 'pipe', 'inherit']});
    const [output] = await once(server.stdout, 'data');
    const origin = output.toString().match(/http:\/\/localhost:\d+/)[0];
    browser = await chromium.launch();
    for (const count of [100, 10000]) {
      const url = `${origin}/${count}/?view=gallery`;
      const started = performance.now();
      const response = await fetch(url);
      const ttfb = performance.now() - started;
      const html = await response.text();
      const page = await browser.newPage({viewport: {width: 1440, height: 900}});
      await page.addInitScript(() => {
        window.longTasks = [];
        new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(entry => Math.round(entry.duration)))).observe({type: 'longtask', buffered: true});
      });
      page.on('pageerror', error => { throw error; });
      await page.goto(url, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.entry.image'));
      const ready = await page.evaluate(() => performance.now());
      await page.waitForFunction(() => [...document.querySelectorAll('.listing img')].some(image => image.complete && image.naturalWidth));
      const result = await page.evaluate(() => ({
        firstImageMs: Math.round(performance.now()),
        dom: document.querySelectorAll('*').length,
        mountedEntries: document.querySelectorAll('.entry').length,
        longTasks: window.longTasks,
        paint: performance.getEntriesByType('paint').map(entry => ({name: entry.name, ms: Math.round(entry.startTime)}))
      }));
      console.log(JSON.stringify({count, htmlBytes: Buffer.byteLength(html), ttfbMs: Math.round(ttfb), directoryReadyMs: Math.round(ready), ...result}));
      await page.close();
    }
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    fs.rmSync(directory, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
