const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {once} = require('node:events');

let directory, server, origin;

test.beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webdir-sharing-'));
  fs.mkdirSync(path.join(directory, 'docs/project/sub'), {recursive:true});
  fs.mkdirSync(path.join(directory, 'docs/other'), {recursive:true});
  fs.writeFileSync(path.join(directory, 'docs/project/note.md'), '# Shared document\n\nHello from the directory.\n\n![Cat](cat.svg)\n');
  fs.writeFileSync(path.join(directory, 'docs/project/cat.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>');
  fs.writeFileSync(path.join(directory, 'docs/project/sub/child.txt'), 'Child document');
  fs.writeFileSync(path.join(directory, 'docs/other/private.md'), '# Private document');
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(path.resolve('target/release/webdir'), ['-p', String(port), '--dir', directory, '--auth-token', 'share-test-secret'], {stdio:['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Share server did not start: ${output}`)), 10000);
    server.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('Serving ')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', chunk => { output += chunk; });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Share server exited (${code}): ${output}`)); });
  });
});

test.afterEach(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  if (directory) fs.rmSync(directory, {recursive:true, force:true});
});

async function login(page) {
  const response = await page.request.post(`${origin}/__webdir/auth`, {headers:{'X-Webdir-Auth-Token':'share-test-secret'}});
  expect(response.status()).toBe(204);
  await page.addInitScript(() => localStorage.setItem('webdir-review-identity', 'Owner'));
}

async function getShareUrl(page) {
  await expect(page.locator('#share-url')).not.toHaveValue('');
  await expect(page.locator('.share-description')).toContainText('/docs/project/');
  const url = await page.locator('#share-url').inputValue();
  await page.locator('[data-share-copy]').click();
  await expect(page.locator('.share-status')).toHaveText(/链接已复制|请选中上方链接手动复制/);
  return url;
}

module.exports = () => {
  test('directory sharing opens file links, nested navigation, and image previews', async ({page, browser}) => {
    await login(page);
    await page.goto(`${origin}/docs/project/?view=gallery`);
    const file = page.locator('.entry.file').filter({hasText:'note.md'});
    await file.getByRole('button', {name:'复制分享链接'}).click();
    const url = await getShareUrl(page);
    await page.screenshot({path:test.info().outputPath('share-dialog.png')});
    const recipient = await browser.newContext({viewport:page.viewportSize()});
    try {
      const shared = await recipient.newPage();
      const errors = [];
      shared.on('pageerror', error => errors.push(error.message));
      await shared.goto(url);
      await expect(shared).toHaveURL(`${origin}/docs/project/note.md`);
      await expect(shared.locator('#article')).toContainText('Shared document');
      await expect(shared.locator('#article img')).toHaveJSProperty('naturalWidth', 32);
      await expect(shared.locator('.file-breadcrumbs a')).toHaveCount(1);
      await expect(shared.locator('.file-breadcrumbs a')).toHaveAttribute('href', '/docs/project/');
      await expect(shared.getByRole('button', {name:'复制分享链接'})).toHaveCount(0);
      await shared.locator('.file-breadcrumbs a').click();
      await expect(shared.locator('.breadcrumbs a')).toHaveCount(1);
      await shared.locator('.folder-open').filter({hasText:'sub'}).click();
      await shared.locator('.entry.file').filter({hasText:'child.txt'}).click();
      await expect(shared.locator('body')).toContainText('Child document');
      for (const target of ['/docs/', '/docs/other/private.md']) {
        expect((await recipient.request.get(`${origin}${target}`)).status()).toBe(403);
      }
      expect((await recipient.request.post(`${origin}/docs/project/?mode=share`)).status()).toBe(403);
      expect(errors).toEqual([]);
    } finally { await recipient.close(); }
    await page.locator('[data-share-close]').click();
    await page.locator('main > header').getByRole('button', {name:'复制分享链接'}).click();
    expect(await getShareUrl(page)).toContain('/docs/project/?share=');
    await page.locator('[data-share-close]').click();
    await page.locator('#gallery-toggle').click();
    const image = page.locator('.entry.image');
    await image.getByRole('button', {name:'复制分享链接'}).click();
    expect(await getShareUrl(page)).toContain('/docs/project/cat.svg?share=');
    await page.locator('[data-share-close]').click();
    await page.locator('#gallery-toggle').click();
    await image.locator('.glyph').click();
    await expect(page.locator('#image-lightbox')).toBeVisible();
  });

  test('shared Markdown edits and comments synchronize with the owner', async ({page, browser}) => {
    await login(page);
    await page.goto(`${origin}/docs/project/note.md`);
    await page.getByRole('button', {name:'复制分享链接'}).click();
    const url = await getShareUrl(page);
    await page.locator('[data-share-close]').click();
    const recipient = await browser.newContext({viewport:page.viewportSize()});
    try {
      await recipient.addInitScript(() => localStorage.setItem('webdir-review-identity', 'Guest'));
      const shared = await recipient.newPage();
      const errors = [];
      shared.on('pageerror', error => errors.push(error.message));
      await shared.goto(url);
      await page.locator('#edit-button').click();
      await shared.locator('#edit-button').click();
      await expect(page.locator('#source')).toBeEnabled();
      await expect(shared.locator('#source')).toBeEnabled();
      await shared.locator('#source').fill('# Shared revision\n\nEdited by guest.\n');
      await expect(page.locator('#source')).toHaveValue('# Shared revision\n\nEdited by guest.\n');
      await expect.poll(() => fs.readFileSync(path.join(directory, 'docs/project/note.md'), 'utf8')).toContain('Edited by guest.');
      await Promise.all([shared.waitForEvent('load'), shared.locator('#cancel-button').click()]);
      await Promise.all([page.waitForEvent('load'), page.locator('#cancel-button').click()]);
      await shared.locator('#review-toggle').click();
      await shared.locator('#document-comment').click();
      await shared.locator('#comment-body').fill('Guest review');
      await shared.locator('#comment-body').press('Enter');
      await expect(shared.locator('.comment-card .message p')).toHaveText('Guest review');
      await page.locator('#review-toggle').click();
      await expect(page.locator('.comment-card .message p')).toHaveText('Guest review');
      await expect.poll(() => fs.readFileSync(path.join(directory, 'docs/project/note.md.review.json'), 'utf8')).toContain('Guest review');
      expect((await recipient.request.get(`${origin}/docs/project/note.md.review.json?mode=raw`)).status()).toBe(200);
      expect(errors).toEqual([]);
    } finally { await recipient.close(); }
  });
};
