import { test, expect } from '@playwright/test'

// CI has hit real, transient failures of the actual GET /api/v1/session
// call on first load - confirmed via CI's own error-context snapshot, not
// assumed: the app correctly rendered its designed "Something went wrong" /
// "Try again" recovery state (sessionErrorMarkup, src/ui/signedOut.js)
// instead of the sign-in button. Observed CI runs show this clearing within
// roughly 45-50s across the whole run, so this polls the app's own real
// "Try again" recovery control - the same one the dedicated "session API
// failure" test below exercises - for up to 60s, rather than either
// papering over it with a longer single-assertion timeout (the error page
// is fully rendered and stable; it won't self-correct without a retry) or
// failing the whole suite on a backend hiccup unrelated to what this
// suite actually verifies.
async function signIn(page) {
  await page.goto('/')
  const googleButton = page.getByRole('button', { name: 'Continue with Google' })
  const retryButton = page.getByRole('button', { name: 'Try again' })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await googleButton.isVisible().catch(() => false)) break
    if (await retryButton.isVisible().catch(() => false)) await retryButton.click().catch(() => {})
    await page.waitForTimeout(1_000)
  }
  await expect(googleButton).toBeVisible()
  await googleButton.click()
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
  // Scoped to the subscription rows: an always-present (hidden) correction-
  // dialog <select> elsewhere on the page also lists every known service
  // name as an <option>, including "Netflix", which makes an unscoped
  // page-wide text match ambiguous under Playwright's strict mode.
  await expect(page.locator('[data-subscription-rows]').getByText('Netflix', { exact: true })).toBeVisible()
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
  // exact: true - Overview's first-run panel (rendered whenever
  // subscriptions are empty, see src/ui/overview.js) has its own heading,
  // "Let's find your subscriptions", which Playwright's default non-exact
  // name matching treats as containing this heading's text too, making an
  // unscoped match ambiguous during/around a route transition.
  await expect(page.getByRole('heading', { name: 'Your subscriptions', exact: true })).toBeVisible()
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
  // exact: true - Overview's first-run panel (rendered whenever
  // subscriptions are empty, see src/ui/overview.js) has its own heading,
  // "Let's find your subscriptions", which Playwright's default non-exact
  // name matching treats as containing this heading's text too, making an
  // unscoped match ambiguous during/around a route transition.
  await expect(page.getByRole('heading', { name: 'Your subscriptions', exact: true })).toBeVisible()
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
