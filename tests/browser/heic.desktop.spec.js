const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

let directory;
let url;
const source = fs.readFileSync(path.join(__dirname, 'media/checker-1024.heic'));

test.beforeAll(() => {
  directory = fs.mkdtempSync(path.join(__dirname, 'fixtures/heic-'));
  fs.writeFileSync(path.join(directory, 'photo.HEIC'), source);
  url = `/${path.basename(directory)}/`;
});

test.afterAll(() => {
  fs.rmSync(directory, {recursive: true, force: true});
});

test('HEIC renders in the gallery and image page and downloads the original file', async ({page}) => {
  await page.goto(`${url}?view=gallery`);
  const entry = page.locator('.listing .entry.image');
  await expect(entry).toHaveCount(1);
  await expect.poll(() => entry.locator('img').evaluate(image => image.naturalWidth)).toBe(512);
  await entry.click();
  const preview = page.locator('.lightbox-image');
  await expect.poll(() => preview.evaluate(image => image.naturalWidth)).toBe(1024);
  await preview.click({position: {x: 100, y: 100}});
  await page.getByRole('button', {name: '更多工具', exact: true}).click();
  await page.getByRole('button', {name: '原始尺寸', exact: true}).click();
  await expect(preview).toHaveAttribute('src', /mode=image-full/);
  await expect.poll(() => preview.evaluate(image => image.naturalWidth)).toBe(1024);

  const downloadEvent = page.waitForEvent('download');
  await page.locator('.image-download').click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('photo.HEIC');
  expect(fs.readFileSync(await download.path())).toEqual(source);

  await page.goto(`${url}photo.HEIC`);
  await expect.poll(() => page.locator('#artwork').evaluate(image => image.naturalWidth)).toBe(1024);
  await expect(page.locator('#error')).toBeHidden();
});
