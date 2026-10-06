const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('collapsing the document directory gives its space to the article with comments open or closed', async ({page}) => {
  const directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'markdown-layout-'));
  try {
    fs.writeFileSync(path.join(directory, 'layout.md'), '# Document\n\n## First section\n\nText.\n\n## Second section\n\nMore text.\n');
    await page.setViewportSize({width: 2048, height: 1120});
    await page.goto(`/${path.basename(directory)}/layout.md`);
    const toggle = page.locator('#toc-toggle');
    const toc = page.locator('#toc');
    const article = page.locator('#article');
    await expect(toggle).toBeVisible();
    for (const commentsOpen of [false, true]) {
      if (commentsOpen) await page.locator('#review-toggle').click();
      await expect(toc).toBeVisible();
      const before = await article.boundingBox();
      await toggle.click();
      await expect(toc).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const after = await article.boundingBox();
      expect(after.width).toBeGreaterThan(before.width + 200);
      expect(after.x).toBeLessThan(before.x - 200);
      expect(after.x + after.width).toBeLessThan(2048 - 34);
      await toggle.click();
      await expect(toc).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect((await article.boundingBox()).width).toBeCloseTo(before.width, 0);
    }
    await toc.getByRole('link', {name: 'Second section'}).click();
    await expect(page).toHaveURL(/#section-2$/);
    await toggle.click();
    await page.setViewportSize({width: 1024, height: 900});
    await expect(toggle).toBeHidden();
    await expect(toc).toBeHidden();
    expect((await article.boundingBox()).x).toBeLessThan(100);
    await page.setViewportSize({width: 2048, height: 1120});
    await expect(toggle).toBeVisible();
    await expect(toc).toBeHidden();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toc).toBeVisible();
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
