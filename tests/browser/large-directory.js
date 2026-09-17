const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('large directories', () => {
  let directory, url;
  const name = index => `image-${String(index).padStart(5, '0')}.svg`;
  test.beforeAll(() => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'large-directory-'));
    url = `/${path.basename(directory)}/`;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#7798aa"/></svg>';
    for (const count of [100, 1000, 10000]) {
      const target = path.join(directory, String(count));
      fs.mkdirSync(target);
      for (let index = 0; index < count; index++) fs.writeFileSync(path.join(target, name(index)), svg);
    }
    const mixed = path.join(directory, 'mixed');
    fs.mkdirSync(mixed);
    for (let index = 0; index < 1000; index++) fs.writeFileSync(path.join(mixed, `document-${String(index).padStart(5, '0')}.txt`), 'text');
    fs.mkdirSync(path.join(mixed, 'folder.png'));
    fs.writeFileSync(path.join(mixed, 'folder.png', 'note.txt'), 'text');
    fs.writeFileSync(path.join(mixed, name(0)), svg);
  });
  test.afterAll(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('renders a bounded window and scrolls to the last image at every directory size', async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const count of [100, 1000, 10000]) {
      const started = Date.now();
      const response = await page.goto(`${url}${count}/?view=gallery`);
      expect((await response.body()).length).toBeLessThan(300000);
      await expect(page.locator('.summary')).toHaveText(`0 个目录 · ${count} 个文件`);
      await expect(page.locator('.entry.image').first()).toBeVisible();
      expect(await page.locator('.entry').count()).toBeLessThan(150);
      test.info().annotations.push({type: 'initial-directory-ms', description: `${count}: ${Date.now() - started}`});
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator('.entry-name', {hasText: name(count - 1)})).toBeAttached();
      if (count === 10000) {
        const anchorName = await page.locator('.entry.image').evaluateAll(entries => entries.find(entry => {
          const rect = entry.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        }).querySelector('.entry-name').textContent);
        const previousWidth = (await page.locator('.entry.image').first().boundingBox()).width;
        await page.setViewportSize({width: 720, height: 600});
        await expect.poll(async () => {
          const bounds = await page.locator('.entry.image').first().boundingBox();
          return bounds ? Math.abs(bounds.width - previousWidth) : 0;
        }).toBeGreaterThan(1);
        await expect(page.locator('.entry-name', {hasText: anchorName})).toBeAttached();
        expect(await page.evaluate(() => scrollY)).toBeGreaterThan(10000);
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator('.entry-name', {hasText: name(count - 1)})).toBeAttached();
      }
      expect(await page.locator('.entry').count()).toBeLessThan(150);
      await page.locator('.entry.image').filter({hasText: name(count - 1)}).click();
      await expect(page.locator('.lightbox-position')).toHaveText(`${count} / ${count}`);
      await page.keyboard.press('j');
      await expect(page.locator('.lightbox-name')).toHaveText(name(count - 2));
      const position = await page.evaluate(() => scrollY);
      await page.locator('.lightbox-close').click();
      await expect(page.locator('#image-lightbox')).toBeHidden();
      expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(2);
      await page.reload();
      await expect(page.locator('.entry-name', {hasText: name(count - 1)})).toBeAttached();
      expect(Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(2);
    }
    expect(errors).toEqual([]);
  });

  test('uses all records for selection, filters, clipboard and previews beyond the rendered window', async ({page}) => {
    await page.goto(`${url}1000/?view=gallery`);
    await page.locator('#select-images').click();
    await page.locator('#select-all-images').click();
    await expect(page.locator('#image-selection-count')).toHaveText('已选 1000 张');
    await page.locator('#delete-images').click();
    await expect(page.locator('#batch-delete-description')).toContainText('1000 张图片');
    await page.locator('#batch-delete-cancel').click();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const last = page.locator('.entry.image').filter({hasText: name(999)});
    await expect(last).toHaveClass(/image-selected/);
    await page.locator('#file-search-input').fill('image-00999');
    await expect(page.locator('#image-selection-count')).toHaveText('已选 1 张');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await last.click();
    await expect(page.locator('.lightbox-position')).toHaveText('1 / 1');
    await page.locator('.lightbox-close').click();

    await page.goto(`${url}1000/?view=gallery&open=${name(500)}`);
    await expect(page.locator('.lightbox-name')).toHaveText(name(500));
    await expect(page.locator('.lightbox-position')).toHaveText('501 / 1000');
    await page.keyboard.press('k');
    await expect(page.locator('.lightbox-name')).toHaveText(name(501));
    await page.keyboard.press('1');
    await expect(page.locator('.lightbox-tag-state')).toHaveText('1');
    await page.locator('.lightbox-close').click();
    await page.locator('#image-filter').selectOption('tag1');
    await expect(page.locator('.entry.image')).toHaveCount(1);
    await expect(page.locator('.entry-name')).toHaveText([name(501)]);
    await page.evaluate(() => {
      window.copiedText = '';
      document.execCommand = command => {
        if (command !== 'copy') return false;
        window.copiedText = document.activeElement.value;
        return true;
      };
    });
    await page.locator('#image-filter').blur();
    await page.keyboard.type('yy');
    await expect.poll(() => page.evaluate(() => window.copiedText)).toBe(name(501));
  });

  test('shows the requested layout while data is pending and retries a failed request', async ({page}) => {
    let release;
    let attempts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/*?mode=directory-entries', async route => {
      if (++attempts === 1) {
        await gate;
        await route.fulfill({status: 500, body: 'failed'});
      } else await route.continue();
    });
    await page.addInitScript(pathname => localStorage.setItem(`webdir-directory-view:${pathname}`, 'gallery'), `${url}100/`);
    await page.goto(`${url}100/`);
    await expect(page.locator('body')).toHaveClass(/gallery-mode/);
    await expect(page.locator('#directory-loading')).toBeVisible();
    await expect(page.locator('#select-images')).toBeDisabled();
    const cell = await page.locator('.directory-skeletons i').first().boundingBox();
    expect(Math.abs(cell.width - cell.height)).toBeLessThan(1);
    release();
    await expect(page.locator('#directory-load-error')).toBeVisible();
    await page.locator('#directory-retry').click();
    await expect(page.locator('.summary')).toHaveText('0 个目录 · 100 个文件');
    await expect(page.locator('#directory-loading')).toBeHidden();
    await expect(page.locator('.entry.image').first()).toBeVisible();
    const loadedCell = await page.locator('.entry.image').first().boundingBox();
    for (const dimension of ['x', 'y', 'width', 'height']) expect(Math.abs(loadedCell[dimension] - cell[dimension])).toBeLessThan(1);
  });

  test('image loading keeps the wall geometry fixed and Tab reaches the next window', async ({page}) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/*.svg?mode=asset*', async route => { await gate; await route.continue(); });
    await page.goto(`${url}1000/?view=gallery`);
    const first = page.locator('.entry.image').first();
    await expect(first).toBeVisible();
    const before = await first.boundingBox();
    release();
    await expect.poll(() => first.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await first.boundingBox()).toEqual(before);
    const lastMounted = page.locator('.entry.image').last();
    const lastName = await lastMounted.locator('.entry-name').textContent();
    const next = name(Number(lastName.match(/\d+/)[0]) + 1);
    await lastMounted.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.entry.image').filter({hasText: next})).toBeFocused();
    expect(await page.locator('.entry').count()).toBeLessThan(150);
  });

  test('list and mixed gallery layouts remain navigable after resizing and filtering', async ({page}) => {
    await page.goto(`${url}mixed/`);
    await expect(page.locator('.summary')).toHaveText('1 个目录 · 1001 个文件');
    await expect(page.locator('.entry').first()).toBeVisible();
    expect(await page.locator('.entry').count()).toBeLessThan(100);
    await page.locator('#gallery-toggle').click();
    await expect(page.locator('.entry.folder')).toBeVisible();
    await page.evaluate(() => scrollBy(0, innerHeight));
    await expect(page.locator('.entry.image')).toBeAttached();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.entry-name', {hasText: 'document-00999.txt'})).toBeAttached();
    await page.locator('#file-search-input').fill('document-00999');
    await expect(page.locator('.summary')).toHaveText('0 个目录 · 1 个文件');
    await expect(page.locator('.entry-name')).toHaveText(['document-00999.txt']);
    await page.setViewportSize({width: 720, height: 600});
    await expect(page.locator('.entry').first()).toBeVisible();
    await page.locator('#gallery-toggle').click();
    await expect(page.locator('.entry').first()).toBeVisible();
    expect(await page.locator('.listing').evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.addInitScript(pathname => localStorage.setItem(`webdir-image-filter:${pathname}`, 'tag1'), `${url}mixed/folder.png/`);
    await page.goto(`${url}mixed/folder.png/`);
    await expect(page.locator('.summary')).toHaveText('0 个目录 · 1 个文件');
    await expect(page.locator('.entry-name')).toHaveText(['note.txt']);
    await expect(page.locator('#gallery-toggle')).toBeHidden();
  });
});
