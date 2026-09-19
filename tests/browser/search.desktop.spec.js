const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const fixtures = fs.realpathSync(path.join(__dirname, 'fixtures'));

test('finds folders by name and path and opens them from both search controls', async ({page}) => {
  await page.goto('/');
  const input = page.locator('#file-search-input');
  const results = page.locator('.file-search-result');
  await input.fill('search-nested');
  await expect(results).toHaveCount(1);
  await expect(results.locator('.file-search-result-icon')).toHaveText('目录');
  await expect(results.locator('.file-search-result-current')).toHaveText('当前');
  await results.click();
  await expect(page).toHaveURL(/\/search-nested\/$/);

  await input.fill('caddy');
  await expect(results).toHaveCount(2);
  await expect(results.locator('.file-search-result-icon')).toHaveText(['目录', '目录']);
  for (const query of ['tiana/bootstrap/caddy/', path.join(fixtures, 'search-nested/tiana/bootstrap/cad'), path.join(fixtures, 'search-nested/tiana/bootstrap/caddy') + '/']) {
    await input.fill(query);
    await expect(results).toHaveCount(1);
    await expect(results).toHaveAttribute('href', '/search-nested/tiana/bootstrap/caddy/');
  }
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/search-nested\/tiana\/bootstrap\/caddy\/$/);

  await page.locator('#path-search-toggle').click();
  await page.locator('#path-search-input').fill('other/caddy/');
  const rootResults = page.locator('.path-search-result');
  await expect(rootResults).toHaveCount(1);
  await expect(rootResults.locator('.path-search-icon')).toHaveText('目录');
  const opened = page.waitForEvent('popup');
  await rootResults.click();
  const popup = await opened;
  await expect(popup).toHaveURL(/\/search-nested\/other\/caddy\/$/);
  await popup.close();
});

test('searches the root after the current directory is removed', async ({page}) => {
  const directory = fs.mkdtempSync(path.join(fixtures, 'removed-search-'));
  try {
    await page.goto(`/${path.basename(directory)}/`);
    await expect(page.locator('.listing')).toHaveAttribute('aria-busy', 'false');
    fs.rmdirSync(directory);
    await page.locator('#path-search-toggle').click();
    await page.locator('#path-search-input').fill('01-portrait');
    await expect(page.locator('.path-search-result')).toHaveCount(1);
    await expect(page.locator('.path-search-name')).toHaveText('01-portrait.svg');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('shows readable search errors for HTML and plain text responses', async ({page}) => {
  await page.goto('/');
  await page.locator('#path-search-toggle').click();
  for (const [contentType, body, message] of [
    ['text/html', '<!doctype html><html><body>Not Found</body></html>', '搜索失败（HTTP 404）'],
    ['text/plain', '超出分享范围\n', '超出分享范围'],
  ]) {
    await page.route(url => url.searchParams.get('mode') === 'file-search', route => route.fulfill({
      status: 404, contentType, body,
    }));
    await page.locator('#path-search-input').fill(contentType);
    await expect(page.locator('#path-search-status')).toHaveText(message);
  }
});

test('searches descendants, ranks current files first, and opens an image in its gallery', async ({page}) => {
  await page.goto('/');
  await page.locator('#file-search-input').fill('portrait');

  const results = page.locator('.file-search-result');
  await expect(results).toHaveCount(5);
  await expect(results.filter({hasText: 'hidden-portrait'})).toHaveCount(1);
  await expect(results.filter({hasText: 'portrait-secret'}).locator('.file-search-result-path'))
    .toHaveText('./search-nested/.hidden-directory');
  await expect(results.first().locator('.file-search-result-name')).toHaveText('01-portrait.svg');
  await expect(results.first().locator('.file-search-result-current')).toHaveText('当前');
  await expect(results.first().locator('.file-search-result-icon img')).toHaveAttribute(
    'src',
    '/01-portrait.svg?mode=asset'
  );
  await expect(results.filter({hasText: 'nested-portrait.svg'}).locator('.file-search-result-path'))
    .toHaveText('./search-nested');
  await expect(results.first()).not.toHaveAttribute('target', '_blank');

  await results.filter({hasText: 'nested-portrait.svg'}).click();

  await expect(page).toHaveURL(/\/search-nested\/\?view=gallery$/);
  await expect(page.locator('.listing')).toHaveClass(/gallery/);
  await expect(page.locator('#image-lightbox')).toBeVisible();
  await expect(page.locator('.lightbox-image')).toHaveAttribute('alt', 'nested-portrait.svg');
});

test('opens the selected file with the search result keyboard controls', async ({page}) => {
  await page.goto('/');
  await page.locator('#file-search-input').focus();
  await expect(page.locator('#file-search-input')).toBeFocused();
  await page.locator('#file-search-input').fill('portrait-not');
  await expect(page.locator('.file-search-result')).toHaveCount(1);

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.file-search-result')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/search-nested\/portrait-notes\.txt$/);
  await expect(page.locator('.filename')).toHaveText('portrait-notes.txt');
});

test('shows root search beside every path bar without a command shortcut', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#path-search-toggle')).toBeVisible();

  await page.goto('/search-nested/portrait-notes.txt');
  await expect(page.locator('#path-search-toggle')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#path-search-panel')).toBeHidden();

  await page.locator('#path-search-toggle').click();
  await expect(page.locator('#path-search-input')).toBeFocused();
  await expect(page.locator('.path-search-backdrop')).toBeVisible();
  const panelBox = await page.locator('#path-search-panel').boundingBox();
  expect(Math.abs(panelBox.x + panelBox.width / 2 - page.viewportSize().width / 2)).toBeLessThan(2);
  await page.locator('#path-search-input').fill('01-portrait');

  const result = page.locator('.path-search-result');
  await expect(result).toHaveCount(1);
  await expect(result.locator('.path-search-name')).toHaveText('01-portrait.svg');
  await expect(result.locator('.path-search-path')).toHaveText('/');
  await expect(result).toHaveAttribute('target', '_blank');
  await expect(result.locator('.path-search-icon img')).toHaveAttribute('src', '/01-portrait.svg?mode=asset');
  const iconBox = await result.locator('.path-search-icon').boundingBox();
  const thumbnailBox = await result.locator('.path-search-icon img').boundingBox();
  expect(Math.abs(thumbnailBox.width - iconBox.width)).toBeLessThan(2.1);
  expect(Math.abs(thumbnailBox.height - iconBox.height)).toBeLessThan(2.1);

  await page.locator('#path-search-input').press('Escape');
  await page.locator('#path-search-toggle').click();
  await expect(page.locator('#path-search-input')).toHaveValue('');
  await expect(page.locator('.path-search-result')).toHaveCount(0);

  await page.goto('/review.md');
  await page.locator('#path-search-toggle').click();
  await page.locator('#path-search-input').fill('01-portrait');
  const markdownThumbnail = page.locator('.path-search-result .path-search-icon img');
  await expect(markdownThumbnail).toBeVisible();
  const markdownIconBox = await page.locator('.path-search-result .path-search-icon').boundingBox();
  const markdownThumbnailBox = await markdownThumbnail.boundingBox();
  expect(Math.abs(markdownThumbnailBox.width - markdownIconBox.width)).toBeLessThan(2.1);
  expect(Math.abs(markdownThumbnailBox.height - markdownIconBox.height)).toBeLessThan(2.1);
});

test('debounces recursive searches while filtering the current directory immediately', async ({page}) => {
  let requests = 0;
  page.on('request', request => {
    if (request.url().includes('mode=file-search')) requests++;
  });
  await page.goto('/');

  await page.locator('#file-search-input').pressSequentially('portrait', {delay: 25});

  await expect(page.locator('.listing > .entry.image:visible .entry-name')).toHaveText('01-portrait.svg');
  await expect.poll(() => requests).toBe(1);
});

test('silently keeps the current-directory filter when fd is unavailable', async ({page}) => {
  await page.route(url => url.searchParams.get('mode') === 'file-search', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({scope: 'directory', results: []})
  }));
  await page.goto('/');

  await page.locator('#file-search-input').fill('portrait');

  await expect(page.locator('.listing > .entry.image:visible .entry-name')).toHaveText('01-portrait.svg');
  await expect(page.locator('#file-search-panel')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('当前设备未安装 fd');
});


test('locates absolute paths across directories and opens exact images', async ({page}) => {
  await page.goto('/search-nested/');
  await page.locator('#file-search-input').fill(path.join(fixtures, '01-portrait.svg'));
  const result = page.locator('.file-search-result');
  await expect(result).toHaveCount(1);
  await expect(result.locator('.file-search-result-path')).toHaveText('/');
  await expect(result.locator('.file-search-result-current')).toHaveCount(0);
  await result.click();
  await expect(page).toHaveURL(/\/\?view=gallery$/);
  await expect(page.locator('.lightbox-image')).toHaveAttribute('alt', '01-portrait.svg');
  await page.keyboard.press('Escape');

  await page.locator('#path-search-toggle').click();
  await page.locator('#path-search-input').fill(path.join(fixtures, 'search-nested/portrait-notes.txt'));
  const popupResult = page.locator('.path-search-result');
  await expect(popupResult).toHaveCount(1);
  await expect(popupResult.locator('.path-search-path')).toHaveText('/search-nested');
  const opened = page.waitForEvent('popup');
  await popupResult.click();
  const popup = await opened;
  await expect(popup).toHaveURL(/\/search-nested\/portrait-notes\.txt$/);
  await popup.close();
});

test('ranks partial paths from the accessible root in both search controls', async ({page}) => {
  await page.goto('/search-nested/unrelated/');
  const query = 'xxx/tiana/bootstrap/caddy/root.crt';
  await page.locator('#file-search-input').fill(query);
  await expect(page.locator('.listing > .entry.file:visible .entry-name')).toHaveText('root.crt');
  const results = page.locator('.file-search-result');
  await expect(results).toHaveCount(3);
  await expect(results.locator('.file-search-result-path')).toHaveText([
    '/search-nested/tiana/bootstrap/caddy',
    '/search-nested/other/caddy',
    '/search-nested/unrelated',
  ]);
  await page.locator('#file-search-input').fill('tiana/bootstrap/caddy/root.crt');
  await expect(results).toHaveCount(1);
  await expect(results).toHaveAttribute('href', '/search-nested/tiana/bootstrap/caddy/root.crt');
  await page.locator('#file-search-input').press('Escape');
  await page.locator('#path-search-toggle').click();
  await page.locator('#path-search-input').fill(query);
  await expect(page.locator('.path-search-result')).toHaveCount(3);
  await expect(page.locator('.path-search-result').first()).toHaveAttribute('href', '/search-nested/tiana/bootstrap/caddy/root.crt');
  await page.locator('#path-search-input').fill('tiana/bootstrap/caddy/root.crt');
  await expect(page.locator('.path-search-result')).toHaveCount(1);
  await expect(page.locator('.path-search-result')).toHaveAttribute('href', '/search-nested/tiana/bootstrap/caddy/root.crt');
});

test('searches partial absolute filenames only in their parent directory', async ({page}) => {
  await page.goto('/');
  await page.locator('#file-search-input').fill(path.join(fixtures, 'search-nested/portrait-not'));
  await expect(page.locator('.file-search-result')).toHaveCount(1);
  await expect(page.locator('.file-search-result')).toHaveAttribute('href', '/search-nested/portrait-notes.txt');
  for (const query of [path.join(fixtures, 'missing/root.crt'), path.join(fixtures, '../root.crt')]) {
    await page.locator('#file-search-input').fill(query);
    await expect(page.locator('.file-search-result')).toHaveCount(0);
    await expect(page.locator('#file-search-status')).toHaveText('没有找到匹配的文件或文件夹');
  }
});
