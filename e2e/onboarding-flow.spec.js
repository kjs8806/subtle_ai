import { expect, test } from '@playwright/test'

// MVP-BETA-002/003 (#39/#40): the required mocked-provider smoke flow - sign
// in, understand the Gmail disclosure, connect Gmail, scan, see a discovered
// subscription, open it, return to Sources, disconnect, and confirm manual
// entry still works independently of Gmail. Runs against the real dev server
// (GMAIL_PROVIDER=mock, see playwright.e2e.config.js) so every network call
// is real; nothing here mocks the app's own behavior. One long scenario, not
// independent tests, so the steps below can build on each other in order -
// though as of the identity-isolation fix (server/gmail/fakeProvider.js's
// mock-success:<uuid> code, minted fresh per real "Continue with Google"
// click; see test/browserIdentityIsolation.test.js) each Playwright test
// actually gets its own fresh, isolated backend account rather than sharing
// one fixed account across the whole suite.
test('new user can sign in, connect Gmail, discover subscriptions, and disconnect', async ({ page }) => {
  await test.step('landing page explains the product before requiring sign-in', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Your AI subscription/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
  })

  await test.step('sign in with the mock Google provider', async () => {
    await page.getByRole('button', { name: /Continue with Google/i }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: /Good morning/i })).toBeVisible()
  })

  await test.step('start from a disconnected account', async () => {
    // Sign-in and Gmail authorization are deliberately separate steps
    // (server/app.js's callback, docs/product/features/FEATURE-001.md) - a
    // fresh mock sign-in already starts disconnected. This guard just makes
    // the step resilient if that ever stops being true, and reaches the
    // genuine "never connected" starting point a real first-time user has -
    // the same disconnect flow exercised again later in this test.
    await page.goto('/#/sources')
    if (await page.locator('[data-gmail-disconnect]').isVisible()) {
      await page.locator('[data-gmail-disconnect]').click()
      await expect(page.locator('[data-gmail-status]')).toHaveText('Not connected', { timeout: 10_000 })
    }
  })

  await test.step('a first-time, disconnected user sees a prominent Connect Gmail call to action', async () => {
    await page.goto('/#/overview')
    const panel = page.locator('.first-run-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Connect Gmail' })).toBeVisible()
    await expect(panel.getByRole('link', { name: /Add a subscription manually/i })).toBeVisible()
  })

  await test.step('the Gmail disclosure explains read-only access before authorization', async () => {
    await page.locator('.first-run-panel').getByRole('link', { name: 'Connect Gmail' }).click()
    await expect(page).toHaveURL(/#\/sources$/)
    await page.getByRole('button', { name: /Find subscriptions from receipts/i }).click()
    const dialog = page.getByRole('dialog', { name: /Find subscriptions from receipts/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/read-only/i)).toBeVisible()
    await expect(dialog.getByText(/disconnect/i)).toBeVisible()
    await dialog.getByRole('button', { name: /Continue with Gmail/i }).click()
  })

  await test.step('connecting triggers a scan and surfaces discovered subscriptions', async () => {
    // The mock provider connects synchronously and main.js's connectGmail()
    // chains straight into a scan (see its "mock provider connects
    // synchronously with no redirect" comment) - no extra click needed.
    await expect(page.locator('[data-gmail-status]')).toHaveText(/Connected|Scanning/, { timeout: 15_000 })
    await expect(page.locator('[data-last-scan-results]')).toContainText(/subscription/i, { timeout: 15_000 })
  })

  await test.step('the discovered subscriptions are reviewable', async () => {
    await page.goto('/#/subscriptions')
    await expect(page.getByRole('link', { name: /Netflix/i })).toBeVisible()
  })

  await test.step('opening a subscription shows receipt-backed evidence, not a raw error', async () => {
    await page.getByRole('link', { name: /Netflix/i }).click()
    await expect(page).toHaveURL(/#\/subscriptions\//)
    await expect(page.getByText(/Netflix/i).first()).toBeVisible()
    await expect(page.locator('.evidence-item .tag').first()).toHaveText(/From receipt|Confirmed by you/)
  })

  await test.step('the user can return to Sources and disconnect Gmail', async () => {
    await page.locator('.back-link').click()
    await page.goto('/#/sources')
    await expect(page.locator('[data-gmail-status]')).toHaveText('Connected')
    const disconnectButton = page.locator('[data-gmail-disconnect]')
    await expect(disconnectButton).toBeVisible()
    await disconnectButton.click()
    await expect(page.locator('[data-gmail-status]')).toHaveText('Not connected', { timeout: 10_000 })
  })

  await test.step('manual subscription entry keeps working independently of Gmail', async () => {
    await page.goto('/#/subscriptions')
    // Two elements carry [data-open-add] (desktop toolbar button and mobile
    // FAB, DES-026) - only one is visible at a given width.
    await page.locator('[data-open-add]:visible').first().click()
    const addDialog = page.getByRole('dialog', { name: /Add a subscription/i })
    await expect(addDialog).toBeVisible()
    await addDialog.getByLabel(/Service name/i).fill('Playwright Smoke Test Service')
    await addDialog.getByLabel(/Cost/i).fill('4.99')
    await addDialog.getByRole('button', { name: /Add to overview/i }).click()
    await expect(page.getByRole('link', { name: /Playwright Smoke Test Service/i })).toBeVisible()
  })
})
