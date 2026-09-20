const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('Review context', () => {
  let directory, url, markdown, sidecar;
  const original = '# Review\n\n## Retry policy\n\nThe worker will retry forever. Record every failure.\n\n## Notification\n\nNotify the caller after completion.\n';
  const rangeScope = (quote, text = original) => {
    const start = text.indexOf(quote), end = start + quote.length;
    return {type: 'range', start, end, quote, prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(end, end + 64)};
  };
  const comment = (id, scope, status = 'open') => ({
    id, scope, status,
    messages: [{id: `${id}-message`, author: 'Alice', body: `Discussion ${id}`, created_at: '2026-09-20T00:00:00Z'}]
  });
  const selectText = async (page, text, occurrence = 0) => {
    await page.evaluate(({text, occurrence}) => {
      const run = [...document.querySelectorAll('#article .source-run')].find(run => run.textContent.includes(text));
      const node = run.firstChild;
      let start = node.textContent.indexOf(text);
      for (let index = 0; index < occurrence; index++) start = node.textContent.indexOf(text, start + text.length);
      const range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + text.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      run.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    }, {text, occurrence});
    await page.locator('#selection-comment').click();
  };
  const writeComments = comments => fs.writeFileSync(sidecar, JSON.stringify({version: 1, comments}));

  test.beforeEach(async ({page}) => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'review-context-'));
    markdown = path.join(directory, 'review.md'); sidecar = `${markdown}.review.json`;
    url = `/${path.basename(directory)}/review.md`;
    fs.writeFileSync(markdown, original);
    await page.addInitScript(() => localStorage.setItem('webdir-review-identity', 'Alice'));
  });
  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('resolved discussions retain their original quote and follow the rewritten paragraph', async ({page}) => {
    await page.goto(url);
    await selectText(page, 'retry forever.');
    await page.locator('#comment-body').fill('Please set a retry limit.');
    await page.locator('#composer-submit').click();
    await expect(page.locator('.comment-card')).toContainText('Please set a retry limit.');
    const data = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    data.comments[0].status = 'resolved';
    data.comments[0].messages.push({id: 'answer', author: 'AI', body: 'Limited to three attempts.', created_at: '2026-09-20T00:01:00Z'});
    writeComments(data.comments);
    fs.writeFileSync(markdown, original.replace('The worker will retry forever. Record every failure.', 'Retry up to three times, recording each failed attempt.'));
    await page.reload();
    await page.locator('#review-toggle').click();
    await page.locator('[data-review-filter="resolved"]').click();
    const card = page.locator('.comment-card');
    await expect(card).toHaveAttribute('data-anchor-state', 'paragraph');
    await expect(card.locator('.comment-scope')).toContainText('retry forever.');
    await card.locator('[data-comment-action="locate"]').click();
    await expect(page.locator('#article .review-target')).toContainText('Retry up to three times');
    if (await page.locator('body').evaluate(el => el.classList.contains('review-closed'))) {
      await page.locator('#review-return').click();
    }
    await expect(card.locator('.message').last()).toContainText('Limited to three attempts.');
    await expect(card).toHaveClass(/active/);
  });

  test('retains the original quote and hides source navigation when the anchor is missing', async ({page}) => {
    writeComments([comment('missing', rangeScope('retry forever.'), 'resolved')]);
    fs.writeFileSync(markdown, '# Revised\n\nA completely new retry policy.\n');
    await page.goto(url); await page.locator('#review-toggle').click();
    await page.locator('[data-review-filter="resolved"]').click();
    const card = page.locator('.comment-card');
    await expect(card).toHaveAttribute('data-anchor-state', 'missing');
    await expect(card.locator('.comment-scope')).toContainText('retry forever.');
    await expect(card.locator('[data-comment-action="locate"]')).toHaveCount(0);
    await card.locator('.comment-history summary').click();
    await expect(card.locator('.message')).toContainText('Discussion missing');
  });

  test('cycles overlapping discussions and retains the source highlight', async ({page}) => {
    writeComments([comment('first', rangeScope('retry forever.')), comment('second', rangeScope('retry forever.'))]);
    await page.goto(url);
    const run = page.locator('#article .source-run').filter({hasText: 'The worker will retry forever.'});
    await run.click();
    await expect(page.locator('.comment-card.active')).toHaveAttribute('data-comment-id', 'first');
    await page.locator('#review-next').click();
    await expect(page.locator('.comment-card.active')).toHaveAttribute('data-comment-id', 'second');
    await expect(run).toHaveClass(/review-target/);
  });

  test('preserves a reply draft and focus when another reviewer updates the same thread', async ({page, request}) => {
    writeComments([comment('one', rangeScope('retry forever.'))]);
    await page.goto(url); await page.locator('#review-toggle').click();
    const card = page.locator('.comment-card');
    await card.locator('[data-comment-action="reply"]').click();
    const input = card.locator('.reply-box textarea');
    await input.fill('My unfinished reply');
    await input.evaluate(el => el.setSelectionRange(3, 3));
    await request.post(`${url}?mode=review-action`, {data: {
      type: 'add-message', comment_id: 'one',
      message: {id: 'bob', author: 'Bob', body: 'A concurrent reply', created_at: '2026-09-20T00:02:00Z'}
    }});
    await expect(card).toContainText('A concurrent reply');
    await expect(input).toHaveValue('My unfinished reply');
    await expect(input).toBeFocused();
    expect(await input.evaluate(el => el.selectionStart)).toBe(3);
    await input.press('Enter');
    await expect(card.locator('.reply-box')).toHaveCount(0);
    await expect(card).toContainText('My unfinished reply');
  });

  test('offers a direct history entry after resolving the current discussion', async ({page}) => {
    writeComments([comment('one', rangeScope('retry forever.'))]);
    await page.goto(url); await page.locator('#review-toggle').click();
    await page.locator('[data-comment-action="resolve"]').click();
    await page.locator('#review-show-resolved').click();
    const card = page.locator('.comment-card.active');
    await expect(card).toHaveAttribute('data-comment-id', 'one');
    await card.locator('[data-comment-action="locate"]').click();
    await expect(page.locator('#article .review-target')).toContainText('retry forever.');
  });

  test('keeps a rewritten paragraph associated when another section repeats the original quote', async ({page}) => {
    fs.appendFileSync(markdown, '\n## Other worker\n\nA different worker may retry forever.\n');
    await page.goto(url);
    await selectText(page, 'retry forever.');
    await page.locator('#comment-body').fill('Limit this worker only.');
    await page.locator('#composer-submit').click();
    await expect(page.locator('.comment-card')).toContainText('Limit this worker only.');
    fs.writeFileSync(markdown, fs.readFileSync(markdown, 'utf8').replace('The worker will retry forever. Record every failure.', 'This worker retries at most three times.'));
    await page.reload(); await page.locator('#review-toggle').click();
    const card = page.locator('.comment-card');
    await expect(card).toHaveAttribute('data-anchor-state', 'paragraph');
    await card.locator('[data-comment-action="locate"]').click();
    await expect(page.locator('#article .review-target')).toContainText('This worker retries at most three times.');
  });

  test('follows a rewrite of the final paragraph using the document boundary', async ({page}) => {
    await page.goto(url);
    await selectText(page, 'Notify the caller after completion.');
    await page.locator('#comment-body').fill('Describe failed completion too.');
    await page.locator('#composer-submit').click();
    await expect(page.locator('.comment-card')).toContainText('Describe failed completion too.');
    fs.writeFileSync(markdown, original.replace('Notify the caller after completion.', 'Send success or failure to the caller.'));
    await page.reload(); await page.locator('#review-toggle').click();
    await expect(page.locator('.comment-card')).toHaveAttribute('data-anchor-state', 'paragraph');
    await page.locator('[data-comment-action="locate"]').click();
    await expect(page.locator('#article .review-target')).toContainText('Send success or failure');
  });

  test('history navigation keeps the requested thread selected until the reader scrolls', async ({page}) => {
    const text = original + '\n' + Array.from({length: 25}, (_, i) => `Paragraph ${i} supplies some background.\n\n`).join('') + 'A distant discussion.\n';
    fs.writeFileSync(markdown, text);
    writeComments([comment('near', rangeScope('retry forever.', text), 'resolved'), comment('far', rangeScope('A distant discussion.', text))]);
    await page.goto(url); await page.locator('#review-toggle').click();
    await page.locator('[data-comment-action="resolve"]').click();
    await page.locator('#review-show-resolved').click();
    await expect(page.locator('.comment-card.active')).toHaveAttribute('data-comment-id', 'near');
  });

  test('keeps the exact occurrence selected inside a paragraph with repeated words', async ({page}) => {
    fs.writeFileSync(markdown, '# Retry\n\nRetry this worker; retry this other worker.\n');
    await page.goto(url);
    await selectText(page, 'this', 1);
    await page.locator('#comment-body').fill('Only the second worker.');
    await page.locator('#composer-submit').click();
    await expect(page.locator('.comment-card')).toContainText('Only the second worker.');
    await page.reload(); await page.locator('#review-toggle').click();
    await expect(page.locator('.comment-card')).toHaveAttribute('data-anchor-state', 'exact');
    await page.locator('[data-comment-action="locate"]').click();
    const range = await page.evaluate(() => {
      const range = [...CSS.highlights.get('review-selected')][0];
      return {text: range.toString(), start: range.startOffset};
    });
    expect(range).toEqual({text: 'this', start: 25});
  });

  test('follows the paragraph in view without changing the document scroll position', async ({page}) => {
    test.skip(test.info().project.name.includes('mobile') || test.info().project.name.includes('tablet'), 'Desktop follow mode');
    const text = original + '\n' + Array.from({length: 30}, (_, i) => `Paragraph ${i} supplies some background.\n\n`).join('') + 'A distant discussion.\n\n' + 'More context.\n\n'.repeat(10);
    fs.writeFileSync(markdown, text);
    writeComments([comment('near', rangeScope('retry forever.', text)), comment('far', rangeScope('A distant discussion.', text))]);
    await page.goto(url); await page.locator('#review-toggle').click();
    await expect(page.locator('.comment-card.active')).toHaveAttribute('data-comment-id', 'near');
    const scroll = await page.evaluate(() => {
      [...document.querySelectorAll('#article p')].find(p => p.textContent === 'A distant discussion.').scrollIntoView({block: 'center', behavior: 'instant'});
      return scrollY;
    });
    await expect(page.locator('.comment-card.active')).toHaveAttribute('data-comment-id', 'far');
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('.comment-card.active')).toHaveAttribute('data-comment-id', 'near');
  });
});
