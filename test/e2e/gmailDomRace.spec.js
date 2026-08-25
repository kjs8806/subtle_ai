import { test, expect } from '@playwright/test'

// QA found an intermittent "Cannot set properties of null (setting
// 'disabled')" during Gmail connect/scan flows in the browser smoke suite's
// webserver log (PR #51, SHA e320831). Root cause, confirmed by reading the
// actual stack traces rather than assumed: a DOM Event's currentTarget is
// reset to null by the browser once dispatch finishes - true even for
// elements that are never removed or replaced - so any async click handler
// that captures event.currentTarget and mutates it *after* an await throws
// exactly this error when it resumes. Two handlers in src/main.js did this:
// the Gmail disclosure's "Continue with Gmail" button and the "Not a
// subscription" confirm button's re-enable-on-failure path. Both now capture
// the element into a local const before the first await instead.
//
// A hypothesized alternative cause (a stale/partial Sources-page DOM query
// mid-route-render) was investigated and ruled out: [data-gmail-status],
// [data-gmail-message], [data-gmail-action], and [data-gmail-disconnect] are
// all siblings inserted by the same sourcesPageMarkup() innerHTML assignment
// (src/ui/sources.js), so they always appear and disappear together - there
// is no code path today where one exists without the others. setGmailState
// was still hardened defensively (scoped to #page-sources, all four
// elements guarded) since that's real latent-risk safety regardless of
// today's markup, but it was not the cause of the reported error.
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

async function navigateTo(page, route) {
  const mobileMenuButton = page.getByRole('button', { name: 'Menu' })
  if (await mobileMenuButton.isVisible().catch(() => false)) {
    await mobileMenuButton.click()
    await page.locator('#mobile-menu').locator(`[data-route-link="${route}"]`).click()
  } else {
    await page.locator('aside.sidebar').locator(`[data-route-link="${route}"]`).click()
  }
}

test('@critical connecting Gmail via the disclosure dialog produces no page errors and re-enables the Continue button', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await signIn(page)
  await navigateTo(page, 'sources')
  await page.locator('[data-gmail-action]').click()
  const dialog = page.getByRole('dialog', { name: 'Find subscriptions from receipts' })
  await expect(dialog).toBeVisible()
  // Queried by attribute rather than scoped through the dialog's role: once
  // connectGmail() resolves, the handler calls gmailDialog.close(), which
  // drops the <dialog> out of the accessibility tree entirely (closed
  // dialogs don't match getByRole('dialog', ...) even though the element -
  // and this button inside it - are still present in the DOM). A
  // dialog-scoped locator would therefore fail to find the button after
  // close for reasons unrelated to the bug under test.
  const continueButton = page.locator('[data-continue-gmail]')
  await continueButton.click()

  await expect(page.locator('[data-gmail-status]')).toHaveText('Connected')
  await expect(page.locator('[data-last-scan-results]')).toContainText('subscription')

  // If the Continue button's re-enable after connectGmail() silently failed
  // (the exact bug here), it would still show disabled. toBeEnabled() reads
  // the disabled property directly and doesn't require the (now-closed)
  // dialog to be visible - connecting once already flips [data-gmail-action]
  // into "scan" mode, so reopening this same disclosure dialog through the
  // UI isn't possible without a second, separate account.
  await expect(continueButton).toBeEnabled()

  expect(pageErrors, `expected no page errors, got: ${JSON.stringify(pageErrors)}`).toEqual([])
})

test('@critical the reject-subscription confirm button recovers after a failed request, with no page errors', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await signIn(page)
  await navigateTo(page, 'sources')
  await page.locator('[data-gmail-action]').click()
  await page.getByRole('dialog', { name: 'Find subscriptions from receipts' }).getByRole('button', { name: 'Continue with Gmail' }).click()
  await expect(page.locator('[data-gmail-status]')).toHaveText('Connected')

  await navigateTo(page, 'subscriptions')
  await page.getByRole('link', { name: /Review Netflix/ }).click()

  // Force the reject request to fail once, exercising the finally block's
  // button-re-enable path on the failure branch specifically - this is the
  // one path in the whole file that actually hit the null-currentTarget bug
  // (the success path navigates away and closes the dialog before ever
  // reaching that line).
  await page.route('**/api/v1/subscriptions/*/reject', (route) => route.abort())
  await page.getByRole('button', { name: 'Not a subscription' }).click()
  const dialog = page.getByRole('dialog', { name: 'Not a subscription?' })
  await expect(dialog).toBeVisible()
  const confirmButton = dialog.getByRole('button', { name: 'Mark as not a subscription' })
  await confirmButton.click()

  await expect(confirmButton).toBeEnabled()
  await expect(dialog).toBeVisible()

  expect(pageErrors, `expected no page errors, got: ${JSON.stringify(pageErrors)}`).toEqual([])
})
