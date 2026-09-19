const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const fixtures = fs.realpathSync(path.join(__dirname, 'fixtures'));

test('filters current-directory folders and opens them from the listing', async ({page}) => {
  await page.goto('/');
  const input = page.locator('#file-search-input');
  const names = page.locator('.listing > .entry .entry-name');
  await input.fill('SEARCH-NESTED');
  await expect(names).toHaveText(['search-nested']);
  await expect(page.locator('.summary')).toHaveText('1 个目录 · 0 个文件');
  await page.locator('.listing .folder-open').click();
  await expect(page).toHaveURL(/\/search-nested\/$/);
  await expect(input).toHaveValue('');

  await input.fill('caddy');
  await expect(page.locator('#directory-empty')).toBeVisible();
  await expect(page.locator('.summary')).toHaveText('0 个目录 · 0 个文件');
  await input.fill('tiana');
  await expect(names).toHaveText(['tiana']);
  await page.locator('.listing .folder-open').click();
  await expect(page).toHaveURL(/\/search-nested\/tiana\/$/);
});

test('finds folders by name and path from the path bar', async ({page}) => {
  await page.goto('/search-nested/');
  await page.locator('#path-search-toggle').click();
  const input = page.locator('#path-search-input');
  const results = page.locator('.path-search-result');
  await input.fill('caddy');
  await expect(results).toHaveCount(2);
  await expect(results.locator('.path-search-icon')).toHaveText(['目录', '目录']);
  for (const query of ['tiana/bootstrap/caddy/', path.join(fixtures, 'search-nested/tiana/bootstrap/cad'), path.join(fixtures, 'search-nested/tiana/bootstrap/caddy') + '/']) {
    await input.fill(query);
    await expect(results).toHaveCount(1);
    await expect(results).toHaveAttribute('href', '/search-nested/tiana/bootstrap/caddy/');
  }
  const opened = page.waitForEvent('popup');
  await results.click();
  const popup = await opened;
  await expect(popup).toHaveURL(/\/search-nested\/tiana\/bootstrap\/caddy\/$/);
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

for (const view of ['list', 'gallery']) {
  test(`filters current-directory files in ${view} view and restores them when cleared`, async ({page}) => {
    await page.goto(`/?view=${view}`);
    const input = page.locator('#file-search-input');
    const names = page.locator('.listing > .entry .entry-name');
    await expect(page.locator('.listing')).toHaveAttribute('aria-busy', 'false');
    await expect(names.first()).toBeVisible();
    const originalNames = await names.allTextContents();
    const originalSummary = await page.locator('.summary').textContent();

    await input.fill(' PORTRAIT ');
    await expect(names).toHaveText(['01-portrait.svg']);
    await expect(page.locator('.summary')).toHaveText('0 个目录 · 1 个文件');
    await input.fill('portrait-not');
    await expect(page.locator('#directory-empty')).toBeVisible();
    await expect(page.locator('#directory-empty p')).toHaveText('没有匹配的文件或目录');
    await expect(page.locator('.summary')).toHaveText('0 个目录 · 0 个文件');
    await input.fill('');
    await expect(names).toHaveText(originalNames);
    await expect(page.locator('.summary')).toHaveText(originalSummary);
    await expect(page.locator('#directory-empty')).toBeHidden();
  });
}

test('opens a filtered file from the directory listing with the keyboard', async ({page}) => {
  await page.goto('/search-nested/');
  await page.locator('#file-search-input').fill('portrait-not');
  const result = page.locator('.listing > .entry.file');
  await expect(result.locator('.entry-name')).toHaveText('portrait-notes.txt');
  await result.focus();
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

test('locates absolute paths across directories from the path bar', async ({page}) => {
  await page.goto('/');
  await page.locator('#path-search-toggle').click();
  await page.locator('#path-search-input').fill(path.join(fixtures, 'search-nested/portrait-notes.txt'));
  const result = page.locator('.path-search-result');
  await expect(result).toHaveCount(1);
  await expect(result.locator('.path-search-path')).toHaveText('/search-nested');
  const opened = page.waitForEvent('popup');
  await result.click();
  const popup = await opened;
  await expect(popup).toHaveURL(/\/search-nested\/portrait-notes\.txt$/);
  await popup.close();
});

test('ranks partial paths from the accessible root in the path bar', async ({page}) => {
  await page.goto('/search-nested/unrelated/');
  const query = 'xxx/tiana/bootstrap/caddy/root.crt';
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
  await page.locator('#path-search-toggle').click();
  await page.locator('#path-search-input').fill(path.join(fixtures, 'search-nested/portrait-not'));
  await expect(page.locator('.path-search-result')).toHaveCount(1);
  await expect(page.locator('.path-search-result')).toHaveAttribute('href', '/search-nested/portrait-notes.txt');
  for (const query of [path.join(fixtures, 'missing/root.crt'), path.join(fixtures, '../root.crt')]) {
    await page.locator('#path-search-input').fill(query);
    await expect(page.locator('.path-search-result')).toHaveCount(0);
    await expect(page.locator('#path-search-status')).toHaveText('没有找到匹配的文件或文件夹');
  }
});
