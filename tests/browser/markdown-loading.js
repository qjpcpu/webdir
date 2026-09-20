const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('Markdown loading', () => {
  let directory;
  let url;
  const source = '# Review\n\n## Discussion\n\nA paragraph to review.\n';
  const diagram = '\n```mermaid\ngraph LR\n  A[Read] --> B[Review]\n```\n';

  test.beforeEach(() => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'markdown-loading-'));
    url = `/${path.basename(directory)}/review.md`;
    fs.writeFileSync(path.join(directory, 'review.md'), source);
    fs.writeFileSync(path.join(directory, 'review.md.review.json'), JSON.stringify({
      version: 1,
      comments: [{id: 'discussion', scope: {type: 'document'}, status: 'open', messages: [
        {id: 'message', author: 'Alice', body: 'Ready for review', created_at: '2026-09-20T00:00:00Z'}
      ]}]
    }));
  });

  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('directory and comments work while the diagram library is loading', async ({page}) => {
    fs.appendFileSync(path.join(directory, 'review.md'), diagram);
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/mermaid-*.min.js', async route => {
      await pending;
      await route.continue();
    });
    try {
      await page.goto(url, {waitUntil: 'commit'});
      await expect(page.locator('#toc a')).toHaveText('Discussion');
      await expect(page.locator('#review-count')).toHaveText('1');
      await page.locator('#review-toggle').click();
      await expect(page.locator('.comment-card')).toContainText('Ready for review');
      await expect(page.locator('.comment-card')).toBeVisible();
    } finally {
      release();
    }
    await expect(page.locator('#article .mermaid-diagram svg')).toBeVisible();
  });

  test('loads editor and diagram libraries when those features are first used', async ({page}) => {
    const requests = [];
    page.on('request', request => {
      if (/\/__webdir\/(mermaid|yjs)-/.test(request.url())) requests.push(request.url());
    });
    await page.goto(url);
    await expect(page.locator('#review-count')).toHaveText('1');
    expect(requests).toEqual([]);

    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/yjs-*.min.js', async route => {
      await pending;
      await route.continue();
    });
    try {
      await page.locator('#edit-button').click();
      await expect(page.locator('#edit-button')).toBeDisabled();
      await expect(page.locator('#article')).toBeVisible();
      await page.locator('#review-toggle').click();
      await expect(page.locator('.comment-card')).toBeVisible();
    } finally {
      release();
    }
    const editor = page.locator('#source');
    await expect(editor).toBeEnabled();
    await expect(editor).toHaveValue(source);
    const preview = page.frameLocator('#preview');
    await expect(preview.locator('article')).toContainText('A paragraph to review.');
    expect(requests.filter(url => url.includes('/yjs-'))).toHaveLength(1);
    expect(requests.filter(url => url.includes('/mermaid-'))).toHaveLength(0);
    await editor.fill(source + diagram);
    await expect(preview.locator('.mermaid-diagram svg')).toBeVisible();
    await page.locator('#save-button').click();
    await expect.poll(() => fs.readFileSync(path.join(directory, 'review.md'), 'utf8')).toBe(source + diagram);
  });
});
