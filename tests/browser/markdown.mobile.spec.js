const { test, expect } = require('@playwright/test');

require('./markdown-review')();
require('./markdown-loading')();

test('review file copy button copies only the filename', async ({page}) => {
  await page.addInitScript(() => {
    window.copiedTexts = [];
    document.execCommand = command => {
      if (command !== 'copy') return false;
      window.copiedTexts.push(document.activeElement.value);
      return true;
    };
  });
  await page.goto('/review.md');

  await expect(page.locator('#copy-review-path')).toHaveText('复制评论文件名');
  await page.locator('#review-toggle').click();
  await page.locator('#copy-review-path').click();
  await expect.poll(() => page.evaluate(() => window.copiedTexts)).toEqual(['review.md.review.json']);
  await expect(page.locator('#file-path-toast')).toHaveText('复制文件名 review.md.review.json');
});

test('touch selection opens the range-comment composer and a body tap hides the panel', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('webdir-review-identity', 'Alice'));
  await page.goto('/review.md');
  await expect(page.locator('#article')).toContainText('降低背景高光');

  await page.evaluate(() => {
    const run = document.querySelector('#article .source-run');
    const text = Array.from(run.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(6, text.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#article').dispatchEvent(new TouchEvent('touchend', {bubbles: true}));
  });
  await expect(page.locator('#selection-comment')).toBeVisible();
  const selectionButton = await page.locator('#selection-comment').boundingBox();
  const viewport = page.viewportSize();
  expect(selectionButton.x).toBeGreaterThanOrEqual(0);
  expect(selectionButton.y).toBeGreaterThanOrEqual(0);
  expect(selectionButton.x + selectionButton.width).toBeLessThanOrEqual(viewport.width);
  expect(selectionButton.y + selectionButton.height).toBeLessThanOrEqual(viewport.height);

  await page.locator('#selection-comment').dispatchEvent('touchend', {bubbles: true, cancelable: true});
  await expect(page.locator('#review-composer')).toBeVisible();
  await expect(page.locator('#composer-scope')).toContainText('“');
  await expect(page.locator('#identity-dialog')).not.toBeVisible();

  await page.locator('#composer-cancel').click();
  await page.evaluate(() => getSelection().removeAllRanges());
  const bodyTap = await page.evaluate(() => {
    const paragraph = document.querySelector('#article p').getBoundingClientRect();
    const panel = document.querySelector('#review-panel').getBoundingClientRect();
    return {
      x: Math.max(paragraph.left + 1, Math.min(paragraph.left + paragraph.width / 2, panel.left - 5)),
      y: paragraph.top + Math.min(12, paragraph.height / 2)
    };
  });
  await page.touchscreen.tap(bodyTap.x, bodyTap.y);
  await expect(page.locator('body')).toHaveClass(/review-closed/);
});

test('document comments can be added, edited, and deleted on touch layouts', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('webdir-review-identity', 'Alice'));
  await page.goto('/review.md');
  await page.locator('#review-toggle').click();
  await page.locator('#document-comment').click();
  await expect(page.locator('#review-composer')).toBeVisible();

  await page.locator('#comment-body').fill('需要调整全文语气');
  await page.locator('#comment-body').press('Enter');
  const card = page.locator('.comment-card').filter({hasText: '全文评论'});
  await expect(card).toBeVisible();
  await expect(card.locator('.message p')).toHaveText('需要调整全文语气');

  await card.locator('[data-comment-action="edit-comment"]').click();
  const editor = card.locator('.message-editor textarea');
  await editor.fill('编辑后的全文评论 jk');
  await editor.press('Meta+Enter');
  await expect(editor).toHaveValue('编辑后的全文评论 jk\n');
  await Promise.all([
    page.waitForResponse(response => response.url().includes('mode=review-data')).then(response => response.finished()),
    page.waitForResponse(response => response.url().includes('mode=review-action')).then(response => response.finished()),
    editor.press('Enter')
  ]);
  await expect(card.locator('.message p')).toHaveText('编辑后的全文评论 jk');

  const deleteComment = card.locator('[data-comment-action="delete-comment"]');
  await deleteComment.click();
  await expect(deleteComment).toHaveText('确认删除全文评论');
  await deleteComment.click();
  await expect(card).toHaveCount(0);
});
