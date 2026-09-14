const { test, expect } = require('@playwright/test');

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
  await expect(result.locator('.path-search-path')).toHaveText('根目录');
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
