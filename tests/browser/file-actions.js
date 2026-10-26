const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('All file batch actions', () => {
  let directory, url;
  const names = ['notes.md', 'data.json', 'archive.zip', 'photo.svg'];
  const entry = (page, name) => page.locator(`.entry[data-file-path="${url.slice(1)}${name}"]`);
  const reloadAfter = async (page, action) => Promise.all([page.waitForEvent('load'), action()]);
  const finishSelection = async page => {
    const button = page.locator('#finish-file-selection');
    if (await button.isVisible()) {
      await button.click();
      await expect(page.locator('#select-images')).toBeVisible();
    }
  };
  test.beforeEach(() => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'file-actions-'));
    url = `/${path.basename(directory)}/`;
    fs.writeFileSync(path.join(directory, 'notes.md'), '# Notes');
    fs.writeFileSync(path.join(directory, 'data.json'), '{"hello":"world"}');
    fs.writeFileSync(path.join(directory, 'archive.zip'), Buffer.from([0x50, 0x4b, 0, 1, 0xff]));
    fs.copyFileSync(path.join(__dirname, 'fixtures', '03-square.svg'), path.join(directory, 'photo.svg'));
    fs.mkdirSync(path.join(directory, 'folder'));
    fs.writeFileSync(path.join(directory, 'folder', 'child.txt'), 'keep');
  });
  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  for (const view of ['list', 'gallery']) {
    test(`${view} selects mixed files, keeps selection across views, and marks only selected files`, async ({page}) => {
      await page.goto(`${url}?view=${view}`);
      await page.locator('#select-images').click();
      await entry(page, 'notes.md').locator('.entry-name').click();
      const archive = entry(page, 'archive.zip').locator('.file-open');
      await archive.focus();
      await page.keyboard.press(' ');
      await expect(archive).toHaveAttribute('aria-checked', 'true');
      await entry(page, 'photo.svg').locator('.entry-name').click();
      await expect(page.locator('#image-selection-count')).toHaveText('已选 3 个文件');
      await expect(page.locator('#image-lightbox')).toBeHidden();
      await page.locator('#gallery-toggle').click();
      await expect(page.locator('#image-selection-count')).toHaveText('已选 3 个文件');
      await reloadAfter(page, () => page.getByLabel('批量标记', {exact: true}).selectOption('tag2'));
      await finishSelection(page);
      for (const name of ['notes.md', 'archive.zip', 'photo.svg']) {
        await expect(entry(page, name)).toHaveAttribute('data-image-tag', '2');
        await expect(entry(page, name).locator('.image-tag')).toBeVisible();
      }
      await expect(entry(page, 'data.json')).toHaveAttribute('data-image-tag', '');
      await page.locator('#image-filter').selectOption('tag2');
      await expect(page.locator('.entry.file:visible')).toHaveCount(3);
      await page.locator('#clear-image-marks').click();
      await expect(page.locator('#clear-marks-description')).toContainText('3 个文件');
      await reloadAfter(page, () => page.locator('#clear-marks-confirm').click());
      await page.locator('#image-filter').selectOption('all');
      for (const name of names) await expect(entry(page, name)).toHaveAttribute('data-image-tag', '');
    });

    test(`${view} selects folders with files and filters and clears their marks`, async ({page}) => {
      await page.goto(`${url}?view=${view}`);
      await page.locator('#select-images').click();
      await entry(page, 'notes.md').locator('.entry-name').click();
      const folder = entry(page, 'folder').locator('.folder-open');
      await folder.focus();
      await page.keyboard.press(' ');
      await expect(folder).toHaveAttribute('aria-checked', 'true');
      await expect(entry(page, 'folder').locator('.image-selection-indicator')).toBeVisible();
      await expect(page.locator('#image-selection-count')).toHaveText('已选 2 项（含 1 个文件夹）');
      await page.locator('#gallery-toggle').click();
      await expect(folder).toHaveAttribute('aria-checked', 'true');
      await reloadAfter(page, () => page.getByLabel('批量标记', {exact: true}).selectOption('tag2'));
      await finishSelection(page);
      await expect(entry(page, 'folder')).toHaveAttribute('data-image-tag', '2');
      await expect(entry(page, 'folder').locator('.image-tag')).toBeVisible();
      await page.locator('#image-filter').selectOption('tag2');
      await expect(page.locator('.entry:visible')).toHaveCount(2);
      await reloadAfter(page, () => page.getByLabel('批量标记', {exact: true}).selectOption('favourite'));
      await page.locator('#image-filter').selectOption('favourite');
      await expect(page.locator('.entry:visible')).toHaveCount(2);
      await page.locator('#clear-image-marks').click();
      await expect(page.locator('#clear-marks-description')).toContainText('2 项（含 1 个文件夹）');
      await reloadAfter(page, () => page.locator('#clear-marks-confirm').click());
      await page.locator('#image-filter').selectOption('all');
      await expect(entry(page, 'folder')).toHaveAttribute('data-favourite', 'false');
      await expect(entry(page, 'folder')).toHaveAttribute('data-image-tag', '2');
      expect(fs.readFileSync(path.join(directory, 'folder/child.txt'), 'utf8')).toBe('keep');
    });

    test(`${view} moves selected folders and files together`, async ({page}) => {
      fs.mkdirSync(path.join(directory, 'target'));
      await page.goto(`${url}?view=${view}`);
      await page.locator('#select-images').click();
      await entry(page, 'folder').locator('.entry-name').click();
      await entry(page, 'notes.md').locator('.entry-name').click();
      await page.locator('#move-images').click();
      await expect(page.locator('.move-description')).toContainText('2 项（含 1 个文件夹）');
      await page.locator(`.move-node[data-path="${url}target/"] > .move-tree-row > .move-tree-label`).click();
      await reloadAfter(page, () => page.locator('[data-move-confirm]').click());
      expect(fs.readFileSync(path.join(directory, 'target/folder/child.txt'), 'utf8')).toBe('keep');
      expect(fs.readFileSync(path.join(directory, 'target/notes.md'), 'utf8')).toBe('# Notes');
      expect(fs.existsSync(path.join(directory, 'folder'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'notes.md'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'data.json'))).toBe(true);
    });

    test(`${view} deletes selected folders recursively along with files`, async ({page}) => {
      await page.goto(`${url}?view=${view}`);
      await page.locator('#select-images').click();
      await entry(page, 'folder').locator('.entry-name').click();
      await entry(page, 'archive.zip').locator('.entry-name').click();
      await page.locator('#delete-images').click();
      await expect(page.locator('#batch-delete-description')).toContainText('2 项（含 1 个文件夹）');
      await expect(page.locator('#batch-delete-description')).toContainText('文件夹内的所有内容也会删除');
      await reloadAfter(page, () => page.locator('#batch-delete-confirm').click());
      expect(fs.existsSync(path.join(directory, 'folder'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'archive.zip'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'notes.md'))).toBe(true);
    });

    test(`${view} deletes only selected documents and archives`, async ({page}) => {
      await page.goto(`${url}?view=${view}`);
      await page.locator('#select-images').click();
      await entry(page, 'notes.md').locator('.entry-name').click();
      await entry(page, 'archive.zip').locator('.entry-name').click();
      await page.locator('#delete-images').click();
      await expect(page.locator('#batch-delete-description')).toContainText('已选的 2 个文件');
      await reloadAfter(page, () => page.locator('#batch-delete-confirm').click());
      expect(fs.existsSync(path.join(directory, 'notes.md'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'archive.zip'))).toBe(false);
      expect(fs.existsSync(path.join(directory, 'data.json'))).toBe(true);
      expect(fs.existsSync(path.join(directory, 'photo.svg'))).toBe(true);
      expect(fs.readFileSync(path.join(directory, 'folder', 'child.txt'), 'utf8')).toBe('keep');
    });
  }

  test('a folder-only directory supports selecting empty folders in both views', async ({page}) => {
    for (const name of names) fs.rmSync(path.join(directory, name));
    fs.rmSync(path.join(directory, 'folder/child.txt'));
    await page.goto(`${url}?view=gallery`);
    await page.locator('#select-images').click();
    await page.locator('#select-all-images').click();
    await expect(page.locator('#image-selection-count')).toHaveText('已选 1 项（含 1 个文件夹）');
    await reloadAfter(page, () => page.getByLabel('批量标记', {exact: true}).selectOption('tag2'));
    await finishSelection(page);
    await page.locator('#image-filter').selectOption('tag2');
    await page.locator('#select-images').click();
    await entry(page, 'folder').locator('.entry-name').click();
    await page.locator('#gallery-toggle').click();
    await expect(entry(page, 'folder').locator('.folder-open')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#clear-image-selection').click();
    await expect(entry(page, 'folder').locator('.folder-open')).toHaveAttribute('aria-checked', 'false');
    await finishSelection(page);
    await entry(page, 'folder').locator('.entry-name').click();
    await expect(page).toHaveURL(new RegExp(`${url}folder/`));
  });

  test('a directory without media can select all entries and filter likes and numeric marks', async ({page}) => {
    fs.rmSync(path.join(directory, 'photo.svg'));
    await page.goto(`${url}?view=list`);
    await page.locator('#select-images').click();
    await page.locator('#select-all-images').click();
    await expect(page.locator('#image-selection-count')).toHaveText('已选 4 项（含 1 个文件夹）');
    await reloadAfter(page, () => page.getByLabel('批量标记', {exact: true}).selectOption('favourite'));
    await finishSelection(page);
    await page.locator('#image-filter').selectOption('favourite');
    await expect(page.locator('.entry:visible')).toHaveCount(4);
    await page.locator('#file-search-input').fill('json');
    await reloadAfter(page, () => page.getByLabel('批量标记', {exact: true}).selectOption('tag4'));
    await expect(entry(page, 'data.json')).toHaveAttribute('data-image-tag', '4');
    await expect(entry(page, 'data.json')).toHaveAttribute('data-favourite', 'true');
    await page.locator('#file-search-input').fill('');
    await page.locator('#image-filter').selectOption('tag4');
    await expect(page.locator('.entry.file:visible')).toHaveCount(1);
    await expect(entry(page, 'data.json')).toBeVisible();
  });
});
