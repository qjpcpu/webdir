const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('File favourites', () => {
  let directory;
  let base;
  const files = ['notes.txt', 'review.md', 'image.svg', 'image.png', 'clip.mp4', 'diagram.drawio', '我的系统架构图.md'];
  test.beforeEach(({page}) => {
    page.on('dialog', dialog => dialog.accept(''));
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'favourites-'));
    base = `/${path.basename(directory)}/`;
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'Favourite file');
    fs.writeFileSync(path.join(directory, 'review.md'), '# Favourite file');
    fs.writeFileSync(path.join(directory, '我的系统架构图.md'), '# 系统架构');
    fs.copyFileSync(path.join(__dirname, 'fixtures', '03-square.svg'), path.join(directory, 'image.svg'));
    fs.writeFileSync(path.join(directory, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'));
    fs.copyFileSync(path.join(__dirname, 'media', 'bear.mp4'), path.join(directory, 'clip.mp4'));
    fs.writeFileSync(path.join(directory, 'diagram.drawio'), '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
  });
  test.afterEach(async ({request}) => {
    await request.delete(`${base}?mode=directory-favourite`);
    for (const name of files) await request.delete(`${base}${name}?mode=directory-favourite`);
    fs.rmSync(directory, {recursive: true, force: true});
  });
  const shortcut = (page, name) => page.locator(`[data-directory-favourite-path="${base}${name}"]`);
  const revealShortcut = async (page, name) => {
    if (!await shortcut(page, name).isVisible()) await page.locator('.favourites-dropdown summary').click();
    return shortcut(page, name);
  };

  test('prompts for an alias when adding the current directory or a list entry', async ({page}) => {
    await page.goto(`${base}?view=list`);
    for (const [selector, name, alias] of [
      ['#directory-favourite-toggle', '', '工作目录'],
      [`[data-directory-favourite-toggle="${base}notes.txt"]`, 'notes.txt', '阅读笔记']
    ]) {
      page.removeAllListeners('dialog');
      page.once('dialog', async dialog => {
        expect(dialog.type()).toBe('prompt');
        expect(dialog.defaultValue()).toBe('');
        await dialog.accept(alias);
      });
      await page.locator(selector).click();
      await expect(shortcut(page, name).locator('a')).toHaveText(alias);
      await page.reload();
      await expect(shortcut(page, name).locator('a')).toHaveText(alias);
    }
  });

  test('Markdown favourites prefill the document title and allow clearing it', async ({page}) => {
    await page.goto(base + 'review.md');
    const star = page.locator('#file-favourite-toggle');
    for (const alias of ['Favourite file', '']) {
      page.removeAllListeners('dialog');
      page.once('dialog', async dialog => {
        expect(dialog.defaultValue()).toBe('Favourite file');
        await dialog.accept(alias);
      });
      await Promise.all([
        page.waitForResponse(response => response.url().includes(
          alias ? 'mode=directory-favourite-label' : 'mode=directory-favourite'
        ) && response.request().method() === (alias ? 'POST' : 'PUT')),
        star.click()
      ]);
      await page.goto(`${base}?view=list`);
      await expect(shortcut(page, 'review.md').locator('a')).toHaveText(alias || `${path.basename(directory)}/review.md`);
      await page.goto(base + 'review.md');
      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('cancelling the alias prompt leaves the file unbookmarked', async ({page}) => {
    await page.goto(base + 'notes.txt');
    page.removeAllListeners('dialog');
    page.once('dialog', dialog => dialog.dismiss());
    const star = page.locator('#file-favourite-toggle');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
  });

  test('searches aliases and real filenames by Chinese, full pinyin and initials', async ({page}) => {
    const filename = '我的系统架构图.md';
    const filePath = base + encodeURIComponent(filename);
    expect((await page.request.put(`${filePath}?mode=directory-favourite`)).ok()).toBe(true);
    expect((await page.request.post(`${filePath}?mode=directory-favourite-label`, {data: JSON.stringify('Architecture')})).ok()).toBe(true);
    await page.goto(`${base}?view=list`);
    const star = page.locator(`[data-directory-favourite-toggle="${base}notes.txt"]`);
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    const item = await revealShortcut(page, 'notes.txt');
    await item.locator('a').dblclick();
    await item.locator('input').fill('我的系统架构图');
    await Promise.all([
      page.waitForResponse(response => response.url().includes('mode=directory-favourite-label')),
      item.locator('input').press('Enter')
    ]);
    const search = page.getByRole('searchbox', {name: '搜索收藏夹'});
    const realFile = shortcut(page, encodeURIComponent(filename));
    for (const reload of [false, true]) {
      if (reload) {
        await page.reload();
        await page.locator('.favourites-dropdown summary').click();
      }
      for (const query of ['系统', 'xitong', 'xt', 'XT', 'jiagou', 'jg']) {
        await search.fill(query);
        await expect(item).toBeVisible();
        await expect(realFile).toBeVisible();
      }
      await search.fill('NOTES.TXT');
      await expect(item).toBeVisible();
      await expect(realFile).toBeHidden();
      await search.fill('architecture');
      await expect(realFile).toBeVisible();
      await expect(item).toBeHidden();
      await search.fill('不存在的收藏');
      await expect(page.locator('.favourites-empty')).toBeVisible();
      await search.fill('');
      await expect(item).toBeVisible();
      await expect(realFile).toBeVisible();
    }
  });

  test('list stars save files, rename them and open their detail pages', async ({page}) => {
    await page.goto(`${base}?view=list`);
    const star = page.locator(`[data-directory-favourite-toggle="${base}notes.txt"]`);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    const fileLink = page.locator(`.file-open[href="${base}notes.txt"]`);
    await fileLink.focus();
    await expect(fileLink).toBeFocused();
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(new RegExp(`${base}\\?view=list$`));
    const item = await revealShortcut(page, 'notes.txt');
    await item.locator('a').dblclick();
    await item.locator('input').fill('笔记');
    await item.locator('input').press('Enter');
    await expect(item.locator('a')).toHaveText('笔记');
    await page.reload();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(shortcut(page, 'notes.txt').locator('a')).toHaveText('笔记');
    await (await revealShortcut(page, 'notes.txt')).locator('a').click();
    await expect(page).toHaveURL(base + 'notes.txt');
    await expect(page.locator('#file-favourite-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#file-favourite-toggle').click();
    await expect(page.locator('#file-favourite-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.goto(`${base}?view=list`);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(shortcut(page, 'notes.txt')).toHaveCount(0);
  });

  test('all file viewers persist their favourite button state', async ({page}) => {
    for (const name of files) {
      await page.goto(base + name);
      const star = page.locator('#file-favourite-toggle');
      await expect(star).toHaveAttribute('aria-pressed', 'false');
      const bounds = await star.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(star).toHaveAttribute('aria-pressed', 'true');
      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('gallery favourites reopen the selected image and sync list stars', async ({page}) => {
    await page.goto(`${base}?view=gallery&open=image.svg`);
    const viewerStar = page.locator('#gallery-favourite-toggle');
    await expect(page.locator('#image-lightbox')).toBeVisible();
    await page.locator('.lightbox-image').click();
    page.removeAllListeners('dialog');
    page.on('dialog', dialog => dialog.accept('精选图片'));
    await viewerStar.click();
    await expect(shortcut(page, 'image.svg').locator('a')).toHaveText('精选图片');
    await expect(viewerStar).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#preview-previous').click();
    await expect(viewerStar).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#preview-next').click();
    await expect(viewerStar).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.lightbox-close').click();
    await (await revealShortcut(page, 'image.svg')).locator('a').click();
    await expect(page.locator('#image-lightbox')).toBeVisible();
    await expect(page.locator('.lightbox-name')).toHaveText('image.svg');
    await expect(page.locator('.listing')).toHaveClass(/gallery/);
    await expect(viewerStar).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`${base}?view=list`);
    const listStar = page.locator(`[data-directory-favourite-toggle="${base}image.svg"]`);
    await expect(listStar).toHaveAttribute('aria-pressed', 'true');
    await listStar.click();
    await expect(listStar).toHaveAttribute('aria-pressed', 'false');
    await expect(shortcut(page, 'image.svg')).toHaveCount(0);
    await listStar.click();
    await expect(listStar).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await (await revealShortcut(page, 'image.svg')).locator('a').click();
    await expect(page.locator('#image-lightbox')).toBeVisible();
    await expect(page.locator('.lightbox-name')).toHaveText('image.svg');
    await page.locator('.lightbox-image').click();
    await viewerStar.click();
    await expect(viewerStar).toHaveAttribute('aria-pressed', 'false');
  });
});
