const { expect } = require('@playwright/test');

async function openGalleryImage(page, name = '01-portrait.svg') {
  await page.goto('/?view=gallery');
  const entry = page.locator('.listing.gallery .entry.image').filter({hasText: name});
  await expect(page.locator('.summary')).toContainText('个文件');
  for (let i = 0; i < 20 && await entry.count() === 0; i++) {
    await page.evaluate(() => scrollBy(0, innerHeight));
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await entry.click();
  await expect(page.locator('#image-lightbox')).toBeVisible();
  await expect(page.locator('.lightbox-image')).toHaveAttribute('alt', name);
}

async function dispatchTouchPointer(page, selector, type, x, y, pointerId = 1) {
  await page.locator(selector).dispatchEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1
  });
}

module.exports = {dispatchTouchPointer, openGalleryImage};
