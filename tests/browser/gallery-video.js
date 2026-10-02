const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const {dispatchTouchPointer} = require('./helpers');

module.exports = () => test.describe('mixed photo and video gallery', () => {
  let directory;
  let url;
  test.beforeEach(() => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'video-gallery-'));
    fs.copyFileSync(path.join(__dirname, 'fixtures', '01-portrait.svg'), path.join(directory, '01-photo.svg'));
    fs.copyFileSync(path.join(__dirname, 'media', 'bear.mp4'), path.join(directory, '02-video.mp4'));
    fs.copyFileSync(path.join(__dirname, 'fixtures', '03-square.svg'), path.join(directory, '03-photo.svg'));
    url = `/${path.basename(directory)}/`;
  });
  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('video grid covers remain visibly labelled before and after their poster loads', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    const card = page.locator('.entry.video');
    const badge = card.locator('.video-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('视频');
    await expect.poll(() => card.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect(badge).toBeVisible();
    await badge.scrollIntoViewIfNeeded();
    const covered = await badge.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return top?.closest('.entry') !== element.closest('.entry');
    });
    expect(covered).toBe(false);
    await page.request.put(`${url}02-video.mp4?mode=image-tag`, {data: {tag: 3}});
    await page.reload();
    await expect(card.locator('.image-tag')).toBeVisible();
    const playBounds = await badge.boundingBox();
    const tagBounds = await card.locator('.image-tag').boundingBox();
    const cardBounds = await card.boundingBox();
    expect(playBounds.x - cardBounds.x).toBeLessThan(16);
    expect(playBounds.y - cardBounds.y).toBeLessThan(16);
    expect(tagBounds.y >= playBounds.y + playBounds.height).toBe(true);
    await page.locator('#select-images').click();
    const shifted = await badge.boundingBox();
    const selection = await card.locator('.image-selection-indicator').boundingBox();
    expect(shifted.x + shifted.width <= selection.x).toBe(true);
  });

  test('video preview supports photo marks, comments, zoom, download and delete shortcuts', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await page.locator('.entry.video').click();
    await page.keyboard.press('f');
    await expect(page.locator('.favourite-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('3');
    await expect(page.locator('.lightbox-tag-state')).toHaveText('3');
    await page.keyboard.press('c');
    await expect(page.locator('.gallery-comments')).toBeVisible();
    await page.locator('.gallery-comment-composer input[name=author]').fill('Video reviewer');
    await page.locator('.gallery-comment-composer textarea').fill('剪掉片头');
    await page.keyboard.press('Enter');
    await expect(page.locator('.gallery-comment-list')).toContainText('剪掉片头');
    await page.locator('[data-comments-close]').click();
    await page.locator('.viewer-more-toggle').click();
    await expect.poll(() => page.locator('.lightbox-video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
    await page.locator('[data-zoom=in]').click();
    await expect(page.locator('.lightbox-video')).toHaveClass(/zoomed/);
    await page.locator('[data-info]').click();
    await expect(page.locator('.image-info')).toContainText('320 × 180');
    await page.locator('[data-view=fit]').click();
    await expect(page.locator('.lightbox-video')).not.toHaveClass(/zoomed/);
    await page.locator('[data-view=fill]').click();
    await expect(page.locator('.lightbox-video')).toHaveClass(/zoomed/);
    await page.locator('[data-view=actual]').click();
    const actual = await page.locator('.lightbox-video').evaluate(video => {
      const bounds = video.getBoundingClientRect();
      const aspect = video.videoWidth / video.videoHeight;
      return {width: Math.min(bounds.width, bounds.height * aspect), nativeWidth: video.videoWidth};
    });
    expect(actual.width).toBeCloseTo(actual.nativeWidth, 0);
    await expect(page.locator('.image-download')).toHaveAttribute('download', '02-video.mp4');
    await page.locator('.lightbox-close').click();
    await page.reload();
    await expect(page.locator('.entry.video')).toHaveAttribute('data-favourite', 'true');
    await expect(page.locator('.entry.video')).toHaveAttribute('data-image-tag', '3');
    await page.locator('#image-filter').selectOption('tag3');
    await expect(page.locator('.listing .entry')).toHaveCount(1);
    await page.locator('#image-filter').selectOption('all');
    await page.locator('.entry.video').click();
    await page.keyboard.press('Control+k');
    await expect(page.locator('.lightbox-name')).toHaveText('03-photo.svg');
    expect(fs.existsSync(path.join(directory, '02-video.mp4'))).toBe(false);
    const comments = JSON.parse(fs.readFileSync(path.join(directory, 'gallery-comments.json'), 'utf8'));
    expect(comments.comments).toHaveLength(0);
  });

  test('video selection and batch organisation preserve marks and comments when moved', async ({page}) => {
    fs.mkdirSync(path.join(directory, 'chosen'));
    await page.goto(`${url}?view=gallery`);
    await page.locator('.entry.video').click();
    await page.keyboard.press('f');
    await expect(page.locator('.favourite-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('2');
    await expect(page.locator('.lightbox-tag-state')).toHaveText('2');
    const saved = await page.request.post(`${url}02-video.mp4?mode=gallery-comments`, {data: {
      type: 'add', comment: {id: 'video-note', image: '02-video.mp4', author: 'Reviewer', body: '保留这段', created_at: '2026-10-03T00:00:00Z'}
    }});
    expect(saved.ok()).toBe(true);
    await page.locator('.lightbox-close').click();
    await page.locator('#select-images').click();
    await page.locator('.entry.video').click();
    await expect(page.locator('.entry.video')).toHaveClass(/image-selected/);
    await page.locator('#move-images').click();
    await page.locator(`.move-node[data-path="${url}chosen/"] > .move-tree-row > .move-tree-label`).click();
    await Promise.all([page.waitForEvent('load'), page.locator('[data-move-confirm]').click()]);
    expect(fs.existsSync(path.join(directory, 'chosen', '02-video.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(directory, '02-video.mp4'))).toBe(false);
    const moved = JSON.parse(fs.readFileSync(path.join(directory, 'chosen', 'gallery-comments.json'), 'utf8'));
    expect(moved.comments[0].body).toBe('保留这段');
    await page.goto(`${url}chosen/?view=gallery`);
    await expect(page.locator('.entry.video')).toHaveAttribute('data-favourite', 'true');
    await expect(page.locator('.entry.video')).toHaveAttribute('data-image-tag', '2');
    await page.locator('#clear-image-marks').click();
    await Promise.all([page.waitForEvent('load'), page.locator('#clear-marks-confirm').click()]);
    await expect(page.locator('.entry.video')).toHaveAttribute('data-favourite', 'false');
    await expect(page.locator('.entry.video')).toHaveAttribute('data-image-tag', '');
    await page.locator('#delete-images').click();
    await Promise.all([page.waitForEvent('load'), page.locator('#batch-delete-confirm').click()]);
    expect(fs.existsSync(path.join(directory, 'chosen', '02-video.mp4'))).toBe(false);
  });

  test('video filenames and paths copy with yy and YY and pasted text becomes a comment', async ({page}) => {
    await page.addInitScript(() => {
      window.copiedTexts = [];
      document.execCommand = command => {
        if (command !== 'copy') return false;
        window.copiedTexts.push(document.activeElement.value);
        return true;
      };
      localStorage.setItem('webdir-review-identity', 'Reviewer');
    });
    await page.goto(`${url}?view=gallery`);
    await page.locator('.entry.video').click();
    await page.keyboard.type('yy');
    await expect.poll(() => page.evaluate(() => window.copiedTexts.at(-1))).toBe('02-video.mp4');
    await page.keyboard.type('YY');
    await expect.poll(() => page.evaluate(() => window.copiedTexts.at(-1))).toBe(path.join(directory, '02-video.mp4'));
    await page.evaluate(() => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', '视频调色建议');
      document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: clipboard, bubbles: true, cancelable: true}));
    });
    await expect(page.locator('.gallery-toast')).toHaveText('已追加评论');
    await page.keyboard.press('c');
    await expect(page.locator('.gallery-comment-list')).toContainText('视频调色建议');
    await page.locator('[data-comments-close]').click();
    await page.keyboard.press('f');
    await expect(page.locator('.favourite-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.lightbox-close').click();
    await page.locator('#image-filter').selectOption('favourite');
    await page.locator('#image-filter').blur();
    await page.keyboard.type('yy');
    await expect.poll(() => page.evaluate(() => window.copiedTexts)).toEqual(['02-video.mp4', path.join(directory, '02-video.mp4'), '02-video.mp4']);
  });

  test('touch video supports double tap to like and pinch to zoom', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    test.skip(!await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), 'touch gestures only');
    await page.locator('.entry.video').click();
    const box = await page.locator('.lightbox-video').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    for (let tap = 0; tap < 2; tap++) {
      await dispatchTouchPointer(page, '.lightbox-video', 'pointerdown', x, y);
      await dispatchTouchPointer(page, '.lightbox-video', 'pointerup', x, y);
    }
    await expect(page.locator('.favourite-toggle')).toHaveAttribute('aria-pressed', 'true');
    // Synthetic pointer IDs cannot be captured by the browser's native pointer API.
    await page.locator('#image-lightbox').evaluate(element => { element.setPointerCapture = () => {}; });
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerdown', x - 30, y, 1);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerdown', x + 30, y, 2);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointermove', x + 90, y, 2);
    await expect(page.locator('.lightbox-video')).toHaveClass(/zoomed/);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerup', x - 30, y, 1);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerup', x + 90, y, 2);
  });

  for (const operation of ['fill', 'actual-then-zoom']) {
    test(`view operation ${operation} waits for metadata and respects the latest choice`, async ({page}) => {
      await page.goto(`${url}?view=gallery`);
      await expect.poll(() => page.locator('.entry.video img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      let release;
      const blocked = new Promise(resolve => { release = resolve; });
      await page.route('**/02-video.mp4?mode=asset**', async route => {
        await blocked;
        await route.continue().catch(() => {});
      });
      try {
        await page.locator('.entry.video').click();
        await page.keyboard.press('f');
        await page.keyboard.press('c');
        await page.locator('[data-comments-close]').click();
        await page.locator('.viewer-more-toggle').click();
        await page.locator(`[data-view=${operation === 'fill' ? 'fill' : 'actual'}]`).click();
        if (operation === 'actual-then-zoom') await page.locator('[data-zoom=in]').click();
        release();
        await expect.poll(() => page.locator('.lightbox-video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
        await expect(page.locator('.lightbox-video')).toHaveClass(/zoomed/);
        const transform = await page.locator('.lightbox-video').evaluate(video => video.style.transform);
        if (operation === 'actual-then-zoom') expect(transform).toContain('scale(1.25)');
      } finally {
        release();
      }
    });
  }

  test('keeps video among images when sorting by image similarity', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await page.locator('#directory-sort').selectOption('similarity');
    await expect.poll(() => page.locator('.listing .entry').evaluateAll(nodes => nodes.map(node => node.querySelector('.entry-name').textContent))).toEqual(['01-photo.svg', '02-video.mp4', '03-photo.svg']);
  });

  test('mixes media in sort order and plays video with space and the play button', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await page.locator('#directory-sort').selectOption('name');
    await expect.poll(() => page.locator('.listing .entry').evaluateAll(nodes => nodes.map(node => node.querySelector('.entry-name').textContent))).toEqual(['01-photo.svg', '02-video.mp4', '03-photo.svg']);
    const poster = page.locator('.entry.video .glyph img');
    await expect.poll(() => poster.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await page.locator('.entry').filter({hasText: '01-photo.svg'}).click();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.lightbox-name')).toHaveText('02-video.mp4');
    const video = page.locator('.lightbox-video');
    await expect(video).toBeVisible();
    await expect(page.locator('.lightbox-position')).toHaveText('2 / 3');
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => video.evaluate(element => !element.paused)).toBe(true);
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
    await page.locator('.video-play-toggle').click();
    await expect.poll(() => video.evaluate(element => !element.paused)).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.lightbox-name')).toHaveText('03-photo.svg');
    await expect(video).toBeHidden();
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect(video).toBeVisible();
    await page.locator('.video-play-toggle').click();
    await page.locator('.lightbox-close').click();
    await expect(page.locator('#image-lightbox')).toBeHidden();
    await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
  });

  test('shares both generated covers with a fresh browser for grid, preview and carousel', async ({page, browser}) => {
    fs.copyFileSync(path.join(__dirname, 'media', 'cover-detail.mp4'), path.join(directory, '02-video.mp4'));
    await page.goto(`${url}?view=gallery`);
    const poster = page.locator('.entry.video .glyph img');
    await expect.poll(() => poster.evaluate(image => image.naturalWidth)).toBe(512);
    const entries = await (await page.request.get(`${url}?mode=directory-entries`)).json();
    const entry = entries.find(entry => entry.isVideo);
    const cached = await page.request.get(entry.gallerySrc);
    expect(cached.status()).toBe(200);
    expect(cached.headers()['content-type']).toBe('image/jpeg');
    expect(entry.previewSrc).not.toBe(entry.gallerySrc);
    const preview = await page.request.get(entry.previewSrc);
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toBe('image/jpeg');
    const context = await browser.newContext();
    try {
      const fresh = await context.newPage();
      const assets = [];
      const previewDownloads = [];
      fresh.on('request', request => {
        if (request.url().includes('02-video.mp4') && request.url().includes('mode=asset')) assets.push(request.url());
        if (request.url().includes('mode=video-preview') && request.method() === 'GET') previewDownloads.push(request.url());
      });
      await fresh.goto(new URL(`${url}?view=gallery`, page.url()).href);
      await expect.poll(() => fresh.locator('.entry.video .glyph img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      expect(assets).toEqual([]);
      expect(previewDownloads).toEqual([]);
      await fresh.route('**/02-video.mp4?mode=asset**', route => route.abort());
      await fresh.locator('.entry.video').click();
      const cover = fresh.locator('.lightbox-placeholder');
      await expect(cover).toBeVisible();
      await expect(cover).toHaveAttribute('src', /02-video\.mp4\?mode=video-preview/);
      await expect.poll(() => cover.evaluate(image => image.naturalWidth)).toBe(1600);
      const color = await cover.evaluate(image => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(20, 20, 1, 1).data);
      });
      for (const [index, value] of [16, 37, 56].entries()) expect(Math.abs(color[index] - value)).toBeLessThan(10);
      await fresh.keyboard.press('p');
      await expect(fresh.locator('#image-lightbox')).toHaveClass(/carousel-mode/);
      await expect(cover).toBeVisible();
      await expect(cover).toHaveAttribute('src', /mode=video-preview/);
    } finally {
      await context.close();
    }
  });

  test('can switch to a photo while video playback is still loading', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await expect.poll(() => page.locator('.entry.video .glyph img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    await page.route('**/02-video.mp4?mode=asset**', async route => {
      await blocked;
      await route.continue().catch(() => {});
    });
    try {
      const requested = page.waitForRequest(request => request.url().includes('02-video.mp4?mode=asset'));
      await page.locator('.entry.video').click();
      await page.keyboard.press('Space');
      await requested;
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.lightbox-name')).toHaveText('03-photo.svg');
      await expect.poll(() => page.locator('.lightbox-image').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator('.image-load-error')).toBeHidden();
    } finally {
      release();
    }
  });

  test('shows the cached cover while video data loads and keeps the paused playback frame', async ({page}) => {
    fs.copyFileSync(path.join(__dirname, 'media', 'bear.mp4'), path.join(directory, '02b-video.mp4'));
    await page.goto(`${url}?view=gallery`);
    await expect(page.locator('.entry.video')).toHaveCount(2);
    await expect.poll(() => page.locator('.entry.video img').evaluateAll(images => images.every(image => image.naturalWidth > 0))).toBe(true);
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    await page.route('**/02-video.mp4?mode=asset**', async route => {
      await blocked;
      await route.continue().catch(() => {});
    });
    try {
      await page.locator('.entry.image').filter({hasText:'01-photo.svg'}).click();
      await expect.poll(() => page.locator('.lightbox-image').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      await page.keyboard.press('ArrowRight');
      const cover = page.locator('.lightbox-placeholder');
      await expect(cover).toBeVisible();
      await expect.poll(() => cover.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator('.video-play-toggle')).toBeVisible();
      await expect.poll(() => page.locator('.lightbox-video').evaluate(video => video.readyState)).toBe(0);
      await page.keyboard.press('Space');
      await expect(page.locator('.video-play-toggle')).toBeHidden();
      await expect(cover).toBeVisible();
      release();
      await expect.poll(() => page.locator('.lightbox-video').evaluate(video => video.currentTime)).toBeGreaterThan(0);
      await expect(cover).toBeHidden();
      await page.keyboard.press('Space');
      await expect.poll(() => page.locator('.lightbox-video').evaluate(video => video.paused)).toBe(true);
      await expect(cover).toBeHidden();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.lightbox-name')).toHaveText('02b-video.mp4');
      await expect(cover).toBeVisible();
      await expect(cover).toHaveAttribute('src', /02b-video\.mp4\?mode=video-preview/);
      await expect.poll(() => cover.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.lightbox-name')).toHaveText('03-photo.svg');
      await expect.poll(() => page.locator('.lightbox-image').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
      await page.keyboard.press('ArrowLeft');
      await expect(cover).toBeVisible();
      await expect(page.locator('.video-play-toggle')).toBeVisible();
    } finally {
      release();
    }
  });

  test('tapping video reveals gallery controls and swiping advances to the next photo', async ({page}) => {
    await page.goto(`${url}?view=gallery`);
    await page.locator('.entry.video').click();
    const video = page.locator('.lightbox-video');
    const box = await video.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await expect(page.locator('#image-lightbox')).toHaveClass(/chrome-hidden/);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerdown', x, y);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerup', x, y);
    await expect(page.locator('#image-lightbox')).not.toHaveClass(/chrome-hidden/);
    const vertical = await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
    const endX = vertical ? x : x - box.width * .4;
    const endY = vertical ? y - box.height * .4 : y;
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerdown', x, y);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointermove', endX, endY);
    await dispatchTouchPointer(page, '.lightbox-video', 'pointerup', endX, endY);
    await expect(page.locator('.lightbox-name')).toHaveText('03-photo.svg');
    await expect(video).toBeHidden();
  });
});
