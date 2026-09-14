const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('gallery image actions', () => {
  let directory;
  let url;
  const names = ['01 猫.svg', '02-landscape.svg', '03-square.svg'];
  const imageUrl = name => `${url}${encodeURIComponent(name)}`;
  const tag = (page, name, value) => page.request.put(`${imageUrl(name)}?mode=image-tag`, {data: {tag: value}});
  const like = (page, name) => page.request.put(`${imageUrl(name)}?mode=favourite`);
  const pressTag = async (page, value) => {
    await Promise.all([
      page.waitForResponse(response => response.url().includes('mode=image-tag')),
      page.keyboard.press(value)
    ]);
  };
  const choose = async (page, value) => {
    await page.locator('#image-filter').selectOption(value);
    await page.locator('#image-filter').blur();
  };
  const visible = page => page.locator('.entry.image:not([hidden])');
  const entry = (page, name) => page.locator('.entry.image').filter({has: page.locator('.entry-name', {hasText: name})});
  const reloadAfter = async (page, action) => {
    await Promise.all([page.waitForEvent('load'), action()]);
  };

  test.beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'image-actions-'));
    url = `/${path.basename(directory)}/`;
    for (const name of names) {
      fs.writeFileSync(path.join(directory, name), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#7798aa"/></svg>');
    }
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'keep');
  });
  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('numeric keys replace and clear colored tags while preserving likes and editing input', async ({page}) => {
    await like(page, names[0]);
    await page.goto(`${url}?view=gallery`);
    await entry(page, names[0]).click();
    const badge = page.locator('.lightbox-tag-state');
    const colors = ['rgb(21, 128, 61)', 'rgb(180, 35, 54)', 'rgb(250, 204, 21)', 'rgb(37, 99, 235)', 'rgb(0, 0, 0)'];
    for (let number = 1; number <= 5; number++) {
      await pressTag(page, String(number));
      await expect(badge).toHaveText(String(number));
      await expect(badge).toHaveCSS('background-color', colors[number - 1]);
      await expect(entry(page, names[0])).toHaveAttribute('data-image-tag', String(number));
      await expect(page.locator('.lightbox-favourite-state')).toBeVisible();
    }
    await page.keyboard.type('06789');
    await expect(badge).toHaveText('5');
    await pressTag(page, '5');
    await expect(badge).toBeHidden();
    await page.keyboard.press('c');
    const editor = page.locator('.gallery-comment-composer textarea');
    await editor.fill('12345');
    await expect(editor).toHaveValue('12345');
    await expect(badge).toBeHidden();
    await page.locator('[data-comments-close]').click();
    await page.route('**/*?mode=image-tag', route => route.fulfill({status: 500}));
    await pressTag(page, '2');
    await expect(page.locator('#image-tag-error')).toBeVisible();
    await expect(badge).toBeHidden();
  });

  test('consecutive likes and tags update while saving and persist the final choice', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await entry(page, names[0]).click();
    for (const mode of ['favourite', 'image-tag']) {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const methods = [];
      await page.route(`**/*?mode=${mode}`, async route => {
        methods.push(route.request().method());
        await gate;
        await route.continue();
      });
      const toggle = () => mode === 'favourite'
        ? page.keyboard.press('f')
        : page.keyboard.press('2');
      try {
        await Promise.all([
          page.waitForRequest(request => request.url().includes(`mode=${mode}`)),
          toggle()
        ]);
        await expect(page.locator('#favourite-toggle')).toBeEnabled();
        await toggle();
        if (mode === 'favourite') {
          await expect(page.locator('#favourite-toggle')).toHaveAttribute('aria-pressed', 'false');
        } else {
          await expect(page.locator('.lightbox-tag-state')).toBeHidden();
          await page.keyboard.press('3');
          await expect(page.locator('.lightbox-tag-state')).toHaveText('3');
        }
        expect(methods).toEqual(['PUT']);
      } finally {
        release();
      }
      await expect.poll(() => methods.length).toBe(2);
      await expect(page.locator('#move-images')).toBeEnabled();
      await page.unroute(`**/*?mode=${mode}`);
    }
    await page.reload();
    await expect(entry(page, names[0])).toHaveAttribute('data-favourite', 'false');
    await expect(entry(page, names[0])).toHaveAttribute('data-image-tag', '3');
  });

  test('filtered galleries stay stable during mark changes and update when the preview closes', async ({page}) => {
    const pressFavourite = async () => {
      await Promise.all([
        page.waitForResponse(response => response.url().includes('mode=favourite')),
        page.keyboard.press('f')
      ]);
    };
    await tag(page, names[0], 1);
    await tag(page, names[1], 1);
    await like(page, names[0]);
    await page.goto(`${url}?view=gallery`);
    await expect(page.locator('#image-filter option')).toHaveText(['全部', '喜欢', '标记1']);
    await choose(page, 'tag1');
    await page.reload();
    await expect(page.locator('#image-filter')).toHaveValue('tag1');
    await expect(visible(page)).toHaveCount(2);
    await entry(page, names[0]).click();
    await pressTag(page, '3');
    await expect(page.locator('.lightbox-name')).toHaveText(names[0]);
    await expect(page.locator('.lightbox-position')).toHaveText('1 / 2');
    await expect(visible(page)).toHaveCount(2);
    await pressTag(page, '3');
    await expect(page.locator('.lightbox-tag-state')).toBeHidden();
    await pressFavourite();
    await expect(page.locator('.lightbox-favourite-state')).toBeHidden();
    await pressFavourite();
    await expect(page.locator('.lightbox-favourite-state')).toBeVisible();
    await pressTag(page, '1');
    await expect(visible(page)).toHaveCount(2);
    await pressTag(page, '1');
    await expect(visible(page)).toHaveCount(2);
    await expect(page.locator('.lightbox-name')).toHaveText(names[0]);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.lightbox-name')).toHaveText(names[1]);
    await expect(page.locator('.lightbox-position')).toHaveText('2 / 2');
    await pressTag(page, '1');
    await expect(page.locator('.lightbox-name')).toHaveText(names[1]);
    await expect(page.locator('#image-lightbox')).toBeVisible();
    await expect(visible(page)).toHaveCount(2);
    await page.locator('.lightbox-close').click();
    await expect(page.locator('#image-lightbox')).toBeHidden();
    await expect(visible(page)).toHaveCount(0);
    await choose(page, 'favourite');
    await expect(visible(page)).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#image-filter')).toHaveValue('favourite');
    await expect(visible(page)).toHaveCount(1);
    await choose(page, 'all');
    await expect(page.locator('#image-filter option')).toHaveText(['全部', '喜欢']);
    await choose(page, 'favourite');
    await entry(page, names[0]).click();
    await pressFavourite();
    await expect(page.locator('.lightbox-name')).toHaveText(names[0]);
    await expect(visible(page)).toHaveCount(1);
    await pressFavourite();
    await expect(visible(page)).toHaveCount(1);
    await expect(page.locator('.lightbox-favourite-state')).toBeVisible();
    await pressFavourite();
    await page.locator('.lightbox-close').click();
    await expect(page.locator('#image-lightbox')).toBeHidden();
    await expect(visible(page)).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#image-filter')).toHaveValue('favourite');
    await expect(visible(page)).toHaveCount(0);
    await expect(page.locator('#move-images')).toBeDisabled();
  });

  test('closing during a pending favourite save filters the wall and restores a failed change', async ({page}) => {
    await like(page, names[0]);
    await page.goto(`${url}?view=gallery`);
    await choose(page, 'favourite');
    await entry(page, names[0]).click();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/*?mode=favourite', async route => {
      await gate;
      await route.fulfill({status: 500});
    });
    try {
      await Promise.all([
        page.waitForRequest(request => request.url().includes('mode=favourite')),
        page.keyboard.press('f')
      ]);
      await expect(visible(page)).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.locator('#image-lightbox')).toBeHidden();
      await expect(visible(page)).toHaveCount(0);
    } finally {
      release();
    }
    await expect(visible(page)).toHaveCount(1);
    await expect(entry(page, names[0])).toHaveAttribute('data-favourite', 'true');
  });

  test('batch move uses the search intersection and carries comments and tags to a renamed destination', async ({page}) => {
    await like(page, names[0]);
    await like(page, names[1]);
    await tag(page, names[0], 3);
    await page.request.post(`${imageUrl(names[0])}?mode=gallery-comments`, {data: {
      type: 'add', comment: {id: 'move-comment', image: names[0], author: 'Alice', body: 'keep this comment', created_at: '2026-09-12T00:00:00Z'}
    }});
    fs.mkdirSync(path.join(directory, 'chosen'));
    fs.writeFileSync(path.join(directory, 'chosen', names[0]), 'existing');
    await page.goto(`${url}?view=gallery`);
    await choose(page, 'favourite');
    await page.locator('#file-search-input').fill('01');
    await page.locator('#move-images').click();
    await expect(page.locator('.move-dialog input')).toHaveValue('favourite');
    await expect(page.locator('.move-description')).toContainText('1 张');
    await page.locator('.move-dialog input').fill('chosen');
    await reloadAfter(page, () => page.locator('[data-move-confirm]').click());
    await expect(page.locator('#image-filter')).toHaveValue('favourite');
    await expect(page.locator('#file-search-input')).toHaveValue('01');
    await expect(visible(page)).toHaveCount(0);
    await expect(page.locator('#directory-notice')).toContainText('已移动 1 张图片');
    expect(fs.existsSync(path.join(directory, names[0]))).toBe(false);
    expect(fs.existsSync(path.join(directory, names[1]))).toBe(true);
    expect(fs.readFileSync(path.join(directory, 'chosen', names[0]), 'utf8')).toBe('existing');
    const movedName = '01 猫_2.svg';
    expect(fs.existsSync(path.join(directory, 'chosen', movedName))).toBe(true);
    const comments = await (await page.request.get(`${url}chosen/${encodeURIComponent(movedName)}?mode=gallery-comments`)).json();
    expect(comments.comments).toMatchObject([{image: movedName, body: 'keep this comment'}]);
    await page.goto(`${url}chosen/?view=gallery`);
    await expect(entry(page, movedName)).toHaveAttribute('data-favourite', 'true');
    await expect(entry(page, movedName)).toHaveAttribute('data-image-tag', '3');
    await choose(page, 'tag3');
    await page.locator('#move-images').click();
    await page.locator('.move-dialog input').fill('..');
    await expect(page.locator('.move-description')).toContainText('1 张');
    await reloadAfter(page, () => page.locator('[data-move-confirm]').click());
    await expect(page.locator('#directory-notice')).toContainText('已移动 1 张图片');
    expect(fs.existsSync(path.join(directory, 'chosen', movedName))).toBe(false);
    expect(fs.existsSync(path.join(directory, movedName))).toBe(true);
    await page.goto(`${url}?view=gallery`);
    await expect(entry(page, movedName)).toHaveAttribute('data-favourite', 'true');
    await expect(entry(page, movedName)).toHaveAttribute('data-image-tag', '3');
    const parentComments = await (await page.request.get(`${imageUrl(movedName)}?mode=gallery-comments`)).json();
    expect(parentComments.comments).toMatchObject([{image: movedName, body: 'keep this comment'}]);
  });

  test('moving to the parent removes empty organising folders and returns to the parent gallery', async ({page}) => {
    for (const folder of ['all', 'favourite', 'tag3']) {
      const source = path.join(directory, folder);
      const name = `from-${folder}.svg`;
      fs.mkdirSync(source);
      fs.copyFileSync(path.join(directory, names[0]), path.join(source, name));
      await page.request.put(`${url}${folder}/${name}?mode=image-tag`, {data: {tag: 3}});
      await page.request.put(`${url}${folder}/?mode=directory-favourite`);
      await page.goto(`${url}${folder}/?view=gallery`);
      await choose(page, 'tag3');
      await page.locator('#file-search-input').fill(`from-${folder}`);
      await page.locator('#move-images').click();
      await page.locator('.move-dialog input').fill('..');
      await reloadAfter(page, () => page.locator('[data-move-confirm]').click());
      await expect(page).toHaveURL(`${url}?view=gallery`);
      await expect(page.locator('.listing')).toHaveClass(/gallery/);
      await expect(page.locator('#file-search-input')).toHaveValue('');
      await expect(page.locator('#directory-notice')).toContainText('已移动 1 张图片，已删除空目录');
      expect(fs.existsSync(source)).toBe(false);
      expect(fs.existsSync(path.join(directory, name))).toBe(true);
      await expect(entry(page, name)).toHaveAttribute('data-image-tag', '3');
      await expect(entry(page, name)).toBeVisible();
      await expect(page.locator(`[data-directory-favourite-path="${url}${folder}/"]`)).toHaveCount(0);
      await page.reload();
      await expect(page).toHaveURL(`${url}?view=gallery`);
    }
  });

  test('batch clear removes only the selected kind, and all removes both kinds', async ({page}) => {
    for (const filter of ['favourite', 'tag3', 'all']) {
      await like(page, names[0]);
      await tag(page, names[0], 3);
      await like(page, names[1]);
      await tag(page, names[1], 3);
      await page.goto(`${url}?view=gallery`);
      await choose(page, filter);
      await page.locator('#file-search-input').fill('01');
      await page.locator('#clear-image-marks').click();
      await expect(page.locator('#clear-marks-description')).toContainText('1 张图片');
      await expect(page.locator('#clear-marks-description')).toContainText(filter === 'all' ? '喜欢和数字标记' : filter === 'favourite' ? '喜欢标记' : '数字标记');
      await reloadAfter(page, () => page.locator('#clear-marks-confirm').click());
      await expect(entry(page, names[0])).toHaveAttribute('data-favourite', String(filter === 'tag3'));
      await expect(entry(page, names[0])).toHaveAttribute('data-image-tag', filter === 'favourite' ? '3' : '');
      await expect(entry(page, names[1])).toHaveAttribute('data-favourite', 'true');
      await expect(entry(page, names[1])).toHaveAttribute('data-image-tag', '3');
    }
  });

  test('batch actions confirm their counts and are disabled when the search has no images', async ({page}) => {
    await like(page, names[0]);
    await tag(page, names[0], 3);
    await page.goto(`${url}?view=gallery`);
    let batchRequests = 0;
    page.on('request', request => {
      if (request.url().includes('mode=batch-images')) batchRequests++;
    });
    const actions = [
      ['#move-images', '.move-dialog', '.move-description', '[data-move-cancel]'],
      ['#delete-images', '#batch-delete-dialog', '#batch-delete-description', '#batch-delete-cancel'],
      ['#clear-image-marks', '#clear-marks-dialog', '#clear-marks-description', '#clear-marks-cancel']
    ];
    for (const [button, dialog, description, cancel] of actions) {
      await page.locator(button).click();
      await expect(page.locator(dialog)).toBeVisible();
      await expect(page.locator(description)).toContainText('3 张图片');
      await page.locator(cancel).click();
      await expect(page.locator(dialog)).toBeHidden();
      expect(batchRequests).toBe(0);
      await expect(entry(page, names[0])).toHaveAttribute('data-favourite', 'true');
      await expect(entry(page, names[0])).toHaveAttribute('data-image-tag', '3');
      expect(fs.existsSync(path.join(directory, names[0]))).toBe(true);
    }
    await page.locator('#file-search-input').fill('no matching photo');
    for (const [button] of actions) await expect(page.locator(button)).toBeDisabled();
    await page.locator('#file-search-input').fill('01');
    for (const [button] of actions) await expect(page.locator(button)).toBeEnabled();
    await page.locator('#clear-image-marks').click();
    await expect(page.locator('#clear-marks-description')).toContainText('1 张图片');
    await page.locator('#clear-marks-cancel').click();
  });

  test('batch delete confirms the visible count and retains gallery controls when emptied', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await page.locator('#move-images').click();
    await expect(page.locator('.move-dialog input')).toHaveValue('all');
    await page.locator('[data-move-cancel]').click();
    await page.locator('#file-search-input').fill('01');
    await page.locator('#delete-images').click();
    await expect(page.locator('#batch-delete-description')).toContainText('1 张图片');
    await reloadAfter(page, () => page.locator('#batch-delete-confirm').click());
    expect(fs.existsSync(path.join(directory, names[0]))).toBe(false);
    expect(fs.existsSync(path.join(directory, names[1]))).toBe(true);
    await page.locator('#file-search-input').fill('');
    await page.locator('#delete-images').click();
    await expect(page.locator('#batch-delete-description')).toContainText('2 张图片');
    await reloadAfter(page, () => page.locator('#batch-delete-confirm').click());
    await expect(visible(page)).toHaveCount(0);
    await expect(page.locator('#image-filter')).toHaveValue('all');
    await expect(page.locator('#delete-images')).toBeDisabled();
    expect(fs.readFileSync(path.join(directory, 'notes.txt'), 'utf8')).toBe('keep');
  });

  test('yy copies ordered filtered basenames and keeps viewer path copying', async ({page}) => {
    await like(page, names[0]);
    await like(page, names[1]);
    await tag(page, names[0], 3);
    await tag(page, names[1], 3);
    await page.addInitScript(() => {
      window.copiedTexts = [];
      document.execCommand = command => {
        if (command !== 'copy') return false;
        window.copiedTexts.push(document.activeElement.value);
        return true;
      };
    });
    await page.goto(`${url}?view=gallery`);
    await page.locator('#directory-sort').selectOption('name');
    await choose(page, 'favourite');
    await page.keyboard.type('yy');
    await expect.poll(() => page.evaluate(() => window.copiedTexts)).toEqual([names.slice(0, 2).join(',')]);
    await expect(page.locator('#file-path-toast')).toHaveText('已复制 2 个文件名');
    await choose(page, 'tag3');
    await page.locator('#move-images').click();
    await expect(page.locator('.move-dialog input')).toHaveValue('tag3');
    await page.locator('[data-move-cancel]').click();
    await page.locator('#file-search-input').fill('01');
    await page.locator('#file-search-input').blur();
    await page.keyboard.type('yy');
    await expect.poll(() => page.evaluate(() => window.copiedTexts.at(-1))).toBe(names[0]);
    await page.keyboard.press('y');
    await page.waitForTimeout(550);
    await page.keyboard.press('y');
    expect(await page.evaluate(() => window.copiedTexts.length)).toBe(2);
    await page.keyboard.press('Escape');
    await page.locator('#file-search-input').fill('yy');
    await expect(page.locator('#file-search-input')).toHaveValue('yy');
    expect(await page.evaluate(() => window.copiedTexts.length)).toBe(2);
    await page.locator('#file-search-input').blur();
    await page.keyboard.type('yy');
    await expect(page.locator('#file-path-toast')).toHaveText('没有可复制的图片');
    expect(await page.evaluate(() => window.copiedTexts.length)).toBe(2);
    await page.locator('#file-search-input').fill('01');
    await entry(page, names[0]).click();
    await page.keyboard.type('yy');
    await expect.poll(() => page.evaluate(() => window.copiedTexts.at(-1))).toBe(`${path.basename(directory)}/${names[0]}`);
  });
});
