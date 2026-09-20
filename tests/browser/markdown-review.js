const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('submitted review comments', () => {
  let directory;
  let url;

  test.beforeEach(async ({page}) => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'review-submit-'));
    url = `/${path.basename(directory)}/review.md`;
    const source = '# Review\n\nExisting paragraph.\n\nNew paragraph to review.\n';
    fs.writeFileSync(path.join(directory, 'review.md'), source);
    const quote = 'Existing paragraph.';
    const start = source.indexOf(quote);
    const comments = Array.from({length: 24}, (_, index) => ({
      id: `existing-${index}`,
      scope: index < 12 ? {type: 'document'} : {type: 'range', start, end: start + quote.length, quote},
      status: 'open',
      messages: [{id: `message-${index}`, author: 'Alice', body: `Existing discussion ${index}`, created_at: '2026-09-15T00:00:00Z'}]
    }));
    fs.writeFileSync(path.join(directory, 'review.md.review.json'), JSON.stringify({version: 1, comments}));
    await page.addInitScript(() => localStorage.setItem('webdir-review-identity', 'Alice'));
    await page.goto(url);
    await expect(page.locator('.comment-card')).toHaveCount(24);
  });

  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  for (const scope of ['range', 'document']) {
    test(`${scope} comments reveal and highlight new submissions and keep deletion on the last card`, async ({page}) => {
      const deleteButtons = page.locator('.comment-card [data-comment-action="delete-comment"]');
      const lastIds = {document: 'existing-11', range: 'existing-23'};
      const expectLastButtons = async () => {
        await expect.poll(() => deleteButtons.evaluateAll(buttons => buttons.map(button => button.closest('.comment-card').dataset.commentId)))
          .toEqual([lastIds.document, lastIds.range]);
      };
      await expectLastButtons();
      const submittedIds = [];
      for (let index = 0; index < 2; index++) {
        if (scope === 'document') {
          if (await page.locator('body').evaluate(element => element.classList.contains('review-closed'))) {
            await page.locator('#review-toggle').click();
          }
          await page.locator('#document-comment').click();
        } else {
          await page.evaluate(() => {
            const paragraph = document.querySelector('#article p:last-child');
            const text = paragraph.querySelector('.source-run').firstChild;
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(text, text.length);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            paragraph.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
          });
          await expect(page.locator('#selection-comment')).toBeVisible();
          await page.locator('#selection-comment').click();
        }
        await page.locator('#comment-list').evaluate(element => { element.scrollTop = 0; });
        const body = `New ${scope} comment ${index}`;
        await page.locator('#comment-body').fill(body);
        if (scope === 'document') await page.locator('#composer-submit').click();
        else await page.locator('#comment-body').press('Enter');
        const card = page.locator('.comment-card').filter({has: page.locator('.message p', {hasText: body})});
        await expect(card).toBeInViewport();
        await expect(card).toHaveClass(/submitted/);
        await expect(card).toHaveCSS('animation-name', 'comment-submitted');
        await expect.poll(() => page.locator('#comment-list').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await expect.poll(() => page.evaluate(body => {
          const list = document.querySelector('#comment-list');
          const element = [...list.querySelectorAll('.message p')].find(element => element.textContent === body);
          if (!element) return false;
          const message = element.getBoundingClientRect();
          const bounds = list.getBoundingClientRect();
          return message.top >= bounds.top && message.bottom <= bounds.bottom;
        }, body)).toBe(true);
        await expect(card).not.toHaveClass(/submitted/);
        await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(card.locator('[data-comment-action="delete-comment"]')).toHaveText(scope === 'document' ? '删除全文评论' : '删除整条评论');
        lastIds[scope] = await card.getAttribute('data-comment-id');
        submittedIds.push(lastIds[scope]);
        await expectLastButtons();
      }
      while (submittedIds.length) {
        const id = submittedIds.pop();
        const card = page.locator(`.comment-card[data-comment-id="${id}"]`);
        const button = card.locator('[data-comment-action="delete-comment"]');
        await button.click();
        await expect(button).toHaveText(scope === 'document' ? '确认删除全文评论' : '确认删除整条评论');
        await Promise.all([
          page.waitForResponse(response => response.url().includes('mode=review-data')).then(response => response.finished()),
          page.waitForResponse(response => response.url().includes('mode=review-action')).then(response => response.finished()),
          button.click()
        ]);
        await expect(card).toHaveCount(0);
        lastIds[scope] = submittedIds.at(-1) || (scope === 'document' ? 'existing-11' : 'existing-23');
        await expectLastButtons();
      }
    });
  }
});
