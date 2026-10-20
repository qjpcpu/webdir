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
  if (await page.locator('.share-status').textContent() === '链接已复制') {
    await expect(page.locator('.share-dialog')).not.toBeVisible();
  } else {
    await page.locator('[data-share-close]').click();
  }
  return url;
}

module.exports = () => {
  test('Recently pages fifty files at a time and searches older visits on the server', async ({page}) => {
    await login(page);
    fs.mkdirSync(path.join(directory, 'docs/project/设计'));
    const special = '设计/Report_100%.svg';
    const names = [special, ...Array.from({length:105}, (_, index) => `report-${String(index).padStart(3, '0')}.svg`)];
    for (const name of names) {
      fs.copyFileSync(path.join(directory, 'docs/project/cat.svg'), path.join(directory, 'docs/project', name));
      const href = name.split('/').map(encodeURIComponent).join('/');
      const response = await page.request.post(`${origin}/docs/project/${href}?mode=visit`);
      expect(response.status()).toBe(204);
    }
    await page.goto(`${origin}/?mode=recent`);
    const entries = page.locator('.listing .entry');
    await expect(entries).toHaveCount(50);
    await expect(entries.first()).toContainText('report-104.svg');
    await expect(entries.last()).toContainText('report-055.svg');
    const search = page.getByRole('searchbox', {name:'搜索最近访问'});
    const searchFor = async query => {
      await Promise.all([
        page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.searchParams.get('mode') === 'recent-entries'
            && (url.searchParams.get('q') || '') === query;
        }),
        search.fill(query)
      ]);
    };
    await searchFor('REPORT_100%');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText(special);
    await expect(page.locator('#recent-more')).toBeHidden();
    await page.reload();
    await expect(search).toHaveValue('REPORT_100%');
    await expect(entries).toHaveCount(1);

    await searchFor('report-');
    await expect(entries).toHaveCount(50);
    const more = page.getByRole('button', {name:'加载更多', exact:true});
    await more.scrollIntoViewIfNeeded();
    await expect(entries).toHaveCount(100);
    await more.scrollIntoViewIfNeeded();
    await expect(entries).toHaveCount(105);
    await expect(page.locator('#recent-more')).toBeHidden();
    await expect(page.locator('#recent-status')).toHaveText('已显示全部记录');
    const hrefs = await entries.evaluateAll(items => items.map(item => item.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(105);
    await expect(entries.last()).toContainText('report-000.svg');

    await searchFor('没有这样的文件');
    await expect(entries).toHaveCount(0);
    await expect(page.locator('.listing')).toContainText('没有匹配的访问记录');
    await searchFor('');
    await expect(entries).toHaveCount(50);
  });

  test('Recently records gallery images on opening and switching, including cached revisits', async ({page}) => {
    for (const name of ['next.svg', 'unused.svg']) {
      fs.copyFileSync(path.join(directory, 'docs/project/cat.svg'), path.join(directory, 'docs/project', name));
    }
    await login(page);
    await page.goto(`${origin}/docs/project/?view=gallery`);
    const visit = async action => {
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url().includes('mode=visit')),
        action()
      ]);
      expect(response.status()).toBe(204);
    };
    await visit(() => page.locator('.entry.image').filter({hasText:'cat.svg'}).click());
    await expect(page.locator('.lightbox-image:not(.preview-outgoing)')).toHaveAttribute('alt', 'cat.svg');
    const firstHistory = await page.request.get(`${origin}/?mode=recent`);
    const firstHtml = await firstHistory.text();
    expect(firstHtml).toContain('href="/docs/project/?view=gallery&amp;open=cat.svg"');
    expect(firstHtml).not.toContain('open=next.svg');
    expect(firstHtml).not.toContain('open=unused.svg');
    await visit(() => page.keyboard.press('ArrowRight'));
    await expect(page.locator('.lightbox-image:not(.preview-outgoing)')).toHaveAttribute('alt', 'next.svg');
    await visit(() => page.keyboard.press('ArrowLeft'));
    await expect(page.locator('.lightbox-image:not(.preview-outgoing)')).toHaveAttribute('alt', 'cat.svg');
    await page.keyboard.press('Escape');
    await expect(page.locator('#image-lightbox')).toBeHidden();
    await page.getByRole('link', {name:'最近访问', exact:true}).click();
    await expect(page).toHaveTitle('最近访问');
    await expect(page.getByRole('heading', {name:'最近访问', exact:true})).toBeVisible();
    const entries = page.locator('.listing .entry');
    await expect(entries).toHaveCount(2);
    await expect(entries.first()).toHaveAttribute('href', '/docs/project/?view=gallery&open=cat.svg');
    await expect(entries.last()).toHaveAttribute('href', '/docs/project/?view=gallery&open=next.svg');
    await visit(() => entries.last().click());
    await expect(page.locator('.listing')).toHaveClass(/gallery/);
    await expect(page.locator('#image-lightbox')).toBeVisible();
    await expect(page.locator('.lightbox-image:not(.preview-outgoing)')).toHaveAttribute('alt', 'next.svg');
    await page.keyboard.press('Escape');
    await expect(page.locator('#image-lightbox')).toBeHidden();
    await page.getByRole('link', {name:'最近访问', exact:true}).click();
    await expect(entries.first()).toHaveAttribute('href', '/docs/project/?view=gallery&open=next.svg');
    await page.goto(`${origin}/docs/project/cat.svg`);
    await page.getByRole('link', {name:'最近访问', exact:true}).click();
    await expect(entries.first()).toHaveAttribute('href', '/docs/project/cat.svg');
  });

  test('Recently orders opened documents, drops deleted files and respects sharing scope', async ({page, browser}) => {
    await login(page);
    await page.goto(`${origin}/docs/other/private.md`);
    await page.goto(`${origin}/docs/project/note.md`);
    await page.locator('.recent-link').click();
    await expect(page.locator('.listing .entry')).toHaveCount(2);
    await expect(page.locator('.listing .entry').first()).toHaveAttribute('href', '/docs/project/note.md');
    await expect(page.locator('.listing .entry').last()).toHaveAttribute('href', '/docs/other/private.md');

    const share = await page.request.post(`${origin}/docs/project/?mode=share`);
    const {url} = await share.json();
    const recipientContext = await browser.newContext({viewport:page.viewportSize()});
    try {
      const recipient = await recipientContext.newPage();
      await recipient.goto(new URL(url, origin).href);
      await recipient.locator('.recent-link').click();
      await expect(recipient.locator('.listing .entry')).toHaveCount(0);
      await expect(recipient.locator('.listing')).toContainText('还没有最近访问');
      await recipient.goto(`${origin}/docs/project/note.md`);
      await recipient.goto(`${origin}/docs/project/sub/child.txt`);
      await recipient.goto(`${origin}/docs/project/note.md`);
      await recipient.locator('.recent-link').click();
      const entries = recipient.locator('.listing .entry');
      await expect(entries).toHaveCount(2);
      await expect(entries.first()).toHaveAttribute('href', '/docs/project/note.md');
      await expect(entries.last()).toHaveAttribute('href', '/docs/project/sub/child.txt');
      await expect(recipient.locator('.listing')).not.toContainText('private.md');
      await expect(entries.first().locator('time')).toHaveAttribute('datetime', /T/);
      expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await entries.first().click();
      fs.rmSync(path.join(directory, 'docs/project/note.md'));
      await recipient.goBack();
      await expect(entries).toHaveCount(1);
      await expect(entries.first()).toHaveAttribute('href', '/docs/project/sub/child.txt');
      await entries.first().click();
      await expect(recipient.locator('.file-breadcrumbs')).toContainText('分享目录');
    } finally {
      await recipientContext.close();
    }
  });

  test('video grid separates the play label from sharing, tags and selection controls', async ({page}) => {
    fs.copyFileSync(path.join(__dirname, 'media', 'bear.mp4'), path.join(directory, 'docs/project/clip.mp4'));
    await login(page);
    await page.request.put(`${origin}/docs/project/clip.mp4?mode=image-tag`, {data:{tag:3}});
    await page.goto(`${origin}/docs/project/?view=gallery`);
    const card = page.locator('.entry.video');
    const badge = card.locator('.video-badge');
    const share = card.getByRole('button', {name:'复制分享链接'});
    await expect(badge).toBeVisible();
    await expect(share).toBeVisible();
    const separate = async (first, second) => {
      const a = await first.boundingBox(), b = await second.boundingBox();
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    };
    await separate(badge, share);
    await separate(badge, card.locator('.image-tag'));
    await share.click();
    await expect(page.locator('#share-url')).toHaveValue(/clip\.mp4\?share=/);
    await page.locator('[data-share-close]').click();
    await page.locator('#select-images').click();
    await expect(card.locator('.image-selection-indicator')).toBeVisible();
    await separate(badge, share);
    await separate(badge, card.locator('.image-selection-indicator'));
    await separate(share, card.locator('.image-selection-indicator'));
  });

  test('directory sharing opens file links, nested navigation, and image previews', async ({page, browser}) => {
    await login(page);
    await page.goto(`${origin}/docs/project/?view=gallery`);
    const file = page.locator('.entry.file').filter({hasText:'note.md'});
    await file.getByRole('button', {name:'复制分享链接'}).click();
    await page.screenshot({path:test.info().outputPath('share-dialog.png')});
    const url = await getShareUrl(page);
    const recipient = await browser.newContext({viewport:page.viewportSize()});
    try {
      const shared = await recipient.newPage();
      const errors = [];
      shared.on('pageerror', error => errors.push(error.message));
      await shared.goto(url);
      await expect(shared).toHaveURL(`${origin}/docs/project/note.md`);
      await expect(shared.locator('#article')).toContainText('Shared document');
      await expect(shared.locator('#article img')).toHaveJSProperty('naturalWidth', 32);
      await expect(shared.locator('.file-breadcrumbs a:not(.recent-link)')).toHaveCount(1);
      await expect(shared.locator('.file-breadcrumbs a:not(.recent-link)')).toHaveAttribute('href', '/docs/project/');
      await expect(shared.getByRole('button', {name:'复制分享链接'})).toHaveCount(0);
      await shared.locator('#path-search-toggle').click();
      await shared.locator('#path-search-input').fill('child');
      await expect(shared.locator('.path-search-result')).toHaveCount(1);
      await expect(shared.locator('.path-search-result')).toContainText('sub');
      await shared.locator('#path-search-input').fill('private');
      await expect(shared.locator('.path-search-result')).toHaveCount(0);
      await expect(shared.locator('#path-search-status')).toHaveText('没有找到匹配的文件或文件夹');
      await shared.locator('#path-search-input').fill(path.join(directory, 'docs/project/sub/child.txt'));
      await expect(shared.locator('.path-search-result')).toHaveCount(1);
      await expect(shared.locator('.path-search-path')).toHaveText('/sub');
      await shared.locator('#path-search-input').fill('xxx/sub/child.txt');
      await expect(shared.locator('.path-search-result')).toHaveCount(1);
      await expect(shared.locator('.path-search-result')).toHaveAttribute('href', '/docs/project/sub/child.txt');
      await shared.locator('#path-search-input').fill(path.join(directory, 'docs/other/private.md'));
      await expect(shared.locator('.path-search-result')).toHaveCount(0);
      await expect(shared.locator('#path-search-status')).toHaveText('没有找到匹配的文件或文件夹');
      await shared.locator('#path-search-input').press('Escape');
      await shared.locator('.file-breadcrumbs a:not(.recent-link)').click();
      await expect(shared.locator('.breadcrumbs a:not(.recent-link)')).toHaveCount(1);
      await shared.locator('.folder-open').filter({hasText:'sub'}).click();
      await shared.locator('.entry.file').filter({hasText:'child.txt'}).click();
      await expect(shared.locator('body')).toContainText('Child document');
      fs.rmSync(path.join(directory, 'docs/project/sub'), {recursive:true});
      await shared.locator('#path-search-toggle').click();
      await shared.locator('#path-search-input').fill('note');
      await expect(shared.locator('.path-search-result')).toHaveCount(1);
      await expect(shared.locator('.path-search-result')).toHaveAttribute('href', '/docs/project/note.md');
      await shared.locator('#path-search-input').fill('private');
      await expect(shared.locator('.path-search-result')).toHaveCount(0);
      await expect(shared.locator('#path-search-status')).toHaveText('没有找到匹配的文件或文件夹');
      for (const target of ['/docs/', '/docs/other/private.md']) {
        expect((await recipient.request.get(`${origin}${target}`)).status()).toBe(403);
      }
      expect((await recipient.request.post(`${origin}/docs/project/?mode=share`)).status()).toBe(403);
      expect(errors).toEqual([]);
    } finally { await recipient.close(); }
    await page.locator('main > header').getByRole('button', {name:'复制分享链接'}).click();
    expect(await getShareUrl(page)).toContain('/docs/project/?share=');
    await page.locator('#gallery-toggle').click();
    const image = page.locator('.entry.image');
    await image.getByRole('button', {name:'复制分享链接'}).click();
    expect(await getShareUrl(page)).toContain('/docs/project/cat.svg?share=');
    await page.locator('#gallery-toggle').click();
    await image.locator('.glyph').click();
    await expect(page.locator('#image-lightbox')).toBeVisible();
  });

  test('shared Markdown edits and comments synchronize with the owner', async ({page, browser}) => {
    await login(page);
    await page.goto(`${origin}/docs/project/note.md`);
    await page.getByRole('button', {name:'复制分享链接'}).click();
    const url = await getShareUrl(page);
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
