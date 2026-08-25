import { expect, test } from '@playwright/test'
import { signIn } from './helpers.js'

// MVP-BETA-005 (#42, C1-C4): required viewport coverage - ~360px and
// ~390/430px phones, ~768px tablet, ~1024px, and desktop. Runs on every
// desktop project plus the two mobile responsive projects (see
// playwright.e2e.config.js). Non-mutating (no connect/scan/disconnect), so
// it's safe regardless of what other specs do with their own signIn()'d
// account.
const WIDTHS = [
  { label: 'small phone (360px)', width: 360, height: 780 },
  { label: 'large phone (390px)', width: 390, height: 844 },
  { label: 'tablet (768px)', width: 768, height: 1024 },
  { label: 'small desktop (1024px)', width: 1024, height: 800 },
]

const ROUTES = ['#/overview', '#/subscriptions', '#/sources', '#/settings']

for (const { label, width, height } of WIDTHS) {
  test.describe(`at ${label}`, () => {
    test.use({ viewport: { width, height } })

    test('core pages render without horizontal overflow', async ({ page }) => {
      await signIn(page)
      for (const route of ROUTES) {
        await page.goto(`/${route}`)
        await expect(page.locator('[data-page-root] > *').first()).toBeVisible()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, `${route} at ${width}px has horizontal overflow`).toBeLessThanOrEqual(1)
      }
    })

    test('primary navigation is reachable', async ({ page }) => {
      await signIn(page)
      if (width < 960) {
        // Below the sidebar breakpoint (src/style.css) the sidebar is hidden
        // and every route link lives behind the hamburger menu instead - no
        // primary workflow may depend on the desktop sidebar (C2).
        await expect(page.locator('.sidebar')).toBeHidden()
        const menuButton = page.locator('.menu-button')
        await expect(menuButton).toBeVisible()
        await menuButton.click()
        const menu = page.locator('#mobile-menu')
        await expect(menu).toBeVisible()
        await expect(menu.getByRole('link', { name: 'Subscriptions' })).toBeVisible()
        await expect(menu.getByRole('link', { name: 'Sources' })).toBeVisible()
        await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible()
      } else {
        await expect(page.locator('.sidebar')).toBeVisible()
        await expect(page.locator('.sidebar').getByRole('link', { name: 'Subscriptions' })).toBeVisible()
      }
    })

    test('the manual-add dialog fits the viewport and stays usable', async ({ page }) => {
      await signIn(page)
      await page.goto('/#/subscriptions')
      // Two elements carry [data-open-add]: the desktop toolbar button (DES-026
      // hides it below 960px) and the mobile FAB (shown only below 960px) - only
      // one is ever visible at a given width, so :visible picks the right one
      // instead of always grabbing the DOM-first (toolbar) match.
      await page.locator('[data-open-add]:visible').first().click()
      const dialog = page.getByRole('dialog', { name: /Add a subscription/i })
      await expect(dialog).toBeVisible()
      const box = await dialog.boundingBox()
      expect(box.width, 'add-subscription dialog must not exceed the viewport width').toBeLessThanOrEqual(width + 1)
      await expect(dialog.getByLabel(/Service name/i)).toBeVisible()
      await expect(dialog.getByRole('button', { name: /Add to overview/i })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })
  })
}
