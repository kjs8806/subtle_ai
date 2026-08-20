import { expect, test } from '@playwright/test'

test('mobile navigation remains usable without horizontal overflow', async ({ page }) => {
  await page.route('**/api/v1/session', (route) => route.fulfill({ contentType: 'application/json', body: '{"authenticated":false}' }))
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Product navigation' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('mobile disclosure is a bottom sheet and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/api/v1/session', (route) => route.fulfill({ contentType: 'application/json', body: '{"authenticated":false}' }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Gmail' }).click()
  const box = await page.getByRole('dialog', { name: 'Connect Gmail' }).boundingBox()
  const viewport = page.viewportSize()
  expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1)
  expect(await page.locator('.action-card').first().evaluate((node) => getComputedStyle(node).animationDuration)).toBe('0.01ms')
})