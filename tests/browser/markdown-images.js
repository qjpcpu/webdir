const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('Markdown image preview', () => {
  let directory, url;

  async function openImage(page, image, isMobile) {
    if (isMobile) {
      await image.tap();
      await expect(page.locator('#markdown-image-preview')).toBeHidden();
      await image.tap();
    } else await image.click();
  }

  test.beforeEach(async ({page}) => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'markdown-images-'));
    url = `/${path.basename(directory)}/images.md`;
    fs.writeFileSync(path.join(directory, 'images.md'), '# 图片评审\n\n' + '正文段落。\n\n'.repeat(30) + '![人物图](../01-portrait.svg)\n\n![风景图](../02-landscape.svg)\n');
    await page.goto(url);
  });

  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('mouse click or touch double-tap opens a fitted image; zoom, drag, reset and Escape return to the reader', async ({page, isMobile}) => {
    const original = page.locator('#article img').first();
    await original.scrollIntoViewIfNeeded();
    const scrollTop = await page.evaluate(() => scrollY);
    await openImage(page, original, isMobile);
    const dialog = page.locator('#markdown-image-preview');
    const image = dialog.locator('img');
    await expect(dialog).toBeVisible();
    await expect(image).toHaveAttribute('alt', '人物图');
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    const stage = await dialog.locator('.markdown-image-stage').boundingBox();
    const fitted = await image.boundingBox();
    expect(fitted.width).toBeLessThanOrEqual(stage.width + 1);
    expect(fitted.height).toBeLessThanOrEqual(stage.height + 1);
    await dialog.getByRole('button', {name: '放大', exact: true}).click();
    await expect.poll(async () => (await image.boundingBox()).width).toBeGreaterThan(fitted.width);
    await dialog.getByRole('button', {name: '缩小', exact: true}).click();
    await expect.poll(async () => (await image.boundingBox()).width).toBeCloseTo(fitted.width, 0);
    const center = {x: stage.x + stage.width / 2, y: stage.y + stage.height / 2};
    await page.mouse.move(center.x, center.y);
    if (isMobile) await dialog.getByRole('button', {name: '放大', exact: true}).click();
    else await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await image.boundingBox()).width).toBeGreaterThan(fitted.width);
    const zoomed = await image.boundingBox();
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 60, center.y + 40, {steps: 5});
    await page.mouse.up();
    await expect.poll(async () => (await image.boundingBox()).x).toBeCloseTo(zoomed.x + 60, 0);
    await expect.poll(async () => (await image.boundingBox()).y).toBeCloseTo(zoomed.y + 40, 0);
    await dialog.getByRole('button', {name: '适应窗口'}).click();
    await expect.poll(async () => (await image.boundingBox()).width).toBeCloseTo(fitted.width, 0);
    await expect.poll(async () => (await image.boundingBox()).x).toBeCloseTo(fitted.x, 0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrollTop);
    await expect(original).toBeVisible();
  });

  test('close button returns to the reader and another image opens with a fresh view', async ({page, isMobile}) => {
    await openImage(page, page.locator('#article img').first(), isMobile);
    const dialog = page.locator('#markdown-image-preview');
    await dialog.getByRole('button', {name: '放大', exact: true}).click();
    await dialog.getByRole('button', {name: '关闭图片预览'}).click();
    await expect(dialog).toBeHidden();
    await openImage(page, page.locator('#article img').last(), isMobile);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toHaveAttribute('alt', '风景图');
    await expect(dialog.locator('img')).toHaveJSProperty('src', new URL('/02-landscape.svg', page.url()).href);
    await expect(dialog.locator('img')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await dialog.getByRole('button', {name: '关闭图片预览'}).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('a mouse click opens the preview after touch interaction', async ({page, isMobile}) => {
    test.skip(!isMobile, 'Requires a touch-enabled browser');
    const original = page.locator('#article img').first();
    await original.tap();
    await expect(page.locator('#markdown-image-preview')).toBeHidden();
    await original.click();
    await expect(page.locator('#markdown-image-preview')).toBeVisible();
    await page.getByRole('button', {name: '关闭图片预览'}).click();
    await openImage(page, original, true);
    await expect(page.locator('#markdown-image-preview')).toBeVisible();
  });
});
