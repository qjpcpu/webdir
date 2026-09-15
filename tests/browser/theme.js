const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

module.exports = () => test.describe('Service theme switch', () => {
  let directory;
  let url;
  test.beforeEach(() => {
    directory = fs.mkdtempSync(path.join(__dirname, 'fixtures', 'theme-'));
    url = `/${path.basename(directory)}/theme.md`;
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'Theme preview');
    fs.writeFileSync(path.join(directory, 'clip.mp4'), '');
    fs.copyFileSync(path.join(__dirname, 'fixtures', '03-square.svg'), path.join(directory, 'image.svg'));
    fs.writeFileSync(path.join(directory, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'));
    fs.writeFileSync(path.join(directory, 'diagram.drawio'), '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>');
    fs.writeFileSync(path.join(directory, 'theme.md'), '# Theme\n\n```mermaid\ngraph LR\n  A[Read] --> B[Review]\n```\n');
  });
  test.afterEach(() => fs.rmSync(directory, {recursive: true, force: true}));

  test('follows the system until manually switched and remembers the chosen theme', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto(url);
    const toggle = page.locator('#theme-toggle');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
    await expect(toggle.locator('.theme-moon')).toBeVisible();
    await page.emulateMedia({colorScheme: 'dark'});
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 19, 27)');
    await expect(toggle).toHaveAccessibleName('切换到浅色模式');
    await expect(toggle.locator('.theme-sun')).toBeVisible();
    await toggle.click();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
    await expect(toggle).toHaveAccessibleName('切换到深色模式');
    await page.emulateMedia({colorScheme: 'light'});
    await page.emulateMedia({colorScheme: 'dark'});
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
    await toggle.click();
    await page.emulateMedia({colorScheme: 'light'});
    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 19, 27)');
    await expect(toggle.locator('.theme-sun')).toBeVisible();
    const bounds = await toggle.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
  });

  test('shares the choice across directory, gallery, viewers and open tabs', async ({page, context}) => {
    await page.emulateMedia({colorScheme: 'light'});
    const base = `/${path.basename(directory)}/`;
    await page.goto(base);
    await page.locator('#theme-toggle').click();
    const other = await context.newPage();
    await other.emulateMedia({colorScheme: 'light'});
    await other.goto(url);
    await expect(other.locator('body')).toHaveCSS('background-color', 'rgb(17, 19, 27)');
    for (const destination of ['?view=gallery', 'notes.txt', 'image.svg', 'image.png', 'clip.mp4', 'diagram.drawio', 'theme.md']) {
      await page.goto(base + destination);
      const dark = destination === 'clip.mp4' ? 'rgb(11, 13, 18)' : 'rgb(17, 19, 27)';
      await expect(page.locator('body')).toHaveCSS('background-color', dark);
      const toggle = page.locator('#theme-toggle');
      const bounds = await toggle.boundingBox();
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
      await toggle.click();
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
      await expect(other.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
      await toggle.click();
      await expect(other.locator('body')).toHaveCSS('background-color', 'rgb(17, 19, 27)');
    }
    for (const destination of [base + 'missing.txt', '/__webdir/invalid-access']) {
      await page.goto(destination);
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
      await page.locator('#theme-toggle').click();
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
      await page.locator('#theme-toggle').click();
    }
    await other.close();
  });

  test('switches Mermaid diagrams and the live editor preview together', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto(url);
    const node = page.locator('#article .mermaid-diagram .node rect').first();
    await expect(node).toHaveCSS('fill', 'rgb(238, 238, 255)');
    await page.locator('#theme-toggle').click();
    await expect(node).toHaveCSS('fill', 'rgb(48, 48, 82)');
    await page.locator('#edit-button').click();
    const preview = page.frameLocator('#preview');
    await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(17, 19, 27)');
    const previewNode = preview.locator('.mermaid-diagram .node rect').first();
    await expect(previewNode).toHaveCSS('fill', 'rgb(48, 48, 82)');
    await page.locator('#theme-toggle').click();
    await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 252)');
    await expect(previewNode).toHaveCSS('fill', 'rgb(238, 238, 255)');
  });
});
