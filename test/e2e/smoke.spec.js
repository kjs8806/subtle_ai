import { test, expect } from '@playwright/test'

async function signIn(page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page.locator('#page-overview')).toBeVisible()
}

async function connectAndScan(page) {
  await navigateTo(page, 'sources')
  const action = page.locator('[data-gmail-action]')
  await expect(action).toHaveText(/Find subscriptions from receipts/)
  await action.click()
  await expect(page.getByRole('dialog', { name: 'Find subscriptions from receipts' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue with Gmail' }).click()
  await expect(page.locator('[data-gmail-status]')).toHaveText('Connected')
  await expect(page.locator('[data-last-scan-results]')).toContainText('subscription')
}

// Scoped to the existing data-route-link="<route>" contract (see
// src/ui/navigation.js) rather than matching on link text: Overview
// deliberately repeats nav destination names in its own preview links
// ("Manage sources", "View all subscriptions"), which collide with a
// plain getByRole('link', { name }) text match under Playwright's default
// substring matching - the primary nav's data-route-link attribute is
// unique to the actual nav item and never appears on those preview links.
async function navigateTo(page, route) {
  const mobileMenuButton = page.getByRole('button', { name: 'Menu' })
  if (await mobileMenuButton.isVisible().catch(() => false)) {
    await mobileMenuButton.click()
    await page.locator('#mobile-menu').locator(`[data-route-link="${route}"]`).click()
  } else {
    await page.locator('aside.sidebar').locator(`[data-route-link="${route}"]`).click()
  }
}

test('@critical sign in → Connect Gmail → Scan → subscription appears', async ({ page }) => {
  await signIn(page)
  await connectAndScan(page)
  await navigateTo(page, 'subscriptions')
  await expect(page.locator('[data-subscription-rows] [data-subscription-id]')).toHaveCount(6)
  await expect(page.getByText('Netflix', { exact: true })).toBeVisible()
})

test('@critical subscription detail → correction → corrected provenance visible', async ({ page }) => {
  await signIn(page)
  await connectAndScan(page)
  await navigateTo(page, 'subscriptions')
  await page.getByRole('link', { name: /Review Netflix/ }).click()
  await expect(page.getByRole('heading', { name: 'Netflix' })).toBeVisible()

  await page.getByRole('button', { name: 'This looks wrong' }).click()
  const dialog = page.getByRole('dialog', { name: 'Update the details below' })
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-correction-price]').fill('18.99')
  await dialog.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.locator('[data-detail-cost]')).toContainText('USD 18.99')
  await expect(page.locator('[data-detail-provenance]')).toContainText('Confirmed by you')
})

test('@critical reject subscription → confirm dialog → removed from active list', async ({ page }) => {
  await signIn(page)
  await connectAndScan(page)
  await navigateTo(page, 'subscriptions')
  await page.getByRole('link', { name: /Review Spotify/ }).click()
  await page.getByRole('button', { name: 'Not a subscription' }).click()
  const dialog = page.getByRole('dialog', { name: 'Not a subscription?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Mark as not a subscription' }).click()
  await expect(page.getByRole('heading', { name: 'Your subscriptions' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Review Spotify/ })).toHaveCount(0)
})

test('@mobile mobile navigation opens, routes, and closes with Escape', async ({ page }) => {
  await signIn(page)
  const menuButton = page.getByRole('button', { name: 'Menu' })
  await expect(menuButton).toBeVisible()
  await menuButton.click()
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#mobile-menu')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  await expect(menuButton).toBeFocused()

  await menuButton.click()
  await page.locator('#mobile-menu').locator('[data-route-link="subscriptions"]').click()
  await expect(page.getByRole('heading', { name: 'Your subscriptions' })).toBeVisible()
  await expect(page.locator('#mobile-menu')).toBeHidden()
})

test('empty state is honest before first scan', async ({ page }) => {
  await signIn(page)
  await navigateTo(page, 'subscriptions')
  await expect(page.getByRole('heading', { name: 'No subscriptions yet' })).toBeVisible()
  await expect(page.getByText(/haven't found any subscriptions/i)).toBeVisible()
})

test('session API failure shows retryable error state', async ({ page }) => {
  await page.route('**/api/v1/session', route => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()
  await expect(retry).toBeFocused()
})

test('@mobile consequential dialogs are keyboard-operable and return focus', async ({ page }) => {
  await signIn(page)
  await connectAndScan(page)
  await navigateTo(page, 'subscriptions')
  await page.getByRole('link', { name: /Review Netflix/ }).click()

  const trigger = page.getByRole('button', { name: 'This looks wrong' })
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Update the details below' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
