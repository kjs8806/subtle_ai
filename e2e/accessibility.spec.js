import { expect, test } from '@playwright/test'
import { expectNoSeriousA11yViolations, signIn } from './helpers.js'

// An axe-core scan is meaningfully heavier than a plain navigation/assertion
// step (it injects and runs a full ruleset against the live DOM on top of the
// sign-in + navigate + dialog-open work already in each test below), so this
// file gets a longer per-test timeout than the suite default in
// playwright.e2e.config.js rather than raising that default for every spec.
test.setTimeout(60_000)

// #43 Accessibility & Cross-Browser QA Gate - automated axe-core coverage of
// representative major screens/states (landing, first-run Overview, Sources
// + Gmail disclosure dialog, Subscriptions + Add dialog, Subscription Detail
// + correction/removal dialogs, Worth your attention, Settings), per the
// product-approved matrix in the #43 QA plan. This suite is deliberately
// self-contained (it never assumes another spec ran first, or that its own
// tests run in a particular order) so it stays safe to run in any order -
// each signIn() call now gets its own fresh, isolated backend account (see
// helpers.js), but this suite doesn't depend on that either way.
//
// Zero axe violations is evidence, not certification (per #43): a critical
// or serious finding fails this suite; moderate/minor findings are logged
// to the test output for the manual QA accessibility review instead of
// failing CI. Manual keyboard, screen-reader, and visual-accessibility
// review remain required and are tracked separately (see
// docs/quality/ACCESSIBILITY_QA.md).

test('landing / sign-in screen has no critical or serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your AI subscription/i })).toBeVisible()
  await expectNoSeriousA11yViolations(page, 'landing (signed out)')
})

test('first-run Overview (disconnected) has no critical or serious accessibility violations', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/sources')
  if (await page.locator('[data-gmail-disconnect]').isVisible()) {
    await page.locator('[data-gmail-disconnect]').click()
    await expect(page.locator('[data-gmail-status]')).toHaveText('Not connected', { timeout: 10_000 })
  }
  await page.goto('/#/overview')
  await expect(page.locator('.first-run-panel')).toBeVisible()
  await expectNoSeriousA11yViolations(page, 'overview (first-run, disconnected)')
})

test('Sources page and the Gmail disclosure dialog have no critical or serious accessibility violations', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/sources')
  await expectNoSeriousA11yViolations(page, 'sources page')

  if (await page.locator('[data-gmail-disconnect]').isVisible()) {
    await page.locator('[data-gmail-disconnect]').click()
    await expect(page.locator('[data-gmail-status]')).toHaveText('Not connected', { timeout: 10_000 })
  }
  await page.getByRole('button', { name: /Find subscriptions from receipts/i }).click()
  const dialog = page.getByRole('dialog', { name: /Find subscriptions from receipts/i })
  await expect(dialog).toBeVisible()
  await expectNoSeriousA11yViolations(page, 'Gmail disclosure dialog')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('Subscriptions, Add dialog, Subscription Detail, and correction/removal dialogs have no critical or serious accessibility violations', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/subscriptions')
  await expectNoSeriousA11yViolations(page, 'subscriptions page')

  await page.locator('[data-open-add]:visible').first().click()
  const addDialog = page.getByRole('dialog', { name: /Add a subscription/i })
  await expect(addDialog).toBeVisible()
  await expectNoSeriousA11yViolations(page, 'add subscription dialog')
  await addDialog.getByLabel(/Service name/i).fill('A11y QA Manual Test Service')
  await addDialog.getByLabel(/Cost/i).fill('9.99')
  await addDialog.getByRole('button', { name: /Add to overview/i }).click()
  const newItemLink = page.getByRole('link', { name: /A11y QA Manual Test Service/i })
  await expect(newItemLink).toBeVisible()

  await newItemLink.click()
  await expect(page).toHaveURL(/#\/subscriptions\//)
  await expectNoSeriousA11yViolations(page, 'subscription detail (manual item)')

  await page.locator('[data-edit-manual]').click()
  const editDialog = page.getByRole('dialog', { name: /Edit subscription/i })
  await expect(editDialog).toBeVisible()
  await expectNoSeriousA11yViolations(page, 'edit subscription dialog (manual item)')
  await page.keyboard.press('Escape')
  await expect(editDialog).toBeHidden()

  await page.locator('[data-remove-manual]').click()
  const removeDialog = page.getByRole('dialog', { name: /Remove subscription/i })
  await expect(removeDialog).toBeVisible()
  await expectNoSeriousA11yViolations(page, 'remove subscription confirmation dialog')
  await page.locator('[data-confirm-remove-manual]').click()
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await expect(newItemLink).toBeHidden()
})

test('Worth your attention page has no critical or serious accessibility violations', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/attention')
  await expectNoSeriousA11yViolations(page, 'worth your attention page')
})

test('Settings page has no critical or serious accessibility violations', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/settings')
  await expectNoSeriousA11yViolations(page, 'settings page')
})
